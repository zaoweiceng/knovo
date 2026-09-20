import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Store } from "../server/store.mjs";
import {
  serializeNote,
  parseNote,
  hash,
  addDays,
  acquireLock,
} from "../shared/protocol.mjs";
import { scan, apply, restore } from "../scripts/knowledge.mjs";
import { chatgpt, codex } from "../scripts/extract-history.mjs";
function note(id, extra = {}) {
  return {
    schema_version: 1,
    id,
    title: `知识 ${id}`,
    summary: "理解一个独立问题",
    category: ["计算机", "人工智能", "大模型", "Agent", "工具"],
    tags: ["中文", "Token"],
    status: "ready",
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    learning_events: [{ date: "2026-01-01", summary: "理解了原理" }],
    prerequisites: [],
    related: [],
    aliases: [],
    merged_from: [],
    body: "正文包含上下文窗口和 SQLite 数据库。",
    ...extra,
  };
}
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "knowledge-test-"));
  let time = new Date("2026-09-20T12:00:00");
  const store = new Store(root, path.join(root, ".knowledge"), () => time);
  t.after(() => {
    store.close();
    fs.rmSync(root, { recursive: true, force: true });
  });
  return {
    root,
    store,
    setTime: (v) => {
      time = new Date(v);
    },
    write: (id, extra = {}) => {
      const text = serializeNote(note(id, extra));
      fs.writeFileSync(path.join(root, id + ".md"), text);
      return text;
    },
  };
}
test("protocol: deep category, dates, self-links and invalid metadata", () => {
  const n = note("a");
  assert.equal(parseNote(serializeNote(n)).category.length, 5);
  assert.throws(() =>
    parseNote(
      serializeNote({
        ...n,
        learning_events: [{ date: "2026-02-30", summary: "x" }],
      }),
    ),
  );
  assert.throws(() => parseNote(serializeNote({ ...n, related: ["a"] })));
  assert.throws(() => parseNote("hello"));
  assert.equal(addDays("2026-12-31", 1), "2027-01-01");
});
test("import, Chinese search, identity-preserving edits and stable addition dates", (t) => {
  const { store, root, setTime } = fixture(t);
  const text = serializeNote(note("a"));
  assert.equal(store.import(text, "a.md").status, "created");
  assert.equal(store.import(text, "a.md").status, "skipped");
  assert.equal(store.list({ q: "上下文 SQLITE" }).length, 1);
  assert.equal(store.list({ q: "不存在" }).length, 0);
  assert.equal(
    store.list({ category: JSON.stringify(["计算机", "人工智能"]) }).length,
    1,
  );
  store.review("a", "good");
  const due = store.detail("a").review.due;
  setTime("2026-09-21T12:00:00");
  assert.equal(
    store.import(serializeNote(note("a", { title: "新标题" })), "new.md")
      .status,
    "updated",
  );
  assert.equal(store.detail("a").review.due, due);
  assert.deepEqual(
    store.stats().days.map((d) => ({ ...d })),
    [{ date: "2026-09-20", count: 1 }],
  );
  fs.renameSync(path.join(root, "a.md"), path.join(root, "renamed.md"));
  store.sync();
  assert.equal(store.detail("a").path, "renamed.md");
  fs.unlinkSync(path.join(root, "renamed.md"));
  store.sync();
  assert.equal(store.stats().total, 0);
  assert.equal(store.additions("2026-09-20")[0].active, 0);
  store.import(text, "a.md");
  assert.equal(store.stats().days[0].count, 1);
  assert.equal(store.detail("a").review.due, due);
});
test("invalid updates and duplicate ids retain last valid content", (t) => {
  const { store, root, write } = fixture(t);
  write("a");
  store.sync();
  fs.writeFileSync(path.join(root, "a.md"), "broken");
  store.sync();
  assert.equal(store.active().length, 1);
  assert.match(store.errors[0].message, /YAML/);
  write("a");
  fs.copyFileSync(path.join(root, "a.md"), path.join(root, "copy.md"));
  store.sync();
  assert.ok(store.errors.some((e) => e.message.includes("重复 ID")));
  assert.equal(store.active().length, 1);
});
test("first reviews are distributed, midnight and stage rules persist", (t) => {
  const { store, write, setTime } = fixture(t);
  for (let i = 0; i < 12; i++) write("n" + i);
  store.sync();
  assert.equal(
    store.active().filter((n) => n.review.due === "2026-09-21").length,
    10,
  );
  assert.equal(
    store.active().filter((n) => n.review.due === "2026-09-22").length,
    2,
  );
  setTime("2026-12-31T12:00:00");
  store.review("n0", "again");
  assert.equal(store.detail("n0").review.due, "2027-01-01");
  store.review("n0", "good");
  assert.equal(store.detail("n0").review.stage, 1);
  store.review("n0", "hard");
  assert.equal(store.detail("n0").review.stage, 1);
  store.setReview("n0", { paused: true });
  assert.equal(store.detail("n0").review.paused, 1);
});
test("graph: two hops, directed prerequisite, cycles, limits, missing references", (t) => {
  const { write, store } = fixture(t);
  write("a", { related: ["b"] });
  write("b", { prerequisites: ["c"] });
  write("c", { related: ["d", "a"] });
  write("d", { related: ["missing"] });
  store.sync();
  const g = store.graph("a", { depth: 2, limit: 2 });
  assert.equal(g.nodes.length, 2);
  assert.equal(g.truncated, true);
  const full = store.graph("a");
  assert.ok(
    full.edges.some(
      (e) => e.source === "c" && e.target === "b" && e.type === "prerequisite",
    ),
  );
  assert.equal(full.nodes.length, 4);
  assert.ok(store.errors.some((e) => e.message.includes("missing")));
  assert.equal(store.detail("b").relations.related[0].id, "a");
  assert.equal(
    store.graph("a", { category: JSON.stringify(["其他"]) }).nodes.length,
    1,
  );
});
test("maintenance baseline, incremental bounds, candidates and no self-induced churn", (t) => {
  const { write, root } = fixture(t);
  write("a");
  assert.equal(scan(root).changes.length, 0);
  for (let i = 0; i < 25; i++) write("new" + i);
  let result = scan(root);
  assert.equal(result.changes.length, 20);
  assert.equal(result.remaining, 5);
  assert.ok(result.changes.every((c) => c.candidates.length <= 10));
  const change = result.changes[0];
  const old = fs.readFileSync(path.join(root, change.path), "utf8"),
    n = parseNote(old);
  n.summary = "更新后的简介";
  const r = apply(root, {
    operations: [
      {
        path: change.path,
        expected_hash: hash(old),
        content: serializeNote(n),
      },
    ],
    processed: [{ path: change.path, expected_hash: hash(old) }],
  });
  assert.equal(scan(root).remaining, 4);
  assert.ok(!scan(root).changes.some((c) => c.path === change.path));
  restore(root, r.batch);
  assert.equal(fs.readFileSync(path.join(root, change.path), "utf8"), old);
});
test("maintenance rejects concurrency, lock contention and unsafe paths", (t) => {
  const { root, write } = fixture(t);
  const old = write("a");
  scan(root);
  write("a", { title: "外部修改" });
  assert.throws(
    () =>
      apply(root, {
        operations: [{ path: "a.md", expected_hash: hash(old), content: old }],
        processed: [],
      }),
    /并发/,
  );
  assert.throws(
    () =>
      apply(root, {
        operations: [{ path: "../bad.md", expected_hash: null, content: old }],
        processed: [],
      }),
    /路径/,
  );
  const release = acquireLock(path.join(root, ".knowledge"));
  assert.throws(() => scan(root), /维护/);
  release();
});
test("merge and restore preserve identities, review history and source progress", (t) => {
  const { root, write, store } = fixture(t);
  const a = write("a"),
    b = write("b");
  scan(root);
  store.sync();
  store.review("a", "good");
  store.review("b", "again");
  const before = store.detail("a").review;
  const merged = serializeNote(
    note("a", { merged_from: ["b"], aliases: ["知识 b"] }),
  );
  const batch = apply(root, {
    operations: [
      { path: "a.md", expected_hash: hash(a), content: merged },
      { path: "b.md", expected_hash: hash(b), content: null },
    ],
    processed: [{ path: "a.md", expected_hash: hash(a) }],
  });
  store.sync();
  assert.equal(store.active().length, 1);
  assert.equal(store.resolve("b"), "a");
  assert.equal(store.detail("a").history.length, 2);
  assert.equal(store.detail("a").review.stage, 0);
  restore(root, batch.batch);
  store.sync();
  assert.equal(store.active().length, 2);
  assert.equal(store.resolve("b"), "b");
  assert.equal(store.detail("a").history.length, 1);
  assert.equal(store.detail("b").history.length, 1);
  assert.equal(store.detail("a").review.stage, before.stage);
});
test("history adapters select active branch and exclude system/tools/reasoning", () => {
  const msg = (id, role, text) => ({
    id,
    author: { role },
    content: { parts: [text] },
  });
  const c = {
    id: "c",
    current_node: "final",
    mapping: {
      root: { parent: null, message: msg("s", "system", "secret") },
      user: { parent: "root", message: msg("u", "user", "question") },
      old: { parent: "user", message: msg("old", "assistant", "old branch") },
      final: { parent: "user", message: msg("f", "assistant", "answer") },
    },
  };
  assert.deepEqual(
    chatgpt([c])[0].messages.map((m) => m.text),
    ["question", "answer"],
  );
  assert.throws(() => chatgpt([{ mapping: {} }]), /current_node/);
  const lines = [
    {
      type: "response_item",
      payload: {
        type: "message",
        role: "system",
        content: [{ text: "secret" }],
      },
    },
    {
      type: "response_item",
      payload: {
        id: "1",
        type: "message",
        role: "assistant",
        phase: "analysis",
        content: [{ text: "reasoning" }],
      },
    },
    {
      type: "response_item",
      payload: {
        id: "2",
        type: "message",
        role: "user",
        content: [{ text: "question" }],
      },
    },
    {
      type: "response_item",
      payload: {
        id: "3",
        type: "message",
        role: "assistant",
        phase: "final_answer",
        content: [{ text: "answer" }],
      },
    },
  ]
    .map((x) => JSON.stringify(x))
    .join("\n");
  assert.deepEqual(
    codex(lines)[0].messages.map((m) => m.text),
    ["question", "answer"],
  );
});
test("calendar starts on Sunday, includes months, leap day and all heat thresholds", async () => {
  const { calendarCells, heatLevel } = await import("../src/calendar.ts");
  const cells = calendarCells("2026-09-20", "recent");
  assert.equal(new Date(cells[0].date + "T12:00:00").getDay(), 0);
  assert.equal(cells.length % 7, 0);
  assert.ok(cells.filter((c, i) => i % 7 === 0 && c.first).length >= 11);
  assert.ok(
    calendarCells("2026-09-20", "2024").some(
      (c) => c.date === "2024-02-29" && !c.disabled,
    ),
  );
  assert.deepEqual(
    [0, 1, 2, 3, 5, 6, 9, 10, 30].map(heatLevel),
    [0, 1, 1, 2, 2, 3, 3, 4, 4],
  );
});
test("subsequent merges flatten identities and can be restored independently", (t) => {
  const { root, write, store } = fixture(t);
  const a = write("a"),
    b = write("b"),
    c = write("c");
  scan(root);
  store.sync();
  store.review("b", "good");
  const mergedA = serializeNote(note("a", { merged_from: ["b"] }));
  apply(root, {
    operations: [
      { path: "a.md", expected_hash: hash(a), content: mergedA },
      { path: "b.md", expected_hash: hash(b), content: null },
    ],
    processed: [],
  });
  store.sync();
  assert.equal(store.resolve("b"), "a");
  const mergedC = serializeNote(note("c", { merged_from: ["a", "b"] }));
  const second = apply(root, {
    operations: [
      { path: "c.md", expected_hash: hash(c), content: mergedC },
      { path: "a.md", expected_hash: hash(mergedA), content: null },
    ],
    processed: [],
  });
  store.sync();
  assert.equal(store.errors.length, 0);
  assert.equal(store.resolve("b"), "c");
  assert.equal(store.detail("c").history.length, 1);
  restore(root, second.batch);
  store.sync();
  assert.equal(store.resolve("b"), "a");
  assert.equal(store.detail("a").history.length, 1);
  assert.equal(store.detail("c").history.length, 0);
});
