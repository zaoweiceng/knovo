import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Store } from "../server/file-store.mjs";
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
    knowledge_keywords: [id],
    dependency_keywords: [],
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
  write("a", { knowledge_keywords: ["ab", "ac"] });
  write("b", { knowledge_keywords: ["ab"], dependency_keywords: ["C"] });
  write("c", { knowledge_keywords: ["C", "ac", "cd"] });
  write("d", { knowledge_keywords: ["cd"], dependency_keywords: ["missing"] });
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
  assert.equal(store.errors.length, 0);
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
test("trash deletion and restore preserve review history and first-import count", (t) => {
  const { write, root, store } = fixture(t);
  write("trash-target");
  write("dependent", { dependency_keywords: ["trash-target"] });
  store.sync();
  store.review("trash-target", "good");
  const before = store.detail("trash-target");
  const archived = store.deleteNote("trash-target", before.hash);
  assert.equal(store.detail("trash-target"), null);
  assert.equal(fs.existsSync(path.join(root, "trash-target.md")), false);
  assert.equal(store.trash().length, 1);
  assert.equal(store.detail("dependent").relations.prerequisites.length, 0);
  assert.equal(store.stats().days[0].count, 2);
  store.restoreNote(archived.token);
  assert.equal(store.trash().length, 0);
  assert.equal(store.detail("trash-target").review.stage, before.review.stage);
  assert.equal(store.detail("trash-target").history.length, 1);
  assert.equal(store.stats().days[0].count, 2);
  assert.equal(store.errors.length, 0);
  assert.throws(() => store.restoreNote(archived.token), /已恢复/);
});
test("deletion rejects stale content and restore never overwrites an existing file", (t) => {
  const { write, root, store } = fixture(t);
  write("protected");
  store.sync();
  const before = store.detail("protected");
  write("protected", { summary: "外部新增内容" });
  assert.throws(() => store.deleteNote("protected", before.hash), /已被修改/);
  assert.equal(store.trash().length, 0);
  store.sync();
  const archived = store.deleteNote(
    "protected",
    store.detail("protected").hash,
  );
  fs.writeFileSync(path.join(root, "protected.md"), "不要覆盖");
  assert.throws(() => store.restoreNote(archived.token), /路径已被占用/);
  assert.equal(
    fs.readFileSync(path.join(root, "protected.md"), "utf8"),
    "不要覆盖",
  );
  assert.equal(store.trash().length, 1);
  assert.throws(() => store.restoreNote("../invalid"), /无效/);
});
test("learning heatmap uses historical dates, deduplicates per day and excludes unknown dates", (t) => {
  const { write, store } = fixture(t);
  const events = [
    { date: "2025-12-31", summary: "首次理解" },
    { date: "2025-12-31", summary: "同日补充" },
    { date: "2026-07-06", summary: "再次学习" },
    { date: null, summary: "日期未知" },
  ];
  const a = write("historical", { learning_events: events });
  write("another", {
    learning_events: [{ date: "2026-07-06", summary: "独立知识" }],
  });
  write("undated", { learning_events: [{ date: null, summary: "未知" }] });
  store.sync();
  assert.deepEqual(store.stats().learningDays, [
    { date: "2025-12-31", count: 1 },
    { date: "2026-07-06", count: 2 },
  ]);
  assert.equal(store.stats().days[0].date, "2026-09-20");
  assert.equal(store.learningActivity("2026-09-20").length, 0);
  for (const d of store.stats().learningDays)
    assert.equal(store.learningActivity(d.date).length, d.count);
  store.import(a, "historical.md");
  assert.equal(store.learningActivity().length, 3);
  write("historical", {
    learning_events: [{ date: "2026-07-07", summary: "修正学习日期" }],
  });
  store.sync();
  assert.deepEqual(store.stats().learningDays, [
    { date: "2026-07-06", count: 1 },
    { date: "2026-07-07", count: 1 },
  ]);
  const trash = store.deleteNote("historical", store.detail("historical").hash);
  assert.equal(store.learningActivity("2026-07-07")[0].active, 0);
  store.restoreNote(trash.token);
  assert.equal(store.learningActivity("2026-07-07").length, 1);
});
test("learning activity deduplicates merged identities while preserving distinct dates", (t) => {
  const { write, root, store } = fixture(t);
  write("a", { learning_events: [{ date: "2026-07-02", summary: "a" }] });
  write("b", {
    learning_events: [
      { date: "2026-07-02", summary: "duplicate" },
      { date: "2026-07-03", summary: "later" },
    ],
  });
  store.sync();
  fs.unlinkSync(path.join(root, "b.md"));
  write("a", {
    merged_from: ["b"],
    learning_events: [
      { date: "2026-07-02", summary: "a" },
      { date: "2026-07-03", summary: "merged" },
    ],
  });
  store.sync();
  assert.deepEqual(store.stats().learningDays, [
    { date: "2026-07-02", count: 1 },
    { date: "2026-07-03", count: 1 },
  ]);
  assert.equal(store.learningActivity("2026-07-03")[0].resolved_id, "a");
});

test("editor saves preserve identity and review progress, reject stale writes and invalid creates", (t) => {
  const { store, root } = fixture(t);
  store.saveNote(serializeNote(note("edit")));
  store.review("edit", "good");
  const source = store.source("edit");
  const changed = { ...parseNote(source.text), body: "完整解释与新的例子" };
  store.saveNote(serializeNote(changed), "edit", source.hash);
  assert.equal(store.detail("edit").body, changed.body);
  assert.equal(store.detail("edit").review.stage, 1);
  assert.equal(store.detail("edit").history.length, 1);
  assert.equal(store.stats().days[0].count, 1);
  assert.throws(
    () => store.saveNote(source.text, "edit", source.hash),
    /已被修改/,
  );
  assert.throws(() => store.saveNote(source.text), /ID 已存在/);
  assert.throws(
    () =>
      store.saveNote(
        serializeNote(note("different")),
        "edit",
        store.source("edit").hash,
      ),
    /不能修改知识点 ID/,
  );
  assert.throws(
    () =>
      store.saveNote(
        serializeNote({ ...changed, created_at: "2025-01-01T00:00:00Z" }),
        "edit",
        store.source("edit").hash,
      ),
    /创建时间/,
  );
  assert.ok(
    fs.readdirSync(path.join(root, ".knowledge/upload-backups")).length,
  );
  fs.writeFileSync(
    path.join(root, "edit.md"),
    serializeNote({ ...changed, body: "磁盘外部修改" }),
  );
  assert.throws(
    () => store.saveNote(source.text, "edit", source.hash),
    /已被修改/,
  );
});

test("date range bundles round-trip across stores, retain relationships and report conflicts", async (t) => {
  const { exportBundle, readBundle } = await import("../server/transfer.mjs");
  const a = fixture(t),
    b = fixture(t);
  a.write("a", {
    knowledge_keywords: ["ab"],
    learning_events: [
      { date: "2025-12-31", summary: "first" },
      { date: "2026-01-01", summary: "again" },
    ],
  });
  a.write("b", {
    knowledge_keywords: ["ab"],
    learning_events: [{ date: "2026-01-02", summary: "last" }],
  });
  a.write("c", { learning_events: [{ date: null, summary: "unknown" }] });
  a.store.sync();
  const files = readBundle(
    exportBundle(a.store, { from: "2025-12-31", to: "2026-01-02" }),
  );
  assert.equal(files.length, 2);
  for (const f of files)
    assert.equal(
      b.store.import(f.text, f.name, { rejectConflict: true }).status,
      "created",
    );
  assert.equal(b.store.detail("a").relations.related[0].id, "b");
  assert.equal(b.store.detail("a").learning_events.length, 2);
  for (const f of files)
    assert.equal(
      b.store.import(f.text, f.name, { rejectConflict: true }).status,
      "skipped",
    );
  b.store.import(
    serializeNote(note("a", { body: "目标设备上的修改" })),
    "a.md",
  );
  assert.throws(
    () =>
      b.store.import(files.find((f) => f.name === "notes/a.md").text, "a.md", {
        rejectConflict: true,
      }),
    /未覆盖/,
  );
  assert.equal(b.store.detail("a").body, "目标设备上的修改");
  assert.equal(
    readBundle(
      exportBundle(a.store, {
        from: "2026-01-01",
        to: "2026-01-01",
        basis: "created",
      }),
    ).length,
    3,
  );
  assert.equal(
    readBundle(exportBundle(a.store, { from: "2026-01-02", to: "2026-01-02" }))
      .length,
    1,
  );
  assert.throws(() =>
    exportBundle(a.store, { from: "2026-02-30", to: "2026-03-01" }),
  );
  assert.throws(
    () => exportBundle(a.store, { from: "2027-01-01", to: "2027-12-31" }),
    /没有知识点/,
  );
  const { default: AdmZip } = await import("adm-zip");
  const zip = new AdmZip(
    exportBundle(a.store, { from: "2025-12-31", to: "2026-01-02" }),
  );
  zip.updateFile("notes/a.md", Buffer.from("tampered"));
  assert.throws(() => readBundle(zip.toBuffer()), /校验失败/);
  assert.throws(() => readBundle(Buffer.from("not a zip")));
});

test("editor form separates body and preserves untouched metadata when saving", async () => {
  const { newDocument, splitDocument, joinDocument } =
    await import("../src/editorDocument.ts");
  const original = note("form", {
    knowledge_keywords: ["concept"],
    dependency_keywords: ["基础概念"],
    knowledge_keywords: ["进阶概念"],
    aliases: ["旧标题"],
    merged_from: ["previous"],
    extra_field: { source: "original" },
    learning_events: [
      { date: "2026-01-01", summary: "初次学习" },
      { date: null, summary: "复习" },
    ],
    body: "## 正文\n\n完整说明\n\n---\n\n正文分隔线",
  });
  const draft = splitDocument(serializeNote(original));
  assert.equal(draft.body.trim(), original.body);
  draft.meta.title = "表单中的新标题";
  draft.body += "\n\n新增例子";
  const saved = parseNote(joinDocument(draft.meta, draft.body));
  assert.equal(saved.title, "表单中的新标题");
  for (const key of [
    "id",
    "created_at",
    "knowledge_keywords",
    "dependency_keywords",
    "aliases",
    "merged_from",
    "learning_events",
    "extra_field",
  ])
    assert.deepEqual(saved[key], original[key]);
  const fresh = newDocument(["计算机", "工具"]);
  assert.equal(fresh.body, "");
  assert.deepEqual(fresh.meta.category, ["计算机", "工具"]);
  assert.notEqual(fresh.meta.id, newDocument([]).meta.id);
});

test("AI text import supports multiple notes, references, fences and repeat paste", async (t) => {
  const { parseKnowledgeText, importKnowledgeText } =
    await import("../shared/text-import.mjs");
  const { knowledgePrompt } = await import("../src/knowledgePrompt.ts");
  const example = knowledgePrompt.slice(
    knowledgePrompt.indexOf("{\n"),
    knowledgePrompt.indexOf("\n\n字段规则"),
  );
  assert.equal(parseKnowledgeText(example).length, 1);
  const payload = {
    format: "zhixu-knowledge-v1",
    notes: [
      {
        key: "base",
        knowledge_keywords: ["基础概念"],
        dependency_keywords: [],
        title: "基础概念",
        summary: "理解基础",
        category: ["测试", "基础"],
        tags: ["示例"],
        learning_events: [{ date: null, summary: "学习基础" }],
        body: '## 解释\n\n完整正文\n\n```js\nconst a = "示例";\n```\n\n---\n\n边界条件',
      },
      {
        key: "advanced",
        title: "进阶概念",
        summary: "如何应用",
        category: ["测试", "应用"],
        learning_events: [{ date: "2025-01-02", summary: "实践" }],
        dependency_keywords: ["基础概念"],
        knowledge_keywords: ["进阶概念"],
        body: "具体方法与推导",
      },
    ],
  };
  const text = "```json\n" + JSON.stringify(payload, null, 2) + "\n```";
  const { store, setTime } = fixture(t);
  assert.equal(parseKnowledgeText(text).length, 2);
  const results = importKnowledgeText(store, text);
  assert.deepEqual(
    results.map((x) => x.status),
    ["created", "created"],
  );
  const target = store.detail(results[1].id);
  assert.equal(target.relations.prerequisites[0].id, results[0].id);
  assert.equal(store.detail(results[0].id).learning_events[0].date, null);
  setTime("2026-09-25T12:00:00");
  assert.deepEqual(
    importKnowledgeText(store, text).map((x) => x.status),
    ["skipped", "skipped"],
  );
  assert.equal(store.active().length, 2);
  const source = store.source(results[0].id);
  store.saveNote(
    serializeNote({ ...parseNote(source.text), body: "本地修订" }),
    results[0].id,
    source.hash,
  );
  assert.equal(importKnowledgeText(store, text)[0].status, "error");
  assert.equal(store.detail(results[0].id).body, "本地修订");
  const invalid = structuredClone(payload);
  invalid.notes[1].prerequisites = ["missing"];
  assert.throws(() => parseKnowledgeText(JSON.stringify(invalid)), /已移除/);
  invalid.notes[1].prerequisites = ["advanced"];
  assert.throws(() => parseKnowledgeText(JSON.stringify(invalid)), /已移除/);
  assert.throws(() => parseKnowledgeText("{broken"), /无法识别/);
  assert.equal(
    parseKnowledgeText(
      "```markdown\n" + serializeNote(note("legacy")) + "```",
    )[0].note.id,
    "legacy",
  );
});

test("markdown actions apply to selected lines and retain surrounding text", async () => {
  const { formatMarkdown: f } = await import("../src/markdownActions.ts");
  assert.equal(
    f("before\nhello\nworld\nafter", 8, 18, "h2").text,
    "before\n## hello\n## world\nafter",
  );
  assert.equal(f("## hello", 3, 8, "h1").text, "# hello");
  assert.equal(f("hello", 1, 4, "strike").text, "h~~ell~~o");
  assert.equal(f("a\nb", 0, 3, "todo").text, "- [ ] a\n- [ ] b");
  assert.equal(f("**word**", 0, 8, "bold").text, "word");
  assert.match(f("", 0, 0, "table").text, /\| --- \| --- \|/);
});
test("images deduplicate in SQLite and round-trip with partial exports", async (t) => {
  const { putImage, referencedImages } = await import("../server/assets.mjs");
  const { exportBundle, readBundle } = await import("../server/transfer.mjs");
  const a = fixture(t),
    b = fixture(t);
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=",
    "base64",
  );
  const image = putImage(a.store, png);
  putImage(a.store, png);
  assert.equal(
    a.store.assetsDb.prepare("SELECT count(*) AS n FROM assets").get().n,
    1,
  );
  assert.throws(() => putImage(a.store, Buffer.from("<svg></svg>")), /仅支持/);
  a.write("image-note", { body: `![test](${image.url})` });
  a.store.sync();
  const bundle = readBundle(
    exportBundle(a.store, { from: "2026-01-01", to: "2026-01-01" }),
  );
  assert.equal(bundle.assets.length, 1);
  for (const asset of bundle.assets) putImage(b.store, asset.data);
  for (const file of bundle) b.store.import(file.text, file.name);
  assert.deepEqual(
    Buffer.from(
      b.store.assetsDb
        .prepare("SELECT data FROM assets WHERE id=?")
        .get(image.id).data,
    ),
    png,
  );
  assert.deepEqual(referencedImages(b.store.detail("image-note").body), [
    image.id,
  ]);
  const { default: Zip } = await import("adm-zip");
  const zip = new Zip(
    exportBundle(a.store, { from: "2026-01-01", to: "2026-01-01" }),
  );
  zip.deleteFile(`assets/${image.id}`);
  assert.throws(() => readBundle(zip.toBuffer()), /图片缺失/);
});

test("separate image database migrates legacy assets and backup restores both stores", async (t) => {
  const { DatabaseSync } = await import("node:sqlite");
  const { execFileSync } = await import("node:child_process");
  const { putImage } = await import("../server/assets.mjs");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "knowledge-migrate-"));
  const state = path.join(root, ".knowledge");
  fs.mkdirSync(state);
  const backupRoot = root + "-backup";
  t.after(() => {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(backupRoot, { recursive: true, force: true });
  });
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aXioAAAAASUVORK5CYII=",
    "base64",
  );
  const legacy = new DatabaseSync(path.join(state, "knowledge.sqlite"));
  legacy.exec("CREATE TABLE assets(id TEXT PRIMARY KEY,mime TEXT,data BLOB)");
  legacy
    .prepare("INSERT INTO assets VALUES(?,?,?)")
    .run(hash(png), "image/png", png);
  legacy.close();
  let store = new Store(root, state);
  try {
    assert.equal(
      store.db
        .prepare("SELECT name FROM sqlite_master WHERE name='assets'")
        .get(),
      undefined,
    );
    assert.deepEqual(
      Buffer.from(store.assetsDb.prepare("SELECT data FROM assets").get().data),
      png,
    );
    putImage(store, png);
    store.import(serializeNote(note("backup")), "backup.md");
    execFileSync(process.execPath, ["scripts/backup.mjs", backupRoot], {
      env: { ...process.env, KNOWLEDGE_DIR: root },
    });
  } finally {
    store.close();
  }
  store = new Store(root, state);
  assert.equal(
    store.assetsDb.prepare("SELECT count(*) AS n FROM assets").get().n,
    1,
  );
  store.close();
  const restored = new Store(backupRoot, path.join(backupRoot, ".knowledge"));
  try {
    assert.equal(restored.active().length, 1);
    assert.deepEqual(
      Buffer.from(
        restored.assetsDb.prepare("SELECT data FROM assets").get().data,
      ),
      png,
    );
  } finally {
    restored.close();
  }
});

test("shared editor history undoes toolbar insertion, groups typing, branches and resets", async () => {
  const { EditorHistory } = await import("../src/editorHistory.ts");
  const h = new EditorHistory("original");
  h.record({ text: "original table" });
  assert.equal(h.undo().text, "original");
  assert.equal(h.redo().text, "original table");
  h.record({ text: "a" }, "rich", 1000);
  h.record({ text: "ab" }, "rich", 1100);
  assert.equal(h.undo().text, "original table");
  h.record({ text: "other" }, "source", 1200);
  assert.equal(h.redo(), null);
  h.reset("loaded");
  assert.equal(h.undo(), null);
  assert.equal(h.current.text, "loaded");
});

test("visual Markdown preserves tables, tasks, code, links and image references on round-trip", async () => {
  const { MarkdownManager } = await import("@tiptap/markdown");
  const { visualExtensions } = await import("../src/visualExtensions.ts");
  const manager = new MarkdownManager({ extensions: visualExtensions });
  const text =
    "# 标题\n\n**加粗**与~~删除线~~ [链接](https://example.com)\n\n- [x] 完成\n- [ ] 待办\n\n| 名称 | 说明 |\n| --- | --- |\n| A | B |\n\n```js\nconst x = 1;\n```\n\n![图片](/api/assets/" +
    "a".repeat(64) +
    ")";
  const parsed = manager.parse(text);
  const result = manager.serialize(parsed);
  const again = manager.parse(result);
  assert.deepEqual(again, parsed);
  assert.match(result, /\[x\]/);
  assert.match(result, /const x = 1/);
  assert.match(result, /\/api\/assets\/a{64}/);
  assert.match(result, /\| A\s*\| B/);
});

test("deployment access keeps loopback defaults and allows only configured LAN hosts and origins", async () => {
  const { accessConfig } = await import("../server/access.mjs");
  const local = accessConfig({});
  assert.equal(local.host, "127.0.0.1");
  assert.equal(local.allows("192.0.2.10", undefined), false);
  assert.equal(local.allows("localhost", "http://localhost:5173"), true);
  const lan = accessConfig({ HOST: "192.0.2.10", PORT: "3210" });
  assert.equal(lan.allows("192.0.2.10", "http://192.0.2.10:3210"), true);
  assert.equal(lan.allows("192.0.2.10", "http://192.0.2.10:9999"), false);
  assert.equal(lan.allows("evil.example", undefined), false);
  assert.equal(lan.allows("192.0.2.10", "null"), false);
  assert.equal(lan.allows("192.0.2.10", "https://evil.example"), false);
  assert.throws(() => accessConfig({ PORT: "wrong" }));
});

test("startup modes explicitly override exposure settings while preserving the configured port", async () => {
  const { startupConfig } = await import("../server/access.mjs");
  assert.equal(startupConfig({}).host, "127.0.0.1");
  const local = startupConfig(
    {
      HOST: "0.0.0.0",
      ALLOWED_HOSTS: "*",
      PUBLIC_ORIGIN: "https://other.example",
      PORT: "4321",
    },
    ["--local"],
  );
  assert.equal(local.host, "127.0.0.1");
  assert.equal(local.port, 4321);
  assert.equal(local.allows("192.0.2.10", undefined), false);
  assert.equal(local.allows("localhost", "https://other.example"), false);
  assert.equal(local.allows("localhost", "http://localhost:4321"), true);
  const lan = startupConfig({ HOST: "127.0.0.1", PORT: "4321" }, ["--lan"]);
  assert.equal(lan.host, "0.0.0.0");
  assert.equal(lan.port, 4321);
  assert.equal(lan.allows("192.0.2.10", "http://192.0.2.10:4321"), true);
  assert.equal(lan.allows("192.0.2.10", "http://192.0.2.10:9999"), false);
  assert.equal(lan.allows("192.0.2.10", "https://other.example"), false);
  assert.equal(startupConfig({ HOST: "192.0.2.10" }).host, "192.0.2.10");
  assert.throws(() => startupConfig({}, ["--lan", "--local"]));
  assert.throws(() => startupConfig({}, ["--unknown"]));
});

test("document IDs work without secure-context randomUUID", async () => {
  const { documentId } = await import("../src/editorDocument.ts");
  const ids = Array.from({ length: 100 }, () => documentId());
  assert.equal(new Set(ids).size, 100);
  for (const id of ids)
    assert.match(
      id,
      /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/,
    );
});

test("unrestricted deployment accepts any address while browser requests remain same-origin", async () => {
  const { accessConfig } = await import("../server/access.mjs");
  const config = accessConfig({ HOST: "0.0.0.0", ALLOWED_HOSTS: "*" });
  assert.equal(config.host, "0.0.0.0");
  for (const address of [
    "192.0.2.10:3210",
    "100.101.248.69:3210",
    "knowledge.example.com",
  ]) {
    assert.equal(
      config.allows(address.split(":")[0], undefined, address),
      true,
    );
    assert.equal(
      config.allows(address.split(":")[0], "https://" + address, address),
      true,
    );
    assert.equal(
      config.allows(address.split(":")[0], "https://other.example", address),
      false,
    );
  }
  assert.equal(
    config.allows("example.com", "http://example.com:9000", "example.com:3210"),
    false,
  );
  assert.equal(config.allows("example.com", "null", "example.com"), false);
});

test("organize updates descendants, category search and relations while preserving learning", (t) => {
  const { store, write } = fixture(t);
  write("a", { category: ["旧分类", "子目录"], knowledge_keywords: ["ab"] });
  write("b", { category: ["旧分类"], knowledge_keywords: ["ab"] });
  write("c", { category: ["目标"] });
  store.sync();
  store.review("a", "good");
  const expected = (prefix) =>
    store
      .active()
      .filter((n) => prefix.every((x, i) => n.category[i] === x))
      .map(({ id, hash }) => ({ id, hash }));
  const before = store.detail("a");
  store.organize({
    source: { category: ["旧分类"] },
    action: "rename",
    title: "新分类",
    expected: expected(["旧分类"]),
  });
  assert.deepEqual(store.detail("a").category, ["新分类", "子目录"]);
  assert.equal(store.list({ q: "旧分类" }).length, 0);
  assert.equal(store.list({ q: "新分类" }).length, 2);
  assert.deepEqual(store.detail("a").review, before.review);
  assert.deepEqual(store.detail("a").history, before.history);
  assert.deepEqual(store.detail("a").tags, before.tags);
  store.organize({
    source: { category: ["新分类"] },
    action: "move",
    destination: ["目标"],
    expected: expected(["新分类"]),
  });
  assert.deepEqual(store.detail("b").relations.related[0].category, [
    "目标",
    "新分类",
    "子目录",
  ]);
  store.organize({
    source: { id: "a" },
    action: "move",
    destination: ["目标"],
    expected: [{ id: "a", hash: store.detail("a").hash }],
  });
  assert.deepEqual(store.detail("a").category, ["目标"]);
  store.organize({
    source: { id: "a" },
    action: "rename",
    title: "新标题",
    expected: [{ id: "a", hash: store.detail("a").hash }],
  });
  assert.equal(store.detail("b").relations.related[0].title, "新标题");
});

test("organize refuses stale batches, collisions and descendant moves without partial writes", (t) => {
  const { store, write, root } = fixture(t);
  write("a", { category: ["目录", "子目录"] });
  write("b", { category: ["其他"] });
  store.sync();
  const request = {
    source: { category: ["目录"] },
    expected: [{ id: "a", hash: store.detail("a").hash }],
  };
  assert.throws(
    () =>
      store.organize({
        ...request,
        action: "move",
        destination: ["目录", "子目录"],
      }),
    /自身或子目录/,
  );
  assert.throws(
    () => store.organize({ ...request, action: "rename", title: "其他" }),
    /同名目录/,
  );
  assert.throws(
    () => store.organize({ ...request, action: "rename", title: "错误/路径" }),
    /斜杠/,
  );
  const old = fs.readFileSync(path.join(root, "a.md"), "utf8");
  write("new", { category: ["目录"] });
  assert.throws(
    () => store.organize({ ...request, action: "delete" }),
    /已被修改/,
  );
  assert.equal(fs.readFileSync(path.join(root, "a.md"), "utf8"), old);
  assert.equal(store.trash().length, 0);
});

test("directory deletion archives all descendants and restores original categories and history", (t) => {
  const { store, write } = fixture(t);
  write("a", { category: ["目录", "子目录"] });
  write("b", { category: ["目录"] });
  store.sync();
  store.review("a", "good");
  const before = store.detail("a");
  store.organize({
    source: { category: ["目录"] },
    action: "delete",
    expected: store.active().map(({ id, hash }) => ({ id, hash })),
  });
  assert.equal(store.active().length, 0);
  assert.equal(store.trash().length, 2);
  for (const item of store.trash()) store.restoreNote(item.token);
  assert.deepEqual(store.detail("a").category, before.category);
  assert.deepEqual(store.detail("a").history, before.history);
});

test("keyword relationships update across imports, edits, trash and restore without changing explicit metadata", (t) => {
  const { store, write, root } = fixture(t);
  write("consumer", { dependency_keywords: ["ＳＱＬ", "数据库事务"] });
  write("legacy", { tags: ["SQL"] });
  store.sync();
  assert.equal(store.detail("consumer").relations.prerequisites.length, 0);
  write("provider", { knowledge_keywords: ["sql", "数据库事务"] });
  write("peer", { knowledge_keywords: ["SQL"] });
  store.sync();
  const rel = store.detail("consumer").relations.prerequisites;
  assert.equal(rel.length, 2);
  assert.equal(rel.find((r) => r.id === "provider").origin, "keyword");
  assert.deepEqual(rel.find((r) => r.id === "provider").matched_keywords, [
    "ＳＱＬ",
    "数据库事务",
  ]);
  assert.equal(store.detail("provider").relations.dependents[0].id, "consumer");
  assert.equal(store.detail("provider").relations.related[0].id, "peer");
  assert.equal(store.detail("consumer").relations.related.length, 0);
  assert.equal(
    store.graph("consumer").edges.filter((e) => e.type === "prerequisite")
      .length,
    2,
  );
  assert.equal(store.list({ q: "数据库事务" }).length, 2);
  assert.deepEqual(
    parseNote(fs.readFileSync(path.join(root, "consumer.md"), "utf8"))
      .dependency_keywords,
    ["ＳＱＬ", "数据库事务"],
  );
  const snapshot = store.detail("provider");
  const deleted = store.deleteNote("provider", snapshot.hash);
  assert.equal(store.detail("consumer").relations.prerequisites.length, 1);
  store.restoreNote(deleted.token);
  assert.equal(store.detail("consumer").relations.prerequisites.length, 2);
  write("provider", { knowledge_keywords: ["不同概念"] });
  store.sync();
  assert.equal(store.detail("consumer").relations.prerequisites.length, 1);
  write("consumer", { dependency_keywords: [] });
  store.sync();
  assert.equal(store.detail("consumer").relations.prerequisites.length, 0);
  assert.equal(store.detail("consumer").relations.related.length, 0);
});

test("keyword matching rejects substring guesses, self links and cycles", async () => {
  const { deriveRelations } = await import("../shared/relations.mjs");
  const rows = [
    note("a", { knowledge_keywords: ["A"], dependency_keywords: ["B"] }),
    note("b", { knowledge_keywords: ["B"], dependency_keywords: ["A"] }),
    note("c", { knowledge_keywords: ["C"], dependency_keywords: ["C", "AA"] }),
  ];
  for (const r of deriveRelations(rows).values())
    assert.equal(r.prerequisites.size, 0);
  assert.throws(
    () => parseNote(serializeNote({ ...rows[0], prerequisites: ["b"] })),
    /已移除/,
  );
  const missing = note("missing");
  delete missing.knowledge_keywords;
  assert.throws(() => parseNote(serializeNote(missing)), /knowledge_keywords/);
});

test("keyword schema requires arrays and preserves identity on keyword edits", async (t) => {
  const { parseKnowledgeText, importKnowledgeText } =
    await import("../shared/text-import.mjs");
  const { store } = fixture(t);
  const data = {
    format: "zhixu-knowledge-v1",
    notes: [
      {
        key: "x",
        knowledge_keywords: [],
        dependency_keywords: [],
        title: "旧知识",
        summary: "旧简介",
        category: ["旧目录"],
        tags: ["SQL"],
        learning_events: [],
        body: "原有正文",
      },
    ],
  };
  const legacy = parseKnowledgeText(JSON.stringify(data))[0].note;
  assert.deepEqual(legacy.knowledge_keywords, []);
  assert.equal(
    importKnowledgeText(store, JSON.stringify(data))[0].status,
    "created",
  );
  assert.equal(
    importKnowledgeText(store, JSON.stringify(data))[0].status,
    "skipped",
  );
  data.notes[0].knowledge_keywords = ["SQL"];
  data.notes[0].dependency_keywords = ["关系代数"];
  const updated = parseKnowledgeText(JSON.stringify(data))[0].note;
  assert.deepEqual(updated.knowledge_keywords, ["SQL"]);
  assert.deepEqual(updated.dependency_keywords, ["关系代数"]);
  assert.equal(updated.id, legacy.id);
  assert.deepEqual(parseNote(serializeNote(updated)), updated);
  // Adding keywords to re-imported legacy content must not create a duplicate.
  assert.equal(
    importKnowledgeText(store, JSON.stringify(data))[0].status,
    "error",
  );
  assert.equal(store.active().length, 1);
  const second = fixture(t).store;
  assert.equal(
    importKnowledgeText(second, JSON.stringify(data))[0].status,
    "created",
  );
  assert.equal(
    importKnowledgeText(second, JSON.stringify(data))[0].status,
    "skipped",
  );
  data.notes[0].dependency_keywords = "bad";
  assert.throws(
    () => parseKnowledgeText(JSON.stringify(data)),
    /dependency_keywords/,
  );
  assert.throws(
    () => parseNote(serializeNote(note("bad", { knowledge_keywords: [""] }))),
    /knowledge_keywords/,
  );
});
