import { imageType, referencedImages } from "./assets.mjs";
import AdmZip from "adm-zip";
import {
  acquireLock,
  readLibrary,
  parseNote,
  validDay,
  hash,
} from "../shared/protocol.mjs";

export function exportBundle(store, { from, to, basis = "learning" }) {
  if (!validDay(from) || !validDay(to) || from > to)
    throw Error("请选择有效的起止日期");
  if (!["learning", "created", "updated"].includes(basis))
    throw Error("日期类型无效");
  const release = acquireLock(store.stateDir);
  try {
    const lib = readLibrary(store.root);
    if (lib.errors.length) throw Error("知识目录存在无效文件，请先修复后导出");
    const ids = new Set();
    for (const item of lib.notes) {
      if (ids.has(item.note.id)) throw Error("知识目录存在重复 ID，请先修复");
      ids.add(item.note.id);
    }
    const selected = lib.notes.filter(({ note }) => {
      const dates =
        basis === "learning"
          ? note.learning_events.map((e) => e.date)
          : [new Date(note[basis + "_at"]).toLocaleDateString("sv-SE")];
      return dates.some((d) => d && d >= from && d <= to);
    });
    if (!selected.length) throw Error("此日期范围内没有知识点");
    if (selected.length > 1000)
      throw Error("一次最多导出 1000 个知识点，请缩小日期范围");
    if (
      selected.reduce((n, x) => n + Buffer.byteLength(x.text), 0) >
      20 * 1024 * 1024
    )
      throw Error("内容超过 20 MB，请缩小日期范围");
    const zip = new AdmZip();
    const manifest = {
      format: "knowledge-bundle",
      version: 2,
      assets: [],
      exported_at: new Date().toISOString(),
      from,
      to,
      basis,
      notes: selected.map((x) => ({
        id: x.note.id,
        file: `notes/${x.note.id}.md`,
        hash: x.hash,
      })),
    };
    let total = selected.reduce((n, x) => n + Buffer.byteLength(x.text), 0);
    for (const id of new Set(
      selected.flatMap((x) => referencedImages(x.note.body)),
    )) {
      const asset = store.assetsDb
        .prepare("SELECT mime,data FROM assets WHERE id=?")
        .get(id);
      if (!asset) throw Error(`无法导出：缺少图片 ${id}`);
      total += asset.data.length;
      if (total > 95 * 1024 * 1024)
        throw Error("含图片内容超过 95 MB，请缩小日期范围");
      manifest.assets.push({ id, mime: asset.mime, file: `assets/${id}` });
      zip.addFile(`assets/${id}`, Buffer.from(asset.data));
    }
    zip.addFile(
      "manifest.json",
      Buffer.from(JSON.stringify(manifest, null, 2)),
    );
    for (const item of selected)
      zip.addFile(`notes/${item.note.id}.md`, Buffer.from(item.text));
    return zip.toBuffer();
  } finally {
    release();
  }
}

export function readBundle(buffer) {
  if (buffer.length > 100 * 1024 * 1024) throw Error("迁移包不得超过 100 MB");
  const zip = new AdmZip(buffer);
  const entries = zip.getEntries();
  if (
    entries.length > 10001 ||
    entries.reduce((n, e) => n + e.header.size, 0) > 100 * 1024 * 1024
  )
    throw Error("迁移包解压后过大");
  if (new Set(entries.map((e) => e.entryName)).size !== entries.length)
    throw Error("迁移包存在重复文件名");
  const manifestEntry = zip.getEntry("manifest.json");
  if (!manifestEntry || manifestEntry.header.size > 1024 * 1024)
    throw Error("缺少有效迁移清单");
  const manifest = JSON.parse(manifestEntry.getData().toString("utf8"));
  if (
    manifest.format !== "knowledge-bundle" ||
    ![1, 2].includes(manifest.version) ||
    !Array.isArray(manifest.notes) ||
    !manifest.notes.length ||
    manifest.notes.length > 1000
  )
    throw Error("不支持的迁移包格式");
  const seen = new Set();
  const files = manifest.notes.map((item) => {
    if (
      !item ||
      typeof item.id !== "string" ||
      !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(item.id) ||
      item.file !== `notes/${item.id}.md` ||
      seen.has(item.id)
    )
      throw Error("迁移清单存在无效或重复 ID");
    seen.add(item.id);
    const entry = zip.getEntry(item.file);
    if (!entry || entry.header.size > 2 * 1024 * 1024)
      throw Error(`文件缺失或过大：${item.file}`);
    const text = entry.getData().toString("utf8");
    if (hash(text) !== item.hash || parseNote(text).id !== item.id)
      throw Error(`内容校验失败：${item.file}`);
    return { name: item.file, text };
  });
  const assets = manifest.version === 2 ? manifest.assets : [];
  if (!Array.isArray(assets) || assets.length > 9000)
    throw Error("图片清单无效");
  const imageIds = new Set();
  files.assets = assets.map((a) => {
    if (
      !a ||
      !/^[a-f0-9]{64}$/.test(a.id) ||
      a.file !== `assets/${a.id}` ||
      imageIds.has(a.id)
    )
      throw Error("图片清单无效或重复");
    const entry = zip.getEntry(a.file);
    if (!entry || entry.header.size > 10 * 1024 * 1024)
      throw Error("图片缺失或过大");
    const data = entry.getData();
    if (hash(data) !== a.id || imageType(data) !== a.mime)
      throw Error("图片内容校验失败");
    imageIds.add(a.id);
    return { data, id: a.id };
  });
  if (manifest.version === 2)
    for (const f of files)
      for (const id of referencedImages(parseNote(f.text).body))
        if (!imageIds.has(id)) throw Error(`迁移包缺少图片 ${id}`);
  return files;
}
