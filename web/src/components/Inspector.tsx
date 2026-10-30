import { useEffect, useState } from "react";
import {
  Artifact,
  ArtifactType,
  ARTIFACT_TYPES,
  CaseManifest,
  rawUrl,
  ReviewInput,
  VERDICTS,
  Verdict,
  VerifyReport,
} from "../api";
import { bytes, shortHash, utcDate } from "../format";
import { TypeIcon } from "./TypeIcon";

interface Props {
  artifact: Artifact | null;
  manifest: CaseManifest;
  verify: VerifyReport | null;
  onOpenStation: (artifact: Artifact) => void;
  onSelect: (id: string) => void;
  onAddReview: (findingId: string, input: ReviewInput) => Promise<void>;
}

const STATION_TYPES: ArtifactType[] = ["video", "evp", "sensor-log"];

export function Inspector({ artifact, manifest, verify, onOpenStation, onSelect, onAddReview }: Props) {
  if (!artifact) return <CaseIndex manifest={manifest} verify={verify} />;

  const status = verify?.artifacts.find((v) => v.artifact_id === artifact.artifact_id)?.status;
  const source =
    artifact.type === "finding"
      ? manifest.artifacts.find((a) => a.type !== "finding" && a.original_name === artifact.original_name)
      : undefined;
  const reviews = manifest.artifacts.filter((a) => a.attestation_of === artifact.artifact_id);

  return (
    <aside className="inspector">
      <div className="inspector-head">
        <span className={`type-badge t-${artifact.type}`}>
          <TypeIcon type={artifact.type} size={13} />
          {artifact.type}
        </span>
        <span className="inspector-id mono">{shortHash(artifact.artifact_id, 8)}</span>
      </div>

      <div className="preview">
        <Preview
          artifact={artifact}
          caseId={manifest.case_id}
          reviews={reviews}
          closed={manifest.status === "closed"}
          onSelect={onSelect}
          onAddReview={onAddReview}
        />
      </div>

      <dl className="kv">
        <div>
          <dt>Original</dt>
          <dd>{artifact.original_name}</dd>
        </div>
        <div>
          <dt>Stored as</dt>
          <dd className="mono">{artifact.stored_as}</dd>
        </div>
        <div>
          <dt>Source</dt>
          <dd>{artifact.source}</dd>
        </div>
        <div>
          <dt>Size</dt>
          <dd className="mono">{bytes(artifact.size_bytes)}</dd>
        </div>
        <div>
          <dt>Ingested</dt>
          <dd className="mono">{utcDate(artifact.ingested_utc)}</dd>
        </div>
        <div>
          <dt>SHA-256</dt>
          <dd className="mono hash-full">{artifact.sha256}</dd>
        </div>
        {artifact.note && (
          <div>
            <dt>Note</dt>
            <dd>{artifact.note}</dd>
          </div>
        )}
        <div>
          <dt>Integrity</dt>
          <dd className={status === "ok" ? "ok" : status ? "bad" : "muted"}>
            {status === "ok" ? "re-hashed, matches manifest" : status ? `problem: ${status}` : "not checked this session"}
          </dd>
        </div>
      </dl>

      <div className="inspector-actions">
        {STATION_TYPES.includes(artifact.type) && (
          <button className="btn primary" type="button" onClick={() => onOpenStation(artifact)}>
            Open review station
          </button>
        )}
        <a className="btn ghost" href={rawUrl(manifest.case_id, artifact.stored_as)} download={artifact.original_name}>
          Download original
        </a>
        {source && (
          <button className="btn ghost" type="button" onClick={() => onSelect(source.artifact_id)}>
            Jump to source
          </button>
        )}
      </div>

      <p className="inspector-foot">
        Copies are never modified in place. Anything that looks like a conclusion belongs in a finding artifact, marked by
        a human.
      </p>
    </aside>
  );
}

function CaseIndex({ manifest, verify }: { manifest: CaseManifest; verify: VerifyReport | null }) {
  const totals = ARTIFACT_TYPES.map((t) => {
    const items = manifest.artifacts.filter((a) => a.type === t.key);
    return {
      ...t,
      count: items.length,
      size: items.reduce((sum, a) => sum + (a.size_bytes || 0), 0),
    };
  });
  const max = Math.max(1, ...totals.map((t) => t.size));
  const total = manifest.artifacts.reduce((sum, a) => sum + (a.size_bytes || 0), 0);

  return (
    <aside className="inspector">
      <div className="inspector-head">
        <span className="inspector-title">Case index</span>
        <span className="inspector-id mono">{manifest.artifacts.length} items</span>
      </div>

      <div className="section-bars">
        {totals.map((t) => (
          <div className="bar-row" key={t.key}>
            <span className={`type-badge t-${t.key}`}>
              <TypeIcon type={t.key} size={12} />
            </span>
            <span className="bar-label">{t.section}</span>
            <span className="bar-track">
              <span className="bar-fill" style={{ width: `${Math.max(t.size ? 4 : 0, (t.size / max) * 100)}%` }} />
            </span>
            <span className="bar-count mono">{t.count}</span>
          </div>
        ))}
      </div>

      <dl className="kv">
        <div>
          <dt>Case id</dt>
          <dd className="mono">{manifest.case_id}</dd>
        </div>
        <div>
          <dt>Opened</dt>
          <dd className="mono">{utcDate(manifest.created_utc)}</dd>
        </div>
        <div>
          <dt>Status</dt>
          <dd>{manifest.status === "open" ? "open — logging" : `sealed ${utcDate(manifest.closed_utc)}`}</dd>
        </div>
        <div>
          <dt>Volume</dt>
          <dd className="mono">{bytes(total)}</dd>
        </div>
        <div>
          <dt>Verification</dt>
          <dd className={verify ? (verify.ok ? "ok" : "bad") : "muted"}>
            {verify
              ? verify.ok
                ? `all ${verify.artifacts.length} artifacts match`
                : `${verify.artifacts.filter((v) => v.status !== "ok").length} artifact(s) failed`
              : "not run — press Verify integrity"}
          </dd>
        </div>
      </dl>

      <p className="inspector-foot">
        Select an artifact to inspect it. Video, EVP and sensor logs open in the review station, where a marked window
        becomes a finding artifact with its own hash.
      </p>
    </aside>
  );
}

function Preview({
  artifact,
  caseId,
  reviews,
  closed,
  onSelect,
  onAddReview,
}: {
  artifact: Artifact;
  caseId: string;
  reviews: Artifact[];
  closed: boolean;
  onSelect: (id: string) => void;
  onAddReview: (findingId: string, input: ReviewInput) => Promise<void>;
}) {
  const url = rawUrl(caseId, artifact.stored_as);

  if (artifact.type === "finding" && artifact.attestation_of) {
    return <ReviewPreview artifact={artifact} caseId={caseId} onSelect={onSelect} />;
  }

  switch (artifact.type) {
    case "photo":
      return <img className="preview-media" src={url} alt={artifact.original_name} />;
    case "video":
      return <video className="preview-media" src={url} controls preload="metadata" />;
    case "evp":
      return (
        <div className="preview-audio">
          <div className="waveform-strip" aria-hidden />
          <audio src={url} controls preload="metadata" />
        </div>
      );
    case "finding":
      return (
        <FindingPreview
          artifact={artifact}
          caseId={caseId}
          reviews={reviews}
          closed={closed}
          onSelect={onSelect}
          onAddReview={onAddReview}
        />
      );
    case "note":
      return <TextPreview caseId={caseId} storedAs={artifact.stored_as} />;
    default:
      return (
        <div className="preview-placeholder">
          <TypeIcon type={artifact.type} size={22} />
          <span>Open the review station to chart this log.</span>
        </div>
      );
  }
}

function TextPreview({ caseId, storedAs }: { caseId: string; storedAs: string }) {
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setText(null);
    setError(null);
    fetch(rawUrl(caseId, storedAs))
      .then((r) => (r.ok ? r.text() : Promise.reject(new Error(`${r.status}`))))
      .then((t) => alive && setText(t))
      .catch((e) => alive && setError(String(e.message ?? e)));
    return () => {
      alive = false;
    };
  }, [caseId, storedAs]);

  if (error) return <div className="preview-placeholder">Could not load: {error}</div>;
  if (text === null) return <div className="preview-placeholder">Loading…</div>;
  return <pre className="preview-text">{text}</pre>;
}

interface FindingShape {
  finding_id?: string;
  analyst?: string;
  created_utc?: string;
  detection?: string;
  region?: string;
  note?: string;
  time_range_s?: [number, number];
  source?: { original_name?: string; artifact_id?: string; sha256?: string };
}

function FindingPreview({
  artifact,
  caseId,
  reviews,
  closed,
  onSelect,
  onAddReview,
}: {
  artifact: Artifact;
  caseId: string;
  reviews: Artifact[];
  closed: boolean;
  onSelect: (id: string) => void;
  onAddReview: (findingId: string, input: ReviewInput) => Promise<void>;
}) {
  const [finding, setFinding] = useState<FindingShape | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [verdict, setVerdict] = useState<Verdict>("agrees");
  const [analyst, setAnalyst] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    fetch(rawUrl(caseId, artifact.stored_as))
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`${r.status}`))))
      .then((j) => alive && setFinding(j))
      .catch((e) => alive && setError(String(e.message ?? e)));
    return () => {
      alive = false;
    };
  }, [caseId, artifact.stored_as]);

  const submit = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      await onAddReview(artifact.artifact_id, { verdict, note: note.trim(), analyst: analyst.trim() });
      setNote("");
    } catch (e) {
      setSaveError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  if (error) return <div className="preview-placeholder">Could not load finding: {error}</div>;
  if (!finding) return <div className="preview-placeholder">Loading…</div>;

  const [start, end] = finding.time_range_s ?? [0, 0];
  return (
    <div className="finding-card">
      <div className="finding-window mono">
        {start.toFixed(2)}s → {end.toFixed(2)}s
      </div>
      <div className="finding-region">{finding.region ?? "whole-frame"}</div>
      <p className="finding-note">{finding.note || "No note attached."}</p>
      <div className="finding-meta">
        <span>{finding.analyst ?? "unknown"}</span>
        <span className="mono">{finding.detection ?? "human-marked"}</span>
      </div>
      {finding.source?.artifact_id && (
        <button className="btn ghost sm" type="button" onClick={() => onSelect(finding.source!.artifact_id!)}>
          Open source artifact
        </button>
      )}

      <div className="review-block">
        <div className="review-head">
          <span className="section-label">Second pass</span>
          <span className="mono dim">
            {reviews.length} attestation{reviews.length === 1 ? "" : "s"}
          </span>
        </div>

        {reviews.length > 0 && (
          <div className="review-list">
            {reviews.map((r) => (
              <div className="review-row" key={r.artifact_id}>
                <span className={`verdict ${r.verdict ?? "uncertain"}`}>{r.verdict ?? "?"}</span>
                <span className="review-by">{r.analyst ?? "analyst"}</span>
                <span className="mono dim">{utcDate(r.ingested_utc)}</span>
                <button className="link" type="button" onClick={() => onSelect(r.artifact_id)}>
                  open
                </button>
              </div>
            ))}
          </div>
        )}

        {closed ? (
          <p className="hint">Case sealed — no further attestations.</p>
        ) : (
          <div className="review-form">
            <div className="verdict-picker">
              {VERDICTS.map((v) => (
                <button
                  key={v.key}
                  type="button"
                  className={`verdict-btn ${verdict === v.key ? `active ${v.key}` : ""}`}
                  onClick={() => setVerdict(v.key)}
                >
                  {v.label}
                </button>
              ))}
            </div>
            <input
              className="input"
              placeholder="Reviewer"
              value={analyst}
              maxLength={40}
              onChange={(e) => setAnalyst(e.target.value)}
            />
            <textarea
              className="textarea"
              rows={2}
              placeholder="What you saw on the same window, independently."
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
            <button className="btn sm" type="button" disabled={saving || !analyst.trim()} onClick={submit}>
              {saving ? "Writing…" : "Record second pass"}
            </button>
            {saveError && <p className="error-note">{saveError}</p>}
          </div>
        )}
      </div>
    </div>
  );
}

interface ReviewShape {
  verdict?: string;
  note?: string;
  analyst?: string;
  created_utc?: string;
  target?: { finding_id?: string; stored_as?: string; analyst?: string; created_utc?: string };
}

function ReviewPreview({
  artifact,
  caseId,
  onSelect,
}: {
  artifact: Artifact;
  caseId: string;
  onSelect: (id: string) => void;
}) {
  const [review, setReview] = useState<ReviewShape | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    fetch(rawUrl(caseId, artifact.stored_as))
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`${r.status}`))))
      .then((j) => alive && setReview(j))
      .catch((e) => alive && setError(String(e.message ?? e)));
    return () => {
      alive = false;
    };
  }, [caseId, artifact.stored_as]);

  if (error) return <div className="preview-placeholder">Could not load attestation: {error}</div>;
  if (!review) return <div className="preview-placeholder">Loading…</div>;

  return (
    <div className="finding-card">
      <div className="review-verdict mono">second pass — {review.verdict ?? "?"}</div>
      <p className="finding-note">{review.note || "No note attached."}</p>
      <div className="finding-meta">
        <span>{review.analyst ?? "unknown"}</span>
        <span className="mono">{utcDate(review.created_utc ?? artifact.ingested_utc)}</span>
      </div>
      {review.target?.stored_as && <p className="review-target mono">on {review.target.stored_as}</p>}
      {artifact.attestation_of && (
        <button className="btn ghost sm" type="button" onClick={() => onSelect(artifact.attestation_of!)}>
          Open the finding under review
        </button>
      )}
    </div>
  );
}
