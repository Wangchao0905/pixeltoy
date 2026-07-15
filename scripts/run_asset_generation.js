#!/usr/bin/env node
const { execFileSync } = require("node:child_process");
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
const STORYBOARD_RENDERER_VERSION = "production-board-imagegen-v9-real-asset-strip";

function usage() {
  console.log("usage: run_asset_generation.js <asset_prompts.md> <episode_root> [--dry-run] [--force] [--asset-name <name>] [--edit-instruction <text>] [--reference-image <path>] [--asset-reference-map <json>] [--style-reference-image <path>] [--size 1280x720|2048x1152|3840x2160]");
}

function parseArgs(argv) {
  const args = { promptsPath: "", episodeRoot: "", dryRun: false, force: false, assetName: "", editInstruction: "", referenceImages: [], assetReferenceMap: "", styleReferenceImage: "", size: "1280x720" };
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
      ? "Production Board output contract: one 9:16 vertical (portrait) sheet — the whole sheet is taller than it is wide, exact 9:16 aspect ratio, full sheet visible, no cropping. On this vertical sheet draw the storyboard panels in a 2-column grid, read left-to-right then top-to-bottom (P1 top-left, P2 top-right, then the next row below): use exactly 4 panels (2 columns x 2 rows) or 6 panels (2 columns x 3 rows) as the panel plan specifies. Each panel is a portrait story frame representing a vertical 9:16 camera view; keep even gutters between rows and columns and do NOT overlap or merge panels. The story panels are hand-drawn line sketches. Do NOT add any ASSET REFERENCES strip, asset thumbnails, or reference boxes — output ONLY the story panels."
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
draw.text((30, 54), "Use these official assets only for identity and binding. Convert the story into hand-drawn storyboard panels.", fill=muted, font=font)
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
      "Use the attached production asset references ONLY to keep character, scene, prop, and insert identity consistent inside the hand-drawn story panels. Do NOT draw any ASSET REFERENCES strip, thumbnail boxes, or asset reference area — output only the story panels.",
      "Every attached reference image must be assigned one clear role based on its filename prefix: C### is a Character, S### is a Scene/location, P### is a Prop, and I### is an Insert/detail. Never treat a Scene reference as a character, and never treat a Character reference as a location.",
      "The story panels are simplified hand-drawn black storyboard sketches that tell the plot; do not paste or thumbnail the official asset images anywhere on the board.",
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
    return "Production asset reference image. Read the filename prefix before using it: C### means Character, S### means Scene/location, P### means Prop, I### means Insert/detail. Use it ONLY as identity guidance so the hand-drawn story panels keep the correct character/scene/prop identity. Do not render it as a thumbnail or ASSET REFERENCES strip, and do not copy it as a final cinematic panel; storyboard panels remain simplified 9:16 hand-drawn director frames.";
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
    .map((line) => line.replace(/\s+/g, " ").slice(0, 180))
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
      const description = raw
        .replace(/;\s*(No dialogue|Dialogue|对白)[\s\S]*$/i, "")
        .replace(/\s+/g, " ")
        .trim() || line;
      return {
        label: match?.[1] || `P${index + 1}`,
        raw: line,
        description,
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
import json, re, sys
from PIL import Image, ImageDraw, ImageEnhance, ImageFont

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

title_font = font(max(18, w // 48), True)
small_font = font(max(10, w // 110))
tiny_font = font(max(8, w // 150))
micro_font = font(max(7, w // 175))

draw.rectangle([0, 0, w-1, h-1], outline=(34, 34, 34), width=3)
draw.text((22, 14), payload["title"], fill=(24, 24, 24), font=title_font)
draw.text((22, 45), payload.get("story", ""), fill=(55, 55, 55), font=small_font)
if payload.get("source"):
    draw.text((22, 67), payload["source"], fill=(90, 90, 90), font=tiny_font)

grid_x, grid_y = 22, 92
# 9:16 竖版板:面板走 2 列布局(4 格 2×2 或 6 格 2×3),整幅用满宽,不再有右侧资产参考栏。
grid_w = w - grid_x - 22
grid_h = h - grid_y - 38
gap = 12
panels = payload.get("panels") or []
n_panels = len(panels)
n_panels = 4 if n_panels <= 4 else 6
cols = 2
rows = (n_panels + cols - 1) // cols
cell_w = (grid_w - gap * (cols - 1)) // cols
cell_h = (grid_h - gap * (rows - 1)) // rows
refs = payload.get("refs") or []
role_codes = [r.get("code", "") for r in refs if isinstance(r, dict) and r.get("type") == "Character"][:3]
scene_codes = [r.get("code", "") for r in refs if isinstance(r, dict) and r.get("type") == "Scene"][:2]
prop_codes = [r.get("code", "") for r in refs if isinstance(r, dict) and r.get("type") not in ("Character", "Scene")][:3]
scene_refs = [r for r in refs if isinstance(r, dict) and r.get("type") == "Scene" and r.get("path")]
character_refs = [r for r in refs if isinstance(r, dict) and r.get("type") == "Character" and r.get("path")][:2]
prop_refs = [r for r in refs if isinstance(r, dict) and r.get("type") not in ("Character", "Scene") and r.get("path")][:2]

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

def panel_caption(text):
    text = re.sub(r"^P[1-9]\s+[^:：]{0,90}[:：]\s*", "", str(text or "")).strip()
    text = re.sub(r";\s*(No dialogue|Dialogue|对白)[\s\S]*$", "", text, flags=re.I).strip()
    text = text.replace("action=blue", "action").replace("camera=red", "camera")
    return text[:120] or "story beat"

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
    if code:
        tw = max(32, len(code) * 5)
        draw.rectangle([cx - tw // 2, cy + int(18 * scale), cx + tw // 2, cy + int(18 * scale) + micro_font.size + 3], fill=(255,255,250))
        draw.text((cx - tw // 2 + 2, cy + int(18 * scale) + 1), code, fill=(20,20,20), font=micro_font)

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
    if code:
        draw.text((cx - 20 * scale, cy + 28 * scale), code, fill=ink, font=micro_font)

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

def draw_camera_marks(box, shot_kind):
    x1, y1, x2, y2 = box
    if shot_kind in ("closeup", "insert"):
        pad_x, pad_y = 12, 16
    elif shot_kind in ("wide", "establish"):
        pad_x, pad_y = 4, 7
    else:
        pad_x, pad_y = 8, 11
    draw.rectangle([x1 + pad_x, y1 + pad_y, x2 - pad_x, y2 - pad_y], outline=(205,32,32), width=1)
    if shot_kind == "over_shoulder":
        draw.arc([x1 - 20, y1 + 20, x1 + 45, y2 + 25], 260, 90, fill=(70,70,70), width=4)
    elif shot_kind == "low_angle":
        draw.line([x1 + 7, y2 - 18, x2 - 7, y1 + 36], fill=(112,112,112), width=1)
    elif shot_kind == "insert":
        draw.ellipse([x1 + 15, y1 + 22, x2 - 15, y2 - 22], outline=(112,112,112), width=1)

def draw_speech_or_breath(box, has_dialogue=False):
    x1, y1, x2, y2 = box
    if has_dialogue:
        draw.rounded_rectangle([x1 + 10, y1 + 12, x2 - 10, y1 + 36], radius=6, outline=(55,55,55), width=1)
        draw.line([x1 + 35, y1 + 36, x1 + 28, y1 + 46], fill=(55,55,55), width=1)
    else:
        for k in range(3):
            yy = y1 + 18 + k * 8
            draw.arc([x2 - 45 - k*3, yy, x2 - 18 + k*3, yy + 10], 185, 355, fill=(24,96,210), width=1)

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
    if role_codes:
        draw.text((x1 + 6, y2 - 14), role_codes[min(panel_index % max(1, len(role_codes)), len(role_codes)-1)], fill=(24,24,24), font=micro_font)

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
    if prop_codes:
        draw.text((x1 + 5, y2 - 14), prop_codes[0], fill=(24,24,24), font=micro_font)

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
        if prop_codes:
            draw.text((x1 + 5, y2 - 14), prop_codes[0], fill=(24,24,24), font=micro_font)
    elif panel_index == 6:
        draw_story_insert(inner, "baton weapon insert detail", panel_index)
    elif panel_index == 7:
        draw_floor(inner, dense=False)
        for idx, t in enumerate([0.18, 0.38, 0.58, 0.78]):
            draw_guard(x1 + int((x2 - x1) * t), base_y - idx * 2, 0.55, prop_codes[0] if idx == 0 and prop_codes else "")
        draw.line([x1 + 8, base_y - 24, x2 - 8, base_y - 24], fill=(24,96,210), width=2)
    else:
        draw_floor(inner, dense=False)
        for idx, t in enumerate([0.28, 0.44, 0.60, 0.76]):
            draw_guard(x1 + int((x2 - x1) * t), base_y, 0.42, prop_codes[0] if idx == 0 and prop_codes else "")

def draw_panel_story(frame_box, note, panel_index):
    x1, y1, x2, y2 = frame_box
    draw.rectangle(frame_box, fill=(255,255,250), outline=(205,32,32), width=3)
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
    draw_camera_marks(frame_box, shot)
    draw_speech_or_breath(frame_box, has_dialogue=has_any(note, ["Dialogue:", "对白：", "says", "说"]))
    if scene_codes:
        draw.rectangle([x1 + 3, y1 + 3, x1 + 50, y1 + 15], fill=(255,255,250))
        draw.text((x1 + 4, y1 + 4), scene_codes[0], fill=(92,92,92), font=micro_font)
    if prop_codes and has_any(note, ["prop", "道具", "短棍", "刀", "武器", "装甲", "armor", "核心"]):
        draw.text((x2 - 46, y2 - 13), prop_codes[0], fill=(45,45,45), font=micro_font)

for i in range(n_panels):
    r, c = divmod(i, cols)
    x = grid_x + c * (cell_w + gap)
    y = grid_y + r * (cell_h + gap)
    draw.rectangle([x, y, x + cell_w, y + cell_h], fill=(255, 255, 250), outline=(185, 45, 42), width=2)
    draw.text((x + 7, y + 5), f"P{i+1}", fill=(24, 24, 24), font=small_font)
    # The visible storyboard camera panel is always a true vertical 9:16 frame.
    frame_h = cell_h - 18
    frame_w = int(frame_h * 9 / 16)
    frame_x = x + 8
    frame_y = y + 24
    panel = panels[i] if i < len(panels) else {"description": "chronological story beat"}
    note = panel_text(panel)
    draw_panel_story([frame_x, frame_y, frame_x + frame_w, frame_y + frame_h], note, i)
    # action and breath arrows stay as readable director marks on top of the black sketch.
    shot_kind = panel_shot_kind(note, i)
    if shot_kind in ("insert", "closeup"):
        ax1, ay1 = frame_x + int(frame_w * 0.28), frame_y + int(frame_h * 0.72)
        ax2, ay2 = frame_x + int(frame_w * 0.72), frame_y + int(frame_h * 0.32)
    elif shot_kind == "over_shoulder":
        ax1, ay1 = frame_x + int(frame_w * 0.25), frame_y + int(frame_h * 0.52)
        ax2, ay2 = frame_x + int(frame_w * 0.82), frame_y + int(frame_h * 0.44)
    elif shot_kind == "low_angle":
        ax1, ay1 = frame_x + int(frame_w * 0.18), frame_y + int(frame_h * 0.78)
        ax2, ay2 = frame_x + int(frame_w * 0.76), frame_y + int(frame_h * 0.28)
    else:
        ax1, ay1 = frame_x + 12, frame_y + int(frame_h * (0.45 if i < n_panels - 1 else 0.72))
        ax2, ay2 = frame_x + frame_w - 12, frame_y + int(frame_h * (0.45 if i < n_panels - 1 else 0.72))
    draw.line([ax1, ay1, ax2, ay2], fill=(24, 96, 210), width=3)
    draw.polygon([(ax2, ay2), (ax2 - 9, ay2 - 5), (ax2 - 9, ay2 + 5)], fill=(24, 96, 210))
    for d in range(0, frame_w - 24, 16):
        draw.line([frame_x + 12 + d, frame_y + frame_h - 18, frame_x + 20 + d, frame_y + frame_h - 18], fill=(24, 96, 210), width=1)
    caption_x = frame_x + frame_w + 8
    caption_w = max(42, x + cell_w - caption_x - 6)
    caption = panel_caption(note)
    words = [caption[j:j+max(16, caption_w // 6)] for j in range(0, min(len(caption), 180), max(16, caption_w // 6))]
    ty = y + 27
    for line in words[:8]:
        draw.text((caption_x, ty), line, fill=(56, 56, 56), font=micro_font)
        ty += int(micro_font.size * 1.25)

legend_y = h - 24
draw.text((24, legend_y), "blue solid arrow = action | dashed blue = breath/flow | red rectangle = 9:16 camera frame | PT code = asset binding", fill=(55,55,55), font=tiny_font)
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
    "Generate one professional hand-drawn commercial Production Board image.",
    "The board is a single 9:16 vertical (portrait) sheet — taller than it is wide — on warm off-white paper, full sheet visible, no cropping.",
    "Draw the storyboard panels in a 2-column grid, read left-to-right then top-to-bottom (P1 top-left, P2 top-right, then the next row below): use exactly 4 panels (2 columns x 2 rows) or 6 panels (2 columns x 3 rows) following the panel plan. Each panel is a portrait story frame representing a vertical 9:16 camera view; keep even gutters between rows and columns and do not overlap or merge panels.",
    "Each panel must be a distinct black pencil/ink storyboard drawing, not repeated panels and not a UI wireframe: use varied shot scales, camera angles, blocking, foreground/background staging, actor poses, eyelines, movement arrows, and cut points.",
    "Use a classic production storyboard visual language: black linework, rough expressive character silhouettes, red camera/framing rectangles, blue movement arrows, dashed blue breath/flow arrows, and concise handwritten-style shot notes.",
    "Do NOT add any ASSET REFERENCES strip, asset thumbnails, or reference boxes. The board contains ONLY the hand-drawn story panels.",
    "Do not paste final asset images anywhere on the board. Story panels are hand-drawn story action only.",
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
          ? "Keep this as one 16:9 landscape Production Board with vertical 9:16 storyboard panels and a clear ASSET REFERENCES strip. It is for composition, blocking, camera direction, shot rhythm, and asset identity matching."
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

function stampStoryboardAssetReferences(asset, outPath, referenceImages = []) {
  if (asset?.type !== "Storyboard" || !fs.existsSync(outPath) || !referenceImages.length) return;
  const references = referenceImages
    .filter((image) => image && fs.existsSync(image) && fs.statSync(image).size > 1000)
    .map((image, index) => ({
      path: image,
      type: referenceTypeFromName(image) || "Reference",
      code: referenceCodeForImage(image, index),
      name: referenceAssetName(image),
    }));
  if (!references.length) return;
  const py = String.raw`
import json, sys, textwrap
from PIL import Image, ImageDraw, ImageFont

board_path = sys.argv[1]
refs = json.loads(sys.argv[2])

def font(size, bold=False):
    candidates = [
        "/System/Library/Fonts/Supplemental/Arial Bold.ttf" if bold else "/System/Library/Fonts/Supplemental/Arial.ttf",
        "/System/Library/Fonts/Supplemental/Arial Unicode.ttf",
        "/System/Library/Fonts/Hiragino Sans GB.ttc",
        "/System/Library/Fonts/STHeiti Medium.ttc" if bold else "/System/Library/Fonts/STHeiti Light.ttc",
    ]
    for item in candidates:
        try:
            return ImageFont.truetype(item, size)
        except Exception:
            pass
    return ImageFont.load_default()

with Image.open(board_path) as source:
    board = source.convert("RGB")

W, H = board.size
draw = ImageDraw.Draw(board)
paper = (246, 242, 232)
ink = (22, 22, 20)
muted = (85, 82, 74)
blue = (34, 92, 175)
red = (174, 45, 45)
title_font = font(max(15, W // 74), True)
label_font = font(max(10, W // 125), True)
small_font = font(max(8, W // 160))
micro_font = font(max(7, W // 185))

margin = max(14, round(W * 0.016))
strip_h = max(92, min(round(H * 0.145), 132))
y0 = H - margin - strip_h
x0 = margin
x1 = W - margin
y1 = H - margin

# Replace the model-drawn reference strip with a deterministic real-asset strip.
draw.rectangle([x0, y0, x1, y1], fill=paper, outline=ink, width=max(2, W // 900))
draw.text((x0 + 10, y0 + 8), "ASSET REFERENCES - OFFICIAL PRODUCTION ASSETS", fill=ink, font=title_font)
draw.text((x0 + 10, y0 + 28), "Real thumbnails pasted after generation.", fill=muted, font=small_font)

left_label_w = max(110, round(W * 0.11))
content_x0 = x0 + left_label_w
draw.line([content_x0 - 8, y0, content_x0 - 8, y1], fill=ink, width=1)
cols = min(max(1, len(refs)), 4)
cell_w = max(1, (x1 - content_x0 - 10) / cols)
thumb_top = y0 + 42
thumb_bottom = y1 - 10

for index, ref in enumerate(refs[:4]):
    cx0 = int(content_x0 + index * cell_w)
    cx1 = int(content_x0 + (index + 1) * cell_w - 8)
    draw.rectangle([cx0, y0 + 8, cx1, y1 - 8], outline=(105, 105, 98), width=1)
    thumb_w = max(68, min(round((cx1 - cx0) * 0.42), 160))
    thumb_box = [cx0 + 8, thumb_top, cx0 + 8 + thumb_w, thumb_bottom]
    try:
        with Image.open(ref["path"]) as src:
            src = src.convert("RGB")
            bw, bh = thumb_box[2] - thumb_box[0], thumb_box[3] - thumb_box[1]
            scale = min(bw / src.width, bh / src.height)
            nw, nh = max(1, round(src.width * scale)), max(1, round(src.height * scale))
            resample = getattr(Image, "Resampling", Image).LANCZOS
            src = src.resize((nw, nh), resample)
            draw.rectangle(thumb_box, fill=(255, 255, 255), outline=(28, 28, 28), width=1)
            board.paste(src, (thumb_box[0] + (bw - nw) // 2, thumb_box[1] + (bh - nh) // 2))
    except Exception as exc:
        draw.rectangle(thumb_box, fill=(235, 235, 230), outline=(120, 120, 112), width=1)
        draw.text((thumb_box[0] + 4, thumb_box[1] + 4), "missing", fill=red, font=small_font)
    label_x = thumb_box[2] + 8
    color = blue if ref.get("type") == "Character" else red if ref.get("type") == "Scene" else ink
    draw.text((label_x, thumb_top), f'{ref.get("code","")} | {ref.get("type","")}', fill=color, font=label_font)
    name = ref.get("name", "reference")
    yy = thumb_top + max(16, label_font.size + 3)
    for line in textwrap.wrap(name, width=24)[:4]:
        draw.text((label_x, yy), line, fill=muted, font=micro_font)
        yy += max(10, round(micro_font.size * 1.22))

board.save(board_path)
`;
  optionalStoryboardPostprocess("asset reference strip", () => {
    execFileSync("python3", ["-c", py, outPath, JSON.stringify(references)], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 60_000 });
  });
}

function runImageGenWithRetry(imageArgs, env, label, maxRetries = 0, execTimeoutMs = 1000 * 1000) {
  let lastError;
  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    try {
      return execFileSync("node", imageArgs, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: execTimeoutMs, env });
    } catch (error) {
      lastError = error;
      const detail = imageGenErrorDetail(error);
      if (attempt >= maxRetries || !isTransientImageGenFailure(detail)) break;
      const delay = 12_000 * (attempt + 1);
      console.error(`${new Date().toISOString()} ${label}: transient image-gen failure, retrying in ${Math.round(delay / 1000)}s`);
      sleepSync(delay);
    }
  }
  throw lastError;
}

// 故事板/Production Board 走竖版 9:16（3x3 的 9:16 竖格需要整板为竖版；把传入的
// 16:9 尺寸按像素数换成 9:16 竖版，例如 1280x720 -> 720x1280）。
function storyboardPortraitSize(size) {
  const m = String(size || "1280x720").match(/^(\d+)x(\d+)$/);
  if (!m) return "720x1280";
  const w = Number(m[1]);
  const h = Number(m[2]);
  return w > h ? `${h}x${w}` : `${w}x${h}`;
}

function runStoryboardReferenceBoardRoute(asset, outPath, size, referenceImages, env, logsDir, originalDetail = "") {
  if (asset?.type === "Storyboard") size = storyboardPortraitSize(size);
  const board = storyboardReferenceContactSheet(asset, referenceImages, logsDir);
  const prompt = [
    referencePromptFor(asset, referenceImages),
    "",
    "The input image is a PRODUCTION ASSET REFERENCE BOARD, not the final storyboard.",
    "Transform it into the requested Production Board sheet. Keep the asset references readable in the ASSET REFERENCES strip, and draw the P1-P9 story panels as varied black hand-drawn storyboard sketches.",
    "Use C/PT-C labels only for characters, S/PT-S labels only for scenes/locations, P/PT-P labels only for props, and I/PT-I labels only for inserts/details.",
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
    return runImageGenWithRetry(
      editArgs,
      env,
      `${asset.name} reference-board image-gen route`,
      0,
      execTimeoutMsFor(timeout),
    ).trim();
  } catch (error) {
    const detail = imageGenErrorDetail(error);
    throw new Error(`${asset.name} image-gen reference route failed, and reference-board image-gen route also failed${detail ? `:\n${detail}` : ""}${originalDetail ? `\n\nOriginal reference route failure:\n${originalDetail}` : ""}`);
  }
}

function runOne(asset, outPath, size, referenceImages = [], logsDir = os.tmpdir(), styleReferenceImage = "", options = {}) {
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
    const output = runImageGenWithRetry(
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
      return runStoryboardReferenceBoardRoute(asset, outPath, size, referenceImages, env, logsDir, detail || error.message);
    }
    throw new Error(`${asset.name} image-gen failed${detail ? `:\n${detail}` : `: ${error.message}`}`);
  }
}

function runEdit(asset, outPath, size, editInstruction, logsDir, referenceImages = [], styleReferenceImage = "", options = {}) {
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
      output = runImageGenWithRetry(
        imageArgs,
        env,
        `${asset.name} edit`,
        boundedRetryCount(asset.type === "Storyboard" ? STORYBOARD_IMAGE_RETRIES : DEFAULT_IMAGE_RETRIES, asset.type === "Storyboard" ? 1 : 2),
        execTimeoutMsFor(primaryTimeoutSeconds),
      );
    } catch (error) {
      if (!shouldFallbackToImageMode(error)) throw error;
      const fallbackArgs = [IMAGE_GEN, "--mode", "image", "--image", outPath, "--prompt", prompt, "--size", size, "--model", IMAGE_GEN_ORCHESTRATION_MODEL, "--image-model", IMAGE_GEN_IMAGE_MODEL, "--out", tmpOut, "--timeout", String(primaryTimeoutSeconds)];
      output = runImageGenWithRetry(
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

function main() {
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
  for (const asset of assets) {
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
      continue;
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
      continue;
    }
    console.log(`${new Date().toISOString()} ${args.editInstruction ? "editing" : "generating"} ${asset.name} (${args.size}) -> ${out}`);
    if (assetReferenceImages.length) {
      console.log(`${new Date().toISOString()} ${asset.name} bound references: ${assetReferenceImages.map((item) => path.basename(item)).join(", ")}`);
    }
    if (args.styleReferenceImage) {
      console.log(`${new Date().toISOString()} ${asset.name} style-only reference: ${path.basename(args.styleReferenceImage)}`);
    }
    try {
      const editResult = args.editInstruction ? runEdit(asset, out, args.size, args.editInstruction, logsDir, assetReferenceImages, args.styleReferenceImage, { hiddenSceneReferences }) : null;
      const raw = editResult ? editResult.raw : runOne(asset, out, args.size, assetReferenceImages, logsDir, args.styleReferenceImage, { hiddenSceneReferences });
      ensureStoryboardCanvas(asset, out, args.size);
      stampStoryboardAssetReferences(asset, out, assetReferenceImages);
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
        console.error(`${new Date().toISOString()} aborting batch after infrastructure failure at ${asset.name}; retry later instead of continuing`);
        break;
      }
      console.error(`${new Date().toISOString()} continuing after failed asset ${asset.name}`);
    }
  }
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

try {
  main();
} catch (error) {
  console.error(`[pixel-assets] ${error.message}`);
  process.exit(1);
}
