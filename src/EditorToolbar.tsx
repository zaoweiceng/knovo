import { useEffect, useRef, useState, type RefObject } from "react";
import type { Editor } from "@tiptap/react";
import {
  Bold,
  Italic,
  Strikethrough,
  Code,
  Table2,
  ListTodo,
  ImagePlus,
  Undo2,
  Redo2,
  ChevronDown,
} from "lucide-react";
import { formatMarkdown } from "./markdownActions";
export default function EditorToolbar({
  source,
  editor,
  surface,
  onChange,
  onError,
  onBusy,
  undo,
  redo,
  canUndo,
  canRedo,
  disabled,
  onCommand,
}: {
  source: RefObject<HTMLTextAreaElement | null>;
  editor: Editor | null;
  surface: "source" | "rich";
  onChange: (s: string) => void;
  onError: (s: string) => void;
  onBusy: (v: boolean) => void;
  onCommand: () => void;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  disabled: boolean;
}) {
  const [menu, setMenu] = useState<{
    kind: string;
    x?: number;
    y?: number;
  } | null>(null);
  const [, refresh] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const file = useRef<HTMLInputElement>(null);
  const imageTarget = useRef({ surface, from: 0, to: 0 });
  const table = surface === "rich" && !!editor?.isActive("table");
  useEffect(() => {
    const changed = () => refresh((x) => x + 1);
    editor?.on("selectionUpdate", changed);
    editor?.on("transaction", changed);
    return () => {
      editor?.off("selectionUpdate", changed);
      editor?.off("transaction", changed);
    };
  }, [editor]);
  useEffect(() => {
    const container = root.current?.closest(".note-editor");
    const context = (event: Event) => {
      const e = event as MouseEvent;
      const target = e.target as HTMLElement;
      if (
        !target.closest(
          '.visual-document, textarea[aria-label="Markdown 编辑框"]',
        )
      )
        return;
      e.preventDefault();
      setMenu({
        kind: "context",
        x: Math.max(8, Math.min(e.clientX, window.innerWidth - 254)),
        y: Math.max(8, Math.min(e.clientY, window.innerHeight - 480)),
      });
    };
    const close = (e: Event) => {
      if (!root.current?.contains(e.target as Node)) setMenu(null);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenu(null);
    };
    container?.addEventListener("contextmenu", context);
    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", key);
    return () => {
      container?.removeEventListener("contextmenu", context);
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", key);
    };
  }, []);
  const run = (action: string) => {
    setMenu(null);
    if (disabled) return;
    if (action === "undo") return undo();
    if (action === "redo") return redo();
    if (action === "image") {
      const selected = editor?.state.selection;
      imageTarget.current = {
        surface,
        from:
          surface === "source"
            ? source.current?.selectionStart || 0
            : selected?.from || 0,
        to:
          surface === "source"
            ? source.current?.selectionEnd || 0
            : selected?.to || 0,
      };
      file.current?.click();
      return;
    }
    if (surface === "source") {
      const el = source.current;
      if (!el) return;
      const result = formatMarkdown(
        el.value,
        el.selectionStart,
        el.selectionEnd,
        action,
      );
      onChange(result.text);
      requestAnimationFrame(() => {
        el.focus();
        el.setSelectionRange(result.start, result.end);
      });
      return;
    }
    if (!editor) return;
    onCommand();
    const c = editor.chain().focus();
    if (/^h[1-6]$/.test(action))
      c.setHeading({ level: Number(action[1]) as 1 | 2 | 3 | 4 | 5 | 6 }).run();
    else
      switch (action) {
        case "paragraph":
          c.setParagraph().run();
          break;
        case "bold":
          c.toggleBold().run();
          break;
        case "italic":
          c.toggleItalic().run();
          break;
        case "strike":
          c.toggleStrike().run();
          break;
        case "code":
          c.toggleCode().run();
          break;
        case "codeblock":
          c.toggleCodeBlock().run();
          break;
        case "bullet":
          c.toggleBulletList().run();
          break;
        case "ordered":
          c.toggleOrderedList().run();
          break;
        case "todo":
          c.toggleTaskList().run();
          break;
        case "quote":
          c.toggleBlockquote().run();
          break;
        case "table":
          c.insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run();
          break;
        case "rowBefore":
          c.addRowBefore().run();
          break;
        case "rowAfter":
          c.addRowAfter().run();
          break;
        case "columnBefore":
          c.addColumnBefore().run();
          break;
        case "columnAfter":
          c.addColumnAfter().run();
          break;
        case "deleteRow":
          c.deleteRow().run();
          break;
        case "deleteColumn":
          c.deleteColumn().run();
          break;
        case "deleteTable":
          c.deleteTable().run();
          break;
      }
  };
  const upload = async (f: File) => {
    onBusy(true);
    try {
      if (f.size > 10 * 1024 * 1024) throw Error("图片限 10 MB");
      const response = await fetch("/api/assets", {
        method: "POST",
        headers: { "Content-Type": "application/octet-stream" },
        body: f,
      });
      const data = await response.json();
      if (!response.ok) throw Error(data.error);
      onCommand();
      const { surface: target, from, to } = imageTarget.current;
      if (target === "rich" && editor)
        editor
          .chain()
          .focus()
          .setTextSelection({ from, to })
          .setImage({ src: data.url, alt: f.name })
          .run();
      else if (source.current) {
        const value = source.current.value;
        onChange(
          value.slice(0, from) + `\n![图片](${data.url})\n` + value.slice(to),
        );
      }
    } catch (e) {
      onError((e as Error).message);
    } finally {
      onBusy(false);
    }
  };
  const formats = [
    ["h1", "一级标题", "H1"],
    ["h2", "二级标题", "H2"],
    ["h3", "三级标题", "H3"],
    ["h4", "四级标题", "H4"],
    ["h5", "五级标题", "H5"],
    ["h6", "六级标题", "H6"],
    ["paragraph", "正文", ""],
    ["bold", "加粗", "⌘ B"],
    ["italic", "斜体", "⌘ I"],
    ["strike", "删除线", ""],
    ["code", "行内代码", ""],
    ["codeblock", "代码块", ""],
    ["quote", "引用", ""],
    ["bullet", "项目列表", ""],
    ["ordered", "编号列表", ""],
    ["todo", "待办事项", ""],
  ];
  const tables = [
    ["table", "插入表格", ""],
    ["rowBefore", "在上方添加行", ""],
    ["rowAfter", "在下方添加行", ""],
    ["columnBefore", "在左侧添加列", ""],
    ["columnAfter", "在右侧添加列", ""],
    ["deleteRow", "删除当前行", ""],
    ["deleteColumn", "删除当前列", ""],
    ["deleteTable", "删除表格", ""],
  ];
  const actions =
    menu?.kind === "table"
      ? tables
      : menu?.kind === "context"
        ? [
            ["undo", "撤销", "⌘ Z"],
            ["redo", "重做", "⇧ ⌘ Z"],
            ...(table ? tables : []),
            ...formats,
            ...(table ? [] : [tables[0]]),
            ["image", "插入图片", ""],
          ]
        : formats;
  const inactive = (a: string) =>
    disabled ||
    (a === "undo" && !canUndo) ||
    (a === "redo" && !canRedo) ||
    (tables.some((x) => x[0] === a) && a !== "table" && !table);
  return (
    <div
      ref={root}
      className="writing-toolbar"
      role="toolbar"
      aria-label="正文格式工具栏"
    >
      <button
        title="撤销 (⌘/Ctrl Z)"
        aria-label="撤销"
        disabled={!canUndo || disabled}
        onMouseDown={(e) => e.preventDefault()}
        onClick={undo}
      >
        <Undo2 size={17} />
      </button>
      <button
        title="重做 (⇧ ⌘ Z / Ctrl Y)"
        aria-label="重做"
        disabled={!canRedo || disabled}
        onMouseDown={(e) => e.preventDefault()}
        onClick={redo}
      >
        <Redo2 size={17} />
      </button>
      <span className="tool-divider" />
      <button
        disabled={disabled}
        aria-expanded={menu?.kind === "format"}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() =>
          setMenu(menu?.kind === "format" ? null : { kind: "format" })
        }
      >
        段落 <ChevronDown size={13} />
      </button>
      {[
        ["bold", "加粗", Bold],
        ["italic", "斜体", Italic],
        ["strike", "删除线", Strikethrough],
        ["code", "行内代码", Code],
        ["todo", "待办事项", ListTodo],
      ].map(([action, label, Icon]) => {
        const Symbol = Icon as typeof Bold;
        return (
          <button
            key={String(action)}
            disabled={disabled}
            aria-label={String(label)}
            title={String(label)}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => run(String(action))}
          >
            <Symbol size={17} />
          </button>
        );
      })}
      <span className="tool-divider" />
      <button
        disabled={disabled}
        aria-expanded={menu?.kind === "table"}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() =>
          setMenu(menu?.kind === "table" ? null : { kind: "table" })
        }
      >
        <Table2 size={17} /> 表格 <ChevronDown size={13} />
      </button>
      <button
        disabled={disabled}
        aria-label="插入图片"
        title="插入图片"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => run("image")}
      >
        <ImagePlus size={17} />
      </button>
      {table && (
        <div className="table-quick" aria-label="表格快捷操作">
          {[
            ["rowAfter", "+ 行"],
            ["columnAfter", "+ 列"],
            ["deleteRow", "− 行"],
            ["deleteColumn", "− 列"],
          ].map(([a, label]) => (
            <button
              key={a}
              title={tables.find((x) => x[0] === a)?.[1]}
              aria-label={tables.find((x) => x[0] === a)?.[1]}
              disabled={disabled}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => run(a)}
            >
              {label}
            </button>
          ))}
        </div>
      )}
      <span className="toolbar-hint">
        {surface === "source" ? "Markdown 源码" : "可直接编辑 · Tab 切换单元格"}
      </span>
      <input
        hidden
        ref={file}
        type="file"
        accept="image/png,image/jpeg,image/gif,image/webp"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void upload(f);
          e.target.value = "";
        }}
      />
      {menu && (
        <div
          className={`writing-menu ${menu.kind === "context" ? "writing-context" : ""}`}
          role="menu"
          aria-label="编辑菜单"
          style={
            menu.kind === "context" ? { left: menu.x, top: menu.y } : undefined
          }
        >
          {actions.map(([a, label, key]) => (
            <button
              role="menuitem"
              key={a}
              disabled={inactive(a)}
              className={[
                a.startsWith("delete") ? "danger-action" : "",
                [
                  "h1",
                  "bold",
                  "quote",
                  "table",
                  "rowBefore",
                  "deleteRow",
                  "image",
                ].includes(a)
                  ? "menu-group-start"
                  : "",
              ].join(" ")}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => run(a)}
            >
              <span>{label}</span>
              <kbd>{key}</kbd>
            </button>
          ))}
          {menu.kind === "table" && !table && (
            <small>点击可视化表格中的单元格，可增删行列。</small>
          )}
        </div>
      )}
    </div>
  );
}
