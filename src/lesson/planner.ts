import { z } from "zod";
import { eventLoopFixture, photosynthesisFixture } from "./fixtures.js";
import { lessonSchema, teachInputSchema, type Lesson, type TeachInput } from "./schema.js";

export interface LessonPlanner {
  plan(input: TeachInput): Promise<Lesson>;
}

export class FixturePlanner implements LessonPlanner {
  async plan(input: TeachInput): Promise<Lesson> {
    const request = teachInputSchema.parse(input);
    const topic = request.topic.toLowerCase().replace(/[?.!]+$/, "")
      .replace(/^(?:explain|teach me about|teach me|teach|how does|what is)\s+/, "")
      .replace(/^how\s+/, "").replace(/^the\s+/, "").replace(/\s+works?$/, "");
    if (topic === "photosynthesis") return photosynthesisFixture(request.topic, request.level);
    if (/^(?:(?:javascript|js|browser|browser javascript|javascript browser)\s+)?event[ -]loop$/.test(topic)) {
      return eventLoopFixture(request.topic, request.level);
    }
    throw new Error("Fixture mode supports the browser JavaScript event loop and photosynthesis. For other topics, set LESSON_PLANNER=llm, LLM_MODEL, and LLM_API_KEY.");
  }
}

const completionSchema = z.object({
  choices: z.array(z.object({
    finish_reason: z.string().nullable().optional(),
    message: z.object({
      content: z.string().nullable().optional(),
      refusal: z.string().nullable().optional(),
    }),
  })).min(1),
});

// The provider's strict JSON Schema subset cannot express custom refinements.
// Keep shape/enums in the request; enforce all length limits and graph rules locally.
const omittedSchemaKeywords = new Set(["$schema", "minLength", "maxLength", "minItems", "maxItems"]);
function providerSchema(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(providerSchema);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !omittedSchemaKeywords.has(key))
    .map(([key, child]) => [key, providerSchema(child)]));
}

const outputSchema = providerSchema(z.toJSONSchema(lessonSchema));
const systemPrompt = [
  "You are a careful visual teacher. Return only a lesson that matches the supplied JSON Schema.",
  "Copy the requested topic and level exactly. Teach the requested topic accurately in 3-6 logical steps.",
  "Each step needs a short title, explanation, takeaway, and 2-4 concise visual nodes.",
  "Use cards for separate components, comparison for alternatives, and flow or sequence for ordered stages.",
  "Minimize arrows: cards and comparison have empty edges. Other edges connect adjacent nodes in array order only, from node i to node i+1.",
  "All step IDs are unique; node IDs are unique within each step. No cycles, back edges, or cross-section edges.",
  "Use these maximum character counts: title 90, summary 240, step title 72, explanation 260, takeaway 180, node label 48, node detail 130, edge label 28.",
  "Keep IDs at most 40 characters. Code is null unless a short relevant example helps; if present, use language at most 20, source at most 700, and output at most 200 characters.",
  "Format code with short, syntactically valid lines (prefer at most 36 ASCII characters per line) so the whiteboard never needs to split an identifier or string. Use fewer than 12 source lines when practical.",
  "Beginner: explain unfamiliar words. Intermediate: add mechanism and a useful distinction. Advanced: include precise assumptions and one important limitation.",
  "Use an example to complete the lesson so a learner can understand it without another prompt. Never invent facts or code output.",
].join("\n");

class LlmPlanner implements LessonPlanner {
  constructor(private readonly config: { model: string; apiKey: string; endpoint: string; timeoutMs: number }) {}

  async plan(input: TeachInput): Promise<Lesson> {
    const request = teachInputSchema.parse(input);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs);
    try {
      let response: Response;
      try {
        response = await fetch(this.config.endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.config.apiKey}` },
          signal: controller.signal,
          body: JSON.stringify({
            model: this.config.model,
            messages: [
              { role: "system", content: systemPrompt },
              { role: "user", content: JSON.stringify(request) },
            ],
            response_format: {
              type: "json_schema",
              json_schema: { name: "visual_lesson", strict: true, schema: outputSchema },
            },
          }),
        });
      } catch {
        if (controller.signal.aborted) throw new Error(`Lesson planning timed out after ${this.config.timeoutMs} ms. Increase LLM_TIMEOUT_MS or try again.`);
        throw new Error("Could not reach the lesson provider. Check LLM_BASE_URL and network access.");
      }
      if (!response.ok) {
        const hint = response.status === 401 || response.status === 403
          ? "Check LLM_API_KEY and model access."
          : response.status === 429
            ? "Check provider quota or retry later."
            : response.status === 400 || response.status === 404
              ? "Check LLM_BASE_URL, LLM_MODEL, and support for strict JSON Schema output."
              : "Retry later or check provider availability.";
        throw new Error(`Lesson provider returned HTTP ${response.status}. ${hint}`);
      }
      let body: unknown;
      try { body = await response.json(); }
      catch {
        if (controller.signal.aborted) throw new Error(`Lesson planning timed out after ${this.config.timeoutMs} ms. Increase LLM_TIMEOUT_MS or try again.`);
        throw new Error("Lesson provider returned invalid JSON. Use an OpenAI-compatible Chat Completions endpoint.");
      }
      const completion = completionSchema.safeParse(body);
      if (!completion.success) throw new Error("Lesson provider returned an invalid Chat Completions response. Check LLM_BASE_URL and model compatibility.");
      const choice = completion.data.choices[0]!;
      if (choice.message.refusal || choice.finish_reason === "content_filter") throw new Error("The lesson provider declined this topic. Try rephrasing the learning request.");
      if (choice.finish_reason === "length") throw new Error("The lesson provider truncated its output. Try a narrower topic or a model with a larger output limit.");
      if (choice.finish_reason && choice.finish_reason !== "stop") throw new Error("The lesson provider did not complete a lesson. Use a model that supports strict JSON Schema output.");
      if (!choice.message.content) throw new Error("The lesson provider returned no lesson content. Try again or choose another model.");
      let candidate: unknown;
      try { candidate = JSON.parse(choice.message.content); }
      catch { throw new Error("The lesson provider returned malformed lesson JSON. Choose a model that supports strict JSON Schema output."); }
      const parsed = lessonSchema.safeParse(candidate);
      if (!parsed.success) {
        const paths = [...new Set(parsed.error.issues.map(issue => issue.path.join(".") || "lesson"))].slice(0, 3).join(", ");
        throw new Error(`The generated lesson failed validation at ${paths}. Retry or choose a model that follows the lesson schema.`);
      }
      if (parsed.data.topic.trim().toLowerCase() !== request.topic.toLowerCase() || parsed.data.level !== request.level) {
        throw new Error("The generated lesson did not match the requested topic and level. Retry or choose another model.");
      }
      return { ...parsed.data, topic: request.topic };
    } finally {
      clearTimeout(timeout);
    }
  }
}

export function createPlannerFromEnv(env: Record<string, string | undefined> = process.env): LessonPlanner {
  const mode = env.LESSON_PLANNER?.trim() || "fixture";
  if (mode === "fixture") return new FixturePlanner();
  if (mode !== "llm") throw new Error("LESSON_PLANNER must be fixture or llm.");
  const model = env.LLM_MODEL?.trim();
  const apiKey = env.LLM_API_KEY?.trim();
  if (!model || !apiKey) throw new Error("LLM planner requires LLM_MODEL and LLM_API_KEY.");
  const timeoutMs = Number(env.LLM_TIMEOUT_MS ?? "60000");
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 2_147_483_647) throw new Error("LLM_TIMEOUT_MS must be a positive integer no larger than 2147483647.");
  let base: URL;
  try { base = new URL(env.LLM_BASE_URL?.trim() || "https://api.openai.com/v1"); }
  catch { throw new Error("LLM_BASE_URL must be a valid http or https API base URL."); }
  if (!["http:", "https:"].includes(base.protocol) || base.username || base.password || base.search || base.hash) {
    throw new Error("LLM_BASE_URL must be an http or https API base URL without credentials, a query, or a fragment.");
  }
  base.pathname = `${base.pathname.replace(/\/+$/, "")}/chat/completions`;
  return new LlmPlanner({ model, apiKey, endpoint: base.toString(), timeoutMs });
}
