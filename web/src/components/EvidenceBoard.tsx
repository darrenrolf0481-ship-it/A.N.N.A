import { useMemo } from "react";
import { Artifact, ArtifactType, ARTIFACT_TYPES, CaseManifest, VerifyReport } from "../api";
import { bytes, shortHash, utcDate } from "../format";
import { TypeIcon } from "./TypeIcon";

interface Props {
  manifest: CaseManifest;
  selectedId: string | null;
  filter: ArtifactType | "all";
  query: string;
  verify: VerifyReport | null;
  busy: boolean;
  onSelect: (id: string) => void;
  onFilter: (filter: ArtifactType | "all") => void;
  onQuery: (query: string) => void;
  onPickFiles: () => void;
  onAddNote: () => void;
}

export function EvidenceBoard({
  manifest,
  selectedId,
  filter,
  query,
  verify,
  busy,
  onSelect,
  onFilter,
  onQuery,
  onPickFiles,
  onAddNote,
}: Props) {
  const counts = useMemo(() => {
    const map: Record<string, number> = { all: manifest.artifacts.length };
    for (const a of manifest.artifacts) map[a.type] = (map[a.type] ?? 0) + 1;
    return map;
  }, [manifest.artifacts]);

  const integrity = useMemo(() => {
    const map: Record<string, string> = {};
    for (const entry of verify?.artifacts ?? []) map[entry.artifact_id] = entry.status;
    return map;
  }, [verify]);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return [...manifest.artifacts]
      .filter((a) => (filter === "all" ? true : a.type === filter))
      .filter((a) =>
        !q
          ? true
          : [a.original_name, a.stored_as, a.sha256, a.source, a.note ?? ""]
              .join(" ")
              .toLowerCase()
              .includes(q),
      )
      .sort((a, b) => (a.ingested_utc < b.ingested_utc ? 1 : -1));
  }, [manifest.artifacts, filter, query]);

  const closed = manifest.status === "closed";

  return (
    <section className="board">
      <div className="toolbar">
        <div className="filters">
          <button
            className={`filter${filter === "all" ? " active" : ""}`}
            type="button"
            onClick={() => onFilter("all")}
          >
            All <span className="filter-count mono">{counts.all ?? 0}</span>
          </button>
          {ARTIFACT_TYPES.map((t) => (
            <button
              key={t.key}
              className={`filter${filter === t.key ? " active" : ""}`}
              type="button"
              onClick={() => onFilter(t.key)}
            >
              <TypeIcon type={t.key} size={12} />
              {t.label}
              <span className="filter-count mono">{counts[t.key] ?? 0}</span>
            </button>
          ))}
        </div>
        <div className="toolbar-right">
          <input
            className="input search"
            placeholder="Search name or hash"
            value={query}
            onChange={(e) => onQuery(e.target.value)}
          />
          <button className="btn ghost sm" type="button" onClick={onAddNote} disabled={closed}>
            Add note
          </button>
          <button className="btn sm" type="button" onClick={onPickFiles} disabled={closed || busy}>
            Ingest files
          </button>
        </div>
      </div>

      <div className="rows">
        <div className="row row-head">
          <span className="cell type">Section</span>
          <span className="cell file">Artifact</span>
          <span className="cell when">Ingested (UTC)</span>
          <span className="cell size">Size</span>
          <span className="cell hash">SHA-256</span>
          <span className="cell integrity">Integrity</span>
        </div>

        {rows.map((a: Artifact) => {
          const status = integrity[a.artifact_id];
          return (
            <button
              key={a.artifact_id}
              type="button"
              className={`row${a.artifact_id === selectedId ? " selected" : ""}`}
              onClick={() => onSelect(a.artifact_id)}
            >
              <span className={`cell type type-badge t-${a.type}`}>
                <TypeIcon type={a.type} size={13} />
                {a.type === "sensor-log" ? "sensor" : a.type}
              </span>
              <span className="cell file">
                <span className="file-name">
                  {a.attestation_of && <span className={`row-tag ${a.verdict ?? ""}`}>2nd pass</span>}
                  {a.original_name}
                </span>
                <span className="file-sub mono">
                  {a.stored_as} · {a.source}
                </span>
              </span>
              <span className="cell when mono">{utcDate(a.ingested_utc)}</span>
              <span className="cell size mono">{bytes(a.size_bytes)}</span>
              <span className="cell hash mono">{shortHash(a.sha256, 10)}…</span>
              <span className={`cell integrity ${status ?? "unknown"}`}>
                {status === "ok" ? "✓ verified" : status ? `! ${status}` : "—"}
              </span>
            </button>
          );
        })}

        {rows.length === 0 && (
          <div className="rows-empty">
            <p>{counts.all ? "Nothing matches that filter." : "No evidence in this case yet."}</p>
            {!counts.all && !closed && (
              <p className="hint">
                Drop files anywhere on this window — they are sorted into sections by type, hashed, and written into the
                manifest.
              </p>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
