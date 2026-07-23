#!/usr/bin/env node
const { execFileSync, execFile } = require("node:child_process");
const { promisify } = require("node:util");
const execFileAsync = promisify(execFile);
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const APP_ROOT = path.resolve(__dirname, "..");
const IMAGE_GEN_CANDIDATES = [
  process.env.PIXEL_TOYS_IMAGE_GEN_SCRIPT,
  path.join(APP_ROOT, "scripts/vendor/image-gen.js"),
  path.join(os.homedir(), ".agents/skills/image-gen/scripts/node/image-gen.js"),
  path.join(os.homedir(), ".codex/skills/image-gen/scripts/node/image-gen.js"),
].filter(Boolean);
const IMAGE_GEN = IMAGE_GEN_CANDIDATES.find((candidate) => fs.existsSync(candidate)) || IMAGE_GEN_CANDIDATES[0];
const IMAGE_GEN_SKILL_URL = "https://apikey.fun/install/skill/image-gen";
const IMAGE_API_KEY_ENV_NAMES = ["OPENAI_API_KEY", "APIKEY_FUN_API_KEY", "APIKEYFUN_API_KEY"];
const IMAGE_GEN_IMAGE_MODEL = process.env.PIXEL_TOYS_IMAGE_TOOL_MODEL || process.env.PIXEL_TOYS_IMAGE_MODEL || process.env.IMAGE_GEN_IMAGE_MODEL || "gpt-image-2";
const IMAGE_GEN_ORCHESTRATION_MODEL = process.env.PIXEL_TOYS_IMAGE_ORCHESTRATION_MODEL || process.env.IMAGE_GEN_ORCHESTRATION_MODEL || process.env.IMAGE_GEN_MODEL || "gpt-5.4-mini";
const DEFAULT_IMAGE_TIMEOUT_SECONDS = Number.parseInt(process.env.PIXEL_TOYS_IMAGE_TIMEOUT_SECONDS || "900", 10);
const STORYBOARD_IMAGE_TIMEOUT_SECONDS = Number.parseInt(process.env.PIXEL_TOYS_STORYBOARD_IMAGE_TIMEOUT_SECONDS || "900", 10);
const STORYBOARD_RESCUE_TIMEOUT_SECONDS = Number.parseInt(process.env.PIXEL_TOYS_STORYBOARD_RESCUE_TIMEOUT_SECONDS || "900", 10);
const DEFAULT_IMAGE_RETRIES = Number.parseInt(process.env.PIXEL_TOYS_IMAGE_RETRIES || "2", 10);
const STORYBOARD_IMAGE_RETRIES = Number.parseInt(process.env.PIXEL_TOYS_STORYBOARD_IMAGE_RETRIES || "1", 10);
const STORYBOARD_RENDERER_VERSION = "production-board-imagegen-v17-production-tabs-visible-references";

function usage() {
  console.log("usage: run_asset_generation.js <asset_prompts.md> <episode_root> [--dry-run] [--force] [--asset-name <name>] [--edit-instruction <text>] [--reference-image <path>] [--asset-reference-map <json>] [--style-reference-image <path>] [--size 1280x720|2048x1152|3840x2160]");
}

function parseArgs(argv) {
  const args = { promptsPath: "", episodeRoot: "", dryRun: false, force: false, assetName: "", editInstruction: "", referenceImages: [], assetReferenceMap: "", styleReferenceImage: "", size: "1280x720", concurrency: 1 };
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "-h" || arg === "--help") {
      usage();
      process.exit(0);
    }
    if (arg === "--dry-run") {
      args.dryRun = true;
      continue;
    }
    if (arg === "--force") {
      args.force = true;
      continue;
    }
    if (arg === "--asset-name") {
      args.assetName = argv[++i] || "";
      continue;
    }
    if (arg === "--edit-instruction") {
      args.editInstruction = argv[++i] || "";
      continue;
    }
    if (arg === "--reference-image") {
      const referenceImage = argv[++i] || "";
      if (referenceImage) args.referenceImages.push(path.resolve(referenceImage));
      continue;
    }
    if (arg === "--asset-reference-map") {
      args.assetReferenceMap = path.resolve(argv[++i] || "");
      continue;
    }
    if (arg === "--style-reference-image") {
      const styleReferenceImage = argv[++i] || "";
      if (styleReferenceImage) args.styleReferenceImage = path.resolve(styleReferenceImage);
      continue;
    }
    if (arg === "--concurrency") {
      const parsed = Number.parseInt(argv[++i] || "", 10);
      args.concurrency = Number.isFinite(parsed) && parsed >= 1 ? parsed : 1;
      continue;
    }
    if (arg === "--size") {
      args.size = argv[++i] || "";
      continue;
    }
    if (!args.promptsPath) {
      args.promptsPath = path.resolve(arg);
      continue;
    }
    if (!args.episodeRoot) {
      args.episodeRoot = path.resolve(arg);
      continue;
    }
    throw new Error(`unknown argument: ${arg}`);
  }
  if (!args.promptsPath || !args.episodeRoot) throw new Error("missing arguments");
  if (args.assetName && /[\\/]/.test(args.assetName)) throw new Error("--asset-name must be an asset name, not a path");
  if (args.editInstruction && !args.assetName) throw new Error("--edit-instruction requires --asset-name");
  if (!/^\d+x\d+$/.test(args.size)) throw new Error(`invalid --size: ${args.size}`);
  return args;
}

function readAssetReferenceMap(filePath = "") {
  if (!filePath) return new Map();
  if (!fs.existsSync(filePath)) throw new Error(`asset reference map does not exist: ${filePath}`);
  const raw = JSON.parse(fs.readFileSync(filePath, "utf8"));
  const entries = raw && typeof raw === "object" && !Array.isArray(raw) ? raw.assets || raw : {};
  const map = new Map();
  for (const [assetName, value] of Object.entries(entries || {})) {
    const refs = Array.isArray(value) ? value : value?.references || value?.images || [];
    const normalized = refs
      .map((item) => (typeof item === "string" ? item : item?.path || item?.file || ""))
      .filter(Boolean)
      .map((item) => path.resolve(item));
    if (assetName && normalized.length) map.set(assetName, normalized);
  }
  return map;
}

function parseAssets(markdown) {
  const re = /^## New (Character|Scene|Prop|Insert|Storyboard) Asset:\s+([^\r\n]+?)\s*$/gm;
  const matches = [...markdown.matchAll(re)];
  const assets = matches.map((match, index) => {
    const start = match.index + match[0].length;
    const end = index + 1 < matches.length ? matches[index + 1].index : markdown.length;
    const section = markdown.slice(start, end).trim();
    const prompt = extractTextToImagePrompt(section);
    return {
      type: match[1],
      name: match[2],
      prompt,
      order: index,
    };
  });
  const typeOrder = { Character: 0, Scene: 1, Prop: 2, Insert: 3, Storyboard: 4 };
  return assets.sort((a, b) => (typeOrder[a.type] ?? 9) - (typeOrder[b.type] ?? 9) || a.order - b.order);
}

function extractTextToImagePrompt(section) {
  const re = /文生图提示词(?:[^\n：:]*?)[:：]\s*```(?:text|txt|markdown|md)?\s*([\s\S]*?)```/i;
  const match = section.match(re);
  return (match?.[1] || section).trim();
}

function outputPath(root, asset) {
  const folder = asset.type === "Character" ? "characters" : asset.type === "Scene" ? "scenes" : asset.type === "Storyboard" ? "storyboards" : "props";
  return path.join(root, "04_assets", folder, `${asset.name}.png`);
}

function typeCounts(assets) {
  return assets.reduce((counts, asset) => {
    counts[asset.type] = (counts[asset.type] || 0) + 1;
    return counts;
  }, {});
}

function promptFor(asset) {
  const storyboardRule =
    asset.type === "Storyboard"
      ? "Production Board output contract: one 9:16 vertical (portrait) sheet — the whole sheet is taller than it is wide, exact 9:16 aspect ratio, full sheet visible, no cropping. The full sheet is exactly 9 equal-size panels in a 3 columns x 3 rows grid, read left-to-right then top-to-bottom (P1 top-left through P9 bottom-right). Every panel outer boundary is a portrait 9:16 cell with equal outer dimensions and uniform gutters; P1 is an ordinary top-left cell, never a wide establishing strip. Do not allow any panel to overlap, merge, or span multiple cells. Render real cinematic panel imagery that inherits the actual referenced Character, Scene, Prop, and Insert assets, so this one Production Board can be the only video reference later. Reserve the lower 40 percent of every panel as clean off-white paper; a deterministic post-process will typeset the Production Tab there with P-number, duration, full plot/action, full dialogue, Visual / Camera / Shot / Lens / Lighting / Emotion, and visible reference thumbnails. Use the upper 60 percent as the cinematic vertical frame. Do not render your own dialogue, production fields, tables, or technical notes. Do NOT add a header, footer, metadata table, caption band outside a panel, or any content outside the nine story panels."
      : "";
  return [
    "Production-grade reference asset. Follow the selected visual style, layout, identity, and safety constraints exactly.",
    "This is a production-grade reference asset for a short-drama video workflow.",
    storyboardRule,
    asset.prompt,
  ].filter(Boolean).join("\n\n");
}

function referenceTypeFromName(imagePath = "") {
  const name = path.basename(imagePath);
  if (/^C\d+/i.test(name) || /CHARACTER/i.test(name)) return "Character";
  if (/^S\d+/i.test(name) || /WIDE_ESTABLISHING/i.test(name)) return "Scene";
  if (/^P\d+/i.test(name) || /PROP/i.test(name)) return "Prop";
  if (/^I\d+/i.test(name) || /INSERT/i.test(name)) return "Insert";
  if (/^SB\d+/i.test(name) || /STORYBOARD/i.test(name)) return "Storyboard";
  return "";
}

function referenceAssetName(imagePath = "") {
  return path.basename(String(imagePath || ""), path.extname(String(imagePath || "")));
}

function storyboardReferencedAssetNames(asset) {
  if (asset?.type !== "Storyboard") return [];
  const prompt = String(asset.prompt || "");
  const names = [];
  const re = /\b[CSPI]\d{3}_[^\s,;，；。)\]）】}]+/gu;
  for (const match of prompt.matchAll(re)) {
    const name = match[0]
      .replace(/\.(png|jpe?g|webp)$/i, "")
      .replace(/[.。:：]+$/u, "");
    if (name && !names.includes(name)) names.push(name);
  }
  return names;
}

function referenceImagesForAsset(asset, referenceImages = []) {
  const references = (referenceImages || []).filter(Boolean);
  if (asset?.type !== "Storyboard" || !references.length) return references;
  const wanted = storyboardReferencedAssetNames(asset);
  if (!wanted.length) return references;
  const byName = new Map(references.map((image) => [referenceAssetName(image), image]));
  const selected = [];
  for (const name of wanted) {
    const image = byName.get(name);
    if (image && !selected.includes(image)) selected.push(image);
  }
  return selected.length ? selected : references;
}

function mappedReferenceImagesForAsset(asset, referenceMap = new Map()) {
  if (asset?.type !== "Scene") return [];
  if (!asset?.name || !referenceMap?.size) return [];
  return (referenceMap.get(asset.name) || []).filter(Boolean);
}

function isHiddenSceneReference(asset, imagePath = "", referenceMap = new Map()) {
  if (asset?.type !== "Scene" || !asset?.name || !referenceMap?.size) return false;
  return mappedReferenceImagesForAsset(asset, referenceMap).includes(imagePath);
}

function referenceCodeForImage(imagePath = "", index = 0) {
  const type = referenceTypeFromName(imagePath);
  const prefix = type === "Character" ? "PT-C" : type === "Scene" ? "PT-S" : type === "Insert" ? "PT-I" : type === "Prop" ? "PT-P" : "PT-R";
  const match = referenceAssetName(imagePath).match(/^[A-Z](\d{3})_/i);
  return `${prefix}${match ? match[1] : String(index + 1).padStart(3, "0")}`;
}

function storyboardReferenceContactSheet(asset, referenceImages = [], logsDir = os.tmpdir()) {
  if (asset?.type !== "Storyboard" || !referenceImages.length) return "";
  fs.mkdirSync(logsDir, { recursive: true });
  const out = path.join(logsDir, `${asset.name}.reference-board.png`);
  const payload = referenceImages.map((image, index) => ({
    path: image,
    type: referenceTypeFromName(image) || "Reference",
    code: referenceCodeForImage(image, index),
    name: referenceAssetName(image),
  }));
  const py = String.raw`
import json, sys, textwrap
from PIL import Image, ImageDraw, ImageFont

items = json.loads(sys.argv[1])
out = sys.argv[2]
W, H = 1280, 720
paper = (246, 242, 232)
ink = (20, 20, 18)
muted = (92, 88, 78)
blue = (36, 94, 173)
red = (178, 45, 45)
img = Image.new("RGB", (W, H), paper)
draw = ImageDraw.Draw(img)
try:
    font_bold = ImageFont.truetype("/System/Library/Fonts/Supplemental/Arial Bold.ttf", 24)
    font = ImageFont.truetype("/System/Library/Fonts/Supplemental/Arial.ttf", 18)
    small = ImageFont.truetype("/System/Library/Fonts/Supplemental/Arial.ttf", 14)
except Exception:
    font_bold = font = small = ImageFont.load_default()

draw.text((30, 22), "PRODUCTION ASSET REFERENCE BOARD", fill=ink, font=font_bold)
draw.text((30, 54), "Use these official assets as the visible identity source for cinematic storyboard panels.", fill=muted, font=font)
draw.rectangle((30, 92, 1250, 690), outline=ink, width=2)
cols = min(4, max(1, len(items)))
rows = (len(items) + cols - 1) // cols
cell_w = (1220) / cols
cell_h = (598) / max(1, rows)
for idx, item in enumerate(items):
    col = idx % cols
    row = idx // cols
    x0 = int(30 + col * cell_w)
    y0 = int(92 + row * cell_h)
    x1 = int(30 + (col + 1) * cell_w)
    y1 = int(92 + (row + 1) * cell_h)
    draw.rectangle((x0 + 10, y0 + 10, x1 - 10, y1 - 10), outline=muted, width=1)
    label = f"{item['code']} | {item['type']}"
    draw.text((x0 + 18, y0 + 16), label, fill=blue if item["type"] == "Character" else red if item["type"] == "Scene" else ink, font=font_bold)
    name = item["name"]
    for line_i, line in enumerate(textwrap.wrap(name, width=32)[:2]):
        draw.text((x0 + 18, y0 + 46 + line_i * 18), line, fill=muted, font=small)
    thumb_box = (x0 + 18, y0 + 88, x1 - 18, y1 - 18)
    try:
        with Image.open(item["path"]) as src:
            src = src.convert("RGB")
            tw = thumb_box[2] - thumb_box[0]
            th = thumb_box[3] - thumb_box[1]
            scale = min(tw / src.width, th / src.height)
            nw = max(1, int(src.width * scale))
            nh = max(1, int(src.height * scale))
            resample = getattr(Image, "Resampling", Image).LANCZOS
            src = src.resize((nw, nh), resample)
            bg = Image.new("RGB", (tw, th), (255, 255, 255))
            bg.paste(src, ((tw - nw)//2, (th - nh)//2))
            img.paste(bg, (thumb_box[0], thumb_box[1]))
    except Exception as exc:
        draw.text((thumb_box[0] + 8, thumb_box[1] + 8), f"missing: {exc}", fill=red, font=small)
    draw.rectangle(thumb_box, outline=ink, width=1)
img.save(out)
`;
  execFileSync("python3", ["-c", py, JSON.stringify(payload), out], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 60_000 });
  return out;
}

function referenceGuidanceFor(asset, referenceImages = [], mode = "generate", options = {}) {
  if (!referenceImages.length) return "";
  const lines = ["Reference image binding rules:"];
  const primaryType = referenceTypeFromName(referenceImages[0]);
  const hiddenSceneReferences = options.hiddenSceneReferences instanceof Set ? options.hiddenSceneReferences : new Set();
  if (asset.type === "Character" && primaryType === "Character") {
    lines.push(
      "Reference 1 is the primary character identity anchor, not a loose style reference.",
      "This is a hard identity lock: Reference 1 controls the face, ethnicity/casting, skin tone, hairstyle/hairline, age impression, body proportions, and recognisable human likeness.",
      "The final character must look like the same person as Reference 1: same facial structure, age impression, ethnicity/casting, hairstyle/hairline, eye shape, skin tone, body proportions, and recognisable actor likeness.",
      mode === "edit"
        ? "The target image supplies only the current asset layout, pose-sheet structure, and already-correct non-identity details. If the target face, body, or casting conflicts with Reference 1, Reference 1 wins for all human identity and appearance."
        : "The new generated image must keep the asset role and reference-sheet format, while using Reference 1 as the person/face identity source.",
      "Apply costume, armor, injury, transformation, or prop changes to that same referenced person. Do not create a new unrelated actor.",
      "Do not merely borrow the style or mood of Reference 1. Match the person.",
    );
  } else if (asset.type === "Character") {
    lines.push(
      "Use the attached reference images for the explicitly requested aspects. If any reference contains a person and the user asked for appearance likeness, prioritize that face/body likeness while keeping this asset's required character-sheet format.",
    );
  } else if (asset.type === "Scene") {
    if (hiddenSceneReferences.size) {
      lines.push(
        "Hidden film references are COLOR-GRADE-ONLY references.",
        "Borrow only color palette, saturation, contrast, exposure, shadow density, highlight rolloff, grain/texture feel, atmosphere tone, and broad lighting mood.",
        "Do not copy the reference image's subject, geography, terrain, architecture, coastline, cliff shape, roads, objects, composition, camera angle, framing, weather event, or story content.",
        "The scene subject, location identity, spatial layout, foreground/midground/background structure, and all story evidence must come only from the current asset prompt.",
        "The final scene asset must remain an empty wide establishing environment with no people.",
      );
    } else {
      lines.push(
        "Use references only for the explicitly requested scene aspects while preserving the current asset prompt as the source of truth. Do not replace the scene subject or story location with the reference image.",
        "The final scene asset must remain an empty wide establishing environment with no people.",
      );
    }
  } else if (asset.type === "Prop") {
    lines.push(
      "Use references for prop shape, material construction, scale, wear, color, and practical object logic. The final prop asset must remain a pure-white-background three-view prop reference.",
    );
  } else if (asset.type === "Storyboard") {
    lines.push(
      "Use the attached production asset references as the visible identity source inside every cinematic story panel. Each referenced character must retain the same face, hairstyle, wardrobe, body type and recognisable identity; each scene and prop must retain its actual structure, material, palette and lighting logic. Do NOT draw any ASSET REFERENCES strip, thumbnail boxes, or asset reference area — output only the story panels.",
      "Character turnarounds are hidden identity inputs: their front, side, back, and portrait views lock the same face, hairstyle, wardrobe, body proportions, and recognisable identity across every panel, but never appear as thumbnails, reference strips, or extra board cells.",
      "Every attached reference image must be assigned one clear role based on its filename prefix: C### is a Character, S### is a Scene/location, P### is a Prop, and I### is an Insert/detail. Never treat a Scene reference as a character, and never treat a Character reference as a location.",
      "The story panels must be true cinematic frames built from those reference identities, not generic sketches. Do not paste or thumbnail the official asset images anywhere on the board.",
    );
  } else {
    lines.push(
      "Use references only for the user-intended visual aspects while preserving the current asset type, screenplay role, and required production-reference layout.",
    );
  }
  lines.push(...referenceImages.map((image, index) => {
    const tag = hiddenSceneReferences.has(image) ? ", color-grade-only hidden film reference" : "";
    return `Reference ${index + 1}: ${path.basename(image)} (${referenceTypeFromName(image) || "untyped"}${tag})`;
  }));
  return lines.join("\n");
}

function styleReferenceGuidance(styleReferenceImage = "") {
  if (!styleReferenceImage) return "";
  return [
    "Style reference image rules:",
    "The style reference image is a style-only art-direction sample. It is NOT a character identity reference, NOT a scene/location reference, NOT a prop reference, and NOT a composition reference.",
    "Borrow only: line weight, edge treatment, cel-shading/rendering language, color palette, saturation level, contrast, texture, lighting mood, surface finish, and overall art direction.",
    "Do not copy or import any person, face, body, clothing, pose, object, architecture, background, logo, text, layout, framing, or story content from the style reference image.",
    "The generated asset subject, identity, costume, prop, scene, layout contract, and screenplay evidence must come only from the current asset prompt.",
    `Style reference image: ${path.basename(styleReferenceImage)}`,
  ].join("\n");
}

function referenceRoleFor(asset, mode = "generate", options = {}) {
  if (asset.type === "Character") {
    return [
      "Reference image. HARD IDENTITY ANCHOR, not style-only.",
      "For Character assets, Reference 1 controls face, ethnicity/casting, skin tone, hairstyle/hairline, age impression, body proportions, and recognisable person identity.",
      "The output must depict the same person as the reference. Apply requested costume, armor, transformation, injury, or prop changes to that same person.",
      mode === "edit"
        ? "If the target/current image conflicts with this reference, the reference wins for human identity and appearance; target image only keeps the production sheet layout."
        : "Keep the required production sheet layout while using this reference as the identity source.",
    ].join(" ");
  }
  if (asset.type === "Scene") {
    if (options.hiddenSceneReference) {
      return [
        "COLOR-GRADE-ONLY hidden film reference.",
        "Use only palette, saturation, contrast, exposure, shadow density, highlight rolloff, grain/texture feel, atmosphere tone, and broad lighting mood.",
        "Do not copy subject matter, terrain, geography, cliffs, coastline, roads, architecture, objects, composition, camera angle, framing, weather event, or story content.",
        "The final scene subject, location, layout, spatial structure, and screenplay evidence must come only from the text prompt.",
      ].join(" ");
    }
    return "Reference image. Use only the explicitly requested scene aspects; do not replace the scene subject or story location with the reference image. Keep the final scene empty with no people.";
  }
  if (asset.type === "Prop" || asset.type === "Insert") {
    return "Reference image. Object/material anchor: use it for shape, material, scale, color, wear, and practical construction. Keep the required asset-reference format.";
  }
  if (asset.type === "Storyboard") {
    return "Production asset reference image. Read the filename prefix before using it: C### means Character, S### means Scene/location, P### means Prop, I### means Insert/detail. Character turnarounds are visible identity anchors in each panel's deterministic Production Tab and are primary identity inputs for the cinematic frame: use their front/side/back/portrait views to lock face, hairstyle, wardrobe, body proportions, and recognisable identity. Render every asset's actual identity inside the cinematic storyboard panels: preserve character likeness and wardrobe, scene architecture and palette, and prop form and material. Integrate it naturally into each upper 9:16 narrative camera frame.";
  }
  return "Reference image. Follow the prompt for the exact aspect to borrow; preserve the requested asset type and production-reference format.";
}

function styleReferenceRole() {
  return [
    "STYLE-ONLY reference image.",
    "Use this image only for art direction: line weight, outline style, cel-shading or rendering quality, color palette, saturation, contrast, texture, surface finish, lighting mood, and general visual language.",
    "Do not use it for identity, face, body, clothing, pose, object design, location, architecture, background, composition, readable text, logos, or story content.",
    "The output content must follow the text prompt and current asset type only.",
  ].join(" ");
}

function targetImageRoleFor(asset, mode = "generate") {
  if (mode === "edit" && asset.type === "Character") {
    return "Target/current asset image. Use only for the required 16:9 character-sheet layout, pose-sheet structure, canvas composition, and already-correct non-identity production details. Do not use it as the face/person identity source when reference images are provided.";
  }
  if (mode === "edit") {
    return "Target/current asset image. Use for current asset layout and already-correct details, then apply the prompt and reference-image instructions.";
  }
  return "Target image to revise.";
}

function primaryImageRoleFor(asset, mode = "generate", options = {}) {
  if (asset.type === "Storyboard") {
    return referenceRoleFor(asset, mode);
  }
  return referenceRoleFor(asset, mode, options);
}

function referencePromptFor(asset, referenceImages = [], styleReferenceImage = "", options = {}) {
  return [
    promptFor(asset),
    referenceGuidanceFor(asset, referenceImages, "generate", options),
    styleReferenceGuidance(styleReferenceImage),
  ].filter(Boolean).join("\n\n");
}

function firstPromptLine(prompt, prefix, fallback = "") {
  const line = String(prompt || "")
    .split(/\r?\n/)
    .map((item) => item.trim())
    .find((item) => item.toLowerCase().startsWith(String(prefix || "").toLowerCase()));
  return line || fallback;
}

function compactStoryboardPanelLines(prompt) {
  return String(prompt || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^P[1-9]\s+\d/.test(line))
    .slice(0, 9)
    .map((line) => line.replace(/\s+/g, " "))
    .join("\n");
}

function storyboardPanelObjects(prompt) {
  return compactStoryboardPanelLines(prompt)
    .split(/\r?\n/)
    .filter(Boolean)
    .slice(0, 9)
    .map((line, index) => {
      const match = line.match(/^(P[1-9])\s+([^:：]+)[:：]?\s*(.*)$/i);
      const raw = match ? match[3] : line;
      const field = (name) => {
        const matchField = raw.match(new RegExp(`(?:^|;)\\s*${name}=([\\s\\S]*?)(?=;\\s*(?:visual|camera|shot|lens|lighting|emotion|dialogue|action|continuity)=|$)`, "i"));
        return (matchField?.[1] || "").replace(/\s+/g, " ").trim();
      };
      const visual = field("visual");
      const description = visual || raw
        .replace(/;\s*(?:No dialogue|Dialogue|对白|无对白)[\s\S]*$/i, "")
        .replace(/\s+/g, " ")
        .trim() || line;
      return {
        label: match?.[1] || `P${index + 1}`,
        timeRange: match?.[2]?.trim() || "",
        raw: line,
        description,
        visual: visual || description,
        camera: field("camera"),
        shot: field("shot"),
        lens: field("lens"),
        lighting: field("lighting"),
        emotion: field("emotion"),
        dialogue: field("dialogue") || (raw.match(/;\s*((?:No dialogue|Dialogue|对白|无对白)[^;]*)/i)?.[1] || "").trim(),
        action: field("action"),
        continuity: field("continuity"),
      };
    });
}

function wrapText(text, maxChars = 42, maxLines = 4) {
  const clean = String(text || "").replace(/\s+/g, " ").trim();
  if (!clean) return [];
  const lines = [];
  let rest = clean;
  while (rest && lines.length < maxLines) {
    lines.push(rest.slice(0, maxChars));
    rest = rest.slice(maxChars);
  }
  return lines;
}

function assetBindingEntries(prompt) {
  const line = firstPromptLine(prompt, "Asset bindings:", "");
  return String(line || "")
    .replace(/^Asset bindings:\s*/i, "")
    .split(";")
    .map((item) => item.trim())
    .map((item) => {
      const match = item.match(/^(PT-[CSPI]\d{3})\s*=\s*([^;]+)$/i);
      if (!match) return null;
      return { code: match[1], name: match[2].trim().replace(/[.。；;，,]+$/g, "") };
    })
    .filter(Boolean);
}

function refCodeForName(name, fallbackType = "") {
  const type = fallbackType || referenceTypeFromName(name) || "Prop";
  const prefix = type === "Character" ? "PT-C" : type === "Scene" ? "PT-S" : type === "Insert" ? "PT-I" : "PT-P";
  const match = String(name || "").match(/^[A-Z]+(\d{3})_/i);
  return `${prefix}${match ? match[1] : "000"}`;
}

function localStoryboardFallbackPrompt(asset, referenceImages = []) {
  const prompt = String(asset.prompt || "");
  const panels = storyboardPanelObjects(prompt);
  const bindings = assetBindingEntries(prompt);
  const wanted = new Map(bindings.map((entry) => [entry.name, entry.code]));
  const imagesForBoard = referenceImages
    .map((image) => {
      const basename = path.basename(image).replace(/\.(png|jpe?g|webp)$/i, "");
      const type = referenceTypeFromName(image) || "Reference";
      return {
        path: image,
        name: basename,
        type,
        code: wanted.get(basename) || refCodeForName(basename, type),
      };
    })
    .filter((ref) => !wanted.size || wanted.has(ref.name));
  const refs = imagesForBoard.length
    ? imagesForBoard
    : bindings.length
      ? bindings.map((entry) => ({ path: "", name: entry.name, type: referenceTypeFromName(entry.name) || "Reference", code: entry.code }))
      : wrapText(firstPromptLine(prompt, "Asset bindings:", "Asset bindings: screenplay context"), 96, 3).map((line) => ({ path: "", name: line, type: "Reference", code: "PT-000" }));
  return {
    title: asset.name,
    story: firstPromptLine(prompt, "Story beat:", firstPromptLine(prompt, "Story beats to visualize:", asset.name)).slice(0, 180),
    source: firstPromptLine(prompt, "Source shots:", "").slice(0, 160),
    panels,
    refs,
  };
}

function writeLocalStoryboardFallback(asset, outPath, size, referenceImages = []) {
  const [width, height] = String(size || "1280x720").split("x").map((item) => Number.parseInt(item, 10));
  const boardPayload = localStoryboardFallbackPrompt(asset, referenceImages);
  const py = String.raw`
import json, sys
from PIL import Image, ImageDraw, ImageFont

payload = json.loads(sys.stdin.read())
out = payload["out"]
w = int(payload["width"])
h = int(payload["height"])
img = Image.new("RGB", (w, h), (246, 242, 232))
draw = ImageDraw.Draw(img)

def font(size, bold=False):
    candidates = [
        "/System/Library/Fonts/STHeiti Medium.ttc" if bold else "/System/Library/Fonts/STHeiti Light.ttc",
        "/System/Library/Fonts/Hiragino Sans GB.ttc",
        "/System/Library/Fonts/Supplemental/Songti.ttc",
        "/System/Library/Fonts/Supplemental/Arial Unicode.ttf",
        "/System/Library/Fonts/Supplemental/Arial Bold.ttf" if bold else "/System/Library/Fonts/Supplemental/Arial.ttf",
    ]
    for p in candidates:
        try:
            return ImageFont.truetype(p, size)
        except Exception:
            pass
    return ImageFont.load_default()

caption_font = font(max(11, w // 54), True)

# 9:16 竖版板:整张就是固定 3×3 九格。每个外格保持竖版 9:16，禁止页眉、页脚或大建立镜头占用网格空间。
margin = 22
gap = 12
panels = payload.get("panels") or []
n_panels = len(panels)
n_panels = 9
cols = 3
rows = (n_panels + cols - 1) // cols
max_grid_w = w - margin * 2
max_grid_h = h - margin * 2
cell_w = min(
    (max_grid_w - gap * (cols - 1)) // cols,
    int(((max_grid_h - gap * (rows - 1)) / rows) * 9 / 16),
)
cell_w = max(40, cell_w)
cell_h = max(72, round(cell_w * 16 / 9))
grid_w = cell_w * cols + gap * (cols - 1)
grid_h = cell_h * rows + gap * (rows - 1)
grid_x = max(0, (w - grid_w) // 2)
grid_y = max(0, (h - grid_h) // 2)
refs = payload.get("refs") or []
role_codes = [r.get("code", "") for r in refs if isinstance(r, dict) and r.get("type") == "Character"][:3]
scene_codes = [r.get("code", "") for r in refs if isinstance(r, dict) and r.get("type") == "Scene"][:2]
prop_codes = [r.get("code", "") for r in refs if isinstance(r, dict) and r.get("type") not in ("Character", "Scene")][:3]

def contain_thumb(path, box):
    try:
        with Image.open(path) as source:
            src = source.convert("RGB")
            bw = max(1, box[2] - box[0])
            bh = max(1, box[3] - box[1])
            scale = min(bw / src.width, bh / src.height)
            nw, nh = max(1, round(src.width * scale)), max(1, round(src.height * scale))
            resample = getattr(Image, "Resampling", Image).LANCZOS
            src = src.resize((nw, nh), resample)
            tx = box[0] + (bw - nw) // 2
            ty = box[1] + (bh - nh) // 2
            draw.rectangle(box, fill=(248, 248, 244), outline=(60, 60, 60), width=1)
            img.paste(src, (tx, ty))
            return True
    except Exception:
        return False

def panel_text(panel):
    if isinstance(panel, dict):
        return str(panel.get("description") or panel.get("raw") or "")
    return str(panel or "")

def has_any(text, needles):
    low = str(text or "").lower()
    return any(str(n).lower() in low for n in needles)

def draw_floor(box, dense=False):
    x1, y1, x2, y2 = box
    horizon = y1 + int((y2 - y1) * 0.46)
    draw.line([x1 + 6, horizon, x2 - 6, horizon], fill=(72,72,72), width=1)
    for t in [0.18, 0.36, 0.5, 0.64, 0.82]:
        sx = x1 + int((x2 - x1) * t)
        draw.line([sx, horizon, x1 + int((x2 - x1) * (0.08 + t * 0.84)), y2 - 8], fill=(158,158,158), width=1)
    rows = 5 if dense else 3
    for j in range(rows):
        yy = horizon + int((y2 - horizon) * ((j + 1) / (rows + 1)) ** 1.35)
        draw.line([x1 + 4, yy, x2 - 4, yy], fill=(172,172,172), width=1)

def draw_architecture(box):
    x1, y1, x2, y2 = box
    for col in [0.16, 0.84]:
        cx = x1 + int((x2 - x1) * col)
        draw.rectangle([cx - 7, y1 + 12, cx + 7, y2 - 16], outline=(92,92,92), width=2)
        draw.line([cx - 13, y1 + 12, cx + 13, y1 + 12], fill=(92,92,92), width=2)
    draw.arc([x1 + 28, y1 + 12, x2 - 28, y1 + 74], 180, 360, fill=(105,105,105), width=2)

def draw_person(cx, cy, scale=1.0, code="", pose="stand", heavy=False):
    ink = (30,30,30)
    head_r = max(4, int(7 * scale))
    torso = int(30 * scale)
    if pose == "look_down":
        draw.ellipse([cx - head_r, cy - torso - head_r + 4, cx + head_r, cy - torso + head_r + 4], outline=ink, width=2)
        draw.line([cx, cy - torso + head_r + 4, cx + 4, cy - 4], fill=ink, width=2)
    else:
        draw.ellipse([cx - head_r, cy - torso - head_r, cx + head_r, cy - torso + head_r], outline=ink, width=2)
        draw.line([cx, cy - torso + head_r, cx, cy - 4], fill=ink, width=2)
    shoulder = int(13 * scale)
    if heavy:
        draw.line([cx - shoulder - 3, cy - torso + 15, cx + shoulder + 3, cy - torso + 15], fill=ink, width=4)
        draw.rectangle([cx - 9, cy - torso + 18, cx + 9, cy - 1], outline=ink, width=2)
    else:
        draw.line([cx - shoulder, cy - torso + 15, cx + shoulder, cy - torso + 15], fill=ink, width=2)
    if pose == "gesture":
        draw.line([cx + shoulder, cy - torso + 15, cx + shoulder + 13, cy - torso + 3], fill=ink, width=2)
        draw.line([cx - shoulder, cy - torso + 15, cx - shoulder - 8, cy - torso + 26], fill=ink, width=2)
    elif pose == "look_down":
        draw.line([cx + shoulder, cy - torso + 15, cx + 5, cy - torso + 30], fill=ink, width=2)
        draw.line([cx - shoulder, cy - torso + 15, cx - 5, cy - torso + 30], fill=ink, width=2)
    else:
        draw.line([cx + shoulder, cy - torso + 15, cx + shoulder + 7, cy - torso + 28], fill=ink, width=2)
        draw.line([cx - shoulder, cy - torso + 15, cx - shoulder - 7, cy - torso + 28], fill=ink, width=2)
    draw.line([cx, cy - 4, cx - int(10 * scale), cy + int(16 * scale)], fill=ink, width=2)
    draw.line([cx, cy - 4, cx + int(10 * scale), cy + int(16 * scale)], fill=ink, width=2)

def draw_guard(cx, cy, scale=1.0, code=""):
    ink = (24,24,24)
    hw = int(8 * scale)
    hh = int(10 * scale)
    draw.rounded_rectangle([cx - hw, cy - 52 * scale, cx + hw, cy - 32 * scale], radius=3, outline=ink, width=2)
    draw.line([cx - hw, cy - 42 * scale, cx + hw, cy - 42 * scale], fill=ink, width=1)
    draw.polygon([(cx - 18 * scale, cy - 28 * scale), (cx + 18 * scale, cy - 28 * scale), (cx + 11 * scale, cy + 3 * scale), (cx - 11 * scale, cy + 3 * scale)], outline=ink)
    draw.ellipse([cx - 4 * scale, cy - 18 * scale, cx + 4 * scale, cy - 10 * scale], outline=ink, width=2)
    draw.line([cx - 18 * scale, cy - 22 * scale, cx - 28 * scale, cy - 3 * scale], fill=ink, width=2)
    draw.line([cx + 18 * scale, cy - 22 * scale, cx + 27 * scale, cy - 2 * scale], fill=ink, width=2)
    draw.line([cx + 25 * scale, cy - 2 * scale, cx + 38 * scale, cy + 12 * scale], fill=ink, width=3)
    draw.line([cx - 5 * scale, cy + 2 * scale, cx - 14 * scale, cy + 26 * scale], fill=ink, width=2)
    draw.line([cx + 5 * scale, cy + 2 * scale, cx + 13 * scale, cy + 26 * scale], fill=ink, width=2)

def draw_crowd(box):
    x1, y1, x2, y2 = box
    base = y1 + int((y2 - y1) * 0.54)
    for idx, t in enumerate([0.12,0.22,0.34,0.49,0.64,0.78,0.9]):
        cx = x1 + int((x2 - x1) * t)
        r = 3 + (idx % 2)
        draw.ellipse([cx-r, base-r-11, cx+r, base-r-5], outline=(110,110,110), width=1)
        draw.line([cx, base-r-5, cx, base+12], fill=(110,110,110), width=1)

def draw_dragon_floor(box, emphasis=False):
    x1, y1, x2, y2 = box
    floor_top = y1 + int((y2 - y1) * 0.56)
    pts = []
    steps = 7
    for k in range(steps):
        px = x1 + int((x2 - x1) * (0.13 + 0.74 * k / (steps - 1)))
        py = floor_top + int((y2 - floor_top) * (0.62 + 0.22 * ((k % 2) - 0.5)))
        pts.append((px, py))
    draw.line(pts, fill=(22,22,22), width=3 if emphasis else 2, joint="curve")
    hx, hy = pts[-1]
    draw.line([hx, hy, hx + 10, hy - 8], fill=(22,22,22), width=2)
    draw.line([hx, hy, hx + 10, hy + 6], fill=(22,22,22), width=2)
    draw.line([hx - 8, hy - 3, hx - 16, hy - 13], fill=(22,22,22), width=1)
    draw.line([hx - 5, hy + 4, hx - 15, hy + 13], fill=(22,22,22), width=1)
    for px, py in pts[1:-1:2]:
        draw.arc([px - 15, py - 10, px + 15, py + 12], 210, 330, fill=(72,72,72), width=1)

def draw_insert_prop(box):
    x1, y1, x2, y2 = box
    cx = (x1 + x2) // 2
    cy = y1 + int((y2 - y1) * 0.62)
    draw.line([cx - 34, cy + 12, cx + 36, cy - 14], fill=(24,24,24), width=4)
    draw.rectangle([cx - 43, cy + 8, cx - 26, cy + 18], outline=(24,24,24), width=2)
    draw.line([cx + 28, cy - 12, cx + 45, cy - 24], fill=(24,24,24), width=2)
    draw.arc([cx - 52, cy - 32, cx + 52, cy + 32], 200, 340, fill=(92,92,92), width=1)

def panel_shot_kind(note, panel_index):
    if panel_index == 0:
        return "establish"
    if panel_index in (1, 2):
        return "wide"
    if panel_index == 3:
        return "over_shoulder"
    if panel_index == 4:
        return "low_angle"
    if panel_index == 5:
        return "closeup"
    if panel_index == 6:
        return "insert"
    if panel_index == 7:
        return "tracking"
    if has_any(note, ["insert", "close-up", "特写", "detail", "手", "脸", "胸口", "核心", "短棍", "刀"]):
        return "insert"
    return "cut"

def draw_story_wide(inner, note, panel_index, guard_scene=False):
    x1, y1, x2, y2 = inner
    draw_architecture(inner)
    draw_floor(inner, dense=has_any(note, ["地面", "floor", "纹路", "pattern", "大理石", "marble"]))
    base_y = y1 + int((y2 - y1) * 0.68)
    if has_any(note, ["人群", "crowd"]):
        draw_crowd(inner)
    if guard_scene:
        positions = [0.25, 0.42, 0.59, 0.76] if panel_index < 5 else [0.30, 0.45, 0.60, 0.75]
        for idx, t in enumerate(positions):
            draw_guard(x1 + int((x2 - x1) * t), base_y + (idx % 2) * 3, 0.54 + 0.04 * min(panel_index, 4), prop_codes[0] if idx == 0 and prop_codes else "")
    elif len(role_codes) >= 2:
        draw_person(x1 + int((x2 - x1) * (0.30 + 0.03 * (panel_index % 2))), base_y, 0.58, role_codes[0], "gesture" if panel_index in (3,4) else "stand")
        draw_person(x1 + int((x2 - x1) * (0.68 - 0.03 * (panel_index % 2))), base_y, 0.58, role_codes[1], "stand")
    elif role_codes:
        draw_person(x1 + int((x2 - x1) * (0.48 + 0.06 * ((panel_index % 3) - 1))), base_y, 0.64, role_codes[0], "look_down" if has_any(note, ["低头", "look down"]) else "stand")
    else:
        draw_person(x1 + int((x2 - x1) * 0.5), base_y, 0.62, "", "stand")

def draw_story_closeup(inner, note, panel_index):
    x1, y1, x2, y2 = inner
    cx = x1 + int((x2 - x1) * (0.50 if panel_index % 2 else 0.58))
    cy = y1 + int((y2 - y1) * 0.46)
    draw.ellipse([cx - 22, cy - 38, cx + 22, cy + 6], outline=(24,24,24), width=3)
    draw.line([cx - 12, cy + 7, cx - 26, y2 - 8], fill=(24,24,24), width=3)
    draw.line([cx + 12, cy + 7, cx + 26, y2 - 8], fill=(24,24,24), width=3)
    if has_any(note, ["低头", "look down", "地面", "纹路", "floor"]):
        draw.arc([cx - 18, cy - 21, cx + 18, cy + 4], 20, 160, fill=(24,24,24), width=1)
        draw.line([cx - 8, cy - 5, cx + 8, cy - 1], fill=(24,24,24), width=1)
        draw_dragon_floor([x1 + 8, y1 + int((y2-y1)*0.56), x2 - 8, y2 - 5], True)
    else:
        draw.line([cx - 9, cy - 14, cx + 9, cy - 14], fill=(24,24,24), width=1)
        draw.line([cx - 10, cy - 2, cx + 10, cy - 2], fill=(24,24,24), width=1)

def draw_story_insert(inner, note, panel_index):
    x1, y1, x2, y2 = inner
    if has_any(note, ["纹路", "地板", "地面", "大理石", "floor", "pattern"]):
        draw_floor(inner, dense=True)
        draw_dragon_floor(inner, True)
        draw.line([x1 + 18, y1 + 12, x2 - 18, y2 - 16], fill=(24,24,24), width=1)
    elif has_any(note, ["胸口", "核心", "装甲", "armor", "helmet", "头盔"]):
        cx = (x1 + x2) // 2
        draw.polygon([(cx - 34, y1 + 22), (cx + 34, y1 + 22), (cx + 22, y2 - 8), (cx - 22, y2 - 8)], outline=(24,24,24))
        draw.ellipse([cx - 10, y1 + 52, cx + 10, y1 + 72], outline=(24,24,24), width=3)
        draw.line([cx - 32, y1 + 38, cx + 32, y1 + 38], fill=(24,24,24), width=1)
    else:
        draw_insert_prop(inner)

def draw_story_over_shoulder(inner, note, panel_index, guard_scene=False):
    x1, y1, x2, y2 = inner
    draw_floor(inner, dense=False)
    draw.arc([x1 - 22, y1 + 14, x1 + 54, y2 + 18], 260, 82, fill=(24,24,24), width=5)
    if guard_scene:
        for idx, t in enumerate([0.48, 0.64, 0.79]):
            draw_guard(x1 + int((x2 - x1) * t), y1 + int((y2 - y1) * 0.72), 0.45, prop_codes[0] if idx == 0 and prop_codes else "")
    elif len(role_codes) >= 2:
        draw_person(x1 + int((x2 - x1) * 0.64), y1 + int((y2 - y1) * 0.72), 0.55, role_codes[1], "gesture")
    elif role_codes:
        draw_person(x1 + int((x2 - x1) * 0.64), y1 + int((y2 - y1) * 0.72), 0.55, role_codes[0], "gesture")

def draw_floor_pattern_sequence(inner, panel_index):
    x1, y1, x2, y2 = inner
    base_y = y1 + int((y2 - y1) * 0.70)
    if panel_index == 0:
        draw_architecture(inner)
        draw_floor(inner, dense=True)
        draw_person(x1 + int((x2 - x1) * 0.50), base_y - 4, 0.46, role_codes[0] if role_codes else "", "look_down")
        draw_dragon_floor([x1 + 10, y1 + int((y2-y1)*0.55), x2 - 10, y2 - 4], False)
    elif panel_index == 1:
        draw_architecture([x1 + 6, y1 + 4, x2 - 6, y2 - 4])
        draw_floor(inner, dense=True)
        draw_person(x1 + int((x2 - x1) * 0.50), base_y - 10, 0.72, role_codes[0] if role_codes else "", "look_down")
        draw_dragon_floor([x1 + 9, y1 + int((y2-y1)*0.58), x2 - 9, y2 - 4], True)
    elif panel_index == 2:
        # Top-down insert: feet and dragon markings dominate the frame.
        draw_floor(inner, dense=True)
        cx = (x1 + x2) // 2
        draw.rectangle([cx - 18, y1 + 20, cx - 4, y1 + 54], outline=(24,24,24), width=2)
        draw.rectangle([cx + 4, y1 + 20, cx + 18, y1 + 54], outline=(24,24,24), width=2)
        draw_dragon_floor([x1 + 6, y1 + 48, x2 - 6, y2 - 4], True)
    elif panel_index == 3:
        draw_floor(inner, dense=True)
        draw.arc([x1 - 26, y1 + 6, x1 + 70, y2 + 18], 260, 85, fill=(24,24,24), width=5)
        draw_dragon_floor([x1 + 20, y1 + int((y2-y1)*0.48), x2 - 4, y2 - 5], True)
    elif panel_index == 4:
        draw_architecture(inner)
        draw_floor(inner, dense=True)
        draw.line([x1 + 8, y2 - 8, x2 - 10, y1 + 34], fill=(80,80,80), width=1)
        draw_person(x1 + int((x2 - x1) * 0.56), base_y - 12, 0.70, role_codes[0] if role_codes else "", "look_down")
        draw_dragon_floor([x1 + 8, y1 + int((y2-y1)*0.58), x2 - 8, y2 - 4], True)
    elif panel_index == 5:
        draw_story_closeup(inner, "低头 reaction face looking down at floor pattern", panel_index)
    elif panel_index == 6:
        draw_story_insert(inner, "dragon floor pattern insert detail", panel_index)
    elif panel_index == 7:
        draw_floor(inner, dense=True)
        cx = x1 + int((x2 - x1) * 0.52)
        draw.line([cx - 18, y1 + 30, cx - 34, y2 - 10], fill=(24,24,24), width=3)
        draw.line([cx + 14, y1 + 32, cx + 28, y2 - 8], fill=(24,24,24), width=3)
        draw_dragon_floor([x1 + 8, y1 + int((y2-y1)*0.54), x2 - 8, y2 - 4], True)
    else:
        draw_floor(inner, dense=True)
        draw_dragon_floor([x1 + 6, y1 + int((y2-y1)*0.45), x2 - 6, y2 - 6], True)
        draw.rectangle([x1 + 16, y1 + 16, x2 - 16, y2 - 16], outline=(24,24,24), width=1)

def draw_guard_sequence(inner, panel_index):
    x1, y1, x2, y2 = inner
    base_y = y1 + int((y2 - y1) * 0.72)
    if panel_index == 0:
        draw_architecture(inner)
        draw_floor(inner, dense=False)
        draw_crowd(inner)
        for idx, t in enumerate([0.42, 0.55, 0.68]):
            draw_guard(x1 + int((x2 - x1) * t), base_y, 0.42, prop_codes[0] if idx == 0 and prop_codes else "")
    elif panel_index in (1, 2):
        draw_architecture(inner)
        draw_floor(inner, dense=False)
        positions = [0.22, 0.40, 0.58, 0.76]
        for idx, t in enumerate(positions):
            draw_guard(x1 + int((x2 - x1) * t), base_y + (idx % 2) * 4, 0.54 + panel_index * 0.04, prop_codes[0] if idx == 0 and prop_codes else "")
        draw.line([x1 + 16, y2 - 14, x2 - 12, y1 + 48], fill=(120,120,120), width=1)
    elif panel_index == 3:
        draw_story_over_shoulder(inner, "over shoulder guards enter", panel_index, True)
    elif panel_index == 4:
        draw_floor(inner, dense=False)
        draw_guard(x1 + int((x2 - x1) * 0.50), base_y + 4, 0.88, prop_codes[0] if prop_codes else "")
        draw.line([x1 + 8, y2 - 8, x2 - 9, y1 + 36], fill=(90,90,90), width=1)
    elif panel_index == 5:
        cx = (x1 + x2) // 2
        draw.rounded_rectangle([cx - 22, y1 + 12, cx + 22, y1 + 58], radius=6, outline=(24,24,24), width=3)
        draw.line([cx - 22, y1 + 36, cx + 22, y1 + 36], fill=(24,24,24), width=1)
        draw.polygon([(cx - 34, y1 + 64), (cx + 34, y1 + 64), (cx + 24, y2 - 8), (cx - 24, y2 - 8)], outline=(24,24,24))
        draw.ellipse([cx - 9, y1 + 82, cx + 9, y1 + 100], outline=(24,24,24), width=3)
    elif panel_index == 6:
        draw_story_insert(inner, "baton weapon insert detail", panel_index)
    elif panel_index == 7:
        draw_floor(inner, dense=False)
        for idx, t in enumerate([0.18, 0.38, 0.58, 0.78]):
            draw_guard(x1 + int((x2 - x1) * t), base_y - idx * 2, 0.55, prop_codes[0] if idx == 0 and prop_codes else "")
    else:
        draw_floor(inner, dense=False)
        for idx, t in enumerate([0.28, 0.44, 0.60, 0.76]):
            draw_guard(x1 + int((x2 - x1) * t), base_y, 0.42, prop_codes[0] if idx == 0 and prop_codes else "")

def draw_panel_story(frame_box, note, panel_index):
    x1, y1, x2, y2 = frame_box
    draw.rectangle(frame_box, fill=(255,255,250), outline=(34,34,34), width=2)
    inner = [x1 + 5, y1 + 5, x2 - 5, y2 - 5]
    shot = panel_shot_kind(note, panel_index)
    guard_scene = has_any(note, ["安保", "保镖", "security", "guard", "装甲", "armor", "头盔", "helmet"])
    floor_pattern_scene = has_any(note, ["龙形纹路", "纹路", "暗红", "血液", "地板", "地面", "大理石", "floor", "pattern"])
    if guard_scene:
        draw_guard_sequence(inner, panel_index)
    elif floor_pattern_scene:
        draw_floor_pattern_sequence(inner, panel_index)
    elif shot == "insert":
        draw_story_insert(inner, note, panel_index)
    elif shot == "closeup":
        draw_story_closeup(inner, note, panel_index)
    elif shot == "over_shoulder":
        draw_story_over_shoulder(inner, note, panel_index, guard_scene)
    elif shot == "low_angle":
        draw_story_wide(inner, note, panel_index, guard_scene)
        draw.line([x1 + 8, y2 - 10, x2 - 8, y1 + 46], fill=(92,92,92), width=1)
    else:
        draw_story_wide(inner, note, panel_index, guard_scene)
    if has_any(note, ["龙形纹路", "纹路", "暗红", "血液", "地板", "地面", "大理石", "floor", "pattern"]) and shot not in ("insert", "closeup"):
        draw_dragon_floor(inner, emphasis=panel_index >= 3)
for i in range(n_panels):
    r, c = divmod(i, cols)
    x = grid_x + c * (cell_w + gap)
    y = grid_y + r * (cell_h + gap)
    draw.rectangle([x, y, x + cell_w, y + cell_h], fill=(255, 255, 250), outline=(68, 68, 64), width=1)
    panel = panels[i] if i < len(panels) else {}
    note = panel_text(panel)
    draw_panel_story([x + 8, y + 8, x + cell_w - 8, y + cell_h - 8], note, i)
    label = str(panel.get("label") or f"P{i+1}") if isinstance(panel, dict) else f"P{i+1}"
    time_range = str(panel.get("timeRange") or "") if isinstance(panel, dict) else ""
    caption = f"{label}  {time_range}".strip()
    caption_h = max(24, caption_font.size + 12)
    caption_y = y + cell_h - caption_h - 8
    draw.rectangle([x + 8, caption_y, x + cell_w - 8, y + cell_h - 8], fill=(20, 22, 24))
    draw.text((x + 13, caption_y + max(4, (caption_h - caption_font.size) // 2 - 1)), caption, fill=(245, 246, 242), font=caption_font)
img.save(out)
`;
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  const inputPayload = JSON.stringify({ ...boardPayload, out: outPath, width: width || 1280, height: height || 720 });
  execFileSync("python3", ["-c", py], { input: inputPayload, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"], timeout: 60_000 });
  return JSON.stringify({ ok: true, mode: "local-storyboard-fallback", paths: [outPath] }, null, 2);
}

function rescueStoryboardPromptFor(asset, referenceImages = []) {
  const prompt = String(asset.prompt || "");
  const bindingNames = referenceImages.length
    ? referenceImages.map((image, index) => `R${index + 1}: ${path.basename(image)} (${referenceTypeFromName(image) || "reference"})`).join("; ")
    : firstPromptLine(prompt, "Asset bindings:", "Asset bindings: use the named official assets from this sequence.");
  return [
    "Generate one professional cinematic Production Board image.",
    "The board is a single 9:16 vertical (portrait) sheet — taller than it is wide — on warm off-white paper, full sheet visible, no cropping.",
    "Draw exactly 9 equal-size storyboard panels in a 3-column grid, read left-to-right then top-to-bottom (P1 top-left through P9 bottom-right). Every panel is a portrait 9:16 outer cell with equal outer dimensions and even gutters. P1 is an ordinary top-left cell, never a wide establishing strip; no panel may overlap, merge, or span multiple cells. Reserve the lower 40 percent of each cell as clean off-white paper for the deterministic Production Tab. The upper 60 percent is the cinematic vertical frame. The post-process will typeset P-number, duration, full plot/action, full dialogue, Visual / Camera / Shot / Lens / Lighting / Emotion, and visible reference thumbnails, so do not render your own letters, dialogue, tables, or technical notes.",
    "Each panel must be a distinct cinematic story frame, not repeated panels and not a UI wireframe: use the actual attached character, scene and prop identities with varied shot scales, camera angles, blocking, foreground/background staging, actor poses, eyelines, and cut points.",
    "Use a clean professional production-storyboard visual language with finished cinematic imagery, expressive performance and clear environmental continuity. Do not add colored technical diagrams or camera-frame overlays.",
    "Do NOT add a header, footer, metadata table, caption band outside a panel, ASSET REFERENCES strip, or reference boxes. The board contains ONLY the nine equal cinematic story panels with their reserved lower tab areas.",
    "Do not paste source images as thumbnails; integrate their actual identities naturally into the story action in every relevant panel.",
    firstPromptLine(prompt, "Time coverage:", ""),
    firstPromptLine(prompt, "Source shots:", ""),
    firstPromptLine(prompt, "Story beat:", firstPromptLine(prompt, "Story beats to visualize:", "")),
    `Reference bindings: ${bindingNames}`,
    "Panel plan:",
    compactStoryboardPanelLines(prompt) || "P1-P9: show chronological story beats with clear blocking, motion direction, and cut handoff.",
  ].filter(Boolean).join("\n");
}

function editPromptFor(asset, instruction, referenceImages = [], styleReferenceImage = "", options = {}) {
  const typeRule =
    asset.type === "Character"
      ? "Keep this as one 16:9 pure-white-background character identity-sheet image with the same single character across full-body front view, full-body side view, full-body back view, and one half-body close-up portrait."
      : asset.type === "Scene"
        ? "Keep this as one 16:9 wide establishing environment reference image with absolutely no people, no silhouettes, no crowds, and no human figures."
        : asset.type === "Storyboard"
        ? "Keep this as one 9:16 vertical Production Board made only of exactly 9 equal-size vertical 9:16 storyboard panels in a 3-column grid. P1 must remain an ordinary top-left cell; no panel may span rows or columns. Preserve the production-tab and visible-reference layout: the upper 60 percent of every cell is the cinematic frame and the lower 40 percent remains clean paper for deterministic typesetting of plot, dialogue, production fields and visible reference thumbnails. Do not render handwritten dialogue, technical glyphs, arrows, camera-frame overlays, or an extra asset strip."
          : asset.type === "Prop"
            ? "Keep this as one 16:9 pure-white-background prop turnaround reference sheet with the same single prop shown in front view, side view, and back view."
            : "Keep this as one 16:9 realistic cinematic insert or evidence-detail reference image with the main subject clear and physically believable.";
  return [
    "Image edit task: revise the provided existing asset image while preserving all parts that are already correct.",
    "Visible revision mandate: the requested change must be clearly visible in the final image at thumbnail size. Do not return a near-identical re-render. If the request changes armor, clothing, props, colors, silhouette, material, or held objects, make those edited regions visually obvious while keeping the production layout intact.",
    "Before/after delta requirement: identify the user's requested changed elements and actively alter those exact visible elements; preserve identity and format, not the old costume/prop state.",
    "Apply the user's revision request precisely. If the request is written in Chinese, interpret it accurately and implement it visually.",
    typeRule,
    "Do not change the asset identity, filename meaning, screenplay role, aspect ratio, or required production-reference format.",
    "Original asset prompt for context:",
    asset.prompt,
    referenceGuidanceFor(asset, referenceImages, "edit", options),
    styleReferenceGuidance(styleReferenceImage),
    "User revision request:",
    instruction,
  ].filter(Boolean).join("\n\n");
}

function promptHash(prompt) {
  return crypto.createHash("sha256").update(prompt).digest("hex").slice(0, 16);
}

function sleepAsync(ms) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(ms) || 0)));
}

function sleepSync(ms) {
  if (!ms || ms <= 0) return;
  try {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
  } catch {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      // Bounded synchronous CLI backoff.
    }
  }
}

function existingPromptHash(logsDir, asset) {
  const file = path.join(logsDir, `${asset.name}.prompt.json`);
  if (!fs.existsSync(file)) return "";
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")).promptHash || "";
  } catch {
    return "";
  }
}

function writePromptMeta(logsDir, asset, prompt, size, extra = {}) {
  fs.mkdirSync(logsDir, { recursive: true });
  fs.writeFileSync(
    path.join(logsDir, `${asset.name}.prompt.json`),
    `${JSON.stringify({
      name: asset.name,
      type: asset.type,
      size,
      promptHash: promptHash(prompt),
      updatedAt: new Date().toISOString(),
      assetStylePreset: process.env.PIXEL_TOYS_ASSET_STYLE_PRESET || "",
      assetStyleLabel: process.env.PIXEL_TOYS_ASSET_STYLE_LABEL || "",
      ...extra,
    }, null, 2)}\n`,
  );
}

function parseImageGenFailurePayload(message) {
  const text = String(message || "");
  const braceAt = text.indexOf("{");
  if (braceAt < 0) return null;
  try {
    return JSON.parse(text.slice(braceAt));
  } catch {
    return null;
  }
}

function isTransientImageGenFailure(message) {
  const payload = parseImageGenFailurePayload(message);
  const status = Number(payload?.detail?.status) || 0;
  const body = typeof payload?.detail?.body === "string" ? payload.detail.body : "";
  const detailMessage = payload?.detail?.message || payload?.detail?.event?.error?.message || "";
  const haystack = `${payload?.code || ""} ${payload?.message || ""} ${detailMessage} ${body} ${message}`.toLowerCase();
  return (
    [429, 500, 502, 503, 504, 522, 523, 524].includes(status) ||
    /api_stream_error|unexpected eof|no_image_result|stream|did not return image|request_timeout|network_error|rate.?limit|too many request|service temporarily unavailable|timeout|timed out|cloudflare|524|源站|超时|限流|流结束|流式|没有收到图片/.test(haystack)
  );
}

function imageGenErrorDetail(error) {
  const stdout = error.stdout ? String(error.stdout).trim() : "";
  const stderr = error.stderr ? String(error.stderr).trim() : "";
  return [stdout, stderr].filter(Boolean).join("\n") || error.message || String(error);
}

function boundedTimeoutSeconds(value, fallback) {
  const parsed = Number.parseInt(String(value || ""), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.max(30, Math.min(parsed, 900));
}

function timeoutSecondsFor(asset, stage = "primary") {
  if (asset?.type === "Storyboard") {
    return stage === "rescue"
      ? boundedTimeoutSeconds(STORYBOARD_RESCUE_TIMEOUT_SECONDS, 120)
      : boundedTimeoutSeconds(STORYBOARD_IMAGE_TIMEOUT_SECONDS, 120);
  }
  return boundedTimeoutSeconds(DEFAULT_IMAGE_TIMEOUT_SECONDS, 900);
}

function execTimeoutMsFor(seconds) {
  return (boundedTimeoutSeconds(seconds, 900) + 20) * 1000;
}

function boundedRetryCount(value, fallback) {
  const parsed = Number.parseInt(String(value || ""), 10);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return Math.max(0, Math.min(parsed, 4));
}

function isMissingPillowError(error) {
  const text = `${error?.stderr || ""}\n${error?.message || ""}\n${error || ""}`;
  return /ModuleNotFoundError:\s*No module named ['"]PIL['"]|No module named ['"]PIL['"]/i.test(text);
}

function optionalStoryboardPostprocess(label, action) {
  try {
    action();
    return true;
  } catch (error) {
    if (!isMissingPillowError(error)) throw error;
    console.warn(`${new Date().toISOString()} skipped storyboard post-process (${label}): Python Pillow is not installed; keeping generated image.`);
    return false;
  }
}

function ensureStoryboardCanvas(asset, outPath, size) {
  if (asset?.type !== "Storyboard" || !fs.existsSync(outPath)) return;
  const [width, height] = String(size || "1280x720").split("x").map((item) => Number.parseInt(item, 10));
  if (!width || !height) return;
  const py = String.raw`
import sys
from PIL import Image

path = sys.argv[1]
target_w = int(sys.argv[2])
target_h = int(sys.argv[3])
with Image.open(path) as source:
    img = source.convert("RGB")
    if img.size == (target_w, target_h):
        sys.exit(0)
    scale = min(target_w / img.width, target_h / img.height)
    new_w = max(1, round(img.width * scale))
    new_h = max(1, round(img.height * scale))
    resample = getattr(Image, "Resampling", Image).LANCZOS
    fitted = img.resize((new_w, new_h), resample)
    canvas = Image.new("RGB", (target_w, target_h), (246, 242, 232))
    canvas.paste(fitted, ((target_w - new_w) // 2, (target_h - new_h) // 2))
    canvas.save(path)
`;
  optionalStoryboardPostprocess("canvas fit", () => {
    execFileSync("python3", ["-c", py, outPath, String(width), String(height)], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 60_000 });
  });
}

function storyboardVisibleReferences(asset, referenceImages = []) {
  const codes = new Map(assetBindingEntries(asset?.prompt).map((entry) => [entry.name, entry.code]));
  return [...new Set(referenceImages || [])]
    .filter((image) => fs.existsSync(image) && fs.statSync(image).size > 100)
    .map((image) => {
      const name = referenceAssetName(image);
      const type = referenceTypeFromName(image) || "Reference";
      return { path: image, name, type, code: codes.get(name) || refCodeForName(name, type) };
    })
    .slice(0, 4);
}

function stampStoryboardProductionTabs(asset, outPath, referenceImages = []) {
  if (asset?.type !== "Storyboard" || !fs.existsSync(outPath)) return;
  const panels = storyboardPanelObjects(asset.prompt).slice(0, 9);
  if (!panels.length) return;
  const references = storyboardVisibleReferences(asset, referenceImages);
  const py = String.raw`
import json, sys
from PIL import Image, ImageDraw, ImageFont

path = sys.argv[1]
payload = json.loads(sys.stdin.read())
panels = payload.get("panels") or []
references = payload.get("references") or []

def font(size, bold=False):
    candidates = [
        "/System/Library/Fonts/STHeiti Medium.ttc" if bold else "/System/Library/Fonts/STHeiti Light.ttc",
        "/System/Library/Fonts/Hiragino Sans GB.ttc",
        "/System/Library/Fonts/Supplemental/Songti.ttc",
        "/System/Library/Fonts/Supplemental/Arial Bold.ttf" if bold else "/System/Library/Fonts/Supplemental/Arial.ttf",
    ]
    for candidate in candidates:
        try:
            return ImageFont.truetype(candidate, size)
        except Exception:
            pass
    return ImageFont.load_default()

with Image.open(path) as source:
    img = source.convert("RGB")
w, h = img.size
draw = ImageDraw.Draw(img)
margin = max(12, round(w * 0.03))
gap = max(6, round(w * 0.0165))
cols, rows = 3, 3
max_grid_w = w - margin * 2
max_grid_h = h - margin * 2
cell_w = min(
    (max_grid_w - gap * (cols - 1)) // cols,
    int(((max_grid_h - gap * (rows - 1)) / rows) * 9 / 16),
)
cell_w = max(40, cell_w)
cell_h = max(72, round(cell_w * 16 / 9))
grid_w = cell_w * cols + gap * (cols - 1)
grid_h = cell_h * rows + gap * (rows - 1)
grid_x = max(0, (w - grid_w) // 2)
grid_y = max(0, (h - grid_h) // 2)

def text_lines(value, active_font, width):
    text = str(value or "-").replace("\\n", " ").strip()
    if not text:
        return ["-"]
    lines = []
    current = ""
    for char in text:
        candidate = current + char
        if current and draw.textlength(candidate, font=active_font) > width:
            lines.append(current)
            current = char
        else:
            current = candidate
    if current:
        lines.append(current)
    return lines or ["-"]

def brief_visual(value):
    text = str(value or "-").strip()
    if ": " in text:
        text = text.rsplit(": ", 1)[-1]
    return text or "-"

def brief_dialogue(value):
    text = str(value or "-").strip()
    if text.lower().startswith("dialogue:"):
        text = text.split(":", 1)[1].strip()
    return text or "-"

def compact_camera(value):
    text = str(value or "").lower()
    if "track" in text: return "TRACK"
    if "dolly" in text: return "DOLLY"
    if "push" in text: return "PUSH-IN"
    if "hold" in text: return "HOLD"
    if "lock" in text or "static" in text: return "LOCKED"
    return "COMPOSED"

def compact_shot(value):
    text = str(value or "").lower()
    if "extreme wide" in text: return "XWS"
    if "medium-wide" in text: return "MWS"
    if "medium-close" in text: return "MCU"
    if "close" in text: return "CU"
    if "wide" in text: return "WS"
    if "detail" in text: return "DETAIL"
    if "medium" in text: return "MS"
    return "FRAME"

def compact_lens(value):
    import re
    match = re.search(r"\d+mm", str(value or ""), re.I)
    return match.group(0).upper() if match else "LENS"

def compact_light(value):
    text = str(value or "").lower()
    if "contrast" in text: return "CONTRAST"
    if "direction" in text: return "DIRECTIONAL"
    if "key" in text: return "KEY LIGHT"
    if "preserve" in text: return "CONTINUITY"
    return "MOTIVATED"

def production_sections(panel):
    return [
        ("VISUAL / ACTION", brief_visual(panel.get("visual") or panel.get("description"))),
        ("DIALOGUE", brief_dialogue(panel.get("dialogue"))),
        ("CAMERA / SHOT", "%s / %s" % (compact_camera(panel.get("camera")), compact_shot(panel.get("shot")))),
        ("LENS / LIGHT / EMOTION", "%s / %s / %s" % (compact_lens(panel.get("lens")), compact_light(panel.get("lighting")), str(panel.get("emotion") or "-").split("/")[0].strip())),
    ]

def fit_production_copy(sections, max_width, max_height, preferred):
    for size in range(preferred, 5, -1):
        active_font = font(size)
        leading = max(size + 2, int(size * 1.28))
        lines = []
        for label, value in sections:
            lines.extend(text_lines(label + ": " + value, active_font, max_width))
        if len(lines) * leading <= max_height:
            return active_font, leading, lines
    active_font = font(5)
    leading = 7
    lines = []
    for label, value in sections:
        lines.extend(text_lines(label + ": " + value, active_font, max_width))
    return active_font, leading, lines

def draw_reference_thumb(reference, box):
    x1, y1, x2, y2 = box
    draw.rectangle(box, fill=(235, 232, 223), outline=(100, 96, 88), width=1)
    source_path = str(reference.get("path") or "")
    try:
        with Image.open(source_path) as source:
            thumb = source.convert("RGB")
            scale = min((x2 - x1) / thumb.width, (y2 - y1) / thumb.height)
            tw = max(1, round(thumb.width * scale))
            th = max(1, round(thumb.height * scale))
            resample = getattr(Image, "Resampling", Image).LANCZOS
            thumb = thumb.resize((tw, th), resample)
            img.paste(thumb, (x1 + ((x2 - x1) - tw) // 2, y1 + ((y2 - y1) - th) // 2))
    except Exception:
        pass
    draw.rectangle(box, outline=(100, 96, 88), width=1)

def compact_time_range(value):
    raw = str(value or "").strip()
    import re
    values = re.findall(r"\d+(?:\.\d+)?", raw)
    if len(values) >= 2:
        try:
            return "%g-%gs" % (round(float(values[0]), 1), round(float(values[1]), 1))
        except Exception:
            pass
    return raw[:18]

for i in range(9):
    row, col = divmod(i, cols)
    panel = panels[i] if i < len(panels) else {"label": f"P{i+1}"}
    x = grid_x + col * (cell_w + gap)
    y = grid_y + row * (cell_h + gap)
    label = str(panel.get("label") or f"P{i+1}")
    time_range = compact_time_range(panel.get("timeRange") or "")
    tab_h = max(86, round(cell_h * 0.40))
    tab_y = y + cell_h - tab_h
    header_h = max(20, round(tab_h * 0.16))
    pad = max(5, round(cell_w * 0.04))
    draw.rectangle([x + 1, tab_y, x + cell_w - 1, y + cell_h - 1], fill=(244, 241, 233), outline=(40, 40, 38), width=1)
    draw.rectangle([x + 1, tab_y, x + cell_w - 1, tab_y + header_h], fill=(27, 29, 30))
    title_font = font(max(8, min(16, cell_w // 17)), True)
    draw.text((x + pad, tab_y + max(3, (header_h - title_font.size) // 2 - 1)), "PRODUCTION TAB", fill=(248, 247, 242), font=title_font)
    stamp = (label + "  " + time_range).strip()
    stamp_w = draw.textlength(stamp, font=title_font)
    draw.text((x + cell_w - pad - stamp_w, tab_y + max(3, (header_h - title_font.size) // 2 - 1)), stamp, fill=(248, 247, 242), font=title_font)

    ref_h = max(16, min(36, round(tab_h * 0.19))) if references else 0
    copy_y = tab_y + header_h + pad
    copy_h = max(24, tab_h - header_h - pad * 3 - ref_h)
    sections = production_sections(panel)
    body_font, leading, lines = fit_production_copy(sections, cell_w - pad * 2, copy_h, max(8, min(16, cell_w // 19)))
    for line in lines:
        if copy_y + leading > tab_y + header_h + pad + copy_h:
            break
        draw.text((x + pad, copy_y), line, fill=(27, 29, 30), font=body_font)
        copy_y += leading

    if references:
        thumb_gap = max(3, pad // 2)
        visible = references[:min(4, len(references))]
        thumb_w = max(18, (cell_w - pad * 2 - thumb_gap * (len(visible) - 1)) // len(visible))
        thumb_y = y + cell_h - ref_h - pad
        for ref_index, reference in enumerate(visible):
            thumb_x = x + pad + ref_index * (thumb_w + thumb_gap)
            draw_reference_thumb(reference, [thumb_x, thumb_y, thumb_x + thumb_w, thumb_y + ref_h])
            code = str(reference.get("code") or reference.get("type") or "REF")
            code_font = font(max(5, min(9, thumb_w // 8)), True)
            draw.rectangle([thumb_x, thumb_y, thumb_x + thumb_w, thumb_y + code_font.size + 3], fill=(27, 29, 30))
            draw.text((thumb_x + 2, thumb_y + 1), code, fill=(248, 247, 242), font=code_font)
img.save(path)
`;
  optionalStoryboardPostprocess("panel annotations", () => {
    execFileSync("python3", ["-c", py, outPath], {
      input: JSON.stringify({ panels, references }),
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 60_000,
    });
  });
}

async function runImageGenWithRetry(imageArgs, env, label, maxRetries = 0, execTimeoutMs = 1000 * 1000) {
  let lastError;
  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    try {
      const { stdout } = await execFileAsync("node", imageArgs, { encoding: "utf8", timeout: execTimeoutMs, maxBuffer: 64 * 1024 * 1024, env });
      return stdout;
    } catch (error) {
      lastError = error;
      const detail = imageGenErrorDetail(error);
      if (attempt >= maxRetries || !isTransientImageGenFailure(detail)) break;
      const delay = 12_000 * (attempt + 1);
      console.error(`${new Date().toISOString()} ${label}: transient image-gen failure, retrying in ${Math.round(delay / 1000)}s`);
      await sleepAsync(delay);
    }
  }
  throw lastError;
}

// 故事板/Production Board 走竖版 9:16（3×3 九格需要整板为竖版；把传入的
// 16:9 尺寸按像素数换成 9:16 竖版，例如 1280x720 -> 720x1280）。
function storyboardPortraitSize(size) {
  const m = String(size || "1280x720").match(/^(\d+)x(\d+)$/);
  if (!m) return "720x1280";
  const w = Number(m[1]);
  const h = Number(m[2]);
  return w > h ? `${h}x${w}` : `${w}x${h}`;
}

async function runStoryboardReferenceBoardRoute(asset, outPath, size, referenceImages, env, logsDir, originalDetail = "") {
  if (asset?.type === "Storyboard") size = storyboardPortraitSize(size);
  const board = storyboardReferenceContactSheet(asset, referenceImages, logsDir);
  const prompt = [
    referencePromptFor(asset, referenceImages),
    "",
    "The input image is a PRODUCTION ASSET REFERENCE BOARD, not the final storyboard.",
    "Transform it into the requested 9:16 Production Board sheet with exactly 9 story panels in a 3-column grid. Use the input only to retain identity; do not reproduce its asset strip, thumbnails, labels, PT codes, arrows, or camera-frame overlays in the final board.",
  ].join("\n");
  const timeout = timeoutSecondsFor(asset, "rescue");
  const editArgs = [
    IMAGE_GEN,
    "--mode",
    "edit",
    "--image",
    board,
    "--prompt",
    prompt,
    "--size",
    size,
    "--model",
    IMAGE_GEN_IMAGE_MODEL,
    "--out",
    outPath,
    "--timeout",
    String(timeout),
  ];
  try {
    return (await runImageGenWithRetry(
      editArgs,
      env,
      `${asset.name} reference-board image-gen route`,
      0,
      execTimeoutMsFor(timeout),
    )).trim();
  } catch (error) {
    const detail = imageGenErrorDetail(error);
    throw new Error(`${asset.name} image-gen reference route failed, and reference-board image-gen route also failed${detail ? `:\n${detail}` : ""}${originalDetail ? `\n\nOriginal reference route failure:\n${originalDetail}` : ""}`);
  }
}

async function runOne(asset, outPath, size, referenceImages = [], logsDir = os.tmpdir(), styleReferenceImage = "", options = {}) {
  if (asset?.type === "Storyboard") size = storyboardPortraitSize(size);
  for (const referenceImage of [...referenceImages, styleReferenceImage].filter(Boolean)) {
    if (!fs.existsSync(referenceImage) || fs.statSync(referenceImage).size < 1000) {
      throw new Error(`${asset.name} reference image does not exist or is empty: ${referenceImage}`);
    }
  }
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  const prompt = referencePromptFor(asset, referenceImages, styleReferenceImage);
  const env = { ...process.env };
  if (!env.OPENAI_API_KEY) {
    const fallbackName = IMAGE_API_KEY_ENV_NAMES.find((name) => env[name]);
    if (fallbackName) env.OPENAI_API_KEY = env[fallbackName];
  }
  try {
    const primaryTimeoutSeconds = timeoutSecondsFor(asset, "primary");
    const imageInputs = [...(styleReferenceImage ? [styleReferenceImage] : []), ...referenceImages];
    const primaryIsHiddenSceneReference = !styleReferenceImage && options.hiddenSceneReferences instanceof Set && options.hiddenSceneReferences.has(imageInputs[0]);
    const imageArgs = imageInputs.length
      ? [
          IMAGE_GEN,
          "--mode",
          "image",
          "--image",
          imageInputs[0],
          "--prompt",
          prompt,
          "--size",
          size,
          "--model",
          IMAGE_GEN_ORCHESTRATION_MODEL,
          "--image-model",
          IMAGE_GEN_IMAGE_MODEL,
          "--out",
          outPath,
          "--timeout",
          String(primaryTimeoutSeconds),
          "--reference-first",
          "true",
          "--image-role",
          styleReferenceImage ? styleReferenceRole() : primaryImageRoleFor(asset, "generate", { hiddenSceneReference: primaryIsHiddenSceneReference }),
        ]
      : [IMAGE_GEN, "--mode", "text", "--prompt", prompt, "--size", size, "--model", IMAGE_GEN_IMAGE_MODEL, "--out", outPath, "--timeout", String(primaryTimeoutSeconds)];
    const extraImages = imageInputs.slice(1);
    if (extraImages.length) {
      const extraRoles = [
        ...(styleReferenceImage && referenceImages.length ? [referenceRoleFor(asset, "generate")] : []),
        ...(!styleReferenceImage && referenceImages.length > 1 ? [referenceRoleFor(asset, "generate")] : []),
      ];
      const extraHidden = options.hiddenSceneReferences instanceof Set && extraImages.some((image) => options.hiddenSceneReferences.has(image));
      imageArgs.push("--reference-image", extraImages.join(path.delimiter), "--reference-role", extraRoles[0] || referenceRoleFor(asset, "generate", { hiddenSceneReference: extraHidden }));
    }
    const output = await runImageGenWithRetry(
      imageArgs,
      env,
      asset.name,
      asset.type === "Storyboard"
        ? boundedRetryCount(STORYBOARD_IMAGE_RETRIES, 1)
        : boundedRetryCount(DEFAULT_IMAGE_RETRIES, 2),
      execTimeoutMsFor(primaryTimeoutSeconds),
    );
    return output.trim();
  } catch (error) {
    const stdout = error.stdout ? String(error.stdout).trim() : "";
    const stderr = error.stderr ? String(error.stderr).trim() : "";
    const detail = [stdout, stderr].filter(Boolean).join("\n");
    if (asset.type === "Storyboard" && referenceImages.length && shouldFallbackStoryboardToText(detail || error.message)) {
      console.error(`${new Date().toISOString()} ${asset.name}: reference-image route unavailable; trying reference-board image-gen route`);
      return await runStoryboardReferenceBoardRoute(asset, outPath, size, referenceImages, env, logsDir, detail || error.message);
    }
    throw new Error(`${asset.name} image-gen failed${detail ? `:\n${detail}` : `: ${error.message}`}`);
  }
}

async function runEdit(asset, outPath, size, editInstruction, logsDir, referenceImages = [], styleReferenceImage = "", options = {}) {
  if (!fs.existsSync(outPath) || fs.statSync(outPath).size < 1000) {
    throw new Error(`${asset.name} cannot be edited because the current image does not exist: ${outPath}`);
  }
  for (const referenceImage of [...referenceImages, styleReferenceImage].filter(Boolean)) {
    if (!fs.existsSync(referenceImage) || fs.statSync(referenceImage).size < 1000) {
      throw new Error(`${asset.name} reference image does not exist or is empty: ${referenceImage}`);
    }
  }
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.mkdirSync(logsDir, { recursive: true });
  const prompt = editPromptFor(asset, editInstruction, referenceImages, styleReferenceImage, options);
  const tmpOut = path.join(logsDir, `${asset.name}.edit-${Date.now()}.png`);
  const env = { ...process.env };
  if (!env.OPENAI_API_KEY) {
    const fallbackName = IMAGE_API_KEY_ENV_NAMES.find((name) => env[name]);
    if (fallbackName) env.OPENAI_API_KEY = env[fallbackName];
  }
  const detailsFromError = (error) => {
    const stdout = error.stdout ? String(error.stdout).trim() : "";
    const stderr = error.stderr ? String(error.stderr).trim() : "";
    return [stdout, stderr].filter(Boolean).join("\n");
  };
  const shouldFallbackToImageMode = (error) => {
    if (referenceImages.length || styleReferenceImage) return false;
    const detail = detailsFromError(error);
    return /(no_image_result|stream|did not return image|流结束|没有收到图片结果|流式响应)/i.test(detail);
  };
  try {
    const primaryTimeoutSeconds = timeoutSecondsFor(asset, "primary");
    const extraReferenceImages = [...(styleReferenceImage ? [styleReferenceImage] : []), ...referenceImages];
    const extraReferenceRoles = [
      ...(styleReferenceImage ? [styleReferenceRole()] : []),
      ...referenceImages.map((image) => referenceRoleFor(asset, "edit", {
        hiddenSceneReference: options.hiddenSceneReferences instanceof Set && options.hiddenSceneReferences.has(image),
      })),
    ];
    const imageArgs = extraReferenceImages.length
      ? [
          IMAGE_GEN,
          "--mode",
          "image",
          "--image",
          outPath,
          "--prompt",
          prompt,
          "--size",
          size,
          "--model",
          IMAGE_GEN_ORCHESTRATION_MODEL,
          "--image-model",
          IMAGE_GEN_IMAGE_MODEL,
          "--out",
          tmpOut,
          "--timeout",
          String(primaryTimeoutSeconds),
          "--reference-image",
          extraReferenceImages.join(path.delimiter),
          "--reference-first",
          "true",
          "--image-role",
          targetImageRoleFor(asset, "edit"),
        ]
      : [IMAGE_GEN, "--mode", "edit", "--image", outPath, "--prompt", prompt, "--size", size, "--model", IMAGE_GEN_IMAGE_MODEL, "--out", tmpOut, "--timeout", String(primaryTimeoutSeconds)];
    for (const role of extraReferenceRoles) {
      imageArgs.push("--reference-role", role);
    }
    let mode = extraReferenceImages.length ? "image-edit-with-references" : "edit";
    let output;
    try {
      output = await runImageGenWithRetry(
        imageArgs,
        env,
        `${asset.name} edit`,
        boundedRetryCount(asset.type === "Storyboard" ? STORYBOARD_IMAGE_RETRIES : DEFAULT_IMAGE_RETRIES, asset.type === "Storyboard" ? 1 : 2),
        execTimeoutMsFor(primaryTimeoutSeconds),
      );
    } catch (error) {
      if (!shouldFallbackToImageMode(error)) throw error;
      const fallbackArgs = [IMAGE_GEN, "--mode", "image", "--image", outPath, "--prompt", prompt, "--size", size, "--model", IMAGE_GEN_ORCHESTRATION_MODEL, "--image-model", IMAGE_GEN_IMAGE_MODEL, "--out", tmpOut, "--timeout", String(primaryTimeoutSeconds)];
      output = await runImageGenWithRetry(
        fallbackArgs,
        env,
        `${asset.name} edit fallback`,
        boundedRetryCount(asset.type === "Storyboard" ? STORYBOARD_IMAGE_RETRIES : DEFAULT_IMAGE_RETRIES, asset.type === "Storyboard" ? 1 : 2),
        execTimeoutMsFor(primaryTimeoutSeconds),
      );
      mode = "image-fallback-after-edit-stream-failure";
    }
    fs.renameSync(tmpOut, outPath);
    return { raw: output.trim(), prompt, mode };
  } catch (error) {
    if (fs.existsSync(tmpOut)) fs.rmSync(tmpOut, { force: true });
    const detail = detailsFromError(error);
    throw new Error(`${asset.name} image edit failed${detail ? `:\n${detail}` : `: ${error.message}`}`);
  }
}

function shouldAbortBatchAfterFailure(message) {
  const payload = parseImageGenFailurePayload(message);
  const status = Number(payload?.detail?.status) || 0;
  const body = typeof payload?.detail?.body === "string" ? payload.detail.body : "";
  const haystack = `${payload?.code || ""} ${payload?.message || ""} ${body} ${message}`.toLowerCase();
  return (
    status === 401 ||
    status === 403 ||
    status === 429 ||
    status === 500 ||
    status === 502 ||
    status === 503 ||
    status === 504 ||
    status === 522 ||
    status === 523 ||
    status === 524 ||
    /unauthor|invalid.*key|forbidden|rate.?limit|too many request|service temporarily unavailable|no available account|no available channel|request_timeout|network_error|timeout|timed out|cloudflare|鉴权|密钥|未授权|限流|无可用账号|无可用渠道|超时/.test(haystack)
  );
}

function shouldFallbackStoryboardToText(message) {
  const payload = parseImageGenFailurePayload(message);
  const status = Number(payload?.detail?.status) || 0;
  const body = typeof payload?.detail?.body === "string" ? payload.detail.body : "";
  const haystack = `${payload?.code || ""} ${payload?.message || ""} ${body} ${message}`.toLowerCase();
  return (
    status === 500 ||
    status === 502 ||
    status === 503 ||
    status === 504 ||
    status === 522 ||
    status === 523 ||
    status === 524 ||
    /no_image_result|stream|did not return image|service temporarily unavailable|no available account|no available channel|responses|api_http_error|request_timeout|network_error|timeout|timed out|cloudflare|无可用账号|无可用渠道|超时|流结束|没有收到图片/.test(haystack)
  );
}

async function main() {
  const args = parseArgs(process.argv);
  if (!fs.existsSync(args.promptsPath)) throw new Error(`missing asset prompts: ${args.promptsPath}`);
  if (!fs.existsSync(IMAGE_GEN)) throw new Error(`missing image-gen script: ${IMAGE_GEN}; checked: ${IMAGE_GEN_CANDIDATES.join(", ")}`);
  console.log(`${new Date().toISOString()} using APIKEY.FUN image-gen skill: ${IMAGE_GEN_SKILL_URL}`);
  console.log(`${new Date().toISOString()} image-gen script: ${IMAGE_GEN}`);
  const markdown = fs.readFileSync(args.promptsPath, "utf8");
  let assets = parseAssets(markdown);
  if (!assets.length) throw new Error("no asset prompts found");
  if (args.assetName) {
    assets = assets.filter((asset) => asset.name === args.assetName);
    if (!assets.length) throw new Error(`asset not found in prompts: ${args.assetName}`);
  }
  const requiresRemoteImageGen = assets.some((asset) => ["Character", "Scene", "Prop", "Insert", "Storyboard"].includes(asset.type));
  if (!args.dryRun && requiresRemoteImageGen && !IMAGE_API_KEY_ENV_NAMES.some((name) => process.env[name])) {
    throw new Error("missing OPENAI_API_KEY for api.apikey.fun image generation");
  }
  console.log(`${new Date().toISOString()} generation order: characters first, scenes second, props/inserts last`);
  if (args.assetName) console.log(`${new Date().toISOString()} selected asset: ${args.assetName}`);
  if (args.force) console.log(`${new Date().toISOString()} force regenerate enabled`);
  if (args.editInstruction) console.log(`${new Date().toISOString()} targeted image edit enabled`);
  if (args.referenceImages.length) console.log(`${new Date().toISOString()} reference images: ${args.referenceImages.map((item) => path.basename(item)).join(", ")}`);
  if (args.styleReferenceImage) console.log(`${new Date().toISOString()} style reference image: ${path.basename(args.styleReferenceImage)}`);
  const assetReferenceMap = readAssetReferenceMap(args.assetReferenceMap);
  if (assetReferenceMap.size) console.log(`${new Date().toISOString()} hidden per-asset references enabled: ${assetReferenceMap.size} assets`);
  const counts = typeCounts(assets);
  console.log(
    `${new Date().toISOString()} planned assets: ${counts.Character || 0} characters, ${counts.Scene || 0} scenes, ${counts.Prop || 0} props, ${counts.Insert || 0} inserts, ${counts.Storyboard || 0} storyboards`,
  );
  const logsDir = path.join(args.episodeRoot, "04_assets", "generation_logs");
  if (!args.dryRun) fs.mkdirSync(logsDir, { recursive: true });
  const results = [];
  let aborted = false;
  const effectiveConcurrency = args.assetName || args.editInstruction ? 1 : Math.max(1, Number(args.concurrency) || 1);
  if (effectiveConcurrency > 1) {
    console.log(`${new Date().toISOString()} image generation concurrency: ${effectiveConcurrency}`);
  }
  async function processAsset(asset) {
    if (aborted) return;
    const out = outputPath(args.episodeRoot, asset);
    const prompt = promptFor(asset);
    const assetReferenceImages = [
      ...mappedReferenceImagesForAsset(asset, assetReferenceMap),
      ...referenceImagesForAsset(asset, args.referenceImages),
    ];
    const hiddenSceneReferences = new Set(assetReferenceImages.filter((image) => isHiddenSceneReference(asset, image, assetReferenceMap)));
    const baseEffectivePrompt = args.editInstruction
      ? editPromptFor(asset, args.editInstruction, assetReferenceImages, args.styleReferenceImage, { hiddenSceneReferences })
      : referencePromptFor(asset, assetReferenceImages, args.styleReferenceImage, { hiddenSceneReferences });
    const effectivePrompt = asset.type === "Storyboard"
      ? `${baseEffectivePrompt}\n\nStoryboard renderer: ${STORYBOARD_RENDERER_VERSION}`
      : baseEffectivePrompt;
    const currentHash = promptHash(effectivePrompt);
    const oldHash = existingPromptHash(logsDir, asset);
    const canReuse = !args.editInstruction && !args.force && fs.existsSync(out) && fs.statSync(out).size > 1000 && oldHash && oldHash === currentHash;
    if (canReuse) {
      console.log(`${new Date().toISOString()} skipping existing ${asset.name} -> ${out}`);
      results.push({ name: asset.name, skipped: true, reason: "exists", out });
      return;
    }
    if (args.dryRun) {
      results.push({
        name: asset.name,
        type: asset.type,
        size: args.size,
        out,
        force: args.force,
        edit: !!args.editInstruction,
        referenceImages: assetReferenceImages.map((item) => path.basename(item)),
        hiddenSceneReferenceMode: hiddenSceneReferences.size ? "color-grade-only" : "",
        styleReferenceImage: args.styleReferenceImage ? path.basename(args.styleReferenceImage) : "",
        sourceExists: fs.existsSync(out),
        wouldRegenerate: args.force || !!args.editInstruction || (fs.existsSync(out) && oldHash !== currentHash) || !fs.existsSync(out),
      });
      return;
    }
    console.log(`${new Date().toISOString()} ${args.editInstruction ? "editing" : "generating"} ${asset.name} (${args.size}) -> ${out}`);
    if (assetReferenceImages.length) {
      console.log(`${new Date().toISOString()} ${asset.name} bound references: ${assetReferenceImages.map((item) => path.basename(item)).join(", ")}`);
    }
    if (args.styleReferenceImage) {
      console.log(`${new Date().toISOString()} ${asset.name} style-only reference: ${path.basename(args.styleReferenceImage)}`);
    }
    try {
      const editResult = args.editInstruction ? await runEdit(asset, out, args.size, args.editInstruction, logsDir, assetReferenceImages, args.styleReferenceImage, { hiddenSceneReferences }) : null;
      const raw = editResult ? editResult.raw : await runOne(asset, out, args.size, assetReferenceImages, logsDir, args.styleReferenceImage, { hiddenSceneReferences });
      ensureStoryboardCanvas(asset, out, args.size);
      stampStoryboardProductionTabs(asset, out, assetReferenceImages);
      fs.writeFileSync(path.join(logsDir, `${asset.name}.json`), raw ? `${raw}\n` : "");
      writePromptMeta(
        logsDir,
        asset,
        editResult ? editResult.prompt : effectivePrompt,
        args.size,
        args.editInstruction
          ? { mode: editResult?.mode || "edit", editInstructionHash: promptHash(args.editInstruction), referenceImages: assetReferenceImages.map((item) => path.basename(item)), styleReferenceImage: args.styleReferenceImage ? path.basename(args.styleReferenceImage) : "" }
          : {
              mode: assetReferenceImages.length || args.styleReferenceImage ? "image-with-references" : "text",
              referenceImages: assetReferenceImages.map((item) => path.basename(item)),
              hiddenSceneReference: asset.type === "Scene" && mappedReferenceImagesForAsset(asset, assetReferenceMap).length > 0,
              hiddenSceneReferenceMode: hiddenSceneReferences.size ? "color-grade-only" : "",
              styleReferenceImage: args.styleReferenceImage ? path.basename(args.styleReferenceImage) : "",
            },
      );
      const failedLog = path.join(logsDir, `${asset.name}.failed.json`);
      if (fs.existsSync(failedLog)) fs.rmSync(failedLog, { force: true });
      console.log(`${new Date().toISOString()} ${args.editInstruction ? "edited" : "generated"} ${asset.name} -> ${out}`);
      results.push({ name: asset.name, generated: true, edited: !!args.editInstruction, out });
    } catch (error) {
      const message = error?.message || String(error);
      fs.writeFileSync(
        path.join(logsDir, `${asset.name}.failed.json`),
        `${JSON.stringify({
          name: asset.name,
          type: asset.type,
          size: args.size,
          out,
          error: message,
          failedAt: new Date().toISOString(),
          runNamespace: process.env.PIXEL_TOYS_RUN_NAMESPACE || "",
          mode: args.editInstruction ? "edit" : "text",
          editInstructionHash: args.editInstruction ? promptHash(args.editInstruction) : "",
          referenceImages: assetReferenceImages.map((item) => path.basename(item)),
          styleReferenceImage: args.styleReferenceImage ? path.basename(args.styleReferenceImage) : "",
          sourceImageKept: !!args.editInstruction && fs.existsSync(out),
        }, null, 2)}\n`,
      );
      if (args.assetName || args.editInstruction) throw error;
      console.error(`${new Date().toISOString()} failed ${asset.name}: ${message}`);
      results.push({ name: asset.name, failed: true, error: message, out });
      if (shouldAbortBatchAfterFailure(message)) {
        aborted = true;
        console.error(`${new Date().toISOString()} aborting batch after infrastructure failure at ${asset.name}; retry later instead of continuing`);
        return;
      }
      console.error(`${new Date().toISOString()} continuing after failed asset ${asset.name}`);
    }
  }
  let nextIndex = 0;
  async function worker() {
    while (!aborted) {
      const index = nextIndex++;
      if (index >= assets.length) return;
      await processAsset(assets[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(effectiveConcurrency, assets.length || 1) }, () => worker()));
  const failures = results.filter((result) => result.failed);
  if (failures.length) console.error(`${new Date().toISOString()} completed with ${failures.length} failed asset(s); generated/skipped assets are still usable`);
  console.log(
    JSON.stringify(
      { ok: true, dryRun: args.dryRun, force: args.force, selectedAsset: args.assetName || "", size: args.size, count: results.length, failedCount: failures.length, results },
      null,
      2,
    ),
  );
  if (failures.length) process.exitCode = 1;
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`[pixel-assets] ${error.message}`);
    process.exit(1);
  });
}

module.exports = {
  stampStoryboardProductionTabs,
};
