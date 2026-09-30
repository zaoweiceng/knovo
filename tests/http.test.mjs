import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import net from "node:net";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { serializeNote, acquireLock } from "../shared/protocol.mjs";
test("HTTP SQLite import, private paths, malformed input and restart persistence", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "knowledge-http-"));
  const portServer = net.createServer();
  portServer.listen(0, "127.0.0.1");
  await once(portServer, "listening");
  const port = portServer.address().port;
  await new Promise((r) => portServer.close(r));
  let child;
  const stop = async () => {
    if (child && child.exitCode === null) {
      child.kill("SIGTERM");
      await once(child, "exit");
    }
  };
  t.after(async () => {
    await stop();
    fs.rmSync(root, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${port}`;
  const wait = async (check) => {
    const end = Date.now() + 6000;
    while (Date.now() < end) {
      try {
        const result = await check();
        if (result) return result;
      } catch {}
      await new Promise((r) => setTimeout(r, 100));
    }
    throw Error("等待服务器状态超时");
  };
  const start = async () => {
    child = spawn(process.execPath, ["server/index.mjs"], {
      env: { ...process.env, PORT: String(port), KNOWLEDGE_DIR: root },
      stdio: "pipe",
    });
    await wait(async () => {
      const r = await fetch(base + "/api/stats");
      return r.ok;
    });
  };
  await start();
  for (const method of ["GET", "POST", "PUT", "DELETE"]) {
    const missing = await fetch(base + "/api/nonexistent", { method });
    assert.equal(missing.status, 404);
    assert.match((await missing.json()).error, /接口不存在/);
  }
  const invalidOperation = await fetch(base + "/api/organize", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  assert.equal(invalidOperation.status, 400);
  assert.match((await invalidOperation.json()).error, /无效/);
  const n = {
    schema_version: 1,
    id: "http-note",
    title: "测试知识",
    summary: "一个测试概念",
    category: ["测试", "子目录"],
    tags: [],
    status: "ready",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    learning_events: [],
    body: "正文",
    knowledge_keywords: ["HTTP 测试"],
    dependency_keywords: [],
    aliases: [],
    merged_from: [],
  };
  const response = await fetch(base + "/api/import", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      files: [
        { name: "one.md", text: serializeNote(n) },
        { name: "broken.md", text: "broken" },
      ],
    }),
  });
  const results = await response.json();
  assert.equal(results[0].status, "created");
  assert.equal(results[1].status, "error");
  const organizedNote = await fetch(base + "/api/notes/http-note").then((r) =>
    r.json(),
  );
  const deletion = await fetch(base + "/api/organize", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      source: { category: ["测试"] },
      action: "delete",
      expected: [{ id: n.id, hash: organizedNote.hash }],
    }),
  });
  assert.equal(deletion.status, 200);
  assert.equal((await deletion.json()).count, 1);
  const archived = await fetch(base + "/api/trash").then((r) => r.json());
  assert.equal(archived.length, 1);
  const restoredDirectory = await fetch(
    base + "/api/trash/" + archived[0].token + "/restore",
    { method: "POST" },
  );
  assert.equal(restoredDirectory.status, 200);
  n.summary = "修改后简介";
  assert.equal(fs.existsSync(path.join(root, "http-note.md")), false);
  const summarySource = await fetch(base + "/api/notes/http-note/source").then(
    (r) => r.json(),
  );
  const summarySave = await fetch(base + "/api/notes/http-note", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      text: serializeNote(n),
      expected_hash: summarySource.hash,
    }),
  });
  assert.equal(summarySave.status, 200);
  await fetch(base + "/api/reviews/http-note", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ rating: "good" }),
  });
  assert.equal(
    (await fetch(base + "/api/notes/http-note").then((r) => r.json())).review
      .stage,
    1,
  );
  assert.equal(
    (
      await fetch(base + "/api/import", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: "https://evil.example",
        },
        body: "{}",
      })
    ).status,
    403,
  );
  assert.ok(
    !(
      await fetch(base + "/.knowledge/knowledge.sqlite").then((r) =>
        r.headers.get("content-type"),
      )
    )?.includes("sqlite"),
  );
  const source = await fetch(base + "/api/notes/http-note/source").then((r) =>
    r.json(),
  );
  n.body = "网页编辑后的正文";
  const editResponse = await fetch(base + "/api/notes/http-note", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      text: serializeNote(n),
      expected_hash: source.hash,
    }),
  });
  assert.equal(editResponse.status, 200);
  const stale = await fetch(base + "/api/notes/http-note", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: source.text, expected_hash: source.hash }),
  });
  assert.equal(stale.status, 400);
  const bundle = await fetch(
    base + "/api/export?from=2000-01-01&to=2099-12-31&basis=created",
  );
  assert.equal(bundle.headers.get("content-type"), "application/zip");
  const importedBundle = await fetch(base + "/api/import-bundle", {
    method: "POST",
    headers: { "Content-Type": "application/zip" },
    body: await bundle.arrayBuffer(),
  });
  assert.equal((await importedBundle.json())[0].status, "skipped");
  const created = await fetch(base + "/api/notes", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: serializeNote({ ...n, id: "manual" }) }),
  });
  assert.equal(created.status, 200);
  const manual = await fetch(base + "/api/notes/manual").then((r) => r.json());
  await fetch(base + "/api/notes/manual", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ expected_hash: manual.hash }),
  });
  const beforeDelete = await fetch(base + "/api/notes/http-note").then((r) =>
    r.json(),
  );
  const removed = await fetch(base + "/api/notes/http-note", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ expected_hash: beforeDelete.hash }),
  });
  assert.equal(removed.status, 200);
  const { token } = await removed.json();
  assert.equal((await fetch(base + "/api/notes/http-note")).status, 404);
  assert.equal(
    (await fetch(base + "/api/trash").then((r) => r.json())).length,
    2,
  );
  assert.equal(
    (await fetch(base + "/api/trash/" + token + "/restore", { method: "POST" }))
      .status,
    200,
  );
  assert.equal(
    (await fetch(base + "/api/trash").then((r) => r.json())).length,
    1,
  );
  await stop();
  await start();
  const restored = await fetch(base + "/api/notes/http-note").then((r) =>
    r.json(),
  );
  assert.equal(restored.review.stage, 1);
  assert.equal(restored.history.length, 1);
  const finalDelete = await fetch(base + "/api/notes/http-note", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ expected_hash: restored.hash }),
  });
  assert.equal(finalDelete.status, 200);
  assert.equal(fs.existsSync(path.join(root, "http-note.md")), false);
  assert.equal(
    (await fetch(base + "/api/stats").then((r) => r.json())).days[0].count,
    2,
  );
});
