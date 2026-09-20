import fs from "node:fs";
import path from "node:path";
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
  }
  close() {
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
  syncUnlocked() {
    const { notes, errors } = readLibrary(this.root);
    const groups = new Map();
    const present = new Set(
      files(this.root).map((f) => path.relative(this.root, f)),
    );
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
    this.db.exec("BEGIN IMMEDIATE");
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
      this.db.exec("COMMIT");
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
    const all = this.active();
    const ids = new Set(all.map((n) => n.id));
    for (const n of all)
      for (const target of [...n.prerequisites, ...n.related])
        if (!ids.has(this.resolve(target)))
          errors.push({ file: n.path, message: `关联目标不存在：${target}` });
    if (changed || JSON.stringify(errors) !== JSON.stringify(this.errors))
      this.version++;
    this.errors = errors;
    return { count: all.length, errors, version: this.version };
  }
  import(text, filename) {
    const n = parseNote(text);
    const release = acquireLock(this.stateDir);
    try {
      const lib = readLibrary(this.root);
      const same = lib.notes.filter((x) => x.note.id === n.id);
      if (same.length > 1) throw Error("目录中已有重复 ID，请先修复");
      if (this.resolve(n.id) !== n.id)
        throw Error(`此 ID 已合并到 ${this.resolve(n.id)}`);
      if (same[0]?.hash === hash(text))
        return { filename, status: "skipped", id: n.id };
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
          tags = n.tags.join(" ").toLocaleLowerCase(),
          summary = n.summary.toLocaleLowerCase(),
          body = n.body.toLocaleLowerCase();
        const fields = [title, tags, summary, body];
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
    const related = new Set(n.related);
    for (const x of all)
      if (x.related.some((t) => this.resolve(t) === n.id)) related.add(x.id);
    return {
      ...n,
      relations: {
        prerequisites: n.prerequisites.map(brief),
        related: [...related].map(brief),
        dependents: all
          .filter((x) => x.prerequisites.some((t) => this.resolve(t) === n.id))
          .map((x) => brief(x.id)),
      },
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
    for (const n of all) {
      if (type !== "related")
        for (const x of n.prerequisites)
          push(this.resolve(x), n.id, "prerequisite");
      if (type !== "prerequisite")
        for (const x of n.related) push(n.id, this.resolve(x), "related");
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
