import test from "node:test";
import assert from "node:assert/strict";
import { layoutGraph, NODE_HEIGHT, NODE_WIDTH } from "../src/graphLayout.ts";
const node = (id) => ({ id, title: id, parent: null });
const edge = (a, b) => ({ id: a + b, source: a, target: b, type: "related" });
test("cluster layout uses both dimensions without overlapping cards", () => {
  const nodes = Array.from({ length: 20 }, (_, i) => node(String(i)));
  const { positions: p } = layoutGraph(nodes, []);
  const points = [...p.values()];
  assert.ok(new Set(points.map((p) => p.x)).size > 3);
  assert.ok(new Set(points.map((p) => p.y)).size > 3);
  for (let i = 0; i < points.length; i++)
    for (let j = i + 1; j < points.length; j++)
      assert.ok(
        Math.abs(points[i].x - points[j].x) >= NODE_WIDTH ||
          Math.abs(points[i].y - points[j].y) >= NODE_HEIGHT,
      );
});
test("expansion and collapse preserve existing positions and recovered children", () => {
  const nodes = ["a", "b", "c"].map(node),
    edges = [edge("a", "b")];
  const cache = layoutGraph(nodes, edges).positions;
  const expanded = layoutGraph(
    [...nodes, node("child")],
    [...edges, edge("a", "child")],
    cache,
  ).positions;
  for (const n of nodes) assert.deepEqual(expanded.get(n.id), cache.get(n.id));
  const restored = layoutGraph(
    [...nodes, node("child")],
    [...edges, edge("a", "child")],
    expanded,
  ).positions;
  assert.deepEqual(restored, expanded);
});
test("strongly connected nodes stay closer than disconnected nodes", () => {
  const nodes = ["a", "b", "c", "d", "e", "f", "g", "h"].map(node);
  const p = layoutGraph(nodes, [
    edge("a", "b"),
    edge("b", "c"),
    edge("c", "a"),
  ]).positions;
  const dist = (a, b) =>
    Math.hypot(p.get(a).x - p.get(b).x, p.get(a).y - p.get(b).y);
  assert.ok(
    (dist("a", "b") + dist("b", "c") + dist("a", "c")) / 3 <
      (dist("a", "f") + dist("a", "g") + dist("a", "h")) / 3,
  );
});
