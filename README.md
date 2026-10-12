# Visual Learning MCP

Turn a learning topic into a complete visual lesson on one editable Excalidraw canvas. Each lesson has 3–6 numbered sections with a title, an illustration, a short explanation, and a takeaway. Sections follow a top-to-bottom reading order; navigation moves around the same scene.

ChatGPT or Codex plans the lesson with its own model and sends that plan to the MCP server. The server validates it and draws native Excalidraw elements at runtime. **No separate `LLM_MODEL` or `LLM_API_KEY` is needed for this host-driven flow.**

The primary MCP tool is:

```ts
teach_visually({
  topic: "How binary search works",
  level: "beginner", // optional: beginner | intermediate | advanced
  lesson: assistantAuthoredLesson, // validated against the tool's lesson schema
})
```

`get_lesson_guide({ topic, level? })` supplies the lesson JSON Schema and planning instructions. The assistant can use it, author a lesson, and call `teach_visually` in the same conversation. The advertised `teach_visually` input schema also contains the complete lesson shape, so the assistant can submit a plan directly.

The server uses TypeScript, the official MCP SDK, MCP Apps, React, Excalidraw, and Zod. An MCP Apps-capable host can display the editable lesson inside its interface. A standard MCP client can still receive the structured scene and read the generated artifact.

## Run locally

Requires Node.js **22.12 or newer** and npm. MCP Inspector requires **22.19 or newer**.

```sh
npm install
npm run build
npm run typecheck
npm test
npm run demo
npm run smoke
```

`npm run demo` creates:

- `artifacts/event-loop.excalidraw` — an editable scene you can open in Excalidraw.
- `artifacts/event-loop.lesson.json` — the structured teaching plan before rendering.

`npm run smoke` connects an actual MCP SDK client to the built server over stdio. It exercises tool discovery, lesson generation, and resource reads. Build the server before running it.

For the local browser demo and Streamable HTTP transport:

```sh
npm run serve
```

Open [http://localhost:3001/](http://localhost:3001/) to inspect the lesson in the standalone viewer, or [http://localhost:3001/host](http://localhost:3001/host) to exercise the actual MCP Apps flow. The MCP endpoint is [http://localhost:3001/mcp](http://localhost:3001/mcp). This Node server listens on loopback and is intended for local development; it is not a public deployment.

The bundled `/host` connects with the official SDK's HTTP client, discovers the tool's UI resource, and delivers the tool result through AppBridge into a sandboxed iframe. It is a development host for this trusted app. It does not implement a separate sandbox origin or the per-resource CSP and permission enforcement expected of a general-purpose production host.

`npm start` uses stdio. It waits for an MCP client to communicate with it, so it does not open a website.

## Lesson planning

The default `LESSON_PLANNER=host` uses structured lessons supplied by the connected assistant. It also accepts topic-only calls for the JavaScript event-loop and photosynthesis fixtures, which remain useful for demos. With no arguments (or a blank topic), it opens the beginner event-loop demo. `lesson` defaults to `null`; an entirely blank lesson form is also treated as omitted. `LESSON_PLANNER=fixture` keeps the same deterministic demos; a supplied valid lesson is accepted in every mode.

For any other topic, a topic-only call in host or fixture mode returns `status: "needs_lesson"` with planning instructions and the lesson schema. The assistant should author the requested lesson and call `teach_visually` again with `lesson`; it does not need to ask the user for a provider key. Inspector and the bundled browser test host have no model of their own, so arbitrary topics require pasting a structured lesson into their tool input.

A lesson contains 3–6 steps, each with an explanation, takeaway, and a small visual made of cards, flow, comparison, or sequence nodes. The server computes positions, labels, relationships, and scene elements for each call. Excalidraw renders these as editable shapes and text on one continuous canvas. The server does not access the host's model internally or depend on MCP sampling.

`LESSON_PLANNER=llm` is an optional alternative for standalone applications that want the server to generate content from a topic without an assistant host. Only this mode needs provider credentials. The Node server loads `.env` from its **current working directory** when it exists; copy `.env.example` to `.env` or set environment variables in the launched server process.

| Variable | Meaning |
| --- | --- |
| `LESSON_PLANNER` | `host` (default), `fixture`, or `llm`. |
| `LLM_API_KEY` | Required only in optional `llm` mode. |
| `LLM_MODEL` | Required only in `llm` mode; choose a model available from your provider. |
| `LLM_BASE_URL` | Optional API base URL; default `https://api.openai.com/v1`. |
| `LLM_TIMEOUT_MS` | Request timeout in milliseconds; default `60000`. |

For example, in a POSIX shell:

```sh
export LESSON_PLANNER=llm
export LLM_API_KEY="your-provider-key"
export LLM_MODEL="your-provider-model"
npm run serve
```

The optional provider planner validates returned lesson data with Zod and uses the same layout engine. Local checks do not establish that a particular remote model or provider has been tested.

## Connect an MCP client

For Codex, add a stdio server to `~/.codex/config.toml` (or a project-scoped `.codex/config.toml`):

```toml
[mcp_servers.visual_learning]
command = "/absolute/path/to/node"
args = ["/absolute/path/to/visual-learning-mcp/dist/server/index.js", "--stdio"]
```

Use a Node executable that satisfies the version requirement and the absolute path to this built checkout. No planner environment variables are needed. Codex also accepts a Streamable HTTP server:

```toml
[mcp_servers.visual_learning]
url = "http://localhost:3001/mcp"
```

Run `npm run serve` for the HTTP configuration. Follow the [official OpenAI documentation for Codex MCP configuration](https://learn.chatgpt.com/docs/extend/mcp?surface=cli) for the configuration supported by your host.

For clients that use the `mcpServers` JSON configuration format:

```json
{
  "mcpServers": {
    "visual-learning": {
      "command": "node",
      "args": ["/absolute/path/to/visual-learning-mcp/dist/server/index.js", "--stdio"]
    }
  }
}
```

Replace the example path with the absolute path to your built checkout. If the client cannot find Node, use the absolute path to the Node executable too.

For a client supporting Streamable HTTP, start `npm run serve` and configure a connection to `http://localhost:3001/mcp`. The client must run on the same machine for this loopback address to work. Transport support and MCP Apps support are separate capabilities: a client may connect successfully without rendering inline apps.

ChatGPT's cloud connection needs a publicly reachable HTTPS MCP endpoint, such as the deployed Cloudflare Worker's `/mcp` URL. ChatGPT implements MCP Apps and can render this server's UI resource. Connect the remote endpoint using the [official MCP server and UI quickstart](https://developers.openai.com/plugins/build/app-quickstart). Inline display in other clients depends on their MCP Apps support; headless Codex can still generate and consume the editable scene JSON.

Ask the connected assistant:

> Teach me binary search visually at beginner level. Use get_lesson_guide if needed, create the lesson yourself, and send it to teach_visually.

For the deterministic demo:

> Use teach_visually to explain how the JavaScript event loop works at beginner level.

The browser event-loop demonstration covers components, synchronous execution, asynchronous scheduling, microtask priority, and a practical code example with output. It describes browser behavior; Node.js has additional scheduling details.

### Test in MCP Inspector

Keep `npm run serve` running, then start Inspector in another terminal:

```sh
npm run inspect
```

In Inspector's **Apps** tab, select `teach_visually` and open the app with its defaults. The default topic is `JavaScript event loop`, difficulty is beginner, and lesson JSON is `null`. Changing only the topic to `photosynthesis` opens that demo. Inspector 2.10.1 renders the editable Excalidraw canvas. After updating the server, reload Inspector and reconnect to refresh its input schema.

The complete minimal test arguments are:

```json
{ "topic": "JavaScript event loop" }
```

`{}` also works. Leave `lesson` at `null`; `lesson.steps` is an array in a full lesson, never a quoted string.

For an arbitrary topic, call `get_lesson_guide` to inspect the schema, then include a complete `lesson` object in the `teach_visually` arguments. Inspector does not author that lesson for you. A ready lesson is [`examples/binary-search.lesson.json`](examples/binary-search.lesson.json): set the outer topic to `Binary search` and put the parsed contents of that file in `lesson`. The local `/host` accepts the same file in its collapsed prepared-lesson input.

### Check inline rendering with the official reference host

The upstream [MCP Apps basic-host example](https://github.com/modelcontextprotocol/ext-apps/tree/main/examples/basic-host) lets you test app rendering through a real MCP connection. Keep this project's `npm run serve` running, then in a separate directory and terminal:

```sh
git clone https://github.com/modelcontextprotocol/ext-apps.git
cd ext-apps
npm install
cd examples/basic-host
SERVERS='["http://localhost:3001/mcp"]' npm start
```

Open [http://localhost:8080](http://localhost:8080), select `teach_visually`, enter the topic and optional level, and call the tool. The reference host also runs its sandbox proxy on port 8081. Follow the upstream instructions if that example changes. These are reproducible verification instructions, not a claim that a particular desktop assistant has been tested.

## Edit and export

Use Excalidraw's tools to move shapes, edit text, add annotations, and pan or zoom. Section navigation focuses the relevant area while keeping every section on the same canvas.

The viewer exports its **current scene**, including edits, through Excalidraw's serialization and export utilities. Editable `.excalidraw` JSON preserves individual elements; SVG is a visual snapshot. Downloads and fullscreen availability depend on the host's sandbox capabilities.

If a host restricts downloads, choose **Export → Copy editable scene** and save the displayed JSON to a `.excalidraw` file. This preserves the current edits without depending on the host's download support.

Each tool result includes `structuredContent.scene` and a generated lesson ID. The Node server's resource template `lesson://{id}/scene` exposes the initial generated scene for clients that do not display MCP Apps. It retains the latest 32 initial scenes in memory per Node process; they expire on eviction or restart. These resources are separate from later edits in the viewer; export the current scene to retain those edits.

The Cloudflare Worker is stateless. It embeds the full scene in the tool result and does not advertise `lesson://` resources. Editing and exporting the viewer's current canvas work with that inline scene too.

## Cloudflare hosting

The project also includes a Cloudflare Worker using the official SDK's Streamable HTTP transport and Workers Static Assets for the app bundle. Its default host mode accepts assistant-authored lessons without provider credentials. See [Cloudflare setup](docs/cloudflare.md) for deployment and the optional standalone LLM environment.

```sh
npm run worker:dev    # build and run the Worker locally
npm run worker:check  # build and validate a deployment dry run
npm run worker:deploy # publish with a valid Wrangler login
```

The deployed MCP endpoint is [https://visual-learning-mcp.shop-everywhere.workers.dev/mcp](https://visual-learning-mcp.shop-everywhere.workers.dev/mcp). The browser demo is available at the same origin's `/` and `/host` paths. The public endpoint passed the MCP smoke check on October 12, 2026, including host-authored lesson rendering and the packaged UI resource. The public `/host` also rendered the five-chapter event-loop lesson through the MCP App bridge. See [Cloudflare setup](docs/cloudflare.md) for deploy-on-push configuration.

## Architecture

```text
topic + level
  → connected assistant authors a structured lesson
    (or topic-only demo fixture / optional server-side LLM)
  → validated intermediate lesson
  → visual plan (nodes, relationships, explanations)
  → deterministic section layout
  → editable Excalidraw scene
  → MCP tool result + MCP App + scene resource
```

Teaching content is separate from drawing geometry. The schema bounds lesson length and illustration complexity, and checks node identifiers and relationships. The layout creates numbered sections with consistent colors, readable text, comfortable padding, and a small number of arrows between adjacent visual items. Excalidraw supplies the editor and rendering; this project supplies the lesson plan and layout.

We inspected the [official Excalidraw MCP implementation](https://github.com/excalidraw/excalidraw-mcp) and chose to embed its underlying Excalidraw library directly. A downstream `create_view` result alone does not carry the scene inputs expected by that app. A proxy would require an app-resource bridge, tool proxies, and input adaptation. See [the integration investigation](docs/integration.md) for evidence and tradeoffs.

The source is organized around that pipeline:

| Location | Responsibility |
| --- | --- |
| `src/lesson/schema.ts` | Topic input and structured lesson validation. |
| `src/lesson/planner.ts`, `fixtures.ts` | Host planning guide, deterministic demos, and optional provider planner. |
| `src/render/layout.ts`, `types.ts` | Scene geometry, section bounds, and native scene types. |
| `src/server.ts` | Shared MCP tool and resource registration. |
| `src/index.ts`, `src/worker.ts` | Node transports and stateless Cloudflare transport. |
| `src/ui/` | Shared editable Excalidraw viewer and embedded fonts. |
| `src/host/` | Local SDK client and AppBridge development host. |
| `scripts/`, `tests/` | Demo artifacts, protocol smoke checks, and focused tests. |

## Verification

- `npm test`: focused checks for lesson structure and layout.
- `npm run typecheck`: TypeScript checks.
- `npm run build`: the bundled MCP App and Node server.
- `npm run smoke`: the actual SDK client/server path over stdio.
- `/host`: the actual SDK HTTP client → AppBridge → sandboxed MCP App path.
- Browser verification: check section navigation, editing, readable labels, spacing, and exporting the edited scene.

The event-loop scene has rendered through the real MCP protocol in the bundled HTTP host and Inspector's Apps tab. All five sections were inspected visually, and an edited annotation was verified in copyable scene JSON. In-app-browser download completion could not be confirmed, so the copyable export provides a verified fallback.

An actual Codex CLI run used its existing account authentication to call `get_lesson_guide`, author a new TCP handshake lesson, and call `teach_visually`. The server returned three sections and 50 native Excalidraw elements in host mode without server model credentials. Inspector rendered that same host-authored lesson in its Apps tab. The stdio, local Worker, and deployed Worker smoke checks also rendered the supplied binary-search lesson. Live inline rendering inside ChatGPT or Codex has not been verified.

The MVP focuses on a complete first lesson. It has no accounts, quizzes, databases, or adaptive follow-up workflow. Remote provider calls and each assistant host need verification with the intended configuration.
