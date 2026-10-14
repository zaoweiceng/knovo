import type { WidgetNode } from "./chatkitSchema";

// A visual exploration, intentionally not a quiz. All artwork is bundled locally.
const states = [
  {
    value: "solid",
    label: "固态 · 冰",
    title: "保持形状",
    description:
      "冰中的水分子形成相对稳定的结构。分子仍在振动，并不是静止不动。",
    detail:
      "**宏观表现**：有相对固定的形状和体积。\n\n**微观解释**：分子主要在平衡位置附近振动。水结冰形成较疏松的结构，所以普通冰的密度比液态水低。",
  },
  {
    value: "liquid",
    label: "液态 · 水",
    title: "随容器改变形状",
    description: "水分子彼此靠近，但可以不断改变相对位置，因此液态水能够流动。",
    detail:
      "**宏观表现**：体积变化小，形状随容器改变。\n\n**微观解释**：分子持续运动、重新排列；氢键网络不断变化。图中的圆点只表示分子位置，不是按比例绘制的分子结构。",
  },
  {
    value: "gas",
    label: "气态 · 水蒸气",
    title: "扩散并充满空间",
    description:
      "水蒸气分子相距较远，能够在可用空间中自由运动。水蒸气本身不可见。",
    detail:
      "**宏观表现**：没有固定形状，易被压缩，会充满容器。\n\n**易混淆处**：壶口看到的白雾是凝结成的小液滴，不是气态水本身。",
  },
];
export const chatkitExample: WidgetNode = {
  type: "Card",
  children: [
    {
      type: "Row",
      gap: 2,
      children: [
        { type: "Icon", name: "lightbulb" },
        { type: "Badge", label: "观察与探索", color: "info" },
      ],
    },
    { type: "Title", value: "看见水的三种状态" },
    { type: "Text", value: "切换物态，观察分子排列与宏观性质的变化。" },
    {
      type: "Select",
      name: "phase",
      placeholder: "观察物态",
      defaultValue: "liquid",
      options: states.map(({ value, label }) => ({ value, label })),
      onChangeAction: {
        type: "widget.select",
        handler: "client",
        payload: {
          views: states.map((state) => ({
            value: state.value,
            content: {
              type: "Col",
              gap: 3,
              children: [
                {
                  type: "Image",
                  src: `/widget-assets/water-${state.value}.svg`,
                  alt: `${state.label}的分子排列示意图`,
                  width: "100%",
                  height: 180,
                  fit: "contain",
                  radius: "lg",
                },
                { type: "Title", value: state.title, size: "sm" },
                { type: "Text", value: state.description },
                {
                  type: "Button",
                  label: "展开微观解释",
                  onClickAction: {
                    type: "widget.toggle",
                    handler: "client",
                    payload: {
                      content: { type: "Markdown", value: state.detail },
                    },
                  },
                },
              ],
            },
          })),
        },
      },
    },
    {
      type: "Caption",
      value: "示意图用于比较排列方式，不表示真实比例或运动速度。",
    },
  ],
};

function structureExample(kind: "queue" | "stack"): WidgetNode {
  const queue = kind === "queue";
  const states = [
    {
      items: [],
      step: "初始状态",
      detail: queue
        ? "队列为空。元素从队尾进入，从队首离开。"
        : "栈为空。元素只从栈顶进入或离开。",
    },
    { items: ["A"], step: queue ? "A 入队" : "A 入栈", detail: "A 最先进入。" },
    {
      items: ["A", "B"],
      step: queue ? "B 入队" : "B 入栈",
      detail: "B 在 A 之后进入。",
    },
    {
      items: ["A", "B", "C"],
      step: queue ? "C 入队" : "C 入栈",
      detail: "C 最后进入。现在观察谁会先离开。",
    },
    {
      items: queue ? ["B", "C"] : ["A", "B"],
      step: queue ? "A 出队" : "C 出栈",
      detail: queue
        ? "最先进入的 A 先离开：先进先出（FIFO）。"
        : "最后进入的 C 先离开：后进先出（LIFO）。",
    },
    {
      items: queue ? ["C"] : ["A"],
      step: queue ? "B 出队" : "B 出栈",
      detail: queue
        ? "新的队首 B 离开，C 留在队列中。"
        : "新的栈顶 B 离开，A 留在栈中。",
    },
    {
      items: [],
      step: queue ? "C 出队" : "A 出栈",
      detail: queue
        ? "出队顺序：A → B → C，与进入顺序相同。"
        : "出栈顺序：C → B → A，与进入顺序相反。",
    },
  ];
  const frames: WidgetNode[] = states.map((state) => ({
    type: "Col",
    gap: 4,
    children: [
      { type: "Title", value: state.step, size: "sm" },
      {
        type: "Caption",
        value: queue
          ? "队首 ← 从左侧离开　｜　从右侧进入 ← 队尾"
          : "栈顶在上方：从上方进入，也从上方离开",
      },
      {
        type: queue ? "Row" : "Col",
        gap: 3,
        height: queue ? 90 : 175,
        align: "center",
        justify: "center",
        children: state.items.length
          ? (queue ? state.items : [...state.items].reverse()).map((item) => ({
              type: "Badge",
              key: item,
              label: item,
              color:
                item === "A" ? "info" : item === "B" ? "discovery" : "success",
              size: "lg",
            }))
          : [{ type: "Text", value: "空", color: "secondary" }],
      },
      { type: "Text", value: state.detail },
    ],
  }));
  return {
    type: "Card",
    children: [
      { type: "Badge", label: "动态过程", color: "discovery" },
      { type: "Title", value: queue ? "队列：先进先出" : "栈：后进先出" },
      {
        type: "Text",
        value:
          "按 A、B、C 的顺序放入元素，观察它们离开的顺序。可单步查看，也可连续播放。",
      },
      {
        type: "Button",
        label: queue ? "打开队列动画" : "打开栈动画",
        onClickAction: {
          type: "widget.sequence",
          handler: "client",
          payload: { frames, intervalMs: 1400 },
        },
      },
    ],
  };
}
export const queueExample = structureExample("queue");
export const stackExample = structureExample("stack");
export const chatkitExampleBody =
  "```chatkit\n" + JSON.stringify(chatkitExample, null, 2) + "\n```";
// Compact teaching example: every state explains the operation and its consequence.
export const animationExampleBody =
  "```chatkit\n" +
  JSON.stringify({
    type: "Card",
    children: [
      { type: "Title", value: "出队后，谁成为队首？", size: "md" },
      {
        type: "Text",
        value: "A、B 依次入队，队首在左。取出 A 后，B 成为新的队首。",
      },
      {
        type: "Button",
        label: "观察一次出队",
        onClickAction: {
          type: "widget.sequence",
          handler: "client",
          payload: {
            intervalMs: 1400,
            frames: [
              {
                type: "Col",
                gap: 3,
                children: [
                  { type: "Text", value: "操作前：A 在队首，B 在队尾。" },
                  {
                    type: "Row",
                    gap: 2,
                    wrap: "wrap",
                    children: [
                      {
                        type: "Badge",
                        key: "A",
                        label: "A · 队首",
                        color: "info",
                      },
                      { type: "Badge", key: "B", label: "B · 队尾" },
                    ],
                  },
                ],
              },
              {
                type: "Col",
                gap: 3,
                children: [
                  {
                    type: "Text",
                    value: "执行出队：移除并返回 A；B 成为新的队首。",
                  },
                  {
                    type: "Row",
                    gap: 2,
                    wrap: "wrap",
                    children: [
                      { type: "Badge", key: "B", label: "B · 队首/队尾" },
                    ],
                  },
                  {
                    type: "Caption",
                    value:
                      "A 最先加入，所以先被取出。队列剩下 B，下次出队将取出 B。",
                  },
                ],
              },
            ],
          },
        },
      },
    ],
  } satisfies WidgetNode) +
  "\n```";

// Static infographic composed of standard widget nodes; no image asset is needed.
export const paginationExample: WidgetNode = {
  type: "Card",
  gap: 7,
  children: [
    { type: "Title", value: "NextToken 分页", size: "lg" },
    ...[0, 1, 2].flatMap((page): WidgetNode[] => {
      const cursor = page === 0 ? "" : `&nextToken=cursor_${100 + page * 3}`;
      const section: WidgetNode = {
        type: "Col",
        gap: 2,
        children: [
          {
            type: "Row",
            justify: "between",
            align: "center",
            children: [
              {
                type: "Title",
                value: ["第一次请求", "第二次请求", "第三次请求"][page],
              },
              {
                type: "Badge",
                label: page === 0 ? "无 Token" : "携带 Token",
                radius: "full",
                background: "#eeeeee",
              },
            ],
          },
          {
            type: "Text",
            value: `GET /tasks?limit=3${cursor}`,
            color: "secondary",
          },
          {
            type: "Row",
            gap: 2,
            wrap: "nowrap",
            children: [1, 2, 3].map((offset): WidgetNode => ({
              type: "Box",
              flex: 1,
              padding: 4,
              radius: "lg",
              background: "#f3f3f3",
              children: [
                {
                  type: "Text",
                  value: String(100 + page * 3 + offset),
                  size: "xl",
                  textAlign: "center",
                },
              ],
            })),
          },
          ...(page < 2
            ? [
                {
                  type: "Text" as const,
                  value: `返回 nextToken = "cursor_${103 + page * 3}"`,
                },
              ]
            : []),
        ],
      };
      return page === 2
        ? [section]
        : [
            section,
            {
              type: "Row",
              justify: "center",
              padding: 4,
              children: [
                {
                  type: "Text",
                  value:
                    page === 0
                      ? "↓　携带令牌继续请求"
                      : "↓　继续请求直到没有下一页",
                  color: "secondary",
                },
              ],
            },
          ];
    }),
  ],
};

export const chatkitTemplates = {
  chatkit: chatkitExample,
  paginationCard: paginationExample,
  queueAnimation: queueExample,
  stackAnimation: stackExample,
};
