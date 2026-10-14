import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { act, createElement } from "react";

test("multi-select stays open, unions results and breadcrumb restores filters and page", async () => {
  const dom = new JSDOM('<div id="root"></div>', {
    url: "http://localhost/#view=library&category=%5B%22计算机%22%5D&tag=Go&page=2",
  });
  const notes = Array.from({ length: 41 }, (_, i) => ({
    id: `note-${i}`,
    title: `知识 ${i}`,
    category: ["计算机", "编程"],
    tags: i === 0 ? ["Go", "限流"] : i % 2 ? ["限流"] : ["Go"],
    summary: "摘要",
    body: "正文",
    status: "ready",
    learning_events: [],
    created_at: "2026-10-10",
    updated_at: "2026-10-10",
    review: { stage: 0, due: "2026-10-10" },
    relations: { prerequisites: [], related: [], dependents: [] },
  }));
  const globals = {
    window: dom.window,
    document: dom.window.document,
    localStorage: dom.window.localStorage,
    IS_REACT_ACT_ENVIRONMENT: true,
    fetch: async (url) => {
      const parsed = new URL(url, "http://localhost");
      const tags = parsed.searchParams.getAll("tag");
      const payload =
        parsed.pathname === "/api/stats"
          ? {
              total: 41,
              version: 1,
              categories: 1,
              due: 0,
              learning: 0,
              today: "2026-10-10",
              days: [],
              learningDays: [],
              errors: [],
            }
          : parsed.pathname.startsWith("/api/notes/")
            ? notes.find((n) => n.id === parsed.pathname.split("/").at(-1))
            : tags.length
              ? notes.filter((n) => tags.some((tag) => n.tags.includes(tag)))
              : notes;
      return new Response(JSON.stringify(payload), {
        headers: { "content-type": "application/json" },
      });
    },
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
  const { createRoot } = await import("react-dom/client");
  const { default: App } = await import("../src/App.tsx");
  const root = createRoot(document.getElementById("root"));
  const click = async (element) => act(async () => element.click());
  const settle = () =>
    act(async () => new Promise((resolve) => setTimeout(resolve, 200)));
  const byText = (selector, text) =>
    [...document.querySelectorAll(selector)].find(
      (el) => el.textContent === text,
    );
  try {
    await act(async () => root.render(createElement(App)));
    await settle();
    await click(document.querySelector('[aria-label="筛选关键词"]'));
    await click(document.querySelector('[aria-label="选择关键词 限流"]'));
    await settle();
    assert.ok(document.querySelector('[aria-label="筛选关键词面板"]'));
    assert.equal(
      document.querySelectorAll('.picker-select[aria-pressed="true"]').length,
      2,
    );
    assert.match(
      document.querySelector(".library-pagination").textContent,
      /共 41 条/,
    );
    assert.equal(document.querySelector('[aria-label="跳转页码"]').value, "1");
    await click(document.querySelector('[aria-label="选择关键词 Go"]'));
    await settle();
    assert.match(
      document.querySelector(".library-pagination").textContent,
      /共 21 条/,
    );
    await click(document.querySelector('[aria-label="选择关键词 Go"]'));
    await settle();
    await click(document.querySelector('[aria-label="筛选关键词"]'));
    await click(byText(".library-pagination button", "下一页"));
    await click(document.querySelector(".note-card"));
    assert.ok(document.querySelector(".article"));
    await click(byText(".breadcrumb button", "知识库"));
    await settle();
    assert.equal(document.querySelector('[aria-label="跳转页码"]').value, "2");
    assert.equal(document.querySelectorAll(".active-filters button").length, 3);
    assert.deepEqual(
      new Set(new URLSearchParams(window.location.hash.slice(1)).getAll("tag")),
      new Set(["Go", "限流"]),
    );
    await click(document.querySelector('[title="移除关键词 Go"]'));
    await settle();
    assert.deepEqual(
      new URLSearchParams(window.location.hash.slice(1)).getAll("tag"),
      ["限流"],
    );
    await click(byText(".filter-row .text-btn", "清除筛选"));
    await settle();
    await click(byText(".breadcrumb button", "知识库"));
    assert.equal(
      new URLSearchParams(window.location.hash.slice(1)).get("view"),
      "home",
    );
  } finally {
    await act(async () => root.unmount());
    dom.window.close();
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  }
});
