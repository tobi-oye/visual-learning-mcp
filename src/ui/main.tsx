import React, { Component, useCallback, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { App } from "@modelcontextprotocol/ext-apps";
import {
  Excalidraw,
  exportToSvg,
  restore,
  serializeAsJSON,
  CaptureUpdateAction,
} from "@excalidraw/excalidraw";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import type { SceneDocument, SectionBounds } from "../render/types";
import "@excalidraw/excalidraw/index.css";
import "./styles.css";

type LessonResult = {
  lesson: { title: string; topic: string; level?: string; summary?: string };
  scene: SceneDocument;
  sections: SectionBounds[];
  planner: "host" | "fixture" | "llm";
};
type PlanningRequest = { status: "needs_lesson"; topic: string; level: string };
type HostContext = NonNullable<ReturnType<App["getHostContext"]>>;
const standalone = window.parent === window;

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function parseLessonResult(value: unknown): LessonResult | PlanningRequest {
  if (!value || typeof value !== "object") throw new Error("The server did not return a visual lesson.");
  const envelope = value as Record<string, unknown>;
  if (envelope.isError) {
    const content = envelope.content as { type?: string; text?: string }[] | undefined;
    throw new Error(content?.find((item) => item.type === "text")?.text || "The lesson could not be generated.");
  }
  const result = (envelope.structuredContent ?? envelope) as Partial<LessonResult> & Partial<PlanningRequest>;
  if (result.status === "needs_lesson" && typeof result.topic === "string" && typeof result.level === "string") {
    return { status: "needs_lesson", topic: result.topic, level: result.level };
  }
  if (
    !result.lesson?.title || !result.scene || !Array.isArray(result.scene.elements) ||
    !Array.isArray(result.sections) || result.sections.length === 0
  ) throw new Error("The lesson result is missing its editable canvas or chapter outline.");
  return result as LessonResult;
}

function Icon({ name, size = 18 }: { name: "board" | "edit" | "read" | "width" | "all" | "download" | "expand" | "arrow"; size?: number }) {
  const paths = {
    board: <><rect x="3" y="4" width="18" height="13" rx="2" /><path d="M8 21l4-4 4 4M8 8h8M8 12h5" /></>,
    edit: <><path d="m15 5 4 4M4 20l4-1L20 7a2.8 2.8 0 0 0-4-4L4 15v5Z" /></>,
    read: <><path d="M12 5v16M12 5C9 3 6 3 3 4v15c3-1 6-1 9 1 3-2 6-2 9-1V4c-3-1-6-1-9 1Z" /></>,
    width: <><path d="M4 4v16M20 4v16M4 12h16M8 8l-4 4 4 4M16 8l4 4-4 4" /></>,
    all: <><path d="M8 3H3v5M16 3h5v5M3 16v5h5M21 16v5h-5" /><rect x="7" y="7" width="10" height="10" rx="1" /></>,
    download: <><path d="M12 3v12m-4-4 4 4 4-4M4 16v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4" /></>,
    expand: <><path d="M8 3H3v5M3 3l6 6M16 3h5v5M21 3l-6 6M3 16v5h5M3 21l6-6M21 16v5h-5M21 21l-6-6" /></>,
    arrow: <path d="M5 12h14m-5-5 5 5-5 5" />,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}

function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  // The browser needs time to consume the object URL after a download click.
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

class CanvasBoundary extends Component<{ children: React.ReactNode }, { error: string | null }> {
  state = { error: null as string | null };
  static getDerivedStateFromError(error: unknown) { return { error: errorMessage(error) }; }
  render() {
    return this.state.error
      ? <div className="empty-board" role="alert"><Icon name="board" size={36} /><h2>The canvas could not open</h2><p>{this.state.error}</p></div>
      : this.props.children;
  }
}

export default function VisualLearningApp() {
  const [result, setResult] = useState<LessonResult | null>(null);
  const [planningRequest, setPlanningRequest] = useState<PlanningRequest | null>(null);
  const [api, setApi] = useState<ExcalidrawImperativeAPI | null>(null);
  const [editing, setEditing] = useState(false);
  const [activeSection, setActiveSection] = useState<string | null>(null);
  const [topic, setTopic] = useState("JavaScript event loop");
  const [level, setLevel] = useState("beginner");
  const [pending, setPending] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [hostContext, setHostContext] = useState<HostContext | null>(null);
  const [exporting, setExporting] = useState(false);
  const [localFullscreen, setLocalFullscreen] = useState(false);
  const [sceneExport, setSceneExport] = useState<string | null>(null);
  const [zoomPercent, setZoomPercent] = useState(100);
  const bridge = useRef<App | null>(null);
  const board = useRef<HTMLDivElement | null>(null);
  const shell = useRef<HTMLDivElement | null>(null);
  const request = useRef<AbortController | null>(null);
  const currentResult = useRef<LessonResult | null>(null);
  const activeSectionRef = useRef<string | null>(null);

  useEffect(() => { activeSectionRef.current = activeSection; }, [activeSection]);

  const receiveResult = useCallback((value: unknown) => {
    try {
      const next = parseLessonResult(value);
      if ("status" in next) {
        currentResult.current = null;
        setResult(null);
        setApi(null);
        setPlanningRequest(next);
        setTopic(next.topic);
        setLevel(next.level);
        setActiveSection(null);
        setEditing(false);
        setSceneExport(null);
        setError(null);
        setNotice(null);
        setPending(false);
        return;
      }
      currentResult.current = next;
      setResult(next);
      setPlanningRequest(null);
      setTopic(next.lesson.topic);
      setLevel(next.lesson.level ?? "beginner");
      setActiveSection(next.sections[0]?.id ?? null);
      setEditing(false);
      setError(null);
      setNotice(null);
    } catch (cause) { setError(errorMessage(cause)); }
    setPending(false);
  }, []);

  const generate = useCallback(async (nextTopic: string, nextLevel: string) => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setPending(true);
    setPlanningRequest(null);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch("/api/teach", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic: nextTopic, level: nextLevel }),
        signal: controller.signal,
      });
      const body: unknown = await response.json();
      if (!response.ok) {
        const message = (body as { error?: string }).error;
        throw new Error(message || `Lesson generation failed (${response.status}).`);
      }
      if (!controller.signal.aborted) receiveResult(body);
    } catch (cause) {
      if (!controller.signal.aborted) { setError(errorMessage(cause)); setPending(false); }
    }
  }, [receiveResult]);

  useEffect(() => {
    if (standalone) {
      void generate("JavaScript event loop", "beginner");
      return () => request.current?.abort();
    }
    const app = new App({ name: "Visual Learning", version: "0.1.0" }, {});
    bridge.current = app;
    app.ontoolinput = ({ arguments: args }) => {
      if (typeof args?.topic === "string") setTopic(args.topic);
      setPending(true);
      setError(null);
      setPlanningRequest(null);
    };
    app.ontoolresult = (value) => receiveResult(value);
    app.ontoolcancelled = () => { setPending(false); setNotice("Lesson generation was cancelled."); };
    app.onhostcontextchanged = (context) => setHostContext(context);
    app.onerror = (cause) => { setError(errorMessage(cause)); setPending(false); };
    app.onteardown = async () => { request.current?.abort(); return {}; };
    // All notification handlers are ready before the host can deliver a tool result.
    let mounted = true;
    void app.connect().then(() => {
      if (mounted) setHostContext(app.getHostContext() ?? null);
    }).catch((cause) => {
      if (mounted) { setError(`Could not connect to the MCP host: ${errorMessage(cause)}`); setPending(false); }
    });
    return () => {
      mounted = false;
      bridge.current = null;
      void app.close();
    };
  }, [generate, receiveResult]);

  useEffect(() => {
    const onFullscreen = () => setLocalFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", onFullscreen);
    return () => document.removeEventListener("fullscreenchange", onFullscreen);
  }, []);

  const fitWidth = useCallback((section?: SectionBounds) => {
    const current = currentResult.current;
    if (!api || !board.current || !current) return;
    const sections = current.sections;
    const left = Math.min(...sections.map((item) => item.x));
    const right = Math.max(...sections.map((item) => item.x + item.width));
    const top = section?.y ?? 0;
    const { width, height, isLoading } = api.getAppState();
    if (isLoading || width <= 0 || height <= 0) return;
    const padding = width < 500 ? 14 : 30;
    const zoom = Math.max(0.1, Math.min(1.2, (width - padding * 2) / (right - left)));
    api.updateScene({ captureUpdate: CaptureUpdateAction.NEVER, appState: {
      zoom: { value: zoom as ReturnType<ExcalidrawImperativeAPI["getAppState"]>["zoom"]["value"] },
      scrollX: padding / zoom - left,
      scrollY: 24 / zoom - top,
    } });
    setActiveSection(section?.id ?? sections[0]?.id ?? null);
  }, [api]);

  useEffect(() => {
    if (!api || !result) return;
    let applied = false;
    let frame = 0;
    const applyWhenReady = () => {
      if (applied) return;
      const state = api.getAppState();
      if (state.isLoading || state.width <= 0 || state.height <= 0) return;
      applied = true;
      const restored = restore(result.scene, null, null);
      // Imported appState contains default viewport dimensions. Preserve the
      // live editor dimensions, and wait for its asynchronous initial scene load.
      api.updateScene({
        elements: restored.elements,
        appState: {
          viewBackgroundColor: result.scene.appState.viewBackgroundColor,
          viewModeEnabled: true, currentItemFontFamily: 2,
          selectedElementIds: {}, selectedGroupIds: {},
        },
        captureUpdate: CaptureUpdateAction.NEVER,
      });
      api.history.clear();
      frame = requestAnimationFrame(() => fitWidth());
    };
    const unsubscribe = api.onChange(() => {
      if (!applied) {
        cancelAnimationFrame(frame);
        frame = requestAnimationFrame(applyWhenReady);
      }
    });
    frame = requestAnimationFrame(applyWhenReady);
    return () => { unsubscribe(); cancelAnimationFrame(frame); };
  }, [api, result, fitWidth]);

  useEffect(() => {
    if (!api || !board.current) return;
    let frame = 0;
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      // Give Excalidraw's own ResizeObserver time to commit the new dimensions.
      frame = requestAnimationFrame(() => {
        frame = requestAnimationFrame(() => {
          const section = currentResult.current?.sections.find((item) => item.id === activeSectionRef.current);
          fitWidth(section);
        });
      });
    });
    observer.observe(board.current);
    return () => { observer.disconnect(); cancelAnimationFrame(frame); };
  }, [api, fitWidth]);

  useEffect(() => {
    if (!api) return;
    setZoomPercent(Math.round(api.getAppState().zoom.value * 100));
    return api.onScrollChange((_x, _y, zoom) => setZoomPercent(Math.round(zoom.value * 100)));
  }, [api]);

  const changeZoom = (factor: number) => {
    if (!api) return;
    const state = api.getAppState();
    const zoom = Math.max(0.1, Math.min(3, state.zoom.value * factor));
    api.updateScene({
      captureUpdate: CaptureUpdateAction.NEVER,
      appState: {
        zoom: { value: zoom as typeof state.zoom.value },
        scrollX: state.scrollX + state.width / (2 * zoom) - state.width / (2 * state.zoom.value),
        scrollY: state.scrollY + state.height / (2 * zoom) - state.height / (2 * state.zoom.value),
      },
    });
  };

  const fullscreen = hostContext?.displayMode === "fullscreen" || localFullscreen;
  const canFullscreen = standalone
    ? Boolean(document.fullscreenEnabled)
    : hostContext?.availableDisplayModes?.includes(fullscreen ? "inline" : "fullscreen");
  const toggleFullscreen = async () => {
    try {
      if (standalone) {
        if (document.fullscreenElement) await document.exitFullscreen();
        else await shell.current?.requestFullscreen();
      } else if (bridge.current) {
        const changed = await bridge.current.requestDisplayMode({ mode: fullscreen ? "inline" : "fullscreen" });
        setHostContext((context) => context ? { ...context, displayMode: changed.mode } : context);
      }
    } catch (cause) { setError(`Fullscreen could not open: ${errorMessage(cause)}`); }
  };

  const download = async (format: "excalidraw" | "svg") => {
    if (!api || !result) return;
    setExporting(true);
    setError(null);
    try {
      const elements = api.getSceneElements();
      if (!elements.length) throw new Error("Add something to the canvas before exporting it.");
      const state = api.getAppState();
      const files = api.getFiles();
      const filename = result.lesson.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "visual-lesson";
      if (format === "excalidraw") {
        saveBlob(new Blob([serializeAsJSON(elements, state, files, "local")], { type: "application/json" }), `${filename}.excalidraw`);
      } else {
        const svg = await exportToSvg({ elements, appState: { ...state, exportBackground: true, exportWithDarkMode: false }, files, exportPadding: 24 });
        saveBlob(new Blob([svg.outerHTML], { type: "image/svg+xml" }), `${filename}.svg`);
      }
      setNotice(`Downloaded ${format === "svg" ? "SVG" : "editable Excalidraw"} with your current changes.`);
    } catch (cause) { setError(`Export failed: ${errorMessage(cause)}`); }
    finally { setExporting(false); }
  };

  return <div ref={shell} className={`lesson-app${fullscreen ? " is-fullscreen" : ""}`}>
    <header className="app-header">
      <div className="brand"><span className="brand-mark"><Icon name="board" size={23} /></span><div><strong>Visual Learning</strong><span>A lesson, drawn clearly.</span></div></div>
      <span className={`connection-badge${pending ? " is-pending" : ""}`}><i />{pending ? "Planning your lesson" : result ? "One continuous canvas" : "MCP App"}</span>
    </header>

    {standalone && <form className="topic-form" onSubmit={(event) => { event.preventDefault(); if (topic.trim()) void generate(topic.trim(), level); }}>
      <label className="topic-field"><span>What would you like to understand?</span><input value={topic} onChange={(event) => setTopic(event.target.value)} maxLength={200} placeholder="A topic you’re curious about…" required /></label>
      <label className="level-field"><span>Level</span><select value={level} onChange={(event) => setLevel(event.target.value)}><option value="beginner">Beginner</option><option value="intermediate">Intermediate</option><option value="advanced">Advanced</option></select></label>
      <button className="primary-button" type="submit" disabled={pending || !topic.trim()}>{pending ? <span className="spinner" /> : <Icon name="arrow" />}<span>{pending ? "Creating…" : "Create lesson"}</span></button>
    </form>}

    <div className="lesson-intro">
      <div><span className="eyebrow">THE VISUAL LESSON</span><h1>{result?.lesson.title ?? (pending ? "Let’s make this clear." : planningRequest?.topic ?? "Your next aha moment.")}</h1><p>{result ? `${result.sections.length} chapters · ${result.lesson.level ?? "beginner"} · read, explore, and make it yours` : "From the big picture to a practical example, one step at a time."}</p></div>
      {result?.planner === "fixture" && <span className="demo-badge">Demo lesson</span>}
    </div>

    {(error || notice) && <div className={`status-message ${error ? "is-error" : ""}`} role={error ? "alert" : "status"}><span>{error ?? notice}</span><button aria-label="Dismiss message" onClick={() => { setError(null); setNotice(null); }}>×</button></div>}

    <main className="workspace">
      <aside className="lesson-outline" aria-label="Lesson chapters">
        <div className="outline-heading"><span className="eyebrow">FOLLOW THE STORY</span><span>{result?.sections.length ? String(result.sections.length).padStart(2, "0") : "—"}</span></div>
        <nav>{result?.sections.map((section) => <button key={section.id} className={`chapter-button${activeSection === section.id ? " is-active" : ""}`} onClick={() => fitWidth(section)} aria-current={activeSection === section.id ? "step" : undefined}><span className="chapter-number">{String(section.number).padStart(2, "0")}</span><span className="chapter-name">{section.title}</span><span className="chapter-dot" /></button>) ?? <div className="outline-placeholder">{planningRequest ? "Your assistant can prepare the chapters for this topic." : "A clear path through the topic is on its way."}</div>}</nav>
        <div className="outline-note"><span className="note-symbol">↳</span><p>Every chapter lives on this canvas. Follow it from top to bottom.</p></div>
        <div className="outline-footer"><Icon name="read" size={16} /><span>Built for understanding</span></div>
      </aside>

      <section className="canvas-panel" aria-label="Editable visual lesson">
        <div className="canvas-toolbar">
          <div className="mode-switch" aria-label="Canvas mode"><button className={!editing ? "is-selected" : ""} onClick={() => setEditing(false)} disabled={!result} aria-pressed={!editing}><Icon name="read" size={16} />Read</button><button className={editing ? "is-selected" : ""} onClick={() => setEditing(true)} disabled={!result} aria-pressed={editing}><Icon name="edit" size={16} />Edit</button></div>
          <div className="toolbar-actions">
            <button className="toolbar-button" title="Fit the canvas width, starting at the top" onClick={() => fitWidth()} disabled={!api}><Icon name="width" size={16} /><span>Fit width</span></button>
            <button className="toolbar-button" title="See the entire lesson" onClick={() => { api?.scrollToContent(api.getSceneElements(), { fitToViewport: true, viewportZoomFactor: 0.9, animate: false }); setActiveSection(null); }} disabled={!api}><Icon name="all" size={16} /><span>Fit all</span></button>
            <span className="toolbar-divider" />
            <details className="export-menu"><summary className="toolbar-button" aria-label="Export lesson"><Icon name="download" size={16} /><span>Export</span><span className="chevron">⌄</span></summary><div><button disabled={!api || exporting} onClick={(event) => { event.currentTarget.closest("details")?.removeAttribute("open"); void download("excalidraw"); }}><strong>Excalidraw</strong><small>Keep every element editable</small></button><button disabled={!api || exporting} onClick={(event) => { event.currentTarget.closest("details")?.removeAttribute("open"); void download("svg"); }}><strong>SVG image</strong><small>A crisp, shareable copy</small></button><button disabled={!api} onClick={(event) => { event.currentTarget.closest("details")?.removeAttribute("open"); if (api) setSceneExport(serializeAsJSON(api.getSceneElements(), api.getAppState(), api.getFiles(), "local")); }}><strong>Copy editable scene</strong><small>For hosts without downloads</small></button></div></details>
            {canFullscreen && <button className="toolbar-button icon-only" onClick={() => void toggleFullscreen()} title={fullscreen ? "Exit fullscreen" : "Open fullscreen"} aria-label={fullscreen ? "Exit fullscreen" : "Open fullscreen"}><Icon name="expand" size={17} /></button>}
          </div>
        </div>
        <div ref={board} className="board" data-editing={editing}>
          {result ? <CanvasBoundary><Excalidraw excalidrawAPI={setApi} initialData={{ appState: { currentItemFontFamily: 2 } }} viewModeEnabled={!editing} theme="light" handleKeyboardGlobally={false} detectScroll={true} UIOptions={{ canvasActions: { loadScene: false, saveToActiveFile: false, export: false, saveAsImage: false, toggleTheme: false } }} /></CanvasBoundary> : <div className="empty-board"><div className={`empty-illustration${pending ? " is-loading" : ""}`}><span /><span /><span /><Icon name="board" size={38} /></div><span className="eyebrow">A LITTLE STRUCTURE. A LOT OF CLARITY.</span><h2>{pending ? "Turning ideas into understanding" : planningRequest ? "Your assistant can plan this lesson" : "Ready when you are"}</h2><p>{pending ? "Organizing the lesson into a simple visual story…" : planningRequest ? `Ask your connected assistant to prepare a visual lesson about ${planningRequest.topic}. Its lesson will become an editable Excalidraw canvas here.` : "Ask your assistant to teach a topic visually to open its complete lesson here."}</p>{pending && <span className="loading-line"><i /></span>}</div>}
          {pending && result && <div className="canvas-loading" role="status"><span className="spinner" />Creating your next lesson…</div>}
        </div>
        <footer className="canvas-footer">
          <span><i className={editing ? "edit-dot" : "read-dot"} />{editing ? "Make notes, move shapes, draw connections" : "Scroll to follow the lesson · drag to explore"}</span>
          <div className="footer-actions">
            <span className="footer-hint">{editing ? "Export to keep your changes" : "Switch to Edit to make it yours"}</span>
            <div className="zoom-controls" aria-label="Canvas zoom">
              <button onClick={() => changeZoom(0.8)} disabled={!api || zoomPercent <= 10} aria-label="Zoom out">−</button>
              <span aria-live="polite">{zoomPercent}%</span>
              <button onClick={() => changeZoom(1.25)} disabled={!api || zoomPercent >= 300} aria-label="Zoom in">+</button>
            </div>
          </div>
        </footer>
      </section>
    </main>
    <div className="app-footnote"><span>Complex ideas. Clear pictures.</span><span>Powered by Excalidraw</span></div>
    {sceneExport && <div className="export-overlay"><section className="scene-export" role="dialog" aria-modal="true" aria-labelledby="scene-export-title"><h2 id="scene-export-title">Keep your editable canvas</h2><p>Copy this scene into a file ending in <strong>.excalidraw</strong>, then open it in Excalidraw. Your edits are included.</p><textarea aria-label="Editable scene JSON" value={sceneExport} readOnly onFocus={event => event.currentTarget.select()} /><button className="primary-button" onClick={() => setSceneExport(null)}>Done</button></section></div>}
  </div>;
}

createRoot(document.getElementById("root")!).render(<VisualLearningApp />);
