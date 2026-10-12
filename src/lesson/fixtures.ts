import { lessonSchema, type Lesson, type LessonStep, type Level } from "./schema.js";

type VisualNode = LessonStep["visual"]["nodes"][number];

const node = (id: string, label: string, detail: string, tone: VisualNode["tone"]): VisualNode => ({ id, label, detail, tone });
const lane = (nodes: VisualNode[], labels: string[] = []): LessonStep["visual"] => ({
  kind: "sequence",
  nodes,
  edges: nodes.slice(1).map((item, i) => ({ from: nodes[i]!.id, to: item.id, label: labels[i] ?? "" })),
});

export function eventLoopFixture(topic: string, level: Level): Lesson {
  const deeper = level !== "beginner";
  const advanced = level === "advanced";
  return lessonSchema.parse({
    topic,
    title: "The JavaScript event loop",
    level,
    summary: "A browser JavaScript lesson: run synchronous code, drain microtasks, then run another task. Follow all five steps on this canvas.",
    steps: [
      {
        id: "components",
        title: "Meet the four components",
        explanation: deeper
          ? "The JavaScript engine runs code on a call stack. The browser schedules tasks such as timer callbacks; Promise reactions enter the microtask queue. These queues belong to the host's event-loop machinery."
          : "The stack runs JavaScript. Browser APIs handle timers and events. Promise callbacks wait as microtasks; timer callbacks wait as tasks.",
        takeaway: "The browser schedules callbacks; the call stack executes them.",
        visual: {
          kind: "cards",
          nodes: [
            node("stack", "Call stack", "Runs the current JavaScript function calls.", "blue"),
            node("apis", "Browser APIs", "Timers and events are managed by the browser.", "purple"),
            node("micro", "Microtask queue", "Promise reactions and queueMicrotask callbacks.", "green"),
            node("task", "Task queues", "Timer callbacks and events wait for a turn.", "orange"),
          ],
          edges: [],
        },
        code: null,
      },
      {
        id: "synchronous",
        title: "Synchronous code runs first",
        explanation: "JavaScript executes the current script in order. A function call adds a stack frame, and returning removes it. Scheduled callbacks cannot interrupt this synchronous work.",
        takeaway: "Finish the current synchronous work before running queued callbacks.",
        visual: lane([
          node("start", "Start script", "The browser begins executing the script.", "blue"),
          node("call", "Call a function", "Push a frame; execute its body.", "purple"),
          node("return", "Return", "Pop the frame and continue the script.", "green"),
        ]),
        code: null,
      },
      {
        id: "asynchronous",
        title: "Schedule the asynchronous work",
        explanation: deeper
          ? "setTimeout registers a browser timer; once eligible, its callback is scheduled as a task. A reaction on an already fulfilled Promise is queued as a microtask. Registering either callback does not run it immediately."
          : "setTimeout asks the browser to schedule a callback later. A .then callback on an already resolved Promise goes into the microtask queue. The script keeps running.",
        takeaway: "A zero-millisecond timeout means eligible later, never immediately.",
        visual: {
          kind: "comparison",
          nodes: [
            node("timer", "setTimeout(callback, 0)", "Timer becomes eligible; its callback waits as a task.", "orange"),
            node("promise", "Promise.resolve().then(...)", "The reaction waits as a microtask.", "green"),
          ],
          edges: [],
        },
        code: null,
      },
      {
        id: "event-loop",
        title: "Microtasks have priority",
        explanation: advanced
          ? "At a microtask checkpoint, drain microtasks, including ones newly queued by microtasks. The browser may then render before another task. An endless microtask chain can starve tasks and rendering."
          : "After the current script finishes, the browser drains the microtask queue, including newly added microtasks. It can then run another task. Rendering may happen between turns; it is not guaranteed after each task.",
        takeaway: advanced
          ? "Microtask checkpoints drain to empty; yielding with another microtask does not allow a task to run."
          : "In this example, the Promise callback runs before the timer callback.",
        visual: lane([
          node("finish", "Finish current script", "Synchronous work completes and the stack is empty.", "blue"),
          node("drain", "Drain microtasks", "Run queued microtasks until the queue is empty.", "green"),
          node("next-task", "Run another task", "An eligible timer callback can now get a turn.", "orange"),
        ], ["checkpoint", "next turn"]),
        code: null,
      },
      {
        id: "example",
        title: "Predict the output: A D C B",
        explanation: "A and D are synchronous. C is a Promise microtask, so it runs after the script. B is a timer task, so it runs after the microtasks. Read the code and trace the four logs below.",
        takeaway: "Output: A, D, C, B. Scheduling order alone does not determine callback order.",
        visual: lane([
          node("a", "A", "First synchronous log.", "blue"),
          node("d", "D", "Last synchronous log.", "blue"),
          node("c", "C", "Promise microtask.", "green"),
          node("b", "B", "Timer task.", "orange"),
        ]),
        code: {
          language: "javascript",
          source: "console.log('A');\nsetTimeout(() => {\n  console.log('B');\n}, 0);\nPromise.resolve().then(\n  () => console.log('C')\n);\nconsole.log('D');",
          output: "A\nD\nC\nB",
        },
      },
    ],
  });
}

export function photosynthesisFixture(topic: string, level: Level): Lesson {
  const deeper = level !== "beginner";
  const advanced = level === "advanced";
  return lessonSchema.parse({
    topic,
    title: "Photosynthesis: light becomes stored energy",
    level,
    summary: "Follow how plants capture light, split water, and use carbon dioxide to build sugars inside chloroplasts.",
    steps: [
      {
        id: "ingredients",
        title: "Start with the inputs",
        explanation: "Leaves capture sunlight, roots supply water, and carbon dioxide enters leaves through small pores called stomata. These inputs support photosynthesis in chloroplasts.",
        takeaway: "Photosynthesis needs light, water, and carbon dioxide.",
        visual: {
          kind: "cards",
          nodes: [
            node("light", "Sunlight", "Supplies energy; it is not matter.", "orange"),
            node("water", "Water", "Comes from roots and travels to the leaves.", "blue"),
            node("carbon", "Carbon dioxide", "Enters through stomata; supplies carbon for sugars.", "purple"),
          ],
          edges: [],
        },
        code: null,
      },
      {
        id: "light-reactions",
        title: "Capture light energy",
        explanation: deeper
          ? "In thylakoid membranes, light powers electron transfer and a proton gradient. ATP synthase makes ATP; NADP+ is reduced to NADPH. Splitting water supplies electrons and releases oxygen."
          : "Chlorophyll in chloroplasts absorbs light. The light reactions use that energy to make ATP and NADPH, temporary energy carriers. Splitting water releases oxygen.",
        takeaway: "The released oxygen comes from water, not carbon dioxide.",
        visual: lane([
          node("absorb", "Absorb light", "Chlorophyll captures photons in the thylakoids.", "orange"),
          node("split", "Split water", "Water supplies electrons; oxygen is released.", "blue"),
          node("carriers", "ATP + NADPH", "Carry energy and reducing power to the next stage.", "green"),
        ]),
        code: null,
      },
      {
        id: "calvin-cycle",
        title: "Build carbon compounds",
        explanation: advanced
          ? "In the stroma, Rubisco fixes CO2 onto RuBP. ATP and NADPH support reduction to G3P and regeneration of RuBP. Three CO2 yield one net G3P using nine ATP and six NADPH; G3P can feed sugar synthesis."
          : deeper
            ? "The Calvin cycle in the stroma uses ATP and NADPH to fix CO2 and produce G3P. Some G3P leaves the cycle to help form sugars; the rest regenerates the carbon acceptor so the cycle continues."
            : "The Calvin cycle uses carbon dioxide and the energy carriers from the light reactions to make G3P, a small carbon compound. Plants use it to build sugars and other molecules.",
        takeaway: "The Calvin cycle does not directly use light, but depends on products of the light reactions.",
        visual: lane([
          node("fix", "Fix CO2", "Attach carbon dioxide to an existing carbon compound.", "purple"),
          node("reduce", "Use ATP + NADPH", "Provide energy and electrons to produce G3P.", "orange"),
          node("g3p", "G3P", "Some leaves to build sugars; most sustains the cycle.", "green"),
        ]),
        code: null,
      },
      {
        id: "big-picture",
        title: "Connect the whole process",
        explanation: "Light reactions supply ATP and NADPH to the Calvin cycle. Carbon from CO2 becomes part of organic molecules. Plants use those molecules for growth and release stored energy through cellular respiration.",
        takeaway: "Photosynthesis stores light energy in chemical form and supports most food chains.",
        visual: lane([
          node("sun", "Light energy", "Captured by the light reactions.", "orange"),
          node("chemical", "Chemical energy", "Temporarily carried by ATP and NADPH.", "blue"),
          node("organic", "Organic molecules", "Carbon compounds support growth and food chains.", "green"),
        ]),
        code: null,
      },
    ],
  });
}
