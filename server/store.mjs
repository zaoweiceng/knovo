import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import AdmZip from "adm-zip";
import { Store as FileStore } from "./file-store.mjs";
import {
  acquireLock,
  atomicWrite,
  hash,
  parseNote,
  serializeNote,
  readLibrary,
  safePath,
} from "../shared/protocol.mjs";
export { intervals } from "./file-store.mjs";

export class Store extends FileStore {
  constructor(...args) {
    super(...args);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS documents(id TEXT PRIMARY KEY,path TEXT NOT NULL UNIQUE,text TEXT NOT NULL,hash TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS deleted_documents(token TEXT PRIMARY KEY,id TEXT NOT NULL,path TEXT NOT NULL,text TEXT NOT NULL,hash TEXT NOT NULL,title TEXT NOT NULL,deleted_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS document_history(sequence INTEGER PRIMARY KEY,id TEXT NOT NULL,text TEXT NOT NULL,at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS migration_files(path TEXT PRIMARY KEY,hash TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS maintenance_state(key TEXT PRIMARY KEY,value BLOB NOT NULL);
    `);
    try {
      this.migrate();
    } catch (error) {
      this.close();
      throw error;
    }
  }
  sync() {
    const current = this.db.prepare("PRAGMA data_version").get().data_version;
    if (this.dataVersion !== undefined && this.dataVersion !== current)
      this.version++;
    this.dataVersion = current;
    return super.sync();
  }
  library() {
    return {
      notes: this.db
        .prepare("SELECT * FROM documents ORDER BY path")
        .all()
        .map((r) => ({
          file: r.path,
          text: r.text,
          hash: r.hash,
          note: parseNote(r.text),
        })),
      errors: [],
    };
  }
  transaction(action) {
    const version = this.version,
      errors = this.errors;
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const value = action();
      const result = this.syncUnlocked(this.library(), true);
      const invalid = result.errors[0];
      if (invalid) throw Error(invalid.message);
      this.db.exec("COMMIT");
      return value;
    } catch (error) {
      this.db.exec("ROLLBACK");
      this.version = version;
      this.errors = errors;
      throw error;
    }
  }
  migrate() {
    const release = acquireLock(this.stateDir);
    try {
      if (
        !this.db.prepare("SELECT 1 FROM meta WHERE key='storage_sqlite'").get()
      ) {
        const lib = readLibrary(this.root);
        if (lib.errors.length)
          throw Error(
            `迁移暂停，Markdown 无效：${lib.errors[0].file}：${lib.errors[0].message}`,
          );
        if (new Set(lib.notes.map((x) => x.note.id)).size !== lib.notes.length)
          throw Error("迁移暂停：存在重复知识 ID");
        const archived = [];
        const trashDir = path.join(this.stateDir, "trash");
        if (fs.existsSync(trashDir))
          for (const token of fs.readdirSync(trashDir)) {
            if (!/^[a-f0-9-]{36}$/.test(token)) continue;
            const file = path.join(trashDir, token, "note.md");
            if (!fs.existsSync(file)) continue;
            const metadata = path.join(trashDir, token, "metadata.json");
            const text = fs.readFileSync(file, "utf8"),
              meta = JSON.parse(fs.readFileSync(metadata, "utf8"));
            const note = parseNote(text);
            if (note.id !== meta.id || hash(text) !== meta.hash)
              throw Error(`回收站迁移校验失败：${token}`);
            safePath(this.root, meta.path);
            archived.push({ token, text, meta, file, metadata });
          }
        const snapshots = new Map(lib.notes.map((x) => [x.file, x.text]));
        for (const item of archived) {
          snapshots.set(path.relative(this.root, item.file), item.text);
          snapshots.set(
            path.relative(this.root, item.metadata),
            fs.readFileSync(item.metadata, "utf8"),
          );
        }
        const history = [];
        const maintenance = new AdmZip();
        const collect = (dir, kind) => {
          if (!fs.existsSync(dir)) return;
          for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const file = path.join(dir, entry.name);
            if (entry.isDirectory()) collect(file, kind);
            else if (entry.isFile()) {
              const data = fs.readFileSync(file),
                relative = path.relative(this.root, file);
              snapshots.set(relative, data);
              if (kind === "history") {
                const text = data.toString("utf8"),
                  note = parseNote(text);
                history.push({
                  id: note.id,
                  text,
                  at: fs.statSync(file).mtime.toISOString(),
                });
              } else maintenance.addFile(relative, data);
            }
          }
        };
        collect(path.join(this.stateDir, "upload-backups"), "history");
        collect(path.join(this.stateDir, "batches"), "maintenance");
        const baseline = path.join(this.stateDir, "maintenance.json");
        if (fs.existsSync(baseline)) {
          const data = fs.readFileSync(baseline),
            relative = path.relative(this.root, baseline);
          snapshots.set(relative, data);
          maintenance.addFile(relative, data);
        }
        // A single verified archive replaces loose originals only after database commit.
        if (snapshots.size) {
          const archive = new AdmZip();
          for (const [file, text] of snapshots)
            archive.addFile(file, Buffer.from(text));
          const target = path.join(
            this.stateDir,
            `markdown-migration-${crypto.randomUUID()}.zip`,
          );
          atomicWrite(target, archive.toBuffer());
          const check = new AdmZip(target);
          for (const [file, text] of snapshots)
            if (hash(check.readFile(file)) !== hash(text))
              throw Error("迁移备份校验失败");
          this.db
            .prepare(
              "INSERT OR REPLACE INTO meta(key,value) VALUES('markdown_migration_backup',?)",
            )
            .run(target);
        }
        this.transaction(() => {
          for (const x of history)
            this.db
              .prepare("INSERT INTO document_history(id,text,at) VALUES(?,?,?)")
              .run(x.id, x.text, x.at);
          if (maintenance.getEntries().length)
            this.db
              .prepare("INSERT INTO maintenance_state VALUES('archive',?)")
              .run(maintenance.toBuffer());
          for (const x of lib.notes)
            this.db
              .prepare("INSERT INTO documents VALUES(?,?,?,?)")
              .run(x.note.id, x.file, x.text, x.hash);
          for (const x of archived)
            this.db
              .prepare("INSERT INTO deleted_documents VALUES(?,?,?,?,?,?,?)")
              .run(
                x.token,
                x.meta.id,
                x.meta.path,
                x.text,
                x.meta.hash,
                x.meta.title,
                x.meta.deleted_at,
              );
          for (const [file, text] of snapshots)
            this.db
              .prepare("INSERT INTO migration_files VALUES(?,?)")
              .run(file, hash(text));
          this.db
            .prepare("INSERT INTO meta(key,value) VALUES('storage_sqlite','1')")
            .run();
        });
      }
      // Idempotent cleanup: a crash after commit cannot reimport stale originals.
      for (const item of this.db
        .prepare("SELECT * FROM migration_files")
        .all()) {
        const file = path.resolve(this.root, item.path);
        if (!file.startsWith(path.resolve(this.root) + path.sep))
          throw Error("无效迁移路径");
        if (fs.existsSync(file)) {
          if (hash(fs.readFileSync(file)) !== item.hash)
            throw Error(`迁移后文件发生变化，已保留：${item.path}`);
          fs.unlinkSync(file);
        }
        let parent = path.dirname(file);
        while (
          parent !== path.resolve(this.root) &&
          parent !== path.resolve(this.stateDir) &&
          parent.startsWith(path.resolve(this.root) + path.sep)
        ) {
          try {
            fs.rmdirSync(parent);
          } catch (error) {
            if (error.code !== "ENOENT") {
              if (["ENOTEMPTY", "EEXIST"].includes(error.code)) break;
              throw error;
            }
          }
          parent = path.dirname(parent);
        }
        this.db
          .prepare("DELETE FROM migration_files WHERE path=?")
          .run(item.path);
      }
      const prune = (dir) => {
        if (!fs.existsSync(dir)) return;
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          if (entry.isDirectory() && !entry.name.startsWith("."))
            prune(path.join(dir, entry.name));
        }
        if (
          dir !== this.root &&
          dir !== this.stateDir &&
          fs.readdirSync(dir).length === 0
        )
          fs.rmdirSync(dir);
      };
      prune(this.root);
      for (const name of ["trash", "upload-backups", "batches"])
        prune(path.join(this.stateDir, name));
    } finally {
      release();
    }
  }
  source(id) {
    const row = this.db
      .prepare("SELECT text,hash FROM documents WHERE id=?")
      .get(id);
    if (!row) throw Error("知识点不存在");
    return row;
  }
  put(text, filename) {
    const n = parseNote(text);
    const prior = this.db
      .prepare("SELECT * FROM documents WHERE id=?")
      .get(n.id);
    if (prior)
      this.db
        .prepare("INSERT INTO document_history(id,text,at) VALUES(?,?,?)")
        .run(n.id, prior.text, this.clock().toISOString());
    this.db
      .prepare(
        "INSERT INTO documents VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET text=excluded.text,hash=excluded.hash",
      )
      .run(n.id, prior?.path || filename || `${n.id}.md`, text, hash(text));
    return n;
  }
  import(text, filename, options = {}) {
    const n = parseNote(text),
      release = acquireLock(this.stateDir);
    try {
      return this.transaction(() => {
        const prior = this.db
          .prepare("SELECT * FROM documents WHERE id=?")
          .get(n.id);
        if (options.editId) {
          if (!options.expectedHash || options.expectedHash !== prior?.hash)
            throw Error("知识点已被修改或删除，请保留草稿并重新打开后合并修改");
          if (parseNote(prior.text).created_at !== n.created_at)
            throw Error("编辑时不能修改创建时间");
        }
        if (this.resolve(n.id) !== n.id)
          throw Error(`此 ID 已合并到 ${this.resolve(n.id)}`);
        const known = this.db
          .prepare("SELECT 1 FROM notes WHERE id=?")
          .get(n.id);
        if (options.createOnly && (prior || known))
          throw Error("此 ID 已存在，请使用新的 ID 创建");
        if (prior?.hash === hash(text))
          return { filename, id: n.id, status: "skipped" };
        if (
          (options.rejectConflict && (prior || known)) ||
          (!prior &&
            this.db
              .prepare("SELECT 1 FROM deleted_documents WHERE id=?")
              .get(n.id))
        )
          throw Error("同 ID 内容不同或已在回收站，请手动核对；未覆盖本地内容");
        this.put(text);
        return { filename, id: n.id, status: prior ? "updated" : "created" };
      });
    } finally {
      release();
    }
  }
  trash() {
    return this.db
      .prepare(
        "SELECT token,id,title,deleted_at FROM deleted_documents ORDER BY deleted_at DESC",
      )
      .all();
  }
  archive(row) {
    const token = crypto.randomUUID(),
      n = parseNote(row.text);
    this.db
      .prepare("INSERT INTO deleted_documents VALUES(?,?,?,?,?,?,?)")
      .run(
        token,
        n.id,
        row.path,
        row.text,
        row.hash,
        n.title,
        this.clock().toISOString(),
      );
    this.db.prepare("DELETE FROM documents WHERE id=?").run(n.id);
    return { token, id: n.id, title: n.title };
  }
  deleteNote(id, expectedHash) {
    const release = acquireLock(this.stateDir);
    try {
      return this.transaction(() => {
        const row = this.db
          .prepare("SELECT * FROM documents WHERE id=?")
          .get(id);
        if (!row) throw Error("知识点不存在或已删除");
        if (!expectedHash || row.hash !== expectedHash)
          throw Error("知识点已被修改，请刷新后再删除");
        return this.archive(row);
      });
    } finally {
      release();
    }
  }
  restoreNote(token) {
    const release = acquireLock(this.stateDir);
    try {
      return this.transaction(() => {
        const row = this.db
          .prepare("SELECT * FROM deleted_documents WHERE token=?")
          .get(token);
        if (!row) throw Error("知识点已恢复或归档不存在");
        if (hash(row.text) !== row.hash) throw Error("归档内容校验失败");
        if (
          this.resolve(row.id) !== row.id ||
          this.db
            .prepare("SELECT 1 FROM documents WHERE id=? OR path=?")
            .get(row.id, row.path)
        )
          throw Error("已有同 ID 知识点或路径，不能覆盖");
        this.put(row.text, row.path);
        this.db
          .prepare("DELETE FROM deleted_documents WHERE token=?")
          .run(token);
        return { id: row.id, title: row.title };
      });
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
          x.length &&
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
    try {
      return this.transaction(() => {
        const all = this.library().notes;
        const rows = all.filter((r) =>
          folder
            ? starts(r.note.category, source.category)
            : r.note.id === source.id,
        );
        if (!rows.length) throw Error("来源已不存在，请刷新后重试");
        if (
          !Array.isArray(expected) ||
          expected.length !== rows.length ||
          rows.some(
            (r) =>
              expected.filter((e) => e.id === r.note.id && e.hash === r.hash)
                .length !== 1,
          )
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
          if (all.some((r) => starts(r.note.category, target)))
            throw Error("目标位置已有同名目录");
        }
        if (
          action === "move" &&
          destination.length &&
          !all.some((r) => starts(r.note.category, destination))
        )
          throw Error("目标目录已不存在");
        if (!folder && action === "move" && !destination.length)
          throw Error("请选择一个目录");
        for (const r of rows) {
          if (action === "delete") this.archive({ ...r, path: r.file });
          else {
            const n = { ...r.note, updated_at: this.clock().toISOString() };
            if (folder)
              n.category = [
                ...target,
                ...n.category.slice(source.category.length),
              ];
            else if (action === "move") n.category = destination;
            else n.title = title;
            this.put(serializeNote(n));
          }
        }
        return { count: rows.length, category: target || destination };
      });
    } finally {
      release();
    }
  }
}
