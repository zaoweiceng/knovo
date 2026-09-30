import StarterKit from "@tiptap/starter-kit";
import { Markdown } from "@tiptap/markdown";
import { TableKit } from "@tiptap/extension-table";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import Image from "@tiptap/extension-image";
import {
  VisualInlineMath,
  VisualBlockMath,
  VisualCodeBlock,
} from "./visualScientificNodes.ts";
export const visualExtensions = [
  StarterKit.configure({
    undoRedo: false,
    codeBlock: false,
    link: { openOnClick: false },
  }),
  VisualCodeBlock,
  VisualInlineMath,
  VisualBlockMath,
  Markdown,
  TableKit.configure({ table: { resizable: false } }),
  TaskList,
  TaskItem.configure({ nested: true }),
  Image.configure({ allowBase64: false }).extend({
    renderHTML({ HTMLAttributes }) {
      const src = String(HTMLAttributes.src || "");
      // Match the reader: never fetch external images implicitly.
      if (!/^\/api\/assets\/[a-f0-9]{64}$/.test(src))
        return [
          "span",
          { class: "external-image" },
          `[外部图片：${HTMLAttributes.alt || src}]`,
        ];
      return ["img", HTMLAttributes];
    },
  }),
];
