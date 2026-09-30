import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import AdmZip from "adm-zip";
import { Store } from "../server/store.mjs";
import { Store as FileStore } from "../server/file-store.mjs";
import { serializeNote, parseNote, files } from "../shared/protocol.mjs";
import { exportBundle, readBundle } from "../server/transfer.mjs";
import { scan, apply, restore } from "../scripts/knowledge.mjs";
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "knowledge-sqlite-"));
  const state = path.join(root, ".knowledge");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return { root, state };
}
function note(id, extra = {}) {
  return {
    schema_version: 1,
    id,
    title: id,
    summary: "测试",
    category: ["目录"],
    tags: [],
    status: "ready",
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    learning_events: [{ date: "2026-01-01", summary: "学习" }],
    knowledge_keywords: [id],
    dependency_keywords: [],
    aliases: [],
    merged_from: [],
    body: "正文",
    ...extra,
  };
}
test("SQLite migration preserves source, history, trash and maintenance then removes loose Markdown", (t) => {
  const { root, state } = fixture(t);
  fs.mkdirSync(path.join(root, "空目录", "子目录"), { recursive: true });
  fs.mkdirSync(path.join(root, "保留目录"));
  fs.writeFileSync(path.join(root, "保留目录", "readme.txt"), "保留");
  let store = new FileStore(root, state);
  store.import(serializeNote(note("a")), "a.md");
  store.import(serializeNote(note("a", { body: "编辑后" })), "a.md");
  store.import(serializeNote(note("b")), "b.md");
  store.review("a", "good");
  const source = store.source("a"),
    before = store.detail("a");
  const archived = store.deleteNote("b", store.source("b").hash);
  scan(root);
  store.close();
  store = new Store(root, state);
  assert.equal(store.source("a").text, source.text);
  assert.deepEqual(store.detail("a").history, before.history);
  assert.deepEqual(store.detail("a").review, before.review);
  assert.equal(store.trash()[0].token, archived.token);
  assert.equal(files(root).length, 0);
  assert.equal(fs.existsSync(path.join(root, "空目录")), false);
  assert.equal(fs.existsSync(path.join(root, "保留目录", "readme.txt")), true);
  assert.equal(fs.existsSync(path.join(state, "upload-backups")), false);
  assert.equal(
    store.db.prepare("SELECT count(*) AS n FROM document_history").get().n,
    1,
  );
  assert.equal(scan(root).baseline_created, false);
  const backup = store.db
    .prepare("SELECT value FROM meta WHERE key='markdown_migration_backup'")
    .get().value;
  assert.equal(new AdmZip(backup).readAsText("a.md"), source.text);
  store.restoreNote(archived.token);
  assert.equal(store.active().length, 2);
  store.close();
  store = new Store(root, state);
  assert.equal(store.active().length, 2);
  assert.equal(files(root).length, 0);
  store.close();
});
test("SQLite owns edits and atomically rolls back failed batch operations", (t) => {
  const { root, state } = fixture(t),
    store = new Store(root, state);
  t.after(() => store.close());
  for (const n of [
    note("a", { knowledge_keywords: ["概念"] }),
    note("b", { dependency_keywords: ["概念"] }),
    note("c", { category: ["目标"] }),
  ])
    store.import(serializeNote(n), `${n.id}.md`);
  store.review("a", "good");
  const before = store.source("a"),
    history = store.detail("a").history;
  store.saveNote(
    serializeNote(
      note("a", { body: "数据库中的新正文", knowledge_keywords: ["概念"] }),
    ),
    "a",
    before.hash,
  );
  assert.throws(
    () => store.saveNote(before.text, "a", before.hash),
    /已被修改/,
  );
  const expected = store
    .active()
    .filter((n) => n.category[0] === "目录")
    .map(({ id, hash }) => ({ id, hash }));
  const original = store.put.bind(store);
  store.put = (text) => {
    if (parseNote(text).id === "b") throw Error("模拟批量中途失败");
    return original(text);
  };
  assert.throws(
    () =>
      store.organize({
        source: { category: ["目录"] },
        action: "rename",
        title: "新目录",
        expected,
      }),
    /中途失败/,
  );
  assert.deepEqual(store.detail("a").category, ["目录"]);
  store.put = original;
  store.organize({
    source: { category: ["目录"] },
    action: "move",
    destination: ["目标"],
    expected,
  });
  assert.deepEqual(store.detail("b").category, ["目标", "目录"]);
  assert.equal(store.detail("b").relations.prerequisites[0].id, "a");
  assert.deepEqual(store.detail("a").history, history);
  const deleted = store.deleteNote("a", store.source("a").hash);
  assert.equal(store.detail("b").relations.prerequisites.length, 0);
  assert.throws(() => store.import(before.text, "a.md"), /回收站/);
  store.restoreNote(deleted.token);
  assert.equal(store.detail("b").relations.prerequisites[0].id, "a");
  fs.writeFileSync(
    path.join(root, "external.md"),
    serializeNote(note("external")),
  );
  store.sync();
  assert.equal(store.detail("external"), null); // Only explicit imports after migration.
  assert.deepEqual(
    files(root).map((x) => path.basename(x)),
    ["external.md"],
  );
  const bundle = readBundle(
    exportBundle(store, { from: "2026-01-01", to: "2026-01-01" }),
  );
  assert.equal(bundle.length, 3);
  assert.ok(bundle.some((x) => parseNote(x.text).body === "数据库中的新正文"));
});
test("SQLite migration refuses invalid or duplicate files without removing any originals", (t) => {
  const { root, state } = fixture(t);
  const text = serializeNote(note("same"));
  fs.writeFileSync(path.join(root, "a.md"), text);
  fs.writeFileSync(path.join(root, "b.md"), text);
  assert.throws(() => new Store(root, state), /重复/);
  assert.equal(files(root).length, 2);
  fs.writeFileSync(path.join(root, "b.md"), "invalid");
  assert.throws(() => new Store(root, state), /无效/);
  assert.equal(fs.readFileSync(path.join(root, "a.md"), "utf8"), text);
});
test("SQLite maintenance scan, merge and restore retain IDs and learning records", (t) => {
  const { root, state } = fixture(t),
    store = new Store(root, state);
  t.after(() => store.close());
  store.import(serializeNote(note("a")), "a.md");
  store.import(serializeNote(note("b")), "b.md");
  store.review("a", "good");
  const a = store.source("a"),
    b = store.source("b");
  assert.equal(scan(root).baseline_created, true);
  const batch = apply(root, {
    operations: [
      { path: "a.md", expected_hash: a.hash, content: null },
      {
        path: "b.md",
        expected_hash: b.hash,
        content: serializeNote(note("b", { merged_from: ["a"] })),
      },
    ],
    processed: [{ path: "a.md", expected_hash: a.hash }],
    report: {},
  });
  store.sync();
  assert.equal(store.active().length, 1);
  assert.equal(store.detail("b").history.length, 1);
  assert.equal(scan(root).changes.length, 0);
  restore(root, batch.batch);
  store.sync();
  assert.equal(store.active().length, 2);
  assert.equal(store.detail("a").history.length, 1);
  assert.equal(files(root).length, 0);
});
test("complete SQLite backup restores knowledge and deleted records without Markdown", (t) => {
  const { root, state } = fixture(t),
    store = new Store(root, state);
  t.after(() => store.close());
  store.import(serializeNote(note("a")), "a.md");
  store.import(serializeNote(note("b")), "b.md");
  store.review("a", "good");
  store.deleteNote("b", store.source("b").hash);
  const parent = fs.mkdtempSync(
    path.join(os.tmpdir(), "knowledge-sqlite-backup-"),
  );
  t.after(() => fs.rmSync(parent, { recursive: true, force: true }));
  const destination = path.join(parent, "backup");
  execFileSync(process.execPath, ["scripts/backup.mjs", destination], {
    env: { ...process.env, KNOWLEDGE_DIR: root },
  });
  const restored = new Store(destination, path.join(destination, ".knowledge"));
  assert.equal(restored.active().length, 1);
  assert.equal(restored.trash().length, 1);
  assert.equal(restored.detail("a").history.length, 1);
  assert.equal(files(destination).length, 0);
  restored.close();
});
