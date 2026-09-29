import { hash, parseNote, serializeNote } from "./protocol.mjs";

// The envelope is deliberately JSON so Markdown fences and separators in bodies are lossless.
export function parseKnowledgeText(input) {
  if (typeof input !== "string" || Buffer.byteLength(input) > 20 * 1024 * 1024)
    throw Error("粘贴内容最多 20 MB");
  let text = input.trim();
  const fence = text.match(
    /^(`{3,}|~{3,})(?:json|markdown|md)?\s*\n([\s\S]*)\n\1\s*$/i,
  );
  if (fence) text = fence[2].trim();
  if (text.startsWith("---")) {
    const note = parseNote(text);
    return [{ note, text }];
  }
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    throw Error(
      "无法识别格式，请粘贴 AI 返回的完整 JSON 文本块（可包含外层代码围栏），或单篇含文件头的 Markdown",
    );
  }
  if (
    payload?.format !== "zhixu-knowledge-v1" ||
    !Array.isArray(payload.notes) ||
    !payload.notes.length ||
    payload.notes.length > 100
  )
    throw Error("需要 format: zhixu-knowledge-v1 和 1–100 篇 notes");
  const keys = new Map();
  const normalized = payload.notes.map((n, i) => {
    try {
      if (
        !n ||
        typeof n.key !== "string" ||
        !/^[a-zA-Z0-9_-]{1,80}$/.test(n.key) ||
        keys.has(n.key)
      )
        throw Error("key 必须为批次内唯一的字母、数字、下划线或短横线");
      const note = parseNote(
        serializeNote({
          schema_version: 1,
          id: "pending",
          title: n.title,
          summary: n.summary,
          category: n.category,
          tags: n.tags || [],
          learning_events: n.learning_events,
          status: n.status || "learning",
          created_at: "2000-01-01T00:00:00.000Z",
          updated_at: "2000-01-01T00:00:00.000Z",
          prerequisites: [],
          related: [],
          aliases: [],
          merged_from: [],
          body: typeof n.body === "string" ? n.body : "",
        }),
      );
      for (const field of ["prerequisites", "related"])
        if (
          n[field] !== undefined &&
          (!Array.isArray(n[field]) ||
            n[field].some((x) => typeof x !== "string"))
        )
          throw Error(`${field} 必须为 key 数组`);
      const identity = {
        title: note.title,
        summary: note.summary,
        category: note.category,
        tags: note.tags,
        learning_events: note.learning_events,
        status: note.status,
        body: note.body,
      };
      note.id = "ai-" + hash(JSON.stringify(identity)).slice(0, 32);
      keys.set(n.key, note.id);
      return note;
    } catch (e) {
      throw Error(
        `第 ${i + 1} 篇${n?.title ? "「" + n.title + "」" : ""}：${e.message}`,
      );
    }
  });
  if (new Set(normalized.map((n) => n.id)).size !== normalized.length)
    throw Error("文本块中存在重复知识点，请合并重复项");
  return normalized.map((note, i) => {
    const original = payload.notes[i];
    for (const field of ["prerequisites", "related"])
      note[field] = (original[field] || []).map((key) => {
        if (!keys.has(key))
          throw Error(`第 ${i + 1} 篇的 ${field} 引用了不存在的 key：${key}`);
        return keys.get(key);
      });
    return { note: parseNote(serializeNote(note)), generated: true };
  });
}
export function importKnowledgeText(store, input) {
  const items = parseKnowledgeText(input);
  return items.map(({ note, text, generated }) => {
    try {
      if (generated) {
        const existing = store.active().find((n) => n.id === note.id);
        const now = store.clock().toISOString();
        note.created_at = existing?.created_at || now;
        note.updated_at = existing?.updated_at || now;
        text = serializeNote(note);
      }
      return {
        ...store.import(text, `${note.id}.md`, { rejectConflict: true }),
        title: note.title,
      };
    } catch (e) {
      return {
        id: note.id,
        title: note.title,
        filename: `${note.id}.md`,
        status: "error",
        message: e.message,
      };
    }
  });
}
