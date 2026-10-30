#!/usr/bin/env python3
"""CLI for the A.N.N.A. case store — the same code path the UI server uses.

  python3 ingest.py new "Case Name" [--base cases]
  python3 ingest.py ingest <case_dir> <file> [--kind evp] [--source anna-ui]
  python3 ingest.py verify <case_dir>
  python3 ingest.py close <case_dir>
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from anna import case_store

SCHEMA_VERSION = case_store.SCHEMA_VERSION


def cmd_new(args: argparse.Namespace) -> None:
    manifest = case_store.create_case(Path(args.base), args.name)
    print(Path(args.base) / manifest["case_id"])


def cmd_ingest(args: argparse.Namespace) -> None:
    case_dir = Path(args.case_dir)
    entry = case_store.add_artifact(
        case_dir.parent,
        case_dir.name,
        Path(args.file),
        kind=args.kind,
        source=args.source,
    )
    print(json.dumps(entry))


def cmd_verify(args: argparse.Namespace) -> None:
    case_dir = Path(args.case_dir)
    report = case_store.verify_case(case_dir.parent, case_dir.name)
    print(json.dumps(report, indent=2))
    if not report["ok"]:
        raise SystemExit(1)


def cmd_close(args: argparse.Namespace) -> None:
    case_dir = Path(args.case_dir)
    print(case_store.close_case(case_dir.parent, case_dir.name)["archive"])


def main() -> None:
    parser = argparse.ArgumentParser(description="A.N.N.A. case store CLI")
    sub = parser.add_subparsers(required=True)

    new = sub.add_parser("new", help="create a case")
    new.add_argument("name")
    new.add_argument("--base", default="cases")
    new.set_defaults(fn=cmd_new)

    ingest = sub.add_parser("ingest", help="copy a file into a case, hash it, index it")
    ingest.add_argument("case_dir")
    ingest.add_argument("file")
    ingest.add_argument("--kind", choices=sorted(case_store.KIND_DIRS))
    ingest.add_argument("--source", default="anna-ui")
    ingest.set_defaults(fn=cmd_ingest)

    verify = sub.add_parser("verify", help="re-hash a case against its manifest")
    verify.add_argument("case_dir")
    verify.set_defaults(fn=cmd_verify)

    close = sub.add_parser("close", help="seal a case and write the archive")
    close.add_argument("case_dir")
    close.set_defaults(fn=cmd_close)

    args = parser.parse_args()
    args.fn(args)


if __name__ == "__main__":
    sys.exit(main())
