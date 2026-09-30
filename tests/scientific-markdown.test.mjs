import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ReactMarkdown from "react-markdown";
import { MarkdownManager } from "@tiptap/markdown";
import { visualExtensions } from "../src/visualExtensions.ts";
import { serializeVisualMarkdown } from "../src/visualMarkdown.ts";
import { markdownPlugins } from "../src/markdownPlugins.ts";
import { knowledgePrompt } from "../src/knowledgePrompt.ts";
import { formatMarkdown } from "../src/markdownActions.ts";
import { parseKnowledgeText } from "../shared/text-import.mjs";
import { parseNote, serializeNote } from "../shared/protocol.mjs";

const manager = new MarkdownManager({ extensions: visualExtensions });
const render = (body) =>
  renderToStaticMarkup(createElement(ReactMarkdown, markdownPlugins, body));
const nodes = (doc) => [doc, ...(doc.content || []).flatMap(nodes)];

test("reader renders inline/block math, keeps code literal and survives invalid LaTeX", () => {
  const html = render(String.raw`行内 $E=mc^2$。

$$
\frac{a}{b} + P(token_{t+1} \mid tokens)
$$

${"`$literal$`"}

~~~js
const formula = "$literal$";
~~~

$\frac{a}{$

结尾仍可阅读。`);
  assert.match(html, /class="katex"/);
  assert.match(html, /class="katex-display"/);
  assert.match(html, /<code>\$literal\$<\/code>/);
  assert.match(html, /language-js/);
  assert.match(html, /katex-error/);
  assert.match(html, /结尾仍可阅读/);
});

test("visual math and Mermaid round-trip without changing formulas, code or literal dollars", () => {
  const body = String.raw`行内 $\text{cost: \$5} + \frac{a_1}{b^2}$；价格 \$5 与 \$10。

$$
\begin{aligned}
LLM &: P(token_{t+1} \mid tokens) \\
CLM &: \operatorname{score}(state, action)
\end{aligned}
$$

$$
\text{cost: \$5}
$$

${"`$literal$`"}

~~~mermaid
flowchart TD
  A["问题"] --> B{"理解了吗？"}
  B -->|是| C["应用"]
  B -->|否| A
~~~

~~~js
const price = "$5";
~~~`;
  const parsed = manager.parse(body);
  const all = nodes(parsed);
  assert.equal(all.filter((node) => node.type === "inlineMath").length, 1);
  assert.equal(all.filter((node) => node.type === "blockMath").length, 2);
  const result = serializeVisualMarkdown(manager, parsed);
  assert.deepEqual(manager.parse(result), parsed);
  assert.match(result, /\\\$5 与 \\\$10/);
  assert.match(result, /```mermaid/);
  const diagram = all.find((node) => node.attrs?.language === "mermaid");
  assert.equal(
    nodes(manager.parse(result)).find(
      (node) => node.attrs?.language === "mermaid",
    ).content[0].text,
    diagram.content[0].text,
  );
});

test("rendered formulas cannot enable HTML or javascript links", () => {
  const html = render(
    String.raw`$\href{javascript:alert(1)}{click}$ $\htmlClass{evil}{x}$`,
  );
  assert.doesNotMatch(html, /href="javascript:|class="evil"/);
});

test("AI prompt example is valid JSON and survives import and visual Markdown", () => {
  const example = JSON.parse(knowledgePrompt.match(/^\{"body".*$/m)[0]);
  assert.match(example.body, /\\mid tokens/);
  assert.match(example.body, /```mermaid\nflowchart TD/);
  const [imported] = parseKnowledgeText(
    JSON.stringify({
      format: "zhixu-knowledge-v1",
      notes: [
        {
          key: "scientific",
          title: "公式与流程图",
          summary: "表达数学关系与学习流程",
          category: ["测试"],
          tags: [],
          knowledge_keywords: [],
          dependency_keywords: [],
          learning_events: [{ date: null, summary: "理解公式与流程" }],
          status: "ready",
          body: example.body,
        },
      ],
    }),
  );
  assert.equal(imported.note.body, example.body);
  assert.equal(parseNote(serializeNote(imported.note)).body, example.body);
  const parsed = manager.parse(example.body);
  assert.equal(
    nodes(parsed).filter((node) => node.type === "blockMath").length,
    1,
  );
  assert.deepEqual(
    manager.parse(serializeVisualMarkdown(manager, parsed)),
    parsed,
  );
});

test("source toolbar inserts math/diagrams while retaining surrounding content", () => {
  assert.equal(
    formatMarkdown("before x after", 7, 8, "inlineMath").text,
    "before $x$ after",
  );
  assert.match(
    formatMarkdown("", 0, 0, "blockMath").text,
    /\n\$\$\n.*\\mid.*\n\$\$\n/,
  );
  const body = formatMarkdown("", 0, 0, "mermaid").text;
  assert.equal(
    nodes(manager.parse(body)).find((node) => node.type === "codeBlock").attrs
      .language,
    "mermaid",
  );
});
