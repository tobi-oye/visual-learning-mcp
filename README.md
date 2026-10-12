# Visual Learning MCP

Turn a learning topic into a complete visual lesson on one editable Excalidraw canvas. Each lesson has 3–6 numbered sections with a title, an illustration, a short explanation, and a takeaway. Sections follow a top-to-bottom reading order; navigation moves around the same scene.

The primary MCP tool is:

```ts
teach_visually({
  topic: "How the JavaScript event loop works",
  level: "beginner", // optional: beginner | intermediate | advanced
})
```

The server uses TypeScript, the official MCP SDK, MCP Apps, React, Excalidraw, and Zod. An MCP Apps-capable host can display the editable lesson inside its interface. A standard MCP client can still receive the structured scene and read the generated artifact.

## Run locally

Requires Node.js **22.12 or newer** and npm.

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

## Planner configuration

The default `LESSON_PLANNER=fixture` provides deterministic JavaScript event-loop and photosynthesis lessons without API keys. Other topics require the LLM planner; the fixture does not invent a generic lesson for an unsupported topic.

The LLM planner supports arbitrary topics through a configurable provider endpoint. The Node server automatically loads `.env` from its **current working directory** when that file exists. Copy `.env.example` to `.env` for local configuration, or set these environment variables in the server process:

| Variable | Meaning |
| --- | --- |
| `LESSON_PLANNER` | `fixture` (default) or `llm`. |
| `LLM_API_KEY` | Required in `llm` mode. |
| `LLM_MODEL` | Required in `llm` mode; choose a model available from your provider. |
| `LLM_BASE_URL` | Optional API base URL; default `https://api.openai.com/v1`. |
| `LLM_TIMEOUT_MS` | Request timeout in milliseconds; default `60000`. |

For example, in a POSIX shell:

```sh
export LESSON_PLANNER=llm
export LLM_API_KEY="your-provider-key"
export LLM_MODEL="your-provider-model"
npm run serve
```

The planner requests structured lesson data, validates it with Zod, and hands it to the same layout engine used by fixtures. Provider responses must satisfy the schema. Local fixture and protocol checks do not establish that a particular remote model or provider has been tested.

## Connect an MCP client

For clients that use the `mcpServers` configuration format, add an entry such as:

```json
{
  "mcpServers": {
    "visual-learning": {
      "command": "node",
      "args": ["/absolute/path/to/visual-learning-mcp/dist/server/index.js", "--stdio"],
      "env": {
        "LESSON_PLANNER": "fixture"
      }
    }
  }
}
```

Replace the example path with the **absolute path** to your built checkout. If the client cannot find Node, use the absolute path to the Node executable too. To use the LLM planner, supply its environment variables in that client entry: the client's working directory may differ from your checkout, so its launched process may not find the checkout's `.env`. Configuration location and syntax depend on the client.

For a client supporting Streamable HTTP, start `npm run serve` and configure a connection to `http://localhost:3001/mcp`. The client must run on the same machine for this loopback address to work. Transport support and MCP Apps support are separate capabilities: a client may connect successfully without rendering inline apps.

Ask the assistant:

> Use teach_visually to explain how the JavaScript event loop works at beginner level.

The browser event-loop demonstration covers components, synchronous execution, asynchronous scheduling, microtask priority, and a practical code example with output. It describes browser behavior; Node.js has additional scheduling details.

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

The project also includes a Cloudflare Worker using the official SDK's Streamable HTTP transport and Workers Static Assets for the app bundle. See [Cloudflare setup](docs/cloudflare.md) for configuration, credentials, and the separate fixture and LLM environments.

```sh
npm run worker:dev    # build and run the Worker locally
npm run worker:check  # build and validate a deployment dry run
npm run worker:deploy # publish with a valid Wrangler login
```

Deployment requires a current Cloudflare login. A live deployment has not been verified.

## Architecture

```text
topic + level
  → lesson planner (fixture or LLM)
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
| `src/lesson/planner.ts`, `fixtures.ts` | Configurable LLM planner and deterministic lessons. |
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

Nine automated tests, typechecks, Node stdio smoke, Worker local MCP smoke, and a Wrangler deployment dry run have passed. The HTTP host delivered the event-loop scene through the real MCP protocol; all five sections were inspected visually. A canvas annotation was edited and verified in the exported scene JSON. In-app-browser download completion could not be confirmed, so the copyable scene export provides a verified fallback. Live paid LLM generation, Claude integration, and a public Cloudflare deployment have not been verified.

The MVP intentionally focuses on a complete first lesson. It has no accounts, quizzes, databases, or adaptive follow-up workflow. Remote LLM calls and each third-party assistant require separate verification with the intended configuration.
