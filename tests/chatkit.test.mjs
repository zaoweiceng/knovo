import { flowExampleBody } from "../src/knowledgeFlowExample.ts";
import test, { after } from "node:test";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { Editor } from "@tiptap/core";
import { MarkdownManager } from "@tiptap/markdown";
import Markdown from "../src/Markdown.tsx";
import { parseWidget, studyFeedback } from "../src/chatkitSchema.ts";
import {
  chatkitExample,
  chatkitExampleBody,
  queueExample,
  stackExample,
  animationExampleBody,
} from "../src/chatkitExample.ts";
import { referencedImages } from "../server/assets.mjs";
import { formatMarkdown } from "../src/markdownActions.ts";
import { knowledgePrompt } from "../src/knowledgePrompt.ts";
import { visualExtensions } from "../src/visualExtensions.ts";
import { serializeVisualMarkdown } from "../src/visualMarkdown.ts";
import { parseKnowledgeText } from "../shared/text-import.mjs";
import { parseNote, serializeNote } from "../shared/protocol.mjs";

const dom = new JSDOM("<!doctype html><body></body>");
const globals = {
  window: dom.window,
  document: dom.window.document,
  navigator: dom.window.navigator,
  Node: dom.window.Node,
  HTMLElement: dom.window.HTMLElement,
  MutationObserver: dom.window.MutationObserver,
  FormData: dom.window.FormData,
  getComputedStyle: dom.window.getComputedStyle,
  IS_REACT_ACT_ENVIRONMENT: true,
};
const originals = Object.fromEntries(
  Object.keys(globals).map((key) => [
    key,
    Object.getOwnPropertyDescriptor(globalThis, key),
  ]),
);
for (const [key, value] of Object.entries(globals))
  Object.defineProperty(globalThis, key, {
    configurable: true,
    writable: true,
    value,
  });
after(() => {
  dom.window.close();
  for (const [key, descriptor] of Object.entries(originals)) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else delete globalThis[key];
  }
});
const quizExample = JSON.parse(
  readFileSync(
    new URL("./fixtures/chatkit-quiz.json", import.meta.url),
    "utf8",
  ),
);
const source = JSON.stringify(quizExample);
const fence = (s) => "```chatkit\n" + s + "\n```";
const quizBody = fence(source);
async function setup(t, body = quizBody) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const render = (value) =>
    act(async () => root.render(createElement(Markdown, { body: value })));
  await render(body);
  t.after(async () => {
    await act(async () => root.unmount());
    host.remove();
  });
  return { host, render };
}
const click = async (host, label) => {
  const button = [...host.querySelectorAll("button")].find((n) =>
    n.textContent.includes(label),
  );
  assert.ok(button, label);
  await act(async () => button.click());
};

test("reader renders actual widgets, validates answers, reveals feedback only after interaction and resets", async (t) => {
  const { host, render } = await setup(t);
  assert.ok(host.querySelector("svg"));
  assert.doesNotMatch(host.textContent, /仅觉得眼熟/);
  await click(host, "检查答案");
  assert.match(host.textContent, /请先作答/);
  host.querySelector("select").value = "reread";
  await click(host, "检查答案");
  assert.match(host.textContent, /再想一想/);
  host.querySelector("select").value = "explain";
  await click(host, "检查答案");
  assert.match(host.textContent, /回答正确/);
  await click(host, "查看解题提示");
  assert.match(host.textContent, /区分熟悉感与理解/);
  await render(quizBody + "\n\n补充文字");
  assert.match(host.textContent, /回答正确/);
  await click(host, "重新开始");
  assert.equal(host.querySelector("select").value, "");
  assert.doesNotMatch(host.textContent, /回答正确|区分熟悉感与理解/);
  await click(host, "查看解题提示");
  await render(fence(source.replace("主动回忆", "新练习")));
  assert.doesNotMatch(host.textContent, /区分熟悉感与理解/);
});

test("multiple cards keep independent state; editable Text accepts keyboard form submissions", async (t) => {
  const widget = structuredClone(quizExample);
  widget.children[3].children[0] = {
    type: "Text",
    value: "你的答案",
    editable: { name: "answer", required: true },
  };
  const body = fence(JSON.stringify(widget));
  const { host } = await setup(t, body + "\n\n" + body);
  const cards = host.querySelectorAll(".chatkit-widget");
  cards[0].querySelector("input").value = " EXPLAIN ";
  await act(async () =>
    cards[0]
      .querySelector("form")
      .dispatchEvent(
        new dom.window.Event("submit", { bubbles: true, cancelable: true }),
      ),
  );
  assert.match(cards[0].textContent, /回答正确/);
  assert.doesNotMatch(cards[1].textContent, /回答正确/);
});

test("invalid/unsupported payloads degrade to escaped source without breaking the note", async (t) => {
  const { host, render } = await setup(t, fence("{bad") + "\n\n正文依然可读");
  assert.match(host.textContent, /JSON 格式不正确/);
  assert.match(host.textContent, /正文依然可读/);
  assert.equal(host.querySelector("code").textContent, "{bad");
  await render(
    fence(
      JSON.stringify({
        type: "Card",
        children: [
          {
            type: "Markdown",
            value: "<script>bad()</script> [evil](javascript:alert(1))",
          },
        ],
      }),
    ),
  );
  assert.equal(host.querySelector("script"), null);
  assert.equal(host.querySelector('[href^="javascript:"]'), null);
  for (const value of [
    null,
    [],
    { type: "Image" },
    { type: "Card", children: "bad" },
    { type: "Card", status: { text: "unsupported" } },
    { type: "Card", children: [{ type: "Text", value: {} }] },
    {
      type: "Card",
      children: [
        {
          type: "Button",
          label: "run",
          onClickAction: {
            type: "fetch",
            handler: "client",
            payload: { url: "https://example.com" },
          },
        },
      ],
    },
  ])
    assert.throws(() => parseWidget(JSON.stringify(value)));
  assert.throws(() =>
    parseWidget(
      JSON.stringify({
        type: "Card",
        children: Array.from({ length: 201 }, () => ({
          type: "Text",
          value: "x",
        })),
      }),
    ),
  );
  let nested = { type: "Text", value: "x" };
  for (let i = 0; i < 14; i++) nested = { type: "Box", children: [nested] };
  assert.throws(() =>
    parseWidget(JSON.stringify({ type: "Card", children: [nested] })),
  );
  assert.throws(() => parseWidget(" ".repeat(64001)));
});

test("prompt example survives JSON import, note export and visual editor serialization", () => {
  const example = JSON.parse(knowledgePrompt.match(/^动画示例：(.*)$/m)[1]);
  const exampleWidget = parseWidget(
    example.body.match(/^```chatkit\n([\s\S]+)\n```$/)[1],
  );
  assert.equal(exampleWidget.type, "Card");
  assert.equal(exampleWidget.children[2].onClickAction.type, "widget.sequence");
  assert.deepEqual(parseWidget(JSON.stringify(chatkitExample)), chatkitExample);
  const [entry] = parseKnowledgeText(
    JSON.stringify({
      format: "zhixu-knowledge-v1",
      notes: [
        {
          key: "widget",
          title: "练习",
          summary: "学习",
          category: ["测试"],
          tags: [],
          knowledge_keywords: [],
          dependency_keywords: [],
          learning_events: [{ date: null, summary: "学习" }],
          status: "ready",
          body: example.body,
        },
      ],
    }),
  );
  assert.equal(parseNote(serializeNote(entry.note)).body, example.body);
  const manager = new MarkdownManager({ extensions: visualExtensions });
  const parsed = manager.parse(example.body);
  assert.deepEqual(
    manager.parse(serializeVisualMarkdown(manager, parsed)),
    parsed,
  );
  assert.equal(parsed.content[0].attrs.language, "chatkit");
  assert.deepEqual(
    parseWidget(parsed.content[0].content[0].text),
    exampleWidget,
  );
});

test("all copied teaching examples survive import and editor round trips", () => {
  for (const label of ["动画示例"]) {
    const { body } = JSON.parse(
      knowledgePrompt.match(new RegExp(`^${label}：(.*)$`, "m"))[1],
    );
    const widget = parseWidget(body.match(/^```chatkit\n([\s\S]+)\n```$/)[1]);
    const [entry] = parseKnowledgeText(
      JSON.stringify({
        format: "zhixu-knowledge-v1",
        notes: [
          {
            key: "example",
            title: "队列",
            summary: "先进先出",
            category: ["计算机"],
            tags: [],
            knowledge_keywords: ["队列"],
            dependency_keywords: [],
            status: "ready",
            learning_events: [],
            body,
          },
        ],
      }),
    );
    assert.equal(parseNote(serializeNote(entry.note)).body, body);
    const manager = new MarkdownManager({ extensions: visualExtensions });
    const parsed = manager.parse(body);
    const restored = manager.parse(serializeVisualMarkdown(manager, parsed));
    assert.deepEqual(restored, parsed);
    assert.deepEqual(parseWidget(restored.content[0].content[0].text), widget);
  }
});

test("copied animation example demonstrates state changes and resets", async (t) => {
  const example = (label) =>
    JSON.parse(knowledgePrompt.match(new RegExp(`^${label}：(.*)$`, "m"))[1])
      .body;
  const { host } = await setup(t, example("动画示例"));
  await click(host, "观察一次出队");
  assert.match(
    host.querySelector(".ck-sequence").textContent,
    /操作前：A 在队首/,
  );
  await click(host, "下一步");
  assert.match(host.querySelector(".ck-sequence").textContent, /移除并返回 A/);
  assert.equal(host.querySelector('.ck-sequence [data-widget-key="A"]'), null);
  assert.match(
    host.querySelector('.ck-sequence [data-widget-key="B"]').textContent,
    /队首/,
  );
  await click(host, "重置动画");
  assert.ok(host.querySelector('.ck-sequence [data-widget-key="A"]'));
});

test("component flow animates a keyed request along the selected path", async (t) => {
  const body = flowExampleBody;
  const { host } = await setup(t, body);
  assert.ok(
    host.querySelector('[data-widget-key="request-q"]'),
    "initial diagram is visible",
  );
  await click(host, "打开路径动画");
  const current = () =>
    host.querySelector('.ck-sequence [data-widget-key="request-q"]')
      .parentElement;
  assert.match(current().textContent, /请求/);
  await click(host, "下一步");
  assert.match(current().textContent, /缓存/);
  await click(host, "下一步");
  assert.match(current().textContent, /数据源/);
  await change(host.querySelector("select"), "hit");
  assert.equal(
    host.querySelector(".ck-sequence"),
    null,
    "switching branches closes and resets playback",
  );
  await click(host, "打开路径动画");
  await click(host, "下一步");
  await click(host, "下一步");
  assert.match(current().textContent, /返回/);
  assert.match(host.querySelector(".ck-sequence").textContent, /跳过数据源/);
});

test("visual editor preserves raw JSON alongside interactive preview and cleans up on language changes", async () => {
  const host = document.createElement("div");
  document.body.append(host);
  let editor;
  try {
    await act(async () => {
      editor = new Editor({
        element: host,
        extensions: visualExtensions,
        content: chatkitExampleBody,
        contentType: "markdown",
      });
    });
    assert.equal(
      host.querySelector("pre code").textContent,
      JSON.stringify(chatkitExample, null, 2),
    );
    assert.ok(host.querySelector(".chatkit-widget select"));
    await click(host, "展开微观解释");
    const original = editor.getJSON();
    assert.doesNotMatch(JSON.stringify(original), /ck-feedback/);
    await act(async () =>
      editor.view.dispatch(
        editor.state.tr.setNodeMarkup(0, undefined, { language: "json" }),
      ),
    );
    assert.equal(host.querySelector(".chatkit-widget"), null);
    await act(async () =>
      editor.view.dispatch(
        editor.state.tr.setNodeMarkup(0, undefined, { language: "chatkit" }),
      ),
    );
    assert.ok(host.querySelector(".chatkit-widget select"));
  } finally {
    await act(async () => editor?.destroy());
    host.remove();
  }
});

test("exact matching normalizes case and width, rejects blank answers, and does not grade semantics", () => {
  const action = quizExample.children[3].onSubmitAction;
  assert.equal(
    studyFeedback(action, { answer: " ＥＸＰＬＡＩＮ " }).kind,
    "success",
  );
  assert.equal(
    studyFeedback(action, { answer: "explain in my own words" }).kind,
    "danger",
  );
  assert.equal(studyFeedback(action, { answer: " " }).kind, "warning");
});

const change = async (select, value) =>
  act(async () => {
    select.value = value;
    select.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
  });

test("image cards have no quiz chrome and failed images preserve the surrounding content", async (t) => {
  const image = {
    type: "Image",
    src: "https://example.com/diagram.png",
    alt: "结构图",
    height: 120,
    fit: "contain",
    frame: true,
  };
  const { host } = await setup(
    t,
    fence(
      JSON.stringify({
        type: "Card",
        children: [image, { type: "Caption", value: "图片说明" }],
      }),
    ),
  );
  assert.equal(host.querySelector("img").getAttribute("src"), image.src);
  assert.equal(
    host.querySelector("img").getAttribute("referrerpolicy"),
    "no-referrer",
  );
  assert.equal(host.querySelector("button"), null);
  assert.doesNotMatch(host.textContent, /答题|练习|复习进度/);
  await act(async () =>
    host.querySelector("img").dispatchEvent(new dom.window.Event("error")),
  );
  assert.match(host.textContent, /图片暂时无法加载：结构图/);
  assert.match(host.textContent, /图片说明/);
});

test("standalone Select switches actual images and explanations; disclosures toggle, branch state resets", async (t) => {
  const { host } = await setup(t, chatkitExampleBody);
  assert.match(host.querySelector("img").src, /water-liquid.svg$/);
  assert.doesNotMatch(host.textContent, /回答正确|检查答案|氢键网络/);
  await click(host, "展开微观解释");
  assert.match(host.textContent, /氢键网络/);
  const button = [...host.querySelectorAll("button")].find((n) =>
    n.textContent.includes("展开微观解释"),
  );
  assert.equal(button.getAttribute("aria-expanded"), "true");
  assert.ok(
    host.querySelector(`[id="${button.getAttribute("aria-controls")}"]`),
  );
  await click(host, "展开微观解释");
  assert.doesNotMatch(host.textContent, /氢键网络/);
  await change(host.querySelector("select"), "gas");
  assert.match(host.querySelector("img").src, /water-gas.svg$/);
  assert.match(host.textContent, /水蒸气本身不可见/);
  await click(host, "展开微观解释");
  assert.match(host.textContent, /白雾/);
  await click(host, "重新开始");
  assert.equal(host.querySelector("select").value, "liquid");
  assert.match(host.querySelector("img").src, /water-liquid.svg$/);
  assert.doesNotMatch(host.textContent, /白雾/);
});

test("queue and stack frames demonstrate FIFO and LIFO independently", async (t) => {
  const { host } = await setup(
    t,
    fence(JSON.stringify(queueExample)) +
      "\n\n" +
      fence(JSON.stringify(stackExample)),
  );
  const [queue, stack] = host.querySelectorAll(".chatkit-widget");
  await click(queue, "打开队列动画");
  await click(stack, "打开栈动画");
  const items = (card) =>
    [...card.querySelectorAll(".ck-sequence [data-widget-key]")].map(
      (n) => n.textContent,
    );
  for (let i = 0; i < 3; i++) {
    await click(queue, "下一步");
    await click(stack, "下一步");
  }
  assert.deepEqual(items(queue), ["A", "B", "C"]);
  assert.deepEqual(items(stack), ["C", "B", "A"]);
  await click(queue, "下一步");
  await click(stack, "下一步");
  assert.deepEqual(items(queue), ["B", "C"]);
  assert.deepEqual(items(stack), ["B", "A"]);
  assert.match(queue.textContent, /最先进入的 A 先离开/);
  assert.match(stack.textContent, /最后进入的 C 先离开/);
  await click(queue, "上一步");
  assert.deepEqual(items(queue), ["A", "B", "C"]);
  assert.deepEqual(items(stack), ["B", "A"]);
  await click(queue, "重置动画");
  assert.deepEqual(items(queue), []);
  assert.match(queue.textContent, /第 1 \/ 7 步/);
});

test("animation playback pauses, ends at the final frame, and cancels timers on close, reset and source change", async (t) => {
  const timers = new Map();
  let nextId = 0;
  t.mock.method(window, "setTimeout", (fn) => {
    const id = ++nextId;
    timers.set(id, fn);
    return id;
  });
  t.mock.method(window, "clearTimeout", (id) => timers.delete(id));
  const tick = async () => {
    assert.equal(timers.size, 1);
    const [id, fn] = timers.entries().next().value;
    timers.delete(id);
    await act(async () => fn());
  };
  const { host, render } = await setup(t, fence(JSON.stringify(queueExample)));
  await click(host, "打开队列动画");
  assert.equal(timers.size, 0);
  await click(host, "播放");
  await tick();
  assert.match(host.textContent, /第 2 \/ 7 步/);
  await click(host, "暂停");
  assert.equal(timers.size, 0);
  await click(host, "播放");
  for (let i = 0; i < 5; i++) await tick();
  assert.match(host.textContent, /第 7 \/ 7 步/);
  assert.equal(timers.size, 0);
  await click(host, "播放");
  assert.match(host.textContent, /第 1 \/ 7 步/);
  await click(host, "打开队列动画");
  assert.equal(timers.size, 0);
  await click(host, "打开队列动画");
  await click(host, "播放");
  await act(async () =>
    document.dispatchEvent(new dom.window.Event("visibilitychange")),
  );
  assert.equal(timers.size, 0);
  await click(host, "播放");
  await click(host, "重新开始");
  assert.equal(timers.size, 0);
  await click(host, "打开队列动画");
  await click(host, "播放");
  await render(chatkitExampleBody);
  assert.equal(timers.size, 0);
});

test("nested image/action/frame data is validated before any branch renders", () => {
  const parseChild = (child) =>
    parseWidget(JSON.stringify({ type: "Card", children: [child] }));
  for (const src of [
    "javascript:alert(1)",
    "data:image/svg+xml,<svg/>",
    "//evil.example/x.png",
    "/api/delete",
    "https://user:password@example.com/a.png",
    "file:///tmp/private.png",
  ]) {
    assert.throws(() => parseChild({ type: "Image", src }));
    assert.throws(() =>
      parseChild({
        type: "Button",
        label: "展开",
        onClickAction: {
          type: "widget.toggle",
          handler: "client",
          payload: { content: { type: "Image", src } },
        },
      }),
    );
  }
  const action = structuredClone(queueExample.children[3].onClickAction);
  action.payload.frames[6] = { type: "script", value: "bad" };
  assert.throws(() =>
    parseChild({ type: "Button", label: "动画", onClickAction: action }),
  );
  action.payload.frames = Array.from({ length: 21 }, () => ({
    type: "Text",
    value: "x",
  }));
  assert.throws(() =>
    parseChild({ type: "Button", label: "动画", onClickAction: action }),
  );
  action.payload.frames = [
    { type: "Text", value: "x" },
    { type: "Text", value: "y" },
  ];
  action.payload.intervalMs = 5;
  assert.throws(() =>
    parseChild({ type: "Button", label: "动画", onClickAction: action }),
  );
  const selector = structuredClone(chatkitExample.children[3]);
  selector.onChangeAction.payload.views.pop();
  assert.throws(() => parseChild(selector));
  assert.throws(() => parseChild({ type: "Transition", children: [] }));
  assert.doesNotThrow(() =>
    parseChild({
      type: "Transition",
      children: { type: "Text", value: "过渡内容" },
    }),
  );
});

test("image and animation examples survive serialization; asset references in hidden branches are exportable", () => {
  const manager = new MarkdownManager({ extensions: visualExtensions });
  for (const action of [
    "chatkit",
    "paginationCard",
    "queueAnimation",
    "stackAnimation",
  ]) {
    const body = formatMarkdown("", 0, 0, action).text;
    const parsed = manager.parse(body);
    const block = parsed.content.find((n) => n.type === "codeBlock");
    assert.doesNotThrow(() => parseWidget(block.content[0].text));
    assert.deepEqual(
      manager.parse(serializeVisualMarkdown(manager, parsed)),
      parsed,
    );
  }
  const animation = JSON.parse(knowledgePrompt.match(/^动画示例：(.*)$/m)[1]);
  assert.equal(animation.body, animationExampleBody);
  const asset = "a".repeat(64);
  const nested = {
    type: "Card",
    children: [
      {
        type: "Button",
        label: "展开图片",
        onClickAction: {
          type: "widget.toggle",
          handler: "client",
          payload: { content: { type: "Image", src: `/api/assets/${asset}` } },
        },
      },
    ],
  };
  assert.deepEqual(referencedImages(fence(JSON.stringify(nested))), [asset]);
  assert.doesNotThrow(() => parseWidget(JSON.stringify(nested)));
});

test("keyed frames animate movement and removal, cancel old effects, and honor reduced motion", async (t) => {
  const animations = [];
  const prototype = dom.window.HTMLElement.prototype;
  const originalAnimate = Object.getOwnPropertyDescriptor(prototype, "animate");
  let reduced = false;
  const originalMedia = Object.getOwnPropertyDescriptor(window, "matchMedia");
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: () => ({ matches: reduced }),
  });
  Object.defineProperty(prototype, "animate", {
    configurable: true,
    value(frames) {
      const effect = {
        frames,
        cancelled: false,
        cancel() {
          this.cancelled = true;
        },
        onfinish: null,
      };
      animations.push(effect);
      return effect;
    },
  });
  t.after(() => {
    if (originalAnimate)
      Object.defineProperty(prototype, "animate", originalAnimate);
    else delete prototype.animate;
    if (originalMedia)
      Object.defineProperty(window, "matchMedia", originalMedia);
    else delete window.matchMedia;
  });
  t.mock.method(prototype, "getBoundingClientRect", function () {
    const siblings = this.parentElement ? [...this.parentElement.children] : [];
    return {
      left: this.dataset.widgetKey ? siblings.indexOf(this) * 60 : 0,
      top: 0,
      width: 52,
      height: 38,
    };
  });
  const { host, render } = await setup(t, fence(JSON.stringify(queueExample)));
  await click(host, "打开队列动画");
  for (let i = 0; i < 4; i++) await click(host, "下一步");
  assert.ok(
    animations.some(
      (effect) => effect.frames[0].transform === "translate(60px, 0px)",
    ),
    "remaining elements shift into the removed front slot",
  );
  assert.ok(
    host.querySelector('.ck-transition-overlay [data-widget-key="A"]'),
    "removed item has an exit overlay",
  );
  await click(host, "重置动画");
  assert.ok(animations.some((effect) => effect.cancelled));
  const samePosition = {
    type: "Card",
    children: [
      {
        type: "Button",
        label: "状态动画",
        onClickAction: {
          type: "widget.sequence",
          handler: "client",
          payload: {
            frames: [
              { type: "Badge", key: "page", label: "age=25" },
              { type: "Badge", key: "page", label: "age=30" },
            ],
          },
        },
      },
    ],
  };
  await render(fence(JSON.stringify(samePosition)));
  await click(host, "状态动画");
  const beforeChange = animations.length;
  await click(host, "下一步");
  assert.ok(
    animations.length > beforeChange,
    "same-position value changes have visible feedback",
  );
  assert.deepEqual(animations.at(-1).frames, [
    { opacity: 0.35 },
    { opacity: 1 },
  ]);
  reduced = true;
  await render(fence(JSON.stringify(stackExample)));
  const count = animations.length;
  await click(host, "打开栈动画");
  await click(host, "下一步");
  assert.equal(animations.length, count);
  assert.match(host.textContent, /A 入栈/);
});

test("static pagination infographic renders equal-width data blocks and labels without quiz controls", async (t) => {
  const { host } = await setup(
    t,
    formatMarkdown("", 0, 0, "paginationCard").text,
  );
  assert.equal(host.querySelector(".ck-error"), null);
  assert.equal(host.querySelector("button"), null);
  assert.equal(host.querySelectorAll(".ck-box").length, 9);
  assert.deepEqual(
    [...host.querySelectorAll(".ck-box")].map((box) => box.textContent),
    ["101", "102", "103", "104", "105", "106", "107", "108", "109"],
  );
  assert.equal(host.querySelector(".ck-box").style.flex, "1 1 0%");
  assert.equal(
    host.querySelector(".ck-box").style.backgroundColor,
    "rgb(243, 243, 243)",
  );
  assert.match(host.textContent, /nextToken=cursor_103/);
  for (const background of [
    "url(https://example.com/x)",
    "red;position:fixed",
    {},
    "#12345",
  ]) {
    assert.throws(() =>
      parseWidget(JSON.stringify({ type: "Card", background })),
    );
  }
});

test("clipboard prompt stays compact without dropping animation and import constraints", () => {
  assert.ok(
    knowledgePrompt.length <= 4000,
    `Prompt grew to ${knowledgePrompt.length} characters`,
  );
  assert.match(knowledgePrompt, /zhixu-knowledge-v1/);
  assert.match(knowledgePrompt, /必须生成 widget.sequence/);
  assert.match(knowledgePrompt, /不做语义或子串匹配/);
});
