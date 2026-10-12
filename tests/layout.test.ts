import assert from "node:assert/strict";
import test from "node:test";
import { eventLoopFixture } from "../src/lesson/fixtures.js";
import { lessonSchema, type Lesson } from "../src/lesson/schema.js";
import { CANVAS_WIDTH, layoutLesson } from "../src/render/layout.js";

type Box = { x: number; y: number; width: number; height: number };
const inside = (outer: Box, inner: Box, margin = 0) => inner.x >= outer.x + margin && inner.y >= outer.y + margin
  && inner.x + inner.width <= outer.x + outer.width - margin + 0.001
  && inner.y + inner.height <= outer.y + outer.height - margin + 0.001;
const overlap = (a: Box, b: Box) => Math.min(a.x + a.width, b.x + b.width) > Math.max(a.x, b.x) + 0.001
  && Math.min(a.y + a.height, b.y + b.height) > Math.max(a.y, b.y) + 0.001;
function separated(boxes: Box[], description: string) {
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
    assert.ok(!overlap(boxes[i]!, boxes[j]!), `${description} ${i} and ${j} overlap`);
  }
}

function checkGeometry(lesson: Lesson) {
  const { scene, sections } = layoutLesson(lesson);
  assert.equal(scene.type, "excalidraw");
  assert.equal(sections.length, lesson.steps.length);
  assert.ok(sections.length >= 3 && sections.length <= 6);
  assert.equal(new Set(scene.elements.map(element => element.id)).size, scene.elements.length);
  separated(sections, "Sections");
  separated(scene.elements.filter(element => element.type === "text"), "Text boxes");
  const membership = new Set<string>();
  for (const [i, section] of sections.entries()) {
    const step = lesson.steps[i]!;
    assert.equal(section.id, step.id);
    assert.equal(section.number, i + 1);
    if (i) assert.ok(section.y - (sections[i - 1]!.y + sections[i - 1]!.height) >= 32);
    const members = scene.elements.filter(element => section.elementIds.includes(element.id));
    assert.equal(members.length, section.elementIds.length);
    for (const member of members) {
      assert.ok(!membership.has(member.id), "An element belongs to multiple sections");
      membership.add(member.id);
      assert.ok(inside(section, member, member.type === "text" ? 8 : 0), `${step.id}: ${member.id} escapes its section`);
    }
    assert.deepEqual(new Set(scene.elements.filter(element => inside(section, element)).map(element => element.id)), new Set(section.elementIds));
    const cards = step.visual.nodes.map(node => {
      const group = `${step.id}-node-${node.id}`;
      const elements = members.filter(element => element.groupIds.includes(group));
      const card = elements.find(element => element.type === "rectangle");
      assert.ok(card, `${group} has no card`);
      const texts = elements.filter(element => element.type === "text");
      assert.equal(texts.length, 2);
      for (const text of texts) assert.ok(inside(card, text, 12), `${group}: text leaves its card padding`);
      return card;
    });
    separated(cards, "Node cards");
    const arrows = members.filter(element => element.type === "arrow");
    assert.equal(arrows.length, step.visual.edges.length);
    for (const [j, edge] of step.visual.edges.entries()) {
      const index = step.visual.nodes.findIndex(node => node.id === edge.from);
      const first = cards[index]!;
      const next = cards[index + 1]!;
      const lane: Box = step.code
        ? { x: first.x, y: first.y + first.height, width: first.width, height: next.y - first.y - first.height }
        : { x: first.x + first.width, y: first.y, width: next.x - first.x - first.width, height: first.height };
      const arrow = arrows[j]!;
      assert.ok(arrow.type === "arrow");
      for (const point of arrow.points) assert.ok(inside(lane, { x: arrow.x + point[0], y: arrow.y + point[1], width: 0, height: 0 }, 3), "Connector leaves its gap lane");
      if (edge.label) {
        const label = members[members.indexOf(arrow) + 1]!;
        assert.equal(label.type, "text");
        assert.ok(inside(lane, label, 3), `${step.id}: arrow label leaves its gap lane`);
      }
    }
  }
  for (const element of scene.elements) {
    for (const value of [element.x, element.y, element.width, element.height]) assert.ok(Number.isFinite(value));
    assert.ok(element.x >= 0 && element.x + element.width <= CANVAS_WIDTH);
    if (element.type === "text") {
      assert.ok(element.width > 0 && element.height > 0);
      for (const line of element.text.split("\n")) {
        assert.ok(!Array.from(line).some(char => char.length === 1 && /[\uD800-\uDFFF]/.test(char)), "Wrapping splits a Unicode code point");
      }
    }
  }
}

test("event-loop lesson keeps all five sections readable and connectors in their lanes", () => {
  checkGeometry(eventLoopFixture("JavaScript event loop", "beginner"));
});

for (const count of [3, 6]) test(`${count}-step maximum-length Unicode lesson preserves geometry`, () => {
  const lesson = lessonSchema.parse({
    topic: "Unicode layout stress case", title: "学习".repeat(45), level: "advanced", summary: "学习".repeat(120),
    steps: Array.from({ length: count }, (_, i) => {
      const nodes = Array.from({ length: 2 + i % 3 }, (_, j) => ({ id: `n${j}`, label: "学习".repeat(24), detail: "学习".repeat(65), tone: "blue" }));
      return {
        id: `step-${i}`, title: "学习".repeat(36), explanation: "学习".repeat(130), takeaway: "学习".repeat(90),
        visual: { kind: "sequence", nodes, edges: nodes.slice(1).map((node, j) => ({ from: nodes[j]!.id, to: node.id, label: "学习".repeat(14) })) },
        code: i % 3 === 2 ? { language: "javascript", source: "const 学 = '" + "🙂学".repeat(160) + "';", output: "🙂学".repeat(65) } : null,
      };
    }),
  });
  checkGeometry(lesson);
});
