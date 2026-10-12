import { mkdir, writeFile } from "node:fs/promises";
import { FixturePlanner } from "../src/lesson/planner.js";
import { layoutLesson } from "../src/render/layout.js";

const lesson = await new FixturePlanner().plan({ topic: "JavaScript event loop", level: "beginner" });
const { scene } = layoutLesson(lesson);
await mkdir("artifacts", { recursive: true });
await writeFile("artifacts/event-loop.lesson.json", JSON.stringify(lesson, null, 2));
await writeFile("artifacts/event-loop.excalidraw", JSON.stringify(scene, null, 2));
console.log(`Created artifacts/event-loop.excalidraw (${scene.elements.length} editable elements, ${lesson.steps.length} sections).`);
