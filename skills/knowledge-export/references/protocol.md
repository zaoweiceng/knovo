# Atomic Knowledge Markdown v1

UTF-8 Markdown，YAML frontmatter 使用 `---`。一个文件一个知识点。所有日期时间加引号，数组明确写为 YAML 数组。

```yaml
---
schema_version: 1
id: "ad532d9b-fbdb-4df2-9d96-894a53e77d73"
title: "为什么工具调用需要参数校验？"
summary: "理解模型输出与真实工具执行之间的边界，以及参数校验的作用。"
category: [计算机, 人工智能, 大模型, Agent, 工具调用]
tags: [参数校验, 工具调用]
status: ready
created_at: "2026-09-20T08:00:00.000Z"
updated_at: "2026-09-20T08:00:00.000Z"
learning_events:
  - date: "2026-09-20"
    summary: "理解工具调用前需要校验类型和业务约束。"
prerequisites: []
related: []
aliases: []
merged_from: []
---

## 核心解释

模型生成的参数仍然是输入数据。执行前，需要验证参数结构和业务允许的范围。

例如，转账金额的类型合法，不代表该金额满足账户余额和单笔限额要求。
```

以上仅为格式示例，实际生成时替换 ID、时间与内容。`id` 允许 1–128 位字母、数字、下划线和短横线，优先 UUID；首次分配后不随标题、路径改变。每篇上限 2 MB。

必填：schema_version=1、id、title、summary、category、status、created_at、updated_at、learning_events、非空正文。其余数组缺省视为空。category 是至少一级的非空字符串数组，不限制深度。status 为 ready 或 learning。学习事件 date 为有效 YYYY-MM-DD 或 null，summary 非空；没有可确认的学习事件可用空数组，不虚构日期。

prerequisites/related 引用稳定 ID，不引用文件路径或标题，不允许自引用。前置边方向为“前置目标 → 当前知识点”，相关关系无向。反向关联由网站计算，无需写两遍。失效引用会保留并提示，不能凭空创建知识来满足引用。

merged_from 表示已被当前知识点吸收的历史 ID。源文件必须在同一维护批次归档，不能留下两个活动身份。别名不改变 ID。原始对话 ID/文本与导入进度只留在隐藏工作文件，不放进上述元信息。

正文支持标准 Markdown 和 GFM 表格、列表、代码块；原始 HTML 不执行。请勿写本机绝对路径或引入依赖外网加载的附件；图片第一版显示链接。知识间导航在侧栏提供，不在正文附加索引段。

校验：`node <runtime>/scripts/knowledge.mjs validate --root <输出目录>`。维护、导出与网站使用相同解析器。
