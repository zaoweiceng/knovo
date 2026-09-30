/** Explicit host/origin allowlists; default remains loopback-only. */
export function startupConfig(env = process.env, args = []) {
  if (
    args.length > 1 ||
    (args.length && !["--local", "--lan"].includes(args[0]))
  )
    throw Error("启动参数仅支持 --local 或 --lan");
  if (args[0] === "--local")
    return accessConfig({
      ...env,
      HOST: "127.0.0.1",
      ALLOWED_HOSTS: "",
      PUBLIC_ORIGIN: "",
    });
  if (args[0] === "--lan")
    return accessConfig({ ...env, HOST: "0.0.0.0", ALLOWED_HOSTS: "*" });
  return accessConfig(env);
}

export function accessConfig(env = process.env) {
  const host = env.HOST || "127.0.0.1";
  const port = Number(env.PORT || 3210);
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw Error("无效 PORT");
  const hosts = new Set(["localhost", "127.0.0.1", "[::1]"]);
  if (!["0.0.0.0", "::"].includes(host)) hosts.add(host);
  for (const value of (env.ALLOWED_HOSTS || "").split(",").filter(Boolean))
    hosts.add(value.trim().toLowerCase());
  const origins = new Set(
    [...hosts]
      .filter((h) => h !== "*")
      .flatMap((h) => [
        `http://${h}:${port}`,
        ...(["localhost", "127.0.0.1", "[::1]"].includes(h)
          ? [`http://${h}:5173`]
          : []),
      ])
      .map((value) => new URL(value).origin),
  );
  if (env.PUBLIC_ORIGIN) origins.add(new URL(env.PUBLIC_ORIGIN).origin);
  return {
    host,
    port,
    allows(hostname, origin, authority = `${hostname}:${port}`) {
      if (!hosts.has("*") && !hosts.has(hostname.toLowerCase())) return false;
      if (!origin) return true;
      if (!hosts.has("*")) return origins.has(origin);
      // Any deployment address is accepted, but another website cannot make
      // browser requests to this service. Compare the full host including port.
      try {
        const from = new URL(origin);
        if (
          !["http:", "https:"].includes(from.protocol) ||
          from.origin !== origin
        )
          return false;
        const target = new URL(`${from.protocol}//${authority}`);
        return from.host === target.host;
      } catch {
        return false;
      }
    },
  };
}
