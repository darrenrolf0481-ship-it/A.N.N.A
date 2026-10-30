import { useEffect, useMemo, useRef, useState } from "react";
import { Artifact, rawUrl } from "../../api";
import { columnValues, isTimeColumn, parseCsv, stats, Table } from "../../lib/csv";

const COLORS = ["#ffb23e", "#6ea8ff", "#57d99a", "#c792ea", "#ff8a65", "#7ee7e7"];

interface Props {
  artifact: Artifact;
  caseId: string;
}

interface ColumnInfo {
  index: number;
  name: string;
  values: number[];
  isTime: boolean;
}

export function SensorStation({ artifact, caseId }: Props) {
  const [table, setTable] = useState<Table | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [active, setActive] = useState<number[]>([]);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    let alive = true;
    fetch(rawUrl(caseId, artifact.stored_as))
      .then((r) => (r.ok ? r.text() : Promise.reject(new Error(`could not read log (${r.status})`))))
      .then((text) => {
        if (!alive) return;
        const parsed = parseCsv(text);
        setTable(parsed);
        const numeric: ColumnInfo[] = parsed.headers.map((name, index) => {
          const values = columnValues(parsed, index);
          return { index, name, values, isTime: isTimeColumn(name, values) };
        });
        const timeCol = numeric.find((c) => c.isTime);
        const series = numeric.filter((c) => c.values.length > 0 && c.index !== timeCol?.index).slice(0, 5);
        setActive(series.map((s) => s.index));
      })
      .catch((e) => alive && setError((e as Error).message));
    return () => {
      alive = false;
    };
  }, [caseId, artifact.stored_as]);

  const columns = useMemo<ColumnInfo[]>(() => {
    if (!table) return [];
    return table.headers.map((name, index) => {
      const values = columnValues(table, index);
      return { index, name, values, isTime: isTimeColumn(name, values) };
    });
  }, [table]);

  const timeColumn = columns.find((c) => c.isTime);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !table) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const w = canvas.width;
    const h = canvas.height;
    const padLeft = 54;
    const padRight = 18;
    const padTop = 18;
    const padBottom = 34;

    ctx.fillStyle = "#07080b";
    ctx.fillRect(0, 0, w, h);

    const plotW = w - padLeft - padRight;
    const plotH = h - padTop - padBottom;

    ctx.strokeStyle = "rgba(255,255,255,0.07)";
    ctx.fillStyle = "rgba(139,147,163,0.9)";
    ctx.font = "11px ui-monospace, monospace";
    ctx.lineWidth = 1;
    for (let i = 0; i <= 4; i++) {
      const y = padTop + (plotH / 4) * i;
      ctx.beginPath();
      ctx.moveTo(padLeft, y);
      ctx.lineTo(w - padRight, y);
      ctx.stroke();
    }
    for (let i = 0; i <= 6; i++) {
      const x = padLeft + (plotW / 6) * i;
      ctx.beginPath();
      ctx.moveTo(x, padTop);
      ctx.lineTo(x, padTop + plotH);
      ctx.stroke();
    }

    const rows = table.rows.length;
    const xMax = timeColumn ? Math.max(1, timeColumn.values[timeColumn.values.length - 1] ?? rows) : rows;
    const xFor = (rowIndex: number) => {
      const xValue = timeColumn ? table.rows[rowIndex]?.[timeColumn.index] ?? rowIndex : rowIndex;
      return padLeft + (plotW * xValue) / xMax;
    };

    const drawSeries = (col: ColumnInfo, color: string) => {
      const values = col.values;
      if (values.length === 0) return;
      const s = stats(values);
      const span = s.max - s.min || 1;
      ctx.beginPath();
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.4;
      let started = false;
      for (let r = 0; r < rows; r++) {
        const v = table.rows[r]?.[col.index];
        if (v === undefined || !Number.isFinite(v)) {
          started = false;
          continue;
        }
        const x = xFor(r);
        const y = padTop + plotH - ((v - s.min) / span) * plotH;
        if (!started) {
          ctx.moveTo(x, y);
          started = true;
        } else {
          ctx.lineTo(x, y);
        }
      }
      ctx.stroke();
    };

    active.forEach((index, i) => {
      const col = columns.find((c) => c.index === index);
      if (col) drawSeries(col, COLORS[i % COLORS.length]);
    });

    ctx.fillStyle = "rgba(139,147,163,0.75)";
    ctx.fillText(`${xMax.toFixed(1)}${timeColumn ? " s" : " samples"}`, w - padRight - 70, h - 12);
    ctx.fillText("0", padLeft, h - 12);
  }, [table, columns, active, timeColumn]);

  const totals = table ? `${table.rows.length} rows · ${table.headers.length} columns` : "loading…";

  return (
    <div className="viewer-grid">
      <div className="stage">
        <div className="chart-head">
          <span className="section-label">Sensor trace</span>
          <span className="mono dim">{totals} · each series normalized to its own range</span>
        </div>
        {table ? (
          <canvas ref={canvasRef} width={1400} height={430} className="canvas chart-canvas" />
        ) : (
          <div className="preview-placeholder">{error ?? "Reading log…"}</div>
        )}
        {error && <p className="error-note">{error}</p>}
        <p className="viewer-note">
          Raw columns, nothing smoothed. Tick marks are per series; exact figures are in the table on the right.
        </p>
      </div>

      <aside className="mark-panel">
        <span className="section-label">Series</span>
        <div className="legend">
          {columns
            .filter((c) => !c.isTime && c.values.length > 0)
            .map((c, i) => {
              const on = active.includes(c.index);
              const color = COLORS[active.indexOf(c.index) % COLORS.length];
              return (
                <button
                  key={`${c.name}-${c.index}`}
                  type="button"
                  className={`legend-item${on ? " on" : ""}`}
                  onClick={() =>
                    setActive((prev) => (prev.includes(c.index) ? prev.filter((x) => x !== c.index) : [...prev, c.index]))
                  }
                >
                  <span className="swatch" style={{ background: on ? color : "transparent", borderColor: color }} />
                  <span className="legend-name">{c.name}</span>
                </button>
              );
            })}
        </div>

        <div className="stats">
          <table className="stats-table">
            <thead>
              <tr>
                <th>series</th>
                <th>min</th>
                <th>max</th>
                <th>mean</th>
              </tr>
            </thead>
            <tbody>
              {active.map((index, i) => {
                const col = columns.find((c) => c.index === index);
                if (!col) return null;
                const s = stats(col.values);
                return (
                  <tr key={index}>
                    <th scope="row">
                      <span className="dot" style={{ background: COLORS[i % COLORS.length] }} />
                      {col.name}
                    </th>
                    <td className="mono">{s.min.toFixed(2)}</td>
                    <td className="mono">{s.max.toFixed(2)}</td>
                    <td className="mono">{s.mean.toFixed(2)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <p className="mark-foot">
          If this log came off the sensor service, the timestamps are the phone's UTC clock — keep them as recorded.
        </p>
      </aside>
    </div>
  );
}
