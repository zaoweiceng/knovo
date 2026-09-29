import { useMemo, useState } from "react";
import { calendarCells, heatLevel } from "./calendar";
export default function Heatmap({
  days,
  today,
  onDay,
}: {
  days: { date: string; count: number }[];
  today: string;
  onDay: (d: string) => void;
}) {
  const [year, setYear] = useState("recent");
  const current = Number(today.slice(0, 4));
  const years = Array.from(
    new Set([current, ...days.map((d) => Number(d.date.slice(0, 4)))]),
  ).sort((a, b) => b - a);
  const cells = useMemo(() => calendarCells(today, year), [year, today]);
  const counts = new Map(days.map((d) => [d.date, d.count]));
  const visible = new Set(cells.filter((c) => !c.disabled).map((c) => c.date));
  const total = days
    .filter((d) => visible.has(d.date))
    .reduce((n, d) => n + d.count, 0);
  return (
    <section className="heat-card">
      <div className="section-line">
        <div>
          <h2>知识积累</h2>
          <p>每一次理解，都留下一个坐标。</p>
        </div>
        <select
          aria-label="热力图年份"
          value={year}
          onChange={(e) => setYear(e.target.value)}
        >
          <option value="recent">最近一年</option>
          {years.map((y) => (
            <option key={y} value={y}>
              {y} 年
            </option>
          ))}
        </select>
      </div>
      <div className="heat-scroll">
        <div className="heat-layout">
          <div className="week-labels">
            <span>一</span>
            <span>三</span>
            <span>五</span>
          </div>
          <div className="heat-main">
            <div
              className="months"
              style={{
                gridTemplateColumns: `repeat(${cells.length / 7}, 1fr)`,
              }}
            >
              {Array.from({ length: cells.length / 7 }, (_, i) => (
                <span key={i}>
                  {cells[i * 7].first || i === 0
                    ? `${cells[i * 7].month + 1}月`
                    : ""}
                </span>
              ))}
            </div>
            <div
              className="heat-grid"
              style={{
                gridTemplateColumns: `repeat(${cells.length / 7}, 1fr)`,
              }}
            >
              {cells.map((c, i) => {
                const n = counts.get(c.date) || 0;
                const level = heatLevel(n);
                return (
                  <button
                    key={i}
                    disabled={c.disabled}
                    className={`heat-cell level-${level} ${c.disabled ? "invisible" : ""}`}
                    title={`${c.date} · 学习 ${n} 个知识点`}
                    aria-label={`${c.date} 学习 ${n} 个知识点`}
                    onClick={() => onDay(c.date)}
                  />
                );
              })}
            </div>
          </div>
        </div>
      </div>
      <div className="heat-footer">
        <span>
          累计 <b>{total}</b> 次知识点学习{" "}
          <span className="muted">· 按学习日期统计，同日同一知识点计一次</span>
        </span>
        <div className="legend">
          少
          {[0, 1, 2, 3, 4].map((i) => (
            <i key={i} className={`level-${i}`} />
          ))}
          多
        </div>
      </div>
    </section>
  );
}
