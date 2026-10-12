import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type { Lesson } from "../lesson/schema.js";

export interface SceneDocument {
  type: "excalidraw";
  version: 2;
  source: string;
  elements: ExcalidrawElement[];
  appState: { viewBackgroundColor: string };
  files: Record<string, never>;
}
export interface SectionBounds {
  id: string;
  title: string;
  number: number;
  x: number;
  y: number;
  width: number;
  height: number;
  elementIds: string[];
}
export interface VisualLesson {
  id: string;
  lesson: Lesson;
  scene: SceneDocument;
  sections: SectionBounds[];
  planner: "fixture" | "llm";
  resourceUri?: string;
}
