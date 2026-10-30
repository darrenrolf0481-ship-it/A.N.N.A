import { useCallback, useEffect, useRef, useState, type DragEvent } from "react";
import {
  api,
  archiveUrl,
  Artifact,
  ArtifactType,
  CaseManifest,
  CaseSummary,
  FindingInput,
  ReviewInput,
  VerifyReport,
} from "./api";
import { bytes, shortHash, utcDate } from "./format";
import { EvidenceBoard } from "./components/EvidenceBoard";
import { Inspector } from "./components/Inspector";
import { NewCaseDialog } from "./components/NewCaseDialog";
import { NoteComposer } from "./components/NoteComposer";
import { Sidebar } from "./components/Sidebar";
import { Station } from "./components/Station";
import { TopBar } from "./components/TopBar";

interface ToastItem {
  id: number;
  msg: string;
  tone: "ok" | "err";
}

export default function App() {
  const [cases, setCases] = useState<CaseSummary[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [manifest, setManifest] = useState<CaseManifest | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filter, setFilter] = useState<ArtifactType | "all">("all");
  const [query, setQuery] = useState("");
  const [verify, setVerify] = useState<VerifyReport | null>(null);
  const [stationId, setStationId] = useState<string | null>(null);
  const [dialog, setDialog] = useState(false);
  const [noteOpen, setNoteOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [dragging, setDragging] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [confirmClose, setConfirmClose] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const toast = useCallback((msg: string, tone: ToastItem["tone"] = "ok") => {
    const id = Date.now() + Math.random();
    setToasts((prev) => [...prev, { id, msg, tone }]);
    window.setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 5200);
  }, []);

  useEffect(() => {
    let alive = true;
    api
      .listCases()
      .then((list) => {
        if (!alive) return;
        setCases(list);
        if (list.length > 0) setActiveId(list[0].case_id);
      })
      .catch((e) => alive && setLoadError((e as Error).message));
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!activeId) {
      setManifest(null);
      return;
    }
    let alive = true;
    api
      .getCase(activeId)
      .then((m) => {
        if (!alive) return;
        setManifest(m);
        setSelectedId(null);
        setVerify(null);
      })
      .catch((e) => alive && toast((e as Error).message, "err"));
    return () => {
      alive = false;
    };
  }, [activeId, toast]);

  useEffect(() => {
    if (!confirmClose) return;
    const id = window.setTimeout(() => setConfirmClose(false), 4000);
    return () => window.clearTimeout(id);
  }, [confirmClose]);

  const refresh = useCallback(async () => {
    try {
      setCases(await api.listCases());
      if (activeId) setManifest(await api.getCase(activeId));
    } catch (e) {
      toast((e as Error).message, "err");
    }
  }, [activeId, toast]);

  const createCase = async (name: string) => {
    setBusy("create");
    try {
      const m = await api.createCase(name);
      setDialog(false);
      setCases(await api.listCases());
      setActiveId(m.case_id);
      setManifest(m);
      toast(`Case opened — ${m.name}`, "ok");
    } catch (e) {
      toast((e as Error).message, "err");
    } finally {
      setBusy(null);
    }
  };

  const ingest = async (files: FileList | File[]) => {
    if (!manifest) {
      setDialog(true);
      return;
    }
    if (manifest.status !== "open") {
      toast("Case is sealed — open a new case to ingest", "err");
      return;
    }
    setBusy("upload");
    let last: Artifact | null = null;
    for (const file of Array.from(files)) {
      try {
        const entry = await api.upload(manifest.case_id, file);
        last = entry;
        toast(`${file.name} → ${entry.stored_as.split("/")[0]}/ · ${shortHash(entry.sha256)}`, "ok");
      } catch (e) {
        toast(`${file.name}: ${(e as Error).message}`, "err");
      }
    }
    setBusy(null);
    await refresh();
    if (last) setSelectedId(last.artifact_id);
  };

  const closeCase = async () => {
    if (!manifest) return;
    if (!confirmClose) {
      setConfirmClose(true);
      return;
    }
    setConfirmClose(false);
    setBusy("close");
    try {
      await api.closeCase(manifest.case_id);
      await refresh();
      toast("Case sealed — manifest finalised, archive written", "ok");
    } catch (e) {
      toast((e as Error).message, "err");
    } finally {
      setBusy(null);
    }
  };

  const runVerify = async () => {
    if (!manifest) return;
    setBusy("verify");
    try {
      const report = await api.verify(manifest.case_id);
      setVerify(report);
      const bad = report.artifacts.filter((a) => a.status !== "ok").length;
      toast(
        report.ok
          ? `Chain intact — ${report.artifacts.length} artifact(s) match the manifest`
          : `${bad} artifact(s) failed re-hashing`,
        report.ok ? "ok" : "err",
      );
    } catch (e) {
      toast((e as Error).message, "err");
    } finally {
      setBusy(null);
    }
  };

  const addNote = async (title: string, text: string, analyst: string) => {
    if (!manifest) return;
    setBusy("note");
    try {
      const entry = await api.addNote(manifest.case_id, title, text, analyst);
      setNoteOpen(false);
      await refresh();
      setSelectedId(entry.artifact_id);
      toast(`Note saved · ${shortHash(entry.sha256)}`, "ok");
    } catch (e) {
      toast((e as Error).message, "err");
    } finally {
      setBusy(null);
    }
  };

  const saveFinding = async (input: FindingInput) => {
    if (!manifest) throw new Error("no open case");
    const entry = await api.addFinding(manifest.case_id, input);
    await refresh();
    setFilter("finding");
    toast(`Finding artifact written · ${shortHash(entry.sha256)}`, "ok");
  };

  const addReview = async (findingId: string, input: ReviewInput) => {
    if (!manifest) throw new Error("no open case");
    const entry = await api.addReview(manifest.case_id, findingId, input);
    await refresh();
    toast(`Second pass recorded — ${input.verdict} · ${shortHash(entry.sha256)}`, "ok");
  };

  const totalBytes = manifest?.artifacts.reduce((sum, a) => sum + (a.size_bytes || 0), 0) ?? 0;
  const selected = manifest?.artifacts.find((a) => a.artifact_id === selectedId) ?? null;
  const stationArtifact = manifest?.artifacts.find((a) => a.artifact_id === stationId) ?? null;
  const busyFlag = busy !== null;

  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragging(false);
    if (e.dataTransfer?.files?.length) void ingest(e.dataTransfer.files);
  };

  return (
    <div
      className={`app${dragging ? " is-dragging" : ""}`}
      onDragOver={(e) => {
        if (!manifest || manifest.status !== "open") return;
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false);
      }}
      onDrop={onDrop}
    >
      <TopBar manifest={manifest} />

      <div className="shell">
        <Sidebar cases={cases} activeId={activeId} onSelect={setActiveId} onNew={() => setDialog(true)} />

        <main className="main">
          {loadError && (
            <div className="banner">
              Could not reach the case API: {loadError}. Start it with <span className="mono">python3 -m anna.server</span>.
            </div>
          )}

          {manifest ? (
            <>
              <div className="case-head">
                <div className="case-head-top">
                  <span className={`pill ${manifest.status}`}>
                    <span className="pill-dot" />
                    {manifest.status === "open" ? "open — logging" : "sealed"}
                  </span>
                  <span className="case-id mono">{manifest.case_id}</span>
                </div>

                <div className="case-head-row">
                  <h1 className="case-title">{manifest.name}</h1>
                  <div className="case-actions">
                    <button className="btn" type="button" onClick={runVerify} disabled={busyFlag}>
                      {busy === "verify" ? "Hashing…" : "Verify integrity"}
                    </button>
                    {manifest.status === "open" ? (
                      <button
                        className={`btn${confirmClose ? " danger" : ""}`}
                        type="button"
                        onClick={closeCase}
                        disabled={busyFlag}
                      >
                        {confirmClose ? "Confirm — seal case" : "Close case"}
                      </button>
                    ) : (
                      <a className="btn" href={archiveUrl(manifest.case_id)} download>
                        Download archive
                      </a>
                    )}
                  </div>
                </div>

                <div className="case-meta">
                  <span>
                    opened <b className="mono">{utcDate(manifest.created_utc)}</b>
                  </span>
                  <span>
                    artifacts <b className="mono">{String(manifest.artifacts.length).padStart(2, "0")}</b>
                  </span>
                  <span>
                    volume <b className="mono">{bytes(totalBytes)}</b>
                  </span>
                  <span>
                    schema <b className="mono">{manifest.schema_version}</b>
                  </span>
                  {manifest.closed_utc && (
                    <span>
                      sealed <b className="mono">{utcDate(manifest.closed_utc)}</b>
                    </span>
                  )}
                  {verify && (
                    <span className={verify.ok ? "ok" : "bad"}>
                      integrity <b>{verify.ok ? "intact" : "problem"}</b>
                    </span>
                  )}
                </div>
              </div>

              <div className="board-layout">
                <EvidenceBoard
                  manifest={manifest}
                  selectedId={selectedId}
                  filter={filter}
                  query={query}
                  verify={verify}
                  busy={busyFlag}
                  onSelect={setSelectedId}
                  onFilter={setFilter}
                  onQuery={setQuery}
                  onPickFiles={() => fileRef.current?.click()}
                  onAddNote={() => setNoteOpen(true)}
                />
                <Inspector
                  artifact={selected}
                  manifest={manifest}
                  verify={verify}
                  onOpenStation={(a) => setStationId(a.artifact_id)}
                  onSelect={setSelectedId}
                  onAddReview={addReview}
                />
              </div>
            </>
          ) : (
            <EmptyState onNew={() => setDialog(true)} />
          )}
        </main>
      </div>

      <input
        ref={fileRef}
        type="file"
        multiple
        hidden
        onChange={(e) => {
          if (e.target.files?.length) void ingest(e.target.files);
          e.target.value = "";
        }}
      />

      {dragging && (
        <div className="drop-overlay">
          <div className="drop-card">
            <strong>Release to ingest</strong>
            <span>auto-sorted by type, SHA-256'd, appended to the manifest</span>
          </div>
        </div>
      )}

      {dialog && <NewCaseDialog busy={busy === "create"} onClose={() => setDialog(false)} onCreate={createCase} />}
      {noteOpen && manifest && (
        <NoteComposer busy={busy === "note"} onClose={() => setNoteOpen(false)} onSubmit={addNote} />
      )}
      {stationArtifact && manifest && (
        <Station
          artifact={stationArtifact}
          caseId={manifest.case_id}
          onClose={() => setStationId(null)}
          onSaveFinding={saveFinding}
        />
      )}

      <div className="toasts">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.tone}`}>
            {t.msg}
          </div>
        ))}
      </div>
    </div>
  );
}

function EmptyState({ onNew }: { onNew: () => void }) {
  return (
    <div className="empty">
      <span className="empty-kicker mono">evidence workstation · local store</span>
      <h1>
        Open a case.
        <br />
        Everything after that is chain of custody.
      </h1>
      <p className="empty-copy">
        A case is a folder with a manifest. Drop in whatever the field produced — clips, photos, EVP takes, sensor
        exports — and each file is sorted into its section, hashed, and indexed with where it came from. Nothing is
        judged automatically.
      </p>

      <div className="steps">
        <div className="step">
          <span className="step-n mono">01</span>
          <h3>Ingest</h3>
          <p>Drag files anywhere on this window. Originals are copied, never moved.</p>
        </div>
        <div className="step">
          <span className="step-n mono">02</span>
          <h3>Review</h3>
          <p>Slow the clip down, step frames, read the spectrogram, chart the sensor log.</p>
        </div>
        <div className="step">
          <span className="step-n mono">03</span>
          <h3>Mark</h3>
          <p>A marked window becomes a finding artifact with its own hash and your name on it.</p>
        </div>
      </div>

      <button className="btn primary lg" type="button" onClick={onNew}>
        New case
      </button>
      <p className="hint mono">cases/&lt;uuid&gt;/ · manifest.json · sha256 on ingest</p>
    </div>
  );
}
