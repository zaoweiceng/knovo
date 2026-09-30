import fs from "node:fs";
import path from "node:path";
const out = path.resolve("artifacts/skills");
for (const name of ["knowledge-export", "knowledge-maintain"]) {
  const dir = path.join(out, name);
  fs.mkdirSync(dir, { recursive: true });
  fs.cpSync(path.resolve("skills", name), dir, { recursive: true });
  const runtime = path.join(dir, "scripts/runtime");
  fs.mkdirSync(path.join(runtime, "shared"), { recursive: true });
  fs.mkdirSync(path.join(runtime, "scripts"), { recursive: true });
  fs.copyFileSync(
    "shared/protocol.mjs",
    path.join(runtime, "shared/protocol.mjs"),
  );
  for (const script of [
    "knowledge.mjs",
    "extract-history.mjs",
    "sqlite-maintenance.mjs",
  ])
    fs.copyFileSync(
      path.join("scripts", script),
      path.join(runtime, "scripts", script),
    );
  fs.mkdirSync(path.join(runtime, "server"), { recursive: true });
  for (const file of ["store.mjs", "file-store.mjs"])
    fs.copyFileSync(
      path.join("server", file),
      path.join(runtime, "server", file),
    );
  fs.copyFileSync(
    "shared/relations.mjs",
    path.join(runtime, "shared/relations.mjs"),
  );
  fs.writeFileSync(
    path.join(runtime, "package.json"),
    JSON.stringify(
      {
        name: `${name}-runtime`,
        private: true,
        type: "module",
        engines: { node: ">=24" },
        dependencies: { yaml: "^2.8.0", "adm-zip": "^0.6.1" },
      },
      null,
      2,
    ),
  );
  console.log(dir);
}
