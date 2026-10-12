# Host the MCP server on Cloudflare

The project includes a Cloudflare Worker at `src/worker.ts`. It exposes the real
MCP server at `/mcp` using the official SDK's stateless Streamable HTTP transport.
Excalidraw and the MCP App HTML are served through the `ASSETS` binding, so the
large browser bundle is separate from the Worker script.

No database is required. Every tool result includes the complete editable scene.
The MCP App downloads the current edited canvas as `.excalidraw` or SVG. The
Worker does not advertise `lesson://` resource links or keep lesson state between
requests; the Node server retains its latest 32 initial scene resources.

The live MCP URL is [https://visual-learning-mcp.shop-everywhere.workers.dev/mcp](https://visual-learning-mcp.shop-everywhere.workers.dev/mcp). The deployed Worker passed the protocol smoke check on October 12, 2026. For a browser preview, open [the demo host](https://visual-learning-mcp.shop-everywhere.workers.dev/host).

The default `LESSON_PLANNER=host` needs no model name or provider API key.
ChatGPT or Codex writes a structured lesson using its own model, then calls
`teach_visually({ topic, level, lesson })`. The Worker validates that lesson and
draws its editable Excalidraw scene at runtime. `get_lesson_guide` provides the
schema and planning instructions. Topic-only event-loop and photosynthesis demos
also work in host mode; `LESSON_PLANNER=fixture` remains available for demos.

## Run and check locally

```sh
npm install
npm run worker:types
npm run worker:dev
```

Open `http://localhost:8787/` for the event-loop demo, `/host` for the development
MCP App host, and `/health` for a health check. An MCP client should connect to
`http://localhost:8787/mcp`. The fixtures cover the JavaScript event loop and
photosynthesis.

While the local Worker is running, verify its actual MCP protocol from another
terminal with `npm run worker:smoke`. The smoke script checks the no-provider mode,
the tool, complete scene, chapter metadata, packaged UI, and input protections.

```sh
npm run worker:check
```

This builds the browser assets and validates the Worker bundle with
`wrangler deploy --dry-run`; it does not publish the server. The generated
`worker-configuration.d.ts` describes the configured bindings and runtime. Run
`worker:types` after changing `wrangler.jsonc`.

## Deploy the host-driven version

```sh
npx wrangler login
npm run worker:deploy
```

Wrangler prints a URL similar to
`https://visual-learning-mcp.<your-subdomain>.workers.dev`. Use its `/mcp` path
as the remote MCP URL. The default deployment accepts assistant-authored lessons
and makes no server-side LLM calls. The private Git repository does not itself
make this endpoint private. Manual deployment needs a valid Cloudflare login.

To protect the MCP API, set an `MCP_API_TOKEN` secret on that Worker
and send `Authorization: Bearer <token>` from the MCP client. Do not embed the
token in browser source or commit it to the repository. This API token is intended
for clients that support custom request headers; it is not an OAuth flow.

## Deploy automatically after a push

Cloudflare Workers Builds can connect `tobi-oye/visual-learning-mcp` and deploy
the `main` branch after each push. It runs Wrangler within Cloudflare's CI and
manages a build credential; local Wrangler login is not needed for those builds.
The repository connection must be configured in the dashboard before this is active.

Open the Worker's **Settings → Builds → Connect** and use:

| Setting | Value |
| --- | --- |
| Repository | `tobi-oye/visual-learning-mcp` |
| Production branch | `main` |
| Root directory | Repository root |
| Build command | `npm run typecheck && npm test && npm run worker:typecheck && npm run build:worker` |
| Deploy command | `npx wrangler deploy --env ""` |
| Node version | `24`, selected by the committed `.node-version` file |

If GitHub asks for repository access, add only `visual-learning-mcp` and preserve
access already granted to other repositories. Workers Builds
offers a generated build token or an existing token. This app needs Workers Scripts
edit access and account lookup; it has no KV, R2, or custom-domain dependencies.

GitHub Actions is an alternative. It also runs Wrangler, using a Cloudflare API
token stored in GitHub Actions secrets. The native build integration avoids managing
that deployment secret in GitHub.

See [Workers Builds configuration](https://developers.cloudflare.com/workers/ci-cd/builds/configuration/)
and [GitHub integration](https://developers.cloudflare.com/workers/ci-cd/builds/git-integration/github-integration/).
The [build image documentation](https://developers.cloudflare.com/workers/ci-cd/builds/build-image/)
describes the `.node-version` runtime selection.

## Connect ChatGPT or Codex

Connect ChatGPT to the public HTTPS `/mcp` URL; a cloud host cannot reach the
loopback URL on your computer. The server uses the standard MCP Apps resource
and bridge supported by ChatGPT. Follow the [official OpenAI quickstart](https://developers.openai.com/plugins/build/app-quickstart)
for connection setup. Ask the assistant to create a lesson for your topic and
pass it to `teach_visually`; no provider credentials belong in that request.

Codex can connect through Streamable HTTP:

```toml
[mcp_servers.visual_learning]
url = "https://visual-learning-mcp.shop-everywhere.workers.dev/mcp"
```

For a token-protected endpoint, configure client authorization according to the
[Codex MCP documentation](https://learn.chatgpt.com/docs/extend/mcp?surface=cli).
Scene JSON remains usable in clients without inline MCP Apps rendering.

## Optional server-side LLM for standalone callers

Use this only when a standalone application needs to turn a topic into a lesson
without an assistant authoring the structured input. Host-generated lessons
already support arbitrary topics in the default deployment.

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
them with the default unprotected demo; use an authenticated MCP client for this
LLM deployment.

For local LLM testing, put those two secrets in an ignored `.dev.vars.llm` file
and run `npm run worker:dev -- --env llm`. Never place secret values in
`wrangler.jsonc`.

## Client access and hosting choices

The Worker accepts requests without an `Origin` header from native MCP clients.
Browser requests must use the same origin, or one of the exact origins listed in
`ALLOWED_ORIGINS` as a comma-separated string. There is no wildcard CORS policy.
The API token still applies to allowed browser origins. POST bodies are limited
to 128 KiB for both MCP and the demo endpoint, allowing a complete prepared lesson.

The development host is a protocol demonstration for this app. A general-purpose
host should use a separate sandbox origin and enforce each app's CSP and
permissions. OAuth, user accounts, persisted lesson history, and rate limiting can
be added when opening paid LLM access to multiple users; they are not required
for the host-driven deployment.

Use the dry run to inspect script size before deployment. Reading
the app resource serializes a large HTML document, so compare deployed CPU usage
against your Workers plan before relying on a free plan. Assets are uploaded from
`dist/worker-assets`, which contains only the two browser HTML files; compiled Node
server files are not public assets.

References: [Cloudflare MCP transports](https://developers.cloudflare.com/agents/model-context-protocol/protocol/transport/),
[Workers Static Assets bindings](https://developers.cloudflare.com/workers/static-assets/binding/),
[Wrangler configuration and secrets](https://developers.cloudflare.com/workers/wrangler/configuration/),
and [Workers limits](https://developers.cloudflare.com/workers/platform/limits/).
