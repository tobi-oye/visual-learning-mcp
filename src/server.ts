import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerAppResource, registerAppTool, RESOURCE_MIME_TYPE } from "@modelcontextprotocol/ext-apps/server";
import type { LessonPlanner } from "./lesson/planner.js";
import { teachInputSchema, type TeachInput } from "./lesson/schema.js";
import { layoutLesson } from "./render/layout.js";
import type { VisualLesson } from "./render/types.js";

export const APP_URI = "ui://visual-learning/lesson.html";
export class LessonService {
  private readonly lessons = new Map<string, VisualLesson>();
  constructor(private readonly planner: LessonPlanner, readonly mode: "fixture" | "llm", private readonly cacheScenes = true) {}
  async teach(input: TeachInput): Promise<VisualLesson> {
    const lesson = await this.planner.plan(teachInputSchema.parse(input));
    const { scene, sections } = layoutLesson(lesson);
    const id = crypto.randomUUID();
    const visual: VisualLesson = { id, lesson, scene, sections, planner: this.mode, ...(this.cacheScenes ? { resourceUri: `lesson://${id}/scene` } : {}) };
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
    description: "Explain a learning topic as a complete 3–6 step visual lesson on one editable Excalidraw canvas. Choose beginner, intermediate, or advanced. Fixture mode supports JavaScript event loop and photosynthesis; configure the LLM planner for arbitrary topics.",
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
      return { isError: true, content: [{ type: "text" as const, text: error instanceof Error ? error.message : "Could not create the lesson." }] };
    }
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
