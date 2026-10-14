import { useLayoutEffect, useRef, type ReactNode } from "react";

type Snapshot = {
  x: number;
  y: number;
  width: number;
  height: number;
  clone: HTMLElement;
};
// FLIP keyed nodes across frames so queue/stack items visibly move, enter and leave.
// Frames remain declarative data; no script or expression from JSON is evaluated.
export default function WidgetTransition({
  children,
  version,
}: {
  children: ReactNode;
  version: string | number;
}) {
  const host = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const overlay = useRef<HTMLDivElement>(null);
  const previous = useRef(new Map<string, Snapshot>());
  useLayoutEffect(() => {
    const container = host.current!,
      body = content.current!,
      layer = overlay.current!;
    const bounds = container.getBoundingClientRect();
    const next = new Map<string, Snapshot>();
    const animations: Animation[] = [];
    const ghosts: HTMLElement[] = [];
    const reduced = window.matchMedia?.(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    const animate = (element: HTMLElement, frames: Keyframe[]) => {
      if (reduced || !element.animate) return;
      const animation = element.animate(frames, {
        duration: 320,
        easing: "ease-out",
      });
      animations.push(animation);
    };
    for (const element of body.querySelectorAll<HTMLElement>(
      "[data-widget-key]",
    )) {
      const key = element.dataset.widgetKey!;
      const rect = element.getBoundingClientRect();
      const snapshot = {
        x: rect.left - bounds.left,
        y: rect.top - bounds.top,
        width: rect.width,
        height: rect.height,
        clone: element.cloneNode(true) as HTMLElement,
      };
      next.set(key, snapshot);
      const old = previous.current.get(key);
      if (old) {
        if (old.x !== snapshot.x || old.y !== snapshot.y)
          animate(element, [
            {
              transform: `translate(${old.x - snapshot.x}px, ${old.y - snapshot.y}px)`,
            },
            { transform: "translate(0, 0)" },
          ]);
        else if (old.clone.outerHTML !== snapshot.clone.outerHTML)
          animate(element, [{ opacity: 0.35 }, { opacity: 1 }]);
      } else
        animate(element, [
          { opacity: 0, transform: "translateY(-12px) scale(.94)" },
          { opacity: 1, transform: "translateY(0) scale(1)" },
        ]);
    }
    for (const [key, old] of previous.current) {
      if (next.has(key) || reduced || !body.animate) continue;
      const ghost = old.clone;
      ghost.style.cssText += `;position:absolute;left:${old.x}px;top:${old.y}px;width:${old.width}px;height:${old.height}px;margin:0;pointer-events:none;`;
      layer.append(ghost);
      ghosts.push(ghost);
      animate(ghost, [
        { opacity: 1, transform: "translateY(0)" },
        { opacity: 0, transform: "translateY(-18px)" },
      ]);
      animations[animations.length - 1].onfinish = () => ghost.remove();
    }
    if (!next.size)
      animate(body, [
        { opacity: 0.35, transform: "translateY(5px)" },
        { opacity: 1, transform: "translateY(0)" },
      ]);
    previous.current = next;
    return () => {
      animations.forEach((animation) => animation.cancel());
      ghosts.forEach((ghost) => ghost.remove());
    };
  }, [version]);
  return (
    <div className="ck-transition" ref={host}>
      <div ref={content}>{children}</div>
      <div
        className="ck-transition-overlay"
        ref={overlay}
        aria-hidden="true"
        inert
      />
    </div>
  );
}
