# 知序 · 原子知识库

本地运行的个人学习网站。Markdown 保存内容，SQLite 保存索引、新增事件和复习记录。两个通用 skill 分别负责导出与增量维护；网站不调用模型，不需要 API Key，也不创建定时任务。

## 启动

需要 Node.js 24+。首次：

```sh
pnpm install
pnpm run build
pnpm start
```

打开 http://127.0.0.1:3210 。后续只需要 `pnpm start`。开发使用 `pnpm run dev`，页面位于 http://127.0.0.1:5173 。服务仅监听本机；不要直接通过公网代理暴露。

默认知识目录为项目下的 `content/`，可用 `KNOWLEDGE_DIR=/你的目录 pnpm start` 指定；端口由 `PORT` 控制。SQLite 使用 Node 自带的 `node:sqlite`，无需安装数据库。Node 24 可能输出实验性 API 提示，不影响本项目已验证的功能。

`pnpm run demo` 可生成 7 篇带“示例”标签的演示笔记，文件 ID 以 `demo-` 开头。这些是产品示例，不是你的历史学习记录；可直接删除对应 Markdown。新下载的项目默认没有笔记，本次交付目录中已生成示例供预览。

## 日常使用

界面采用黑白灰配色。桌面端拖动左侧栏右边缘可调整宽度（220–420px），刷新后保留；双击边缘重置，也可聚焦边缘后用左右方向键调整。手机端仍使用抽屉。

分类筛选按层级逐级进入，支持直接搜索分类路径；关键词面板优先展示当前分类下的常用词，可搜索和继续展开。已选条件在列表上方显示，可单独移除。

知识点详情页的“删除知识点”会将 Markdown 移入隐藏回收站；可从左侧底部“回收站”恢复，保留原 ID、复习进度和首次入库记录。不提供永久清空；同 ID 或原路径被占用时拒绝覆盖。删除不会级联删除相关知识，失效引用会标记待修复。回收站包含在知识目录的完整备份中。

- 导出 skill 生成标准 `.md` 后，放进 `content/`（任意非隐藏子目录），或在页面拖拽/选择导入。服务启动扫描，运行时监听变化；页面约两秒内刷新。
- 一个知识点一个稳定 ID。改名、移动目录不改 ID；更新同 ID 保留复习状态。
- 主分类支持任意深度；跨分类联系放在元信息 `prerequisites` / `related`，右侧侧栏和知识网络自动显示。
- 热力图按 Markdown 中 `learning_events.date` 的实际学习日期统计，同一天同一知识点只计一次；同一知识点在不同日期学习可分别计数，因此累计次数可能大于知识点总数。日期未知的事件不冒充导入当天。点击方块显示同口径的当天知识点；日期修正后自动重算。删除保留历史，合并后的同一天相同身份去重。首次入库审计记录独立保留，不用于学习热力图。
- 时间线使用 `learning_events` 的真实学习日期，与入库日期分开。
- 新笔记的首次复习从次日开始，每天最多安排 10 篇首次复习。间隔为 1/3/7/14/30/60 天；没掌握重置，模糊保持，掌握推进。可暂停、恢复或立即复习。
- 文本搜索支持中英文连续片段、多词 AND、分类及关键词筛选；没有语义搜索。知识网络默认当前节点两跳、最多 100 个，可按批展开（上限 1000）或切换中心。

页面顶部「新建知识点」打开全屏编辑器；知识详情中的「编辑知识点」修改已有文件。新建时先用表单填写标题、简介、分类、关键词、状态和学习记录，再进入正文编辑；编辑已有知识点可随时切换「基本信息」。左侧只编辑 Markdown 正文，右侧实时渲染，双向按滚动比例同步。保存时自动生成 YAML 文件头，并保留 ID、创建时间、关联、别名等未编辑字段。保存会校验协议、自动更新修改时间、备份旧文件，并验证读取时的文件指纹；并发冲突不会覆盖。已有 ID、创建时间与复习进度保持不变。取消未保存修改会提示，刷新或关闭页面也会提示；草稿不自动保存。

「批量导出」按学习日期（默认）、创建日期或修改日期选择闭区间，每个知识点仅导出一次；未知学习日期不匹配学习日期筛选。下载的 ZIP 包含完整 Markdown 与版本化清单，保留 ID、分类、标签、学习事件和关联；不会自动扩展到范围外的关联目标，不迁移 SQLite、回收站或复习进度。新设备中未导入的关联显示待修复，新知识按目标设备的规则安排复习。

「导入知识」同一入口支持多个 `.md` 或本系统生成的 `.zip`，可混选。Markdown 沿用同 ID 更新（备份旧文件）的行为；ZIP 先校验整包格式、ID、哈希和大小，相同内容跳过，同 ID 不同内容或回收站冲突逐项报告，不覆盖本地版本。有效包的各项独立导入，失败项保留错误明细，可修复后重试。每个 Markdown 最多 2 MB，每包最多 1000 篇、20 MB 正文；ZIP 文件最多 100 MB。

原始 HTML 不执行，外部图片显示为链接，插入的本地图片直接显示；不自动下载附件。

## 两个可移植 skill

源文件在 `skills/knowledge-export/` 与 `skills/knowledge-maintain/`。运行：

```sh
pnpm run package:skills
```

如需安装到本机 Codex，可执行 `pnpm run install:skills`，它会打包、复制并安装辅助脚本依赖；已有同名 skill 不覆盖。本次交付已完成本机安装。

产出 `artifacts/skills/knowledge-export/` 和 `artifacts/skills/knowledge-maintain/`，每个目录都包含 SKILL.md、协议和独立运行时，可整个复制到其他 agent 的技能目录。默认 Codex 个人目录是 `~/.codex/skills/`；若设置 CODEX_HOME，则使用其 `skills/`。不要只复制 SKILL.md。

复制后在每个 skill 的 `scripts/runtime/` 中运行 `pnpm install --omit=dev`。两个 skill 不需要网站运行，也不连接 SQLite。可以在对话里直接提供该 SKILL.md 路径；安装发现后也可用 `$knowledge-export` / `$knowledge-maintain`。

导出示例：

> 使用 knowledge-export，把这次关于 Agent 工具调用的讨论拆成可独立复习的知识点，输出到指定目录。有现成知识索引时复用目录与 ID。

维护示例：

> 使用 knowledge-maintain，增量维护 `/绝对路径/content`，只处理本次变化及其有限候选，不整理全库。

首次维护只建基线，不改已有正文。想立即处理指定文件时明确提供文件列表。每次最多 20 个变化、每项最多 10 个候选；剩余内容留到下次调用。确定性脚本管理扫描、校验、指纹、写锁、备份和恢复；语义判断、拆分与事实核验由调用 skill 的 agent 完成。

## Markdown 协议

完整规范与示例见 `skills/knowledge-export/references/protocol.md`。必填字段包括 `schema_version: 1`、`id`、`title`、`summary`、`category`、`status`、`created_at`、`updated_at`、`learning_events`。关联和别名数组可省略；学习日期未知时用 null，不虚构。

```sh
pnpm run validate
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
pnpm run backup
# 或 pnpm run backup -- /path/to/new-backup-folder
```

备份整个知识目录，包括 SQLite 一致性快照、维护进度和批次归档；使用共用写锁。备份目标必须是尚不存在、位于知识目录外的新目录。恢复完整备份时先停止网站，再用备份目录替换知识目录，重新启动。

`.knowledge/knowledge.sqlite` 中复习与新增历史不可从 Markdown 重建，因此不要把“重建索引”等同于删数据库。服务启动自动重扫内容；保留数据库即可保留历史。维护批次可独立 restore：恢复前核验文件未被后续修改，恢复后网站撤销对应合并映射；之后发生的新复习事件仍保留。

## 实现与验证

- `shared/protocol.mjs`：网站与 skill 共用解析、文件写入和锁协议。
- `server/`：SQLite、文件监听、本地 API；数据库读写在单进程中执行。
- `src/`：三栏阅读、目录、热力图、网络图、搜索和复习。
- `scripts/`：增量维护、历史提取、打包、备份及可选示例。

`npm test` 覆盖中文搜索、重复导入、异常文件保留、复习日程、关系网络、基线与增量限制、冲突拒绝、合并恢复、历史提取和日历边界；`pnpm run build` 验证 TypeScript 与生产构建。

### 从任意 AI 对话整理并粘贴导入

主页「复制整理提示词」包含完整的 `zhixu-knowledge-v1` JSON 规范。将提示词发到原来的 AI 对话窗口，复制返回的整个代码块，在「新建知识点 → 粘贴 AI 结果」或主页快捷入口粘贴。系统自动识别并预览，确认后批量导入（一次最多 100 篇、20 MB；每篇仍限 2 MB）。无需安装 skill，网站也不调用模型。

JSON 以 `notes` 数组承载多篇，每篇正文是 `body` Markdown 字符串；本批次通过唯一 `key` 建立前置/相关关联。系统生成稳定 ID 和时间，不让 AI 编造日期。未知学习日期为 null。支持带/不带外层代码围栏，也兼容单篇完整 Markdown。格式不合法时显示具体原因且不写入；相同内容重复导入跳过，同 ID 冲突不覆盖。修改 AI 原文后重新整理的内容可能生成新 ID，可使用增量维护 skill 去重。

### 编辑工具与图片

基本信息和正文切换位于顶部操作区。正文工具栏与右键菜单支持一至六级标题、正文、粗体、斜体、删除线、代码、列表、待办、引用和表格。行内格式作用于选中文字，标题与列表应用到选中的整行；无选区时应用到光标所在行。

「图片」选择 PNG、JPEG、GIF 或 WebP（单张最多 10 MB）。图片二进制存入独立的 `.knowledge/assets.sqlite`，知识索引与复习状态保留在 `.knowledge/knowledge.sqlite`。两个数据库分别启用 WAL；图片存入 assets 表，以内容 SHA-256 去重，Markdown 使用稳定的 `/api/assets/<hash>` 引用。迁移 ZIP v2 自动包含被引用的图片原始二进制并校验哈希；导入兼容旧版 v1，无需外部图片目录。正文最多 20 MB，含图片总内容最多 95 MB，ZIP 最多 100 MB。

完整备份必须同时保留 Markdown 与两个 SQLite 文件（`pnpm run backup` 已包含，使用 SQLite 备份 API 而非直接复制运行中的数据库）；仅拷贝 Markdown 不包含图片。删除知识点或取消插图草稿暂不清理图片，以免回收站恢复或历史版本丢图。

升级时自动将旧 knowledge.sqlite 的图片复制到 assets.sqlite，逐条核对哈希与内容后移除旧表；中断后可重试。迁移不改变图片引用。旧数据库释放的页留待 SQLite 复用，不在启动时执行耗时的 VACUUM。恢复时停止服务后恢复整个备份目录，避免混用不同时间的两个数据库。

### 可视化编辑与撤销

正文工具栏右侧可切换「分栏编辑」和「所见即所得」。分栏右侧同样可直接输入、编辑表格，并同步更新左侧 Markdown。点击表格单元格后，工具栏出现增删行列快捷按钮；「表格」菜单和右键菜单提供指定方向插入、删除行列及整表删除。Tab 可切换单元格。

源码输入、可视化编辑、插入表格和格式操作共用当前编辑会话的撤销历史：`⌘/Ctrl Z` 撤销，`⌘/Ctrl Shift Z` 或 `Ctrl Y` 重做，也可使用工具栏按钮。切换模式不清空历史，关闭编辑器后历史不保留。正文仍保存为 Markdown，可视化编辑会规范化 Markdown 排版，支持常用 GFM 标题、列表、待办、表格、代码块、链接及图片；不是 Typora 全部扩展语法的复刻。
