import express from "express";
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
const store = new Store(root, stateDir);
store.sync();
const app = express();
app.disable("x-powered-by");
app.use("/api", (req, res, next) => {
  const host = req.hostname;
  if (!["localhost", "127.0.0.1", "[::1]"].includes(host))
    return res.status(403).json({ error: "仅允许本机访问" });
  const origin = req.headers.origin;
  if (origin) {
    try {
      const o = new URL(origin);
      if (
        !["localhost", "127.0.0.1", "[::1]"].includes(o.hostname) ||
        ![String(process.env.PORT || 3210), "5173"].includes(o.port)
      )
        return res.status(403).json({ error: "不允许此来源" });
    } catch {
      return res.status(403).json({ error: "无效来源" });
    }
  }
  next();
});
app.use(express.json({ limit: "24mb" }));
app.get("/api/stats", (_req, res) => res.json(store.stats()));
app.get("/api/notes", (req, res) => res.json(store.list(req.query)));
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
app.get("/api/notes/:id", (req, res) => {
  const n = store.detail(req.params.id);
  res.status(n ? 200 : 404).json(n || { error: "知识点不存在" });
});
app.get("/api/graph/:id", (req, res) => {
  const n = store.graph(req.params.id, {
    ...req.query,
    depth: Math.min(8, Math.max(1, Number(req.query.depth) || 2)),
    limit: Math.min(1000, Math.max(1, Number(req.query.limit) || 100)),
  });
  res.status(n ? 200 : 404).json(n || { error: "知识点不存在" });
});
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
const server = app.listen(Number(process.env.PORT || 3210), "127.0.0.1", () =>
  console.log(
    `知序已启动：http://127.0.0.1:${process.env.PORT || 3210}\n知识目录：${root}`,
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
