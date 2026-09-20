#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import {
  files,
  hash,
  parseNote,
  safePath,
  acquireLock,
  atomicWrite,
  writeJSON,
} from "../shared/protocol.mjs";
export function indexLibrary(root) {
  const index = {},
    errors = [];
  for (const file of files(root)) {
    const relative = path.relative(root, file),
      text = fs.readFileSync(file, "utf8");
    try {
      const { body, ...meta } = parseNote(text);
      index[relative] = { hash: hash(text), ...meta };
    } catch (e) {
      errors.push({ file: relative, hash: hash(text), message: e.message });
    }
  }
  return { index, errors };
}
function readState(stateDir) {
  const p = path.join(stateDir, "maintenance.json");
  return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, "utf8")) : null;
}
export function scan(root, explicit = []) {
  const stateDir = path.join(root, ".knowledge"),
    release = acquireLock(stateDir);
  try {
    const { index, errors } = indexLibrary(root);
    let previous = readState(stateDir);
    const initial = !previous;
    if (!previous) {
      previous = { version: 1, files: index };
      writeJSON(path.join(stateDir, "maintenance.json"), previous);
    }
    const changed = explicit.length
      ? explicit.map((p) => path.relative(root, safePath(root, p)))
      : Object.keys(index).filter(
          (p) => previous.files[p]?.hash !== index[p].hash,
        );
    const deleted = Object.keys(previous.files).filter(
      (p) => !fs.existsSync(path.join(root, p)),
    );
    const work = [...new Set([...changed, ...deleted])].sort();
    const selected = work.slice(0, 20);
    const candidate = (file) => {
      const n = index[file] || previous.files[file];
      if (!n) return [];
      return Object.entries(index)
        .filter(([f]) => f !== file)
        .map(([f, x]) => {
          const direct =
            [...n.prerequisites, ...n.related].includes(x.id) ||
            [...x.prerequisites, ...x.related].includes(n.id);
          const a = n.title.toLowerCase(),
            b = x.title.toLowerCase();
          let score = direct ? 100 : 0;
          if (a === b || a.includes(b) || b.includes(a)) score += 60;
          score += x.tags.filter((t) => n.tags.includes(t)).length * 10;
          if (JSON.stringify(x.category) === JSON.stringify(n.category))
            score += 2;
          return { path: f, id: x.id, title: x.title, hash: x.hash, score };
        })
        .filter((x) => x.score > 0)
        .sort((a, b) => b.score - a.score || a.path.localeCompare(b.path))
        .slice(0, 10);
    };
    return {
      baseline_created: initial,
      protocol: 1,
      changes: selected.map((file) => ({
        path: file,
        kind: !fs.existsSync(path.join(root, file))
          ? "deleted"
          : previous.files[file]
            ? "modified"
            : "added",
        hash:
          index[file]?.hash ||
          errors.find((e) => e.file === file)?.hash ||
          null,
        metadata: index[file] || previous.files[file],
        candidates: candidate(file),
      })),
      remaining: work.length - selected.length,
      errors,
    };
  } finally {
    release();
  }
}
export function apply(root, manifest) {
  if (
    !manifest ||
    !Array.isArray(manifest.operations) ||
    !Array.isArray(manifest.processed)
  )
    throw Error("清单需要 operations 与 processed 数组");
  if (manifest.processed.length > 20)
    throw Error("单次最多处理 20 个增量知识点");
  if (manifest.operations.length > 240) throw Error("变更超出单批增量范围");
  const stateDir = path.join(root, ".knowledge"),
    release = acquireLock(stateDir);
  const batch = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
  const batchDir = path.join(stateDir, "batches", batch);
  try {
    const { index } = indexLibrary(root);
    const state = readState(stateDir) || { version: 1, files: index };
    const paths = new Set();
    for (const op of manifest.operations) {
      const dest = safePath(root, op.path);
      if (!op.path.endsWith(".md")) throw Error("只允许修改 .md 文件");
      if (paths.has(op.path)) throw Error("同一文件不得重复修改");
      paths.add(op.path);
      const actual = fs.existsSync(dest)
        ? hash(fs.readFileSync(dest, "utf8"))
        : null;
      if (actual !== op.expected_hash) throw Error(`并发修改冲突：${op.path}`);
      if (op.content !== null) parseNote(op.content);
    }
    for (const item of manifest.processed) {
      const dest = safePath(root, item.path);
      const actual = fs.existsSync(dest)
        ? hash(fs.readFileSync(dest, "utf8"))
        : null;
      if (actual !== item.expected_hash)
        throw Error(`处理进度已过期：${item.path}`);
    }
    const future = new Map(Object.entries(index).map(([p, n]) => [p, n]));
    for (const op of manifest.operations) {
      if (op.content === null) future.delete(op.path);
      else future.set(op.path, parseNote(op.content));
    }
    const seen = new Map();
    for (const [p, n] of future) {
      if (seen.has(n.id))
        throw Error(`重复 ID ${n.id}：${p} 与 ${seen.get(n.id)}`);
      seen.set(n.id, p);
    }
    const claimed = new Map();
    for (const n of future.values())
      for (const old of n.merged_from) {
        if (seen.has(old) || (claimed.has(old) && claimed.get(old) !== n.id))
          throw Error(`合并关系冲突：${old}`);
        claimed.set(old, n.id);
      }
    fs.mkdirSync(batchDir, { recursive: true });
    const journal = {
      id: batch,
      created_at: new Date().toISOString(),
      status: "pending",
      state_before: state,
      operations: manifest.operations.map((op, i) => ({
        path: op.path,
        before_hash: op.expected_hash,
        after_hash: op.content === null ? null : hash(op.content),
        backup: op.expected_hash === null ? null : `${i}.md`,
      })),
      report: manifest.report || {},
    };
    for (const op of journal.operations)
      if (op.backup)
        fs.copyFileSync(
          path.join(root, op.path),
          path.join(batchDir, op.backup),
        );
    writeJSON(path.join(batchDir, "journal.json"), journal);
    try {
      for (const op of manifest.operations) {
        const dest = safePath(root, op.path);
        if (op.content === null) fs.rmSync(dest, { force: true });
        else atomicWrite(dest, op.content);
      }
      const { index: after } = indexLibrary(root);
      const next = { ...state, files: { ...state.files } };
      for (const p of new Set([
        ...paths,
        ...manifest.processed.map((x) => x.path),
      ])) {
        if (after[p]) next.files[p] = after[p];
        else delete next.files[p];
      }
      writeJSON(path.join(stateDir, "maintenance.json"), next);
      journal.status = "applied";
      writeJSON(path.join(batchDir, "journal.json"), journal);
      return {
        batch,
        changed: manifest.operations.length,
        processed: manifest.processed.length,
        report: journal.report,
      };
    } catch (e) {
      journal.status = "interrupted";
      journal.error = e.message;
      writeJSON(path.join(batchDir, "journal.json"), journal);
      throw Error(`批次 ${batch} 中断：${e.message}。请运行 restore 恢复。`);
    }
  } finally {
    release();
  }
}
export function restore(root, batch) {
  if (!/^[a-zA-Z0-9-]+$/.test(batch)) throw Error("无效批次 ID");
  const stateDir = path.join(root, ".knowledge"),
    release = acquireLock(stateDir);
  try {
    const dir = path.join(stateDir, "batches", batch),
      journal = JSON.parse(
        fs.readFileSync(path.join(dir, "journal.json"), "utf8"),
      );
    if (journal.status === "restored")
      return { batch, status: "already-restored" };
    for (const op of journal.operations) {
      const dest = safePath(root, op.path),
        actual = fs.existsSync(dest)
          ? hash(fs.readFileSync(dest, "utf8"))
          : null;
      if (actual !== op.after_hash && actual !== op.before_hash)
        throw Error(`文件在维护后发生修改，不能直接恢复：${op.path}`);
    }
    for (const op of journal.operations) {
      const dest = safePath(root, op.path);
      if (op.backup)
        atomicWrite(dest, fs.readFileSync(path.join(dir, op.backup), "utf8"));
      else fs.rmSync(dest, { force: true });
    }
    // Do not rewind unrelated batches: restore only this batch's touched paths.
    const state = readState(stateDir) || { version: 1, files: {} };
    for (const op of journal.operations) {
      const before = journal.state_before.files[op.path];
      if (before) state.files[op.path] = before;
      else delete state.files[op.path];
    }
    writeJSON(path.join(stateDir, "maintenance.json"), state);
    journal.status = "restored";
    writeJSON(path.join(dir, "journal.json"), journal);
    return { batch, status: "restored" };
  } finally {
    release();
  }
}
function options(argv) {
  const args = [...argv],
    result = {};
  for (let i = 0; i < args.length; i++)
    if (args[i].startsWith("--")) {
      result[args[i].slice(2)] = args[i + 1];
      i++;
    }
  return result;
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    const command = process.argv[2] || "scan",
      args = options(process.argv.slice(3)),
      root = path.resolve(args.root || process.env.KNOWLEDGE_DIR || "content");
    let result;
    if (command === "scan")
      result = scan(root, args.files ? JSON.parse(args.files) : []);
    else if (command === "validate") {
      const { index, errors } = indexLibrary(root);
      const ids = new Set();
      for (const [file, n] of Object.entries(index)) {
        if (ids.has(n.id)) errors.push({ file, message: `重复 ID ${n.id}` });
        ids.add(n.id);
      }
      result = { valid: Object.keys(index).length, errors };
      if (errors.length) process.exitCode = 1;
    } else if (command === "apply")
      result = apply(root, JSON.parse(fs.readFileSync(args.manifest, "utf8")));
    else if (command === "restore") result = restore(root, args.batch);
    else if (command === "unlock") {
      const lock = path.join(root, ".knowledge", "write.lock");
      const owner = JSON.parse(
        fs.readFileSync(path.join(lock, "owner.json"), "utf8"),
      );
      let alive = true;
      try {
        process.kill(owner.pid, 0);
      } catch (e) {
        if (e.code === "ESRCH") alive = false;
      }
      if (alive) throw Error("锁持有进程仍在运行，不能解锁");
      fs.rmSync(lock, { recursive: true });
      result = { unlocked: true };
    } else throw Error("命令：scan | validate | apply | restore | unlock");
    console.log(JSON.stringify(result, null, 2));
  } catch (e) {
    console.error(JSON.stringify({ error: e.message }));
    process.exitCode = 1;
  }
}
