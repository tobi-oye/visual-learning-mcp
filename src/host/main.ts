import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { CallToolResultSchema } from "@modelcontextprotocol/sdk/types.js";
import { AppBridge, PostMessageTransport, getToolUiResourceUri } from "@modelcontextprotocol/ext-apps/app-bridge";
import "./style.css";

// A small development host for this trusted local app. A production host should
// use a separate sandbox origin and enforce each resource's CSP and permissions.
const client = new Client({ name: "visual-learning-local-host", version: "0.1.0" }, { capabilities: { extensions: { "io.modelcontextprotocol/ui": { mimeTypes: ["text/html;profile=mcp-app"] } } } });
const status = document.querySelector<HTMLParagraphElement>("#status")!;
const form = document.querySelector<HTMLFormElement>("#lesson-form")!;
const view = document.querySelector<HTMLDivElement>("#view")!;
const preparedLesson = document.createElement("details");
preparedLesson.className = "prepared-lesson";
const summary = document.createElement("summary");
summary.textContent = "Preview a lesson prepared by your assistant";
const help = document.createElement("p");
help.textContent = "The event loop and photosynthesis demos work with a topic alone. For other topics, ask your connected assistant to prepare a lesson, then paste its lesson JSON here to preview it.";
const label = document.createElement("label");
label.textContent = "Prepared lesson JSON";
const lessonInput = document.createElement("textarea");
lessonInput.name = "lesson";
lessonInput.spellcheck = false;
lessonInput.placeholder = '{ "topic": "…", "title": "…", "level": "beginner", "summary": "…", "steps": […] }';
label.append(lessonInput);
preparedLesson.append(summary, help, label);
form.append(preparedLesson);
let bridge: AppBridge | undefined;
await client.connect(new StreamableHTTPClientTransport(new URL("/mcp", location.href)));
const tools = await client.listTools();
const tool = tools.tools.find(tool => tool.name === "teach_visually");
const resourceUri = tool && getToolUiResourceUri(tool);
if (!resourceUri) throw new Error("teach_visually is missing its MCP App resource metadata.");
status.textContent = "Connected over MCP Streamable HTTP. Ready to teach.";

async function teach() {
  const submit = form.querySelector<HTMLButtonElement>("button")!;
  submit.disabled = true;
  status.textContent = "Generating the lesson and loading its MCP App…";
  try {
    const data = new FormData(form);
    const args: Record<string, unknown> = { topic: String(data.get("topic")), level: String(data.get("level")) };
    const lessonJson = String(data.get("lesson") ?? "").trim();
    if (lessonJson) {
      let lesson: unknown;
      try { lesson = JSON.parse(lessonJson); }
      catch { throw new Error("The prepared lesson must be valid JSON. Ask your assistant for the lesson object."); }
      if (!lesson || typeof lesson !== "object" || Array.isArray(lesson)) {
        throw new Error("Paste the prepared lesson object, including its topic and steps.");
      }
      const metadata = lesson as Record<string, unknown>;
      args.lesson = lesson;
      if (typeof metadata.topic === "string") {
        args.topic = metadata.topic;
        form.querySelector<HTMLInputElement>('input[name="topic"]')!.value = metadata.topic;
      }
      if (typeof metadata.level === "string") {
        args.level = metadata.level;
        form.querySelector<HTMLSelectElement>('select[name="level"]')!.value = metadata.level;
      }
    }
    await bridge?.close();
    view.replaceChildren();
    const [resource, result] = await Promise.all([
      client.readResource({ uri: resourceUri! }),
      client.callTool({ name: "teach_visually", arguments: args }, undefined, { timeout: 120000 }),
    ]);
    const html = resource.contents.find(content => "text" in content)?.text;
    if (typeof html !== "string") throw new Error("MCP App resource did not return HTML.");
    const iframe = document.createElement("iframe");
    iframe.title = "Editable visual lesson MCP App";
    iframe.setAttribute("sandbox", "allow-scripts allow-downloads");
    view.append(iframe);
    bridge = new AppBridge(client, { name: "Visual Learning test host", version: "0.1.0" }, { serverTools: {}, serverResources: {} }, {
      hostContext: { theme: "light", displayMode: "inline", availableDisplayModes: ["inline", "fullscreen"], containerDimensions: { width: view.clientWidth, height: 820 } },
    });
    const activeBridge = bridge;
    bridge.onrequestdisplaymode = async ({ mode }) => {
      view.classList.toggle("fullscreen", mode === "fullscreen");
      activeBridge.setHostContext({ displayMode: mode, containerDimensions: { width: view.clientWidth, height: mode === "fullscreen" ? window.innerHeight : 820 } });
      return { mode };
    };
    bridge.oninitialized = () => {
      void (async () => {
        await activeBridge.sendToolInput({ arguments: args });
        await activeBridge.sendToolResult(CallToolResultSchema.parse(result));
        const outcome = result.structuredContent as Record<string, unknown> | undefined;
        status.textContent = result.isError ? "The tool returned an error; see the app." : outcome?.status === "needs_lesson" ? "Ask your connected assistant to prepare this topic, then preview its lesson here." : "Lesson delivered through MCP → AppBridge → sandboxed app. All sections share one canvas.";
      })().catch(error => { status.textContent = error instanceof Error ? error.message : "App delivery failed."; });
    };
    bridge.onerror = error => { status.textContent = `MCP App connection error: ${error.message}`; };
    await bridge.connect(new PostMessageTransport(iframe.contentWindow!, iframe.contentWindow!));
    iframe.srcdoc = html;
  } catch (error) {
    status.textContent = error instanceof Error ? error.message : "Lesson failed.";
  } finally { submit.disabled = false; }
}
form.addEventListener("submit", event => { event.preventDefault(); void teach(); });
await teach();
