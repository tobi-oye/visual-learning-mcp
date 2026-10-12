import { z } from "zod";

export const levelSchema = z.enum(["beginner", "intermediate", "advanced"]);
const topicSchema = z.string().trim().min(1).max(200);

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

export const lessonGuideInputSchema = z.object({
  topic: topicSchema,
  level: levelSchema.default("beginner"),
});

export const DEFAULT_DEMO_TOPIC = "JavaScript event loop";
const blankText = z.string().trim().max(0);
// Inspector may submit an untouched/cleared nested form. Ignore only a fully
// blank envelope; nonblank incomplete lessons still fail normal validation.
const blankLessonFormSchema = z.object({
  topic: blankText.optional(),
  title: blankText.optional(),
  level: blankText.nullish(),
  summary: blankText.optional(),
  steps: z.union([blankText, z.array(z.never()).length(0)]).optional(),
}).strict();

function isCompleteLesson(lesson: Lesson | z.infer<typeof blankLessonFormSchema> | null): lesson is Lesson {
  // Both branches have already been validated; only a complete lesson has steps.
  return Array.isArray(lesson?.steps) && lesson.steps.length > 0;
}

export const teachInputSchema = z.object({
  topic: z.string().trim().max(200).default(DEFAULT_DEMO_TOPIC).describe("The user's learning topic. Defaults to the JavaScript event-loop demo if omitted or blank. Copy this into a supplied lesson.topic."),
  level: z.enum(["", "beginner", "intermediate", "advanced"]).nullish().meta({ default: "beginner" }).describe("Defaults to the supplied lesson's level, or beginner for demos. Blank means use that default."),
  // Three branches keep Inspector's optional object in a JSON editor instead
  // of expanding required nested fields. null is the ready-to-run demo value.
  lesson: z.union([lessonSchema, blankLessonFormSchema, z.null()]).default(null).describe("Leave null for the event-loop or photosynthesis demo. For arbitrary topics, the calling host assistant supplies a complete lesson object using its own reasoning; no API key is needed. Include 3–6 steps with 2–4 visual nodes each and unique IDs. Cards/comparison have empty edges; flow/sequence edges connect adjacent nodes in reading order. The server draws it in Excalidraw at runtime."),
}).superRefine((request, ctx) => {
  if (!isCompleteLesson(request.lesson)) return;
  if (request.lesson.topic.trim().toLowerCase() !== (request.topic || DEFAULT_DEMO_TOPIC).toLowerCase()) {
    ctx.addIssue({ code: "custom", path: ["lesson", "topic"], message: "Lesson topic must match the requested topic" });
  }
  if (request.level && request.lesson.level !== request.level) {
    ctx.addIssue({ code: "custom", path: ["lesson", "level"], message: "Lesson level must match the requested level" });
  }
});

export type Lesson = z.infer<typeof lessonSchema>;
export type LessonStep = Lesson["steps"][number];
export type TeachInput = z.input<typeof teachInputSchema>;
export type Level = z.infer<typeof levelSchema>;

export function resolveTeachInput(input: TeachInput): { topic: string; level: Level; lesson?: Lesson } {
  const request = teachInputSchema.parse(input);
  const lesson = isCompleteLesson(request.lesson) ? request.lesson : undefined;
  return {
    topic: request.topic || DEFAULT_DEMO_TOPIC,
    level: request.level || lesson?.level || "beginner",
    ...(lesson ? { lesson } : {}),
  };
}
