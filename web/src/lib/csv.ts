/** Minimal CSV reader for sensor logs. Non-numeric cells become NaN. */

export interface Table {
  headers: string[];
  rows: number[][];
  delimiter: string;
}

export function parseCsv(text: string): Table {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) return { headers: [], rows: [], delimiter: "," };

  const first = lines[0];
  const delimiter = first.includes("\t") ? "\t" : first.includes(";") ? ";" : ",";
  const split = (line: string) =>
    line
      .split(delimiter)
      .map((cell) => cell.trim().replace(/^"(.*)"$/, "$1"));

  const headers = split(first);
  const rows: number[][] = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = split(lines[i]);
    if (cells.length === 0) continue;
    const nums = cells.map((cell) => {
      const cleaned = cell.replace(/(?!^)-/g, "");
      const n = cleaned === "" ? NaN : Number(cleaned);
      return Number.isFinite(n) ? n : NaN;
    });
    if (nums.some((n) => Number.isFinite(n))) rows.push(nums);
  }
  return { headers, rows, delimiter };
}

export function columnValues(table: Table, index: number): number[] {
  return table.rows.map((r) => r[index] ?? NaN).filter((n) => Number.isFinite(n));
}

export function isTimeColumn(header: string, values: number[]): boolean {
  const h = header.toLowerCase();
  const named = /(^|[^a-z])(t|time|sec|secs|seconds|ms|timestamp)([^a-z]|$)/.test(h);
  const ascending = values.length > 2 && values[0] <= values[1] && values[1] <= values[2];
  const small = values.length > 0 && Math.abs(values[values.length - 1]) < 1e6;
  return (named || ascending) && small;
}

export interface SeriesStats {
  min: number;
  max: number;
  mean: number;
  last: number;
}

export function stats(values: number[]): SeriesStats {
  if (values.length === 0) return { min: 0, max: 0, mean: 0, last: 0 };
  let min = Infinity;
  let max = -Infinity;
  let sum = 0;
  for (const v of values) {
    if (v < min) min = v;
    if (v > max) max = v;
    sum += v;
  }
  return { min, max, mean: sum / values.length, last: values[values.length - 1] };
}
