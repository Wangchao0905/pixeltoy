import assert from "node:assert/strict";
import serverModule from "../server.js";

const groupSegments = serverModule.__test?.durationMode?.storyboardGroupsForSegments;
assert.equal(typeof groupSegments, "function", "storyboard board grouping must be testable");

const segments = Array.from({ length: 9 }, (_, index) => ({
  key: "V" + String(index + 1).padStart(3, "0"),
  title: "剧情段 " + (index + 1),
  beat: "不同场景的剧情段 " + (index + 1),
  duration: 10,
  startSecond: index * 10,
  endSecond: index * 10 + 10,
  sourceShotNames: ["V" + String(index + 1).padStart(3, "0")],
  refs: ["S" + String(index + 1).padStart(3, "0") + "_SCENE"],
  sceneRef: "S" + String(index + 1).padStart(3, "0") + "_SCENE",
  dialogues: [],
}));

const groups = groupSegments(segments);
assert.equal(groups.length, 6, "a 90-second story must produce six 15-second storyboard boards");
assert.deepEqual(groups.map((group) => group.duration), [15, 15, 15, 15, 15, 15]);
assert.deepEqual(groups.map((group) => [group.startSecond, group.endSecond]), [
  [0, 15], [15, 30], [30, 45], [45, 60], [60, 75], [75, 90],
]);

console.log("storyboard board count tests passed");
