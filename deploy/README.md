# 服务器部署

目标：`knovo@192.0.2.10`，目录 `/srv/knovo`。

- `app/`：服务代码和构建后的前端，升级只替换此目录。
- `data/content/`：Markdown、`.knowledge/knowledge.sqlite`、`.knowledge/assets.sqlite`、维护状态与归档。
- `knowledge.env`：运行配置（参考 knowledge.env.example）。
- `backups/`：完整备份。

需要 Node.js 24+。服务模板中的 `/usr/bin/node` 必须根据服务器实际安装路径调整。在 app 中执行 `ppnpm install --prod --frozen-lockfile`。部署包已包含 dist，无需服务器构建。

systemd 模板使用 knovo 账户运行；安装到 `/etc/systemd/system/knowledge.service` 后执行 `sudo systemctl daemon-reload`、`sudo systemctl enable --now knowledge`。查看状态 `systemctl status knowledge`，查看日志 `journalctl -u knowledge -n 100`。

配置后访问 `http://192.0.2.10:3210`。服务监听所有 IPv4 接口，允许任意 IP 或域名访问（HOST=0.0.0.0、ALLOWED_HOSTS=*），浏览器请求仍需同源；不自动修改防火墙或路由器。当前网站没有用户登录，能访问该端口的内网设备可读写知识库；不适用于直接暴露公网。

迁移现有数据必须使用 `pnpm run backup -- <备份目录>` 的完整产物，包含 Markdown 和两个 SQLite 快照，不能直接复制运行中的 SQLite 文件。恢复前停止服务，把备份整体放到 data/content，确认归属 knovo 后启动。不要覆盖服务器已存在的数据，先备份并核对。
