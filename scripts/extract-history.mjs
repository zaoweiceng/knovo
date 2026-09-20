#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import AdmZip from "adm-zip";
import { fileURLToPath } from "node:url";
function textContent(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content))
    return content
      .map((c) =>
        typeof c === "string" ? c : typeof c?.text === "string" ? c.text : "",
      )
      .filter(Boolean)
      .join("\n");
  if (content?.parts) return textContent(content.parts);
  return "";
}
export function chatgpt(data) {
  const conversations = Array.isArray(data) ? data : [data];
  return conversations.map((c) => {
    if (!c.mapping) throw Error("无法识别 ChatGPT 格式：缺少 mapping");
    let current = c.current_node;
    if (!current)
      throw Error(`会话 ${c.id || ""} 缺少 current_node，不能安全选择分支`);
    const chain = [],
      seen = new Set();
    while (current && c.mapping[current] && !seen.has(current)) {
      seen.add(current);
      chain.unshift(c.mapping[current]);
      current = c.mapping[current].parent;
    }
    if (!chain.length || current)
      throw Error("ChatGPT 分支链不完整或存在循环，无法可靠提取");
    const skippedAttachments = chain.filter(
      (n) =>
        n.message?.metadata?.attachments?.length ||
        n.message?.content?.parts?.some((p) => typeof p !== "string"),
    ).length;
    const messages = chain
      .map((n) => n.message)
      .filter(
        (m) =>
          m &&
          ["user", "assistant"].includes(m.author?.role) &&
          !m.metadata?.is_visually_hidden_from_conversation &&
          !["thoughts", "reasoning"].includes(m.content?.content_type) &&
          (!m.channel || m.channel === "final") &&
          (!m.recipient || m.recipient === "all"),
      )
      .map((m) => ({
        id: m.id,
        role: m.author.role,
        at: m.create_time ? new Date(m.create_time * 1000).toISOString() : null,
        text: textContent(m.content),
      }))
      .filter((m) => m.text);
    return {
      id: c.id || c.conversation_id,
      title: c.title || "未命名对话",
      warnings: skippedAttachments
        ? [`${skippedAttachments} 条消息含有未处理的附件/非文字内容`]
        : [],
      messages,
    };
  });
}
export function codex(text) {
  const lines = text
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l));
  const meta = lines.find((l) => l.type === "session_meta")?.payload;
  const messages = [];
  const seen = new Set();
  for (const line of lines) {
    const p = line.payload;
    if (
      line.type !== "response_item" ||
      p?.type !== "message" ||
      !["user", "assistant"].includes(p.role)
    )
      continue;
    if (p.channel && p.channel !== "final") continue;
    if (p.role === "assistant" && p.phase && p.phase !== "final_answer")
      continue;
    const content = textContent(p.content);
    if (!content) continue;
    const key = p.id || JSON.stringify([p.role, line.timestamp, content]);
    if (seen.has(key)) continue;
    seen.add(key);
    messages.push({
      id: p.id || null,
      role: p.role,
      at: line.timestamp || null,
      text: content,
    });
  }
  if (!messages.length)
    throw Error("没有可读取的用户/助手可见文字，可能是不支持的 Codex 格式");
  return [
    { id: meta?.id || meta?.session_id || null, title: "Codex 对话", messages },
  ];
}
export function extract(file) {
  const ext = path.extname(file).toLowerCase();
  if (ext === ".zip") {
    const zip = new AdmZip(file),
      entry = zip
        .getEntries()
        .find((e) => /(^|\/)conversations\.json$/.test(e.entryName));
    if (!entry) throw Error("ZIP 中没有 conversations.json");
    if (entry.header.size > 100 * 1024 * 1024)
      throw Error("conversations.json 超过 100 MB，请先分批");
    return chatgpt(JSON.parse(entry.getData().toString("utf8")));
  }
  if (ext === ".json")
    return chatgpt(JSON.parse(fs.readFileSync(file, "utf8")));
  if (ext === ".jsonl") return codex(fs.readFileSync(file, "utf8"));
  if ([".md", ".txt"].includes(ext))
    return [
      {
        id: null,
        title: path.basename(file),
        messages: [
          { role: "user", at: null, text: fs.readFileSync(file, "utf8") },
        ],
      },
    ];
  throw Error("支持 .zip/.json/.jsonl/.md/.txt");
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    const input = process.argv[2];
    if (!input)
      throw Error(
        "用法：node extract-history.mjs <文件> [--list | --id 会话ID]",
      );
    const data = extract(input);
    const mode = process.argv[3];
    if (mode === "--list")
      console.log(
        JSON.stringify(
          data.map((c) => ({
            id: c.id,
            title: c.title,
            messages: c.messages.length,
            first: c.messages[0]?.at,
            last: c.messages.at(-1)?.at,
          })),
          null,
          2,
        ),
      );
    else if (mode === "--id") {
      const selected = data.filter((c) => c.id === process.argv[4]);
      if (!selected.length) throw Error("未找到指定会话");
      console.log(JSON.stringify(selected, null, 2));
    } else console.log(JSON.stringify(data, null, 2));
  } catch (e) {
    console.error(e.message);
    process.exitCode = 1;
  }
}
