import { useEffect, useMemo, useRef, useState } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  MarkerType,
  useNodesState,
  type Node,
  Handle,
  Position,
  BaseEdge,
  getBezierPath,
  useUpdateNodeInternals,
  type EdgeProps,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { ArrowLeft, Folder, FileText, X, ArrowUpRight } from "lucide-react";
import { api } from "./types";
import FilterPicker from "./FilterPicker";
import { layoutGraph, NODE_WIDTH, NODE_HEIGHT } from "./graphLayout";
function TopologyNode({ id, data }: NodeProps) {
  const updateInternals = useUpdateNodeInternals();
  const portsKey = JSON.stringify(data.ports);
  useEffect(() => {
    updateInternals(id);
  }, [id, portsKey, updateInternals]);
  return (
    <>
      {data.label as React.ReactNode}
      {(
        data.ports as {
          id: string;
          type: "source" | "target";
          color: string;
          side: Position;
        }[]
      ).map((port, i, ports) => (
        <Handle
          key={port.id}
          id={port.id}
          type={port.type}
          position={port.side}
          style={{
            ...([Position.Top, Position.Bottom].includes(port.side)
              ? { left: `${15 + ((i + 1) * 70) / (ports.length + 1)}%` }
              : { top: `${15 + ((i + 1) * 70) / (ports.length + 1)}%` }),
            background: port.color,
          }}
        />
      ))}
    </>
  );
}
function RelationEdge(props: EdgeProps) {
  const [path, labelX, labelY] = getBezierPath({ ...props, curvature: 0.15 });
  return <BaseEdge {...props} path={path} labelX={labelX} labelY={labelY} />;
}
const nodeTypes = { topology: TopologyNode };
const edgeTypes = { relation: RelationEdge };
type GNode = {
  id: string;
  noteId?: string;
  title: string;
  category: string[];
  kind: "folder" | "note";
  expanded?: boolean;
  count?: number;
  parent: string | null;
};
type GData = {
  nodes: GNode[];
  edges: {
    id: string;
    source: string;
    target: string;
    type: string;
    count: number;
  }[];
};
export default function Graph({
  category,
  onCategory,
  categories,
  revision,
  onRead,
}: {
  category: string[];
  onCategory: (path: string[]) => void;
  categories: string[][];
  revision: number;
  onRead: (id: string) => void;
}) {
  const [expanded, setExpanded] = useState<string[][]>([]),
    [type, setType] = useState("all"),
    [canvasPath, setCanvasPath] = useState(""),
    [data, setData] = useState<GData | null>(null),
    [selected, setSelected] = useState<GNode | null>(null),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(false),
    [hovered, setHovered] = useState<string | null>(null);
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const positionCache = useRef(new Map<string, { x: number; y: number }>());
  const cachePath = useRef("");
  const click = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pathKey = JSON.stringify(category);
  useEffect(() => {
    setExpanded([]);
    setSelected(null);
    if (click.current) clearTimeout(click.current);
  }, [pathKey]);
  useEffect(
    () => () => {
      if (click.current) clearTimeout(click.current);
    },
    [],
  );
  useEffect(() => {
    let alive = true;
    setError("");
    setLoading(true);
    setHovered(null);

    setSelected(null);
    api<GData>(
      `/topology?category=${encodeURIComponent(pathKey)}&expanded=${encodeURIComponent(JSON.stringify(expanded))}&type=${type}`,
    )
      .then((g) => {
        if (!alive) return;
        g = {
          ...g,
          nodes: g.nodes.map((n) => ({
            ...n,
            id: encodeURIComponent(n.id),
            parent: n.parent ? encodeURIComponent(n.parent) : null,
          })),
          edges: g.edges.map((e) => ({
            ...e,
            id: encodeURIComponent(e.id),
            source: encodeURIComponent(e.source),
            target: encodeURIComponent(e.target),
          })),
        };
        setCanvasPath(pathKey);
        setData(g);
        if (cachePath.current !== pathKey) {
          positionCache.current.clear();
          cachePath.current = pathKey;
        }
        const layout = layoutGraph(g.nodes, g.edges, positionCache.current);
        for (const [id, p] of layout.positions)
          positionCache.current.set(id, p);
        setNodes(
          g.nodes.map((n) => {
            return {
              id: n.id,
              type: "topology",
              position: layout.positions.get(n.id)!,
              data: {
                ports: g.edges
                  .filter((e) => e.source === n.id || e.target === n.id)
                  .map((e) => ({
                    id: e.id + (e.source === n.id ? ":out" : ":in"),
                    type: e.source === n.id ? "source" : "target",
                    side: Position.Right,
                    color: e.type === "prerequisite" ? "#32688b" : "#9a702c",
                  })),
                label: (
                  <div className="topology-node">
                    <span>
                      {n.kind === "folder" ? (
                        <Folder size={16} />
                      ) : (
                        <FileText size={16} />
                      )}
                      {n.title}
                    </span>
                    {n.kind === "folder" && (
                      <small>
                        {n.count} 个知识点 · {n.expanded ? "− 收拢" : "+ 展开"}
                      </small>
                    )}
                  </div>
                ),
              },
              style: {
                width: NODE_WIDTH,
                height: NODE_HEIGHT,
                padding: 16,
                borderRadius: 10,
                border: "1px solid #aaa",
                background: n.kind === "folder" ? "#f4f4f4" : "#fff",
              },
            };
          }),
        );
      })
      .catch((e) => alive && setError(e.message))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [pathKey, expanded, type, revision, setNodes]);
  const enter = (p: string[]) => {
    if (click.current) clearTimeout(click.current);
    setExpanded([]);
    setSelected(null);
    onCategory(p);
  };
  const displayNodes = useMemo(() => {
    const positions = new Map(nodes.map((n) => [n.id, n.position]));
    return nodes.map((n) => ({
      ...n,
      data: {
        ...n.data,
        ports: (data?.edges || [])
          .filter((e) => e.source === n.id || e.target === n.id)
          .map((e) => {
            const other =
              positions.get(e.source === n.id ? e.target : e.source) ||
              n.position;
            const dx = other.x - n.position.x,
              dy = other.y - n.position.y;
            const side =
              Math.abs(dx) / NODE_WIDTH > Math.abs(dy) / NODE_HEIGHT
                ? dx > 0
                  ? Position.Right
                  : Position.Left
                : dy > 0
                  ? Position.Bottom
                  : Position.Top;
            return {
              id: e.id + (e.source === n.id ? ":out" : ":in"),
              type: e.source === n.id ? "source" : "target",
              side,
              color:
                e.type === "contains"
                  ? "#a5a9ae"
                  : e.type === "prerequisite"
                    ? "#32688b"
                    : "#9a702c",
            };
          }),
      },
    }));
  }, [nodes, data]);
  const focused = selected?.id || hovered;
  return (
    <div className="graph-view">
      <div className="graph-toolbar">
        <button
          className="btn"
          disabled={!category.length}
          onClick={() => enter(category.slice(0, -1))}
        >
          <ArrowLeft size={15} />
          返回上一层级
        </button>
        <FilterPicker
          label="网络分类"
          categories={categories}
          value={category.length ? pathKey : ""}
          onChange={(v) => enter(v ? JSON.parse(v) : [])}
        />
        <select
          aria-label="关联类型"
          value={type}
          onChange={(e) => setType(e.target.value)}
        >
          <option value="all">全部关系</option>
          <option value="prerequisite">前置依赖</option>
          <option value="related">相关知识</option>
        </select>
        <span className="muted">
          {loading ? "加载中…" : `${data?.nodes.length || 0} 个节点`}
        </span>
      </div>
      {error && (
        <div role="alert" className="error">
          {error}
        </div>
      )}
      <div className="graph-canvas">
        {!loading && data && !data.nodes.length && (
          <div className="empty">当前层级没有内容</div>
        )}
        {!!nodes.length && (
          <ReactFlow
            key={canvasPath}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            nodes={[
              ...displayNodes.map((n) => ({
                ...n,
                style: {
                  ...n.style,
                  borderColor: n.id === focused ? "#32688b" : "#aaa",
                  boxShadow:
                    n.id === focused ? "0 0 0 2px #32688b25" : undefined,
                },
              })),
            ]}
            onPaneClick={() => {
              setSelected(null);
              setHovered(null);
            }}
            nodesConnectable={false}
            onNodeMouseEnter={(_, node) => setHovered(node.id)}
            onNodeMouseLeave={() => setHovered(null)}
            onNodesChange={onNodesChange}
            onNodeDragStop={(_, node) =>
              positionCache.current.set(node.id, node.position)
            }
            edges={(data?.edges || []).map((e) => ({
              ...e,
              type: "relation",
              sourceHandle: e.id + ":out",
              targetHandle: e.id + ":in",

              pathOptions: { borderRadius: 10 },
              zIndex:
                focused && (e.source === focused || e.target === focused)
                  ? 5
                  : 0,
              label:
                e.type === "contains"
                  ? undefined
                  : `${e.type === "prerequisite" ? "前置" : "相关"}${e.count > 1 ? ` ×${e.count}` : ""}`,
              labelStyle: {
                fill: e.type === "prerequisite" ? "#32688b" : "#9a702c",
                fontSize: 11,
                fontWeight: 600,
              },
              labelBgStyle: { fill: "#fff", fillOpacity: 0.96 },
              labelBgPadding: [6, 4] as [number, number],
              labelBgBorderRadius: 4,
              markerEnd:
                e.type === "prerequisite"
                  ? { type: MarkerType.ArrowClosed, color: "#49718d" }
                  : undefined,
              style: {
                stroke:
                  e.type === "contains"
                    ? "#a5a9ae"
                    : e.type === "prerequisite"
                      ? "#49718d"
                      : "#9a8055",
                strokeWidth:
                  focused && (e.source === focused || e.target === focused)
                    ? 2.8
                    : e.type === "contains"
                      ? 1.3
                      : 2,
                opacity:
                  focused && e.source !== focused && e.target !== focused
                    ? 0.12
                    : 1,
                strokeDasharray: e.type === "related" ? "5 5" : undefined,
              },
            }))}
            onNodeClick={(_, node) => {
              if (click.current) clearTimeout(click.current);
              const n = data?.nodes.find((x) => x.id === node.id);
              if (!n) return;
              click.current = setTimeout(() => {
                if (n.kind === "folder")
                  setExpanded((current) =>
                    n.expanded
                      ? current.filter(
                          (p) => !n.category.every((x, i) => p[i] === x),
                        )
                      : [...current, n.category],
                  );
                else setSelected(n);
              }, 400);
            }}
            onNodeDoubleClick={(_, node) => {
              if (click.current) clearTimeout(click.current);
              const n = data?.nodes.find((x) => x.id === node.id);
              if (!n) return;
              if (n.kind === "folder") enter(n.category);
              else onRead(n.noteId!);
            }}
            zoomOnDoubleClick={false}
            fitView
            fitViewOptions={{ padding: 0.12, maxZoom: 1 }}
            minZoom={0.08}
          >
            <Background color="#e0e0e0" gap={24} />
            <Controls />
            <MiniMap pannable zoomable />
          </ReactFlow>
        )}
        {selected && (
          <div className="node-detail">
            <button
              className="node-detail-close"
              aria-label="关闭节点详情"
              title="关闭"
              onClick={() => {
                setSelected(null);
                setHovered(null);
              }}
            >
              <X size={17} />
            </button>
            <h3>{selected.title}</h3>
            <div className="node-relations">
              {[
                {
                  label: "前置知识",
                  match: (e: GData["edges"][number]) =>
                    e.type === "prerequisite" && e.target === selected.id,
                  other: (e: GData["edges"][number]) => e.source,
                },
                {
                  label: "后续知识",
                  match: (e: GData["edges"][number]) =>
                    e.type === "prerequisite" && e.source === selected.id,
                  other: (e: GData["edges"][number]) => e.target,
                },
                {
                  label: "相关知识",
                  match: (e: GData["edges"][number]) =>
                    e.type === "related" &&
                    (e.source === selected.id || e.target === selected.id),
                  other: (e: GData["edges"][number]) =>
                    e.source === selected.id ? e.target : e.source,
                },
              ].map((group) => {
                const relations = (data?.edges || []).filter(group.match);
                if (!relations.length) return null;
                return (
                  <section key={group.label}>
                    <h4>
                      {group.label} <span>{relations.length}</span>
                    </h4>
                    {relations.map((e) => {
                      const other = data!.nodes.find(
                        (n) => n.id === group.other(e),
                      )!;
                      return (
                        <button key={e.id} onClick={() => setSelected(other)}>
                          {other.title}
                          <ArrowUpRight size={14} />
                        </button>
                      );
                    })}
                  </section>
                );
              })}
              {!data?.edges.some(
                (e) =>
                  e.type !== "contains" &&
                  (e.source === selected.id || e.target === selected.id),
              ) && <p>当前视图中暂无知识关系</p>}
            </div>
            <div className="node-detail-actions">
              <button
                className="btn"
                onClick={() =>
                  selected.kind === "folder"
                    ? enter(selected.category)
                    : onRead(selected.noteId!)
                }
              >
                {selected.kind === "folder" ? "进入目录" : "阅读知识"}
                <ArrowUpRight size={15} />
              </button>
            </div>
          </div>
        )}
      </div>
      <div className="graph-foot">
        单击目录展开/收拢 · 双击目录进入子层级 · 双击知识点阅读
        <br />
        灰线：目录层级　蓝色箭头：前置 → 当前　金色虚线：相关　数字：汇总关系数
        · 悬停节点突出其连线
      </div>
    </div>
  );
}
