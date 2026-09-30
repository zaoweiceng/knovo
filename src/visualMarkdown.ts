import type { JSONContent } from "@tiptap/core";
import type { MarkdownManager } from "@tiptap/markdown";

// Tiptap escapes standard Markdown punctuation, but not the custom math
// delimiter. Protect literal dollars in text while leaving code/math untouched.
export function serializeVisualMarkdown(
  manager: MarkdownManager,
  doc: JSONContent,
) {
  let marker = "KNOWLEDGELITERALDOLLAR";
  const original = JSON.stringify(doc);
  while (original.includes(marker)) marker += "X";
  const protect = (node: JSONContent): JSONContent => {
    if (
      node.type === "codeBlock" ||
      node.marks?.some((mark) => mark.type === "code")
    )
      return node;
    return {
      ...node,
      ...(node.text === undefined
        ? {}
        : { text: node.text.replaceAll("$", marker) }),
      ...(node.content ? { content: node.content.map(protect) } : {}),
    };
  };
  return manager.serialize(protect(doc)).replaceAll(marker, "\\$");
}
