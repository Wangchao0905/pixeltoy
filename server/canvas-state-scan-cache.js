"use strict";

// 只缓存文件归属所需的标量信息,不缓存 JSON.parse 的结果。下游会读取并可能
// 派生/修改 state;共享可变对象会把一个调用方的改动泄漏给另一个请求。
function createCanvasStateScanCache({ fs, path, resolveEpisodeRoot }) {
  const entries = new Map();

  function clear() {
    entries.clear();
  }

  function filesForEpisodeRoot(directory, root) {
    let names;
    try {
      names = fs.readdirSync(directory);
    } catch {
      clear();
      return [];
    }

    const files = [];
    const seen = new Set();
    for (const name of names) {
      if (!name.endsWith(".json")) continue;
      const file = path.join(directory, name);
      seen.add(file);

      let stat;
      try {
        stat = fs.statSync(file);
      } catch {
        entries.delete(file);
        continue;
      }

      const mtimeMs = stat.mtimeMs;
      const size = stat.size;
      let entry = entries.get(file);
      if (!entry || entry.mtimeMs !== mtimeMs || entry.size !== size) {
        let projectId = "";
        try {
          const state = JSON.parse(fs.readFileSync(file, "utf8"));
          projectId = state?.projectId || "";
        } catch {
          // 归属未知的坏文件继续按原逻辑忽略,直到凭证变化后再尝试。
        }
        entry = {
          mtimeMs,
          size,
          projectId,
          episodeRoot: resolveEpisodeRoot(projectId),
        };
        entries.set(file, entry);
      }

      // 首次解析时项目目录可能尚未创建;对这类空归属每次重试,避免缓存住暂时的失败。
      if (entry.episodeRoot === root || (!entry.episodeRoot && resolveEpisodeRoot(entry.projectId) === root)) {
        files.push(file);
      }
    }

    for (const file of entries.keys()) {
      if (!seen.has(file)) entries.delete(file);
    }
    return files;
  }

  return { clear, filesForEpisodeRoot };
}

module.exports = { createCanvasStateScanCache };
