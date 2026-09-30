import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import AdmZip from "adm-zip";
import { DatabaseSync } from "node:sqlite";
import { Store } from "../server/store.mjs";
import {
  acquireLock,
  readLibrary,
  safePath,
  atomicWrite,
} from "../shared/protocol.mjs";

export function isSqliteLibrary(root) {
  const file = path.join(root, ".knowledge", "knowledge.sqlite");
  if (!fs.existsSync(file)) return false;
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    return (
      !!db.prepare("SELECT name FROM sqlite_master WHERE name='meta'").get() &&
      !!db.prepare("SELECT 1 FROM meta WHERE key='storage_sqlite'").get()
    );
  } finally {
    db.close();
  }
}
// Reuse the validated Markdown maintenance engine in a disposable workspace.
// Its documents and journals are committed back as one SQLite transaction.
export function withSqliteLibrary(root, operation, mutate = false) {
  const store = new Store(root, path.join(root, ".knowledge"));
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "knowledge-maintenance-"));
  let release;
  try {
    release = acquireLock(store.stateDir);
    for (const item of store.library().notes)
      atomicWrite(safePath(temp, item.file), item.text);
    const state = store.db
      .prepare("SELECT value FROM maintenance_state WHERE key='archive'")
      .get();
    if (state) {
      const zip = new AdmZip(Buffer.from(state.value));
      for (const entry of zip.getEntries()) {
        if (entry.isDirectory) continue;
        if (
          !entry.entryName.startsWith(".knowledge/") ||
          entry.entryName.split("/").includes("..")
        )
          throw Error("维护归档路径无效");
        const file = path.resolve(temp, entry.entryName);
        if (!file.startsWith(temp + path.sep)) throw Error("维护归档路径无效");
        atomicWrite(file, entry.getData());
      }
    }
    const result = operation(temp);
    if (mutate) {
      const library = readLibrary(temp);
      if (library.errors.length) throw Error(library.errors[0].message);
      const archive = new AdmZip();
      const collect = (dir) => {
        if (!fs.existsSync(dir)) return;
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          const file = path.join(dir, entry.name);
          if (entry.isDirectory()) collect(file);
          else if (entry.isFile())
            archive.addFile(path.relative(temp, file), fs.readFileSync(file));
        }
      };
      collect(path.join(temp, ".knowledge"));
      store.transaction(() => {
        const prior = new Map(store.library().notes.map((x) => [x.note.id, x]));
        const next = new Map(library.notes.map((x) => [x.note.id, x]));
        for (const [id, item] of prior) {
          if (!next.has(id)) store.archive({ ...item, path: item.file });
          else if (next.get(id).file !== item.file)
            store.db
              .prepare("UPDATE documents SET path=? WHERE id=?")
              .run(`__moving__/${id}`, id);
        }
        for (const item of library.notes) {
          if (prior.get(item.note.id)?.hash !== item.hash)
            store.put(item.text, item.file);
          store.db
            .prepare("UPDATE documents SET path=? WHERE id=?")
            .run(item.file, item.note.id);
          store.db
            .prepare("DELETE FROM deleted_documents WHERE id=?")
            .run(item.note.id);
        }
        store.db
          .prepare(
            "INSERT OR REPLACE INTO maintenance_state VALUES('archive',?)",
          )
          .run(archive.toBuffer());
      });
    }
    return result;
  } finally {
    release?.();
    store.close();
    fs.rmSync(temp, { recursive: true, force: true });
  }
}
