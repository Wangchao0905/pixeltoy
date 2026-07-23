import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(new URL("..", import.meta.url).pathname);
const styles = fs.readFileSync(path.join(root, "public/styles.css"), "utf8");

assert.match(
  styles,
  /#assetGallery:has\(\.asset-reclassify-groups\)\s*\{[\s\S]*?display:\s*block;/,
  "待确认分类时，画廊必须退出通用卡片网格",
);
assert.match(
  styles,
  /\.asset-reclassify-groups\s*\{[\s\S]*?grid-template-columns:\s*repeat\(4, minmax\(216px, 1fr\)\);[\s\S]*?min-width:\s*916px;/,
  "四个分类列必须保有完整卡片宽度，并由外层横向滚动承载",
);
assert.match(
  styles,
  /\.asset-reclassify-dropzone\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0, 1fr\);[\s\S]*?overflow-y:\s*auto;[\s\S]*?overflow-x:\s*hidden;/,
  "每个分类列只能纵向堆叠并在自身内部滚动",
);
assert.match(
  styles,
  /\.asset-reclassify-dropzone > \.asset-card\s*\{[\s\S]*?min-width:\s*0;[\s\S]*?width:\s*100%;/,
  "分类列中的卡片不得用最小宽度挤压相邻分类列",
);
assert.doesNotMatch(
  styles,
  /@container \(max-width: 820px\)\s*\{\s*\.asset-reclassify-groups\s*\{\s*grid-template-columns:/,
  "分类列不应依赖未定义的容器查询改变列数",
);

console.log("asset classification layout tests passed");
