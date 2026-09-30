import { TextSelection } from "@tiptap/pm/state";
import { useEditor } from "@tiptap/react";
import { visualExtensions } from "./visualExtensions";
import { useEffect } from "react";
import { serializeVisualMarkdown } from "./visualMarkdown";

export function useVisualEditor(
  text: string,
  onChange: (text: string) => void,
  onFocus: () => void,
  disabled: boolean,
) {
  const editor = useEditor({
    extensions: visualExtensions,
    content: text,
    contentType: "markdown",
    onUpdate: ({ editor }) =>
      onChange(serializeVisualMarkdown(editor.markdown!, editor.getJSON())),
    onFocus,
    editorProps: {
      attributes: {
        class: "markdown visual-document",
        role: "textbox",
        "aria-label": "可视化正文编辑",
        "aria-multiline": "true",
      },
    },
  });
  useEffect(() => {
    if (
      editor &&
      serializeVisualMarkdown(editor.markdown!, editor.getJSON()) !== text
    ) {
      const { from, to } = editor.state.selection;
      editor.commands.setContent(text, {
        contentType: "markdown",
        emitUpdate: false,
      });
      const max = editor.state.doc.content.size;
      const selection = TextSelection.between(
        editor.state.doc.resolve(Math.min(from, max)),
        editor.state.doc.resolve(Math.min(to, max)),
      );
      editor.commands.setTextSelection({
        from: selection.from,
        to: selection.to,
      });
    }
  }, [editor, text]);
  useEffect(() => {
    editor?.setEditable(!disabled, false);
  }, [editor, disabled]);
  return editor;
}
