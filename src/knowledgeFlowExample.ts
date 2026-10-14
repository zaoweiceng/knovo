import type { WidgetNode } from "./chatkitSchema";

// A process diagram tracks an object through stable stations, not a numbered list.
const stations = ["请求", "缓存", "数据源", "返回"];
function frame(at: number, explanation: string): WidgetNode {
  return {
    type: "Col",
    gap: 3,
    children: [
      {
        type: "Row",
        gap: 2,
        wrap: "wrap",
        align: "stretch",
        children: stations.map((name, index) => ({
          type: "Box",
          flex: 1,
          padding: 3,
          radius: "md",
          background: at === index ? "#e4eff9" : "#f3f4f6",
          children: [
            { type: "Text", value: name, weight: "medium" },
            ...(at === index
              ? [
                  {
                    type: "Badge" as const,
                    key: "request-q",
                    label: "请求 Q",
                    color: "info" as const,
                  },
                ]
              : []),
          ],
        })),
      },
      { type: "Text", value: explanation },
    ],
  };
}
const paths = [
  {
    value: "miss",
    label: "未命中",
    frames: [
      frame(0, "Q 请求读取数据；假设数据源读取成功。"),
      frame(1, "缓存未命中，必须继续访问数据源。"),
      frame(2, "读取数据源，并将结果回填缓存。"),
      frame(3, "返回数据；后续请求可以复用缓存。"),
    ],
  },
  {
    value: "hit",
    label: "命中",
    frames: [
      frame(0, "Q 请求读取数据；假设缓存数据有效。"),
      frame(1, "缓存命中，直接取得数据。"),
      frame(3, "返回数据，跳过数据源读取与回填。"),
    ],
  },
];
export const flowExample: WidgetNode = {
  type: "Card",
  gap: 3,
  children: [
    { type: "Title", value: "跟随一次请求，看命中与未命中的路径", size: "md" },
    {
      type: "Text",
      value:
        "命中从缓存返回；未命中先读取数据源。Q 标记当前逻辑阶段，不代表真实网络包。",
    },
    {
      type: "Select",
      name: "cachePath",
      placeholder: "选择路径",
      defaultValue: "miss",
      options: paths.map(({ value, label }) => ({ value, label })),
      onChangeAction: {
        type: "widget.select",
        handler: "client",
        payload: {
          views: paths.map(({ value, frames }) => ({
            value,
            content: {
              type: "Col",
              gap: 3,
              children: [
                frames[0],
                {
                  type: "Button",
                  label: "打开路径动画",
                  onClickAction: {
                    type: "widget.sequence",
                    handler: "client",
                    payload: { frames, intervalMs: 1600 },
                  },
                },
              ],
            },
          })),
        },
      },
    },
  ],
};
export const flowExampleBody =
  "```chatkit\n" + JSON.stringify(flowExample) + "\n```";
