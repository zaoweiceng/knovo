import YAML from "yaml";
const localDay = (date: Date) => date.toLocaleDateString("sv-SE");
export type EditorMeta = {
  [key: string]: unknown;
  title: string;
  summary: string;
  category: string[];
  tags: string[];
  knowledge_keywords: string[];
  dependency_keywords: string[];
  status: string;
  learning_events: { date: string | null; summary: string }[];
};
export function documentId() {
  // getRandomValues is available on LAN HTTP; randomUUID requires a secure context.
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 15) | 64;
  bytes[8] = (bytes[8] & 63) | 128;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join(
    "",
  );
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
export function newDocument(category: string[]) {
  const now = new Date().toISOString();
  const meta: EditorMeta = {
    schema_version: 1,
    id: documentId(),
    title: "",
    summary: "",
    category: category.length ? category : ["未分类"],
    tags: [],
    knowledge_keywords: [],
    dependency_keywords: [],
    learning_events: [{ date: localDay(new Date()), summary: "首次学习" }],
    status: "learning",
    created_at: now,
    updated_at: now,
    aliases: [],
    merged_from: [],
  };
  return { meta, body: "" };
}
export function splitDocument(text: string): {
  meta: EditorMeta;
  body: string;
} {
  const match = text.match(
    /^\uFEFF?---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)([\s\S]*)$/,
  );
  if (!match) throw Error("无法读取知识点元信息");
  return {
    meta: YAML.parse(match[1], { maxAliasCount: 20 }) as EditorMeta,
    body: match[2].replace(/^\r?\n/, ""),
  };
}
export function joinDocument(meta: EditorMeta, body: string) {
  return `---\n${YAML.stringify(meta)}---\n\n${body.trim()}\n`;
}
