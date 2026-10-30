import { useEffect, useRef, useState } from "react";

interface Props {
  busy: boolean;
  onClose: () => void;
  onCreate: (name: string) => void;
}

export function NewCaseDialog({ busy, onClose, onCreate }: Props) {
  const [name, setName] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const submit = () => {
    if (!name.trim() || busy) return;
    onCreate(name.trim());
  };

  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <div className="modal-head">
          <h2>Open a case file</h2>
          <button className="btn ghost icon" type="button" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <div className="modal-body">
          <label className="field">
            <span className="label">Case name</span>
            <input
              ref={inputRef}
              className="input"
              value={name}
              placeholder="Ridge Road — basement"
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && submit()}
              maxLength={120}
            />
          </label>
          <p className="hint">
            A directory is created at <span className="mono">cases/&lt;uuid&gt;/</span> with sections for video,
            photos, EVP, sensor logs, findings and notes. Everything dropped in is hashed and indexed until the case
            is closed.
          </p>
        </div>
        <div className="modal-foot">
          <button className="btn ghost" type="button" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" type="button" onClick={submit} disabled={!name.trim() || busy}>
            {busy ? "Creating…" : "Create case"}
          </button>
        </div>
      </div>
    </div>
  );
}
