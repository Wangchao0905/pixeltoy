import assert from "node:assert/strict";
import serverModule from "../server.js";
import runner from "./run_asset_generation.js";

const storyboard = serverModule.__test?.storyboard;

assert.equal(typeof storyboard?.storyboardSegmentsFromShots, "function", "storyboard segments must be testable");
assert.equal(typeof storyboard?.storyboardPanelPlanForGroup, "function", "storyboard panel plans must be testable");
assert.equal(typeof storyboard?.storyboardPromptForSlot, "function", "storyboard prompt generation must be testable");
assert.equal(typeof storyboard?.storyboardSlotHasScriptedContent, "function", "empty storyboard plans must be rejected");
assert.equal(typeof runner.storyboardPanelObjects, "function", "the renderer must retain per-panel production fields");

const sourceShot = {
  name: "E01_V003_CHURCH_STANDOFF",
  title: "教堂门边对峙",
  duration: 15,
  refs: ["C005_ISABELLA", "C006_VICTOR", "S002_CHURCH_DOOR"],
  sceneRef: "S002_CHURCH_DOOR",
  beat: "伊莎贝拉退到破旧教堂门边。维克多张开双翼逼近，她抬眼拒绝后继续后退。窗外闪电照亮两人的站位。",
  dialogues: [{ speaker: "维克多", text: "Obey me." }],
  dialogueLanguage: "en",
  prompt: "剧情动作：维克多从正前方逼近，伊莎贝拉被门困住。\n镜头：顺人物运动方向缓慢推近。\n声音：风声、呼吸和远处雷声持续。",
  cinematicDesign: {
    shotSize: "中近景到特写",
    cameraMove: "顺人物运动方向缓慢推近",
    lensPlan: "50mm 中近景，85mm 表情特写",
    lighting: "冷白闪电从窗外扫过，门边保持低照度",
    performance: "伊莎贝拉肩颈收紧并后退，维克多停在压迫距离内",
    cameraLanguage: "保持轴线，最后半秒稳定为剪辑点",
    timeAxis: [
      "0-5秒：中近景建立门边站位与对视。",
      "5-10秒：镜头推近，维克多逼近，伊莎贝拉后退。",
      "10-15秒：闪电照亮两人，停在干净切点。",
    ],
  },
};

const [segment] = storyboard.storyboardSegmentsFromShots([sourceShot], "en");
assert.match(segment.beat, /伊莎贝拉退到破旧教堂门边/, "storyboard must keep the screenplay action, not replace it with a generic shot title");
assert.match(segment.camera, /缓慢推近/, "storyboard must inherit the configured camera move");
assert.match(segment.lens, /50mm/, "storyboard must inherit the configured lens plan");
assert.match(segment.lighting, /冷白闪电/, "storyboard must inherit the configured lighting plan");
assert.match(segment.sound, /风声/, "storyboard must inherit the configured sound plan");

const panels = storyboard.storyboardPanelPlanForGroup({
  startSecond: 0,
  duration: 15,
  segments: [segment],
});
assert.equal(panels.length, 9, "a 15-second Production Board must retain nine panels");
assert.ok(panels.every((panel) => panel.production?.script && !/waiting for script/i.test(panel.production.script)), "every panel must retain a concrete screenplay action");
assert.ok(panels.some((panel) => panel.production?.script?.includes("伊莎贝拉")), "the screenplay action must survive into the panel plan");
assert.ok(panels.some((panel) => panel.dialogue?.text === "Obey me."), "the planned dialogue must be assigned to a panel");
assert.ok(panels.every((panel) => panel.production?.sound?.includes("风声")), "every panel must carry the sound context");

const slot = {
  id: "SB001_E01_V003_PRODUCTION_BOARD",
  duration: 15,
  startSecond: 0,
  endSecond: 15,
  sourceShotNames: [sourceShot.name],
  refs: sourceShot.refs,
  beatSummary: segment.beat,
  dialogueLanguage: "en",
  panels,
};
const prompt = storyboard.storyboardPromptForSlot(slot);
assert.match(prompt, /script=/, "storyboard prompt must explicitly carry screenplay action for every panel");
assert.match(prompt, /sound=/, "storyboard prompt must explicitly carry sound for every panel");
assert.match(prompt, /Obey me\./, "storyboard prompt must preserve dialogue");
assert.equal(storyboard.storyboardSlotHasScriptedContent(slot), true, "a script-backed slot must be eligible for generation");
assert.equal(
  storyboard.storyboardSlotHasScriptedContent({ id: "SB999", sourceShotNames: [], beatSummary: "等待剧本分镜和时长", panels: [] }),
  false,
  "an empty fallback slot must never be sent to image generation",
);

const rendererPanels = runner.storyboardPanelObjects(
  "P1 0-1.7s: script=伊莎贝拉退到门边; visual=维克多逼近; camera=slow push-in; shot=medium close-up; lens=50mm; lighting=lightning; dialogue=维克多: \"Obey me.\"; sound=wind and breathing; action=后退; continuity=keep axis.",
);
assert.deepEqual(
  rendererPanels[0],
  {
    label: "P1",
    timeRange: "0-1.7s",
    raw: rendererPanels[0].raw,
    description: "维克多逼近",
    script: "伊莎贝拉退到门边",
    visual: "维克多逼近",
    camera: "slow push-in",
    shot: "medium close-up",
    lens: "50mm",
    lighting: "lightning",
    emotion: "",
    dialogue: "维克多: \"Obey me.\"",
    sound: "wind and breathing",
    action: "后退",
    continuity: "keep axis.",
  },
  "renderer parsing must preserve script, camera, dialogue, and sound for the visible Production Tab",
);

console.log("storyboard script contract tests passed");
