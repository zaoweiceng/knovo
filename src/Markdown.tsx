import ReactMarkdown, { type Components } from "react-markdown";
import { markdownPlugins } from "./markdownPlugins";
import { Children, isValidElement, memo } from "react";
import KnowledgeImage from "./KnowledgeImage";
import MermaidDiagram from "./MermaidDiagram";

// React uses these functions as component types. Recreating them during a
// parent refresh unmounts every diagram/image even when its content is unchanged.
const markdownComponents: Components = {
  a: ({ children, href }) => (
    <a href={href} target="_blank" rel="noreferrer">
      {children}
    </a>
  ),
  img: ({ alt, src }) => <KnowledgeImage src={src} alt={alt} />,
  pre: ({ children }) => {
    const child = Children.toArray(children)[0];
    if (
      isValidElement<{ className?: string; children?: unknown }>(child) &&
      child.props.className?.split(/\s+/).includes("language-mermaid")
    ) {
      return (
        <MermaidDiagram
          source={String(child.props.children ?? "").replace(/\n$/, "")}
        />
      );
    }
    return <pre>{children}</pre>;
  },
};

function Markdown({ body }: { body: string }) {
  return (
    <div className="markdown">
      <ReactMarkdown {...markdownPlugins} components={markdownComponents}>
        {body}
      </ReactMarkdown>
    </div>
  );
}

export default memo(Markdown);
