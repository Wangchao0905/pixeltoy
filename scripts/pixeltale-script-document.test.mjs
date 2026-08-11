import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const { validateContent } = await import(pathToFileURL(path.join(root, "server/pixeltale-agent.js")).href);
const { writeScriptDocument } = require(path.join(root, "server/pixeltale-script-document.js"));

function unit(number) {
  return {
    number,
    title_zh: `第${number}集标题`,
    promise_zh: "主角必须在追捕逼近前拿到关键证据。",
    plot_zh: "主角在封锁前抢到一份关键记录，必须在追捕者破门前决定是否相信唯一的证人；他的选择改变了逃亡路线，也暴露了下一条线索。",
    impact_zh: "门外的警报突然响起，主角发现自己被列为命案嫌疑人。",
    causal_turn_zh: "时间戳证明案件记录在案发前就被改过。",
    reversal_zh: "证据显示主角的身份记录被提前篡改。",
    hook_zh: "监控画面里出现另一个与主角一模一样的人，并向镜头举起了凶器。",
    cliffhanger_question_zh: "画面中的另一个人是谁，他为什么提前知道主角会来到这里？",
    payoff_zh: "本集线索把主角从被动逃亡推向主动追查。",
  };
}

function scene(number) {
  const id = `E${String(number).padStart(2, "0")}-S01`;
  return {
    id,
    unit_number: number,
    purpose_zh: "让主角在即时威胁下作出不可逆选择。",
    time_zh: "夜",
    indoor_outdoor: "室内",
    location_zh: "急诊室后门",
    characters: ["C001"],
    action_zh: "主角按住正在滑落的文件夹，听见门外脚步逼近。他翻出原始登记，发现时间戳比警方公布的时间早了十分钟；屏幕上的名字正在被远程改写。",
    conflict_zh: "证人要求主角交出文件，否则就按下报警按钮；门外的追捕者正在缩短距离。",
    choice_zh: "主角撕下登记页的一半交给证人，自己带着能暴露身份的原件冲向后门。",
    result_zh: "证人暂时关闭报警按钮，但原件上的指纹触发了警方数据库，逃生路线被立即锁定。",
    turn_zh: "时间戳证明案件记录在案发前就被改过，主角从被动逃亡转为追查篡改者。",
    visual_intent_zh: "冷光、近距离压迫和持续逼近的脚步声。",
    recurring: false,
    props: [],
    shot_plan: [{ shot_id: `SH${String(number).padStart(3, "0")}`, type: "impact", duration_seconds: 4, description_zh: "警报突然响起", dialogue_refs: [`D${String(number).padStart(3, "0")}`] }],
  };
}

function line(number) {
  return {
    id: `D${String(number).padStart(3, "0")}`,
    scene_id: `E${String(number).padStart(2, "0")}-S01`,
    speaker: "C001",
    intent_zh: "主角压住恐惧，迫使证人做出选择。",
    dialogue_en: "You can press that button, or you can help me find who changed this record.",
    delivery_en: "Low and urgent.",
  };
}

const arc = { unit: "episode_or_chapter", units: [unit(1), unit(2)], arc_summary_zh: "主角沿着被篡改的身份记录追查幕后操纵者。" };
const scenes = { scenes: [scene(1), scene(2)] };
const dialogue = { lines: [line(1), line(2)], localization_checks: ["口语化", "人物声线一致", "未泄露悬念"] };

assert.doesNotThrow(() => validateContent("arc", arc, { episodeCount: 2 }), "complete episode prose must pass the arc contract");
assert.throws(() => validateContent("arc", { ...arc, units: [unit(1)] }, { episodeCount: 2 }), /当前批次.*完整剧情/, "an arc missing an episode must be rejected");
assert.doesNotThrow(() => validateContent("scenes", scenes, { episodeCount: 2 }), "scene coverage must pass for every episode");
assert.doesNotThrow(() => validateContent("dialogue", dialogue, { episodeCount: 2 }), "localized dialogue must pass the dialogue contract");

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pixeltale-script-docx-"));
const outputFile = path.join(tempRoot, "screenplay.docx");
try {
  writeScriptDocument({
    scriptFile: path.join(root, "server/pixeltale-script-document.py"),
    outputFile,
    payload: {
      title: "Test Screenplay",
      mode: "TK 短剧",
      episode_scale: "2 episodes",
      duration: "90 sec",
      input: { episodeCount: 2 },
      sourceArtifacts: { arc, scenes, dialogue },
    },
  });
  assert.ok(fs.existsSync(outputFile), "the formal screenplay DOCX must be created from arc/scenes/dialogue");
  execFileSync("unzip", ["-t", outputFile], { stdio: "pipe" });
  const xml = execFileSync("unzip", ["-p", outputFile, "word/document.xml"], { encoding: "utf8" });
  assert.match(xml, /剧本正文：/, "the DOCX must contain the screenplay section");
  assert.match(xml, /△主角按住正在滑落的文件夹/, "the DOCX must contain reference-style action prose");
  assert.match(xml, /You can press that button/, "the DOCX must contain English dialogue");
  assert.ok(!xml.includes("剧情意图"), "the formal DOCX must not contain internal dialogue notes");
  assert.ok(!xml.includes("集尾强钩子"), "the formal DOCX must not contain structural review fields");
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}

console.log("pixeltale screenplay document ok");
