import { useEffect, useId, useRef, useState } from "react";
import {
  Search,
  Folder,
  Hash,
  ChevronDown,
  ChevronRight,
  ArrowLeft,
  Check,
} from "lucide-react";

type Props = {
  label: string;
  value: string;
  onChange: (value: string) => void;
  categories?: string[][];
  tags?: { name: string; count: number }[];
};
export default function FilterPicker({
  label,
  value,
  onChange,
  categories,
  tags = [],
}: Props) {
  const [open, setOpen] = useState(false),
    [query, setQuery] = useState(""),
    [path, setPath] = useState<string[]>([]),
    [limit, setLimit] = useState(12);
  const root = useRef<HTMLDivElement>(null),
    trigger = useRef<HTMLButtonElement>(null),
    panelId = useId();
  const selected: string[] = categories && value ? JSON.parse(value) : [];
  const close = () => {
    setOpen(false);
    trigger.current?.focus();
  };
  const choose = (next: string) => {
    onChange(next);
    close();
  };
  useEffect(() => {
    if (!open) return;
    const outside = (e: PointerEvent) => {
      if (root.current && !root.current.contains(e.target as Node))
        setOpen(false);
    };
    const escape = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        setOpen(false);
        trigger.current?.focus();
      }
    };
    document.addEventListener("pointerdown", outside);
    root.current?.addEventListener("keydown", escape);
    const el = root.current;
    return () => {
      document.removeEventListener("pointerdown", outside);
      el?.removeEventListener("keydown", escape);
    };
  }, [open]);
  const needle = query.trim().toLocaleLowerCase();
  const options = categories
    ? (needle
        ? categories.filter((p) =>
            p.join(" / ").toLocaleLowerCase().includes(needle),
          )
        : categories.filter(
            (p) =>
              p.length === path.length + 1 && path.every((v, i) => v === p[i]),
          )
      ).map((p) => ({
        key: JSON.stringify(p),
        name: p.at(-1)!,
        path: p,
        caption: needle ? p.slice(0, -1).join(" / ") : "",
        children: categories.some(
          (c) => c.length > p.length && p.every((v, i) => c[i] === v),
        ),
        count: undefined,
      }))
    : tags
        .filter((t) => t.name.toLocaleLowerCase().includes(needle))
        .map((t) => ({
          key: t.name,
          name: t.name,
          path: [],
          caption: "",
          children: false,
          count: t.count,
        }));
  return (
    <div className="filter-picker" ref={root}>
      <button
        ref={trigger}
        className={`filter-trigger ${value ? "has-value" : ""}`}
        aria-label={label}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-controls={panelId}
        onClick={() => {
          setOpen(!open);
          setQuery("");
          setPath([]);
          setLimit(12);
        }}
        title={categories ? selected.join(" / ") : value}
      >
        {categories ? <Folder size={14} /> : <Hash size={14} />}
        <span>
          {value
            ? categories
              ? selected.at(-1)
              : value
            : categories
              ? "分类"
              : "关键词"}
        </span>
        <ChevronDown size={13} />
      </button>
      {open && (
        <div
          id={panelId}
          className="filter-popover"
          role="dialog"
          aria-label={label + "面板"}
        >
          <label className="picker-search">
            <Search size={14} />
            <input
              autoFocus
              aria-label={categories ? "搜索分类" : "搜索关键词"}
              placeholder={categories ? "搜索分类名称或路径…" : "搜索关键词…"}
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setLimit(12);
              }}
            />
          </label>
          <div className="picker-navigation">
            <button onClick={() => choose("")}>
              {categories ? "全部分类" : "全部关键词"}
              {!value && <Check size={12} />}
            </button>
            {categories && path.length > 0 && !needle && (
              <button
                onClick={() => {
                  setPath(path.slice(0, -1));
                  setLimit(12);
                }}
              >
                <ArrowLeft size={12} />
                上一级
              </button>
            )}
          </div>
          {categories && path.length > 0 && !needle && (
            <div className="picker-current">
              <span title={path.join(" / ")}>{path.join(" / ")}</span>
              <button onClick={() => choose(JSON.stringify(path))}>
                选择此分类
              </button>
            </div>
          )}
          {!categories && !needle && (
            <div className="picker-caption">常用关键词 · 按知识点数量排序</div>
          )}
          <div className="picker-options">
            {options.slice(0, limit).map((o) => (
              <div
                key={o.key}
                className={`picker-option ${value === o.key ? "selected" : ""}`}
              >
                <button
                  className="picker-select"
                  onClick={() => choose(o.key)}
                  aria-label={`选择${categories ? "分类" : "关键词"} ${categories ? o.path.join(" / ") : o.name}`}
                >
                  <div>
                    <span>{o.name}</span>
                    {o.caption && <small>{o.caption}</small>}
                  </div>
                  {value === o.key ? (
                    <Check size={14} />
                  ) : o.count !== undefined ? (
                    <small>{o.count}</small>
                  ) : null}
                </button>
                {o.children && !needle && (
                  <button
                    className="picker-descend"
                    aria-label={`进入 ${o.name}`}
                    onClick={() => {
                      setPath(o.path);
                      setLimit(12);
                    }}
                  >
                    <ChevronRight size={15} />
                  </button>
                )}
              </div>
            ))}
            {!options.length && (
              <p className="picker-empty">
                {needle ? "没有匹配的结果" : "没有下级分类"}
              </p>
            )}
            {options.length > limit && (
              <button
                className="picker-more"
                onClick={() => setLimit((n) => n + 20)}
              >
                显示更多（还有 {options.length - limit} 项）
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
