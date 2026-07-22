const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const CHATCUT_DIR = "12_chatcut";
const CHATCUT_STATUS = Object.freeze({
  IDLE: "idle",
  PACKAGE_READY: "package_ready",
  EDITING: "editing",
  EXPORTED: "exported",
  APPROVED: "approved",
});

const STATUS_LABELS = {
  [CHATCUT_STATUS.IDLE]: "未准备",
  [CHATCUT_STATUS.PACKAGE_READY]: "制作包已准备",
  [CHATCUT_STATUS.EDITING]: "剪辑中",
  [CHATCUT_STATUS.EXPORTED]: "已导出待确认",
  [CHATCUT_STATUS.APPROVED]: "本集已确认",
};

function text(value) {
  return String(value || "").trim();
}

function finiteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function roundSeconds(value) {
  return Math.round(Math.max(0, finiteNumber(value)) * 1000) / 1000;
}

function timecode(seconds) {
  const totalMs = Math.round(Math.max(0, finiteNumber(seconds)) * 1000);
  const hours = Math.floor(totalMs / 3_600_000);
  const minutes = Math.floor((totalMs % 3_600_000) / 60_000);
  const secs = Math.floor((totalMs % 60_000) / 1000);
  const ms = totalMs % 1000;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}.${String(ms).padStart(3, "0")}`;
}

function safeStem(value, fallback = "shot") {
  const stem = text(value)
    .replace(/[^A-Za-z0-9._-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80);
  return stem || fallback;
}

function ensureFile(file, label) {
  if (!file || !fs.existsSync(file) || !fs.statSync(file).isFile()) throw new Error(`${label}不存在`);
  return path.resolve(file);
}

function relativePackagePath(packageDir, file) {
  return path.relative(packageDir, file).split(path.sep).join("/");
}

function sha256File(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function writeJson(file, value) {
  const temp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temp, file);
}

function stateFile(episodeRoot) {
  return path.join(episodeRoot, CHATCUT_DIR, "chatcut_state.json");
}

function packageDir(episodeRoot) {
  return path.join(episodeRoot, CHATCUT_DIR);
}

function readState(episodeRoot) {
  const file = stateFile(episodeRoot);
  if (!fs.existsSync(file)) return { status: CHATCUT_STATUS.IDLE, history: [] };
  try {
    const state = JSON.parse(fs.readFileSync(file, "utf8"));
    return {
      ...state,
      status: STATUS_LABELS[state.status] ? state.status : CHATCUT_STATUS.IDLE,
      history: Array.isArray(state.history) ? state.history : [],
    };
  } catch {
    return { status: CHATCUT_STATUS.IDLE, history: [], error: "chatcut_state.json 无法读取" };
  }
}

function writeState(episodeRoot, nextState) {
  const dir = packageDir(episodeRoot);
  fs.mkdirSync(dir, { recursive: true });
  const state = {
    schemaVersion: 1,
    ...nextState,
    updatedAt: nextState.updatedAt || new Date().toISOString(),
  };
  writeJson(stateFile(episodeRoot), state);
  return state;
}

function durationFromShot(shot) {
  return roundSeconds(
    shot?.durationSeconds ??
      shot?.duration ??
      shot?.durationSec ??
      (finiteNumber(shot?.durationMs, 0) ? finiteNumber(shot.durationMs) / 1000 : 0),
  );
}

function normalizeShot(shot, order, cursor) {
  const start = roundSeconds(shot?.timecode?.startSeconds ?? shot?.startSeconds ?? cursor);
  const duration = durationFromShot(shot);
  const end = roundSeconds(shot?.timecode?.endSeconds ?? shot?.endSeconds ?? start + duration);
  const sourceFile = ensureFile(shot?.filePath, `片段 ${text(shot?.name) || order} 文件`);
  return {
    name: text(shot?.name) || `shot_${order}`,
    order,
    durationSeconds: roundSeconds(Math.max(0, end - start)),
    timecode: {
      startSeconds: start,
      endSeconds: end,
      start: timecode(start),
      end: timecode(end),
    },
    sourceFile,
    originalFileName: path.basename(sourceFile),
    sourceSha256: sha256File(sourceFile),
    prompt: text(shot?.prompt || shot?.videoPrompt || shot?.visualPrompt),
    storyboardRefs: Array.isArray(shot?.storyboardRefs) ? shot.storyboardRefs.map(text).filter(Boolean) : [],
  };
}

function buildEditBrief(project, shots) {
  const title = text(project?.title || project?.displayTitle || "本集");
  const episodeCode = text(project?.episodeCode || project?.episodeSlug || "episode");
  const lines = [
    `# ${title} / ${episodeCode} ChatCut 剪辑说明`,
    "",
    "## 输入",
    "- 按 assembly_manifest.json 的 order 从前到后剪辑。",
    "- media/rough_cut.mp4 是 Pixel Toys 的顺序粗剪，media/shots/ 是逐 Shot 源片段。",
    "",
    "## 剪辑目标",
    "- 保留剧本叙事顺序和对白完整性。",
    "- 在对白、动作和情绪转折处调整节奏，补充字幕、转场、音乐和音效。",
    "- 竖屏成片优先使用 1080x1920，除非项目配置另有要求。",
    "- 服务器 Agent 完成导出后会自动回填，之后仍需人工确认本集。",
    "",
    "## Shot 顺序",
    ...shots.map((shot) => `- ${String(shot.order).padStart(3, "0")} ${shot.name} (${shot.timecode.start} - ${shot.timecode.end})`),
    "",
  ];
  return `${lines.join("\n")}\n`;
}

function sourceDigest(roughCut, shots) {
  return crypto
    .createHash("sha256")
    .update(
      JSON.stringify({
        roughCut: { file: roughCut.file, sha256: roughCut.sha256, size: roughCut.size },
        shots: shots.map((shot) => ({
          name: shot.name,
          order: shot.order,
          timecode: shot.timecode,
          sourceFile: shot.sourceFile,
          sourceSha256: shot.sourceSha256,
        })),
      }),
    )
    .digest("hex");
}

function createChatcutAdapter(options = {}) {
  function diagnose() {
    return {
      provider: "chatcut",
      configured: false,
      enabled: false,
      mode: "package-only",
      reason: "制作包适配层不直接调用 ChatCut；由服务器队列和独立 Agent 执行",
    };
  }

  function buildPackage(input = {}) {
    const episodeRoot = path.resolve(input.episodeRoot || "");
    if (!episodeRoot) throw new Error("缺少 episodeRoot");
    const roughCutPath = ensureFile(input.roughCutPath, "粗剪视频");
    const inputShots = Array.isArray(input.shots) ? input.shots : [];
    if (!inputShots.length) throw new Error("没有可导出的 Shot");

    const dir = packageDir(episodeRoot);
    const mediaDir = path.join(dir, "media");
    const shotsDir = path.join(mediaDir, "shots");
    const exportsDir = path.join(dir, "exports");
    fs.mkdirSync(shotsDir, { recursive: true });
    fs.mkdirSync(exportsDir, { recursive: true });
    const normalizedShots = [];
    let cursor = 0;
    for (let index = 0; index < inputShots.length; index += 1) {
      const shot = normalizeShot(inputShots[index], index + 1, cursor);
      const extension = path.extname(shot.sourceFile).toLowerCase() || ".mp4";
      const target = path.join(shotsDir, `${String(shot.order).padStart(3, "0")}_${safeStem(shot.name)}${extension}`);
      fs.copyFileSync(shot.sourceFile, target);
      normalizedShots.push({
        ...shot,
        sourceFile: relativePackagePath(dir, target),
        originalFile: shot.sourceFile,
      });
      cursor = shot.timecode.endSeconds;
    }
    const roughCutTarget = path.join(mediaDir, "rough_cut.mp4");
    fs.copyFileSync(roughCutPath, roughCutTarget);
    const roughCut = {
      file: relativePackagePath(dir, roughCutTarget),
      originalFile: roughCutPath,
      sha256: sha256File(roughCutPath),
      size: fs.statSync(roughCutPath).size,
    };
    const digest = sourceDigest(roughCut, normalizedShots);
    const now = new Date().toISOString();
    const project = {
      id: text(input.project?.id),
      title: text(input.project?.title || input.project?.displayTitle || "本集"),
      episodeCode: text(input.project?.episodeCode || input.project?.episodeSlug),
    };
    const manifest = {
      schemaVersion: 1,
      adapter: "pixel-toys-chatcut",
      createdAt: now,
      project,
      sourceDigest: digest,
      sequence: "ordered-shots",
      media: { roughCut: roughCut.file },
      roughCut,
      shots: normalizedShots,
    };
    fs.writeFileSync(path.join(dir, "assembly_manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
    fs.writeFileSync(path.join(dir, "edit_brief.md"), buildEditBrief(project, normalizedShots));
    const state = writeState(episodeRoot, {
      status: CHATCUT_STATUS.PACKAGE_READY,
      packageDir: CHATCUT_DIR,
      manifestFile: "assembly_manifest.json",
      editBriefFile: "edit_brief.md",
      sourceDigest: digest,
      packageCreatedAt: now,
      export: null,
      history: [{ status: CHATCUT_STATUS.PACKAGE_READY, at: now, note: "制作包已准备" }],
    });
    return {
      status: state.status,
      packageDir: dir,
      manifestFile: path.join(dir, "assembly_manifest.json"),
      editBriefFile: path.join(dir, "edit_brief.md"),
      sourceDigest: digest,
      shots: normalizedShots.length,
    };
  }

  function setState(episodeRoot, nextStatus, metadata = {}) {
    const current = readState(episodeRoot);
    const status = text(nextStatus);
    if (![CHATCUT_STATUS.PACKAGE_READY, CHATCUT_STATUS.EDITING, CHATCUT_STATUS.EXPORTED, CHATCUT_STATUS.APPROVED].includes(status)) {
      throw new Error(`不支持的 ChatCut 状态：${status}`);
    }
    if (status === CHATCUT_STATUS.APPROVED && current.status !== CHATCUT_STATUS.EXPORTED && current.status !== CHATCUT_STATUS.APPROVED) {
      throw new Error("请先导入 ChatCut 导出文件，再确认本集");
    }
    if (status === CHATCUT_STATUS.APPROVED && current.export?.file) {
      const exportFile = path.join(packageDir(episodeRoot), current.export.file);
      if (!fs.existsSync(exportFile) || !fs.statSync(exportFile).isFile()) throw new Error("ChatCut 导出文件不存在，无法确认本集");
    }
    const now = new Date().toISOString();
    const history = [...(Array.isArray(current.history) ? current.history : []), { status, at: now, note: text(metadata.note) }];
    return writeState(episodeRoot, { ...current, ...metadata, status, history, updatedAt: now });
  }

  function importExport(episodeRoot, sourceFile, options = {}) {
    const package = packageDir(episodeRoot);
    if (!fs.existsSync(path.join(package, "assembly_manifest.json"))) throw new Error("请先准备 ChatCut 制作包");
    const source = ensureFile(sourceFile, "ChatCut 导出文件");
    const exportDir = path.join(package, "exports");
    fs.mkdirSync(exportDir, { recursive: true });
    const extension = path.extname(source).toLowerCase() || ".mp4";
    const targetName = `${safeStem(options.fileName || path.basename(source, path.extname(source)), "chatcut_export")}${extension}`;
    const target = path.join(exportDir, targetName);
    if (path.resolve(source) !== path.resolve(target)) fs.copyFileSync(source, target);
    const stat = fs.statSync(target);
    const now = new Date().toISOString();
    const current = readState(episodeRoot);
    const state = writeState(episodeRoot, {
      ...current,
      status: CHATCUT_STATUS.EXPORTED,
      export: { file: relativePackagePath(package, target), size: stat.size, updatedAt: now, sha256: sha256File(target) },
      history: [...(Array.isArray(current.history) ? current.history : []), { status: CHATCUT_STATUS.EXPORTED, at: now, note: "已导入 ChatCut 导出文件" }],
      updatedAt: now,
    });
    return {
      status: state.status,
      export: { ...state.export, path: target },
    };
  }

  function status(episodeRoot) {
    const dir = packageDir(episodeRoot);
    const state = readState(episodeRoot);
    const exportPath = state.export?.file ? path.join(dir, state.export.file) : "";
    const exportExists = !!exportPath && fs.existsSync(exportPath) && fs.statSync(exportPath).isFile();
    return {
      ...state,
      label: STATUS_LABELS[state.status] || STATUS_LABELS[CHATCUT_STATUS.IDLE],
      packageDir: CHATCUT_DIR,
      packageExists: fs.existsSync(path.join(dir, "assembly_manifest.json")),
      manifestFile: path.join(dir, "assembly_manifest.json"),
      editBriefFile: path.join(dir, "edit_brief.md"),
      export: exportExists ? { ...state.export, path: exportPath } : state.export || null,
      diagnosis: diagnose(),
    };
  }

  async function automate(input = {}) {
    const diagnosis = diagnose();
    return {
      ok: true,
      enabled: false,
      networkAttempted: false,
      status: status(input.episodeRoot || ""),
      reason: diagnosis.reason,
    };
  }

  return { buildPackage, readState, setState, importExport, status, diagnose, automate };
}

module.exports = { CHATCUT_DIR, CHATCUT_STATUS, createChatcutAdapter };
