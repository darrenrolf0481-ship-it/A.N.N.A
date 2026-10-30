import { useEffect } from "react";
import { Artifact, FindingInput } from "../api";
import { bytes, shortHash } from "../format";
import { TypeIcon } from "./TypeIcon";
import { AudioStation } from "./viewers/AudioStation";
import { SensorStation } from "./viewers/SensorStation";
import { VideoStation } from "./viewers/VideoStation";

interface Props {
  artifact: Artifact;
  caseId: string;
  onClose: () => void;
  onSaveFinding: (input: FindingInput) => Promise<void>;
}

export function Station({ artifact, caseId, onClose, onSaveFinding }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="overlay station-overlay">
      <div className="station">
        <div className="station-head">
          <div className="station-title">
            <span className={`type-badge t-${artifact.type}`}>
              <TypeIcon type={artifact.type} size={13} />
              review station
            </span>
            <span className="station-name">{artifact.original_name}</span>
            <span className="station-sub mono">
              {bytes(artifact.size_bytes)} · {shortHash(artifact.sha256)} · {artifact.stored_as}
            </span>
          </div>
          <button className="btn ghost icon" type="button" onClick={onClose} aria-label="Close review station">
            ✕
          </button>
        </div>

        <div className="station-body">
          {artifact.type === "video" && (
            <VideoStation artifact={artifact} caseId={caseId} onSaveFinding={onSaveFinding} />
          )}
          {artifact.type === "evp" && (
            <AudioStation artifact={artifact} caseId={caseId} onSaveFinding={onSaveFinding} />
          )}
          {artifact.type === "sensor-log" && <SensorStation artifact={artifact} caseId={caseId} />}
        </div>
      </div>
    </div>
  );
}
