# 任务:在资产确认视图(三列)里支持拖拽重分类

## 需求(来自产品负责人)
在"资产解析"的**三列确认视图**(人物 / 场景 / 道具·插入,每张卡带"生成"按钮的那个视图,
即 `renderAssetManifest` 渲染的 `asset-manifest-grid`)里,支持:
- 把分错类的资产卡**拖拽**到正确的分类列;
- 拖拽后自动回到"待确认"状态;
- 用户**手动点"确认分类"**后才能生图。

交互约定:**任何时候都可拖(含已确认状态)**,拖动后自动变回"待确认",需重新确认。

## 重要背景:之前做错了位置
之前把拖拽做进了 `renderAssets`(资产图卡片区 `asset-reclassify-groups`),**位置错了**。
正确位置是 `renderAssetManifest`(带"生成"按钮的三列确认视图)。请**只在后者实现**,
并可清理/忽略 `renderAssets` 里那套无用的 `asset-reclassify-*` 拖拽(与本需求无关,别混淆)。

## 已勘明的代码定位(public/app.js,基于 commit 3c5b066)
- `renderAssetManifest(manifest)` @ **2924**:目标视图。
- `manifestItemHtml(item)` @ **2963**:单卡,`<span class="manifest-name" data-manifest-asset-id="...">`。
  - 需加:`draggable="true"` + `data-manifest-asset-type="${item.type}"`。
- `groupHtml(title, list, emptyText, type)` @ **2980**:列容器 `<div class="manifest-name-list">`。
  - 需加:`data-manifest-drop-type="${type}"`(type 已是入参:Character/Scene/Prop)。
- `bindManualAssetControls(root, manifest)` @ **3060**:每次渲染后调用,`root`=overview 容器。
  - 在此绑定 dragstart / dragover / dragleave / drop。
- **已有可复用函数** `reclassifyAsset(assetId, targetType)` @ **3661**:
  改 item.type → POST `/asset-manifest` with `confirm:false` → setProjectState + renderWorkspace + toast。
  **直接调它即可**,无需新写后端逻辑。confirm:false 会让状态自动回到"待确认"。
- 确认按钮 `#confirmAssetManifestBtn` @ 6084:已接 `saveAssetManifest({confirm:true})`,无需动。
- 类型映射:Character=人物 Scene=场景 Prop=道具 Insert=插入(道具/插入列的 type 传的是 "Prop")。
  注意:道具列同时含 Prop 和 Insert,drop 到该列应归为 Prop(或按现有 props 归并逻辑,自行确认)。

## 实现要点
1. dragstart:`e.dataTransfer.setData("text/plain", assetId)`,加拖拽中样式 class。
2. dragover:`e.preventDefault()` + `dropEffect="move"`,列高亮。
3. drop:取 assetId 和目标列 type,`if (sourceType !== targetType) reclassifyAsset(assetId, type)`。
4. 同列内拖拽不触发(type 相同直接 return,`reclassifyAsset` 内已有该保护)。
5. 加 CSS:拖拽中卡片、列 hover 高亮(参考 styles.css 现有 manifest-group 风格)。

## 测试
- 新增 `scripts/asset-manifest-reclassify-dnd.test.mjs`:验证 manifest 视图卡片有 draggable、
  列有 drop-type、drop 调用 reclassifyAsset。
- 跑 `node scripts/self-check.mjs` 或相关 UI 测试确保不回归。

## 流程(务必遵守,见 docs/给协作方的说明-CODEX.md)
1. `git pull --rebase origin main`(先同步)
2. 改 public/app.js + public/styles.css + 测试
3. 本地跑测试通过
4. `git commit` + `git push origin main`
5. SSH 生产 `cd /home/ubuntu/apps/pixel-toy && ./deploy.sh`
6. **不要 scp 覆盖生产。**
