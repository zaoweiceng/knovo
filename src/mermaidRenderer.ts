let library: Promise<typeof import("mermaid")> | undefined;
let nextId = 0;

function loadMermaid() {
  library ??= import("mermaid")
    .then((module) => {
      module.default.initialize({
        startOnLoad: false,
        securityLevel: "strict",
        suppressErrorRendering: true,
        theme: "neutral",
        htmlLabels: false,
        flowchart: { htmlLabels: false },
        secure: [
          "secure",
          "securityLevel",
          "startOnLoad",
          "maxTextSize",
          "maxEdges",
          "suppressErrorRendering",
          "htmlLabels",
          "flowchart",
        ],
      });
      return module;
    })
    .catch((error) => {
      library = undefined;
      throw error;
    });
  return library;
}

// Each render owns its result: stale async work must never replace newer input.
export function renderMermaid(target: HTMLElement, source: string) {
  let active = true;
  target.className = "mermaid-diagram";
  target.setAttribute("role", "img");
  target.setAttribute("aria-label", "Mermaid 图表");
  target.textContent = "正在绘制图表…";
  void (async () => {
    try {
      const { default: mermaid } = await loadMermaid();
      if (!active) return;
      const { svg } = await mermaid.render(
        `knowledge-mermaid-${++nextId}`,
        source,
      );
      if (active) target.innerHTML = svg;
    } catch {
      if (!active) return;
      target.classList.add("diagram-error");
      target.setAttribute("role", "status");
      target.removeAttribute("aria-label");
      const message = document.createElement("p");
      message.textContent = "图表暂时无法渲染，请检查 Mermaid 语法。";
      const pre = document.createElement("pre");
      const code = document.createElement("code");
      code.textContent = source;
      pre.append(code);
      target.replaceChildren(message, pre);
    }
  })();
  return () => {
    active = false;
  };
}
