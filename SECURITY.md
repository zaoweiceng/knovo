# Security

## Deployment boundary

Knovo is a personal application with **no built-in authentication or per-user authorization**. The server binds to `127.0.0.1` by default. Anyone with network access to its API can read, export, modify, or delete notes.

Host and browser-origin checks reduce unwanted cross-origin access; they do not authenticate API clients. Do not expose the service directly to the public internet. If remote access is needed, put it behind an authenticated private access layer and limit who can reach the port. Setting `ALLOWED_HOSTS=*` broadens accepted hostnames and should not be a default deployment choice.

SQLite databases and backups contain plaintext personal data. Protect their filesystem permissions and use encrypted storage or encrypted backups where needed. A Markdown or ZIP export may contain private note content and images.

The app itself does not call model services. Optional skills execute in the agent you choose; inspect that agent's data-handling settings before sharing sensitive notes or conversations.

## Supported versions

Security fixes are applied to the latest `main` branch. There is no separate policy for backporting fixes to older snapshots.

## Report a vulnerability

If GitHub private vulnerability reporting is enabled, use the repository's **Security → Report a vulnerability** button. Include the affected revision, reproduction steps using synthetic data, expected impact, and any suggested mitigation.

If that button is unavailable, open an issue titled **Private security contact requested** with no vulnerability details or sensitive attachments, so the maintainer can arrange a private channel. Do not publish credentials, personal libraries, or a working exploit in a public issue.

Automated secret scanning is a useful check, not proof that every form of sensitive information has been removed. If a real credential has ever been committed, revoke or rotate it; deleting the text or rewriting history alone does not revoke it.
