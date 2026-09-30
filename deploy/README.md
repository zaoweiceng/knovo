# Deploying Knovo

These are example Linux/systemd templates. Adjust the paths and Node.js executable for your machine. Node.js 24+ is required.

Knovo has no login or per-user access control. Templates default to loopback access. For remote use, add an authenticated private access layer and appropriate firewall rules before changing `HOST`. See [SECURITY.md](../SECURITY.md).

## Build the application

From a fresh checkout:

```sh
pnpm install --frozen-lockfile
pnpm run build
```

The server needs the source directories, `package.json`, `pnpm-lock.yaml`, production dependencies, and the built `dist/` directory. If transferring a build to a different machine, install dependencies there with `pnpm install --prod --frozen-lockfile`; do not copy platform-specific `node_modules` across operating systems. Do not transfer personal data as part of the code package.

## System service

The `knowledge.service` example uses a dedicated `knovo` system user and this layout:

```text
/srv/knovo/
├── app/                  # Checkout, dependencies, and dist/
├── data/content/         # Persistent library
├── knowledge.env         # Private runtime configuration
└── backups/              # Full backups, separate from the library
```

1. Create the `knovo` user/group and the directories using your distribution's administration tools. The service account needs read access to `app/` and write access to `data/` and `backups/`.
2. Place the built application in `app/`. Copy `knowledge.env.example` to `/srv/knovo/knowledge.env`, review the settings, and restrict it to the service account (mode `0600`). Restrict the data and backup directories as well.
3. Check `command -v node` reports Node.js 24+, then adjust `ExecStart` in the service template if necessary.
4. Install the template and start it:

```sh
sudo cp deploy/knowledge.service /etc/systemd/system/knowledge.service
sudo systemctl daemon-reload
sudo systemctl enable --now knowledge
sudo systemctl status knowledge
sudo journalctl -u knowledge -n 100
```

The default endpoint on the server is `http://127.0.0.1:3210`. For personal remote access, an SSH tunnel can preserve the loopback binding:

```sh
ssh -L 3210:127.0.0.1:3210 your-user@your-server
```

Then open `http://127.0.0.1:3210` on your computer. Your SSH account must already be authorized on that server.

## User service

`knowledge-user.service` uses systemd's `%h` placeholder for the current user's home directory:

```text
~/knovo/app/
~/knovo/data/content/
~/knovo/knowledge.env
~/knovo/backups/
```

Copy the example configuration to `~/knovo/knowledge.env` and set `KNOWLEDGE_DIR` to the **absolute path** of `~/knovo/data/content`. systemd environment files do not expand `~`, `$HOME`, or `%h`. Update the Node.js path in `ExecStart` if needed.

```sh
mkdir -p ~/.config/systemd/user
cp deploy/knowledge-user.service ~/.config/systemd/user/knowledge.service
systemctl --user daemon-reload
systemctl --user enable --now knowledge
systemctl --user status knowledge
journalctl --user -u knowledge -n 100
```

If the service must run after logout, an administrator may need to enable lingering for that account using `loginctl enable-linger <user>`.

## Choose local or LAN mode

For an interactive start from `app/`:

```sh
pnpm run start:local  # Loopback only
pnpm run start:lan    # Listen on all IPv4 interfaces
```

The default `pnpm start` and unmodified service templates use the environment configuration and default to local access. To force a mode in systemd, append `--local` or `--lan` to the template’s `ExecStart` line, then run `daemon-reload` and restart the service. For example, the system service can use:

```ini
ExecStart=/usr/bin/node /srv/knovo/app/server/index.mjs --lan
```

Explicit modes override `HOST` and `ALLOWED_HOSTS` while preserving `PORT` and `KNOWLEDGE_DIR`; local mode also clears `PUBLIC_ORIGIN`. LAN mode accepts any destination hostname and retains same-origin browser checks. Connect through the server’s LAN address, with the port allowed by your firewall. It provides no login: everyone who can reach the port can read and modify the library. Use it only on a trusted private network.

## Network configuration

- `HOST=127.0.0.1` keeps the listener local to the server.
- Binding to a specific network address automatically allows that hostname; `ALLOWED_HOSTS` adds comma-separated hostnames without schemes or ports.
- If a reverse proxy changes the public scheme or port, set `PUBLIC_ORIGIN` to the exact browser origin (for example `https://notes.example.com`) and include the public hostname in `ALLOWED_HOSTS`.
- Do not use `ALLOWED_HOSTS=*` as a substitute for configuring hostnames. These checks do not provide authentication.

The service loads the configuration through systemd's `EnvironmentFile`. A normal `pnpm start` does not automatically read it. Configuration changes take effect after restarting the service.

## Back up, restore, and upgrade

Run backups as the service account so the process can access the library. From `app/`, supply the same absolute `KNOWLEDGE_DIR` as the service:

```sh
KNOWLEDGE_DIR=/srv/knovo/data/content pnpm run backup -- /srv/knovo/backups/manual-backup
```

The target must be a new directory outside the library. Use a different target for each backup. User-service installations should substitute their own absolute paths.

Before an upgrade, take a full backup, stop the service, update the code and dependencies, rebuild, and restart. Preserve `data/`, `knowledge.env`, and `backups/` when replacing `app/`.

To restore, stop the service, preserve the current data, and restore the entire backup into the configured library directory. Verify ownership before restarting. Backups include both `knowledge.sqlite` and `assets.sqlite`; do not copy live database files or mix snapshots from different times. Some startup migrations change the data format, so downgrading may require restoring the matching full backup.
