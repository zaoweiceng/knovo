# 知序 · 原子知识库

本地运行的个人学习网站。Markdown 保存内容，SQLite 保存索引、新增事件和复习记录。两个通用 skill 分别负责导出与增量维护；网站不调用模型，不需要 API Key，也不创建定时任务。

## 启动

需要 Node.js 24+。首次：

```sh
npm install
npm run build
npm start
```

打开 http://127.0.0.1:3210 。后续只需要 `npm start`。开发使用 `npm run dev`，页面位于 http://127.0.0.1:5173 。服务仅监听本机；不要直接通过公网代理暴露。

默认知识目录为项目下的 `content/`，可用 `KNOWLEDGE_DIR=/你的目录 npm start` 指定；端口由 `PORT` 控制。SQLite 使用 Node 自带的 `node:sqlite`，无需安装数据库。Node 24 可能输出实验性 API 提示，不影响本项目已验证的功能。

`npm run demo` 可生成 7 篇带“示例”标签的演示笔记，文件 ID 以 `demo-` 开头。这些是产品示例，不是你的历史学习记录；可直接删除对应 Markdown。新下载的项目默认没有笔记，本次交付目录中已生成示例供预览。

## 日常使用

- 导出 skill 生成标准 `.md` 后，放进 `content/`（任意非隐藏子目录），或在页面拖拽/选择导入。服务启动扫描，运行时监听变化；页面约两秒内刷新。
- 一个知识点一个稳定 ID。改名、移动目录不改 ID；更新同 ID 保留复习状态。
- 主分类支持任意深度；跨分类联系放在元信息 `prerequisites` / `related`，右侧侧栏和知识网络自动显示。
- 热力图按首次入库的本地日期计数。修改、重复导入、恢复同 ID 不重复计数；删除或合并后历史新增记录仍保留。
- 时间线使用 `learning_events` 的真实学习日期，与入库日期分开。
- 新笔记的首次复习从次日开始，每天最多安排 10 篇首次复习。间隔为 1/3/7/14/30/60 天；没掌握重置，模糊保持，掌握推进。可暂停、恢复或立即复习。
- 文本搜索支持中英文连续片段、多词 AND、分类及关键词筛选；没有语义搜索。知识网络默认当前节点两跳、最多 100 个，可按批展开（上限 1000）或切换中心。

页面只编辑复习状态；正文用编辑器或 skill 修改。原始 HTML 不执行，图片显示为外部链接；不自动下载附件。文件最多 2 MB，单次页面导入最多 100 个、请求总量 24 MB。

## 两个可移植 skill

源文件在 `skills/knowledge-export/` 与 `skills/knowledge-maintain/`。运行：

```sh
npm run package:skills
```

如需安装到本机 Codex，可执行 `npm run install:skills`，它会打包、复制并安装辅助脚本依赖；已有同名 skill 不覆盖。本次交付已完成本机安装。

产出 `artifacts/skills/knowledge-export/` 和 `artifacts/skills/knowledge-maintain/`，每个目录都包含 SKILL.md、协议和独立运行时，可整个复制到其他 agent 的技能目录。默认 Codex 个人目录是 `~/.codex/skills/`；若设置 CODEX_HOME，则使用其 `skills/`。不要只复制 SKILL.md。

复制后在每个 skill 的 `scripts/runtime/` 中运行 `npm install --omit=dev`。两个 skill 不需要网站运行，也不连接 SQLite。可以在对话里直接提供该 SKILL.md 路径；安装发现后也可用 `$knowledge-export` / `$knowledge-maintain`。

导出示例：

> 使用 knowledge-export，把这次关于 Agent 工具调用的讨论拆成可独立复习的知识点，输出到指定目录。有现成知识索引时复用目录与 ID。

维护示例：

> 使用 knowledge-maintain，增量维护 `/绝对路径/content`，只处理本次变化及其有限候选，不整理全库。

首次维护只建基线，不改已有正文。想立即处理指定文件时明确提供文件列表。每次最多 20 个变化、每项最多 10 个候选；剩余内容留到下次调用。确定性脚本管理扫描、校验、指纹、写锁、备份和恢复；语义判断、拆分与事实核验由调用 skill 的 agent 完成。

## Markdown 协议

完整规范与示例见 `skills/knowledge-export/references/protocol.md`。必填字段包括 `schema_version: 1`、`id`、`title`、`summary`、`category`、`status`、`created_at`、`updated_at`、`learning_events`。关联和别名数组可省略；学习日期未知时用 null，不虚构。

```sh
npm run validate
node scripts/knowledge.mjs scan --root content
node scripts/knowledge.mjs scan --root content --files '["相对路径.md"]'
node scripts/knowledge.mjs apply --root content --manifest /path/to/changes.json
node scripts/knowledge.mjs restore --root content --batch 批次ID
```

清单结构见维护 skill 的 `references/maintenance.md`。不要绕过 `apply` 批量覆盖文件；该脚本负责并发检查和备份。合并需同批归档源文件，将旧 ID 写入 `merged_from`。拆分保留原 ID 为概览，新知识点独立复习。

运行异常遗留 `.knowledge/write.lock` 时，先确保原进程已结束，再执行 `node scripts/knowledge.mjs unlock --root content`。脚本拒绝释放仍由活跃进程持有的锁。

## 历史文件

```sh
node scripts/extract-history.mjs /path/to/export.zip --list
node scripts/extract-history.mjs /path/to/export.zip --id 会话ID
node scripts/extract-history.mjs /path/to/session.jsonl
```

支持 ChatGPT ZIP/JSON 当前分支、Codex JSONL 可见用户/助手文字及 MD/TXT。不会自动抓取 ChatGPT 云端，不扫描未指定的 Codex 历史。来源格式变化可能需要适配；无法识别会明确失败。附件不转写，原始历史仅作为 skill 输入，不通过网站提供。

## 备份与恢复

```sh
npm run backup
# 或 npm run backup -- /path/to/new-backup-folder
```

备份整个知识目录，包括 SQLite 一致性快照、维护进度和批次归档；使用共用写锁。备份目标必须是尚不存在、位于知识目录外的新目录。恢复完整备份时先停止网站，再用备份目录替换知识目录，重新启动。

`.knowledge/knowledge.sqlite` 中复习与新增历史不可从 Markdown 重建，因此不要把“重建索引”等同于删数据库。服务启动自动重扫内容；保留数据库即可保留历史。维护批次可独立 restore：恢复前核验文件未被后续修改，恢复后网站撤销对应合并映射；之后发生的新复习事件仍保留。

## 实现与验证

- `shared/protocol.mjs`：网站与 skill 共用解析、文件写入和锁协议。
- `server/`：SQLite、文件监听、本地 API；数据库读写在单进程中执行。
- `src/`：三栏阅读、目录、热力图、网络图、搜索和复习。
- `scripts/`：增量维护、历史提取、打包、备份及可选示例。

`npm test` 覆盖中文搜索、重复导入、异常文件保留、复习日程、关系网络、基线与增量限制、冲突拒绝、合并恢复、历史提取和日历边界；`npm run build` 验证 TypeScript 与生产构建。
