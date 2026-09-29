import { useEffect, useState } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  MarkerType,
  useNodesState,
  type Node,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Expand, ArrowUpRight, Network } from "lucide-react";
import { api } from "./types";
import FilterPicker from "./FilterPicker";
type GNode = { id: string; title: string; category: string[]; hop: number };
type GData = {
  nodes: GNode[];
  edges: { id: string; source: string; target: string; type: string }[];
  truncated: boolean;
  total: number;
  depth: number;
};
const palette = [
  "#333333",
  "#666666",
  "#999999",
  "#555555",
  "#888888",
  "#bbbbbb",
];
function color(s: string) {
  let n = 0;
  for (const c of s) n = (n * 31 + c.charCodeAt(0)) >>> 0;
  return palette[n % palette.length];
}
export default function Graph({
  id,
  categories,
  revision,
  onRead,
}: {
  id: string;
  categories: string[][];
  revision: number;
  onRead: (id: string) => void;
}) {
  const [center, setCenter] = useState(id),
    [depth, setDepth] = useState(2),
    [limit, setLimit] = useState(100),
    [category, setCategory] = useState(""),
    [type, setType] = useState("all"),
    [data, setData] = useState<GData | null>(null),
    [selected, setSelected] = useState<GNode | null>(null),
    [error, setError] = useState("");
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  useEffect(() => {
    let alive = true;
    setError("");
    api<GData>(
      `/graph/${encodeURIComponent(center)}?depth=${depth}&limit=${limit}&category=${encodeURIComponent(category)}&type=${type}`,
    )
      .then((g) => {
        if (!alive) return;
        setData(g);
        const rings = new Map<number, GNode[]>();
        for (const n of g.nodes) {
          const list = rings.get(n.hop) || [];
          list.push(n);
          rings.set(n.hop, list);
        }
        setNodes(
          g.nodes.map((n) => {
            const ring = rings.get(n.hop)!;
            const angle =
              (2 * Math.PI * ring.indexOf(n)) / ring.length -
              Math.PI / 2 +
              n.hop * 0.85;
            const radius =
              n.hop === 0 ? 0 : Math.max(n.hop * 190, ring.length * 35);
            return {
              id: n.id,
              position: {
                x: Math.cos(angle) * radius,
                y: Math.sin(angle) * radius,
              },
              data: { label: n.title },
              style: {
                background: n.id === center ? "#626262" : "#ffffff",
                color: n.id === center ? "white" : "#2e2e2e",
                border: `2px solid ${color(n.category[0])}`,
                borderRadius: 12,
                width: 180,
                padding: 12,
                fontSize: 12,
                boxShadow: "0 3px 12px #2121210a",
              },
            };
          }),
        );
        setSelected(g.nodes.find((n) => n.id === center) || null);
      })
      .catch((e) => alive && setError(e.message));
    return () => {
      alive = false;
    };
  }, [center, depth, limit, category, type, revision, setNodes]);
  return (
    <div className="graph-view">
      <div className="section-line">
        <div>
          <div className="eyebrow">CONNECTED KNOWLEDGE</div>
          <h1>知识网络</h1>
          <p>从一个知识点出发，发现理解之间的联系。</p>
        </div>
        <Network size={30} className="muted" />
      </div>
      <div className="graph-toolbar">
        <FilterPicker
          label="网络分类"
          categories={categories}
          value={category}
          onChange={setCategory}
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
        <button
          className="btn"
          disabled={depth >= 8}
          onClick={() => setDepth((d) => d + 1)}
        >
          <Expand size={15} />
          展开至 {depth + 1} 跳
        </button>
        <span className="muted">
          {data?.nodes.length || 0} 个节点 · {depth} 跳
        </span>
      </div>
      {error && <div className="error">{error}</div>}
      <div className="graph-canvas">
        <ReactFlow
          key={`${center}-${depth}-${category}-${type}-${limit}`}
          nodes={nodes}
          onNodesChange={onNodesChange}
          edges={(data?.edges || []).map((e) => ({
            ...e,
            type: "default",
            markerEnd:
              e.type === "prerequisite"
                ? { type: MarkerType.ArrowClosed, color: "#9b9b9b" }
                : undefined,
            style: {
              stroke: e.type === "prerequisite" ? "#9b9b9b" : "#bcbcbc",
              strokeDasharray: e.type === "related" ? "5 5" : undefined,
            },
          }))}
          onNodeClick={(_, n) =>
            setSelected(data?.nodes.find((x) => x.id === n.id) || null)
          }
          onNodeDoubleClick={(_, n) => {
            setCenter(n.id);
            setDepth(2);
          }}
          fitView
          fitViewOptions={{ padding: 0.25 }}
          minZoom={0.08}
        >
          <Background color="#e0e0e0" gap={24} />
          <Controls />
          <MiniMap
            nodeColor={(n) => (n.id === center ? "#626262" : "#d2d2d2")}
            pannable
            zoomable
          />
        </ReactFlow>
        {selected && (
          <div className="node-detail">
            <small>{selected.category.join(" / ")}</small>
            <h3>{selected.title}</h3>
            <div className="button-row">
              <button
                className="btn"
                onClick={() => {
                  setCenter(selected.id);
                  setDepth(2);
                }}
              >
                设为中心
              </button>
              <button
                className="btn primary"
                onClick={() => onRead(selected.id)}
              >
                阅读
                <ArrowUpRight size={14} />
              </button>
            </div>
          </div>
        )}
      </div>
      <div className="graph-foot">
        <span>实线箭头：前置 → 当前　虚线：相关知识　颜色：一级目录</span>
        {data?.truncated && (
          <button
            className="text-btn"
            disabled={limit >= 1000}
            onClick={() => setLimit((l) => Math.min(1000, l + 100))}
          >
            已显示 {data.nodes.length}/{data.total} · 再显示 100 个
          </button>
        )}
      </div>
    </div>
  );
}
