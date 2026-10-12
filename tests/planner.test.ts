import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { FixturePlanner, createPlannerFromEnv } from "../src/lesson/planner.js";
import { lessonSchema, type Lesson, type Level } from "../src/lesson/schema.js";

const llmEnv = { LESSON_PLANNER: "llm", LLM_MODEL: "test-model", LLM_API_KEY: "secret-test-key", LLM_BASE_URL: "http://localhost:9000/v1/" };
const completion = (content: unknown) => new Response(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify(content) } }] }));

test("fixtures are complete, level-aware lessons and the event-loop code prints A D C B", async () => {
  const planner = new FixturePlanner();
  const explanations = new Set<string>();
  for (const level of ["beginner", "intermediate", "advanced"] as Level[]) {
    const lesson = await planner.plan({ topic: "JavaScript event loop", level });
    assert.equal(lesson.steps.length, 5);
    assert.equal(lesson.level, level);
    assert.ok(lessonSchema.safeParse(lesson).success);
    explanations.add(lesson.steps.map(step => step.explanation).join(" "));
    const biology = await planner.plan({ topic: "photosynthesis", level });
    assert.equal(biology.steps.length, 4);
    assert.equal(biology.level, level);
  }
  assert.equal(explanations.size, 3);
  const lesson = await planner.plan({ topic: "Explain how the JavaScript event loop works.", level: "beginner" });
  const logs: string[] = [];
  const timers: (() => void)[] = [];
  vm.runInNewContext(lesson.steps[4]!.code!.source, {
    console: { log: (value: string) => logs.push(value) },
    setTimeout: (callback: () => void) => timers.push(callback),
  }, { microtaskMode: "afterEvaluate" });
  for (const callback of timers) callback();
  assert.equal(logs.join("\n"), lesson.steps[4]!.code!.output);
});

test("fixture mode rejects topics it cannot truthfully teach; LLM configuration fails clearly", async () => {
  for (const topic of ["quantum mechanics", "Python event loop", "Node.js event loop"]) {
    await assert.rejects(createPlannerFromEnv({}).plan({ topic, level: "beginner" }), /LESSON_PLANNER=llm/);
  }
  assert.throws(() => createPlannerFromEnv({ LESSON_PLANNER: "typo" }), /fixture or llm/);
  assert.throws(() => createPlannerFromEnv({ LESSON_PLANNER: "llm" }), /LLM_MODEL and LLM_API_KEY/);
  assert.throws(() => createPlannerFromEnv({ ...llmEnv, LLM_TIMEOUT_MS: "NaN" }), /positive integer/);
});

test("lesson schema rejects duplicate IDs, backward edges, and arrows on cards", async () => {
  const lesson = await new FixturePlanner().plan({ topic: "JavaScript event loop", level: "beginner" });
  const duplicate = structuredClone(lesson);
  duplicate.steps[1]!.id = duplicate.steps[0]!.id;
  assert.equal(lessonSchema.safeParse(duplicate).success, false);
  const backward = structuredClone(lesson);
  backward.steps[1]!.visual.edges[0] = { from: "call", to: "start", label: "back" };
  assert.equal(lessonSchema.safeParse(backward).success, false);
  const cards = structuredClone(lesson);
  cards.steps[0]!.visual.edges.push({ from: "stack", to: "apis", label: "next" });
  assert.equal(lessonSchema.safeParse(cards).success, false);
});

test("LLM sends strict structured output and preserves the requested topic and level", async t => {
  const lesson = await new FixturePlanner().plan({ topic: "photosynthesis", level: "intermediate" });
  let submitted: Record<string, any> | undefined;
  t.mock.method(globalThis, "fetch", async (url: string, init: RequestInit) => {
    assert.equal(url, "http://localhost:9000/v1/chat/completions");
    submitted = JSON.parse(init.body as string);
    return completion(lesson);
  });
  assert.deepEqual(await createPlannerFromEnv(llmEnv).plan({ topic: "photosynthesis", level: "intermediate" }), lesson);
  assert.equal(submitted!.response_format.type, "json_schema");
  assert.equal(submitted!.response_format.json_schema.strict, true);
  const schema = submitted!.response_format.json_schema.schema;
  assert.equal(schema.additionalProperties, false);
  assert.equal(schema.$schema, undefined);
  assert.equal(schema.properties.steps.minItems, undefined);
  assert.equal(schema.properties.steps.items.properties.code.anyOf[1].type, "null");
});

test("LLM rejects unsafe graph output, mismatched requests, refusal, and provider errors without leaking secrets", async t => {
  const lesson = await new FixturePlanner().plan({ topic: "photosynthesis", level: "beginner" });
  let response: Response;
  t.mock.method(globalThis, "fetch", async () => response);
  const planner = createPlannerFromEnv(llmEnv);
  const invalid = structuredClone(lesson);
  invalid.steps[1]!.visual.edges[0]!.to = "not-a-node";
  const cases: [Response, RegExp][] = [
    [completion(invalid), /failed validation/],
    [completion({ ...lesson, level: "advanced" } satisfies Lesson), /topic and level/],
    [new Response(JSON.stringify({ choices: [{ message: { refusal: "secret-test-key" } }] })), /declined/],
    [new Response("secret-test-key", { status: 401 }), /HTTP 401/],
    [new Response(JSON.stringify({ choices: [{ message: { content: "not json" } }] })), /malformed lesson JSON/],
  ];
  for (const [next, expected] of cases) {
    response = next;
    await assert.rejects(planner.plan({ topic: "photosynthesis", level: "beginner" }), (error: Error) => {
      assert.match(error.message, expected);
      assert.ok(!error.message.includes("secret-test-key"));
      return true;
    });
  }
});

test("LLM timeout aborts the request and reports a useful error", async t => {
  t.mock.method(globalThis, "fetch", async (_url: string, init: RequestInit) => new Promise<Response>((_resolve, reject) => {
    init.signal!.addEventListener("abort", () => reject(new Error("abort")), { once: true });
  }));
  await assert.rejects(createPlannerFromEnv({ ...llmEnv, LLM_TIMEOUT_MS: "5" }).plan({ topic: "photosynthesis", level: "beginner" }), /timed out after 5 ms/);
});
