# A.N.N.A. — case console

Evidence workstation for the field-unit build. A case is a directory with a
manifest; everything that comes off the phone, camera or recorder goes into it,
gets SHA-256 hashed on ingest, and stays attributable until the case is sealed.

The phone side (native sensor service, sensor MCP) is **not wired up yet**. Until
it is, export CSVs / clips and drop them in — the store treats them exactly the
same.

## Run

```bash
# 1. build the UI once
cd web && npm install && npm run build && cd ..

# 2. start the console
python3 -m anna.server              # http://127.0.0.1:8787
python3 -m anna.server --host 0.0.0.0   # reachable from the phone / another machine
```

For UI work, run the API and Vite side by side — Vite proxies `/api` to 8787:

```bash
python3 -m anna.server &
cd web && npm run dev               # http://127.0.0.1:5173
```

Want something to click through immediately? `python3 -m anna.seed_demo` builds a
synthetic case (WAV with two knocks, EMF/IMU CSV, PNG, short video if ffmpeg is
present, one finding artifact).

## What the UI does

- **Cases** — New Case creates `cases/<uuid>/` with `video/ photos/ evp/
  sensor-logs/ findings/ notes/` and a `manifest.json`.
- **Ingest** — drag files anywhere (or *Ingest files*). Type is inferred from the
  extension unless passed explicitly, the file is copied (the original is never
  moved), renamed `YYYYMMDD_HHMMSS_<type>_<hash8>`, hashed, and appended to the
  manifest in one atomic write.
- **Verify integrity** — re-hashes every stored file and compares it against the
  manifest; per-row status appears in the ledger.
- **Review station** — opens video, EVP and sensor logs:
  - video: 0.25×/0.5×/1×, single-frame stepping, zoom + pan, I/O marks
  - EVP: waveform, in-browser spectrogram, loop between marks
  - sensor log: multi-series chart, per-series toggles, min/max/mean
- **Findings** — a marked window becomes `findings/<ts>_finding_<hash8>.finding.json`
  with the source artifact's hash, exact time range, region, note and analyst. It
  is ingested as evidence itself.
- **Second pass** — another analyst can attest a finding (*agrees / disagrees /
  uncertain*) from the finding inspector. That writes a **separate**
  `review_<finding>_<analyst>.finding.json` artifact with `attestation_of`,
  `verdict` and `analyst` on its manifest entry; the finding itself is never
  rewritten. The store refuses to attest a finding whose stored bytes no longer
  match its manifest hash.
- **Close case** — status flips to `closed`, further ingest is refused, and a zip
  archive is written next to the case; *Download archive* serves it.

The UI never labels evidence on its own: no transcription, no classification, no
confidence score it invented. Marks are `detection: human-marked`.

## Wallpaper

Darren's artwork lives at `web/public/background.jpg` and is drawn as a fixed,
vignetted layer behind the console. The **atmosphere** control in the top bar
sets dim and blur (saved per browser): the default is tuned so the ledger stays
readable, 0% dim is for looking at the picture.

## Layout

```
anna/               case store + HTTP API (stdlib only)
  case_store.py     the format: create, ingest, findings, verify, close
  server.py         /api/* + serves web/dist
  seed_demo.py      synthetic case for testing the viewers
web/                React + TypeScript + Vite UI
cases/              the evidence store (gitignored)
ingest.py           CLI wrapper for the same store (new / ingest / close)
```

`manifest.schema.json` is the contract the store writes against.

## API

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/cases` | case summaries |
| POST | `/api/cases` | `{name}` → new case |
| GET | `/api/cases/:id` | manifest |
| POST | `/api/cases/:id/artifacts?name=&kind=&source=` | raw body upload |
| POST | `/api/cases/:id/notes` | `{title,text,analyst}` |
| POST | `/api/cases/:id/findings` | `{source_artifact_id,t_start,t_end,region,note,analyst}` |
| POST | `/api/cases/:id/findings/:finding_id/reviews` | `{verdict,note,analyst}` — second-pass attestation |
| POST | `/api/cases/:id/close` | seal + zip |
| GET | `/api/cases/:id/verify` | re-hash every artifact |
| GET | `/api/cases/:id/raw/<stored_as>` | file with Range support |
| GET | `/api/cases/:id/archive` | zip download |

There is no authentication. Bind to `127.0.0.1` for a single machine; use
`--host 0.0.0.0` only on a network you trust (LAN/VPN), not the open internet.
