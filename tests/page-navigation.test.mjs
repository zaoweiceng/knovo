import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import {
  readPage,
  pageHash,
  usePageNavigation,
} from "../src/usePageNavigation.ts";

test("page links round-trip filters, detail, dates and pagination; invalid links fall back safely", () => {
  const page = {
    view: "detail",
    selected: "中文/id",
    category: ["计算机", "A&B"],
    q: "测试 +",
    tags: ["标签", "A&B"],
    page: 3,
    fromDate: "2026-10-01",
    toDate: "2026-10-10",
  };
  assert.deepEqual(readPage(pageHash(page)), page);
  assert.equal(readPage("#view=detail&page=-2&category={").view, "library");
  assert.equal(readPage("#view=unknown&page=Infinity").page, 1);
});

test("browser back/forward restores list page and filters, typing replaces history, fallback stays in app", async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: "http://localhost/" });
  const globals = {
    window: dom.window,
    document: dom.window.document,
    IS_REACT_ACT_ENVIRONMENT: true,
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
  let scrolls = 0;
  dom.window.scrollTo = () => {
    scrolls++;
  };
  let nav;
  function Harness() {
    nav = usePageNavigation();
    return null;
  }
  const root = createRoot(document.getElementById("root"));
  const change = async (fn) => act(async () => fn());
  const travel = async (fn) =>
    act(async () => {
      const event = new Promise((resolve) =>
        window.addEventListener("popstate", resolve, { once: true }),
      );
      fn();
      await event;
    });
  try {
    await change(() => root.render(createElement(Harness)));
    assert.equal(nav.canGoBack, false);
    await change(() => nav.setView("library"));
    await change(() => nav.setQ("搜"));
    const length = window.history.length;
    await change(() => nav.setQ("搜索"));
    assert.equal(window.history.length, length);
    await change(() => nav.setCategory(["计算机"]));
    await change(() => nav.setLibraryPage(2));
    await change(() => {
      nav.setSelected("note-a");
      nav.setView("detail");
    });
    await change(() => nav.setSelected("note-b"));
    await travel(() => nav.back());
    assert.equal(nav.selected, "note-a");
    await travel(() => window.history.back());
    assert.equal(nav.view, "library");
    assert.equal(nav.page, 2);
    assert.deepEqual(nav.category, ["计算机"]);
    assert.equal(nav.q, "搜索");
    await travel(() => window.history.forward());
    assert.equal(nav.selected, "note-a");
    assert.equal(nav.view, "detail");
    await travel(() => window.history.back());
    await change(() => nav.setTags(["新标签", "另一个"]));
    assert.equal(nav.page, 1);
    assert.ok(scrolls >= 8);
    await change(() => root.unmount());
    window.history.replaceState(null, "", "#view=detail&id=direct");
    const directRoot = createRoot(document.getElementById("root"));
    await change(() => directRoot.render(createElement(Harness)));
    await change(() => nav.back());
    assert.equal(nav.view, "library");
    await change(() => directRoot.unmount());
  } finally {
    dom.window.close();
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  }
});

test("library renders 20 items per page, clamps oversized pages and resets repeated menu clicks", async () => {
  const { default: App } = await import("../src/App.tsx");
  const dom = new JSDOM('<div id="root"></div>', {
    url: "http://localhost/#view=library&page=99",
  });
  const notes = Array.from({ length: 41 }, (_, i) => ({
    id: `note-${i}`,
    title: `知识 ${i}`,
    category: ["计算机"],
    tags: [],
    summary: "摘要",
    body: "正文",
    status: "ready",
    learning_events: [],
    created_at: "2026-10-10",
    updated_at: "2026-10-10",
    review: { stage: 0 },
  }));
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
                total: 41,
                version: 1,
                categories: 1,
                days: [],
                learningDays: [],
                errors: [],
              }
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
  let scrolls = 0;
  window.scrollTo = () => {
    scrolls++;
  };
  const root = createRoot(document.getElementById("root"));
  const click = async (element) => act(async () => element.click());
  const pageButton = (text) =>
    [...document.querySelectorAll(".library-pagination button")].find(
      (el) => el.textContent === text,
    );
  try {
    await act(async () => root.render(createElement(App)));
    await act(async () => new Promise((resolve) => setTimeout(resolve, 220)));
    assert.equal(document.querySelectorAll(".note-card").length, 1);
    assert.equal(pageButton("下一页").disabled, true);
    await click(pageButton("上一页"));
    assert.equal(document.querySelectorAll(".note-card").length, 20);
    assert.equal(
      document.querySelector(".note-card h3").textContent,
      "知识 20",
    );
    const menu = document.querySelectorAll(".main-nav button")[1];
    await click(menu);
    await act(async () => new Promise((resolve) => setTimeout(resolve, 220)));
    assert.equal(document.querySelector(".note-card h3").textContent, "知识 0");
    assert.equal(pageButton("上一页").disabled, true);
    const previousScrolls = scrolls;
    await click(menu);
    assert.ok(
      scrolls > previousScrolls,
      "repeated menu click scrolls even when the route is unchanged",
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
