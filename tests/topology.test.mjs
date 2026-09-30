import test from "node:test";
import assert from "node:assert/strict";
import { topology } from "../shared/topology.mjs";
const note = (
  id,
  category,
  knowledge_keywords = [],
  dependency_keywords = [],
) => ({ id, title: id, category, knowledge_keywords, dependency_keywords });
const notes = [
  note("a", ["计算机", "基础"], ["内存"]),
  note("b", ["计算机", "Web", "前端"], ["渲染"], ["内存"]),
  note("c", ["计算机", "Web", "前端"], ["渲染"]),
  note("d", ["计算机"]),
  note("e", ["其他"], ["渲染"]),
];
test("topology shows only direct children and aggregates scoped relationships", () => {
  const g = topology(notes, ["计算机"]);
  assert.equal(g.nodes.length, 3);
  assert.deepEqual(
    g.nodes.filter((n) => n.kind === "note").map((n) => n.noteId),
    ["d"],
  );
  const edge = g.edges.find((e) => e.type === "prerequisite");
  assert.equal(g.nodes.find((n) => n.id === edge.source).title, "基础");
  assert.equal(g.nodes.find((n) => n.id === edge.target).title, "Web");
  assert.equal(
    g.edges.some((e) => e.source === e.target),
    false,
  );
  assert.equal(
    g.nodes.some((n) => n.title === "其他"),
    false,
  );
});
test("expansion reveals one more level, collapse hides descendants, navigation changes canvas scope", () => {
  const open = topology(notes, ["计算机"], [["计算机", "Web"]]);
  assert.equal(
    open.nodes.some((n) => n.title === "前端"),
    true,
  );
  assert.equal(
    open.nodes.some((n) => n.noteId === "b"),
    false,
  );
  assert.equal(open.edges.filter((e) => e.type === "contains").length, 1);
  const closed = topology(notes, ["计算机"], [["计算机", "Web", "前端"]]);
  assert.equal(closed.nodes.length, 3);
  const child = topology(notes, ["计算机", "Web", "前端"]);
  assert.deepEqual(
    child.nodes.map((n) => n.noteId),
    ["b", "c"],
  );
  assert.equal(child.edges.length, 1);
  assert.equal(child.edges[0].type, "related");
  assert.equal(topology(notes, [], [], "related").nodes.length, 2);
});
test("topology aggregates multiple edges without double counting related links", () => {
  const g = topology([
    note("a", ["A"], ["x"]),
    note("b", ["B"], ["x"]),
    note("c", ["B"], ["x"]),
  ]);
  assert.equal(g.edges.length, 1);
  assert.equal(g.edges[0].count, 2);
  assert.throws(() => topology(notes, "bad"), /无效/);
  assert.throws(() => topology(notes, [], ["bad"]), /无效/);
});
