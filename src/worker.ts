import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { createPlannerFromEnv } from "./lesson/planner.js";
import { teachInputSchema } from "./lesson/schema.js";
import { createServer, LessonService } from "./server.js";

const MAX_MCP_BODY_BYTES = 64 * 1024;
const MAX_DEMO_BODY_BYTES = 16 * 1024;
const MAX_APP_BYTES = 20 * 1024 * 1024;

class BodyTooLarge extends Error {}

// Bound both the demo input and the known, packaged UI asset before buffering.
async function readText(body: ReadableStream<Uint8Array> | null, limit: number): Promise<string> {
  if (!body) return "";
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const chunks: string[] = [];
  let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > limit) {
        await reader.cancel();
        throw new BodyTooLarge("Request body is too large.");
      }
      chunks.push(decoder.decode(value, { stream: true }));
    }
    chunks.push(decoder.decode());
    return chunks.join("");
  } finally { reader.releaseLock(); }
}

function jsonError(message: string, status: number, headers?: HeadersInit): Response {
  return Response.json({ error: message }, { status, headers });
}

function corsHeaders(request: Request, env: Env): Headers | undefined {
  const origin = request.headers.get("Origin");
  const headers = new Headers();
  if (!origin) return headers;
  const allowed = [new URL(request.url).origin, ...env.ALLOWED_ORIGINS.split(",").map(value => value.trim()).filter(Boolean)];
  if (!allowed.includes(origin)) return undefined;
  headers.set("Access-Control-Allow-Origin", origin);
  headers.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  headers.set("Access-Control-Allow-Headers", "Authorization, Content-Type, MCP-Protocol-Version, Mcp-Session-Id, Last-Event-ID");
  headers.set("Access-Control-Expose-Headers", "Mcp-Session-Id");
  headers.set("Vary", "Origin");
  return headers;
}

async function authorized(request: Request, token: string): Promise<boolean> {
  const supplied = request.headers.get("Authorization")?.match(/^Bearer\s+(\S+)$/i)?.[1];
  if (!supplied) return false;
  const encoder = new TextEncoder();
  const [actual, expected] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(supplied)),
    crypto.subtle.digest("SHA-256", encoder.encode(token)),
  ]);
  return crypto.subtle.timingSafeEqual(actual, expected);
}

function withHeaders(response: Response, extra: Headers): Response {
  const headers = new Headers(response.headers);
  extra.forEach((value, key) => headers.set(key, value));
  headers.set("Cache-Control", "no-store");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

async function handleApi(request: Request, env: Env, pathname: string): Promise<Response> {
  const cors = corsHeaders(request, env);
  if (!cors) return jsonError("Origin is not allowed.", 403);
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (request.method !== "POST") return jsonError("Use POST for this stateless endpoint.", 405, { ...Object.fromEntries(cors), Allow: "POST, OPTIONS" });

  const mode = env.LESSON_PLANNER === "llm" ? "llm" : "fixture";
  if (mode === "llm" && !env.MCP_API_TOKEN) {
    return withHeaders(jsonError("LLM mode requires the MCP_API_TOKEN secret.", 503), cors);
  }
  if (env.MCP_API_TOKEN && !await authorized(request, env.MCP_API_TOKEN)) {
    return withHeaders(jsonError("A valid bearer token is required.", 401, { "WWW-Authenticate": "Bearer realm=\"visual-learning-mcp\"" }), cors);
  }

  try {
    // A Worker instance can handle unrelated users. Keep each service and MCP
    // transport inside its request; the complete scene travels in the result.
    const planner = createPlannerFromEnv({
      LESSON_PLANNER: env.LESSON_PLANNER,
      LLM_MODEL: env.LLM_MODEL,
      LLM_BASE_URL: env.LLM_BASE_URL,
      LLM_TIMEOUT_MS: env.LLM_TIMEOUT_MS,
      LLM_API_KEY: env.LLM_API_KEY,
    });
    const service = new LessonService(planner, mode, false);
    if (pathname === "/api/teach") {
      if (request.headers.get("Content-Type")?.split(";")[0]?.trim().toLowerCase() !== "application/json") {
        return withHeaders(jsonError("Send an application/json body.", 415), cors);
      }
      let input: unknown;
      try { input = JSON.parse(await readText(request.body, MAX_DEMO_BODY_BYTES)); }
      catch (error) {
        return withHeaders(jsonError(error instanceof BodyTooLarge ? error.message : "The request body is not valid JSON.", error instanceof BodyTooLarge ? 413 : 400), cors);
      }
      const parsed = teachInputSchema.safeParse(input);
      if (!parsed.success) return withHeaders(jsonError("Provide a topic of 1–200 characters and a valid difficulty level.", 400), cors);
      try { return withHeaders(Response.json(await service.teach(parsed.data)), cors); }
      catch (error) { return withHeaders(jsonError(error instanceof Error ? error.message : "Lesson generation failed.", 422), cors); }
    }

    const server = createServer(service, async () => {
      const asset = await env.ASSETS.fetch(new URL("/mcp-app.html", request.url));
      if (!asset.ok) throw new Error("The packaged MCP App asset is missing. Run npm run build:worker.");
      return readText(asset.body, MAX_APP_BYTES);
    }, { includeSceneResources: false });
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
      maxRequestBodySize: MAX_MCP_BODY_BYTES,
    });
    try {
      await server.connect(transport);
      return withHeaders(await transport.handleRequest(request), cors);
    } finally { await server.close(); }
  } catch (error) {
    console.error(JSON.stringify({ event: "request_failed", path: pathname, message: error instanceof Error ? error.message : "Unknown error" }));
    return withHeaders(jsonError("The server could not process this request. Check Worker configuration and logs.", 500), cors);
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/mcp" || url.pathname === "/api/teach") return handleApi(request, env, url.pathname);
    if (url.pathname === "/health") return Response.json({ ok: true, planner: env.LESSON_PLANNER, transport: "streamable-http", sceneStorage: "inline" });
    if (url.pathname === "/") url.pathname = "/mcp-app.html";
    if (url.pathname === "/host") url.pathname = "/host.html";
    return env.ASSETS.fetch(new Request(url, request));
  },
} satisfies ExportedHandler<Env>;
