import { InputRule, type NodeViewRenderer } from "@tiptap/core";
import CodeBlock from "@tiptap/extension-code-block";
import { InlineMath, BlockMath } from "@tiptap/extension-mathematics";
import katex from "katex";
import { renderMermaid } from "./mermaidRenderer.ts";

function mathView(display: boolean): NodeViewRenderer {
  return ({ node: initial, editor, getPos }) => {
    let node = initial;
    const dom = document.createElement(display ? "div" : "span");
    dom.className = `math-node ${display ? "math-block" : "math-inline"}`;
    dom.contentEditable = "false";
    const rendered = document.createElement("span");
    rendered.className = "math-render";
    rendered.tabIndex = 0;
    rendered.setAttribute("role", "button");
    rendered.setAttribute("aria-label", "编辑公式");
    rendered.title = "点击编辑 LaTeX 公式";
    const controls = document.createElement("span");
    controls.className = "math-controls";
    controls.hidden = true;
    const input = document.createElement("textarea");
    input.setAttribute("aria-label", "LaTeX 公式源码");
    input.rows = display ? 3 : 1;
    const save = document.createElement("button");
    save.type = "button";
    save.textContent = "应用";
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.textContent = "取消";
    controls.append(input, save, cancel);
    dom.append(rendered, controls);
    const render = () => {
      dom.dataset.latex = node.attrs.latex;
      katex.render(node.attrs.latex, rendered, {
        displayMode: display,
        throwOnError: false,
        trust: false,
        strict: "ignore",
      });
    };
    const close = () => {
      controls.hidden = true;
      rendered.hidden = false;
    };
    const open = () => {
      if (!editor.isEditable) return;
      input.value = node.attrs.latex;
      controls.hidden = false;
      rendered.hidden = true;
      input.focus();
    };
    rendered.onclick = open;
    rendered.onkeydown = (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        open();
      }
    };
    cancel.onclick = close;
    save.onclick = () => {
      const pos = getPos();
      if (pos === undefined || !editor.isEditable || !input.value.trim())
        return;
      editor.view.dispatch(
        editor.state.tr.setNodeMarkup(pos, undefined, {
          ...node.attrs,
          latex: input.value.trim(),
        }),
      );
      close();
      editor.commands.focus();
    };
    input.onkeydown = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close();
      }
    };
    render();
    return {
      dom,
      update(next) {
        if (next.type !== node.type) return false;
        node = next;
        render();
        return true;
      },
      stopEvent: (event) =>
        controls.contains(event.target as globalThis.Node) ||
        rendered.contains(event.target as globalThis.Node),
      ignoreMutation: () => true,
    };
  };
}

export const VisualInlineMath = InlineMath.extend({
  markdownTokenizer: {
    name: "inlineMath",
    level: "inline",
    start: (source) => source.indexOf("$"),
    tokenize(source) {
      const match = source.match(/^\$(?!\$)((?:\\.|[^$\\])+?)\$(?!\$)/);
      if (match)
        return { type: "inlineMath", raw: match[0], latex: match[1].trim() };
    },
  },
  addInputRules() {
    return [
      new InputRule({
        find: /(?<![\\$])\$(?!\$)((?:\\.|[^$\\\n])+?)\$$/,
        handler: ({ state, range, match }) => {
          state.tr.replaceWith(
            range.from,
            range.to,
            this.type.create({ latex: match[1].trim() }),
          );
        },
      }),
    ];
  },
  addNodeView() {
    return mathView(false);
  },
});
export const VisualBlockMath = BlockMath.extend({
  markdownTokenizer: {
    name: "blockMath",
    level: "block",
    start: (source) => source.search(/^\$\$/m),
    tokenize(source) {
      const match = source.match(
        /^\$\$((?:\\.|[^$\\])+?)\$\$(?:[ \t]*(?:\n|$))?/,
      );
      if (match)
        return { type: "blockMath", raw: match[0], latex: match[1].trim() };
    },
  },
  addNodeView() {
    return mathView(true);
  },
});

// Keep the original codeBlock schema/Markdown serializer so ordinary code and
// Mermaid source remain editable and survive mode changes and exports.
export const VisualCodeBlock = CodeBlock.extend({
  addNodeView() {
    return ({ node: initial }) => {
      let node = initial;
      const dom = document.createElement("div");
      const pre = document.createElement("pre");
      const contentDOM = document.createElement("code");
      pre.append(contentDOM);
      const preview = document.createElement("div");
      preview.contentEditable = "false";
      dom.append(pre, preview);
      let cancelRender: (() => void) | undefined;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const render = () => {
        clearTimeout(timer);
        cancelRender?.();
        const diagram = node.attrs.language?.split(/\s+/)[0] === "mermaid";
        preview.hidden = !diagram;
        dom.className = diagram
          ? "visual-code-block visual-mermaid"
          : "visual-code-block";
        contentDOM.className = node.attrs.language
          ? `language-${node.attrs.language}`
          : "";
        if (diagram) {
          const source = node.textContent;
          timer = setTimeout(() => {
            cancelRender = renderMermaid(preview, source);
          }, 180);
        }
      };
      render();
      return {
        dom,
        contentDOM,
        update(next) {
          if (next.type !== node.type) return false;
          if (
            next.textContent !== node.textContent ||
            next.attrs.language !== node.attrs.language
          ) {
            node = next;
            render();
          } else node = next;
          return true;
        },
        ignoreMutation: (mutation) =>
          mutation.type !== "selection" &&
          !contentDOM.contains(mutation.target),
        stopEvent: (event) => preview.contains(event.target as globalThis.Node),
        destroy() {
          clearTimeout(timer);
          cancelRender?.();
        },
      };
    };
  },
});
