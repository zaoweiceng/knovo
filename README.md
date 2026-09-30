# Knovo · 知序

**理解一个知识点，连接已有知识，让理解成为长期记忆。**

[English](README.en.md) · [完整使用指南](docs/usage.zh-CN.md) · [部署说明](deploy/README.md) · [贡献指南](CONTRIBUTING.md)

Knovo 是本地优先的个人知识库：把笔记和 AI 对话整理成可独立理解的知识点，按概念建立关联，再通过间隔复习巩固记忆。正文、图片和复习进度保存在本地 SQLite 中。

网站不需要账户、API Key 或模型服务，当前界面为简体中文。可选的 agent skills 由你使用的 AI agent 执行；交给 agent 的内容遵循该服务的数据处理规则。

## 能做什么

- **收集知识**：新建笔记、导入 Markdown / Knovo ZIP，或粘贴 AI 整理结果。
- **编辑与表达**：Markdown 分栏、所见即所得编辑、表格、本地图片、LaTeX 公式和 Mermaid 图表。
- **连接概念**：多级分类、知识关键词、依赖关键词与可交互知识网络。
- **复习与回顾**：间隔复习、按实际学习日期计算的时间线和热力图。
- **掌握数据**：稳定 ID、编辑历史、可恢复的回收站、导入导出和完整备份。

## 快速开始

需要 **Node.js 24+** 和 **pnpm 10.27.0**（与 `package.json` 一致）。

```sh
git clone https://github.com/zaoweiceng/knovo.git
cd knovo
pnpm install --frozen-lockfile
pnpm run build
pnpm start
```

打开 **http://127.0.0.1:3210**。首次安装为空库；可运行 `pnpm run demo` 生成 7 篇示例，再刷新页面。后续启动只需 `pnpm start`。

SQLite 使用 Node.js 内置的 `node:sqlite`，无需另装数据库；Node.js 可能输出实验性 API 提示。

## 两种启动模式

```sh
pnpm run start:local  # 仅本机访问，强制使用回环地址
pnpm run start:lan    # 同一可信局域网内的其他设备可访问
```

`pnpm start` 读取环境配置，默认仅本机访问。显式模式覆盖 `HOST` 和 `ALLOWED_HOSTS`，保留 `PORT` 与 `KNOWLEDGE_DIR`；本机模式也会清空 `PUBLIC_ORIGIN`。局域网模式监听所有 IPv4 网卡、接受任意目标主机名，并继续限制浏览器请求同源。其他设备访问 `http://<服务器局域网IP>:3210`，防火墙需允许连接。能访问端口的设备均可读写知识库，请勿通过公网端口转发或代理直接暴露。

## 日常流程

1. 直接写知识点，或使用主页的「复制整理提示词」，发到已有的 AI 对话中。
2. 将返回内容通过「粘贴 AI 结果」预览、确认并导入；网站自身不会连接模型。
3. 填写本篇讲解的概念和理解它所需的前置概念，网站按规范化后的关键词完整匹配生成候选关系。
4. 复习到期知识并记录掌握程度。新知识从次日安排首次复习，每天最多安排 10 篇首次复习。

详细的编辑、图片、导入限制、复习间隔与迁移规则见 [使用指南](docs/usage.zh-CN.md)。搜索支持文本和关键词匹配，不提供语义搜索。

## 数据与配置

默认知识目录是被 Git 忽略的 `content/`。正式数据位于：

```text
content/.knowledge/
├── knowledge.sqlite   # 正文、元信息、复习、编辑历史与回收站
└── assets.sqlite      # 上传的图片
```

SQLite 是唯一正式存储；Markdown 是编辑及交换格式。删除数据库不能靠“重建索引”恢复。

| 环境变量 | 默认值 | 用途 |
| --- | --- | --- |
| `KNOWLEDGE_DIR` | `./content` | 知识目录，部署时建议使用绝对路径 |
| `HOST` | `127.0.0.1` | 监听地址 |
| `PORT` | `3210` | 后端端口 |
| `ALLOWED_HOSTS` | 内置回环主机及明确指定的监听地址 | 额外允许的主机名，逗号分隔 |
| `PUBLIC_ORIGIN` | 未设置 | 额外允许的浏览器来源，包含协议和端口 |

```sh
KNOWLEDGE_DIR=/path/to/library PORT=3210 pnpm start
```

`pnpm start` 不自动加载 `.env`，请通过进程环境传入配置。开发模式的 Vite 代理默认连接 3210 端口。

**网站没有登录和用户权限控制。** 能连接 API 的人可以读写知识库；Host / Origin 校验不能代替身份认证。默认仅监听本机，需要远程使用时请配置有认证的私有访问层，参见 [部署说明](deploy/README.md) 与 [安全说明](SECURITY.md)。

## 备份与迁移

```sh
pnpm run backup
# 或指定知识目录之外、尚不存在的目标目录：
pnpm run backup -- /path/to/new-backup
```

备份脚本在共用写锁下生成 SQLite 一致性快照。恢复时先停止网站、保留当前库，再用完整备份替换整个知识目录后重启。

| 方式 | 包含内容 |
| --- | --- |
| 完整备份 | 两个数据库、复习进度、回收站、维护状态与归档 |
| ZIP 导出 | 选中的笔记及其引用图片；不含复习进度和回收站 |
| 纯 Markdown | 笔记正文和元信息；不含图片二进制 |

不要直接复制运行中的单个数据库，也不要混用不同时间的数据库备份。

## 可选 agent skills

`knowledge-export` 用于提炼原子知识，`knowledge-maintain` 用于增量维护 Markdown 或 SQLite 知识库。

```sh
pnpm run package:skills
# 可选：安装到本机 Codex
pnpm run install:skills
```

产物位于 `artifacts/skills/`。手动安装时复制整个目录（含运行时和许可证），并在各自的 `scripts/runtime/` 中运行 `pnpm install --prod`。安装脚本使用 `$CODEX_HOME/skills` 或 `~/.codex/skills`，已有同名 skill 会跳过。

skills 无需网站运行。提供私人笔记前，先了解你所用 agent 的数据处理方式。格式见 [Markdown 协议](skills/knowledge-export/references/protocol.md)，维护行为见 [维护说明](skills/knowledge-maintain/references/maintenance.md)。

## 开发与贡献

```sh
pnpm install --frozen-lockfile
pnpm run dev       # 前端 http://127.0.0.1:5173，后端端口 3210
pnpm test
pnpm run build
```

`src/` 是 React 界面，`server/` 是 Express 与 SQLite 服务，`shared/` 是共用协议和关系计算，`scripts/` 提供备份、维护与打包，`tests/` 包含存储、HTTP、编辑器和图表测试。

欢迎中文或英文 Issue / PR。参与前请阅读 [贡献指南](CONTRIBUTING.md)；漏洞请按 [安全说明](SECURITY.md) 私下反馈。

## 许可证

[MIT](LICENSE) © 2026 [zaoweiceng](https://github.com/zaoweiceng)。第三方依赖保留各自的许可证，见 [第三方说明](THIRD_PARTY_NOTICES.md)。
