import { useState } from "react";
import { type Note, localDay } from "./types";
export default function ExportDialog({
  notes,
  onClose,
}: {
  notes: Note[];
  onClose: () => void;
}) {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState(localDay(new Date()));
  const [basis, setBasis] = useState("learning");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const selected = notes.filter((n) => {
    if (!from || !to || from > to) return false;
    const dates =
      basis === "learning"
        ? n.learning_events.map((e) => e.date)
        : [
            localDay(
              new Date(basis === "created" ? n.created_at : n.updated_at),
            ),
          ];
    return dates.some((d) => d && d >= from && d <= to);
  });
  const ids = new Set(selected.map((n) => n.id));
  const exportFiles = async () => {
    setBusy(true);
    setError("");
    try {
      const res = await fetch(
        "/api/export?" + new URLSearchParams({ from, to, basis }),
      );
      if (!res.ok) throw Error((await res.json()).error);
      const url = URL.createObjectURL(await res.blob());
      const link = document.createElement("a");
      link.href = url;
      link.download = `knowledge-${from}-${to}.zip`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="modal-backdrop">
      <section
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label="导出迁移包"
      >
        <div className="section-line">
          <h2>导出迁移包</h2>
          <button className="btn" onClick={onClose} disabled={busy}>
            关闭
          </button>
        </div>
        <p>
          按日期范围打包完整 Markdown，在另一台设备的「导入知识」中选择 ZIP
          即可导入。
        </p>
        <div className="export-fields">
          <label>
            日期依据
            <select value={basis} onChange={(e) => setBasis(e.target.value)}>
              <option value="learning">实际学习日期</option>
              <option value="created">创建日期</option>
              <option value="updated">修改日期</option>
            </select>
          </label>
          <label>
            开始日期
            <input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              max={to}
            />
          </label>
          <label>
            结束日期
            <input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              min={from}
            />
          </label>
        </div>
        <p>
          {from && to && from <= to
            ? `已选 ${ids.size} 个知识点（包含起止日期，同一知识点只导出一次）`
            : "请选择日期范围"}
        </p>
        <div className="export-note-list">
          {selected.map((n) => (
            <div key={n.id}>{n.title}</div>
          ))}
        </div>
        <p className="muted">
          保留
          ID、元信息、学习日期和关联声明；范围外的关联目标不会自动加入包。复习进度使用目标设备的记录，新知识点重新安排复习。
        </p>
        {error && <p role="alert">{error}</p>}
        <div className="modal-bottom">
          <span>最多 1000 篇 · 正文 20 MB · 含图片总计 95 MB</span>
          <button
            className="btn primary"
            disabled={busy || !from || !to || from > to || !selected.length}
            onClick={exportFiles}
          >
            {busy ? "正在打包…" : "下载 ZIP 迁移包"}
          </button>
        </div>
      </section>
    </div>
  );
}
