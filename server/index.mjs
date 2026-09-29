import { accessConfig } from "./access.mjs";
import { putImage } from "./assets.mjs";
import {
  parseKnowledgeText,
  importKnowledgeText,
} from "../shared/text-import.mjs";
import express from "express";
import { exportBundle, readBundle } from "./transfer.mjs";
import chokidar from "chokidar";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Store } from "./store.mjs";
import { acquireLock } from "../shared/protocol.mjs";
const base = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const root = path.resolve(
  process.env.KNOWLEDGE_DIR || path.join(base, "content"),
);
const stateDir = path.join(root, ".knowledge");
const access = accessConfig();
const store = new Store(root, stateDir);
store.sync();
const app = express();
app.disable("x-powered-by");
app.use("/api", (req, res, next) => {
  if (!access.allows(req.hostname, req.headers.origin, req.get("host")))
    return res.status(403).json({ error: "不允许此主机或来源" });
  next();
});
app.use(express.json({ limit: "24mb" }));
app.post(
  "/api/assets",
  express.raw({ type: "application/octet-stream", limit: "10mb" }),
  (req, res) => res.json(putImage(store, req.body)),
);
app.get("/api/assets/:id", (req, res) => {
  const item =
    /^[a-f0-9]{64}$/.test(req.params.id) &&
    store.assetsDb
      .prepare("SELECT mime,data FROM assets WHERE id=?")
      .get(req.params.id);
  if (!item) return res.status(404).json({ error: "图片不存在" });
  res
    .set("Content-Type", item.mime)
    .set("X-Content-Type-Options", "nosniff")
    .set("Cache-Control", "private, max-age=31536000, immutable")
    .send(Buffer.from(item.data));
});
app.get("/api/stats", (_req, res) => res.json(store.stats()));
app.get("/api/notes", (req, res) => res.json(store.list(req.query)));
app.post("/api/organize", (req, res) => res.json(store.organize(req.body)));
app.get("/api/categories", (_req, res) =>
  res.json(
    [
      ...new Set(
        store
          .active()
          .flatMap((n) =>
            n.category.map((_, i) =>
              JSON.stringify(n.category.slice(0, i + 1)),
            ),
          ),
      ),
    ].map((c) => JSON.parse(c)),
  ),
);
app.get("/api/learning-activity", (req, res) =>
  res.json(store.learningActivity(req.query.date || undefined)),
);
app.get("/api/timeline", (_req, res) => res.json(store.timeline()));
app.get("/api/additions", (req, res) =>
  res.json(store.additions(req.query.date || "")),
);
app.get("/api/reviews", (_req, res) =>
  res.json(
    store
      .active()
      .filter((n) => !n.review.paused && n.review.due <= store.stats().today)
      .sort((a, b) => a.review.due.localeCompare(b.review.due)),
  ),
);
app.get("/api/notes/:id/source", (req, res) =>
  res.json(store.source(req.params.id)),
);
app.post("/api/notes", (req, res) => res.json(store.saveNote(req.body.text)));
app.put("/api/notes/:id", (req, res) =>
  res.json(
    store.saveNote(req.body.text, req.params.id, req.body.expected_hash),
  ),
);
app.get("/api/export", (req, res) => {
  const buffer = exportBundle(store, req.query);
  res.set("Content-Type", "application/zip");
  res.set(
    "Content-Disposition",
    `attachment; filename="knowledge-${req.query.from}-${req.query.to}.zip"`,
  );
  res.send(buffer);
});
app.post(
  "/api/import-bundle",
  express.raw({ type: "application/zip", limit: "100mb" }),
  (req, res) => {
    const files = readBundle(req.body);
    for (const asset of files.assets || []) putImage(store, asset.data);
    res.json(
      files.map((f) => {
        try {
          return store.import(f.text, f.name, { rejectConflict: true });
        } catch (e) {
          return { filename: f.name, status: "error", message: e.message };
        }
      }),
    );
  },
);
app.get("/api/notes/:id", (req, res) => {
  const n = store.detail(req.params.id);
  res.status(n ? 200 : 404).json(n || { error: "知识点不存在" });
});
app.delete("/api/notes/:id", (req, res) =>
  res.json(store.deleteNote(req.params.id, req.body?.expected_hash)),
);
app.get("/api/trash", (_req, res) => res.json(store.trash()));
app.post("/api/trash/:token/restore", (req, res) =>
  res.json(store.restoreNote(req.params.token)),
);
app.get("/api/graph/:id", (req, res) => {
  const n = store.graph(req.params.id, {
    ...req.query,
    depth: Math.min(8, Math.max(1, Number(req.query.depth) || 2)),
    limit: Math.min(1000, Math.max(1, Number(req.query.limit) || 100)),
  });
  res.status(n ? 200 : 404).json(n || { error: "知识点不存在" });
});
app.post("/api/import-text/preview", (req, res) =>
  res.json(parseKnowledgeText(req.body.text).map((x) => x.note)),
);
app.post("/api/import-text", (req, res) =>
  res.json(importKnowledgeText(store, req.body.text)),
);
app.post("/api/import", (req, res) => {
  if (!Array.isArray(req.body.files) || req.body.files.length > 100)
    throw Error("一次最多导入 100 个文件");
  res.json(
    req.body.files.map((f) => {
      try {
        if (typeof f.name !== "string" || !f.name.toLowerCase().endsWith(".md"))
          throw Error("请选择 Markdown 文件");
        return store.import(f.text, f.name);
      } catch (e) {
        return { filename: f.name, status: "error", message: e.message };
      }
    }),
  );
});
app.post("/api/rescan", (_req, res) => res.json(store.sync()));
app.post("/api/reviews/:id", (req, res) => {
  const release = acquireLock(stateDir);
  try {
    res.json(store.review(req.params.id, req.body.rating));
  } finally {
    release();
  }
});
app.patch("/api/reviews/:id", (req, res) => {
  const release = acquireLock(stateDir);
  try {
    res.json(store.setReview(req.params.id, req.body));
  } finally {
    release();
  }
});
app.use("/api", (_req, res) =>
  res.status(404).json({ error: "接口不存在，请确认后端已更新并重启" }),
);
app.use(express.static(path.join(base, "dist")));
app.get("/{*splat}", (req, res) => {
  if (req.path.startsWith("/api/"))
    return res.status(404).json({ error: "接口不存在" });
  if (fs.existsSync(path.join(base, "dist/index.html")))
    res.sendFile(path.join(base, "dist/index.html"));
  else res.status(503).send("请先运行 npm run build，或使用 npm run dev。");
});
app.use((err, req, res, next) =>
  res
    .status(err.code === "LOCKED" ? 409 : 400)
    .json({ error: err.message || "请求失败" }),
);
let timer;
const schedule = () => {
  clearTimeout(timer);
  timer = setTimeout(() => {
    try {
      if (store.sync().busy) schedule();
    } catch (e) {
      console.error("同步失败", e.message);
    }
  }, 350);
};
const watcher = chokidar
  .watch(root, {
    ignored: (p) =>
      path
        .relative(root, p)
        .split(path.sep)
        .some((s) => s.startsWith(".")),
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 400, pollInterval: 100 },
  })
  .on("all", schedule);
const server = app.listen(access.port, access.host, () =>
  console.log(
    `知序已启动：http://${access.host}:${access.port}\n知识目录：${root}`,
  ),
);
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => {
    clearTimeout(timer);
    watcher.close();
    server.close(() => {
      store.close();
      process.exit(0);
    });
  });
