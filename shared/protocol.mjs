import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import YAML from "yaml";
export const hash = (text) =>
  crypto.createHash("sha256").update(text).digest("hex");
export const day = (date = new Date()) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
export function addDays(date, n) {
  const d = new Date(`${date}T12:00:00`);
  d.setDate(d.getDate() + n);
  return day(d);
}
export function validDay(value) {
  return (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    !isNaN(Date.parse(value)) &&
    new Date(value + "T12:00:00Z").toISOString().slice(0, 10) === value
  );
}
export function parseNote(text) {
  if (typeof text !== "string" || Buffer.byteLength(text) > 2 * 1024 * 1024)
    throw Error("单篇文件不得超过 2 MB");
  const match = text
    .replace(/^\uFEFF/, "")
    .match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)([\s\S]*)$/);
  if (!match) throw Error("需要 YAML 文件头（以 --- 包围）");
  const doc = YAML.parseDocument(match[1], { uniqueKeys: true });
  if (doc.errors.length) throw Error(`YAML 格式错误：${doc.errors[0].message}`);
  const meta = doc.toJS({ maxAliasCount: 20 });
  if (!meta || typeof meta !== "object" || Array.isArray(meta))
    throw Error("文件头必须是对象");
  if (meta.schema_version !== 1) throw Error("schema_version 必须为 1");
  if (
    typeof meta.id !== "string" ||
    !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(meta.id)
  )
    throw Error("id 必须为 1–128 位字母、数字、下划线或短横线");
  for (const k of ["title", "summary"])
    if (typeof meta[k] !== "string" || !meta[k].trim())
      throw Error(`缺少有效的 ${k}`);
  for (const k of [
    "category",
    "tags",
    "prerequisites",
    "related",
    "aliases",
    "merged_from",
  ]) {
    if (meta[k] === undefined && k !== "category") meta[k] = [];
    if (
      !Array.isArray(meta[k]) ||
      meta[k].some((x) => typeof x !== "string" || !x.trim())
    )
      throw Error(`${k} 必须为非空字符串数组`);
    meta[k] = [...new Set(meta[k].map((x) => x.trim()))];
  }
  if (!meta.category.length) throw Error("category 至少包含一级分类");
  for (const k of ["prerequisites", "related", "merged_from"])
    if (meta[k].includes(meta.id)) throw Error(`${k} 不得引用自身`);
  for (const k of ["created_at", "updated_at"])
    if (
      typeof meta[k] !== "string" ||
      !/^\d{4}-\d{2}-\d{2}T/.test(meta[k]) ||
      isNaN(Date.parse(meta[k]))
    )
      throw Error(`${k} 必须为 ISO 时间字符串`);
  if (!["ready", "learning"].includes(meta.status))
    throw Error("status 必须为 ready 或 learning");
  if (!Array.isArray(meta.learning_events))
    throw Error("learning_events 必须为数组");
  for (const e of meta.learning_events)
    if (
      !e ||
      (e.date !== null && !validDay(e.date)) ||
      typeof e.summary !== "string" ||
      !e.summary.trim()
    )
      throw Error("学习事件需要 date（YYYY-MM-DD 或 null）和 summary");
  try {
    JSON.stringify(meta);
  } catch {
    throw Error("元信息不能包含循环引用");
  }
  const body = match[2].trim();
  if (!body) throw Error("知识点正文不能为空");
  return { ...meta, body };
}
export function serializeNote(note) {
  const { body, ...meta } = note;
  return `---\n${YAML.stringify(meta)}---\n\n${body.trim()}\n`;
}
export function files(root) {
  if (!fs.existsSync(root)) return [];
  const result = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith(".") || entry.isSymbolicLink()) continue;
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(file);
      else if (entry.isFile() && /\.md$/i.test(entry.name)) result.push(file);
    }
  };
  walk(root);
  return result.sort();
}
export function readLibrary(root) {
  const notes = [],
    errors = [];
  for (const file of files(root)) {
    try {
      const text = fs.readFileSync(file, "utf8");
      notes.push({
        file: path.relative(root, file),
        hash: hash(text),
        text,
        note: parseNote(text),
      });
    } catch (e) {
      errors.push({ file: path.relative(root, file), message: e.message });
    }
  }
  return { notes, errors };
}
export function atomicWrite(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
  fs.writeFileSync(tmp, text);
  fs.renameSync(tmp, file);
}
export function safePath(root, relative) {
  if (typeof relative !== "string" || path.isAbsolute(relative))
    throw Error("只允许相对路径");
  const dest = path.resolve(root, relative);
  if (
    !dest.startsWith(path.resolve(root) + path.sep) ||
    relative.split(/[\\/]/).some((s) => s.startsWith("."))
  )
    throw Error("路径必须在知识目录内且不能包含隐藏目录");
  let p = dest;
  while (p !== path.resolve(root)) {
    if (fs.existsSync(p) && fs.lstatSync(p).isSymbolicLink())
      throw Error("不能通过符号链接写入");
    p = path.dirname(p);
  }
  return dest;
}
export function acquireLock(stateDir) {
  fs.mkdirSync(stateDir, { recursive: true });
  const lock = path.join(stateDir, "write.lock");
  try {
    fs.mkdirSync(lock);
  } catch (e) {
    if (e.code !== "EEXIST") throw e;
    const err = Error("知识库正在维护，请稍后重试");
    err.code = "LOCKED";
    throw err;
  }
  fs.writeFileSync(
    path.join(lock, "owner.json"),
    JSON.stringify({ pid: process.pid, at: new Date().toISOString() }),
  );
  return () => fs.rmSync(lock, { recursive: true, force: true });
}
export function writeJSON(file, value) {
  atomicWrite(file, JSON.stringify(value, null, 2) + "\n");
}
