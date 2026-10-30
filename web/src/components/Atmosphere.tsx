import { useEffect, useRef, useState } from "react";

const DEFAULTS = { dim: 35, blur: 2 };
const STORAGE_KEY = "anna.atmosphere";

interface Settings {
  dim: number;
  blur: number;
}

function clamp(value: unknown, min: number, max: number, fallback: number): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

function load(): Settings {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULTS;
    const parsed = JSON.parse(raw) as Partial<Settings>;
    return {
      dim: clamp(parsed.dim, 0, 85, DEFAULTS.dim),
      blur: clamp(parsed.blur, 0, 16, DEFAULTS.blur),
    };
  } catch {
    return DEFAULTS;
  }
}

/** Dim / blur for the artwork behind the console, saved per browser. */
export function Atmosphere() {
  const [open, setOpen] = useState(false);
  const [settings, setSettings] = useState<Settings>(load);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty("--bg-dim", (settings.dim / 100).toFixed(2));
    root.style.setProperty("--bg-blur", `${settings.blur}px`);
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    } catch {
      /* storage unavailable; the sliders still work for this session */
    }
  }, [settings]);

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="atmo" ref={boxRef}>
      <button
        type="button"
        className={`chip chip-button${open ? " active" : ""}`}
        aria-expanded={open}
        aria-haspopup="dialog"
        title="Dim and blur the artwork behind the console"
        onClick={() => setOpen((v) => !v)}
      >
        <span className="atmo-dot" aria-hidden />
        atmosphere
      </button>

      {open && (
        <div className="atmo-panel" role="dialog" aria-label="Background atmosphere">
          <div className="atmo-head">
            <span className="section-label">Atmosphere</span>
            <button className="link" type="button" onClick={() => setSettings(DEFAULTS)}>
              reset
            </button>
          </div>

          <label className="atmo-row">
            <span>
              dim <b className="mono">{settings.dim}%</b>
            </span>
            <input
              type="range"
              min={0}
              max={85}
              value={settings.dim}
              onChange={(e) => setSettings((s) => ({ ...s, dim: Number(e.target.value) }))}
            />
          </label>

          <label className="atmo-row">
            <span>
              blur <b className="mono">{settings.blur}px</b>
            </span>
            <input
              type="range"
              min={0}
              max={16}
              value={settings.blur}
              onChange={(e) => setSettings((s) => ({ ...s, blur: Number(e.target.value) }))}
            />
          </label>

          <p className="atmo-note">
            The artwork sits behind the ledger, so the default is dimmed for reading. Pull dim to 0% when you want to
            look at it.
          </p>
        </div>
      )}
    </div>
  );
}
