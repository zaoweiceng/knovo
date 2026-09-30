import { useEffect, useRef, useState } from "react";

export default function SidebarResizer({
  width,
  onChange,
  side = "left",
}: {
  side?: "left" | "right";
  width: number;
  onChange: (width: number) => void;
}) {
  const origin = useRef({ x: 0, width });
  const direction = side === "right" ? -1 : 1;
  const [dragging, setDragging] = useState(false);
  useEffect(() => {
    document.body.classList.toggle("resizing-sidebar", dragging);
    return () => document.body.classList.remove("resizing-sidebar");
  }, [dragging]);
  const update = (value: number) =>
    onChange(Math.min(420, Math.max(220, Math.round(value))));
  return (
    <div
      className={`sidebar-resizer ${side === "right" ? "right-sidebar-resizer" : ""} ${dragging ? "dragging" : ""}`}
      role="separator"
      aria-label={side === "right" ? "调整关联侧栏宽度" : "调整目录侧栏宽度"}
      aria-orientation="vertical"
      aria-valuemin={220}
      aria-valuemax={420}
      aria-valuenow={width}
      tabIndex={0}
      title="拖动调整宽度 · 双击重置"
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        origin.current = { x: e.clientX, width };
        setDragging(true);
      }}
      onPointerMove={(e) => {
        if (dragging)
          update(
            origin.current.width + direction * (e.clientX - origin.current.x),
          );
      }}
      onPointerUp={(e) => {
        setDragging(false);
        if (e.currentTarget.hasPointerCapture(e.pointerId))
          e.currentTarget.releasePointerCapture(e.pointerId);
      }}
      onLostPointerCapture={() => setDragging(false)}
      onPointerCancel={() => setDragging(false)}
      onDoubleClick={() => onChange(side === "right" ? 245 : 244)}
      onKeyDown={(e) => {
        if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) {
          e.preventDefault();
          update(
            e.key === "Home"
              ? 220
              : e.key === "End"
                ? 420
                : width + direction * (e.key === "ArrowRight" ? 16 : -16),
          );
        }
      }}
    />
  );
}
