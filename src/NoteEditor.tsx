import { formatMarkdown } from "./markdownActions";
import EditorToolbar from "./EditorToolbar";
import { EditorContent } from "@tiptap/react";
import { useVisualEditor } from "./useVisualEditor";
import { EditorHistory, type EditorSnapshot } from "./editorHistory";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import PasteImport from "./PasteImport";
import { api } from "./types";
import { newDocument, splitDocument, joinDocument } from "./editorDocument";

export default function NoteEditor({
  id,
  category,
  onClose,
  onSaved,
  startPaste,
  onImported,
}: {
  id?: string;
  startPaste?: boolean;
  onImported: () => Promise<void>;
  category: string[];
  onClose: () => void;
  onSaved: (id: string) => Promise<void>;
}) {
  const [draft, setDocument] = useState(() => newDocument(category));
  const { meta, body: text } = draft;
  const history = useRef(new EditorHistory(draft.body));
  const [mode, setMode] = useState<"split" | "visual">("split");
  const panes = useRef<HTMLDivElement>(null);
  const [split, setSplit] = useState(() => {
    try {
      const saved = Number(localStorage.getItem("knowledge-editor-split"));
      return saved >= 20 && saved <= 80 ? saved : 50;
    } catch {
      return 50;
    }
  });
  const [resizing, setResizing] = useState(false);
  const resize = (value: number) => setSplit(Math.max(20, Math.min(80, value)));
  useEffect(() => {
    try {
      localStorage.setItem("knowledge-editor-split", String(split));
    } catch {}
  }, [split]);
  useEffect(() => {
    if (!resizing) return;
    document.body.classList.add("resizing-editor");
    return () => document.body.classList.remove("resizing-editor");
  }, [resizing]);
  const [surface, setSurface] = useState<"source" | "rich">("source");
  const command = useRef(false);
  const setText = (body: string, group = "") => {
    history.current.record({ text: body }, group);
    setDocument((d) => ({ ...d, body }));
  };
  const setMeta = (patch: Partial<typeof meta>) =>
    setDocument((d) => ({ ...d, meta: { ...d.meta, ...patch } }));
  const [initial, setInitial] = useState(() => JSON.stringify(draft));
  const [step, setStep] = useState(startPaste ? "paste" : id ? "body" : "meta");
  const [categoryText, setCategoryText] = useState(
    category.length ? category.join(" / ") : "未分类",
  );
  const [tagsText, setTagsText] = useState("");
  const [knowledgeText, setKnowledgeText] = useState("");
  const [dependencyText, setDependencyText] = useState("");
  const [hash, setHash] = useState("");
  const [loading, setLoading] = useState(!!id);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [discard, setDiscard] = useState(false);
  const source = useRef<HTMLTextAreaElement>(null);
  const preview = useRef<HTMLDivElement>(null);
  const syncTarget = useRef<HTMLElement | null>(null);
  const [pasteDirty, setPasteDirty] = useState(false);
  const dirty = JSON.stringify(draft) !== initial || pasteDirty;
  const visual = useVisualEditor(
    text,
    (body) => {
      setText(body, command.current ? "" : "rich");
      command.current = false;
    },
    () => setSurface("rich"),
    busy || loading,
  );
  const restore = (snapshot: EditorSnapshot | null) => {
    if (!snapshot) return;
    setDocument((d) => ({ ...d, body: snapshot.text }));
    const selection = snapshot.selection;
    if (selection)
      requestAnimationFrame(() => {
        if (selection.surface === "source" && mode === "split") {
          source.current?.focus();
          source.current?.setSelectionRange(selection.from, selection.to);
        } else if (selection.surface === "rich" && visual) {
          const max = visual.state.doc.content.size;
          visual
            .chain()
            .focus()
            .setTextSelection({
              from: Math.min(selection.from, max),
              to: Math.min(selection.to, max),
            })
            .run();
        }
      });
  };
  useEffect(() => {
    if (!visual) return;
    const remember = () => {
      const { from, to } = visual.state.selection;
      if (visual.isFocused)
        history.current.current.selection = { from, to, surface: "rich" };
    };
    visual.on("selectionUpdate", remember);
    return () => {
      visual.off("selectionUpdate", remember);
    };
  }, [visual]);
  const undo = () => restore(history.current.undo());
  const redo = () => restore(history.current.redo());
  useEffect(() => {
    let alive = true;
    if (id)
      api<{ text: string; hash: string }>(
        `/notes/${encodeURIComponent(id)}/source`,
      )
        .then((x) => {
          if (alive) {
            const parsed = splitDocument(x.text);
            setDocument(parsed);
            history.current.reset(parsed.body);
            setInitial(JSON.stringify(parsed));
            setCategoryText(parsed.meta.category.join(" / "));
            setTagsText(parsed.meta.tags.join("，"));
            setKnowledgeText(parsed.meta.knowledge_keywords.join("，"));
            setDependencyText(parsed.meta.dependency_keywords.join("，"));
            setHash(x.hash);
          }
        })
        .catch((e) => alive && setError(e.message))
        .finally(() => alive && setLoading(false));
    const old = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      alive = false;
      document.body.style.overflow = old;
    };
  }, [id]);
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (dirty) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  const validateMeta = () => {
    if (!meta.title.trim() || !meta.summary.trim() || !meta.category.length) {
      setError("请填写标题、简介和至少一级分类");
      setStep("meta");
      return false;
    }
    if (meta.learning_events.some((e) => !e.summary.trim())) {
      setError("请填写学习记录说明");
      setStep("meta");
      return false;
    }
    setError("");
    return true;
  };
  const sync = (from: HTMLElement, to: HTMLElement | null) => {
    if (syncTarget.current === from) {
      syncTarget.current = null;
      return;
    }
    if (!to) return;
    const range = from.scrollHeight - from.clientHeight;
    const target =
      (range > 0 ? from.scrollTop / range : 0) *
      (to.scrollHeight - to.clientHeight);
    if (Math.abs(to.scrollTop - target) > 1) {
      syncTarget.current = to;
      to.scrollTop = target;
    }
  };
  const save = async () => {
    if (loading || busy || (id && !hash) || !validateMeta()) return;
    if (!text.trim()) {
      setError("请填写知识点正文");
      setStep("body");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const result = await api<{ id: string }>(
        id ? `/notes/${encodeURIComponent(id)}` : "/notes",
        {
          method: id ? "PUT" : "POST",
          body: JSON.stringify({
            text: joinDocument(meta, text),
            expected_hash: hash,
          }),
        },
      );
      await onSaved(result.id);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section
      className="note-editor"
      role="dialog"
      aria-modal="true"
      aria-label={id ? "编辑知识点" : "新建知识点"}
      onKeyDownCapture={(e) => {
        if (
          step !== "body" ||
          busy ||
          e.nativeEvent.isComposing ||
          !(e.metaKey || e.ctrlKey)
        )
          return;
        const key = e.key.toLowerCase();
        if (key === "z" || key === "y") {
          e.preventDefault();
          e.stopPropagation();
          if (key === "y" || e.shiftKey) redo();
          else undo();
        } else if (key === "s") {
          e.preventDefault();
          save();
        }
      }}
    >
      <header className="editor-header">
        <div>
          <h2>{id ? "编辑知识点" : "新建知识点"}</h2>
          <small>
            {step === "paste"
              ? "自动识别 · 预览后批量导入"
              : `${dirty ? "有未保存的修改" : "Markdown 与预览"} · ${mode === "split" ? "双向编辑 · 同步滚动" : "所见即所得"}`}
          </small>
        </div>
        <nav className="editor-steps" aria-label="编辑步骤">
          {!id && (
            <button
              disabled={busy}
              className={step === "paste" ? "active" : ""}
              onClick={() => setStep("paste")}
            >
              粘贴 AI 结果
            </button>
          )}
          <button
            className={step === "meta" ? "active" : ""}
            disabled={busy}
            onClick={() => setStep("meta")}
          >
            基本信息
          </button>
          <button
            disabled={busy}
            className={step === "body" ? "active" : ""}
            onClick={() => {
              if (validateMeta()) setStep("body");
            }}
          >
            正文编辑
          </button>
        </nav>
        <div className="editor-actions">
          <button
            className="btn"
            disabled={busy}
            onClick={() => (dirty ? setDiscard(true) : onClose())}
          >
            {step === "paste" ? "完成" : "取消"}
          </button>
          <button
            className="btn primary"
            style={step === "paste" ? { display: "none" } : undefined}
            disabled={step === "paste" || loading || busy || (!!id && !hash)}
            onClick={save}
          >
            {busy ? "保存中…" : "保存知识点"}
          </button>
        </div>
      </header>

      {error && (
        <div role="alert" className="editor-error">
          {error}
        </div>
      )}
      {!id && (
        <div className="paste-container" hidden={step !== "paste"}>
          <PasteImport
            onImported={onImported}
            onBusy={setBusy}
            onDirty={setPasteDirty}
          />
        </div>
      )}
      {step === "meta" && (
        <div className="editor-metadata">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (validateMeta()) setStep("body");
            }}
          >
            <h3>先为知识点填写基本信息</h3>
            <p className="muted">填写后开始写正文，保存前也可以回来修改。</p>
            <fieldset disabled={loading || busy}>
              <label>
                标题 <span>*</span>
                <input
                  required
                  autoFocus
                  value={meta.title}
                  onChange={(e) => setMeta({ title: e.target.value })}
                  placeholder="这个知识点回答什么问题？"
                />
              </label>
              <label>
                简介 <span>*</span>
                <textarea
                  required
                  value={meta.summary}
                  onChange={(e) => setMeta({ summary: e.target.value })}
                  placeholder="用一两句话说明主要内容"
                  rows={3}
                />
              </label>
              <div className="metadata-row">
                <label>
                  分类 <span>*</span>
                  <input
                    required
                    value={categoryText}
                    onChange={(e) => {
                      setCategoryText(e.target.value);
                      setMeta({
                        category: e.target.value
                          .split("/")
                          .map((x) => x.trim())
                          .filter(Boolean),
                      });
                    }}
                    placeholder="计算机 / 人工智能 / Agent"
                  />
                  <small>使用 / 分隔目录层级</small>
                </label>
                <label>
                  检索标签
                  <input
                    value={tagsText}
                    onChange={(e) => {
                      setTagsText(e.target.value);
                      setMeta({
                        tags: e.target.value
                          .split(/[,，]/)
                          .map((x) => x.trim())
                          .filter(Boolean),
                      });
                    }}
                    placeholder="用逗号分隔"
                  />
                </label>
              </div>
              <div className="metadata-row">
                <label>
                  当前知识关键词
                  <input
                    value={knowledgeText}
                    onChange={(e) => {
                      setKnowledgeText(e.target.value);
                      setMeta({
                        knowledge_keywords: e.target.value
                          .split(/[,，]/)
                          .map((x) => x.trim())
                          .filter(Boolean),
                      });
                    }}
                    placeholder="本篇实际讲解的概念，用逗号分隔"
                  />
                  <small>
                    使用具体、标准的概念名称；与依赖关键词匹配后自动建立关联。
                  </small>
                </label>
                <label>
                  依赖关键词
                  <input
                    value={dependencyText}
                    onChange={(e) => {
                      setDependencyText(e.target.value);
                      setMeta({
                        dependency_keywords: e.target.value
                          .split(/[,，]/)
                          .map((x) => x.trim())
                          .filter(Boolean),
                      });
                    }}
                    placeholder="理解本篇需要先掌握的概念，用逗号分隔"
                  />
                  <small>
                    没有前置要求可留空；尚无匹配知识时，保留关键词等待后续匹配。
                  </small>
                </label>
              </div>
              <label>
                内容状态
                <select
                  value={meta.status}
                  onChange={(e) => setMeta({ status: e.target.value })}
                >
                  <option value="learning">待理解</option>
                  <option value="ready">已整理</option>
                </select>
              </label>
              <div className="metadata-events">
                <h4>学习记录</h4>
                <p className="muted">日期未知可留空；已有记录会完整保留。</p>
                {meta.learning_events.map((event, i) => (
                  <div className="metadata-event" key={i}>
                    <label>
                      学习日期 {i + 1}
                      <input
                        type="date"
                        value={event.date || ""}
                        onChange={(e) =>
                          setMeta({
                            learning_events: meta.learning_events.map((x, j) =>
                              j === i
                                ? { ...x, date: e.target.value || null }
                                : x,
                            ),
                          })
                        }
                      />
                    </label>
                    <label>
                      学习说明 {i + 1}
                      <input
                        required
                        value={event.summary}
                        onChange={(e) =>
                          setMeta({
                            learning_events: meta.learning_events.map((x, j) =>
                              j === i ? { ...x, summary: e.target.value } : x,
                            ),
                          })
                        }
                      />
                    </label>
                    <button
                      type="button"
                      className="btn"
                      aria-label={`移除学习记录 ${i + 1}`}
                      onClick={() =>
                        setMeta({
                          learning_events: meta.learning_events.filter(
                            (_, j) => j !== i,
                          ),
                        })
                      }
                    >
                      移除
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  className="btn"
                  onClick={() =>
                    setMeta({
                      learning_events: [
                        ...meta.learning_events,
                        { date: null, summary: "" },
                      ],
                    })
                  }
                >
                  添加学习记录
                </button>
              </div>
              <button className="btn primary" type="submit">
                开始编辑正文
              </button>
            </fieldset>
          </form>
        </div>
      )}
      <div className="editor-body" hidden={step !== "body"}>
        <div className="editor-controls">
          <EditorToolbar
            source={source}
            editor={visual}
            surface={surface}
            onChange={(body) => setText(body)}
            onError={setError}
            onBusy={setBusy}
            undo={undo}
            redo={redo}
            canUndo={history.current.past.length > 0}
            canRedo={history.current.future.length > 0}
            disabled={loading || busy}
            onCommand={() => {
              command.current = true;
            }}
          />
          <div className="editor-mode" aria-label="编辑模式">
            <button
              disabled={busy}
              className={mode === "split" ? "active" : ""}
              onClick={() => setMode("split")}
            >
              分栏编辑
            </button>
            <button
              disabled={busy}
              className={mode === "visual" ? "active" : ""}
              onClick={() => {
                setMode("visual");
                setSurface("rich");
              }}
            >
              所见即所得
            </button>
          </div>
        </div>
        <div
          ref={panes}
          style={{ "--editor-split": `${split}%` } as CSSProperties}
          className={`editor-panes ${mode === "visual" ? "visual-only" : ""}`}
        >
          <section hidden={mode === "visual"}>
            <div className="editor-pane-label">Markdown</div>
            <textarea
              ref={source}
              aria-label="Markdown 编辑框"
              placeholder="在这里编写 Markdown 正文…"
              spellCheck={false}
              disabled={loading || busy}
              value={text}
              onSelect={(e) => {
                const el = e.currentTarget;
                history.current.current.selection = {
                  from: el.selectionStart,
                  to: el.selectionEnd,
                  surface: "source",
                };
              }}
              onFocus={() => setSurface("source")}
              onChange={(e) => setText(e.target.value, "source")}
              onScroll={(e) => sync(e.currentTarget, preview.current)}
              onPointerDown={() => {
                syncTarget.current = null;
                setSurface("source");
              }}
              onWheel={() => {
                syncTarget.current = null;
              }}
              onKeyDown={(e) => {
                if (
                  (e.ctrlKey || e.metaKey) &&
                  ["b", "i"].includes(e.key.toLowerCase())
                ) {
                  e.preventDefault();
                  const el = e.currentTarget;
                  const r = formatMarkdown(
                    el.value,
                    el.selectionStart,
                    el.selectionEnd,
                    e.key.toLowerCase() === "b" ? "bold" : "italic",
                  );
                  setText(r.text);
                  requestAnimationFrame(() =>
                    el.setSelectionRange(r.start, r.end),
                  );
                }
              }}
            />
          </section>
          {mode === "split" && (
            <div
              className={`editor-divider ${resizing ? "dragging" : ""}`}
              role="separator"
              aria-label="调整编辑区与预览区宽度"
              aria-orientation="vertical"
              aria-valuemin={20}
              aria-valuemax={80}
              aria-valuenow={Math.round(split)}
              aria-valuetext={`编辑区 ${Math.round(split)}%，预览区 ${100 - Math.round(split)}%`}
              tabIndex={0}
              title="拖动调整左右宽度 · 双击恢复均分"
              onPointerDown={(e) => {
                if (e.button !== 0) return;
                e.preventDefault();
                e.currentTarget.setPointerCapture(e.pointerId);
                setResizing(true);
              }}
              onPointerMove={(e) => {
                if (!resizing || !panes.current) return;
                const bounds = panes.current.getBoundingClientRect();
                if (bounds.width)
                  resize(((e.clientX - bounds.left) / bounds.width) * 100);
              }}
              onPointerUp={(e) => {
                setResizing(false);
                if (e.currentTarget.hasPointerCapture(e.pointerId))
                  e.currentTarget.releasePointerCapture(e.pointerId);
              }}
              onPointerCancel={() => setResizing(false)}
              onLostPointerCapture={() => setResizing(false)}
              onDoubleClick={() => resize(50)}
              onKeyDown={(e) => {
                if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key))
                  return;
                e.preventDefault();
                resize(
                  e.key === "Home"
                    ? 20
                    : e.key === "End"
                      ? 80
                      : split + (e.key === "ArrowLeft" ? -2 : 2),
                );
              }}
            />
          )}
          <section>
            <div className="editor-pane-label">
              {mode === "visual" ? "所见即所得" : "可编辑预览"} ·
              点击正文或表格即可编辑
            </div>
            <div
              className="editor-preview"
              ref={preview}
              onScroll={(e) => {
                if (mode === "split") sync(e.currentTarget, source.current);
              }}
              onPointerDown={() => {
                syncTarget.current = null;
                setSurface("rich");
              }}
              onWheel={() => {
                syncTarget.current = null;
              }}
            >
              <div className="visual-page">
                <h1>{meta.title}</h1>
                <p className="article-summary">{meta.summary}</p>
                <EditorContent editor={visual} />
              </div>
            </div>
          </section>
        </div>
      </div>
      {discard && (
        <div className="modal-backdrop">
          <section className="modal" role="alertdialog" aria-label="放弃编辑">
            <h2>放弃未保存的修改？</h2>
            <p>当前草稿尚未保存到知识库。</p>
            <div className="modal-bottom">
              <button className="btn" onClick={() => setDiscard(false)}>
                继续编辑
              </button>
              <button className="btn primary" onClick={onClose}>
                放弃修改
              </button>
            </div>
          </section>
        </div>
      )}
    </section>
  );
}
