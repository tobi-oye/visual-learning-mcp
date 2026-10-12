import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerAppResource, registerAppTool, RESOURCE_MIME_TYPE } from "@modelcontextprotocol/ext-apps/server";
import { createLessonGuide, NeedsLessonError, type LessonPlanner, type LessonPlannerMode } from "./lesson/planner.js";
import { lessonGuideInputSchema, resolveTeachInput, teachInputSchema, type TeachInput } from "./lesson/schema.js";
import { layoutLesson } from "./render/layout.js";
import type { NeedsLessonResult, VisualLesson } from "./render/types.js";

export const APP_URI = "ui://visual-learning/lesson.html";
export class LessonService {
  private readonly lessons = new Map<string, VisualLesson>();
  constructor(private readonly planner: LessonPlanner, readonly mode: LessonPlannerMode, private readonly cacheScenes = true) {}
  async teach(input: TeachInput): Promise<VisualLesson> {
    const request = resolveTeachInput(input);
    const lesson = request.lesson ? { ...request.lesson, topic: request.topic } : await this.planner.plan(request);
    const { scene, sections } = layoutLesson(lesson);
    const id = crypto.randomUUID();
    const visual: VisualLesson = { id, lesson, scene, sections, planner: request.lesson ? "host" : this.mode === "llm" ? "llm" : "fixture", ...(this.cacheScenes ? { resourceUri: `lesson://${id}/scene` } : {}) };
    if (this.cacheScenes) {
      this.lessons.set(id, visual);
      if (this.lessons.size > 32) this.lessons.delete(this.lessons.keys().next().value!);
    }
    return visual;
  }
  get(id: string): VisualLesson | undefined { return this.lessons.get(id); }
}

export function createServer(service: LessonService, loadUi: () => Promise<string>, options: { includeSceneResources?: boolean } = {}): McpServer {
  const server = new McpServer({ name: "visual-learning", version: "0.1.0" });
  registerAppTool(server, "teach_visually", {
    title: "Teach visually",
    description: "Draw a complete 3–6 step visual lesson on one editable Excalidraw canvas at runtime. To preview the demo, call with only topic (JavaScript event loop or photosynthesis), or no arguments for the event-loop demo; level defaults to beginner and lesson to null. For arbitrary topics, you (the calling ChatGPT/Codex host assistant) must write the complete lesson object using your own reasoning and pass it in the same call. get_lesson_guide provides the schema and guidance. No server model, API key, or MCP sampling is required. Copy the requested topic and level exactly. If a topic-only call returns needs_lesson, complete the lesson and call this tool again without asking the user to repeat their prompt.",
    inputSchema: teachInputSchema,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: service.mode === "llm" },
    _meta: { ui: { resourceUri: APP_URI } },
  }, async input => {
    try {
      const visual = await service.teach(input);
      return {
        content: [
          { type: "text" as const, text: `${visual.lesson.title}\n${visual.lesson.summary}\n\n${visual.lesson.steps.map((step, i) => `${i + 1}. ${step.title}: ${step.takeaway}`).join("\n")}\n\nAll sections share one editable canvas. structuredContent.scene contains the complete .excalidraw JSON; UI exports include your edits.` },
          ...(visual.resourceUri ? [{ type: "resource_link" as const, uri: visual.resourceUri, name: `${visual.lesson.title}.excalidraw`, mimeType: "application/vnd.excalidraw+json", description: "Download or read the complete editable Excalidraw scene." }] : []),
        ],
        structuredContent: { ...visual },
      };
    } catch (error) {
      if (error instanceof NeedsLessonError) {
        const result: NeedsLessonResult = { status: "needs_lesson", topic: error.guide.topic, level: error.guide.level, guide: error.guide };
        return {
          content: [{ type: "text" as const, text: error.message }],
          structuredContent: { ...result },
        };
      }
      return { isError: true, content: [{ type: "text" as const, text: error instanceof Error ? error.message : "Could not create the lesson." }] };
    }
  });
  server.registerTool("get_lesson_guide", {
    title: "Plan a visual lesson",
    description: "Get the lesson schema and visual teaching rules for a topic. This is a data-only planning tool for the calling host assistant; use your own reasoning to create the lesson, then call teach_visually with it. No server API key or MCP sampling is needed. This tool does not open the lesson UI.",
    inputSchema: lessonGuideInputSchema,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async input => {
    const guide = createLessonGuide(input);
    return {
      content: [{ type: "text" as const, text: `${guide.instructions.join("\n")}\n\nLesson JSON Schema:\n${JSON.stringify(guide.lessonSchema)}` }],
      structuredContent: { ...guide },
    };
  });
  registerAppResource(server, "visual-lesson-app", APP_URI, { mimeType: RESOURCE_MIME_TYPE }, async () => ({
    contents: [{ uri: APP_URI, mimeType: RESOURCE_MIME_TYPE, text: await loadUi(), _meta: { ui: { csp: { connectDomains: [], resourceDomains: [] }, prefersBorder: false } } }],
  }));
  if (options.includeSceneResources !== false) server.registerResource("editable-lesson", new ResourceTemplate("lesson://{id}/scene", { list: undefined }), {
    title: "Editable lesson scene", mimeType: "application/vnd.excalidraw+json",
  }, async (uri, variables) => {
    const visual = service.get(String(variables.id));
    if (!visual) throw new Error("Lesson expired or was not found. Generate it again (the latest 32 lessons are held in memory).");
    return { contents: [{ uri: uri.href, mimeType: "application/vnd.excalidraw+json", text: JSON.stringify(visual.scene) }] };
  });
  return server;
}
