import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";
const home = process.env.CODEX_HOME || path.join(os.homedir(), ".codex");
for (const name of ["knowledge-export", "knowledge-maintain"]) {
  const source = path.resolve("artifacts/skills", name),
    dest = path.join(home, "skills", name);
  if (!fs.existsSync(source)) throw Error("请先运行 npm run package:skills");
  if (fs.existsSync(dest)) {
    console.log(`已存在，未覆盖：${dest}`);
    continue;
  }
  fs.cpSync(source, dest, { recursive: true });
  const result = spawnSync(
    "npm",
    ["install", "--omit=dev", "--no-audit", "--no-fund"],
    { cwd: path.join(dest, "scripts/runtime"), stdio: "inherit" },
  );
  if (result.status !== 0)
    throw Error(`依赖安装失败，请在 ${dest}/scripts/runtime 重试 npm install`);
  console.log(`已安装：${dest}`);
}
