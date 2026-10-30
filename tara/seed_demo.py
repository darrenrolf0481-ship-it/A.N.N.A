#!/usr/bin/env python3
"""Create a synthetic case so the console has something to review.

    python3 -m tara.seed_demo

Everything it writes is generated: a WAV with two knocks, an EMF/IMU CSV with
a spike, a noise PNG, a short video if ffmpeg is available, plus a note and a
finding artifact. Handy for checking the viewers without touching real
evidence.
"""
from __future__ import annotations

import math
import random
import shutil
import struct
import subprocess
import tempfile
import wave
import zlib
from pathlib import Path

from . import case_store as store

BASE = Path(__file__).resolve().parent.parent / "cases"


def _wav(path: Path, seconds: float = 6.0, rate: int = 44100) -> None:
    rng = random.Random(7)
    frames = bytearray()
    total = int(seconds * rate)
    for i in range(total):
        t = i / rate
        v = rng.uniform(-0.012, 0.012)  # noise floor
        for centre in (2.1, 4.4):  # knocks
            dt = t - centre
            if 0 <= dt < 0.25:
                v += 0.85 * math.exp(-dt * 26) * math.sin(2 * math.pi * 92 * dt)
        if 3.0 <= t <= 3.6:  # faint tone under the noise
            v += 0.03 * math.sin(2 * math.pi * 1180 * t)
        frames += struct.pack("<h", max(-32767, min(32767, int(v * 32767))))
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(bytes(frames))


def _csv(path: Path, rows: int = 600, hz: float = 100.0) -> None:
    rng = random.Random(11)
    lines = ["t_s,emf_ut,accel_x,accel_y,accel_z,baro_hpa"]
    for i in range(rows):
        t = i / hz
        spike = 42.0 * math.exp(-((t - 3.0) ** 2) / 0.004)
        emf = 47.0 + 1.6 * math.sin(t * 1.7) + rng.uniform(-1.2, 1.2) + spike
        ax = rng.uniform(-0.06, 0.06) + (0.4 if 2.05 < t < 2.2 else 0)
        ay = rng.uniform(-0.06, 0.06)
        az = 9.81 + rng.uniform(-0.05, 0.05)
        baro = 1013.2 + 0.15 * math.sin(t / 3) + rng.uniform(-0.02, 0.02)
        lines.append(f"{t:.2f},{emf:.3f},{ax:.4f},{ay:.4f},{az:.4f},{baro:.3f}")
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def _png(path: Path, w: int = 800, h: int = 520) -> None:
    rng = random.Random(3)
    rows = []
    for y in range(h):
        row = bytearray()
        for x in range(w):
            vignette = max(0.0, 1.0 - (((x - w / 2) ** 2 + (y - h / 2) ** 2) ** 0.5) / (w * 0.62))
            blob = 120 * math.exp(-(((x - 560) ** 2 + (y - 190) ** 2) / 9000))
            n = rng.uniform(-14, 14)
            v = int(max(0, min(255, 18 + 70 * vignette + blob + n)))
            row += bytes((min(255, int(v * 1.08)), v, min(255, int(v * 0.85))))
        rows.append(b"\x00" + bytes(row))

    def chunk(tag: bytes, data: bytes) -> bytes:
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

    png = b"\x89PNG\r\n\x1a\n"
    png += chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0))
    png += chunk(b"IDAT", zlib.compress(b"".join(rows), 9))
    png += chunk(b"IEND", b"")
    path.write_bytes(png)


def _video(path: Path) -> bool:
    if not shutil.which("ffmpeg"):
        return False
    cmd = [
        "ffmpeg", "-y", "-loglevel", "error",
        "-f", "lavfi", "-i", "testsrc2=size=960x540:rate=30:duration=6",
        "-vf", "eq=brightness=-0.28:saturation=0.35,noise=alls=12:allf=t",
        "-c:v", "libx264", "-preset", "veryfast", "-pix_fmt", "yuv420p", str(path),
    ]
    return subprocess.run(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode == 0


def main() -> None:
    manifest = store.create_case(BASE, "Ridge Road — Demo (synthetic)")
    case_id = manifest["case_id"]
    print(f"case {case_id}")

    with tempfile.TemporaryDirectory() as td:
        tmp = Path(td)
        _wav(tmp / "evp_knock_response.wav")
        _csv(tmp / "emf_session1.csv")
        _png(tmp / "IMG_ghost_door.png")
        for name, kind in (
            ("evp_knock_response.wav", "evp"),
            ("emf_session1.csv", "sensor-log"),
            ("IMG_ghost_door.png", "photo"),
        ):
            entry = store.add_artifact(BASE, case_id, tmp / name, kind=kind, source="seed-demo")
            print(f"  {entry['type']:<11} {entry['stored_as']}")

        if _video(tmp / "clip_basement.mp4"):
            entry = store.add_artifact(BASE, case_id, tmp / "clip_basement.mp4", kind="video", source="seed-demo")
            print(f"  {entry['type']:<11} {entry['stored_as']}")
        else:
            print("  video       skipped (ffmpeg not available)")

    note = store.add_note(
        BASE,
        case_id,
        "Baseline walkthrough",
        "Airplane mode on, phone on the tripod at the stair landing. Baseline EMF sat at 46-49 uT.\n"
        "Two knocks on the recorder at roughly 2.1s and 4.4s, no visible source. Field spike logged at 3.0s.\n"
        "Marks in this case are synthetic demo data.",
    )
    print(f"  note        {note['stored_as']}")

    manifest = store.load_manifest(store.case_dir(BASE, case_id))
    evp = next(a for a in manifest["artifacts"] if a["type"] == "evp")
    finding = store.add_finding(
        BASE,
        case_id,
        {
            "source_artifact_id": evp["artifact_id"],
            "t_start": 2.05,
            "t_end": 2.45,
            "region": "audio",
            "note": "Sharp transient, no matching visual. Marked for a second pass.",
            "analyst": "tara-ui",
        },
    )
    print(f"  finding     {finding['stored_as']}")
    print(f"\nopen it:  python3 -m tara.server   ->  http://127.0.0.1:8787")


if __name__ == "__main__":
    main()
