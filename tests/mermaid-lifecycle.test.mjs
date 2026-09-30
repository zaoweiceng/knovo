import test, { after } from "node:test";
import assert from "node:assert/strict";
import { setImmediate } from "node:timers/promises";
import { JSDOM } from "jsdom";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import mermaid from "mermaid";
import Markdown from "../src/Markdown.tsx";

const dom = new JSDOM("<!doctype html><html><body></body></html>");
const globals = {
  window: dom.window,
  document: dom.window.document,
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

const body = (label = "理解原理") =>
  `## 学习流程\n\n\`\`\`mermaid\nflowchart TD\n  A["${label}"] --> B["应用验证"]\n\`\`\``;
function Parent({ tick = 0, text }) {
  return createElement(
    "article",
    { "data-refresh": tick },
    createElement(Markdown, { body: text }),
  );
}
async function waitUntil(predicate) {
  const deadline = Date.now() + 3000;
  while (!predicate() && Date.now() < deadline) await setImmediate();
  assert.ok(predicate(), "async rendering completed");
}
function setup(t) {
  const requests = [];
  // Control completion to exercise real React mounting/effects and async DOM
  // replacement independently of Mermaid layout timing.
  t.mock.method(
    mermaid,
    "render",
    (id, source, container) =>
      new Promise((resolve, reject) => {
        requests.push({
          id,
          source,
          container,
          reject,
          complete() {
            resolve({
              svg: `<svg id="${id}" xmlns="http://www.w3.org/2000/svg"><text>完成</text></svg>`,
            });
          },
        });
      }),
  );
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  t.after(async () => {
    await act(async () => root.unmount());
    host.remove();
  });
  return {
    host,
    requests,
    render: (text, tick = 0) =>
      act(async () => root.render(createElement(Parent, { text, tick }))),
  };
}

test("parent refreshes and prose edits preserve the same Mermaid DOM and do not redraw", async (t) => {
  const { host, requests, render } = setup(t);
  await render(body());
  await waitUntil(() => requests.length === 1);
  requests[0].complete();
  await waitUntil(() => host.querySelector("svg"));
  const diagram = host.querySelector(".mermaid-diagram"),
    svg = diagram.querySelector("svg");
  for (let tick = 1; tick <= 5; tick++) await render(body(), tick);
  await render(body() + "\n\n补充说明，图表源码未变化。", 6);
  assert.equal(requests.length, 1);
  assert.equal(host.querySelector(".mermaid-diagram"), diagram);
  assert.equal(host.querySelector("svg"), svg);
});

test("diagram updates keep the old SVG until ready and hide temporary rendering DOM", async (t) => {
  const { host, requests, render } = setup(t);
  await render(body());
  await waitUntil(() => requests.length === 1);
  requests[0].complete();
  await waitUntil(() => host.querySelector("svg"));
  const oldSvg = host.querySelector("svg");
  await render(body("新的步骤"));
  await waitUntil(() => requests.length === 2);
  assert.equal(host.querySelector("svg"), oldSvg);
  assert.doesNotMatch(host.textContent, /正在绘制/);
  const staging = requests[1].container;
  assert.equal(staging.isConnected, true);
  assert.equal(staging.getAttribute("aria-hidden"), "true");
  assert.equal(staging.style.visibility, "hidden");
  assert.equal(staging.style.position, "fixed");
  requests[1].complete();
  await waitUntil(() => host.querySelector("svg")?.id === requests[1].id);
  assert.equal(staging.isConnected, false);
});

test("obsolete renders cannot replace newer diagrams and errors clean up staging DOM", async (t) => {
  const { host, requests, render } = setup(t);
  await render(body());
  await waitUntil(() => requests.length === 1);
  requests[0].complete();
  await waitUntil(() => host.querySelector("svg"));
  await render(body("过时步骤"));
  await waitUntil(() => requests.length === 2);
  await render(body("最新步骤"));
  await waitUntil(() => requests.length === 3);
  requests[2].complete();
  await waitUntil(() => host.querySelector("svg")?.id === requests[2].id);
  requests[1].complete();
  await waitUntil(() => !requests[1].container.isConnected);
  assert.equal(host.querySelector("svg").id, requests[2].id);
  await render(body("错误步骤"));
  await waitUntil(() => requests.length === 4);
  requests[3].reject(new Error("invalid Mermaid"));
  await waitUntil(() => host.querySelector(".diagram-error"));
  assert.equal(requests[3].container.isConnected, false);
  assert.match(host.textContent, /请检查 Mermaid 语法/);
  assert.match(
    host.querySelector(".diagram-error code").textContent,
    /错误步骤/,
  );
});
