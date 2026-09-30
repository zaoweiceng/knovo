# Contributing to Knovo

Issues and pull requests in English or Chinese are welcome. Start with a small, reproducible problem or a concrete user need. For substantial behavior or storage changes, discuss the proposal in an issue before implementing it.

## Set up

Use Node.js 24+ and pnpm 10.27.0:

```sh
pnpm install --frozen-lockfile
pnpm run dev
```

Use an empty test library for manual development:

```sh
KNOWLEDGE_DIR=/path/to/disposable-library pnpm run dev
```

Do not experiment with migrations or destructive edits against your only copy of a real library. Create a full backup first.

## Before opening a pull request

```sh
pnpm test
pnpm run build
pnpm run package:skills
```

- Explain the problem, resulting behavior, and how you verified the change.
- Add or update regression tests when changing behavior. Documentation-only fixes do not need new tests.
- Keep README translations and protocol references consistent when changing public behavior.
- Preserve stable note IDs, optimistic-concurrency checks, and recoverable migrations. Describe any data-format change explicitly.
- Format only files you changed using `pnpm exec prettier --write <files>`; avoid unrelated formatting changes.
- Commit `pnpm-lock.yaml` when dependencies change. The application stays `private: true` in package metadata to prevent accidental npm publication; this does not affect its MIT license.

Run the checks above locally before submitting a change. To scan Git history for secrets, install Gitleaks and run:

```sh
gitleaks git . --log-opts="--all --full-history" --redact
```

## Keep personal data out of contributions

Do not commit knowledge libraries, conversation exports, database files, backups, `.env` files, credentials, or real deployment details. Keep the checked-in `.npmrc` limited to public registry configuration; never add authentication tokens. If your shell or user-level configuration overrides registries, verify dependency changes against `https://registry.npmjs.org/`. Use `example.com`, documentation IP addresses such as `192.0.2.10`, and synthetic notes in examples and tests. Review `git diff --cached` before committing. Report vulnerabilities according to [SECURITY.md](SECURITY.md), without placing exploit details or secrets in a public issue.

By submitting a contribution, you agree that it is provided under the repository's [MIT License](LICENSE). Be respectful and keep feedback focused on the work.
