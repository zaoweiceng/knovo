import { createPortal } from "react-dom";
import { useEffect, useState, type DragEvent, type MouseEvent } from "react";
import {
  ChevronDown,
  ChevronRight,
  Folder,
  MoreHorizontal,
} from "lucide-react";
import { api, type Note } from "./types";

type Source = { category: string[] } | { id: string };
type Props = {
  paths: string[][];
  selected: string[];
  notes: Note[];
  active?: string;
  query: string;
  onSelect: (p: string[]) => void;
  onNote: (id: string) => void;
  onChanged: (
    source: Source,
    target?: string[],
    deleted?: boolean,
  ) => Promise<void>;
};
const starts = (p: string[], prefix: string[]) =>
  prefix.every((x, i) => p[i] === x);
const equal = (a: string[], b: string[]) =>
  JSON.stringify(a) === JSON.stringify(b);
export default function KnowledgeTree(props: Props) {
  const [menu, setMenu] = useState<{
    source: Source;
    x: number;
    y: number;
  } | null>(null);
  const [dialog, setDialog] = useState<{
    source: Source;
    action: "rename" | "move" | "delete";
    expected: { id: string; hash: string }[];
  } | null>(null);
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [drag, setDrag] = useState<Source | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const affected = (source: Source) =>
    props.notes.filter((n) =>
      "category" in source
        ? starts(n.category, source.category)
        : n.id === source.id,
    );
  const label = (source: Source) =>
    "category" in source
      ? source.category.at(-1)!
      : props.notes.find((n) => n.id === source.id)?.title || "知识点";
  useEffect(() => {
    const close = () => setMenu(null);
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setMenu(null);
        if (!busy) setDialog(null);
      }
    };
    window.addEventListener("click", close);
    window.addEventListener("keydown", key);
    window.addEventListener("resize", close);
    window.addEventListener("scroll", close, true);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("keydown", key);
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", close, true);
    };
  }, [busy]);
  const showMenu = (e: MouseEvent, source: Source) => {
    e.preventDefault();
    e.stopPropagation();
    if (busy) return;
    setMenu({
      source,
      x: Math.max(8, Math.min(e.clientX, window.innerWidth - 180)),
      y: Math.max(8, Math.min(e.clientY, window.innerHeight - 150)),
    });
  };
  const canDrop = (source: Source, target: string[]) =>
    "category" in source
      ? !starts(target, source.category) &&
        !equal(target, source.category.slice(0, -1))
      : target.length > 0 &&
        !equal(affected(source)[0]?.category || [], target);
  const mutate = async (
    source: Source,
    action: string,
    extra: object,
    expected = affected(source).map(({ id, hash }) => ({ id, hash })),
  ) => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const result = await api<{ category?: string[] }>("/organize", {
        method: "POST",
        body: JSON.stringify({ source, action, expected, ...extra }),
      });
      setDialog(null);
      await props.onChanged(source, result.category, action === "delete");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const draggable = (source: Source) => ({
    draggable: !busy,
    onDragStart: (e: DragEvent) => {
      e.stopPropagation();
      setMenu(null);
      setDrag(source);
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("application/x-knowledge", JSON.stringify(source));
    },
    onDragEnd: () => {
      setDrag(null);
      setOver(null);
    },
    onContextMenu: (e: MouseEvent) => showMenu(e, source),
  });
  const droppable = (target: string[]) => ({
    onDragOver: (e: DragEvent) => {
      if (drag && canDrop(drag, target) && !busy) {
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = "move";
        setOver(JSON.stringify(target));
      }
    },
    onDragLeave: () => setOver(null),
    onDrop: (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const source = drag;
      setDrag(null);
      setOver(null);
      if (source && canDrop(source, target))
        void mutate(source, "move", { destination: target });
    },
  });
  const render = (prefix: string[] = []): React.ReactNode =>
    props.paths
      .filter((p) => p.length === prefix.length + 1 && starts(p, prefix))
      .sort((a, b) => a.at(-1)!.localeCompare(b.at(-1)!))
      .map((p) => {
        const notes = props.notes.filter((n) => starts(n.category, p));
        const match = (n: Note) =>
          (n.title + n.category.join(""))
            .toLowerCase()
            .includes(props.query.toLowerCase());
        if (props.query && !notes.some(match)) return null;
        const source = { category: p };
        return (
          <Branch
            key={JSON.stringify(p)}
            name={p.at(-1)!}
            selected={equal(p, props.selected)}
            active={notes.some((n) => n.id === props.active)}
            forceOpen={
              !!props.query ||
              (props.selected.length > p.length && starts(props.selected, p))
            }
            initialOpen={p.length === 1}
            rowProps={{ ...draggable(source), ...droppable(p) }}
            highlight={over === JSON.stringify(p)}
            onSelect={() => props.onSelect(p)}
            count={notes.length}
            menu={(e) => showMenu(e, source)}
          >
            {render(p)}
            {notes
              .filter((n) => n.category.length === p.length && match(n))
              .map((n) => (
                <button
                  key={n.id}
                  className={`tree-note ${props.active === n.id ? "active" : ""}`}
                  {...draggable({ id: n.id })}
                  onClick={() => props.onNote(n.id)}
                >
                  <span className="note-dot" />
                  {n.title}
                </button>
              ))}
          </Branch>
        );
      });
  return (
    <>
      {drag && "category" in drag && (
        <div
          className={`tree-root-drop ${over === "[]" ? "drop-target" : ""}`}
          {...droppable([])}
        >
          移到顶层目录
        </div>
      )}
      {render()}
      {busy && (
        <p className="muted tiny" role="status">
          正在更新目录与索引…
        </p>
      )}
      {error && !dialog && (
        <p role="alert" className="tree-error">
          {error}
        </p>
      )}
      {menu &&
        createPortal(
          <div
            className="tree-context-menu"
            role="menu"
            style={{ left: menu.x, top: menu.y }}
            onClick={(e) => e.stopPropagation()}
          >
            {(
              [
                ["rename", "重命名"],
                ["move", "移动到…"],
                ["delete", "移入回收站"],
              ] as const
            ).map(([action, text]) => (
              <button
                role="menuitem"
                key={action}
                onClick={() => {
                  setDialog({
                    source: menu.source,
                    action,
                    expected: affected(menu.source).map(({ id, hash }) => ({
                      id,
                      hash,
                    })),
                  });
                  setValue(action === "rename" ? label(menu.source) : "");
                  setError("");
                  setMenu(null);
                }}
              >
                {text}
              </button>
            ))}
          </div>,
          document.body,
        )}
      {dialog &&
        createPortal(
          <div
            className="modal-backdrop"
            onClick={() => !busy && setDialog(null)}
          >
            <form
              className="tree-operation-dialog"
              role="dialog"
              aria-modal="true"
              aria-labelledby="tree-dialog-title"
              onClick={(e) => e.stopPropagation()}
              onSubmit={(e) => {
                e.preventDefault();
                void mutate(
                  dialog.source,
                  dialog.action,
                  dialog.action === "rename"
                    ? { title: value }
                    : dialog.action === "move"
                      ? { destination: JSON.parse(value) }
                      : {},
                  dialog.expected,
                );
              }}
            >
              <h2 id="tree-dialog-title">
                {dialog.action === "rename"
                  ? "重命名"
                  : dialog.action === "move"
                    ? "移动"
                    : "移入回收站"}
                ：{label(dialog.source)}
              </h2>
              {dialog.action === "rename" && (
                <input
                  autoFocus
                  aria-label="新名称"
                  value={value}
                  disabled={busy}
                  onChange={(e) => setValue(e.target.value)}
                />
              )}
              {dialog.action === "move" && (
                <select
                  autoFocus
                  aria-label="目标目录"
                  value={value}
                  disabled={busy}
                  onChange={(e) => setValue(e.target.value)}
                >
                  <option value="" disabled>
                    选择目标目录
                  </option>
                  {("category" in dialog.source
                    ? [[], ...props.paths]
                    : props.paths
                  )
                    .filter((p) => canDrop(dialog.source, p))
                    .map((p) => (
                      <option key={JSON.stringify(p)} value={JSON.stringify(p)}>
                        {p.join(" / ") || "顶层目录"}
                      </option>
                    ))}
                </select>
              )}
              {dialog.action === "delete" && (
                <p>
                  将移除
                  {"category" in dialog.source ? "此目录及其子目录中的" : ""}{" "}
                  {dialog.expected.length} 个知识点，可在回收站恢复。
                </p>
              )}
              {error && (
                <p role="alert" className="tree-error">
                  {error}
                </p>
              )}
              <div className="tree-operation-actions">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setDialog(null)}
                >
                  取消
                </button>
                <button
                  disabled={
                    busy || (dialog.action !== "delete" && !value.trim())
                  }
                  type="submit"
                >
                  {busy ? "更新中…" : "确认"}
                </button>
              </div>
            </form>
          </div>,
          document.body,
        )}
    </>
  );
}
function Branch({
  name,
  selected,
  active,
  forceOpen,
  initialOpen,
  rowProps,
  highlight,
  onSelect,
  count,
  menu,
  children,
}: {
  name: string;
  selected: boolean;
  active: boolean;
  forceOpen: boolean;
  initialOpen: boolean;
  rowProps: React.HTMLAttributes<HTMLDivElement>;
  highlight: boolean;
  onSelect: () => void;
  count: number;
  menu: (e: MouseEvent) => void;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(initialOpen || active);
  useEffect(() => {
    if (active || forceOpen) setOpen(true);
  }, [active, forceOpen]);
  const expanded = open || forceOpen;
  return (
    <div className="tree-branch">
      <div
        className={`tree-row ${selected ? "selected" : ""} ${highlight ? "drop-target" : ""}`}
        {...rowProps}
      >
        <button
          className="tree-toggle"
          aria-label={`${expanded ? "折叠" : "展开"} ${name}`}
          aria-expanded={expanded}
          onClick={() => setOpen(!open)}
        >
          {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        </button>
        <button
          className="tree-name"
          onClick={() => {
            onSelect();
            setOpen(true);
          }}
        >
          <Folder size={13} />
          <span>{name}</span>
          <small>{count}</small>
        </button>
        <button
          className="tree-more"
          aria-label={`${name} 的操作`}
          onClick={menu}
        >
          <MoreHorizontal size={14} />
        </button>
      </div>
      {expanded && <div className="tree-children">{children}</div>}
    </div>
  );
}
