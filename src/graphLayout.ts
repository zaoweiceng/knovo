export type LayoutNode = { id: string; parent: string | null; title: string };
export type LayoutEdge = {
  id: string;
  source: string;
  target: string;
  type: string;
  count?: number;
};
export type Point = { x: number; y: number };
export const NODE_WIDTH = 280;
export const NODE_HEIGHT = 112;

// Keep existing positions fixed. Place newcomers near their strongest neighbours,
// searching free space in two dimensions rather than allocating depth columns.
export function layoutGraph(
  nodes: LayoutNode[],
  edges: LayoutEdge[],
  previous = new Map<string, Point>(),
) {
  const positions = new Map<string, Point>();
  const ids = new Set(nodes.map((n) => n.id));
  const links = new Map(nodes.map((n) => [n.id, new Map<string, number>()]));
  for (const e of edges) {
    if (!ids.has(e.source) || !ids.has(e.target) || e.source === e.target)
      continue;
    const weight =
      e.type === "contains" ? 1.2 : 2 + Math.log2(1 + (e.count || 1));
    for (const [a, b] of [
      [e.source, e.target],
      [e.target, e.source],
    ])
      links.get(a)!.set(b, (links.get(a)!.get(b) || 0) + weight);
  }
  for (const n of nodes)
    if (previous.has(n.id)) positions.set(n.id, { ...previous.get(n.id)! });
  const free = (p: Point) =>
    [...positions.values()].every(
      (q) =>
        Math.abs(p.x - q.x) >= NODE_WIDTH + 48 ||
        Math.abs(p.y - q.y) >= NODE_HEIGHT + 52,
    );
  const pending = nodes.filter((n) => !positions.has(n.id));
  while (pending.length) {
    const score = (id: string) =>
      [...links.get(id)!].reduce(
        (s, [other, w]) => s + w * (positions.has(other) ? 100 : 1),
        0,
      );
    pending.sort(
      (a, b) => score(b.id) - score(a.id) || a.id.localeCompare(b.id),
    );
    const n = pending.shift()!;
    const neighbours = [...links.get(n.id)!].filter(([id]) =>
      positions.has(id),
    );
    const total = neighbours.reduce((s, [, w]) => s + w, 0);
    const centre = total
      ? neighbours.reduce(
          (p, [id, w]) => ({
            x: p.x + (positions.get(id)!.x * w) / total,
            y: p.y + (positions.get(id)!.y * w) / total,
          }),
          { x: 0, y: 0 },
        )
      : { x: 0, y: 0 };
    let best: Point | undefined,
      cost = Infinity;
    // Elliptical rings account for the rectangular cards; alternate angles avoid rows.
    for (
      let ring = 0;
      ring < Math.ceil(Math.sqrt(nodes.length)) * 3 + 8;
      ring++
    ) {
      const samples = Math.max(1, ring * 12);
      for (let i = 0; i < samples; i++) {
        const angle = (i / samples) * Math.PI * 2 + ring * 0.27;
        const p = {
          x: centre.x + Math.cos(angle) * ring * (NODE_WIDTH + 70),
          y: centre.y + Math.sin(angle) * ring * (NODE_HEIGHT + 80),
        };
        if (!free(p)) continue;
        const value = neighbours.length
          ? neighbours.reduce((s, [id, w]) => {
              const q = positions.get(id)!;
              return s + w * Math.hypot(p.x - q.x, (p.y - q.y) * 1.4);
            }, 0)
          : Math.hypot(p.x, p.y * 1.4);
        if (value < cost) {
          cost = value;
          best = p;
        }
      }
      if (best && ring >= 2) break;
    }
    positions.set(
      n.id,
      best || { x: positions.size * (NODE_WIDTH + 80), y: 0 },
    );
  }
  return { positions };
}
