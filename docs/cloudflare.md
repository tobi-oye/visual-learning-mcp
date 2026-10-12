# Host the MCP server on Cloudflare

The project includes a Cloudflare Worker at `src/worker.ts`. It exposes the real
MCP server at `/mcp` using the official SDK's stateless Streamable HTTP transport.
Excalidraw and the MCP App HTML are served through the `ASSETS` binding, so the
large browser bundle is separate from the Worker script.

No database is required. Every tool result includes the complete editable scene.
The MCP App downloads the current edited canvas as `.excalidraw` or SVG. The
Worker does not advertise `lesson://` resource links or keep lesson state between
requests; the Node server retains its latest 32 initial scene resources.

## Run and check locally

```sh
npm install
npm run worker:types
npm run worker:dev
```

Open `http://localhost:8787/` for the fixture demo, `/host` for the development
MCP App host, and `/health` for a health check. An MCP client should connect to
`http://localhost:8787/mcp`. The fixtures cover the JavaScript event loop and
photosynthesis.

While the local Worker is running, verify its actual MCP protocol from another
terminal with `npm run worker:smoke`. The smoke script refuses LLM mode and checks
the tool, complete scene, chapter metadata, packaged UI, and input protections.

```sh
npm run worker:check
```

This builds the browser assets and validates the Worker bundle with
`wrangler deploy --dry-run`; it does not publish the server. The generated
`worker-configuration.d.ts` describes the configured bindings and runtime. Run
`worker:types` after changing `wrangler.jsonc`.

## Deploy the fixture version

```sh
npx wrangler login
npm run worker:deploy
```

Wrangler prints a URL similar to
`https://visual-learning-mcp.<your-subdomain>.workers.dev`. Use its `/mcp` path
as the remote MCP URL. The default deployment is a public fixture demo and makes
no LLM calls. The private Git repository does not itself make this endpoint
private.

To protect even the fixture MCP API, set an `MCP_API_TOKEN` secret on that Worker
and send `Authorization: Bearer <token>` from the MCP client. Do not embed the
token in browser source or commit it to the repository. This API token is intended
for clients that support custom request headers; it is not an OAuth flow.

## Enable arbitrary topics with an LLM

Set a compatible model name in `env.llm.vars.LLM_MODEL` in `wrangler.jsonc`.
`LLM_BASE_URL` is the API base URL, such as `https://api.openai.com/v1`; the planner
adds `/chat/completions`. The provider must support strict JSON Schema output.

```sh
npx wrangler secret put LLM_API_KEY --env llm
npx wrangler secret put MCP_API_TOKEN --env llm
npm run worker:deploy -- --env llm
```

Enter secret values at Wrangler's prompt. The `llm` environment deploys a separate
Worker named `visual-learning-mcp-llm`. Both secrets are required, and runtime
checks also reject LLM requests if the API token is missing. Authenticated requests
to `/mcp` and `/api/teach` must carry `Authorization: Bearer <MCP_API_TOKEN>`.
The public browser preview and development host do not collect API tokens, so use
them with fixture mode; use an authenticated MCP client for the LLM deployment.

For local LLM testing, put those two secrets in an ignored `.dev.vars.llm` file
and run `npm run worker:dev -- --env llm`. Never place secret values in
`wrangler.jsonc`.

## Client access and hosting choices

The Worker accepts requests without an `Origin` header from native MCP clients.
Browser requests must use the same origin, or one of the exact origins listed in
`ALLOWED_ORIGINS` as a comma-separated string. There is no wildcard CORS policy.
The API token still applies to allowed browser origins. POST bodies are limited
to 64 KiB for MCP and 16 KiB for the demo endpoint.

The development host is a protocol demonstration for this app. A general-purpose
host should use a separate sandbox origin and enforce each app's CSP and
permissions. OAuth, user accounts, persisted lesson history, and rate limiting can
be added when opening paid LLM access to multiple users; they are not required
for the fixture deployment.

Start with the fixture version and use the dry run to inspect script size. Reading
the app resource serializes a large HTML document, so compare deployed CPU usage
against your Workers plan before relying on a free plan. Assets are uploaded from
`dist/worker-assets`, which contains only the two browser HTML files; compiled Node
server files are not public assets.

References: [Cloudflare MCP transports](https://developers.cloudflare.com/agents/model-context-protocol/protocol/transport/),
[Workers Static Assets bindings](https://developers.cloudflare.com/workers/static-assets/binding/),
[Wrangler configuration and secrets](https://developers.cloudflare.com/workers/wrangler/configuration/),
and [Workers limits](https://developers.cloudflare.com/workers/platform/limits/).
