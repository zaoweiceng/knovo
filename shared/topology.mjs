import { deriveRelations } from "./relations.mjs";
const starts = (p, prefix) => prefix.every((x, i) => p[i] === x);
const folderId = (p) => "folder:" + JSON.stringify(p);
export function topology(notes, category = [], expanded = [], type = "all") {
  const valid = (p) =>
    Array.isArray(p) && p.every((x) => typeof x === "string");
  if (
    !valid(category) ||
    !Array.isArray(expanded) ||
    expanded.length > 200 ||
    !expanded.every(valid) ||
    !["all", "prerequisite", "related"].includes(type)
  )
    throw Error("无效的拓扑参数");
  const scoped = notes.filter((n) => starts(n.category, category));
  const opened = new Set(expanded.map(folderId)),
    nodes = [],
    edges = [],
    owners = new Map();
  function level(prefix, parent = null) {
    const children = new Map();
    for (const n of scoped.filter((n) => starts(n.category, prefix))) {
      if (n.category.length === prefix.length) {
        const id = "note:" + n.id;
        nodes.push({
          id,
          noteId: n.id,
          title: n.title,
          category: n.category,
          kind: "note",
          parent,
        });
        owners.set(n.id, id);
      } else {
        const p = n.category.slice(0, prefix.length + 1),
          id = folderId(p);
        if (!children.has(id))
          children.set(id, {
            id,
            title: p.at(-1),
            category: p,
            kind: "folder",
            count: 0,
            expanded: opened.has(id),
            parent,
          });
        children.get(id).count++;
        owners.set(n.id, id);
      }
    }
    for (const child of [...children.values()].sort((a, b) =>
      a.title.localeCompare(b.title),
    )) {
      nodes.push(child);
      if (child.expanded) level(child.category, child.id);
    }
  }
  level(category);
  for (const n of nodes)
    if (n.parent)
      edges.push({
        id: "contains:" + n.id,
        source: n.parent,
        target: n.id,
        type: "contains",
        count: 1,
      });
  const aggregated = new Map(),
    relations = deriveRelations(notes);
  const seen = new Set();
  for (const n of scoped)
    for (const kind of ["prerequisite", "related"]) {
      if (type !== "all" && type !== kind) continue;
      const entries = relations.get(n.id)[
        kind === "prerequisite" ? "prerequisites" : "related"
      ];
      for (const other of entries.keys()) {
        let source = owners.get(kind === "prerequisite" ? other : n.id),
          target = owners.get(kind === "prerequisite" ? n.id : other);
        if (!source || !target || source === target) continue;
        const pair = kind === "related" ? [n.id, other].sort() : [other, n.id];
        const original = JSON.stringify([kind, ...pair]);
        if (seen.has(original)) continue;
        seen.add(original);
        if (kind === "related" && source > target)
          [source, target] = [target, source];
        const id = JSON.stringify([kind, source, target]);
        const edge = aggregated.get(id) || {
          id,
          source,
          target,
          type: kind,
          count: 0,
        };
        edge.count++;
        aggregated.set(id, edge);
      }
    }
  return { nodes, edges: [...edges, ...aggregated.values()], category };
}
