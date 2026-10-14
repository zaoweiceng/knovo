import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import App from "../src/App.tsx";

test("review categories include descendants, remember selection and keep empty categories scoped", async () => {
  const dom = new JSDOM('<div id="root"></div>', {
    url: "http://localhost/#view=review",
  });
  const notes = [
    ["计算机", "网络"],
    ["数学", "代数"],
    ["计算机", "编程"],
    ["语言"],
  ].map((category, i) => ({
    id: `note-${i}`,
    title: `知识 ${i}`,
    category,
    tags: [],
    summary: "摘要",
    body: "正文",
    status: "ready",
    learning_events: [],
    created_at: "2026-10-10",
    updated_at: "2026-10-10",
    review: { stage: 0 },
  }));
  dom.window.localStorage.setItem(
    "knowledge-review-category",
    JSON.stringify("计算机"),
  );
  const globals = {
    window: dom.window,
    document: dom.window.document,
    localStorage: dom.window.localStorage,
    IS_REACT_ACT_ENVIRONMENT: true,
    fetch: async (url) =>
      new Response(
        JSON.stringify(
          url === "/api/stats"
            ? {
                total: 4,
                version: 1,
                categories: 3,
                days: [],
                learningDays: [],
                errors: [],
              }
            : url === "/api/reviews"
              ? notes.slice(0, 3)
              : notes,
        ),
        { headers: { "content-type": "application/json" } },
      ),
  };
  const originals = new Map(
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
  window.scrollTo = () => {};
  let root = createRoot(document.getElementById("root"));
  const mount = async () => {
    await act(async () => root.render(createElement(App)));
    await act(async () => new Promise((resolve) => setTimeout(resolve, 180)));
  };
  const choose = async (value) =>
    act(async () => {
      const select = document.querySelector('[aria-label="复习大类"]');
      select.value = value;
      select.dispatchEvent(new window.Event("change", { bubbles: true }));
    });
  try {
    await mount();
    assert.equal(
      document.querySelector('[aria-label="复习大类"]').value,
      "计算机",
    );
    assert.equal(
      document.querySelector(".review-progress").textContent,
      "剩余 2 个",
    );
    assert.equal(
      document.querySelector(".review-card h2").textContent,
      "知识 0",
    );
    await act(async () => document.querySelector(".reveal").click());
    assert.ok(document.querySelector(".rating-row"));
    await choose("数学");
    assert.equal(
      document.querySelector(".review-progress").textContent,
      "剩余 1 个",
    );
    assert.equal(
      document.querySelector(".review-card h2").textContent,
      "知识 1",
    );
    assert.equal(document.querySelector(".rating-row"), null);
    assert.equal(
      JSON.parse(localStorage.getItem("knowledge-review-category")),
      "数学",
    );
    await act(async () => root.unmount());
    root = createRoot(document.getElementById("root"));
    await mount();
    assert.equal(
      document.querySelector('[aria-label="复习大类"]').value,
      "数学",
    );
    await choose("语言");
    assert.equal(
      document.querySelector(".review-progress").textContent,
      "剩余 0 个",
    );
    assert.match(
      document.querySelector(".empty-review h2").textContent,
      /语言/,
    );
    assert.equal(document.querySelector(".review-card"), null);
    await choose("");
    assert.equal(
      document.querySelector(".review-progress").textContent,
      "剩余 3 个",
    );
    await act(async () => root.unmount());
    localStorage.setItem("knowledge-review-category", '"已移除的大类"');
    root = createRoot(document.getElementById("root"));
    await mount();
    assert.equal(
      document.querySelector('[aria-label="复习大类"]').value,
      "已移除的大类",
    );
    assert.equal(
      document.querySelector(".review-card"),
      null,
      "missing category must not silently review everything",
    );
    await act(async () => root.unmount());
    localStorage.setItem("knowledge-review-category", "{broken");
    root = createRoot(document.getElementById("root"));
    await mount();
    assert.equal(document.querySelector('[aria-label="复习大类"]').value, "");
  } finally {
    await act(async () => root.unmount());
    dom.window.close();
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  }
});
