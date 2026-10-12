import { z } from "zod";

export const levelSchema = z.enum(["beginner", "intermediate", "advanced"]);
export const teachInputSchema = z.object({
  topic: z.string().trim().min(1).max(200),
  level: levelSchema.default("beginner"),
});

const nodeSchema = z.object({
  id: z.string().min(1).max(40),
  label: z.string().min(1).max(48),
  detail: z.string().min(1).max(130),
  tone: z.enum(["blue", "purple", "orange", "green"]),
}).strict();
const edgeSchema = z.object({
  from: z.string().min(1).max(40),
  to: z.string().min(1).max(40),
  label: z.string().max(28),
}).strict();
export const stepSchema = z.object({
  id: z.string().min(1).max(40),
  title: z.string().min(1).max(72),
  explanation: z.string().min(1).max(260),
  takeaway: z.string().min(1).max(180),
  visual: z.object({
    kind: z.enum(["cards", "flow", "comparison", "sequence"]),
    nodes: z.array(nodeSchema).min(2).max(4),
    edges: z.array(edgeSchema).max(3),
  }).strict(),
  code: z.object({
    language: z.string().min(1).max(20),
    source: z.string().min(1).max(700),
    output: z.string().min(1).max(200),
  }).strict().nullable(),
}).strict();

export const lessonSchema = z.object({
  topic: z.string().min(1).max(200),
  title: z.string().min(1).max(90),
  level: levelSchema,
  summary: z.string().min(1).max(240),
  steps: z.array(stepSchema).min(3).max(6),
}).strict().superRefine((lesson, ctx) => {
  const stepIds = new Set<string>();
  for (const [i, step] of lesson.steps.entries()) {
    if (stepIds.has(step.id)) ctx.addIssue({ code: "custom", path: ["steps", i, "id"], message: "Step IDs must be unique" });
    stepIds.add(step.id);
    const ids = new Set(step.visual.nodes.map(node => node.id));
    if (ids.size !== step.visual.nodes.length) ctx.addIssue({ code: "custom", path: ["steps", i, "visual", "nodes"], message: "Node IDs must be unique within a step" });
    const edgePairs = new Set<string>();
    for (const [j, edge] of step.visual.edges.entries()) {
      const a = step.visual.nodes.findIndex(node => node.id === edge.from);
      const b = step.visual.nodes.findIndex(node => node.id === edge.to);
      // A single reading lane keeps arrows away from unrelated content.
      if (!ids.has(edge.from) || !ids.has(edge.to) || b !== a + 1) ctx.addIssue({ code: "custom", path: ["steps", i, "visual", "edges", j], message: "Edges must connect adjacent nodes in reading order" });
      const pair = JSON.stringify([edge.from, edge.to]);
      if (edgePairs.has(pair)) ctx.addIssue({ code: "custom", path: ["steps", i, "visual", "edges", j], message: "Relationships must be unique" });
      edgePairs.add(pair);
    }
    if ((step.visual.kind === "cards" || step.visual.kind === "comparison") && step.visual.edges.length) ctx.addIssue({ code: "custom", path: ["steps", i, "visual", "edges"], message: "Cards and comparisons do not need arrows" });
  }
});

export type Lesson = z.infer<typeof lessonSchema>;
export type LessonStep = Lesson["steps"][number];
export type TeachInput = z.infer<typeof teachInputSchema>;
export type Level = z.infer<typeof levelSchema>;
