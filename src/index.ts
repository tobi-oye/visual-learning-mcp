import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { createPlannerFromEnv, NeedsLessonError, resolvePlannerMode } from "./lesson/planner.js";
import { teachInputSchema } from "./lesson/schema.js";
import { createServer, LessonService } from "./server.js";

if (existsSync(".env")) process.loadEnvFile(".env");
const compiled = import.meta.url.endsWith(".js");
const uiPath = fileURLToPath(new URL(compiled ? "../ui/mcp-app.html" : "../dist/ui/mcp-app.html", import.meta.url));
const hostPath = fileURLToPath(new URL(compiled ? "../host/host.html" : "../dist/host/host.html", import.meta.url));
const service = new LessonService(createPlannerFromEnv(), resolvePlannerMode());
const loadUi = () => readFile(uiPath, "utf8");

if (!existsSync(uiPath)) throw new Error("MCP App bundle is missing. Run npm run build first.");
if (process.argv.includes("--http")) {
  const port = Number(process.env.PORT ?? 3001);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("PORT must be an integer between 1 and 65535.");
  const app = createMcpExpressApp({ host: "127.0.0.1" });
  app.use((req, res, next) => {
    const origin = req.headers.origin;
    const allowed = [`http://localhost:${port}`, `http://127.0.0.1:${port}`, "http://localhost:8080", "http://127.0.0.1:8080"];
    if (origin && !allowed.includes(origin)) { res.status(403).json({ error: "Origin is not allowed by this local development server." }); return; }
    if (origin) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Vary", "Origin");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type, MCP-Protocol-Version, Mcp-Session-Id, Last-Event-ID");
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
      res.setHeader("Access-Control-Expose-Headers", "Mcp-Session-Id");
    }
    if (req.method === "OPTIONS") { res.sendStatus(204); return; }
    next();
  });
  app.post("/mcp", async (req, res) => {
    const server = createServer(service, loadUi);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on("close", () => { void server.close(); });
    try { await server.connect(transport); await transport.handleRequest(req, res, req.body); }
    catch (error) { console.error("MCP request failed", error instanceof Error ? error.message : "Unknown error"); if (!res.headersSent) res.status(500).json({ error: "MCP request failed" }); }
  });
  app.get("/mcp", (_req, res) => res.status(405).set("Allow", "POST").end());
  app.delete("/mcp", (_req, res) => res.status(405).set("Allow", "POST").end());
  app.get("/", (_req, res) => res.sendFile(uiPath));
  app.get("/host", (_req, res) => res.sendFile(hostPath));
  app.post("/api/teach", async (req, res) => {
    const parsed = teachInputSchema.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: "Provide a valid topic, difficulty level, and lesson matching the tool schema.", issues: parsed.error.issues }); return; }
    try { res.json(await service.teach(parsed.data)); }
    catch (error) {
      if (error instanceof NeedsLessonError) { res.json({ status: "needs_lesson", topic: error.guide.topic, level: error.guide.level, guide: error.guide }); return; }
      res.status(422).json({ error: error instanceof Error ? error.message : "Lesson generation failed." });
    }
  });
  app.get("/health", (_req, res) => res.json({ ok: true, planner: service.mode }));
  const listener = app.listen(port, "127.0.0.1", () => console.error(`Visual Learning MCP: http://localhost:${port}/mcp · Demo: http://localhost:${port}/ · Test host: http://localhost:${port}/host`));
  listener.on("error", error => { console.error(`Could not start the local server: ${error.message}`); process.exitCode = 1; });
  for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => listener.close(() => process.exit(0)));
} else {
  const server = createServer(service, loadUi);
  await server.connect(new StdioServerTransport());
}
