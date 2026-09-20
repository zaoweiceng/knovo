import { useEffect, useRef, useState, lazy, Suspense } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  BookOpen,
  Grid2X2,
  Network,
  RotateCcw,
  Search,
  Plus,
  ChevronRight,
  ChevronDown,
  ArrowUpRight,
  Clock,
  Folder,
  PanelLeft,
  PanelRight,
  X,
  Upload,
  FileText,
  Check,
  AlertCircle,
  CalendarDays,
  ArrowLeft,
  Pause,
  Play,
  RefreshCw,
  Leaf,
} from "lucide-react";
import {
  api,
  type Note,
  type Detail,
  type Stats,
  type Relation,
} from "./types";
import Heatmap from "./Heatmap";
const Graph = lazy(() => import("./Graph"));
type View = "home" | "library" | "detail" | "review" | "graph" | "timeline";
type ImportResult = { filename: string; status: string; message?: string };
const emptyStats: Stats = {
  total: 0,
  categories: 0,
  due: 0,
  learning: 0,
  today: new Date().toLocaleDateString("sv-SE"),
  days: [],
  version: 0,
  errors: [],
};
function Markdown({ body }: { body: string }) {
  return (
    <div className="markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ children, href }) => (
            <a href={href} target="_blank" rel="noreferrer">
              {children}
            </a>
          ),
          img: ({ alt, src }) => (
            <a href={src} target="_blank" rel="noreferrer">
              [图片：{alt || "查看图片"}]
            </a>
          ),
        }}
      >
        {body}
      </ReactMarkdown>
    </div>
  );
}
function Tree({
  paths,
  selected,
  onSelect,
  notes,
  onNote,
  active,
  query,
  prefix = [],
}: {
  paths: string[][];
  selected: string[];
  onSelect: (p: string[]) => void;
  notes: Note[];
  onNote: (id: string) => void;
  active?: string;
  query: string;
  prefix?: string[];
}) {
  const names = [
    ...new Set(
      paths
        .filter(
          (p) => prefix.every((x, i) => p[i] === x) && p.length > prefix.length,
        )
        .map((p) => p[prefix.length]),
    ),
  ].sort();
  return (
    <>
      {names.map((name) => (
        <TreeBranch
          key={name}
          {...{ paths, selected, onSelect, notes, onNote, active, query }}
          prefix={[...prefix, name]}
          name={name}
        />
      ))}
    </>
  );
}
function TreeBranch(props: {
  paths: string[][];
  selected: string[];
  onSelect: (p: string[]) => void;
  notes: Note[];
  onNote: (id: string) => void;
  active?: string;
  query: string;
  prefix: string[];
  name: string;
}) {
  const {
    prefix,
    name,
    paths,
    selected,
    onSelect,
    notes,
    onNote,
    active,
    query,
  } = props;
  const matched = notes.filter((n) =>
    prefix.every((x, i) => n.category[i] === x),
  );
  const activeIn = matched.some((n) => n.id === active);
  const [open, setOpen] = useState(prefix.length === 1 || activeIn);
  useEffect(() => {
    if (activeIn) setOpen(true);
  }, [activeIn]);
  if (
    query &&
    !matched.some((n) =>
      (n.title + n.category.join(""))
        .toLowerCase()
        .includes(query.toLowerCase()),
    )
  )
    return null;
  const exact = matched.filter((n) => n.category.length === prefix.length);
  const isSelected = JSON.stringify(selected) === JSON.stringify(prefix);
  return (
    <div className="tree-branch">
      <div className={`tree-row ${isSelected ? "selected" : ""}`}>
        <button
          aria-label={`${open ? "折叠" : "展开"} ${name}`}
          className="tree-toggle"
          onClick={() => setOpen(!open)}
        >
          {open || query ? (
            <ChevronDown size={12} />
          ) : (
            <ChevronRight size={12} />
          )}
        </button>
        <button
          className="tree-name"
          onClick={() => {
            onSelect(prefix);
            setOpen(true);
          }}
        >
          <Folder size={13} />
          <span>{name}</span>
          <small>{matched.length}</small>
        </button>
      </div>
      {(open || query) && (
        <div className="tree-children">
          <Tree {...props} />
          {exact
            .filter(
              (n) =>
                !query ||
                (n.title + n.category.join(""))
                  .toLowerCase()
                  .includes(query.toLowerCase()),
            )
            .map((n) => (
              <button
                className={`tree-note ${active === n.id ? "active" : ""}`}
                onClick={() => onNote(n.id)}
                key={n.id}
              >
                <span className="note-dot" />
                {n.title}
              </button>
            ))}
        </div>
      )}
    </div>
  );
}
export default function App() {
  const [stats, setStats] = useState<Stats>(emptyStats),
    [all, setAll] = useState<Note[]>([]),
    [notes, setNotes] = useState<Note[]>([]),
    [view, setView] = useState<View>("home"),
    [selected, setSelected] = useState<string | null>(null),
    [detail, setDetail] = useState<Detail | null>(null),
    [category, setCategory] = useState<string[]>([]),
    [q, setQ] = useState(""),
    [tag, setTag] = useState(""),
    [dirQuery, setDirQuery] = useState(""),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true),
    [leftOpen, setLeftOpen] = useState(false),
    [rightOpen, setRightOpen] = useState(false),
    [importOpen, setImportOpen] = useState(false),
    [importing, setImporting] = useState(false),
    [results, setResults] = useState<ImportResult[]>([]),
    [reviewQueue, setReviewQueue] = useState<Note[]>([]),
    [revealed, setRevealed] = useState(false),
    [ratingBusy, setRatingBusy] = useState(false),
    [selectedDay, setSelectedDay] = useState(""),
    [dayItems, setDayItems] = useState<
      { id: string; title: string; active: number; resolved_id: string }[]
    >([]),
    [timeline, setTimeline] = useState<
      {
        id: string;
        title: string;
        category: string[];
        date: string | null;
        summary: string;
      }[]
    >([]),
    [fromDate, setFromDate] = useState(""),
    [toDate, setToDate] = useState(""),
    [showIssues, setShowIssues] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const versionRef = useRef(-1);
  const searchRef = useRef<HTMLInputElement>(null);
  const categories = Array.from(
    new Map(
      all.flatMap((n) =>
        n.category.map((_, i) => {
          const p = n.category.slice(0, i + 1);
          return [JSON.stringify(p), p] as [string, string[]];
        }),
      ),
    ).values(),
  );
  const refresh = async () => {
    const s = await api<Stats>("/stats");
    setStats(s);
    if (versionRef.current !== s.version) {
      versionRef.current = s.version;
      setAll(await api<Note[]>("/notes"));
    }
  };
  useEffect(() => {
    refresh()
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
    const timer = setInterval(() => refresh().catch(() => {}), 2000);
    const key = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        searchRef.current?.focus();
      }
      if (e.key === "Escape") {
        setImportOpen(false);
        setLeftOpen(false);
        setRightOpen(false);
      }
    };
    window.addEventListener("keydown", key);
    return () => {
      clearInterval(timer);
      window.removeEventListener("keydown", key);
    };
  }, []);
  useEffect(() => {
    let alive = true;
    const timer = setTimeout(
      () =>
        api<Note[]>(
          `/notes?q=${encodeURIComponent(q)}&category=${encodeURIComponent(category.length ? JSON.stringify(category) : "")}&tag=${encodeURIComponent(tag)}`,
        )
          .then((n) => alive && setNotes(n))
          .catch((e) => alive && setError(e.message)),
      150,
    );
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [q, category, tag, stats.version]);
  useEffect(() => {
    if (!selected) {
      setDetail(null);
      return;
    }
    let alive = true;
    api<Detail>("/notes/" + encodeURIComponent(selected))
      .then((d) => alive && setDetail(d))
      .catch((e) => {
        if (alive) {
          setDetail(null);
          setError(e.message);
        }
      });
    return () => {
      alive = false;
    };
  }, [selected, stats.version]);
  useEffect(() => {
    if (view === "review")
      api<Note[]>("/reviews")
        .then(setReviewQueue)
        .catch((e) => setError(e.message));
    if (view === "timeline")
      api<typeof timeline>("/timeline")
        .then(setTimeline)
        .catch((e) => setError(e.message));
  }, [view, stats.version]);
  useEffect(() => {
    if (selectedDay)
      api<typeof dayItems>("/additions?date=" + selectedDay)
        .then(setDayItems)
        .catch((e) => setError(e.message));
  }, [selectedDay, stats.version]);
  const read = (id: string) => {
    setSelected(id);
    if (selected !== id) setDetail(null);
    setView("detail");
    setLeftOpen(false);
    setRightOpen(false);
    setError("");
  };
  const navigate = (next: View) => {
    setView(next);
    setLeftOpen(false);
    setError("");
    setRevealed(false);
    if (next === "home") {
      setQ("");
      setCategory([]);
      setTag("");
    }
  };
  const upload = async (files: FileList | File[]) => {
    setImporting(true);
    setResults([]);
    try {
      const payload = await Promise.all(
        Array.from(files).map(async (f) => {
          if (f.size > 2 * 1024 * 1024) throw Error(`${f.name} 超过 2 MB`);
          return { name: f.name, text: await f.text() };
        }),
      );
      const r = await api<ImportResult[]>("/import", {
        method: "POST",
        body: JSON.stringify({ files: payload }),
      });
      setResults(r);
      await refresh();
    } catch (e) {
      setResults([
        {
          filename: "导入失败",
          status: "error",
          message: (e as Error).message,
        },
      ]);
    } finally {
      setImporting(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };
  const rate = async (id: string, rating: string) => {
    setRatingBusy(true);
    try {
      await api("/reviews/" + id, {
        method: "POST",
        body: JSON.stringify({ rating }),
      });
      setRevealed(false);
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRatingBusy(false);
    }
  };
  const changeReview = async (id: string, patch: object) => {
    try {
      await api("/reviews/" + id, {
        method: "PATCH",
        body: JSON.stringify(patch),
      });
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const current = reviewQueue[0];
  const renderList = (list: Note[], compact = false) => (
    <div className={`note-list ${compact ? "compact" : ""}`}>
      {list.map((n) => (
        <button key={n.id} className="note-card" onClick={() => read(n.id)}>
          <div className="note-card-icon">
            <FileText size={19} />
          </div>
          <div className="note-card-body">
            <div className="note-card-top">
              <span className="category-label">{n.category.join(" / ")}</span>
              <span className="tiny muted">
                {(
                  n.learning_events.find((e) => e.date)?.date ||
                  n.created_at.slice(0, 10)
                ).replaceAll("-", ".")}
              </span>
            </div>
            <h3>
              {n.title}
              {n.status === "learning" && (
                <span className="status-tag">待理解</span>
              )}
            </h3>
            <p>{q ? n.snippet : n.summary}</p>
            <div className="tags">
              {n.tags.slice(0, 4).map((t) => (
                <span key={t}>#{t}</span>
              ))}
            </div>
          </div>
          <ArrowUpRight size={17} className="card-arrow" />
        </button>
      ))}
    </div>
  );
  const renderRelations = (relations: Detail["relations"]) => (
    <>
      {(
        [
          ["prerequisites", "前置知识"],
          ["related", "相关知识"],
          ["dependents", "被这些知识引用"],
        ] as const
      ).map(([key, label]) => (
        <section className="relation-section" key={key}>
          <div className="relation-title">
            {label}
            <span>{relations[key].length}</span>
          </div>
          {relations[key].length ? (
            relations[key].map((r) => (
              <button
                key={r.id}
                disabled={r.missing}
                className={`relation-item ${r.missing ? "missing" : ""}`}
                onClick={() => read(r.id)}
              >
                <span>
                  {r.missing ? (
                    <AlertCircle size={14} />
                  ) : (
                    <FileText size={14} />
                  )}
                </span>
                <div>
                  {r.title}
                  <small>
                    {r.missing
                      ? "目标不存在 · 待修复"
                      : r.category?.slice(-2).join(" / ")}
                  </small>
                </div>
                {!r.missing && <ChevronRight size={13} />}
              </button>
            ))
          ) : (
            <p className="relation-empty">暂无{label}</p>
          )}
        </section>
      ))}
    </>
  );
  return (
    <div className="app-shell">
      {(leftOpen || rightOpen) && (
        <div
          className="mobile-scrim"
          onClick={() => {
            setLeftOpen(false);
            setRightOpen(false);
          }}
        />
      )}
      <aside className={`sidebar ${leftOpen ? "mobile-open" : ""}`}>
        <button className="brand" onClick={() => navigate("home")}>
          <span className="brand-symbol">
            <Grid2X2 size={21} />
          </span>
          <span>
            知序<small>KNOWLEDGE GARDEN</small>
          </span>
        </button>
        <div className="workspace">
          <span className="workspace-avatar">我</span>
          <div>
            我的知识空间<small>让理解不断生长</small>
          </div>
          <span className="local-dot" title="本地知识库" />
        </div>
        <nav className="main-nav">
          <button
            className={view === "home" ? "active" : ""}
            onClick={() => navigate("home")}
          >
            <Grid2X2 size={17} />
            概览
          </button>
          <button
            className={view === "library" || view === "detail" ? "active" : ""}
            onClick={() => {
              setCategory([]);
              setTag("");
              navigate("library");
            }}
          >
            <BookOpen size={17} />
            知识库<span>{stats.total}</span>
          </button>
          <button
            className={view === "review" ? "active" : ""}
            onClick={() => navigate("review")}
          >
            <RotateCcw size={17} />
            今日复习
            {stats.due > 0 && <span className="badge">{stats.due}</span>}
          </button>
          <button
            className={view === "timeline" ? "active" : ""}
            onClick={() => navigate("timeline")}
          >
            <CalendarDays size={17} />
            学习时间线
          </button>
          <button
            className={view === "graph" ? "active" : ""}
            disabled={!all.length}
            onClick={() => {
              if (!selected) setSelected(all[0]?.id);
              navigate("graph");
            }}
          >
            <Network size={17} />
            知识网络
          </button>
        </nav>
        <div className="directory-heading">
          知识目录 <span>{categories.length}</span>
        </div>
        <label className="directory-search">
          <Search size={13} />
          <input
            placeholder="查找目录或知识点"
            aria-label="查找目录"
            value={dirQuery}
            onChange={(e) => setDirQuery(e.target.value)}
          />
        </label>
        <div className="tree">
          <Tree
            paths={categories}
            selected={category}
            notes={all}
            query={dirQuery}
            active={selected || undefined}
            onSelect={(p) => {
              setCategory(p);
              setView("library");
              setLeftOpen(false);
            }}
            onNote={read}
          />
          {!all.length && (
            <p className="muted tiny">导入知识后，目录会自动出现。</p>
          )}
        </div>
        <div className="sidebar-bottom">
          <span className="local-dot" />
          本地存储 · 属于你的知识
          <button
            title="重新扫描文件夹"
            aria-label="重新扫描"
            onClick={() =>
              api("/rescan", { method: "POST" })
                .then(refresh)
                .catch((e) => setError(e.message))
            }
          >
            <RefreshCw size={14} />
          </button>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <button
            className="icon-btn mobile-only"
            aria-label="打开目录"
            onClick={() => setLeftOpen(true)}
          >
            <PanelLeft size={18} />
          </button>
          <div className="breadcrumb">
            我的空间
            <ChevronRight size={13} />
            <span>
              {
                {
                  home: "概览",
                  library: "知识库",
                  detail: "知识库",
                  review: "今日复习",
                  timeline: "学习时间线",
                  graph: "知识网络",
                }[view]
              }
            </span>
          </div>
          <div className="header-actions">
            <label className="global-search">
              <Search size={16} />
              <input
                ref={searchRef}
                placeholder="搜索你的知识…"
                aria-label="搜索知识"
                value={q}
                onChange={(e) => {
                  setQ(e.target.value);
                  setView("library");
                }}
              />
              <kbd>⌘ K</kbd>
            </label>
            <button
              className="btn primary import-button"
              onClick={() => {
                setImportOpen(true);
                setResults([]);
              }}
            >
              <Plus size={16} />
              <span>导入知识</span>
            </button>
            {view === "detail" && (
              <button
                className="icon-btn relation-toggle"
                aria-label="打开关联"
                onClick={() => setRightOpen(true)}
              >
                <PanelRight size={18} />
              </button>
            )}
          </div>
        </header>
        {error && (
          <div className="error global-error">
            <AlertCircle size={16} />
            {error}
            <button aria-label="关闭错误" onClick={() => setError("")}>
              <X size={14} />
            </button>
          </div>
        )}
        <div
          className={`body-layout ${view === "detail" ? "with-relations" : ""}`}
        >
          <main
            className={`main-content ${view === "graph" ? "graph-main" : ""}`}
          >
            {loading ? (
              <div className="empty">
                <span className="spinner" />
                正在打开你的知识空间…
              </div>
            ) : (
              <>
                {view === "home" && (
                  <>
                    <div className="page-intro">
                      <div>
                        <div className="eyebrow">
                          A LITTLE MORE UNDERSTANDING, EVERY DAY
                        </div>
                        <h1>让知识，慢慢连成一片。</h1>
                        <p>记录每一次理解，在回顾中发现新的联系。</p>
                      </div>
                      <span className="date-pill">
                        <CalendarDays size={14} />
                        {stats.today.replaceAll("-", " / ")}
                      </span>
                    </div>
                    <div className="stat-grid">
                      {[
                        {
                          icon: BookOpen,
                          label: "知识点",
                          value: stats.total,
                          foot: "每一个，都是新的理解",
                        },
                        {
                          icon: Folder,
                          label: "知识目录",
                          value: stats.categories,
                          foot: "沿着好奇心不断深入",
                        },
                        {
                          icon: RotateCcw,
                          label: "待复习",
                          value: stats.due,
                          foot: "把学过的，变成掌握的",
                        },
                        {
                          icon: Leaf,
                          label: "待理解",
                          value: stats.learning,
                          foot: "为还未解开的疑问留白",
                        },
                      ].map(({ icon: Icon, label, value, foot }, i) => (
                        <button
                          key={label}
                          className={`stat-card stat-${i}`}
                          onClick={() => {
                            if (i === 2) navigate("review");
                            else navigate("library");
                          }}
                        >
                          <div>
                            <span>{label}</span>
                            <Icon size={18} />
                          </div>
                          <strong>
                            {value}
                            <small>个</small>
                          </strong>
                          <p>{foot}</p>
                        </button>
                      ))}
                    </div>
                    <Heatmap
                      days={stats.days}
                      today={stats.today}
                      onDay={setSelectedDay}
                    />
                    {selectedDay && (
                      <section className="day-panel">
                        <div className="section-line">
                          <h3>
                            {selectedDay} · 新增 {dayItems.length} 个知识点
                          </h3>
                          <button
                            className="icon-btn"
                            aria-label="关闭当日新增"
                            onClick={() => setSelectedDay("")}
                          >
                            <X size={16} />
                          </button>
                        </div>
                        {dayItems.length ? (
                          dayItems.map((n) => (
                            <button
                              className="day-item"
                              key={n.id}
                              disabled={!n.active && n.resolved_id === n.id}
                              onClick={() => read(n.resolved_id)}
                            >
                              <FileText size={15} />
                              {n.title}
                              {!n.active && (
                                <small>
                                  {n.resolved_id !== n.id ? "已合并" : "已移除"}
                                </small>
                              )}
                            </button>
                          ))
                        ) : (
                          <p className="muted">这一天还没有新增记录。</p>
                        )}
                      </section>
                    )}
                    <div className="home-bottom">
                      <section>
                        <div className="section-line">
                          <h2>
                            最近更新
                            <span className="heading-count">{stats.total}</span>
                          </h2>
                          <button
                            className="text-btn"
                            onClick={() => navigate("library")}
                          >
                            全部知识
                            <ArrowUpRight size={14} />
                          </button>
                        </div>
                        {all.length ? (
                          renderList(
                            [...all]
                              .sort((a, b) =>
                                b.updated_at.localeCompare(a.updated_at),
                              )
                              .slice(0, 4),
                            true,
                          )
                        ) : (
                          <div className="empty empty-card">
                            <BookOpen size={32} />
                            <h3>从第一个知识点开始</h3>
                            <p>
                              将 skill 生成的 Markdown 拖入这里，
                              <br />
                              或放进本地 content 文件夹。
                            </p>
                            <button
                              className="btn primary"
                              onClick={() => setImportOpen(true)}
                            >
                              导入 Markdown
                            </button>
                          </div>
                        )}
                      </section>
                      <aside className="review-prompt">
                        <span className="prompt-icon">
                          <RotateCcw size={21} />
                        </span>
                        <div className="eyebrow">SPACED REPETITION</div>
                        <h2>温故，然后知新。</h2>
                        <p>
                          {stats.due
                            ? `今天有 ${stats.due} 个知识点等待回顾。花一点时间，让理解更牢固。`
                            : "今天没有到期的复习。新知识会从明天开始，陆续出现在这里。"}
                        </p>
                        <button
                          className="btn"
                          onClick={() => navigate("review")}
                        >
                          进入复习
                          <ArrowUpRight size={15} />
                        </button>
                        <div className="prompt-decoration">
                          <span />
                          <span />
                          <span />
                          <span />
                          <span />
                        </div>
                        <small>理解不是一次完成的。</small>
                      </aside>
                    </div>
                    {stats.errors.length > 0 && (
                      <div className="issues">
                        <button
                          className="text-btn"
                          onClick={() => setShowIssues(!showIssues)}
                        >
                          <AlertCircle size={15} />
                          {stats.errors.length} 个文件或关联需要处理
                          <ChevronDown size={14} />
                        </button>
                        {showIssues &&
                          stats.errors.map((e, i) => (
                            <p key={i}>
                              <b>{e.file}</b>：{e.message}
                            </p>
                          ))}
                      </div>
                    )}
                  </>
                )}
                {view === "library" && (
                  <>
                    <div className="section-line">
                      <div>
                        <div className="eyebrow">YOUR COLLECTION</div>
                        <h1>
                          {category.length
                            ? category[category.length - 1]
                            : "所有知识"}
                        </h1>
                        <p>
                          {category.length
                            ? category.join(" / ")
                            : "把零散的理解，整理成自己的知识。"}
                        </p>
                      </div>
                      <span className="count-pill">
                        {notes.length} 个知识点
                      </span>
                    </div>
                    <div className="filter-row">
                      <select
                        aria-label="筛选分类"
                        value={category.length ? JSON.stringify(category) : ""}
                        onChange={(e) =>
                          setCategory(
                            e.target.value ? JSON.parse(e.target.value) : [],
                          )
                        }
                      >
                        <option value="">全部目录</option>
                        {categories.map((c) => (
                          <option
                            key={JSON.stringify(c)}
                            value={JSON.stringify(c)}
                          >
                            {c.join(" / ")}
                          </option>
                        ))}
                      </select>
                      <select
                        aria-label="筛选标签"
                        value={tag}
                        onChange={(e) => setTag(e.target.value)}
                      >
                        <option value="">全部关键词</option>
                        {[...new Set(all.flatMap((n) => n.tags))]
                          .sort()
                          .map((t) => (
                            <option key={t}>{t}</option>
                          ))}
                      </select>
                      {(q || category.length > 0 || tag) && (
                        <button
                          className="text-btn"
                          onClick={() => {
                            setQ("");
                            setCategory([]);
                            setTag("");
                          }}
                        >
                          清除筛选
                          <X size={13} />
                        </button>
                      )}
                    </div>
                    {notes.length ? (
                      renderList(notes)
                    ) : (
                      <div className="empty">
                        <Search size={30} />
                        <h3>没有找到匹配的知识</h3>
                        <p>试试其他关键词，或导入新的 Markdown。</p>
                      </div>
                    )}
                  </>
                )}
                {view === "detail" &&
                  (detail ? (
                    <article className="article">
                      <button
                        className="text-btn back"
                        onClick={() => navigate("library")}
                      >
                        <ArrowLeft size={14} />
                        返回知识库
                      </button>
                      <div className="eyebrow">
                        {detail.category.join(" / ")}
                      </div>
                      <h1>{detail.title}</h1>
                      <p className="article-summary">{detail.summary}</p>
                      <div className="article-meta">
                        <span>
                          <Clock size={14} />
                          {detail.learning_events.find((e) => e.date)?.date ||
                            "学习日期未知"}
                        </span>
                        <span>
                          {detail.status === "learning" ? "待理解" : "已整理"}
                        </span>
                        <span>更新于 {detail.updated_at.slice(0, 10)}</span>
                      </div>
                      <div className="article-tags">
                        {detail.tags.map((t) => (
                          <button
                            key={t}
                            onClick={() => {
                              setTag(t);
                              setView("library");
                            }}
                          >
                            #{t}
                          </button>
                        ))}
                      </div>
                      <Markdown body={detail.body} />
                      <section className="learning-log">
                        <h3>学习足迹</h3>
                        {detail.learning_events.map((e, i) => (
                          <div key={i}>
                            <time>{e.date || "日期未知"}</time>
                            <p>{e.summary}</p>
                          </div>
                        ))}
                      </section>
                      <section className="article-review">
                        <div>
                          <h3>让这个知识点留下来</h3>
                          <p>
                            {detail.review.paused
                              ? "已暂停复习"
                              : `下次复习：${detail.review.due} · 第 ${detail.review.stage + 1} 档`}
                          </p>
                        </div>
                        <div className="button-row">
                          <button
                            className="btn"
                            onClick={() =>
                              changeReview(detail.id, {
                                paused: !detail.review.paused,
                              })
                            }
                          >
                            {detail.review.paused ? (
                              <Play size={14} />
                            ) : (
                              <Pause size={14} />
                            )}{" "}
                            {detail.review.paused ? "恢复" : "暂停"}
                          </button>
                          <button
                            className="btn primary"
                            onClick={async () => {
                              await changeReview(detail.id, {
                                immediate: true,
                              });
                              navigate("review");
                            }}
                          >
                            立即复习
                          </button>
                        </div>
                      </section>
                    </article>
                  ) : (
                    <div className="empty">
                      {error
                        ? "知识点暂不可用，请返回知识库查看。"
                        : "正在读取知识点…"}
                    </div>
                  ))}
                {view === "review" && (
                  <>
                    <div className="section-line">
                      <div>
                        <div className="eyebrow">MAKE IT YOURS</div>
                        <h1>今日复习</h1>
                        <p>先试着回忆，再打开答案。理解会在这里变得牢固。</p>
                      </div>
                      <span className="count-pill">
                        剩余 {reviewQueue.length} 个
                      </span>
                    </div>
                    {current ? (
                      <section className="review-card" key={current.id}>
                        <div className="eyebrow">
                          {current.category.join(" / ")}
                        </div>
                        <h2>{current.title}</h2>
                        <p className="article-summary">{current.summary}</p>
                        <div className="recall-prompt">
                          <Leaf size={20} />
                          <span>你能用自己的话解释这个知识点吗？</span>
                        </div>
                        {revealed ? (
                          <>
                            <Markdown body={current.body} />
                            <div className="rating-row">
                              <button
                                className="btn"
                                disabled={ratingBusy}
                                onClick={() => rate(current.id, "again")}
                              >
                                没掌握<small>1 天后</small>
                              </button>
                              <button
                                className="btn"
                                disabled={ratingBusy}
                                onClick={() => rate(current.id, "hard")}
                              >
                                模糊
                                <small>
                                  {[1, 3, 7, 14, 30, 60][current.review.stage]}{" "}
                                  天后
                                </small>
                              </button>
                              <button
                                className="btn primary"
                                disabled={ratingBusy}
                                onClick={() => rate(current.id, "good")}
                              >
                                掌握
                                <small>
                                  {
                                    [1, 3, 7, 14, 30, 60][
                                      Math.min(5, current.review.stage + 1)
                                    ]
                                  }{" "}
                                  天后
                                </small>
                              </button>
                            </div>
                          </>
                        ) : (
                          <button
                            className="btn primary reveal"
                            onClick={() => setRevealed(true)}
                          >
                            <BookOpen size={17} />
                            展开知识点
                          </button>
                        )}
                        <button
                          className="text-btn pause-review"
                          onClick={() => {
                            setRevealed(false);
                            changeReview(current.id, { paused: true });
                          }}
                        >
                          暂停这个知识点的复习
                        </button>
                      </section>
                    ) : (
                      <div className="empty empty-review">
                        <span className="complete-icon">
                          <Check size={30} />
                        </span>
                        <h2>今天的回顾，完成了。</h2>
                        <p>给知识一点时间，下次再见。</p>
                        <button
                          className="btn"
                          onClick={() => navigate("library")}
                        >
                          浏览知识库
                          <ArrowUpRight size={15} />
                        </button>
                      </div>
                    )}
                  </>
                )}
                {view === "timeline" && (
                  <>
                    <div className="eyebrow">TRACES OF LEARNING</div>
                    <h1>学习时间线</h1>
                    <p className="page-description">
                      回到理解发生的那一天。这里记录学习日期，而非导入日期。
                    </p>
                    <div className="filter-row">
                      <input
                        aria-label="开始日期"
                        type="date"
                        value={fromDate}
                        onChange={(e) => setFromDate(e.target.value)}
                      />
                      <span className="muted">至</span>
                      <input
                        aria-label="结束日期"
                        type="date"
                        value={toDate}
                        onChange={(e) => setToDate(e.target.value)}
                      />
                      <select
                        aria-label="时间线分类"
                        value={category.length ? JSON.stringify(category) : ""}
                        onChange={(e) =>
                          setCategory(
                            e.target.value ? JSON.parse(e.target.value) : [],
                          )
                        }
                      >
                        <option value="">全部目录</option>
                        {categories.map((c) => (
                          <option
                            key={JSON.stringify(c)}
                            value={JSON.stringify(c)}
                          >
                            {c.join(" / ")}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="timeline">
                      {timeline
                        .filter(
                          (e) =>
                            (!fromDate || (e.date && e.date >= fromDate)) &&
                            (!toDate || (e.date && e.date <= toDate)) &&
                            category.every((c, i) => e.category[i] === c),
                        )
                        .map((e, i) => (
                          <div className="timeline-item" key={`${e.id}-${i}`}>
                            <time>{e.date || "日期未知"}</time>
                            <span className="timeline-dot" />
                            <button onClick={() => read(e.id)}>
                              <small>{e.category.join(" / ")}</small>
                              <h3>{e.title}</h3>
                              <p>{e.summary}</p>
                            </button>
                          </div>
                        ))}
                    </div>
                    {!timeline.length && (
                      <div className="empty">
                        导入带有学习事件的知识点后，时间线会出现在这里。
                      </div>
                    )}
                  </>
                )}
                {view === "graph" && selected && (
                  <Suspense
                    fallback={<div className="empty">正在打开知识网络…</div>}
                  >
                    <Graph
                      revision={stats.version}
                      id={selected}
                      categories={categories}
                      onRead={read}
                    />
                  </Suspense>
                )}
              </>
            )}
            <footer className="page-footer">
              <span>知序 · 让每一点理解都有迹可循</span>
              <span>Markdown 驱动 · 本地保存</span>
            </footer>
          </main>
          {view === "detail" && (
            <aside
              className={`relations-sidebar ${rightOpen ? "mobile-open" : ""}`}
            >
              <div className="section-line">
                <h3>知识关联</h3>
                <Network size={17} />
              </div>
              <p className="relation-subtitle">理解，从连接开始。</p>
              {detail && renderRelations(detail.relations)}
              <button
                className="network-link"
                onClick={() => {
                  setView("graph");
                  setRightOpen(false);
                }}
              >
                <Network size={18} />
                <div>
                  查看知识网络<small>探索两跳内的知识联系</small>
                </div>
                <ArrowUpRight size={15} />
              </button>
            </aside>
          )}
        </div>
      </div>
      {importOpen && (
        <div
          className="modal-backdrop"
          onClick={() => !importing && setImportOpen(false)}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="import-title"
            className="modal"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="section-line">
              <h2 id="import-title">导入知识</h2>
              <button
                className="icon-btn"
                disabled={importing}
                aria-label="关闭导入"
                onClick={() => setImportOpen(false)}
              >
                <X size={19} />
              </button>
            </div>
            <p>把整理好的 Markdown，放进你的知识空间。</p>
            <button
              className="drop-zone"
              disabled={importing}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                if (!importing) upload(e.dataTransfer.files);
              }}
              onClick={() => fileRef.current?.click()}
            >
              <span className="upload-icon">
                <Upload size={26} />
              </span>
              <h3>{importing ? "正在导入…" : "拖拽 Markdown 文件到这里"}</h3>
              <p>或点击选择文件 · 每篇最多 2 MB</p>
            </button>
            <input
              ref={fileRef}
              type="file"
              multiple
              accept=".md"
              hidden
              onChange={(e) => e.target.files && upload(e.target.files)}
            />
            <div className="import-hint">
              <Folder size={16} />
              <span>
                也可将文件放入本地 <code>content/</code> 目录，网站会自动加载。
              </span>
            </div>
            {results.length > 0 && (
              <div className="import-results" aria-live="polite">
                {results.map((r, i) => (
                  <div key={i} className={r.status === "error" ? "failed" : ""}>
                    {r.status === "error" ? (
                      <AlertCircle size={16} />
                    ) : (
                      <Check size={16} />
                    )}
                    <div>
                      <b>{r.filename}</b>
                      <small>
                        {r.message ||
                          {
                            created: "已新增",
                            updated: "已更新，复习进度已保留",
                            skipped: "内容相同，已跳过",
                          }[r.status]}
                      </small>
                    </div>
                  </div>
                ))}
              </div>
            )}
            <div className="modal-bottom">
              <span>同 ID 更新 · 相同内容自动跳过</span>
              <button
                className="btn"
                disabled={importing}
                onClick={() => setImportOpen(false)}
              >
                完成
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
