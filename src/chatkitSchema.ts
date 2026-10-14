// A deliberately bounded, local subset of the ChatKit WidgetRoot/WidgetNode protocol.
// Actions are application-defined; no model-provided code or network calls execute.
export const widgetTypes = [
  "Card",
  "ListView",
  "ListViewItem",
  "Box",
  "Row",
  "Col",
  "Title",
  "Text",
  "Caption",
  "Markdown",
  "Badge",
  "Icon",
  "Divider",
  "Spacer",
  "Button",
  "Form",
  "Select",
  "Image",
  "Transition",
] as const;
export const widgetIcons = [
  "book-open",
  "check",
  "circle-question",
  "info",
  "lightbulb",
  "refresh",
  "star",
  "warning",
] as const;
export type StudyAction = {
  type: "study.reveal" | "study.check";
  handler: "client";
  payload: {
    text?: string;
    field?: string;
    answer?: string;
    explanation?: string;
  };
};
export type ToggleAction = {
  type: "widget.toggle";
  handler: "client";
  payload: { content: WidgetNode };
};
export type SelectAction = {
  type: "widget.select";
  handler: "client";
  payload: { views: { value: string; content: WidgetNode }[] };
};
export type SequenceAction = {
  type: "widget.sequence";
  handler: "client";
  payload: { frames: WidgetNode[]; intervalMs?: number };
};
export type WidgetNode = {
  type: (typeof widgetTypes)[number];
  children?: WidgetNode[] | WidgetNode;
  value?: string;
  label?: string;
  name?: string;
  key?: string;
  direction?: "row" | "column";
  gap?: number;
  padding?: number;
  align?: "start" | "center" | "end" | "baseline" | "stretch";
  justify?: "start" | "center" | "end" | "between" | "around" | "evenly";
  wrap?: "nowrap" | "wrap" | "wrap-reverse";
  flex?: number;
  src?: string;
  alt?: string;
  width?: number | string;
  height?: number | string;
  fit?: "none" | "cover" | "contain" | "fill" | "scale-down";
  position?: "center" | "top" | "bottom" | "left" | "right";
  radius?: "none" | "xs" | "sm" | "md" | "lg" | "xl" | "full";
  background?: string;
  frame?: boolean;
  size?: "xs" | "sm" | "md" | "lg" | "xl" | "full";
  weight?: "normal" | "medium" | "semibold" | "bold";
  color?:
    | "primary"
    | "secondary"
    | "success"
    | "danger"
    | "warning"
    | "info"
    | "discovery";
  textAlign?: "start" | "center" | "end";
  variant?: "solid" | "soft" | "outline" | "ghost";
  submit?: boolean;
  disabled?: boolean;
  defaultValue?: string;
  placeholder?: string;
  editable?: { name: string; placeholder?: string; required?: boolean };
  options?: { label: string; value: string }[];
  onClickAction?: StudyAction | ToggleAction | SequenceAction;
  onSubmitAction?: StudyAction;
  onChangeAction?: SelectAction;
};
const object = (x: unknown): x is Record<string, unknown> =>
  !!x && typeof x === "object" && !Array.isArray(x);
const text = (x: unknown): x is string =>
  typeof x === "string" && x.trim().length > 0;
const fieldName = (x: unknown) =>
  typeof x === "string" && /^[a-zA-Z][a-zA-Z0-9_]{0,63}$/.test(x);
const containers = new Set([
  "Card",
  "ListView",
  "ListViewItem",
  "Box",
  "Row",
  "Col",
  "Form",
]);

export function isWidgetImageSource(src: unknown): src is string {
  if (typeof src !== "string") return false;
  if (/^\/api\/assets\/[a-f0-9]{64}$/.test(src)) return true;
  if (/^\/widget-assets\/[a-z0-9-]+\.(?:svg|png|jpe?g|webp|gif)$/.test(src))
    return true;
  try {
    const url = new URL(src);
    return url.protocol === "https:" && !url.username && !url.password;
  } catch {
    return false;
  }
}

export function parseWidget(source: string): WidgetNode {
  if (new TextEncoder().encode(source).byteLength > 64000)
    throw Error("组件 JSON 超过 64 KB");
  const root: unknown = JSON.parse(source);
  let count = 0;
  const checkActions: (() => void)[] = [];
  function action(value: unknown, fields: Set<string> | null, depth: number) {
    if (!object(value) || value.handler !== "client" || !object(value.payload))
      throw Error("动作需要 handler: client 和 payload");
    if (value.type === "study.reveal" && text(value.payload.text)) return;
    if (value.type === "widget.toggle") {
      walk(value.payload.content, depth + 1, fields);
      return;
    }
    if (value.type === "widget.sequence") {
      const { frames, intervalMs } = value.payload;
      if (!Array.isArray(frames) || frames.length < 2 || frames.length > 20)
        throw Error("动画序列需要 2–20 帧");
      if (
        intervalMs !== undefined &&
        (typeof intervalMs !== "number" ||
          intervalMs < 500 ||
          intervalMs > 5000)
      )
        throw Error("动画间隔需要在 500–5000 毫秒之间");
      for (const frame of frames) walk(frame, depth + 1, fields);
      return;
    }
    if (
      value.type === "study.check" &&
      fields &&
      fieldName(value.payload.field) &&
      fields.has(value.payload.field as string) &&
      text(value.payload.answer) &&
      text(value.payload.explanation)
    )
      return;
    throw Error("不支持的动作，或答题动作缺少表单字段、答案和解释");
  }
  function walk(
    value: unknown,
    depth: number,
    fields: Set<string> | null,
  ): asserts value is WidgetNode {
    if (++count > 200 || depth > 12) throw Error("组件过多或嵌套过深");
    if (
      !object(value) ||
      !widgetTypes.includes(value.type as WidgetNode["type"])
    )
      throw Error("不支持的 ChatKit 组件类型");
    const n = value;
    const allowed = new Set([
      "type",
      "children",
      "value",
      "label",
      "name",
      "key",
      "direction",
      "gap",
      "padding",
      "align",
      "justify",
      "wrap",
      "flex",
      "src",
      "alt",
      "width",
      "height",
      "fit",
      "position",
      "radius",
      "background",
      "frame",
      "size",
      "weight",
      "color",
      "textAlign",
      "variant",
      "submit",
      "disabled",
      "defaultValue",
      "placeholder",
      "editable",
      "options",
      "onClickAction",
      "onSubmitAction",
      "onChangeAction",
    ]);
    for (const key of Object.keys(n))
      if (!allowed.has(key)) throw Error(`暂不支持属性：${key}`);
    for (const key of [
      "value",
      "label",
      "name",
      "key",
      "defaultValue",
      "placeholder",
      "src",
      "alt",
    ])
      if (n[key] !== undefined && typeof n[key] !== "string")
        throw Error(`${key} 必须是字符串`);
    for (const key of ["gap", "padding", "flex"])
      if (
        n[key] !== undefined &&
        (typeof n[key] !== "number" || n[key] < 0 || n[key] > 12)
      )
        throw Error(`${key} 必须在 0–12 之间`);
    for (const key of ["submit", "disabled", "frame"])
      if (n[key] !== undefined && typeof n[key] !== "boolean")
        throw Error(`${key} 必须是布尔值`);
    const enums: Record<string, string[]> = {
      direction: ["row", "column"],
      size: ["xs", "sm", "md", "lg", "xl", "full"],
      weight: ["normal", "medium", "semibold", "bold"],
      color: [
        "primary",
        "secondary",
        "success",
        "danger",
        "warning",
        "info",
        "discovery",
      ],
      textAlign: ["start", "center", "end"],
      variant: ["solid", "soft", "outline", "ghost"],
      align: ["start", "center", "end", "baseline", "stretch"],
      justify: ["start", "center", "end", "between", "around", "evenly"],
      wrap: ["nowrap", "wrap", "wrap-reverse"],
      fit: ["none", "cover", "contain", "fill", "scale-down"],
      position: ["center", "top", "bottom", "left", "right"],
      radius: ["none", "xs", "sm", "md", "lg", "xl", "full"],
    };
    for (const [key, options] of Object.entries(enums))
      if (n[key] !== undefined && !options.includes(n[key] as string))
        throw Error(`不支持的 ${key}`);
    if (
      n.background !== undefined &&
      (typeof n.background !== "string" ||
        !/^(?:transparent|#[a-fA-F0-9]{3,4}|#[a-fA-F0-9]{6}|#[a-fA-F0-9]{8})$/.test(
          n.background,
        ))
    )
      throw Error("background 仅支持十六进制颜色或 transparent");
    for (const key of ["width", "height"]) {
      const dimension = n[key];
      if (
        dimension !== undefined &&
        !(
          (typeof dimension === "number" &&
            dimension > 0 &&
            dimension <= 4096) ||
          (typeof dimension === "string" &&
            /^(?:auto|(?:100|[1-9]?\d)(?:\.\d+)?%)$/.test(dimension) &&
            (dimension === "auto" || parseFloat(dimension) <= 100))
        )
      )
        throw Error(`${key} 仅支持 1–4096 的数字、0–100% 或 auto`);
    }
    if (n.type === "Image" && !isWidgetImageSource(n.src))
      throw Error("Image.src 需要已上传的图片地址或 HTTPS 图片链接");
    if (
      ["Title", "Text", "Caption", "Markdown"].includes(n.type as string) &&
      typeof n.value !== "string"
    )
      throw Error("文本组件缺少 value");
    if (["Button", "Badge"].includes(n.type as string) && !text(n.label))
      throw Error("组件缺少 label");
    if (
      n.type === "Icon" &&
      !widgetIcons.includes(n.name as (typeof widgetIcons)[number])
    )
      throw Error("不支持的图标名称");
    if (n.type === "Transition") {
      if (!object(n.children))
        throw Error("Transition.children 必须是单个组件对象");
      walk(n.children, depth + 1, fields);
    } else if (
      n.children !== undefined &&
      (!containers.has(n.type as string) || !Array.isArray(n.children))
    )
      throw Error("children 必须是容器中的数组");
    if (
      n.type === "ListView" &&
      (!Array.isArray(n.children) ||
        n.children.some((v) => !object(v) || v.type !== "ListViewItem"))
    )
      throw Error("ListView 只能包含 ListViewItem");
    if (n.type === "Card" && depth !== 0) throw Error("Card 只能作为根节点");
    if (n.type === "Form") {
      if (fields) throw Error("Form 不能嵌套");
      fields = new Set<string>();
    }
    if (n.type === "Select" || n.editable !== undefined) {
      const edit = n.editable;
      if (
        edit !== undefined &&
        (n.type !== "Text" ||
          !object(edit) ||
          (edit.placeholder !== undefined &&
            typeof edit.placeholder !== "string") ||
          (edit.required !== undefined && typeof edit.required !== "boolean"))
      )
        throw Error("editable 需要 name、可选 placeholder 和 required");
      const name = object(edit) ? edit.name : n.name;
      if (
        (!fields && (n.type !== "Select" || !n.onChangeAction)) ||
        !fieldName(name) ||
        fields?.has(name as string)
      )
        throw Error(
          "输入字段需要 Form 或 Select.onChangeAction，name 为唯一英文字母数字下划线",
        );
      fields?.add(name as string);
      if (
        n.type === "Select" &&
        (!Array.isArray(n.options) ||
          !n.options.length ||
          n.options.some((v) => !object(v) || !text(v.label) || !text(v.value)))
      )
        throw Error("Select 缺少有效 options");
      if (n.type === "Select") {
        const options = n.options as { label: string; value: string }[];
        if (
          new Set(options.map((option) => option.value)).size !== options.length
        )
          throw Error("Select 选项值不能重复");
        if (
          n.defaultValue &&
          !options.some((option) => option.value === n.defaultValue)
        )
          throw Error("defaultValue 必须对应一个选项");
      }
    }
    if (Array.isArray(n.children))
      for (const child of n.children) walk(child, depth + 1, fields);
    if (n.submit && n.onClickAction)
      throw Error("提交按钮使用 Form.onSubmitAction，不同时设置 onClickAction");
    if (n.submit && (n.type !== "Button" || !fields))
      throw Error("提交按钮必须在 Form 内");
    if (n.type === "Button" && !n.submit && !n.onClickAction)
      throw Error("按钮缺少动作");
    if (n.onClickAction !== undefined) {
      if (!["Button", "ListViewItem"].includes(n.type as string))
        throw Error("此组件不支持点击动作");
      if (object(n.onClickAction) && n.onClickAction.type === "study.check")
        checkActions.push(() => action(n.onClickAction, fields, depth));
      else action(n.onClickAction, fields, depth);
    }
    if (n.onChangeAction !== undefined) {
      const change = n.onChangeAction;
      if (
        n.type !== "Select" ||
        !object(change) ||
        change.type !== "widget.select" ||
        change.handler !== "client" ||
        !object(change.payload) ||
        !Array.isArray(change.payload.views)
      )
        throw Error("Select.onChangeAction 需要 widget.select 和 views");
      const options = n.options as { value: string }[];
      const views = change.payload.views;
      if (
        views.length !== options.length ||
        views.some(
          (view) =>
            !object(view) ||
            !options.some((option) => option.value === view.value),
        ) ||
        new Set(views.map((view) => view.value)).size !== views.length
      )
        throw Error("views 必须与选项值一一对应");
      for (const view of views) walk(view.content, depth + 1, fields);
    }
    if (n.type === "Form") {
      if (
        !object(n.onSubmitAction) ||
        !["study.check", "study.reveal"].includes(
          n.onSubmitAction.type as string,
        )
      )
        throw Error("Form 缺少支持的提交动作");
      checkActions.push(() => action(n.onSubmitAction, fields, depth));
    } else if (n.onSubmitAction !== undefined)
      throw Error("只有 Form 支持提交动作");
  }
  if (!object(root) || !["Card", "ListView"].includes(root.type as string))
    throw Error("根节点必须是 Card 或 ListView");
  walk(root, 0, null);
  for (const check of checkActions) check();
  return root;
}

export function studyFeedback(
  action: StudyAction,
  values: Record<string, string>,
) {
  if (action.type === "study.reveal")
    return { kind: "info", text: action.payload.text! };
  const answer = values[action.payload.field!] || "";
  if (!answer.trim())
    return { kind: "warning", text: "请先作答，再查看反馈。" };
  // Exact answer checking is intentional: free-form reasoning uses reveal/self-assessment.
  const normalize = (s: string) => s.normalize("NFKC").trim().toLowerCase();
  const correct = normalize(answer) === normalize(action.payload.answer!);
  return {
    kind: correct ? "success" : "danger",
    text: `${correct ? "回答正确。" : "再想一想。参考答案：" + action.payload.answer + "。"}\n\n${action.payload.explanation}`,
  };
}
