import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import { lessonSchema, type Lesson } from "../lesson/schema.js";
import type { SceneDocument, SectionBounds } from "./types.js";

export const CANVAS_WIDTH = 1120;
const INK = "#243d36";
const MUTED = "#536660";
const PALETTE = {
  blue: { fill: "#eaf3fc", stroke: "#4477a3" },
  purple: { fill: "#f1ecfa", stroke: "#8064b0" },
  orange: { fill: "#fff2e3", stroke: "#b87837" },
  green: { fill: "#e9f4ed", stroke: "#477a5d" },
};

// Conservative Helvetica metrics. Wide Unicode characters reserve a full em;
// the extra margin accommodates browser font substitution and hand-drawn edges.
export function textWidth(text: string, size: number): number {
  return Array.from(text).reduce((sum, char) => {
    const factor = /[MW@%]/.test(char) ? 1.02 : /[ilI.,:;!'| ]/.test(char) ? 0.36 : /[A-Z0-9]/.test(char) ? 0.76 : /[^\x00-\x7F]/.test(char) ? 1.08 : 0.65;
    return sum + factor * size;
  }, 0);
}

export function wrapText(text: string, width: number, size: number): string {
  const lines: string[] = [];
  for (const paragraph of text.split("\n")) {
    let line = "";
    for (const word of paragraph.split(/\s+/)) {
      if (!word) continue;
      if (textWidth(line ? `${line} ${word}` : word, size) <= width) {
        line = line ? `${line} ${word}` : word;
        continue;
      }
      if (line) { lines.push(line); line = ""; }
      let part = "";
      for (const char of word) {
        if (part && textWidth(part + char, size) > width) { lines.push(part); part = ""; }
        part += char;
      }
      line = part;
    }
    lines.push(line);
  }
  return lines.join("\n");
}

export function layoutLesson(input: Lesson): { scene: SceneDocument; sections: SectionBounds[] } {
  const lesson = lessonSchema.parse(input);
  const elements: ExcalidrawElement[] = [];
  const sections: SectionBounds[] = [];
  let serial = 0;
  let group: string | null = null;
  const base = (type: string, x: number, y: number, width: number, height: number, overrides: Record<string, unknown> = {}) => {
    const id = `vl-${++serial}`;
    const element = {
      id, type, x, y, width, height, angle: 0, strokeColor: INK,
      backgroundColor: "transparent", fillStyle: "solid", strokeWidth: 1.5,
      strokeStyle: "solid", roughness: 0, opacity: 100,
      groupIds: group ? [group] : [], frameId: null, index: null,
      roundness: null, seed: serial * 997, version: 1, versionNonce: serial * 991,
      isDeleted: false, boundElements: null, updated: 1, link: null, locked: false,
      ...overrides,
    } as unknown as ExcalidrawElement;
    elements.push(element);
    return element;
  };
  const rect = (x: number, y: number, w: number, h: number, fill: string, stroke = "#d9e3de") => base("rectangle", x, y, w, h, { backgroundColor: fill, strokeColor: stroke, roundness: { type: 3 } });
  const text = (value: string, x: number, y: number, width: number, size = 22, color = INK, code = false) => {
    // Cascadia is monospaced; reserve 0.66em to safely preserve code indentation.
    const wrapped = code ? wrapCode(value, width, size) : wrapText(value, width, size);
    const height = wrapped.split("\n").length * size * 1.25;
    base("text", x, y, width, height, {
      text: wrapped, originalText: wrapped, fontSize: size, fontFamily: code ? 3 : 2,
      textAlign: "left", verticalAlign: "top", containerId: null,
      autoResize: false, lineHeight: 1.25, strokeColor: color,
    });
    return height;
  };

  text("A LITTLE CLARITY / VISUAL LESSON", 60, 40, 1000, 17, "#477a5d");
  let y = 88;
  y += text(lesson.title, 60, y, 1000, 42) + 18;
  y += text(lesson.summary, 60, y, 1000, 23, MUTED) + 24;
  text(`${lesson.level.toUpperCase()}  ·  ${lesson.steps.length} STEPS  ·  READ TOP TO BOTTOM`, 60, y, 1000, 16, MUTED);
  y += 64;

  for (const [index, step] of lesson.steps.entries()) {
    const sectionY = y;
    const firstElement = elements.length;
    // Background inserted first so text and cards always render above it.
    group = null;
    const backdrop = rect(40, y, 1040, 400, "#ffffff");
    const number = base("ellipse", 72, y + 30, 48, 48, { backgroundColor: "#e9f4ed", strokeColor: "#e9f4ed" });
    text(String(index + 1).padStart(2, "0"), number.x + 10, number.y + 10, 36, 22, "#477a5d");
    const titleHeight = text(step.title, 142, y + 34, 882, 30);
    let contentY = y + Math.max(98, 34 + titleHeight + 18);
    contentY += text(step.explanation, 78, contentY, 964, 22, MUTED) + 30;

    const nodes = step.visual.nodes;
    if (step.code) {
      const source = wrapCode(step.code.source, 520, 20);
      const sourceHeight = source.split("\n").length * 25;
      const output = wrapCode(step.code.output, 520, 20);
      const outputHeight = output.split("\n").length * 25;
      const codeHeight = 92 + sourceHeight + 64 + outputHeight;
      rect(78, contentY, 572, codeHeight, "#f5f7f5");
      text(`${step.code.language.toUpperCase()} / TRY IT`, 102, contentY + 22, 520, 16, MUTED);
      text(source, 102, contentY + 62, 520, 20, INK, true);
      text("EXPECTED OUTPUT", 102, contentY + 86 + sourceHeight, 520, 16, "#477a5d");
      text(output, 102, contentY + 118 + sourceHeight, 520, 20, "#477a5d", true);
      let nodeY = contentY;
      for (const [i, node] of nodes.entries()) {
        group = `${step.id}-node-${node.id}`;
        const label = wrapText(node.label, 294, 22);
        const detail = wrapText(node.detail, 294, 19);
        const h = 38 + label.split("\n").length * 27.5 + detail.split("\n").length * 23.75;
        const palette = PALETTE[node.tone];
        rect(690, nodeY, 352, h, palette.fill, palette.stroke);
        text(label, 714, nodeY + 16, 304, 22);
        text(detail, 714, nodeY + 24 + label.split("\n").length * 27.5, 304, 19, MUTED);
        group = null;
        let gap = 42;
        if (i < nodes.length - 1) {
          const edge = step.visual.edges.find(e => e.from === node.id && e.to === nodes[i + 1].id);
          if (edge) {
            const labelHeight = edge.label ? wrapText(edge.label, 140, 13).split("\n").length * 16.25 : 0;
            gap = Math.max(gap, labelHeight + 14);
            drawArrow(866, nodeY + h + 6, 0, gap - 18, edge.label, true);
          }
        }
        nodeY += h + (i < nodes.length - 1 ? gap : 0);
      }
      contentY = Math.max(contentY + codeHeight, nodeY);
    } else {
      const gap = Math.min(108, Math.max(56, ...step.visual.edges.map(edge => textWidth(edge.label, 13) + 16)));
      const labelWidth = gap - 16;
      const width = (964 - gap * (nodes.length - 1)) / nodes.length;
      const inner = width - 36;
      const metrics = nodes.map(node => ({
        label: wrapText(node.label, inner, 22),
        detail: wrapText(node.detail, inner, 20),
      }));
      const labelHeight = Math.max(0, ...step.visual.edges.map(edge => edge.label ? wrapText(edge.label, labelWidth, 13).split("\n").length * 16.25 : 0));
      const h = Math.max(2 * (labelHeight + 26), ...metrics.map(m => 48 + m.label.split("\n").length * 27.5 + m.detail.split("\n").length * 25));
      nodes.forEach((node, i) => {
        const x = 78 + i * (width + gap);
        const palette = PALETTE[node.tone];
        const m = metrics[i];
        group = `${step.id}-node-${node.id}`;
        rect(x, contentY, width, h, palette.fill, palette.stroke);
        text(m.label, x + 18, contentY + 18, inner, 22);
        text(m.detail, x + 18, contentY + 30 + m.label.split("\n").length * 27.5, inner, 20, MUTED);
        group = null;
        if (i < nodes.length - 1) {
          const edge = step.visual.edges.find(e => e.from === node.id && e.to === nodes[i + 1].id);
          if (edge) drawArrow(x + width + 7, contentY + h / 2, gap - 14, 0, edge.label, false, labelWidth);
        }
      });
      contentY += h;
    }
    group = null;
    contentY += 28;
    const takeawayHeight = wrapText(step.takeaway, 916, 20).split("\n").length * 25;
    rect(78, contentY, 964, takeawayHeight + 32, "#f1f6f2", "#f1f6f2");
    text(step.takeaway, 102, contentY + 16, 916, 20, "#477a5d");
    const sectionHeight = contentY + takeawayHeight + 64 - sectionY;
    // Elements are mutable only while constructing a fresh scene.
    Object.assign(backdrop, { height: sectionHeight });
    sections.push({ id: step.id, title: step.title, number: index + 1, x: 40, y: sectionY, width: 1040, height: sectionHeight, elementIds: elements.slice(firstElement).map(e => e.id) });
    y = sectionY + sectionHeight + 48;
  }
  text("You have the whole picture. Make it yours — annotate, move, or export this canvas.", 60, y, 1000, 18, MUTED);

  function drawArrow(x: number, y: number, dx: number, dy: number, label: string, vertical: boolean, labelWidth = 140) {
    base("arrow", x, y, dx, dy, { points: [[0, 0], [dx, dy]], startBinding: null, endBinding: null, startArrowhead: null, endArrowhead: "arrow", elbowed: false, lastCommittedPoint: null, strokeColor: "#8c9e95" });
    if (label) {
      // Labels stay in the gap lane, clear of card text and the arrow stroke.
      if (vertical) text(label, x + 16, y + 1, 140, 13, MUTED);
      else {
        const line = wrapText(label, labelWidth, 13);
        const height = line.split("\n").length * 16.25;
        text(line, x + dx / 2 - labelWidth / 2, y - 14 - height, labelWidth, 13, MUTED);
      }
    }
  }
  return { scene: { type: "excalidraw", version: 2, source: "visual-learning-mcp", elements, appState: { viewBackgroundColor: "#f7f9f6" }, files: {} }, sections };
}

function wrapCode(value: string, width: number, size: number) {
  return value.split("\n").flatMap(line => {
    const lines: string[] = [];
    let part = "";
    let measured = 0;
    for (const char of line) {
      const advance = /[^\x00-\x7F]/.test(char) ? textWidth(char, size) : size * 0.66;
      if (part && measured + advance > width) { lines.push(part); part = ""; measured = 0; }
      part += char;
      measured += advance;
    }
    lines.push(part);
    return lines;
  }).join("\n");
}
