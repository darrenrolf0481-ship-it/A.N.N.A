import { useState } from "react";

interface Props {
  onClose: () => void;
  onSubmit: (title: string, text: string, analyst: string) => void;
  busy: boolean;
}

export function NoteComposer({ onClose, onSubmit, busy }: Props) {
  const [title, setTitle] = useState("Field note");
  const [text, setText] = useState("");
  const [analyst, setAnalyst] = useState("anna-ui");

  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <div className="modal-head">
          <h2>Add a note</h2>
          <button className="btn ghost icon" type="button" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <div className="modal-body">
          <div className="field-row">
            <label className="field">
              <span className="label">Title</span>
              <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={80} />
            </label>
            <label className="field narrow">
              <span className="label">Analyst</span>
              <input className="input" value={analyst} onChange={(e) => setAnalyst(e.target.value)} maxLength={40} />
            </label>
          </div>
          <label className="field">
            <span className="label">Note</span>
            <textarea
              className="textarea"
              rows={7}
              value={text}
              autoFocus
              placeholder="Conditions, baseline readings, who was present, what you actually saw…"
              onChange={(e) => setText(e.target.value)}
            />
          </label>
          <p className="hint">
            Saved as <span className="mono">notes/</span> with a timestamp and analyst line, then hashed into the
            manifest like any other artifact.
          </p>
        </div>
        <div className="modal-foot">
          <button className="btn ghost" type="button" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn primary"
            type="button"
            disabled={busy || !text.trim()}
            onClick={() => onSubmit(title.trim(), text.trim(), analyst.trim())}
          >
            {busy ? "Saving…" : "Save note"}
          </button>
        </div>
      </div>
    </div>
  );
}
