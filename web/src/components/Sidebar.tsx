import { CaseSummary } from "../api";
import { utcDate } from "../format";

interface Props {
  cases: CaseSummary[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
}

export function Sidebar({ cases, activeId, onSelect, onNew }: Props) {
  const open = cases.filter((c) => c.status === "open").length;

  return (
    <aside className="sidebar">
      <div className="side-head">
        <span className="side-label">Case files</span>
        <span className="side-count mono">{String(cases.length).padStart(2, "0")}</span>
      </div>

      <div className="case-list">
        {cases.length === 0 && <p className="side-empty">No cases on this machine yet.</p>}
        {cases.map((c) => (
          <button
            key={c.case_id}
            className={`case-item${c.case_id === activeId ? " active" : ""}`}
            onClick={() => onSelect(c.case_id)}
            type="button"
          >
            <span className={`case-dot ${c.status}`} aria-hidden />
            <span className="case-text">
              <span className="case-name">{c.name}</span>
              <span className="case-sub mono">
                {utcDate(c.created_utc)} · {c.artifact_count} item{c.artifact_count === 1 ? "" : "s"}
              </span>
            </span>
          </button>
        ))}
      </div>

      <button className="btn primary side-new" type="button" onClick={onNew}>
        <span className="plus" aria-hidden>
          +
        </span>
        New case
      </button>

      <div className="side-foot">
        <div className="side-foot-row">
          <span>open</span>
          <span className="mono">{open}</span>
        </div>
        <div className="side-foot-row">
          <span>store</span>
          <span className="mono">cases/</span>
        </div>
        <div className="side-foot-row">
          <span>schema</span>
          <span className="mono">1.0</span>
        </div>
        <p className="side-foot-note">SHA-256 on ingest · manifest appended atomically</p>
      </div>
    </aside>
  );
}
