import { hash, acquireLock } from "../shared/protocol.mjs";
export function imageType(data) {
  if (!Buffer.isBuffer(data) || !data.length || data.length > 10 * 1024 * 1024)
    throw Error("图片限 10 MB");
  if (
    data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  )
    return "image/png";
  if (data[0] === 255 && data[1] === 216 && data[2] === 255)
    return "image/jpeg";
  if (/^GIF8[79]a$/.test(data.subarray(0, 6).toString())) return "image/gif";
  if (
    data.subarray(0, 4).toString() === "RIFF" &&
    data.subarray(8, 12).toString() === "WEBP"
  )
    return "image/webp";
  throw Error("仅支持 PNG、JPEG、GIF、WebP 图片");
}
export function putImage(store, data) {
  const mime = imageType(data),
    id = hash(data),
    release = acquireLock(store.stateDir);
  try {
    store.assetsDb
      .prepare("INSERT OR IGNORE INTO assets(id,mime,data) VALUES(?,?,?)")
      .run(id, mime, data);
  } finally {
    release();
  }
  return { id, mime, url: `/api/assets/${id}` };
}
export function referencedImages(text) {
  return [
    ...new Set(
      [...text.matchAll(/\/api\/assets\/([a-f0-9]{64})(?![a-f0-9])/g)].map(
        (m) => m[1],
      ),
    ),
  ];
}
