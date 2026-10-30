import { useEffect, useState } from "react";
import { CaseManifest } from "../api";
import { utcClockNow } from "../format";
import { Atmosphere } from "./Atmosphere";

interface Props {
  manifest: CaseManifest | null;
}

export function TopBar({ manifest }: Props) {
  const [now, setNow] = useState(utcClockNow());

  useEffect(() => {
    const id = window.setInterval(() => setNow(utcClockNow()), 1000);
    return () => window.clearInterval(id);
  }, []);

  return (
    <header className="topbar">
      <div className="brand">
        <span className="brand-mark" aria-hidden>
          A
        </span>
        <span className="brand-name">A.N.N.A.</span>
        <span className="brand-sub">case console</span>
      </div>
      <div className="topbar-sep" />
      <div className="crumb">
        <span className="crumb-muted">cases</span>
        <span className="crumb-slash">/</span>
        <span className="crumb-current">{manifest ? manifest.name : "no case open"}</span>
      </div>
      <div className="topbar-right">
        <Atmosphere />
        <span className="chip chip-idle" title="Sensor bridge is not wired up yet. Export CSV from the field app into sensor-logs for now.">
          <span className="chip-dot" />
          bridge offline
        </span>
        <span className="utc-clock mono">{now}</span>
      </div>
    </header>
  );
}
