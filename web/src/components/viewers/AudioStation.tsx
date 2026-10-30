import { useCallback, useEffect, useRef, useState } from "react";
import { Artifact, FindingInput, rawUrl } from "../../api";
import { clock } from "../../format";
import { computePeaks, loadAudioBuffer, spectrogramImage } from "../../lib/audio";

const RATES = [0.5, 1];

interface Props {
  artifact: Artifact;
  caseId: string;
  onSaveFinding: (input: FindingInput) => Promise<void>;
}

export function AudioStation({ artifact, caseId, onSaveFinding }: Props) {
  const url = rawUrl(caseId, artifact.stored_as);
  const audioRef = useRef<HTMLAudioElement>(null);
  const waveRef = useRef<HTMLCanvasElement>(null);
  const specRef = useRef<HTMLCanvasElement>(null);
  const specImage = useRef<HTMLCanvasElement | null>(null);

  const [buffer, setBuffer] = useState<AudioBuffer | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [t, setT] = useState(0);
  const [duration, setDuration] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [rate, setRate] = useState(1);
  const [loop, setLoop] = useState(false);
  const [inT, setInT] = useState<number | null>(null);
  const [outT, setOutT] = useState<number | null>(null);
  const [note, setNote] = useState("");
  const [analyst, setAnalyst] = useState("tara-ui");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setBuffer(null);
    setLoadError(null);
    loadAudioBuffer(url)
      .then((b) => {
        if (!alive) return;
        setBuffer(b);
        setDuration(b.duration);
      })
      .catch((e) => alive && setLoadError((e as Error).message));
    return () => {
      alive = false;
    };
  }, [url]);

  // Waveform (peaks + marks); the playhead is an overlay so this is not redrawn per frame.
  useEffect(() => {
    const canvas = waveRef.current;
    if (!canvas || !buffer) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const w = canvas.width;
    const h = canvas.height;

    ctx.fillStyle = "#07080b";
    ctx.fillRect(0, 0, w, h);

    ctx.strokeStyle = "rgba(255,255,255,0.05)";
    ctx.lineWidth = 1;
    for (let x = 0; x < w; x += 100) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();
    }

    const { min, max } = computePeaks(buffer.getChannelData(0), w);
    const mid = h / 2;
    ctx.fillStyle = "#ffb23e";
    for (let x = 0; x < w; x++) {
      const top = mid - max[x] * mid * 0.92;
      const bottom = mid - min[x] * mid * 0.92;
      ctx.fillRect(x, top, 1, Math.max(1, bottom - top));
    }

    ctx.fillStyle = "rgba(255,178,62,0.10)";
    if (inT !== null && outT !== null && duration > 0) {
      const a = (Math.min(inT, outT) / duration) * w;
      const b = (Math.max(inT, outT) / duration) * w;
      ctx.fillRect(a, 0, Math.max(1, b - a), h);
    }

    ctx.strokeStyle = "rgba(255,255,255,0.12)";
    ctx.beginPath();
    ctx.moveTo(0, mid);
    ctx.lineTo(w, mid);
    ctx.stroke();
  }, [buffer, inT, outT, duration]);

  // Spectrogram is computed once per clip.
  useEffect(() => {
    const canvas = specRef.current;
    if (!canvas || !buffer) return;
    const image = spectrogramImage(buffer);
    if (!image) return;
    specImage.current = image;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.fillStyle = "#07080b";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
  }, [buffer]);

  useEffect(() => {
    const el = audioRef.current;
    if (el) el.playbackRate = rate;
  }, [rate]);

  const seek = useCallback((value: number) => {
    const el = audioRef.current;
    if (!el) return;
    el.currentTime = Math.min(Math.max(0, value), el.duration || 0);
    setT(el.currentTime);
  }, []);

  const seekFromEvent = (e: React.PointerEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = (e.clientX - rect.left) / rect.width;
    seek(ratio * (duration || 0));
  };

  const onTime = () => {
    const el = audioRef.current;
    if (!el) return;
    if (loop && inT !== null && outT !== null) {
      const [a, b] = [Math.min(inT, outT), Math.max(inT, outT)];
      if (el.currentTime > b || el.currentTime < a) {
        el.currentTime = a;
      }
    }
    setT(el.currentTime);
  };

  const toggle = () => {
    const el = audioRef.current;
    if (!el) return;
    if (el.paused) void el.play().catch(() => undefined);
    else el.pause();
  };

  const save = async () => {
    const start = inT ?? t;
    const end = outT ?? Math.min(duration || t + 0.5, t + 0.5);
    setSaving(true);
    setError(null);
    try {
      await onSaveFinding({
        source_artifact_id: artifact.artifact_id,
        t_start: Number(Math.min(start, end).toFixed(3)),
        t_end: Number(Math.max(start, end).toFixed(3)),
        region: "audio",
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

  useEffect(() => {
    if (!saved) return;
    const id = window.setTimeout(() => setSaved(false), 2600);
    return () => window.clearTimeout(id);
  }, [saved]);

  const pct = (value: number) => `${duration > 0 ? Math.min(100, Math.max(0, (value / duration) * 100)) : 0}%`;

  return (
    <div className="viewer-grid">
      <div className="stage audio-stage">
        <audio ref={audioRef} src={url} preload="auto" className="sr-only" onTimeUpdate={onTime} onEnded={() => setPlaying(false)} onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} />

        <div className="chart-block">
          <div className="chart-head">
            <span className="section-label">Waveform</span>
            <span className="mono dim">{buffer ? `${buffer.sampleRate / 1000} kHz · ${buffer.numberOfChannels} ch` : "decoding…"}</span>
          </div>
          <div className="canvas-wrap" onPointerDown={seekFromEvent}>
            <canvas ref={waveRef} width={1400} height={150} className="canvas" />
            {inT !== null && outT !== null && duration > 0 && (
              <span
                className="mark-band"
                style={{ left: pct(Math.min(inT, outT)), width: `calc(${pct(Math.max(inT, outT))} - ${pct(Math.min(inT, outT))})` }}
              />
            )}
            <span className="playhead" style={{ left: pct(t) }} />
          </div>
        </div>

        <div className="chart-block">
          <div className="chart-head">
            <span className="section-label">Spectrogram</span>
            <span className="mono dim">0 – {(buffer ? buffer.sampleRate / 2000 : 22).toFixed(1)} kHz · −92 dB floor</span>
          </div>
          <div className="canvas-wrap" onPointerDown={seekFromEvent}>
            {buffer && <canvas ref={specRef} width={1400} height={240} className="canvas" />}
            {!buffer && <div className="preview-placeholder">{loadError ?? "Rendering…"}</div>}
            <span className="playhead" style={{ left: pct(t) }} />
          </div>
        </div>

        <div className="transport">
          <button className="btn icon" type="button" onClick={toggle} aria-label={playing ? "Pause" : "Play"}>
            {playing ? "❚❚" : "▶"}
          </button>
          <span className="timecode mono">
            {clock(t, 3)} <span className="dim">/ {clock(duration, 3)}</span>
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
          <label className="control check">
            <input type="checkbox" checked={loop} onChange={(e) => setLoop(e.target.checked)} />
            loop window
          </label>
        </div>
        <p className="viewer-note">
          Playback rate keeps pitch. Click the waveform or spectrogram to seek. The spectrogram is computed in the
          browser from the stored file — no processing is written back.
        </p>
      </div>

      <aside className="mark-panel">
        <span className="section-label">Mark a window</span>
        <div className="mark-row">
          <button className="btn ghost sm" type="button" onClick={() => setInT(t)}>
            Mark in
          </button>
          <button className="btn ghost sm" type="button" onClick={() => setOutT(t)}>
            Mark out
          </button>
        </div>
        <div className="mark-values mono">
          <span>in {inT !== null ? clock(inT, 3) : "—"}</span>
          <span>out {outT !== null ? clock(outT, 3) : "—"}</span>
        </div>
        {inT !== null && outT !== null && (
          <p className="mark-length mono">
            window {clock(Math.abs(outT - inT), 3)}
            <button className="link" type="button" onClick={() => { setInT(null); setOutT(null); }}>
              clear
            </button>
          </p>
        )}

        <label className="field">
          <span className="label">What you heard</span>
          <textarea
            className="textarea"
            rows={4}
            value={note}
            placeholder="Two low thumps at 2.1s, no visible source. Not transcribing as speech."
            onChange={(e) => setNote(e.target.value)}
          />
        </label>

        <label className="field">
          <span className="label">Analyst</span>
          <input className="input" value={analyst} onChange={(e) => setAnalyst(e.target.value)} maxLength={40} />
        </label>

        <button className="btn primary" type="button" disabled={saving} onClick={save}>
          {saving ? "Writing finding…" : "Save finding artifact"}
        </button>
        {saved && <p className="ok-note">Finding written to findings/ and hashed.</p>}
        {error && <p className="error-note">{error}</p>}
        <p className="mark-foot">
          No transcription, no classification. A human marks the window; the manifest keeps the rest.
        </p>
      </aside>
    </div>
  );
}
