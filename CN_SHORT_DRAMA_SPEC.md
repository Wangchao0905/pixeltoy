# 国内短剧功能开发规范

## 任务目标
在 PixelTale 剧本 Agent 中添加"国内短剧"模式，与现有的 TK 短剧（海外市场）和普通长剧并列。

## 核心差异对照表

| 维度 | TK 短剧 | 国内短剧 |
|------|---------|----------|
| 目标市场 | 海外（欧美） | 国内 |
| 对白语言 | 英文对白 | 中文对白 |
| 剧名语言 | 英文片名 | 中文剧名 |
| 剧名风格 | 简短独特英文（1-5词）| 直接带钩子中文（6-15字）|
| 禁用词汇 | Billionaire, CEO, Mafia 等 | 无特殊禁词 |
| DNA 题材 | 欧美流媒体热剧风格 | 国内爆火短剧题材 |
| 命名基因 | 人物/地点/物件/双关 | 身份反差/逆袭钩子/情感冲突 |

## 国内短剧 DNA 题材库

### 核心类型
1. **霸总赘婿**：豪门、身份隐藏、反差、虐恋、宠妻
2. **逆袭重生**：穿越、重生、系统、复仇、改命
3. **玄幻修仙**：灵气复苏、都市修仙、神豪、位面
4. **甜宠婚恋**：闪婚、契约、假戏真做、先婚后爱
5. **职场情感**：霸道总裁、替身、双重身份、马甲

### 爆款关键词
- 身份类：霸总、赘婿、影帝、神医、战神、首富、大佬
- 关系类：闪婚、契约、替身、双生、马甲、隐婚
- 动作类：逆袭、复仇、重生、穿越、觉醒、打脸
- 情感类：宠妻、虐恋、暗恋、错爱、救赎、追妻

## 代码修改清单

### 1. server/pixeltale-agent.js

#### 修改 normalizeMode() 函数
```javascript
function normalizeMode(value) {
  const raw = text(value, 80).toLowerCase();
  if (["long", "long_form_drama", "long-form-drama", "普通长剧"].includes(raw)) return "long_form_drama";
  if (["cn", "cn_short_drama", "cn-short-drama", "国内短剧", "国内"].includes(raw)) return "cn_short_drama";
  return "tk_short_drama";
}
```

#### 修改 modeLabel() 函数
```javascript
function modeLabel(mode) {
  const normalized = normalizeMode(mode);
  if (normalized === "long_form_drama") return "普通长剧";
  if (normalized === "cn_short_drama") return "国内短剧";
  return "TK 短剧";
}
```

#### 修改 creativeControlPrompt() 函数
```javascript
function creativeControlPrompt(input = {}, mode = "tk_short_drama") {
  const controls = normalizeCreativeControls(input);
  const normalized = normalizeMode(mode);
  
  let opening, dialogueStyle;
  
  if (normalized === "tk_short_drama") {
    opening = `开头冲击窗口：前 ${controls.openingImpactSeconds} 秒内必须给出可感知的冲击或异常。`;
    dialogueStyle = `英文对白风格：${controls.dialogueMode}，仍须保持中文剧情、英文对白且口语化本土化。`;
  } else if (normalized === "cn_short_drama") {
    opening = `开头冲击窗口：前 ${controls.openingImpactSeconds} 秒内必须给出强烈的身份反差、情感冲突或爆点。`;
    dialogueStyle = `中文对白风格：${controls.dialogueMode}，纯中文对白，本土化口语表达，贴近国内观众语感。`;
  } else {
    opening = `开场承诺类型：${controls.openingPromise}，首章必须明确主线推进方向。`;
    dialogueStyle = `英文对白风格：${controls.dialogueMode}，仍须保持中文剧情、英文对白且口语化本土化。`;
  }
  
  return [
    opening,
    `钩子频率：${controls.hookCadence}。`,
    dialogueStyle,
    `交接范围：${controls.handoffScope}，不得覆盖正式文件。`,
  ].join("\n");
}
```

#### 修改 titleRules() 函数
在函数开头添加国内短剧的分支逻辑：

```javascript
function titleRules(input = {}, mode = "tk_short_drama") {
  const normalized = normalizeMode(mode);
  
  // 国内短剧使用中文剧名规则
  if (normalized === "cn_short_drama") {
    const profile = MARKET_PROFILES["CN"];
    const platform = text(input.platform, 120) || "国内短视频平台 / 短剧平台";
    return [
      "剧名必须输出恰好 4 个候选，不能少于或多于 4 个。",
      `正式发行剧名必须使用自然中文，适配${profile.label}市场与"${platform}"的传播语感。`,
      "先读取 userInput 中的剧本 DNA、受众、平台和发行属性，再读取 approvedContext 中已确认的 brief；每个候选必须结合国内短剧爆款题材（霸总、赘婿、逆袭、重生、闪婚、马甲等）。",
      "四个候选必须分别使用不同命名基因：身份反差型（如《闪婚后大佬身份藏不住了》）、逆袭钩子型（如《赘婿归来：前妻跪求复合》）、情感冲突型（如《离婚当天，前夫后悔了》）、悬念设问型（如《谁说我只是个司机》）。naming_gene_zh 必须明确写出所用基因。",
      `国内短剧剧名优先 6-15 个中文字，要有明确的身份、关系或冲突钩子，让人一眼就想点开。`,
      "剧名要直接露出核心钩子和爆点，吸引观众立即点击，不要含蓄或文艺化。",
      "借鉴国内短剧平台（快手、抖音、微短剧）的爆款剧名特征：身份反差、情感冲突、逆袭复仇、马甲揭秘。",
      "禁止过度夸张或低俗，避免触碰平台审核红线；保持商业化的同时确保剧名合规。",
      "每个候选的 explanation_zh 用一句话解释剧名的钩子设计；reason_zh 说明它如何承接本剧 DNA、目标受众和发行场景。",
    ].join("\n");
  }
  
  // 原有的 TK 短剧 / 长剧逻辑
  const market = normalizeMarket(input);
  const profile = MARKET_PROFILES[market.marketCountry];
  // ... 保持原有代码不变
}
```

#### 在 MARKET_PROFILES 中添加国内市场配置
找到 MARKET_PROFILES 定义的位置，添加：

```javascript
const MARKET_PROFILES = {
  US: { label: "北美", ... },
  UK: { label: "英国", ... },
  CN: { 
    label: "中国大陆", 
    marketCountry: "CN",
    language: "zh-CN",
    culturalNotes: "国内短剧市场，注重身份反差、快节奏反转、强情感冲击"
  },
  // ... 其他市场
};
```

### 2. public/pixeltale/app.js 或 public/pixeltale.html

#### 添加国内短剧选项到 UI
找到项目类型选择的位置（可能是下拉菜单或按钮组），添加第三个选项：

```html
<select id="projectMode">
  <option value="tk_short_drama">TK 短剧（海外市场）</option>
  <option value="cn_short_drama">国内短剧（本土市场）</option>
  <option value="long_form_drama">普通长剧</option>
</select>
```

### 3. 测试验证

#### 必须通过的测试
1. 创建国内短剧项目，模式正确识别为 `cn_short_drama`
2. 剧名生成输出 4 个中文剧名候选
3. 剧名包含国内短剧特征关键词
4. 对白提示词中明确"纯中文对白"
5. `modeLabel()` 返回"国内短剧"
6. 不影响现有 TK 短剧和普通长剧功能

#### 手工验证清单
- [ ] 前端 UI 显示"国内短剧"选项
- [ ] 选择国内短剧后，创建项目成功
- [ ] 生成的剧名是中文且符合国内短剧风格
- [ ] 对白提示明确中文本土化
- [ ] 已有 TK 短剧和长剧项目不受影响

## 实施注意事项

1. **向后兼容**：不要修改现有 TK 短剧和长剧的逻辑，只添加新分支
2. **默认值保持**：如果 mode 参数缺失或无法识别，默认仍为 `tk_short_drama`
3. **中英文混排**：国内短剧的 DNA、题材推荐等内部字段仍用中文，但 JSON schema 字段名保持英文
4. **测试覆盖**：修改后运行 `npm test` 确保无回归

## 修改文件清单

- `server/pixeltale-agent.js` - 主要逻辑修改
- `public/pixeltale.html` 或 `public/pixeltale/app.js` - UI 选项添加
- 可能需要修改的测试文件（根据实际情况）

## 部署前检查

1. 语法检查：`node --check server.js`
2. 全量测试：`npm test`
3. 本地验证：启动服务测试国内短剧完整流程
4. 备份当前版本：`cp server/pixeltale-agent.js server/pixeltale-agent.js.bak-before-cn-drama`
