import { useEffect, useRef } from "react";
import { renderMermaid } from "./mermaidRenderer";

export default function MermaidDiagram({ source }: { source: string }) {
  const target = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (target.current) return renderMermaid(target.current, source);
  }, [source]);
  return <div ref={target} className="mermaid-diagram" />;
}
