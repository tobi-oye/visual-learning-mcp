# Excalidraw integration investigation

## Decision

Render with `@excalidraw/excalidraw` inside this server's own MCP App. Reuse its scene editor, element model, text binding, and export utilities. The teaching schema and layout remain project modules.

An internal MCP client can connect to the official remote Excalidraw server, but forwarding a downstream tool result by itself is insufficient for this project's `teach_visually({ topic, level })` interface. A complete proxy is possible with additional adaptation; it is unnecessary for this MVP and adds network and upstream UI dependencies.

## What was inspected

The official [repository](https://github.com/excalidraw/excalidraw-mcp), [server source](https://github.com/excalidraw/excalidraw-mcp/blob/main/src/server.ts), [app source](https://github.com/excalidraw/excalidraw-mcp/blob/main/src/mcp-app.tsx), and [remote entry point](https://github.com/excalidraw/excalidraw-mcp/blob/main/api/mcp.ts) were inspected alongside the [MCP Apps specification](https://github.com/modelcontextprotocol/ext-apps/blob/main/specification/2026-01-26/apps.mdx).

On October 12, 2026, read-only protocol requests verified the remote service:

- `POST https://mcp.excalidraw.com` returned HTTP 308, redirecting to `/mcp`.
- `POST https://mcp.excalidraw.com/mcp` completed MCP initialization with protocol `2025-11-25` and server identity `Excalidraw` version `1.0.0`.
- `tools/list` returned `read_me`, `create_view`, and app-only `export_to_excalidraw`, `save_checkpoint`, and `read_checkpoint`.
- `resources/list` exposed `ui://excalidraw/mcp-app.html` with MIME type `text/html;profile=mcp-app`.

Those requests required no authentication or session header. They establish protocol availability at that time, not end-user rendering or long-term service reliability. No diagram was uploaded during this investigation.

## Why result forwarding is insufficient

The official `create_view` tool declares a UI resource in its tool metadata. Its result provides explanatory text and a checkpoint ID. Rendering uses the original `elements` tool argument, received by the UI's tool-input handler; the result handler consumes the checkpoint ID. Its app also calls server tools for sharing and checkpoints. [Implementation evidence](https://github.com/excalidraw/excalidraw-mcp/blob/main/src/server.ts), [UI evidence](https://github.com/excalidraw/excalidraw-mcp/blob/main/src/mcp-app.tsx)

For our tool, the host's original arguments are a topic and difficulty level. They do not contain `elements`. Calling `create_view` behind the server does not make that nested call visible as the host's tool input.

MCP Apps links a tool to a resource served by the connected server; the host forwards original input and returned output as separate notifications. App tool calls are scoped to that server connection. A proxy would therefore need to advertise and serve the downstream resource, preserve its CSP, proxy its app tools, and adapt the generated scene into the data format the UI expects. [Protocol evidence](https://github.com/modelcontextprotocol/ext-apps/blob/main/specification/2026-01-26/apps.mdx)

This is an integration mismatch, not a prohibition on composing MCP servers. Direct library embedding gives us control of the lesson display without implementing that bridge or depending on remote checkpoints.

## Scene, layout, and export

The library's [programmatic element API](https://docs.excalidraw.com/docs/@excalidraw/excalidraw/api/excalidraw-element-skeleton) can convert simplified shapes and labels into complete editable elements. Stable IDs support relationships and section navigation. Native scenes contain actual shapes and text; upstream-specific camera and checkpoint pseudo-elements are not scene elements.

Excalidraw measures text and can resize containers. Font readiness and sufficient layout space matter. The official app preloads fonts and refreshes dimensions before exposing the editor. Our renderer uses reserved text areas and consistent styling; the final rendered lesson still needs visual inspection. Its long teaching layout uses one continuous scene with navigation that pans to a section instead of fitting every section into an unreadably small overview.

The [library utilities](https://docs.excalidraw.com/docs/@excalidraw/excalidraw/api/utils) serialize native scene JSON, and [export utilities](https://docs.excalidraw.com/docs/@excalidraw/excalidraw/api/utils/export) produce SVG. This viewer exposes `.excalidraw` and SVG exports using current editor elements, application state, and files. Node scene resources remain the initial generated artifact. Client-side download and fullscreen behavior depend on the host.

## Local integration contract

`teach_visually` is registered as an MCP App tool. Its UI resource returns bundled HTML using `text/html;profile=mcp-app`. Its result includes the structured lesson and native scene; the app consumes the result and initializes the editor. Standard MCP clients can consume `structuredContent.scene` without an inline UI. The Node server also exposes `lesson://{id}/scene` for its latest 32 initial scenes, retained in memory per process until eviction or restart.

The Node server supports stdio and local Streamable HTTP at `http://localhost:3001/mcp`, and loads an existing `.env` from its current working directory. The standalone demo at `/` shares the lesson viewer. The bundled development host at `/host` uses an SDK HTTP client to discover and call the tool, fetch the UI resource, and deliver the result through AppBridge into a sandboxed iframe. That real MCP Apps path has delivered the event-loop lesson into the editable app.

This host serves the trusted local app for development. It does not implement separate-origin production isolation or enforce every resource's CSP and permission requests. The [official basic-host](https://github.com/modelcontextprotocol/ext-apps/tree/main/examples/basic-host) demonstrates the separate-origin sandbox pattern and is an additional protocol-and-UI test environment; setup is in the project README. An external assistant must support MCP Apps to show the lesson inline, and its transport configuration must be verified separately.

## Cloudflare transport

The Cloudflare Worker uses a stateless SDK transport and creates its lesson service within each request. It returns the full native scene in `structuredContent` and omits `lesson://` resource links and templates, avoiding a dependency on cross-request memory. The MCP App still edits and exports its current inline scene. Worker setup and deployment scripts are described in [Cloudflare setup](cloudflare.md).

Nine focused automated tests, Node and Worker typechecks, real SDK stdio and local Worker smoke checks, and a deployment dry run have passed. All five event-loop sections were inspected in the MCP App, and an edited annotation was verified in the current scene's copyable JSON export. Direct download completion was not confirmed in the in-app browser; the copyable export works without that capability. Live paid LLM generation, Claude integration, and a public Cloudflare deployment have not been verified; the current Cloudflare login needs renewal before publishing. These local observations are separate from the upstream service reads above.
