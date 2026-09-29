export function formatMarkdown(
  text: string,
  start: number,
  end: number,
  action: string,
) {
  const selected = text.slice(start, end);
  let value = "",
    from = start,
    to = end;
  if (["bold", "italic", "strike", "code"].includes(action)) {
    const mark = { bold: "**", italic: "*", strike: "~~", code: "`" }[action]!;
    value =
      selected.startsWith(mark) &&
      selected.endsWith(mark) &&
      selected.length >= mark.length * 2
        ? selected.slice(mark.length, -mark.length)
        : mark + (selected || "文字") + mark;
  } else if (action === "table") {
    value = "\n| 列一 | 列二 |\n| --- | --- |\n| 内容 | 内容 |\n";
  } else if (action === "codeblock") {
    value = "\n```\n" + (selected || "代码") + "\n```\n";
  } else {
    from = text.lastIndexOf("\n", start - 1) + 1;
    const lineEnd = text.indexOf(
      "\n",
      end > start && text[end - 1] === "\n" ? end - 1 : end,
    );
    to = lineEnd < 0 ? text.length : lineEnd;
    value = text
      .slice(from, to)
      .split("\n")
      .map((line, i) => {
        const clean = line.replace(
          /^(?:#{1,6}\s+|>\s*|[-*+]\s+(?:\[[ xX]\]\s+)?|\d+\.\s+)/,
          "",
        );
        const prefix =
          action === "paragraph"
            ? ""
            : /^h[1-6]$/.test(action)
              ? "#".repeat(Number(action[1])) + " "
              : action === "todo"
                ? "- [ ] "
                : action === "ordered"
                  ? `${i + 1}. `
                  : action === "quote"
                    ? "> "
                    : "- ";
        return prefix + clean;
      })
      .join("\n");
  }
  return {
    text: text.slice(0, from) + value + text.slice(to),
    start: from,
    end: from + value.length,
  };
}
