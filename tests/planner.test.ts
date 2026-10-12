import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { FixturePlanner, HostPlanner, NeedsLessonError, createPlannerFromEnv, type LessonGuide } from "../src/lesson/planner.js";
import { lessonSchema, type Lesson, type Level } from "../src/lesson/schema.js";
import { APP_URI, createServer, LessonService } from "../src/server.js";
import type { NeedsLessonResult, VisualLesson } from "../src/render/types.js";

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

test("host mode is the default and unsupported demos request a host-written lesson; LLM configuration fails clearly", async () => {
  assert.ok(createPlannerFromEnv({}) instanceof HostPlanner);
  for (const topic of ["quantum mechanics", "Python event loop", "Node.js event loop"]) {
    await assert.rejects(createPlannerFromEnv({}).plan({ topic, level: "beginner" }), NeedsLessonError);
  }
  assert.throws(() => createPlannerFromEnv({ LESSON_PLANNER: "typo" }), /host, fixture, or llm/);
  assert.throws(() => createPlannerFromEnv({ LESSON_PLANNER: "llm" }), /LLM_MODEL and LLM_API_KEY/);
  assert.throws(() => createPlannerFromEnv({ ...llmEnv, LLM_TIMEOUT_MS: "NaN" }), /positive integer/);
});

const hostLesson: Lesson = {
  topic: "HTTP caching", title: "Reuse a response, then check freshness", level: "intermediate",
  summary: "A browser can reuse a cached response while it is fresh and ask the server to validate it after it becomes stale.",
  steps: [
    {
      id: "store", title: "Store an eligible response", explanation: "A cache stores a response when the request and response caching rules allow it.",
      takeaway: "Cacheability determines whether a response can be stored.", code: null,
      visual: { kind: "flow", nodes: [
        { id: "server", label: "Server response", detail: "Content plus caching headers", tone: "blue" },
        { id: "cache", label: "Browser cache", detail: "Keeps an eligible response", tone: "green" },
      ], edges: [{ from: "server", to: "cache", label: "store" }] },
    },
    {
      id: "reuse", title: "Reuse while fresh", explanation: "Cache-Control: max-age defines a freshness lifetime. A fresh cached response can be reused without a network request.",
      takeaway: "Freshness reduces requests as well as transferred bytes.", code: null,
      visual: { kind: "comparison", nodes: [
        { id: "fresh", label: "Fresh response", detail: "Age is within its freshness lifetime", tone: "green" },
        { id: "stale", label: "Stale response", detail: "Needs validation unless rules permit stale reuse", tone: "orange" },
      ], edges: [] },
    },
    {
      id: "validate", title: "Validate with an ETag", explanation: "For a stale response, send its ETag in If-None-Match. An unchanged representation produces 304 so the cached body can be reused.",
      takeaway: "A 304 validates the cached body; a changed representation returns a new body.", code: null,
      visual: { kind: "sequence", nodes: [
        { id: "etag", label: "If-None-Match", detail: "Browser sends its cached validator", tone: "blue" },
        { id: "check", label: "Server checks", detail: "Compare the current representation", tone: "purple" },
        { id: "unchanged", label: "304 Not Modified", detail: "Reuse the stored body when unchanged", tone: "green" },
      ], edges: [{ from: "etag", to: "check", label: "request" }, { from: "check", to: "unchanged", label: "unchanged" }] },
    },
  ],
};

test("a supplied host lesson draws at runtime without invoking any planner and preserves its level", async () => {
  for (const mode of ["host", "fixture", "llm"] as const) {
    const service = new LessonService({ plan: async () => { throw new Error("The planner must not be called"); } }, mode);
    const visual = await service.teach({ topic: hostLesson.topic, lesson: hostLesson });
    assert.equal(visual.planner, "host");
    assert.equal(visual.lesson.level, "intermediate");
    assert.equal(visual.sections.length, 3);
    assert.ok(visual.scene.elements.some(element => element.type === "text" && element.text === "Fresh response"));
    assert.equal(service.get(visual.id), visual);
    await assert.rejects(service.teach({ topic: "Another topic", lesson: hostLesson }), /topic must match/);
    await assert.rejects(service.teach({ topic: hostLesson.topic, level: "advanced", lesson: hostLesson }), /level must match/);
  }
});

test("MCP exposes host planning data without UI metadata and renders the host's arbitrary lesson without sampling", async () => {
  const service = new LessonService(createPlannerFromEnv({}), "host");
  const server = createServer(service, async () => "<html></html>");
  const client = new Client({ name: "host-planning-test", version: "1" }, { capabilities: {} });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  try {
    const { tools } = await client.listTools();
    const renderer = tools.find(tool => tool.name === "teach_visually")!;
    const guideTool = tools.find(tool => tool.name === "get_lesson_guide")!;
    assert.deepEqual(renderer._meta?.ui, { resourceUri: APP_URI });
    assert.equal(guideTool._meta?.ui, undefined);
    assert.ok(renderer.inputSchema.properties && "lesson" in renderer.inputSchema.properties);
    assert.equal((renderer.inputSchema.properties.lesson as { default?: unknown }).default, null);
    for (const [args, chapters] of [
      [{}, 5],
      [{ topic: "photosynthesis", lesson: null }, 4],
      [{ topic: "", level: "", lesson: { topic: "", title: "", level: "", summary: "", steps: "" } }, 5],
    ] as const) {
      const demo = await client.callTool({ name: "teach_visually", arguments: args });
      assert.ok(!demo.isError, JSON.stringify(demo.content));
      assert.equal((demo.structuredContent as unknown as VisualLesson).sections.length, chapters);
    }
    const malformed = await client.callTool({ name: "teach_visually", arguments: { topic: hostLesson.topic, lesson: { ...hostLesson, steps: JSON.stringify(hostLesson.steps) } } });
    assert.equal(malformed.isError, true, "Nonblank malformed host content must still be rejected");
    const missing = await client.callTool({ name: "teach_visually", arguments: { topic: hostLesson.topic, level: "intermediate" } });
    assert.ok(!missing.isError);
    assert.equal((missing.structuredContent as unknown as NeedsLessonResult).status, "needs_lesson");
    const guideResult = await client.callTool({ name: "get_lesson_guide", arguments: { topic: hostLesson.topic, level: "intermediate" } });
    const guide = guideResult.structuredContent as unknown as LessonGuide;
    assert.equal(guide.topic, hostLesson.topic);
    assert.equal(guide.level, "intermediate");
    assert.ok(guide.lessonSchema.properties?.steps);
    const result = await client.callTool({ name: "teach_visually", arguments: { topic: guide.topic, lesson: hostLesson } });
    assert.ok(!result.isError, JSON.stringify(result.content));
    const visual = result.structuredContent as unknown as VisualLesson;
    assert.equal(visual.planner, "host");
    assert.equal(visual.lesson.topic, hostLesson.topic);
    assert.equal(visual.lesson.level, "intermediate");
    assert.ok(visual.scene.elements.length > 0);
  } finally { await client.close(); await server.close(); }
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
