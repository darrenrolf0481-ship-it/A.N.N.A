"""A.N.N.A. case store — the on-disk evidence format, single implementation.

One directory per case, a manifest.json index, SHA-256 on ingest, deterministic
names (`YYYYMMDD_HHMMSS_<type>_<hash8>`), atomic manifest writes. The HTTP API,
the CLI and the seeding script all go through these functions so the chain of
custody only has one definition.

Layout (per case):

    cases/<case-uuid>/
      manifest.json      index; every artifact gets an entry here
      video/
      photos/
      evp/
      sensor-logs/
      findings/          *.finding.json artifacts from the review station
      notes/
"""
from __future__ import annotations

import hashlib
import json
import os
import shutil
import tempfile
import uuid
import zipfile
from datetime import datetime, timezone
from pathlib import Path

SCHEMA_VERSION = "1.0"

KIND_DIRS = {
    "video": "video",
    "photo": "photos",
    "evp": "evp",
    "sensor-log": "sensor-logs",
    "finding": "findings",
    "note": "notes",
}
KINDS = tuple(KIND_DIRS)

_AUDIO = {".wav", ".mp3", ".m4a", ".flac", ".ogg"}
_VIDEO = {".mp4", ".mov", ".mkv", ".avi", ".webm"}
_PHOTO = {".jpg", ".jpeg", ".png", ".heic", ".dng", ".webp", ".gif"}
_LOG = {".csv", ".tsv", ".json", ".log"}
_TEXT = {".txt", ".md"}


class CaseError(Exception):
    status = 400


class CaseNotFound(CaseError):
    status = 404


class CaseClosed(CaseError):
    status = 409


def utcnow() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds")


def _stamp() -> str:
    return datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def classify(name: str) -> str:
    """Pick the evidence section for an incoming file."""
    lower = name.lower()
    if lower.endswith(".finding.json"):
        return "finding"
    ext = Path(lower).suffix
    if ext in _AUDIO:
        return "evp"
    if ext in _VIDEO:
        return "video"
    if ext in _PHOTO:
        return "photo"
    if ext in _LOG:
        return "sensor-log"
    if ext in _TEXT:
        return "note"
    return "note"


def case_dir(base: Path, case_id: str) -> Path:
    """Resolve a case directory, refusing anything that is not a known case id."""
    try:
        if str(uuid.UUID(case_id)) != case_id and uuid.UUID(case_id).hex != case_id.replace("-", ""):
            raise ValueError
    except ValueError:
        raise CaseNotFound(f"not a case id: {case_id}")
    d = Path(base) / case_id
    if not (d / "manifest.json").is_file():
        raise CaseNotFound(f"no such case: {case_id}")
    return d


def load_manifest(case_dir_path: Path) -> dict:
    with open(Path(case_dir_path) / "manifest.json", encoding="utf-8") as f:
        return json.load(f)


def save_manifest(case_dir_path: Path, manifest: dict) -> None:
    target = Path(case_dir_path) / "manifest.json"
    tmp = Path(case_dir_path) / ".manifest.json.tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(manifest, f, indent=2, ensure_ascii=False)
        f.write("\n")
    os.replace(tmp, target)


def list_cases(base: Path) -> list[dict]:
    base = Path(base)
    out: list[dict] = []
    if not base.is_dir():
        return out
    for d in base.iterdir():
        if not (d / "manifest.json").is_file():
            continue
        try:
            m = load_manifest(d)
        except (OSError, ValueError):
            continue
        out.append(
            {
                "case_id": m["case_id"],
                "name": m["name"],
                "status": m["status"],
                "created_utc": m["created_utc"],
                "closed_utc": m.get("closed_utc"),
                "artifact_count": len(m.get("artifacts", [])),
                "size_bytes": sum(int(a.get("size_bytes") or 0) for a in m.get("artifacts", [])),
            }
        )
    out.sort(key=lambda c: c["created_utc"], reverse=True)
    return out


def create_case(base: Path, name: str) -> dict:
    name = (name or "").strip()
    if not name:
        raise CaseError("case name is required")
    case_id = str(uuid.uuid4())
    d = Path(base) / case_id
    d.mkdir(parents=True, exist_ok=True)
    for sub in KIND_DIRS.values():
        (d / sub).mkdir(exist_ok=True)
    manifest = {
        "schema_version": SCHEMA_VERSION,
        "case_id": case_id,
        "name": name,
        "created_utc": utcnow(),
        "closed_utc": None,
        "status": "open",
        "artifacts": [],
    }
    save_manifest(d, manifest)
    return manifest


def _require_open(manifest: dict) -> None:
    if manifest.get("status") != "open":
        raise CaseClosed("case is closed; evidence can no longer be added")


def _stored_name(kind: str, digest: str, suffix: str, stamp: str) -> str:
    suffix = suffix.lower()
    if kind == "finding":
        return f"findings/{stamp}_finding_{digest[:8]}.finding.json"
    return f"{KIND_DIRS[kind]}/{stamp}_{kind}_{digest[:8]}{suffix}"


def add_artifact(
    base: Path,
    case_id: str,
    src: Path,
    original_name: str | None = None,
    kind: str | None = None,
    source: str = "anna-ui",
    note: str | None = None,
    extra: dict | None = None,
) -> dict:
    """Copy a file into the case, hash it, append it to the manifest.

    Copy, never move: the original stays wherever it landed, so nobody can
    argue the only surviving copy is the one we control.
    """
    d = case_dir(base, case_id)
    manifest = load_manifest(d)
    _require_open(manifest)

    src = Path(src)
    name = original_name or src.name
    kind = (kind or classify(name)).strip().lower()
    if kind not in KIND_DIRS:
        raise CaseError(f"unknown artifact type: {kind}")

    digest = sha256_file(src)
    # Bytes we generated land in a suffix-less temp file; keep the meaningful
    # extension from the name we are filing it under.
    stored = _stored_name(kind, digest, src.suffix or Path(name).suffix, _stamp())
    dest = d / stored
    dest.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(src, dest)

    entry = {
        "artifact_id": str(uuid.uuid4()),
        "type": kind,
        "original_name": name,
        "stored_as": stored,
        "sha256": digest,
        "size_bytes": dest.stat().st_size,
        "ingested_utc": utcnow(),
        "source": source,
    }
    if note:
        entry["note"] = note
    for key, value in (extra or {}).items():
        entry.setdefault(key, value)
    manifest["artifacts"].append(entry)
    save_manifest(d, manifest)
    return entry


def add_blob(
    base: Path,
    case_id: str,
    data: bytes,
    original_name: str,
    kind: str | None = None,
    source: str = "anna-ui",
    note: str | None = None,
    extra: dict | None = None,
) -> dict:
    """Ingest bytes we generated ourselves (notes, findings, attestations)."""
    d = case_dir(base, case_id)
    fd, tmp = tempfile.mkstemp(dir=d, prefix=".incoming-")
    try:
        with os.fdopen(fd, "wb") as f:
            f.write(data)
        return add_artifact(base, case_id, Path(tmp), original_name, kind, source, note, extra)
    finally:
        try:
            os.unlink(tmp)
        except OSError:
            pass


def add_finding(base: Path, case_id: str, payload: dict) -> dict:
    d = case_dir(base, case_id)
    manifest = load_manifest(d)
    _require_open(manifest)
    artifacts = {a["artifact_id"]: a for a in manifest["artifacts"]}
    source_id = payload.get("source_artifact_id") or ""
    source = artifacts.get(source_id)
    if source is None:
        raise CaseError("source artifact is not part of this case")

    try:
        t_start = float(payload.get("t_start"))
        t_end = float(payload.get("t_end"))
    except (TypeError, ValueError):
        raise CaseError("t_start and t_end are required numbers")
    if t_end < t_start:
        t_start, t_end = t_end, t_start

    finding = {
        "schema_version": SCHEMA_VERSION,
        "finding_id": str(uuid.uuid4()),
        "case_id": case_id,
        "created_utc": utcnow(),
        "analyst": (payload.get("analyst") or "anna-ui").strip() or "anna-ui",
        "detection": "human-marked",
        "source": {
            "artifact_id": source["artifact_id"],
            "stored_as": source["stored_as"],
            "original_name": source["original_name"],
            "sha256": source["sha256"],
            "type": source["type"],
        },
        "time_range_s": [round(t_start, 3), round(t_end, 3)],
        "region": (payload.get("region") or "whole-frame").strip(),
        "note": (payload.get("note") or "").strip(),
    }
    data = json.dumps(finding, indent=2, ensure_ascii=False).encode("utf-8") + b"\n"
    return add_blob(
        base,
        case_id,
        data,
        original_name=f"finding_{finding['finding_id'][:8]}.finding.json",
        kind="finding",
        source="review-station",
        note=finding["note"] or None,
    )


VERDICTS = ("agrees", "disagrees", "uncertain")


def add_review(base: Path, case_id: str, finding_artifact_id: str, payload: dict) -> dict:
    """Second-pass attestation of an existing finding.

    Append-only: the reviewer's verdict lands in its own *.finding.json artifact
    with its own hash, so a second pair of eyes is as attributable as the first.
    The finding being reviewed is never rewritten.
    """
    d = case_dir(base, case_id)
    manifest = load_manifest(d)
    _require_open(manifest)
    artifacts = {a["artifact_id"]: a for a in manifest["artifacts"]}

    target = artifacts.get(finding_artifact_id or "")
    if target is None:
        raise CaseNotFound("finding is not part of this case")
    if target["type"] != "finding":
        raise CaseError("only findings can be given a second pass")
    if target.get("attestation_of"):
        raise CaseError("a second pass attaches to a finding, not to another attestation")

    verdict = (payload.get("verdict") or "").strip().lower()
    if verdict not in VERDICTS:
        raise CaseError("verdict must be one of: " + ", ".join(VERDICTS))
    analyst = (payload.get("analyst") or "").strip()
    if not analyst:
        raise CaseError("a second pass needs a named analyst")
    note = (payload.get("note") or "").strip()

    # Attesting a finding whose stored bytes drifted would launder a broken link.
    path = artifact_path(base, case_id, target["stored_as"])
    if not path.is_file():
        raise CaseError("the finding file is missing from the case")
    if sha256_file(path) != target["sha256"]:
        raise CaseError("the finding file no longer matches its manifest hash; re-verify the case before attesting")
    try:
        original = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        raise CaseError("could not read the finding artifact")

    review = {
        "schema_version": SCHEMA_VERSION,
        "kind": "second-pass-review",
        "review_id": str(uuid.uuid4()),
        "case_id": case_id,
        "created_utc": utcnow(),
        "analyst": analyst,
        "verdict": verdict,
        "note": note,
        "target": {
            "artifact_id": target["artifact_id"],
            "finding_id": original.get("finding_id"),
            "sha256": target["sha256"],
            "stored_as": target["stored_as"],
            "analyst": original.get("analyst"),
            "created_utc": original.get("created_utc"),
        },
        "source": original.get("source"),
        "time_range_s": original.get("time_range_s"),
        "region": original.get("region"),
    }
    data = json.dumps(review, indent=2, ensure_ascii=False).encode("utf-8") + b"\n"
    slug = "".join(c if c.isalnum() or c in "-_" else "-" for c in analyst.lower())[:24].strip("-")
    return add_blob(
        base,
        case_id,
        data,
        original_name=f"review_{finding_artifact_id[:8]}_{slug or 'analyst'}.finding.json",
        kind="finding",
        source="second-pass",
        note=f"second pass: {verdict}",
        extra={"attestation_of": finding_artifact_id, "verdict": verdict, "analyst": analyst},
    )


def add_note(base: Path, case_id: str, title: str, text: str, analyst: str = "anna-ui") -> dict:
    d = case_dir(base, case_id)
    manifest = load_manifest(d)
    _require_open(manifest)
    title = (title or "").strip() or "Investigator note"
    text = (text or "").strip()
    if not text:
        raise CaseError("note text is required")
    body = (
        f"# {title}\n\n"
        f"{text}\n\n"
        f"-- {analyst.strip() or 'anna-ui'} @ {utcnow()}\n"
    )
    safe = "".join(c if c.isalnum() or c in "-_ " else "_" for c in title)[:40].strip().replace(" ", "-")
    return add_blob(
        base,
        case_id,
        body.encode("utf-8"),
        original_name=f"note_{safe or 'note'}.txt",
        kind="note",
        source="anna-ui",
        note=title,
    )


def artifact_path(base: Path, case_id: str, stored_as: str) -> Path:
    d = case_dir(base, case_id).resolve()
    target = (d / stored_as).resolve()
    if not str(target).startswith(str(d) + os.sep):
        raise CaseError("artifact path escapes the case directory")
    return target


def verify_case(base: Path, case_id: str) -> dict:
    d = case_dir(base, case_id)
    manifest = load_manifest(d)
    results = []
    for a in manifest["artifacts"]:
        try:
            p = artifact_path(base, case_id, a["stored_as"])
        except CaseError:
            results.append({"artifact_id": a["artifact_id"], "stored_as": a["stored_as"], "status": "escaped"})
            continue
        if not p.is_file():
            status = "missing"
        elif sha256_file(p) != a["sha256"]:
            status = "mismatch"
        else:
            status = "ok"
        results.append({"artifact_id": a["artifact_id"], "stored_as": a["stored_as"], "status": status})
    return {
        "case_id": case_id,
        "checked_utc": utcnow(),
        "ok": all(r["status"] == "ok" for r in results),
        "artifacts": results,
    }


def close_case(base: Path, case_id: str) -> dict:
    d = case_dir(base, case_id)
    manifest = load_manifest(d)
    archive = Path(base) / f"{case_id}.zip"

    if manifest.get("status") != "closed":
        manifest["status"] = "closed"
        manifest["closed_utc"] = utcnow()
        save_manifest(d, manifest)

    tmp = archive.with_suffix(".zip.tmp")
    with zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED) as zf:
        for path in sorted(d.rglob("*")):
            if path.is_file() and path.name != ".manifest.json.tmp":
                zf.write(path, arcname=str(path.relative_to(d)))
    os.replace(tmp, archive)
    return {"case_id": case_id, "status": "closed", "archive": str(archive), "closed_utc": manifest["closed_utc"]}
