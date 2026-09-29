import fs from "node:fs";
import path from "node:path";
import { DatabaseSync, backup } from "node:sqlite";
import { acquireLock } from "../shared/protocol.mjs";
const root = path.resolve(process.env.KNOWLEDGE_DIR || "content"),
  state = path.join(root, ".knowledge");
const args = process.argv.slice(2);
if (args[0] === "--") args.shift();
const dest = path.resolve(
  args[0] || `backups/${new Date().toISOString().replaceAll(":", "-")}`,
);
if (dest === root || dest.startsWith(root + path.sep))
  throw Error("备份目录不能放在知识目录中");
if (fs.existsSync(dest)) throw Error("备份目标已存在，请选择新目录");
const release = acquireLock(state);
try {
  fs.cpSync(root, dest, {
    recursive: true,
    filter: (p) =>
      !p.endsWith("write.lock") &&
      !/(?:knowledge|assets)\.sqlite(?:-wal|-shm)?$/.test(p),
  });
  for (const name of ["knowledge.sqlite", "assets.sqlite"]) {
    const dbPath = path.join(state, name);
    if (fs.existsSync(dbPath)) {
      const db = new DatabaseSync(dbPath);
      try {
        await backup(db, path.join(dest, ".knowledge", name));
      } finally {
        db.close();
      }
    }
  }
  console.log(`已备份到 ${dest}`);
} finally {
  release();
}
