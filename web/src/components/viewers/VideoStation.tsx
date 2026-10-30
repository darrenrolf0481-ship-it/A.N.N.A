import { useCallback, useEffect, useRef, useState } from "react";
import { Artifact, FindingInput, rawUrl } from "../../api";
import { clock } from "../../format";

const REGIONS = [
  "whole-frame",
  "upper-left",
  "upper-center",
  "upper-right",
  "center",
  "lower-left",
  "lower-center",
  "lower-right",
];

const RATES = [0.25, 0.5, 1];

interface Props {
  artifact: Artifact;
  caseId: string;
  onSaveFinding: (input: FindingInput) => Promise<void>;
}

export function VideoStation({ artifact, caseId, onSaveFinding }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const shellRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ x: number; y: number; px: number; py: number } | null>(null);

  const [t, setT] = useState(0);
  const [duration, setDuration] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [rate, setRate] = useState(1);
  const [fps, setFps] = useState(30);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [inT, setInT] = useState<number | null>(null);
  const [outT, setOutT] = useState<number | null>(null);
  const [region, setRegion] = useState(REGIONS[0]);
  const [note, setNote] = useState("");
  const [analyst, setAnalyst] = useState("tara-ui");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const seek = useCallback((value: number) => {
    const el = videoRef.current;
    if (!el) return;
    const next = Math.min(Math.max(0, value), el.duration || 0);
    el.currentTime = next;
    setT(next);
  }, []);

  const toggle = useCallback(() => {
    const el = videoRef.current;
    if (!el) return;
    if (el.paused) void el.play().catch(() => undefined);
    else el.pause();
  }, []);

  const step = useCallback(
    (direction: number) => {
      const el = videoRef.current;
      if (!el) return;
      el.pause();
      seek(el.currentTime + direction / fps);
    },
    [fps, seek],
  );

  useEffect(() => {
    const el = videoRef.current;
    if (el) el.playbackRate = rate;
  }, [rate]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (e.code === "Space") {
        e.preventDefault();
        toggle();
      } else if (e.code === "ArrowRight") {
        e.preventDefault();
        step(1);
      } else if (e.code === "ArrowLeft") {
        e.preventDefault();
        step(-1);
      } else if (e.key === "i") {
        setInT(videoRef.current?.currentTime ?? 0);
      } else if (e.key === "o") {
        setOutT(videoRef.current?.currentTime ?? 0);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [step, toggle]);

  const markIn = t;
  const markOut = t;
  useEffect(() => {
    if (!saved) return;
    const id = window.setTimeout(() => setSaved(false), 2600);
    return () => window.clearTimeout(id);
  }, [saved]);

  const save = async (atIn: number, atOut: number) => {
    const start = Math.min(atIn, atOut);
    const end = Math.max(atIn, atOut) || start + 0.1;
    setSaving(true);
    setError(null);
    try {
      await onSaveFinding({
        source_artifact_id: artifact.artifact_id,
        t_start: Number(start.toFixed(3)),
        t_end: Number((end === start ? start + 0.1 : end).toFixed(3)),
        region,
        note,
        analyst,
      });
      setSaved(true);
      setNote("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const selected =
    inT !== null && outT !== null ? [Math.min(inT, outT), Math.max(inT, outT)] : null;

  return (
    <div className="viewer-grid">
      <div className="stage">
        <div
          className={`video-shell${zoom > 1 ? " zoomed" : ""}`}
          ref={shellRef}
          onPointerDown={(e) => {
            if (zoom <= 1) return;
            dragRef.current = { x: e.clientX, y: e.clientY, px: pan.x, py: pan.y };
          }}
          onPointerMove={(e) => {
            const d = dragRef.current;
            if (!d) return;
            setPan({ x: d.px + (e.clientX - d.x), y: d.py + (e.clientY - d.y) });
          }}
          onPointerUp={() => {
            dragRef.current = null;
          }}
          onPointerLeave={() => {
            dragRef.current = null;
          }}
        >
          <video
            ref={videoRef}
            className="video"
            src={rawUrl(caseId, artifact.stored_as)}
            preload="metadata"
            playsInline
            style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }}
            onLoadedMetadata={(e) => setDuration(e.currentTarget.duration || 0)}
            onTimeUpdate={(e) => setT(e.currentTarget.currentTime)}
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
            onEnded={() => setPlaying(false)}
            onClick={(e) => e.currentTarget.paused || toggle()}
          />
        </div>

        <div className="transport">
          <button className="btn icon" type="button" onClick={toggle} aria-label={playing ? "Pause" : "Play"}>
            {playing ? "❚❚" : "▶"}
          </button>
          <div className="transport-group">
            <button className="btn ghost sm" type="button" onClick={() => step(-1)}>
              ◀ frame
            </button>
            <button className="btn ghost sm" type="button" onClick={() => step(1)}>
              frame ▶
            </button>
          </div>
          <span className="timecode mono">
            {clock(t)} <span className="dim">/ {clock(duration)}</span>
            <span className="dim"> · f{Math.round(t * fps)}</span>
          </span>
          <label className="control">
            speed
            <select className="select" value={rate} onChange={(e) => setRate(Number(e.target.value))}>
              {RATES.map((r) => (
                <option key={r} value={r}>
                  {r}×
                </option>
              ))}
            </select>
          </label>
          <label className="control">
            fps
            <select className="select" value={fps} onChange={(e) => setFps(Number(e.target.value))}>
              {[24, 30, 60].map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </select>
          </label>
          <label className="control grow">
            zoom {zoom.toFixed(1)}×
            <input
              className="range"
              type="range"
              min={1}
              max={4}
              step={0.1}
              value={zoom}
              onChange={(e) => {
                const z = Number(e.target.value);
                setZoom(z);
                if (z === 1) setPan({ x: 0, y: 0 });
              }}
            />
          </label>
        </div>

        <div className="scrub">
          <input
            className="range"
            type="range"
            min={0}
            max={duration || 0}
            step={0.001}
            value={Math.min(t, duration || 0)}
            onChange={(e) => seek(Number(e.target.value))}
          />
        </div>
        <p className="viewer-note">
          Space play/pause · ← → step one frame · I / O mark in / out · drag to pan when zoomed
        </p>
      </div>

      <aside className="mark-panel">
        <span className="section-label">Mark a window</span>
        <div className="mark-row">
          <button className="btn ghost sm" type="button" onClick={() => setInT(markIn)}>
            Mark in (I)
          </button>
          <button className="btn ghost sm" type="button" onClick={() => setOutT(markOut)}>
            Mark out (O)
          </button>
        </div>
        <div className="mark-values mono">
          <span>in {inT !== null ? clock(inT) : "—"}</span>
          <span>out {outT !== null ? clock(outT) : "—"}</span>
        </div>
        {selected && (
          <p className="mark-length mono">
            window {clock(selected[1] - selected[0])}
            <button className="link" type="button" onClick={() => { setInT(null); setOutT(null); }}>
              clear
            </button>
          </p>
        )}

        <label className="field">
          <span className="label">Region</span>
          <select className="select wide" value={region} onChange={(e) => setRegion(e.target.value)}>
            {REGIONS.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </label>

        <label className="field">
          <span className="label">What fired</span>
          <textarea
            className="textarea"
            rows={4}
            value={note}
            placeholder="Frame 34, upper left — dark shape only on two frames. No matching audio."
            onChange={(e) => setNote(e.target.value)}
          />
        </label>

        <label className="field">
          <span className="label">Analyst</span>
          <input className="input" value={analyst} onChange={(e) => setAnalyst(e.target.value)} maxLength={40} />
        </label>

        <button
          className="btn primary"
          type="button"
          disabled={saving}
          onClick={() => save(inT ?? t, outT ?? Math.min((duration || t) , t + 0.5))}
        >
          {saving ? "Writing finding…" : "Save finding artifact"}
        </button>
        {saved && <p className="ok-note">Finding written to findings/ and hashed.</p>}
        {error && <p className="error-note">{error}</p>}
        <p className="mark-foot">
          The station records the window and your note. It does not decide what the frame is — that stays with you.
        </p>
      </aside>
    </div>
  );
}
