#!/usr/bin/env python3
"""
Summarise a BLE sniffer capture: what a tag actually broadcast, and how often.

Written because "the rod says calibrating and no data arrives" has several very
different causes that look identical on screen — the tag is silent, the tag is
broadcasting but only identity frames, or the tag is streaming fine and the
detector's arming budget is what cannot be met. Only the raw advertisements tell
them apart, and eyeballing NDJSON does not.

USAGE
    python3 scripts/analyse-capture.py <capture.ndjson> [--tag C00C]

    Captures come from Admin -> BLE sniffer -> Raw capture, and land in the
    app's private storage. On a debug build:

        adb shell run-as co.castmate ls files/castmate-captures/
        adb shell run-as co.castmate cat files/castmate-captures/<name>.ndjson > cap.ndjson

    RETRIEVING IT. `run-as` works only on a DEBUG build — a release build reports
    "package not debuggable" and the sandbox is unreachable over adb. From a
    release build, which is what a session on the water is recorded on, use
    Admin -> the recording -> Export: that writes through the Storage Access
    Framework into a real folder (Downloads, Drive) you can copy off normally.

WHAT IT REPORTS
    Frame mix (motion vs identity), the motion-frame RATE, and the decoded
    accelerations. The rate is the number that matters: arming needs
    ARMING_MIN_SAMPLES within ARMING_DURATION_MS, and SIGNAL_LOST_MS decides how
    long a gap is allowed, so a capture either clears those bars or it does not.
"""

import argparse
import json
import struct
import sys
from collections import Counter
from pathlib import Path

# Mirrors src/features/ble/castmateGFrame.ts. Kept as literals rather than
# parsed out of the TS: this script has to run against OLD captures too, and
# pinning the layout here is what makes a past capture re-readable.
SERVICE_UUID_SHORT = "feab"
OFFSET_X, OFFSET_Y, OFFSET_Z = 0, 4, 8
OFFSET_MAC, MAC_TAIL_BYTES = 12, 5
MIN_FRAME_BYTES = OFFSET_MAC
MAX_PLAUSIBLE_G = 16

# Mirrors src/features/detection/detectionParams.ts, so the report can say
# whether a capture would actually have armed rather than leaving you to divide.
# Derived the same way the TS derives them, from one measured interval, so that
# re-tuning the app for a faster tag needs the same single edit here.
EXPECTED_SAMPLE_INTERVAL_MS = 3_600
ARMING_DURATION_MS = 60_000
ARMING_YIELD = 0.65
ARMING_MIN_SAMPLES = max(8, int((ARMING_DURATION_MS / EXPECTED_SAMPLE_INTERVAL_MS) * ARMING_YIELD))
SIGNAL_LOST_MS = EXPECTED_SAMPLE_INTERVAL_MS * 5
MAX_DT_FOR_RATE_MS = 150


def service_data(row):
    """The 0xFEAB payload as bytes, or b'' when the row carries none."""
    sources = row.get("sources") or {}
    key = next((k for k in sources if SERVICE_UUID_SHORT in k.lower()), None)
    if key is None:
        return b""
    try:
        return bytes.fromhex(sources[key])
    except ValueError:
        return b""


def decode_motion(payload):
    """(x, y, z, mac_tail) in g, or None when this is not an accel frame."""
    if len(payload) < MIN_FRAME_BYTES:
        return None
    x, y, z = struct.unpack(">fff", payload[OFFSET_X : OFFSET_Z + 4])
    if any(v != v or abs(v) > MAX_PLAUSIBLE_G for v in (x, y, z)):
        return None  # same sanity bound the app applies
    tail = payload[OFFSET_MAC : OFFSET_MAC + MAC_TAIL_BYTES]
    return x, y, z, ":".join(f"{b:02X}" for b in tail)


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("capture", type=Path)
    ap.add_argument("--tag", default=None, help="substring of the MAC or name (e.g. C00C)")
    ap.add_argument("--frames", action="store_true", help="print every frame")
    args = ap.parse_args()

    rows = [json.loads(l) for l in args.capture.read_text().splitlines() if l.strip()]
    if args.tag:
        needle = args.tag.upper()
        rows = [
            r
            for r in rows
            if needle in r.get("id", "").upper() or needle in (r.get("name") or "").upper()
        ]
    if not rows:
        sys.exit("No advertisements matched. Drop --tag to see every advertiser.")

    rows.sort(key=lambda r: r["at"])
    span_ms = rows[-1]["at"] - rows[0]["at"]
    t0 = rows[0]["at"]

    motion, identity, other = [], [], Counter()
    for r in rows:
        payload = service_data(r)
        reading = decode_motion(payload)
        if reading:
            motion.append((r["at"], payload, reading))
        elif payload:
            identity.append((r["at"], payload))
        else:
            other[r.get("name") or r["id"]] += 1

    by_id = Counter(r["id"] for r in rows)
    print(f"capture : {args.capture.name}")
    print(f"rows    : {len(rows)} over {span_ms / 1000:.1f}s")
    print(f"devices : {', '.join(f'{k} x{v}' for k, v in by_id.most_common(4))}")
    print()
    print(f"motion frames   (>= {MIN_FRAME_BYTES} bytes) : {len(motion)}")
    print(f"identity frames (< {MIN_FRAME_BYTES} bytes)  : {len(identity)}")
    if other:
        print(f"no 0x{SERVICE_UUID_SHORT} service data          : {sum(other.values())}")

    if args.frames:
        print()
        for at, payload, (x, y, z, tail) in motion:
            mag = (x * x + y * y + z * z) ** 0.5
            print(
                f"  t={(at - t0) / 1000:7.2f}s MOTION   "
                f"x={x:+.3f} y={y:+.3f} z={z:+.3f}  |a|={mag:.3f}g  mac…{tail}"
            )
        for at, payload in identity:
            print(f"  t={(at - t0) / 1000:7.2f}s identity {payload.hex(' ').upper()}")

    if not motion:
        print()
        print("VERDICT: no accelerometer frames at all — the tag is advertising its")
        print("         identity only, so no sample can ever reach the detector.")
        return

    # Rate and worst gap are what decide whether the detector could ever arm.
    stamps = [at for at, _, _ in motion]
    rate = len(motion) / (span_ms / 1000) if span_ms else float("inf")
    gaps = [(b - a) / 1000 for a, b in zip(stamps, stamps[1:])]
    worst = max(gaps) if gaps else 0.0
    mags = [(x * x + y * y + z * z) ** 0.5 for _, _, (x, y, z, _) in motion]

    print()
    print(f"motion rate  : {rate:.2f} Hz  (one every {1 / rate:.1f}s)" if rate else "")
    print(f"worst gap    : {worst:.1f}s")
    print(f"|a| range    : {min(mags):.3f}–{max(mags):.3f} g")

    print()
    needed = ARMING_MIN_SAMPLES / (ARMING_DURATION_MS / 1000)
    print(f"arming needs : {ARMING_MIN_SAMPLES} samples in {ARMING_DURATION_MS / 1000:.0f}s = {needed:.2f} Hz")
    print(f"             : {'MET' if rate >= needed else 'NOT MET'} at this rate")
    print(f"signal-lost  : gap > {SIGNAL_LOST_MS / 1000:.0f}s")
    print(f"             : {'would fire' if worst > SIGNAL_LOST_MS / 1000 else 'would not fire'} (worst gap {worst:.1f}s)")

    # Which detection paths this rate can actually reach. Path B scores a
    # crossing as "sharp" only when its leading edge was measured across a pair
    # no wider than MAX_DT_FOR_RATE_MS, so a slower tag does not weaken Path B,
    # it removes it — worth stating outright, because a dead path and a quiet
    # sea produce identical output.
    interval_ms = 1000 / rate if rate else float("inf")
    print()
    if interval_ms <= MAX_DT_FOR_RATE_MS:
        print("paths        : A (sustained load) and B (repeated sharp deflection)")
    else:
        print("paths        : A (sustained load) only")
        print(
            f"             : {interval_ms / 1000:.1f}s between readings vs the "
            f"{MAX_DT_FOR_RATE_MS}ms needed to measure a leading edge, so every"
        )
        print("               crossing scores zero sharp and Path B cannot fire.")


if __name__ == "__main__":
    main()
