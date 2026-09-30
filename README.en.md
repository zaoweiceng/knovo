# Knovo · 知序

**Understand one idea. Connect it. Remember it.**

[简体中文](README.md) · [User guide (中文)](docs/usage.zh-CN.md) · [Deployment](deploy/README.md) · [Contributing](CONTRIBUTING.md)

Knovo is a local-first personal knowledge library. Turn notes and AI conversations into small, reusable knowledge units, connect concepts, and revisit them with spaced repetition. Your notes, images, and review progress stay in local SQLite databases.

The app runs without an account, API key, or model service. The interface is currently in Simplified Chinese. Optional agent skills help extract and maintain knowledge; those run in your chosen AI agent and follow that agent's data-handling settings.

## Features

- **Capture knowledge:** write a note, import Markdown or a Knovo ZIP, or paste structured results from an AI conversation.
- **Edit with context:** split Markdown/preview and visual editing, tables, local images, LaTeX via KaTeX, and Mermaid diagrams.
- **Connect ideas:** hierarchical categories, concept keywords, dependency matching, and an interactive knowledge graph.
- **Remember what you learn:** spaced repetition, a learning timeline, and a heatmap based on actual learning dates.
- **Keep control of your data:** local SQLite storage, stable note IDs, edit history, a recoverable trash, portable exports, and full backups.

## Quick start

Requires **Node.js 24+** and **pnpm 10.27.0** (the version pinned in `package.json`).

```sh
git clone https://github.com/zaoweiceng/knovo.git
cd knovo
pnpm install --frozen-lockfile
pnpm run build
pnpm start
```

Open **http://127.0.0.1:3210**. New installations start with an empty library. To add seven sample notes, run `pnpm run demo`, then refresh the page. Later starts only require `pnpm start`.

Node.js may print an experimental warning for its built-in `node:sqlite` module. No separate database server is needed.

## Startup modes

```sh
pnpm run start:local  # Only this computer (forces loopback, even with HOST set)
pnpm run start:lan    # Other devices on your trusted LAN
```

`pnpm start` uses the environment configuration and defaults to local access. Explicit modes override `HOST` and `ALLOWED_HOSTS`; both retain `PORT` and `KNOWLEDGE_DIR`. Local mode also clears `PUBLIC_ORIGIN`. LAN mode listens on all IPv4 interfaces and accepts any destination hostname, while keeping browser requests same-origin. Open `http://<server-lan-ip>:3210` from another device; your firewall must allow the connection. All devices that can reach the port can read and modify notes. Do not expose this unauthenticated port through a public router or proxy.

## Everyday workflow

1. Create a note, import Markdown/ZIP, or use **复制整理提示词** to prepare a prompt for an existing AI conversation.
2. Paste the AI result through **粘贴 AI 结果**, inspect the preview, and import it. Knovo does not contact the AI service itself.
3. Add the concepts a note explains and the concepts it depends on. Exact normalized keyword matches generate suggested connections.
4. Review due notes and record your understanding. New notes enter review from the next day, with up to ten first reviews scheduled per day.

See the [full user guide](docs/usage.zh-CN.md) for editing, import limits, review intervals, images, and migration behavior. Search matches text and keywords; it is not semantic search.

## Data and configuration

The default library lives in `content/`, which Git ignores:

```text
content/.knowledge/
├── knowledge.sqlite   # Notes, metadata, reviews, edit history, and trash
└── assets.sqlite      # Uploaded images
```

SQLite is the source of truth. Markdown is the editing and exchange format; deleting the database cannot be repaired by rebuilding an index.

| Variable | Default | Purpose |
| --- | --- | --- |
| `KNOWLEDGE_DIR` | `./content` | Library directory; use an absolute path when deploying |
| `HOST` | `127.0.0.1` | Listen address |
| `PORT` | `3210` | Backend port |
| `ALLOWED_HOSTS` | Built-in loopback hosts and the explicit listen address | Additional allowed hostnames, comma-separated |
| `PUBLIC_ORIGIN` | Unset | Additional allowed browser origin, including scheme and port |

```sh
KNOWLEDGE_DIR=/path/to/library PORT=3210 pnpm start
```

These are process environment variables; `pnpm start` does not automatically load a `.env` file. The Vite development proxy expects the backend on port 3210.

**Knovo has no login or user authorization.** Anyone who can reach the API can read or modify the library. Host/origin checks do not replace authentication. Keep the default loopback binding, or use an authenticated private access layer. See [deployment](deploy/README.md) and [security](SECURITY.md).

## Back up and move your library

```sh
pnpm run backup
# Or choose a new directory outside your library:
pnpm run backup -- /path/to/new-backup
```

The backup command takes consistent SQLite snapshots under the shared write lock. To restore, stop Knovo, preserve your current library, replace the entire library directory with the backup, and restart.

- **Full backup:** preserves both databases, review progress, trash, and maintenance history.
- **ZIP export/import:** moves selected notes and referenced images; it does not move review progress or trash.
- **Plain Markdown:** preserves note text and metadata; image binaries are not included.

Never copy only one database from a running instance or mix database files from different backups.

## Optional agent skills

The repository includes `knowledge-export` for extracting atomic notes and `knowledge-maintain` for incremental maintenance of Markdown or SQLite libraries.

```sh
pnpm run package:skills
# Optional: install into your local Codex skills directory
pnpm run install:skills
```

Packages appear in `artifacts/skills/`. Copy the entire skill directory, including its runtime and license. For manual installation, run `pnpm install --prod` in its `scripts/runtime/` directory. The installer uses `$CODEX_HOME/skills` or `~/.codex/skills` and skips existing skills.

Skills do not require the web app to be running. Review the source and your agent's data settings before providing personal notes. See the [Markdown protocol](skills/knowledge-export/references/protocol.md) and [maintenance instructions](skills/knowledge-maintain/references/maintenance.md).

## Development

```sh
pnpm install --frozen-lockfile
pnpm run dev       # Frontend: http://127.0.0.1:5173; backend: port 3210
pnpm test
pnpm run build
```

| Directory | Responsibility |
| --- | --- |
| `src/` | React UI, Markdown and visual editors, graph, and review screens |
| `server/` | Express API, SQLite storage, assets, and import/export |
| `shared/` | Note protocol, relationships, topology, and text imports |
| `scripts/` | Backups, maintenance, history extraction, and skill packaging |
| `skills/` | Portable agent instructions and protocol references |
| `tests/` | Storage, HTTP, graph, editor, and scientific Markdown tests |

Contributions in English or Chinese are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md) before opening a pull request. Report vulnerabilities through the process in [SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE) © 2026 [zaoweiceng](https://github.com/zaoweiceng). Third-party dependencies retain their own licenses; see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
