#!/usr/bin/env python3
"""Tara case ingest: sort evidence into cases/<uuid>/, hash it, log to manifest.json.

Usage:
  python ingest.py new "Case Name" [--base cases]
  python ingest.py ingest <case_dir> <file> [--kind evp] [--source tara-ui]
  python ingest.py close <case_dir>
"""
import argparse, hashlib, json, os, shutil, uuid
from datetime import datetime, timezone
from pathlib import Path

SCHEMA_VERSION = "1.0"
KIND_DIRS = {"video": "video", "photo": "photos", "evp": "evp",
             "sensor-log": "sensor-logs", "finding": "findings", "note": "notes"}

def utcnow(): return datetime.now(timezone.utc).isoformat(timespec="milliseconds")

def sha256_of(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()

def classify(path):
    ext = Path(path).suffix.lower()
    if ext in {".wav", ".mp3", ".m4a", ".flac"}: return "evp"
    if ext in {".mp4", ".mov", ".mkv", ".avi"}:   return "video"
    if ext in {".jpg", ".jpeg", ".png", ".heic", ".dng"}: return "photo"
    if ext in {".csv", ".json", ".log"}:          return "sensor-log"
    return "note"

def load_manifest(case_dir):
    with open(Path(case_dir) / "manifest.json") as f: return json.load(f)

def save_manifest(case_dir, manifest):
    tmp = Path(case_dir) / ".manifest.json.tmp"
    with open(tmp, "w") as f: json.dump(manifest, f, indent=2)
    os.replace(tmp, Path(case_dir) / "manifest.json")

def cmd_new(args):
    case_id = str(uuid.uuid4())
    d = Path(args.base) / case_id
    for sub in KIND_DIRS.values(): (d / sub).mkdir(parents=True, exist_ok=True)
    save_manifest(d, {"schema_version": SCHEMA_VERSION, "case_id": case_id,
                      "name": args.name, "created_utc": utcnow(), "closed_utc": None,
                      "status": "open", "artifacts": []})
    print(d)

def cmd_ingest(args):
    src = Path(args.file)
    case_dir = Path(args.case_dir)
    m = load_manifest(case_dir)
    if m["status"] != "open": raise SystemExit("case is closed")
    kind = args.kind or classify(src)
    digest = sha256_of(src)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    stored = f"{KIND_DIRS[kind]}/{stamp}_{kind}_{digest[:8]}{src.suffix.lower()}"
    shutil.copy2(src, case_dir / stored)
    m["artifacts"].append({"artifact_id": str(uuid.uuid4()), "type": kind,
        "original_name": src.name, "stored_as": stored, "sha256": digest,
        "size_bytes": (case_dir / stored).stat().st_size,
        "ingested_utc": utcnow(), "source": args.source})
    save_manifest(case_dir, m)
    print(json.dumps(m["artifacts"][-1]))

def cmd_close(args):
    case_dir = Path(args.case_dir)
    m = load_manifest(case_dir)
    m["status"] = "closed"; m["closed_utc"] = utcnow()
    save_manifest(case_dir, m)
    print(shutil.make_archive(str(case_dir), "zip", case_dir))

p = argparse.ArgumentParser()
sub = p.add_subparsers(required=True)
n = sub.add_parser("new"); n.add_argument("name"); n.add_argument("--base", default="cases"); n.set_defaults(fn=cmd_new)
i = sub.add_parser("ingest"); i.add_argument("case_dir"); i.add_argument("file")
i.add_argument("--kind"); i.add_argument("--source", default="unknown"); i.set_defaults(fn=cmd_ingest)
c = sub.add_parser("close"); c.add_argument("case_dir"); c.set_defaults(fn=cmd_close)
args = p.parse_args(); args.fn(args)
