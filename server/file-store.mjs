import { deriveRelations } from "../shared/relations.mjs";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import {
  readLibrary,
  parseNote,
  day,
  addDays,
  acquireLock,
  atomicWrite,
  hash,
  files,
  safePath,
  serializeNote,
} from "../shared/protocol.mjs";
export const intervals = [1, 3, 7, 14, 30, 60];
export class Store {
  constructor(root, stateDir, clock = () => new Date()) {
    this.root = root;
    this.stateDir = stateDir;
    this.clock = clock;
    this.errors = [];
    this.version = 0;
    fs.mkdirSync(root, { recursive: true });
    fs.mkdirSync(stateDir, { recursive: true });
    this.db = new DatabaseSync(path.join(stateDir, "knowledge.sqlite"));
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
  CREATE TABLE IF NOT EXISTS notes(id TEXT PRIMARY KEY,path TEXT NOT NULL,hash TEXT NOT NULL,data TEXT NOT NULL,active INTEGER NOT NULL DEFAULT 1);
  CREATE TABLE IF NOT EXISTS additions(id TEXT PRIMARY KEY,title TEXT NOT NULL,date TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS reviews(id TEXT PRIMARY KEY,stage INTEGER NOT NULL DEFAULT 0,due TEXT NOT NULL,paused INTEGER NOT NULL DEFAULT 0);
  CREATE TABLE IF NOT EXISTS review_events(event_id INTEGER PRIMARY KEY AUTOINCREMENT,note_id TEXT NOT NULL,original_id TEXT NOT NULL,at TEXT NOT NULL,rating TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS redirects(old_id TEXT PRIMARY KEY,new_id TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS merge_snapshots(old_id TEXT PRIMARY KEY,new_id TEXT NOT NULL,data TEXT NOT NULL,at TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);`);
    this.assetsDb = new DatabaseSync(path.join(stateDir, "assets.sqlite"));
    this.assetsDb.exec(`PRAGMA journal_mode=WAL;
      CREATE TABLE IF NOT EXISTS assets(id TEXT PRIMARY KEY,mime TEXT NOT NULL,data BLOB NOT NULL);`);
    // Copy and verify before dropping the legacy table. A crash between commits
    // leaves a safe, idempotent migration to resume on the next startup.
    if (
      this.db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name='assets'",
        )
        .get()
    ) {
      const release = acquireLock(stateDir);
      try {
        this.assetsDb.exec("BEGIN IMMEDIATE");
        try {
          for (const row of this.db
            .prepare("SELECT id,mime,data FROM assets")
            .iterate()) {
            if (hash(Buffer.from(row.data)) !== row.id)
              throw Error(`旧图片校验失败：${row.id}`);
            this.assetsDb
              .prepare(
                "INSERT OR IGNORE INTO assets(id,mime,data) VALUES(?,?,?)",
              )
              .run(row.id, row.mime, row.data);
            const saved = this.assetsDb
              .prepare("SELECT mime,data FROM assets WHERE id=?")
              .get(row.id);
            if (
              saved.mime !== row.mime ||
              !Buffer.from(saved.data).equals(Buffer.from(row.data))
            )
              throw Error(`图片迁移冲突：${row.id}`);
          }
          this.assetsDb.exec("COMMIT");
        } catch (error) {
          this.assetsDb.exec("ROLLBACK");
          throw error;
        }
        this.db.exec("DROP TABLE assets");
      } catch (error) {
        this.assetsDb.close();
        this.db.close();
        throw error;
      } finally {
        release();
      }
    }
  }
  close() {
    this.assetsDb.close();
    this.db.close();
  }
  resolve(id) {
    const seen = new Set();
    while (!seen.has(id)) {
      seen.add(id);
      const row = this.db
        .prepare("SELECT new_id FROM redirects WHERE old_id=?")
        .get(id);
      if (!row) return id;
      id = row.new_id;
    }
    return id;
  }
  active() {
    return this.db
      .prepare("SELECT * FROM notes WHERE active=1")
      .all()
      .map((r) => ({
        ...JSON.parse(r.data),
        path: r.path,
        hash: r.hash,
        review: this.db.prepare("SELECT * FROM reviews WHERE id=?").get(r.id),
      }));
  }
  trash() {
    const dir = path.join(this.stateDir, "trash");
    if (!fs.existsSync(dir)) return [];
    return fs
      .readdirSync(dir)
      .flatMap((token) => {
        if (!/^[a-f0-9-]{36}$/.test(token)) return [];
        const entry = path.join(dir, token);
        if (!fs.existsSync(path.join(entry, "note.md"))) return [];
        try {
          const data = JSON.parse(
            fs.readFileSync(path.join(entry, "metadata.json"), "utf8"),
          );
          return [
            {
              token,
              id: data.id,
              title: data.title,
              deleted_at: data.deleted_at,
            },
          ];
        } catch {
          return [];
        }
      })
      .sort((a, b) => b.deleted_at.localeCompare(a.deleted_at));
  }
  deleteNote(id, expectedHash) {
    const release = acquireLock(this.stateDir);
    try {
      const row = this.db
        .prepare("SELECT * FROM notes WHERE id=? AND active=1")
        .get(id);
      if (!row) throw Error("知识点不存在或已删除");
      const source = safePath(this.root, row.path),
        text = fs.readFileSync(source, "utf8");
      if (
        !expectedHash ||
        hash(text) !== expectedHash ||
        row.hash !== expectedHash
      )
        throw Error("知识点已被修改，请刷新后再删除");
      const duplicates = readLibrary(this.root).notes.filter(
        (n) => n.note.id === id,
      );
      if (duplicates.length !== 1) throw Error("存在重复 ID，请先修复重复文件");
      const token = crypto.randomUUID(),
        dir = path.join(this.stateDir, "trash", token),
        n = JSON.parse(row.data);
      fs.mkdirSync(dir, { recursive: true });
      atomicWrite(
        path.join(dir, "metadata.json"),
        JSON.stringify({
          id,
          title: n.title,
          path: row.path,
          hash: expectedHash,
          deleted_at: this.clock().toISOString(),
        }),
      );
      fs.renameSync(source, path.join(dir, "note.md"));
      try {
        this.syncUnlocked();
      } catch (e) {
        fs.renameSync(path.join(dir, "note.md"), source);
        throw e;
      }
      return { token, id, title: n.title };
    } finally {
      release();
    }
  }
  restoreNote(token) {
    if (!/^[a-f0-9-]{36}$/.test(token)) throw Error("无效的归档标识");
    const release = acquireLock(this.stateDir);
    try {
      const dir = path.join(this.stateDir, "trash", token),
        archived = path.join(dir, "note.md");
      if (!fs.existsSync(archived)) throw Error("知识点已恢复或归档不存在");
      const meta = JSON.parse(
          fs.readFileSync(path.join(dir, "metadata.json"), "utf8"),
        ),
        text = fs.readFileSync(archived, "utf8"),
        n = parseNote(text);
      if (hash(text) !== meta.hash || n.id !== meta.id)
        throw Error("归档内容已改变，请检查备份");
      if (
        this.resolve(n.id) !== n.id ||
        readLibrary(this.root).notes.some((x) => x.note.id === n.id)
      )
        throw Error("已有同 ID 知识点或合并记录，不能覆盖");
      const target = safePath(this.root, meta.path);
      if (fs.existsSync(target)) throw Error("原文件路径已被占用，不能覆盖");
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.renameSync(archived, target);
      try {
        const result = this.syncUnlocked();
        const issue = result.errors.find(
          (e) =>
            e.file === meta.path && !e.message.startsWith("关联目标不存在"),
        );
        if (issue) throw Error(issue.message);
      } catch (e) {
        fs.renameSync(target, archived);
        this.syncUnlocked();
        throw e;
      }
      return { id: n.id, title: n.title };
    } finally {
      release();
    }
  }
  organize({ source, destination, title, action, expected }) {
    const validPath = (p) =>
      Array.isArray(p) &&
      p.every(
        (x) =>
          typeof x === "string" &&
          x.trim() === x &&
          x.length > 0 &&
          !/[\/\\\x00-\x1f]/.test(x),
      );
    if (!source || !["move", "rename", "delete"].includes(action))
      throw Error("无效的目录操作");
    const folder = Array.isArray(source.category);
    if (
      folder
        ? !validPath(source.category) || !source.category.length
        : typeof source.id !== "string"
    )
      throw Error("无效的操作来源");
    if (action === "rename" && (typeof title !== "string" || !title.trim()))
      throw Error("名称不能为空");
    if (action === "rename") title = title.trim();
    if (action === "move" && !validPath(destination))
      throw Error("无效的目标目录");
    const starts = (p, prefix) => prefix.every((x, i) => p[i] === x);
    const release = acquireLock(this.stateDir);
    const applied = [];
    try {
      const lib = readLibrary(this.root);
      const rows = lib.notes.filter(({ note }) =>
        folder ? starts(note.category, source.category) : note.id === source.id,
      );
      if (!rows.length) throw Error("来源已不存在，请刷新后重试");
      if (
        !Array.isArray(expected) ||
        expected.length !== rows.length ||
        rows.some(
          (r) =>
            expected.filter((e) => e.id === r.note.id && e.hash === r.hash)
              .length !== 1,
        ) ||
        new Set(rows.map((r) => r.note.id)).size !== rows.length
      )
        throw Error("目录或知识点已被修改，请刷新后重试");
      let target;
      if (folder && action !== "delete") {
        target =
          action === "rename"
            ? [...source.category.slice(0, -1), title]
            : [...destination, source.category.at(-1)];
        if (!validPath(target)) throw Error("目录名称不能包含斜杠或控制字符");
        if (JSON.stringify(target) === JSON.stringify(source.category))
          return { count: 0, category: target };
        if (starts(target, source.category))
          throw Error("不能将目录移入自身或子目录");
        if (lib.notes.some(({ note }) => starts(note.category, target)))
          throw Error("目标位置已有同名目录");
      }
      if (
        action === "move" &&
        destination.length &&
        !lib.notes.some(({ note }) => starts(note.category, destination))
      )
        throw Error("目标目录已不存在");
      if (!folder && action === "move" && !destination.length)
        throw Error("请选择一个目录");
      const changes = rows.map((r) => {
        const n = { ...r.note, updated_at: this.clock().toISOString() };
        if (folder && target)
          n.category = [...target, ...n.category.slice(source.category.length)];
        else if (action === "move") n.category = destination;
        else if (action === "rename") n.title = title;
        const text = serializeNote(n);
        if (action !== "delete") parseNote(text);
        return { ...r, textAfter: text };
      });
      for (const r of changes) {
        const file = safePath(this.root, r.file);
        if (action === "delete") {
          const dir = path.join(this.stateDir, "trash", crypto.randomUUID());
          fs.mkdirSync(dir, { recursive: true });
          atomicWrite(
            path.join(dir, "metadata.json"),
            JSON.stringify({
              id: r.note.id,
              title: r.note.title,
              path: r.file,
              hash: r.hash,
              deleted_at: this.clock().toISOString(),
            }),
          );
          const archived = path.join(dir, "note.md");
          fs.renameSync(file, archived);
          applied.push({ file, archived, text: r.text });
        } else {
          atomicWrite(file, r.textAfter);
          applied.push({ file, text: r.text });
        }
      }
      const result = this.syncUnlocked();
      const issue = result.errors.find(
        (e) =>
          rows.some((r) => r.file === e.file) &&
          !e.message.startsWith("关联目标不存在"),
      );
      if (issue) throw Error(issue.message);
      return { count: rows.length, category: target || destination };
    } catch (error) {
      for (const r of applied.reverse()) {
        if (r.archived) fs.renameSync(r.archived, r.file);
        else atomicWrite(r.file, r.text);
      }
      if (applied.length) this.syncUnlocked();
      throw error;
    } finally {
      release();
    }
  }
  nextDue() {
    let due = addDays(day(this.clock()), 1);
    while (
      this.db
        .prepare(
          "SELECT count(*) AS n FROM additions a JOIN reviews r ON a.id=r.id WHERE r.due=? AND NOT EXISTS (SELECT 1 FROM review_events e WHERE e.note_id=a.id)",
        )
        .get(due).n >= 10
    )
      due = addDays(due, 1);
    return due;
  }
  sync() {
    let release;
    try {
      release = acquireLock(this.stateDir);
    } catch (e) {
      if (e.code === "LOCKED") return { busy: true };
      throw e;
    }
    try {
      return this.syncUnlocked();
    } finally {
      release();
    }
  }
  library() {
    return readLibrary(this.root);
  }
  syncUnlocked(library = this.library(), nested = false) {
    const { notes, errors } = library;
    const groups = new Map();
    const present = new Set([
      ...notes.map((n) => n.file),
      ...errors.map((e) => e.file),
    ]);
    for (const item of notes) {
      const list = groups.get(item.note.id) || [];
      list.push(item);
      groups.set(item.note.id, list);
    }
    const valid = [];
    for (const [id, list] of groups) {
      if (list.length > 1) {
        for (const item of list)
          errors.push({
            file: item.file,
            message: `重复 ID ${id}：请保留唯一文件`,
          });
      } else valid.push(list[0]);
    }
    // Validate merge ownership before touching persistent identities.
    const owners = new Map();
    for (const item of valid)
      for (const old of item.note.merged_from) {
        const a = owners.get(old) || [];
        a.push(item.note.id);
        owners.set(old, a);
      }
    const rejected = new Set();
    for (const item of valid)
      for (const old of item.note.merged_from) {
        if (
          owners.get(old).length > 1 ||
          valid.some((x) => x.note.id === old) ||
          item.note.id === old
        ) {
          rejected.add(item.note.id);
          errors.push({
            file: item.file,
            message: `合并 ID 冲突：${old}，源文件应先归档且不能有多个目标`,
          });
        }
      }
    if (!nested) this.db.exec("BEGIN IMMEDIATE");
    let changed = false;
    try {
      // Undo identity migrations when a restored Markdown no longer declares a merge.
      const declared = new Set(
        valid
          .filter((x) => !rejected.has(x.note.id))
          .flatMap((x) =>
            x.note.merged_from.map((old) => old + "|" + x.note.id),
          ),
      );
      for (const redirect of this.db
        .prepare("SELECT * FROM redirects ORDER BY rowid DESC")
        .all()) {
        const target = valid.find((x) => x.note.id === redirect.new_id);
        if (
          (target && rejected.has(target.note.id)) ||
          declared.has(redirect.old_id + "|" + redirect.new_id) ||
          (!target &&
            !owners.has(redirect.old_id) &&
            !valid.some((x) => x.note.id === redirect.old_id))
        )
          continue;
        const snapshot = this.db
          .prepare("SELECT * FROM merge_snapshots WHERE old_id=?")
          .get(redirect.old_id);
        if (snapshot) {
          const saved = JSON.parse(snapshot.data);
          for (const r of saved) {
            if (!r) continue;
            const later = this.db
              .prepare(
                "SELECT 1 FROM review_events WHERE original_id=? AND at>?",
              )
              .get(r.id, snapshot.at);
            if (!later)
              this.db
                .prepare("UPDATE reviews SET stage=?,due=?,paused=? WHERE id=?")
                .run(r.stage, r.due, r.paused, r.id);
          }
        }
        this.db
          .prepare("DELETE FROM redirects WHERE old_id=?")
          .run(redirect.old_id);
        this.db
          .prepare("DELETE FROM merge_snapshots WHERE old_id=?")
          .run(redirect.old_id);
        changed = true;
      }
      for (const event of this.db
        .prepare("SELECT event_id,original_id,note_id FROM review_events")
        .all()) {
        const resolved = this.resolve(event.original_id);
        if (resolved !== event.note_id)
          this.db
            .prepare("UPDATE review_events SET note_id=? WHERE event_id=?")
            .run(resolved, event.event_id);
      }
      for (const item of valid) {
        if (rejected.has(item.note.id)) continue;
        const n = item.note;
        const prior = this.db
          .prepare("SELECT * FROM notes WHERE id=?")
          .get(n.id);
        if (this.resolve(n.id) !== n.id) {
          errors.push({
            file: item.file,
            message: `ID ${n.id} 已合并到 ${this.resolve(n.id)}，请先撤销相应维护批次`,
          });
          continue;
        }
        if (
          !prior ||
          prior.hash !== item.hash ||
          !prior.active ||
          prior.path !== item.file
        ) {
          changed = true;
          this.db
            .prepare(
              "INSERT INTO notes(id,path,hash,data,active) VALUES(?,?,?,?,1) ON CONFLICT(id) DO UPDATE SET path=excluded.path,hash=excluded.hash,data=excluded.data,active=1",
            )
            .run(n.id, item.file, item.hash, JSON.stringify(n));
        }
        this.db
          .prepare(
            "INSERT OR IGNORE INTO additions(id,title,date) VALUES(?,?,?)",
          )
          .run(n.id, n.title, day(this.clock()));
        this.db
          .prepare("INSERT OR IGNORE INTO reviews(id,due) VALUES(?,?)")
          .run(n.id, this.nextDue());
        for (const old of n.merged_from) {
          if (
            this.db.prepare("SELECT 1 FROM redirects WHERE old_id=?").get(old)
          )
            continue;
          const a = this.db
              .prepare("SELECT * FROM reviews WHERE id=?")
              .get(n.id),
            b = this.db.prepare("SELECT * FROM reviews WHERE id=?").get(old);
          this.db
            .prepare(
              "INSERT OR REPLACE INTO merge_snapshots(old_id,new_id,data,at) VALUES(?,?,?,?)",
            )
            .run(
              old,
              n.id,
              JSON.stringify([a, b].filter(Boolean)),
              this.clock().toISOString(),
            );
          if (b)
            this.db
              .prepare("UPDATE reviews SET stage=?,due=?,paused=? WHERE id=?")
              .run(
                Math.min(a.stage, b.stage),
                a.due < b.due ? a.due : b.due,
                a.paused && b.paused ? 1 : 0,
                n.id,
              );
          this.db
            .prepare("UPDATE review_events SET note_id=? WHERE note_id=?")
            .run(n.id, old);
          this.db
            .prepare("INSERT INTO redirects(old_id,new_id) VALUES(?,?)")
            .run(old, n.id);
          changed = true;
        }
      }
      for (const row of this.db
        .prepare("SELECT id,path FROM notes WHERE active=1")
        .all())
        if (
          !present.has(row.path) &&
          !valid.some((x) => x.note.id === row.id && !rejected.has(row.id))
        ) {
          this.db.prepare("UPDATE notes SET active=0 WHERE id=?").run(row.id);
          changed = true;
        }
      if (!nested) this.db.exec("COMMIT");
    } catch (e) {
      if (!nested) this.db.exec("ROLLBACK");
      throw e;
    }
    const all = this.active();
    if (changed || JSON.stringify(errors) !== JSON.stringify(this.errors))
      this.version++;
    this.errors = errors;
    return { count: all.length, errors, version: this.version };
  }
  source(id) {
    const n = this.active().find((n) => n.id === id);
    if (!n) throw Error("知识点不存在");
    const text = fs.readFileSync(safePath(this.root, n.path), "utf8");
    if (parseNote(text).id !== id) throw Error("文件身份已变化，请刷新后重试");
    return { text, hash: hash(text) };
  }
  saveNote(text, id, expectedHash) {
    const n = parseNote(text);
    if (id && n.id !== id) throw Error("编辑时不能修改知识点 ID");
    n.updated_at = this.clock().toISOString();
    return this.import(
      serializeNote(n),
      `${n.id}.md`,
      id ? { expectedHash, editId: id } : { createOnly: true },
    );
  }
  import(text, filename, options = {}) {
    const n = parseNote(text);
    const release = acquireLock(this.stateDir);
    try {
      const lib = readLibrary(this.root);
      const same = lib.notes.filter((x) => x.note.id === n.id);
      if (options.editId) {
        if (!options.expectedHash || same[0]?.hash !== options.expectedHash)
          throw Error("知识点已被修改或删除，请保留草稿并重新打开后合并修改");
        if (n.created_at !== same[0].note.created_at)
          throw Error("编辑时不能修改创建时间");
      }
      if (
        options.createOnly &&
        (same.length ||
          this.db.prepare("SELECT 1 FROM notes WHERE id=?").get(n.id))
      )
        throw Error("此 ID 已存在，请使用新的 ID 创建");
      if (same.length > 1) throw Error("目录中已有重复 ID，请先修复");
      if (this.resolve(n.id) !== n.id)
        throw Error(`此 ID 已合并到 ${this.resolve(n.id)}`);
      if (same[0]?.hash === hash(text))
        return { filename, status: "skipped", id: n.id };
      if (
        options.rejectConflict &&
        (same.length ||
          this.db.prepare("SELECT 1 FROM notes WHERE id=?").get(n.id))
      )
        throw Error("同 ID 内容不同或已在回收站，请手动核对；未覆盖本地内容");
      const dest = safePath(this.root, same[0]?.file || `${n.id}.md`);
      if (!same.length && fs.existsSync(dest))
        throw Error("目标文件已存在且无法安全覆盖");
      if (same[0]) {
        const backup = path.join(
          this.stateDir,
          "upload-backups",
          `${Date.now()}-${n.id}.md`,
        );
        atomicWrite(backup, same[0].text);
      }
      atomicWrite(dest, text);
      const r = this.syncUnlocked();
      const err = r.errors.find(
        (e) =>
          e.file === path.relative(this.root, dest) &&
          !e.message.startsWith("关联目标不存在"),
      );
      if (err) {
        if (same[0]) atomicWrite(dest, same[0].text);
        else fs.unlinkSync(dest);
        this.syncUnlocked();
        throw Error(err.message);
      }
      return {
        filename,
        status: same.length ? "updated" : "created",
        id: n.id,
      };
    } finally {
      release();
    }
  }
  list({ q = "", category = "", tag = "", date = "" } = {}) {
    const tokens = q.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
    let rows = this.active();
    if (category) {
      const cats = JSON.parse(category);
      rows = rows.filter((n) => cats.every((c, i) => n.category[i] === c));
    }
    if (tag) rows = rows.filter((n) => n.tags.includes(tag));
    if (date) {
      const ids = new Set(
        this.db
          .prepare("SELECT id FROM additions WHERE date=?")
          .all(date)
          .map((x) => x.id),
      );
      rows = rows.filter((n) => ids.has(n.id));
    }
    return rows
      .map((n) => {
        const title = [n.title, ...n.aliases].join(" ").toLocaleLowerCase(),
          tags = [...n.tags, ...n.knowledge_keywords, ...n.dependency_keywords]
            .join(" ")
            .toLocaleLowerCase(),
          summary = n.summary.toLocaleLowerCase(),
          body = n.body.toLocaleLowerCase();
        const fields = [
          title,
          tags,
          summary,
          body,
          n.category.join(" ").toLocaleLowerCase(),
        ];
        if (!tokens.every((t) => fields.some((f) => f.includes(t))))
          return null;
        const score = tokens.reduce(
          (s, t) =>
            s +
            (title.includes(t)
              ? 100
              : tags.includes(t)
                ? 60
                : summary.includes(t)
                  ? 30
                  : 10),
          0,
        );
        const at = tokens.length
          ? Math.max(
              0,
              body.indexOf(tokens.find((t) => body.includes(t)) || ""),
            )
          : 0;
        return {
          ...n,
          score,
          snippet: tokens.length
            ? n.body.slice(Math.max(0, at - 35), at + 130)
            : n.summary,
        };
      })
      .filter(Boolean)
      .sort(
        (a, b) => b.score - a.score || b.updated_at.localeCompare(a.updated_at),
      );
  }
  detail(id) {
    const resolved = this.resolve(id);
    const n = this.active().find((n) => n.id === resolved);
    if (!n) return null;
    const all = this.active(),
      byId = new Map(all.map((n) => [n.id, n]));
    const brief = (id) => {
      const target = byId.get(this.resolve(id));
      return target
        ? { id: target.id, title: target.title, category: target.category }
        : { id, title: id, missing: true };
    };
    const derived = deriveRelations(all).get(n.id);
    const relations = Object.fromEntries(
      Object.entries(derived).map(([kind, entries]) => [
        kind,
        [...entries.values()].map((relation) => ({
          ...brief(relation.id),
          origin: relation.origin,
          matched_keywords: relation.matched_keywords,
        })),
      ]),
    );
    return {
      ...n,
      relations,
      history: this.db
        .prepare("SELECT * FROM review_events WHERE note_id=? ORDER BY at DESC")
        .all(n.id),
    };
  }
  review(id, rating) {
    id = this.resolve(id);
    if (!this.active().some((n) => n.id === id)) throw Error("知识点不存在");
    if (!["again", "hard", "good"].includes(rating))
      throw Error("无效的复习反馈");
    const r = this.db.prepare("SELECT * FROM reviews WHERE id=?").get(id);
    const stage =
      rating === "again"
        ? 0
        : rating === "hard"
          ? r.stage
          : Math.min(5, r.stage + 1);
    this.db.exec("BEGIN");
    try {
      this.db
        .prepare("UPDATE reviews SET stage=?,due=? WHERE id=?")
        .run(stage, addDays(day(this.clock()), intervals[stage]), id);
      this.db
        .prepare(
          "INSERT INTO review_events(note_id,original_id,at,rating) VALUES(?,?,?,?)",
        )
        .run(id, id, this.clock().toISOString(), rating);
      this.db.exec("COMMIT");
      this.version++;
      return this.detail(id);
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }
  setReview(id, { paused, immediate }) {
    id = this.resolve(id);
    if (!this.active().some((n) => n.id === id)) throw Error("知识点不存在");
    if (typeof paused === "boolean")
      this.db
        .prepare("UPDATE reviews SET paused=? WHERE id=?")
        .run(paused ? 1 : 0, id);
    if (immediate)
      this.db
        .prepare("UPDATE reviews SET due=?,paused=0 WHERE id=?")
        .run(day(this.clock()), id);
    this.version++;
    return this.detail(id);
  }
  additions(date) {
    return this.db
      .prepare(
        "SELECT a.*,n.active FROM additions a LEFT JOIN notes n ON n.id=a.id WHERE a.date=? ORDER BY a.title",
      )
      .all(date)
      .map((n) => ({ ...n, resolved_id: this.resolve(n.id) }));
  }
  learningActivity(date) {
    // Learning dates come from Markdown, independently of the import audit log.
    // Retain deleted history; resolve merged identities before deduplicating.
    const records = this.db.prepare("SELECT id,data,active FROM notes").all();
    const byId = new Map(records.map((r) => [r.id, r]));
    const activity = new Map();
    for (const record of records) {
      const note = JSON.parse(record.data),
        id = this.resolve(record.id);
      const target = byId.get(id) || record,
        targetNote = JSON.parse(target.data);
      for (const event of note.learning_events) {
        if (!event.date || (date && event.date !== date)) continue;
        const key = JSON.stringify([event.date, id]);
        if (!activity.has(key))
          activity.set(key, {
            id,
            resolved_id: id,
            title: targetNote.title,
            date: event.date,
            active: target.active,
          });
      }
    }
    return [...activity.values()].sort(
      (a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title),
    );
  }
  stats() {
    const all = this.active(),
      today = day(this.clock());
    return {
      total: all.length,
      categories: new Set(
        all.flatMap((n) =>
          n.category.map((_, i) => JSON.stringify(n.category.slice(0, i + 1))),
        ),
      ).size,
      due: all.filter((n) => !n.review.paused && n.review.due <= today).length,
      learning: all.filter((n) => n.status === "learning").length,
      learningDays: [
        ...this.learningActivity().reduce(
          (counts, event) =>
            counts.set(event.date, (counts.get(event.date) || 0) + 1),
          new Map(),
        ),
      ].map(([date, count]) => ({ date, count })),
      days: this.db
        .prepare(
          "SELECT date,count(*) AS count FROM additions GROUP BY date ORDER BY date",
        )
        .all(),
      today,
      version: this.version,
      errors: this.errors,
    };
  }
  timeline() {
    return this.active()
      .flatMap((n) =>
        n.learning_events.map((e) => ({
          ...e,
          id: n.id,
          title: n.title,
          category: n.category,
        })),
      )
      .sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  }
  graph(id, { depth = 2, limit = 100, category = "", type = "all" } = {}) {
    id = this.resolve(id);
    const all = this.active(),
      map = new Map(all.map((n) => [n.id, n]));
    if (!map.has(id)) return null;
    const edges = [],
      seenEdges = new Set();
    const push = (source, target, kind) => {
      if (source === target || !map.has(source) || !map.has(target)) return;
      const key =
        kind === "related"
          ? [source, target].sort().join(":")
          : source + ":" + target;
      const k = kind + ":" + key;
      if (!seenEdges.has(k)) {
        seenEdges.add(k);
        edges.push({ id: k, source, target, type: kind });
      }
    };
    const derived = deriveRelations(all);
    for (const n of all) {
      if (type !== "related")
        for (const x of derived.get(n.id).prerequisites.keys())
          push(x, n.id, "prerequisite");
      if (type !== "prerequisite")
        for (const x of derived.get(n.id).related.keys())
          push(n.id, x, "related");
    }
    const cats = category ? JSON.parse(category) : [];
    const eligible = (n) =>
      n.id === id || cats.every((c, i) => n.category[i] === c);
    const filtered = edges.filter(
      (e) => eligible(map.get(e.source)) && eligible(map.get(e.target)),
    );
    const hops = new Map([[id, 0]]),
      queue = [id];
    for (let i = 0; i < queue.length; i++) {
      const node = queue[i],
        hop = hops.get(node);
      if (hop >= depth) continue;
      for (const edge of filtered) {
        const next =
          edge.source === node
            ? edge.target
            : edge.target === node
              ? edge.source
              : null;
        if (next && !hops.has(next)) {
          hops.set(next, hop + 1);
          queue.push(next);
        }
      }
    }
    const selected = new Set(queue.slice(0, limit));
    return {
      nodes: [...selected].map((id) => ({
        id,
        title: map.get(id).title,
        category: map.get(id).category,
        hop: hops.get(id),
      })),
      edges: filtered.filter(
        (e) => selected.has(e.source) && selected.has(e.target),
      ),
      truncated: queue.length > limit,
      total: queue.length,
      depth,
    };
  }
}
