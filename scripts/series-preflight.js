function cleanLine(value = "") {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function uniquePush(list, value, meta = {}) {
  const name = cleanLine(value);
  if (!name || list.some((item) => item.name === name)) return;
  list.push({ name, ...meta });
}

function uniqueCharacterPush(list, value, meta = {}) {
  const name = cleanLine(value).replace(/^(?:医生|警官|队长|护士|司机)/, "");
  if (!name) return;
  const existingIndex = list.findIndex((item) => item.name === name || item.name.includes(name) || name.includes(item.name));
  if (existingIndex >= 0) {
    if (name.length < list[existingIndex].name.length) list[existingIndex] = { name, ...meta };
    return;
  }
  list.push({ name, ...meta });
}

function titleFromScript(scriptText = "", fallback = "未命名短剧") {
  for (const line of String(scriptText || "").split(/\r?\n/)) {
    const clean = cleanLine(line.replace(/^#+\s*/, "").replace(/[《》]/g, ""));
    if (clean) return clean.slice(0, 80);
  }
  return fallback;
}

function lineLooksLikeEpisode(line = "") {
  return /^(?:第\s*\d+\s*[集章话]|EP\s*\d+|Episode\s+\d+)/i.test(cleanLine(line));
}

function lineLooksLikeScene(line = "") {
  return /^(?:场景|场次|Scene|SCENE)\s*\d*[:：\s]/i.test(cleanLine(line));
}

function parseEpisodes(scriptText = "") {
  const lines = String(scriptText || "").split(/\r?\n/);
  const episodes = [];
  let currentEpisode = null;
  let currentScene = null;

  const ensureEpisode = () => {
    if (!currentEpisode) {
      currentEpisode = { index: 1, title: "未分集内容", scenes: [] };
      episodes.push(currentEpisode);
    }
    return currentEpisode;
  };

  for (const raw of lines) {
    const line = cleanLine(raw);
    if (!line) continue;
    if (lineLooksLikeEpisode(line)) {
      currentEpisode = { index: episodes.length + 1, title: line, scenes: [] };
      episodes.push(currentEpisode);
      currentScene = null;
      continue;
    }
    if (lineLooksLikeScene(line)) {
      const episode = ensureEpisode();
      currentScene = { index: episode.scenes.length + 1, title: line, text: "" };
      episode.scenes.push(currentScene);
      continue;
    }
    if (currentScene) {
      currentScene.text = cleanLine(`${currentScene.text} ${line}`);
    }
  }

  return episodes.map((episode) => ({
    ...episode,
    scenes: episode.scenes.length ? episode.scenes : [{ index: 1, title: "未拆场内容", text: "" }],
  }));
}

function extractNamesByPattern(scriptText = "", pattern, reject = () => false) {
  const names = [];
  for (const match of String(scriptText || "").matchAll(pattern)) {
    const value = cleanLine(match[1] || match[0]);
    if (!value || reject(value)) continue;
    if (!names.includes(value)) names.push(value);
  }
  return names;
}

function extractCharacterNames(scriptText = "") {
  const names = [];
  const rejected = /^(?:医生|男人|女人|老人|小孩|货车|工厂|诊所|天桥)$/;
  for (const name of extractNamesByPattern(scriptText, /(?:^|[，。；：\s])([一-龥]{2,4}?)(?:带着|发现|提醒|换上|检查|把|在远处|追踪|交给|说|问|看见|冲向)/g, (value) => rejected.test(value))) {
    uniqueCharacterPush(names, name);
  }
  for (const name of extractNamesByPattern(scriptText, /(?:医生|警官|队长|护士|司机)([一-龥]{2,3}?)(?:检查|带着|发现|提醒|换上|把|说|问|看见|冲向|，|。|；|\s)/g)) {
    uniqueCharacterPush(names, name);
  }
  return names.map((item) => item.name);
}

function extractKnownTerms(scriptText = "", terms = []) {
  return terms.filter((term) => new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).test(scriptText));
}

function evidenceFor(scriptText = "", term = "") {
  const lines = String(scriptText || "").split(/\r?\n/).map(cleanLine).filter(Boolean);
  return lines.find((line) => line.includes(term)) || "";
}

function buildSeriesBible(scriptText = "") {
  const characters = [];
  const locations = [];
  const props = [];

  for (const name of extractCharacterNames(scriptText)) {
    uniquePush(characters, name, { evidence: evidenceFor(scriptText, name) });
  }
  for (const name of extractKnownTerms(scriptText, ["废弃工厂", "地下诊所", "天桥下"])) {
    uniquePush(locations, name, { evidence: evidenceFor(scriptText, name) });
  }
  for (const name of extractKnownTerms(scriptText, ["旧怀表", "银色钥匙", "黑色货车"])) {
    uniquePush(props, name, { evidence: evidenceFor(scriptText, name) });
  }

  return { characters, locations, props };
}

function buildAssetPlan(seriesBible) {
  const coreAssets = [
    ...seriesBible.characters.map((item) => ({ ...item, type: "Character" })),
    ...seriesBible.locations.map((item) => ({ ...item, type: "Scene" })),
    ...seriesBible.props.map((item) => ({ ...item, type: "Prop" })),
  ];
  return {
    coreAssets,
    perEpisodeAssets: [],
    reviewRequired: coreAssets.map((item) => item.name),
  };
}

function analyzeSeriesPreflight({ scriptText = "", title = "" } = {}) {
  const script = String(scriptText || "");
  const episodes = parseEpisodes(script);
  const sceneCount = episodes.reduce((sum, episode) => sum + episode.scenes.length, 0);
  const seriesBible = buildSeriesBible(script);
  const assetPlan = buildAssetPlan(seriesBible);
  const resolvedTitle = cleanLine(title) || titleFromScript(script);
  return {
    title: resolvedTitle,
    summary: `${episodes.length} 集 / ${sceneCount} 场 / ${assetPlan.coreAssets.length} 个核心资产候选`,
    episodes,
    seriesBible,
    assetPlan,
    executionPlan: {
      generatesMedia: false,
      nextStep: "先人工确认 Series Bible 和核心资产清单，再进入分批资产生成。",
      batchPolicy: "按集或每 3-5 场分批执行。",
    },
  };
}

module.exports = { analyzeSeriesPreflight };
