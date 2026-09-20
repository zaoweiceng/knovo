import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import net from "node:net";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { serializeNote, acquireLock } from "../shared/protocol.mjs";
test("HTTP import, watcher, private paths, malformed input and restart persistence", async (t) => {
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
    prerequisites: [],
    related: [],
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
  n.summary = "修改后简介";
  fs.writeFileSync(path.join(root, "http-note.md"), serializeNote(n));
  await wait(async () => {
    const data = await fetch(base + "/api/notes/http-note").then((r) =>
      r.json(),
    );
    return data.summary === "修改后简介";
  });
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
  await stop();
  await start();
  const restored = await fetch(base + "/api/notes/http-note").then((r) =>
    r.json(),
  );
  assert.equal(restored.review.stage, 1);
  assert.equal(restored.history.length, 1);
  fs.unlinkSync(path.join(root, "http-note.md"));
  await wait(async () => {
    const data = await fetch(base + "/api/stats").then((r) => r.json());
    return data.total === 0;
  });
  assert.equal(
    (await fetch(base + "/api/stats").then((r) => r.json())).days[0].count,
    1,
  );
});
