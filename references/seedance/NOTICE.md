# Seedance 2.0 导演方法 —— 来源与署名

本目录下的参考文件用于驱动「工作流视频提示词拆解」（server.js 的 `storyboardSystemPrompt` +
`server/seedance-director.js`）。方法蒸馏自开源项目 **Seedance 2.0 Skill OS**。

- 上游项目：https://github.com/Emily2040/seedance-2.0
- 作者：Iamemily2050 (@iamemily2050)
- 版本：v6.6.0
- 采用提交：`57d01dc66f93ecb03c2475be5f22dc416d9b701d`
- 许可证：MIT（见本目录 `LICENSE`）
- 引入日期：2026-07-16

## 内联的文件（原样复制，仅作参考/溯源）

| 本地文件 | 上游路径 |
|---|---|
| `directing-engine.md` | `references/directing-engine.md` |
| `prompt-compiler.md` | `references/prompt-compiler.md` |
| `vocab-zh.md` | `references/vocab/zh.md` |
| `reference-transfer-contract.md` | `references/reference-transfer-contract.md` |
| `LICENSE` | `LICENSE` |

## 使用方式

`server/seedance-director.js` 的 `SEEDANCE_DIRECTOR_SYSTEM_ZH` 是上述方法的**中文蒸馏**（导演阅读→
一句话意图→器械协同→表演写成可见行为→光色即情绪→去 AI 味→参考角色绑定），作为系统提示词注入
storyboard 分镜模型（gpt-5.6-sol）。最终仍产出既有的 14 字段 JSON 视频提示词（壳不变），字段内容
由模型按导演引擎逐镜拆解填充，缺失时回退原关键词启发式。可用环境变量 `PIXEL_TOYS_SEEDANCE_DIRECTOR=0`
关闭、回退纯启发式。

这些文件不参与运行时读取（方法已蒸馏进代码），仅用于溯源、审阅与后续迭代对照。
