import { useEffect, useId, useMemo, useState, type CSSProperties } from "react";
import ReactMarkdown from "react-markdown";
import {
  BookOpen,
  Check,
  ChevronDown,
  CircleHelp,
  Info,
  Lightbulb,
  Pause,
  Play,
  RotateCcw,
  Star,
  TriangleAlert,
} from "lucide-react";
import { markdownPlugins } from "./markdownPlugins";
import {
  parseWidget,
  studyFeedback,
  type StudyAction,
  type SequenceAction,
  type WidgetNode,
} from "./chatkitSchema";
import WidgetTransition from "./WidgetTransition";

const icons = {
  "book-open": BookOpen,
  check: Check,
  "circle-question": CircleHelp,
  info: Info,
  lightbulb: Lightbulb,
  refresh: RotateCcw,
  star: Star,
  warning: TriangleAlert,
};
const radii = { none: 0, xs: 2, sm: 4, md: 8, lg: 12, xl: 16, full: 9999 };
function RichText({ text }: { text: string }) {
  return <ReactMarkdown {...markdownPlugins}>{text}</ReactMarkdown>;
}
function WidgetImage({ node }: { node: WidgetNode }) {
  const [failed, setFailed] = useState(false);
  if (failed)
    return (
      <div className="ck-image-error" role="status">
        图片暂时无法加载：{node.alt || "请检查图片地址"}
      </div>
    );
  return (
    <img
      className={`ck-image ${node.frame ? "ck-image-frame" : ""}`}
      src={node.src}
      alt={node.alt || "知识点配图"}
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
      style={{
        width: node.width || "100%",
        height: node.height || "auto",
        objectFit: node.fit || "contain",
        objectPosition: node.position,
        borderRadius: node.radius ? radii[node.radius] : undefined,
        backgroundColor: node.background,
      }}
    />
  );
}

function SequencePlayer({ action }: { action: SequenceAction }) {
  const { frames, intervalMs = 1400 } = action.payload;
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  // Timers exist only while this player is visible and playing. Hidden tabs pause.
  useEffect(() => {
    const pause = () => {
      if (document.hidden) setPlaying(false);
    };
    document.addEventListener("visibilitychange", pause);
    return () => document.removeEventListener("visibilitychange", pause);
  }, []);
  useEffect(() => {
    if (!playing) return;
    const timer = window.setTimeout(() => {
      setIndex((current) => Math.min(current + 1, frames.length - 1));
      if (index + 1 >= frames.length - 1) setPlaying(false);
    }, intervalMs);
    return () => window.clearTimeout(timer);
  }, [playing, index, frames.length, intervalMs]);
  return (
    <section className="ck-sequence" aria-label="动画演示">
      <WidgetTransition version={index}>
        <WidgetNodeView key={index} node={frames[index]} />
      </WidgetTransition>
      <div className="ck-sequence-controls">
        <button
          type="button"
          className="ck-button"
          disabled={index === 0}
          onClick={() => {
            setPlaying(false);
            setIndex(index - 1);
          }}
        >
          上一步
        </button>
        <button
          type="button"
          className="ck-button"
          aria-label={playing ? "暂停动画" : "播放动画"}
          onClick={() => {
            if (!playing && index === frames.length - 1) setIndex(0);
            setPlaying(!playing);
          }}
        >
          {playing ? <Pause size={15} /> : <Play size={15} />}
          {playing ? "暂停" : "播放"}
        </button>
        <button
          type="button"
          className="ck-button"
          disabled={index === frames.length - 1}
          onClick={() => {
            setPlaying(false);
            setIndex(index + 1);
          }}
        >
          下一步
        </button>
        <button
          type="button"
          className="ck-button"
          onClick={() => {
            setPlaying(false);
            setIndex(0);
          }}
        >
          重置动画
        </button>
        <span role="status">
          第 {index + 1} / {frames.length} 步
        </span>
      </div>
    </section>
  );
}

function WidgetNodeView({ node: n }: { node: WidgetNode }) {
  const [feedback, setFeedback] = useState<ReturnType<
    typeof studyFeedback
  > | null>(null);
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState(n.defaultValue || "");
  const panelId = useId();
  function run(action: StudyAction, form: HTMLFormElement | null) {
    const values: Record<string, string> = Object.create(null);
    if (form)
      for (const [name, value] of new FormData(form))
        if (typeof value === "string") values[name] = value;
    setFeedback(studyFeedback(action, values));
  }
  const styles: CSSProperties = {
    gap: n.gap === undefined ? undefined : n.gap * 4,
    padding: n.padding === undefined ? undefined : n.padding * 4,
    fontWeight: n.weight
      ? { normal: 400, medium: 500, semibold: 600, bold: 700 }[n.weight]
      : undefined,
    textAlign: n.textAlign,
    alignItems: n.align,
    justifyContent: n.justify
      ? {
          start: "flex-start",
          center: "center",
          end: "flex-end",
          between: "space-between",
          around: "space-around",
          evenly: "space-evenly",
        }[n.justify]
      : undefined,
    flexWrap: n.wrap,
    flex: n.flex,
    // Flexible panels need a readable basis so wrap can actually take effect.
    minWidth: n.flex && n.width === undefined ? "min(140px, 100%)" : undefined,
    width: n.width,
    height: n.height,
    borderRadius: n.radius ? radii[n.radius] : undefined,
    backgroundColor: n.background,
  };
  const className = `ck-node ck-${n.type.toLowerCase()} ck-size-${n.size || "md"} ck-${n.color || "primary"} ck-variant-${n.variant || "soft"}`;
  const props = { className, style: styles, "data-widget-key": n.key };
  const children = Array.isArray(n.children)
    ? n.children.map((child, i) => (
        <WidgetNodeView key={child.key || i} node={child} />
      ))
    : null;
  const result = feedback && (
    <div className={`ck-feedback ck-${feedback.kind}`} role="status">
      <RichText text={feedback.text} />
    </div>
  );
  const action = n.onClickAction;
  const expandable =
    action?.type === "widget.toggle" || action?.type === "widget.sequence";
  const actionButton = (
    <button
      {...(n.type === "Button" ? props : { className: "ck-button" })}
      type={n.submit ? "submit" : "button"}
      disabled={n.disabled}
      aria-expanded={expandable ? open : undefined}
      aria-controls={expandable ? panelId : undefined}
      onClick={
        n.submit
          ? undefined
          : (event) => {
              if (
                action?.type === "widget.toggle" ||
                action?.type === "widget.sequence"
              )
                setOpen((previous) => !previous);
              else if (action) run(action, event.currentTarget.form);
            }
      }
    >
      {n.label || "查看详情"}
      {expandable && (
        <ChevronDown size={14} className={open ? "ck-chevron-open" : ""} />
      )}
    </button>
  );
  const actionContent = open && expandable && (
    <div id={panelId} className="ck-action-content">
      {action.type === "widget.toggle" ? (
        <WidgetNodeView node={action.payload.content} />
      ) : (
        <SequencePlayer action={action} />
      )}
    </div>
  );
  switch (n.type) {
    case "Image":
      return <WidgetImage key={n.src} node={n} />;
    case "Transition":
      return (
        <WidgetTransition version={JSON.stringify(n.children)}>
          <WidgetNodeView node={n.children as WidgetNode} />
        </WidgetTransition>
      );
    case "Title":
      return <h3 {...props}>{n.value}</h3>;
    case "Text":
      return n.editable ? (
        <label className="ck-field">
          <span>{n.value || n.editable.name}</span>
          <input
            name={n.editable.name}
            defaultValue={n.defaultValue || ""}
            placeholder={n.editable.placeholder}
            required={n.editable.required}
          />
        </label>
      ) : (
        <p {...props}>{n.value}</p>
      );
    case "Caption":
      return <small {...props}>{n.value}</small>;
    case "Markdown":
      return (
        <div {...props}>
          <RichText text={n.value!} />
        </div>
      );
    case "Badge":
      return <span {...props}>{n.label}</span>;
    case "Icon": {
      const Icon = icons[n.name as keyof typeof icons];
      return (
        <Icon
          {...props}
          aria-hidden="true"
          size={n.size === "lg" || n.size === "xl" ? 28 : 20}
        />
      );
    }
    case "Divider":
      return <hr className="ck-divider" />;
    case "Spacer":
      return <span className="ck-spacer" aria-hidden="true" />;
    case "Select": {
      const view = n.onChangeAction?.payload.views.find(
        (view) => view.value === selected,
      );
      return (
        <div className="ck-select-view">
          <label className="ck-field">
            <span>{n.placeholder || n.name}</span>
            <select
              name={n.name}
              value={selected}
              disabled={n.disabled}
              onChange={(event) => setSelected(event.currentTarget.value)}
            >
              <option value="">请选择</option>
              {n.options!.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          {view && (
            <div className="ck-selected-content" key={selected}>
              <WidgetNodeView node={view.content} />
            </div>
          )}
        </div>
      );
    }
    case "Button":
      return (
        <div className="ck-action">
          {actionButton}
          {actionContent}
          {result}
        </div>
      );
    case "Form":
      return (
        <form
          {...props}
          onChange={() => setFeedback(null)}
          onSubmit={(event) => {
            event.preventDefault();
            event.stopPropagation();
            run(n.onSubmitAction!, event.currentTarget);
          }}
        >
          {children}
          {result}
        </form>
      );
    case "ListViewItem":
      return (
        <div {...props}>
          {children}
          {action && actionButton}
          {actionContent}
          {result}
        </div>
      );
    default:
      return (
        <div
          {...props}
          style={{
            ...styles,
            flexDirection:
              n.type === "Row" || n.direction === "row" ? "row" : "column",
          }}
        >
          {children}
        </div>
      );
  }
}
function WidgetContent({ node }: { node: WidgetNode }) {
  const [revision, setRevision] = useState(0);
  // Static image/layout cards have no quiz chrome or irrelevant reset controls.
  const interactive = /"(?:onClickAction|onChangeAction|onSubmitAction)":/.test(
    JSON.stringify(node),
  );
  return (
    <section className="chatkit-widget" aria-label="知识卡片">
      {interactive && (
        <div className="ck-heading">
          <button
            type="button"
            onClick={() => setRevision((value) => value + 1)}
          >
            <RotateCcw size={14} />
            重新开始
          </button>
        </div>
      )}
      <WidgetNodeView key={revision} node={node} />
    </section>
  );
}
export default function ChatKitWidget({ source }: { source: string }) {
  const parsed = useMemo(() => {
    try {
      return { node: parseWidget(source), error: "" };
    } catch (error) {
      return {
        node: null,
        error:
          error instanceof SyntaxError
            ? "JSON 格式不正确"
            : (error as Error).message,
      };
    }
  }, [source]);
  if (!parsed.node)
    return (
      <div className="chatkit-widget ck-error" role="note">
        <p>交互卡片无法显示：{parsed.error}</p>
        <details>
          <summary>查看原始 JSON</summary>
          <pre>
            <code>{source}</code>
          </pre>
        </details>
      </div>
    );
  return <WidgetContent key={source} node={parsed.node} />;
}
