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
    await bridge?.close();
    view.replaceChildren();
    const data = new FormData(form);
    const args = { topic: String(data.get("topic")), level: String(data.get("level")) };
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
        status.textContent = result.isError ? "The tool returned an error; see the app." : "Lesson delivered through MCP → AppBridge → sandboxed app. All sections share one canvas.";
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
