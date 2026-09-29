import { useEffect, useState } from "react";
import { api } from "./types";
type Item = {
  id: string;
  title: string;
  category: string[];
  summary: string;
  body: string;
};
type Result = { id: string; title: string; status: string; message?: string };
export default function PasteImport({
  onImported,
  onBusy,
  onDirty,
}: {
  onImported: () => Promise<void>;
  onBusy: (busy: boolean) => void;
  onDirty: (dirty: boolean) => void;
}) {
  const [text, setText] = useState("");
  const [items, setItems] = useState<Item[]>([]);
  const [error, setError] = useState("");
  const [checking, setChecking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<Result[]>([]);
  useEffect(() => {
    let alive = true;
    setItems([]);
    setError("");
    if (!text.trim()) {
      setChecking(false);
      return;
    }
    setChecking(true);
    const timer = setTimeout(() => {
      api<Item[]>("/import-text/preview", {
        method: "POST",
        body: JSON.stringify({ text }),
      })
        .then((x) => {
          if (alive) setItems(x);
        })
        .catch((e) => {
          if (alive) setError(e.message);
        })
        .finally(() => {
          if (alive) setChecking(false);
        });
    }, 350);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [text]);
  const apply = async () => {
    setBusy(true);
    onBusy(true);
    setError("");
    try {
      const result = await api<Result[]>("/import-text", {
        method: "POST",
        body: JSON.stringify({ text }),
      });
      setResults(result);
      onDirty(result.some((r) => r.status === "error"));
      await onImported();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      onBusy(false);
    }
  };
  return (
    <div className="paste-import">
      <h3>粘贴 AI 整理结果</h3>
      <p>
        粘贴完整 JSON 文本块即可自动识别一篇或多篇，也兼容单篇带文件头的
        Markdown。确认内容后批量导入。
      </p>
      <textarea
        aria-label="AI 知识点文本"
        placeholder="在这里粘贴 AI 返回的完整文本块…"
        value={text}
        disabled={busy}
        onChange={(e) => {
          setText(e.target.value);
          setResults([]);
          onDirty(!!e.target.value.trim());
        }}
      />
      {checking && <p role="status">正在识别…</p>}
      {error && <p role="alert">{error}</p>}
      {items.length > 0 && (
        <>
          <div className="section-line">
            <strong>已识别 {items.length} 个知识点</strong>
            <button
              className="btn primary"
              disabled={busy || checking}
              onClick={apply}
            >
              {busy ? "正在导入…" : `导入 ${items.length} 个知识点`}
            </button>
          </div>
          <p className="muted">
            相同内容重复粘贴会跳过；同 ID 冲突不会覆盖已有内容。
          </p>
          {items.map((n) => (
            <details key={n.id}>
              <summary>
                {n.title} <small>{n.category.join(" / ")}</small>
              </summary>
              <p>{n.summary}</p>
              <pre>{n.body}</pre>
            </details>
          ))}
        </>
      )}
      {results.length > 0 && (
        <div className="paste-results" role="status">
          {results.map((r) => (
            <p key={r.id}>
              <strong>{r.title}</strong>：
              {r.message ||
                {
                  created: "已导入",
                  skipped: "内容相同，已跳过",
                  updated: "已更新",
                }[r.status]}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}
