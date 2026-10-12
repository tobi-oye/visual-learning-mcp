import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { APP_URI } from "../src/server.js";
import { getToolUiResourceUri } from "@modelcontextprotocol/ext-apps/app-bridge";
import type { VisualLesson } from "../src/render/types.js";

const client = new Client({ name: "visual-learning-smoke", version: "0.1.0" }, { capabilities: {} });
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [fileURLToPath(new URL("../dist/server/index.js", import.meta.url)), "--stdio"],
  env: { ...Object.fromEntries(Object.entries(process.env).filter((pair): pair is [string, string] => pair[1] !== undefined)), LESSON_PLANNER: "fixture" },
});
try {
  await client.connect(transport);
  const { tools } = await client.listTools();
  assert.equal(getToolUiResourceUri(tools.find(tool => tool.name === "teach_visually")!), APP_URI);
  const result = await client.callTool({ name: "teach_visually", arguments: { topic: "JavaScript event loop" } });
  assert.ok(!result.isError, JSON.stringify(result.content));
  const visual = result.structuredContent as unknown as VisualLesson;
  assert.equal(visual.lesson.steps.length, 5);
  assert.equal(visual.scene.type, "excalidraw");
  const resource = await client.readResource({ uri: APP_URI });
  assert.equal(resource.contents[0].mimeType, "text/html;profile=mcp-app");
  assert.ok("text" in resource.contents[0] && resource.contents[0].text.includes("<html"));
  assert.ok(visual.resourceUri);
  const sceneResource = await client.readResource({ uri: visual.resourceUri });
  assert.ok("text" in sceneResource.contents[0]);
  assert.deepEqual(JSON.parse(sceneResource.contents[0].text as string), visual.scene);
  const bad = await client.callTool({ name: "teach_visually", arguments: { topic: "" } });
  assert.equal(bad.isError, true);
  console.log(`MCP stdio smoke passed: tool discovery, Apps metadata, lesson (${visual.scene.elements.length} elements), UI resource, editable scene resource and invalid input.`);
} finally { await client.close(); }
