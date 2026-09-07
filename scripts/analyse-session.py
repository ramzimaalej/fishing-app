#!/usr/bin/env python3
"""
Turn a recorded fishing session into a verdict on the detector.

Companion to analyse-capture.py, which answers "is the tag talking?". This one
answers the questions a session on the water is meant to settle:

    Did the rod arm, and how long did it take?
    Did a cast leave the baseline stale, and did it recover?
    Did anything alert, and was it a fish or a rod put back down crooked?

Those are not visible in theta alone. A rod reading 7 degrees for an hour is
either a real load or a baseline the freeze has trapped, and the two call for
opposite fixes — which is why `frozen` and `rebaselined` are recorded per
sample. See src/features/admin/csv.ts.

USAGE
    python3 scripts/analyse-session.py <session-dir>

    A session directory holds chunk-0000.csv, chunk-0001.csv, ... and
    events.csv. Pull one off a debug build with:

        adb shell run-as co.castmate ls files/castmate-captures/
        adb shell run-as co.castmate tar c -C files/castmate-captures <id> > s.tar
        tar xf s.tar
"""

import argparse
import csv
import sys
from pathlib import Path

# Mirrors src/features/detection/detectionParams.ts. Literals rather than parsed
# out of the TS, so an old session stays readable after the constants move on.
EXPECTED_SAMPLE_INTERVAL_MS = 3_600
SIGNAL_LOST_MS = EXPECTED_SAMPLE_INTERVAL_MS * 5
REBASELINE_STILL_MS = 45_000

# A re-baseline landing within this long after an alert says the alert was
# almost certainly the rod being put back down, not a fish.
SUSPECT_ALERT_WINDOW_MS = REBASELINE_STILL_MS * 2


def load_samples(session: Path):
    chunks = sorted(session.glob("chunk-*.csv"))
    if not chunks:
        sys.exit(f"No chunk-*.csv in {session}. Is this a session directory?")
    rows = []
    for chunk in chunks:
        with chunk.open(newline="") as fh:
            rows.extend(list(csv.DictReader(fh)))
    if not rows:
        sys.exit("Session recorded no samples at all.")
    if "rebaselined" not in rows[0]:
        sys.exit(
            "This session predates the frozen/rebaselined columns, so it cannot\n"
            "say why a rod sat deflected. Re-record with a current build."
        )
    for r in rows:
        r["t"] = int(r["t"])
        r["thetaDeg"] = float(r["thetaDeg"] or 0)
    rows.sort(key=lambda r: r["t"])
    return rows


def load_events(session: Path):
    path = session / "events.csv"
    if not path.exists():
        return []
    with path.open(newline="") as fh:
        events = list(csv.DictReader(fh))
    for e in events:
        e["at"] = int(e["at"])
    return sorted(events, key=lambda e: e["at"])


def frozen_stretches(rows):
    """(start_t, end_t, ended_by_rebaseline) for each continuously-frozen run."""
    out, start, last = [], None, None
    for r in rows:
        if r["frozen"] == "1":
            if start is None:
                start = r["t"]
            last = r["t"]
            if r["rebaselined"] == "1":
                out.append((start, r["t"], True))
                start, last = None, None
        elif start is not None:
            out.append((start, last, False))
            start, last = None, None
    if start is not None:
        out.append((start, last, False))
    return out


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("session", type=Path)
    args = ap.parse_args()

    rows = load_samples(args.session)
    events = load_events(args.session)

    t0 = rows[0]["t"]
    span_s = (rows[-1]["t"] - t0) / 1000
    rel = lambda t: (t - t0) / 1000  # noqa: E731

    print(f"session : {args.session.name}")
    print(f"samples : {len(rows)} over {span_s / 60:.1f} min")

    # --- Stream health. Everything below is meaningless if this is bad. -------
    gaps = [(b["t"] - a["t"]) for a, b in zip(rows, rows[1:])]
    rate = len(rows) / span_s if span_s else 0
    lost = [g for g in gaps if g > SIGNAL_LOST_MS]
    print(f"rate    : {rate:.2f} Hz (one every {1 / rate:.1f}s)" if rate else "rate    : n/a")
    if gaps:
        print(f"worst gap: {max(gaps) / 1000:.1f}s — {len(lost)} gap(s) over the {SIGNAL_LOST_MS / 1000:.0f}s signal-lost bar")

    # --- Baseline behaviour: the thing the trip is meant to test. ------------
    stretches = frozen_stretches(rows)
    recovered = [s for s in stretches if s[2]]
    # A stretch long enough to have re-baselined but which did not is the
    # original bug: a stale baseline the rod never climbed out of.
    stuck = [s for s in stretches if not s[2] and (s[1] - s[0]) > REBASELINE_STILL_MS * 1.5]

    print()
    print(f"frozen stretches : {len(stretches)}")
    print(f"  recovered by re-baseline : {len(recovered)}")
    for start, end, _ in recovered:
        print(f"    t={rel(start):7.1f}s frozen {(end - start) / 1000:5.1f}s -> adopted new rest attitude")
    print(f"  still stuck at the end   : {len(stuck)}")
    for start, end, _ in stuck:
        print(f"    t={rel(start):7.1f}s frozen {(end - start) / 1000:5.1f}s -> NEVER recovered")

    # --- Alerts, and which of them look like a rod rather than a fish. -------
    alerts = [e for e in events if "HOOK" in e.get("kind", "").upper()]
    print()
    print(f"alerts  : {len(alerts)}")
    for a in alerts:
        followed = [s for s in recovered if 0 <= s[1] - a["at"] <= SUSPECT_ALERT_WINDOW_MS]
        verdict = "SUSPECT — re-baselined right after, so likely a re-seated rod" if followed else "no re-baseline followed — consistent with a real load"
        print(f"    t={rel(a['at']):7.1f}s {a.get('kind')} ({a.get('rodName') or a.get('rodId')}) — {verdict}")

    # --- Verdict -------------------------------------------------------------
    print()
    if stuck:
        print("VERDICT: a baseline stayed stale. Note what happened to the rod at")
        print("         those times — if it was re-seated, check the swell: a rod")
        print("         rocking more than +/-3 degrees is kept as a load, not adopted.")
    elif recovered:
        print("VERDICT: the rod was re-seated and recovered on its own. This is the")
        print("         behaviour the change was made for, observed on real water.")
    else:
        print("VERDICT: the baseline never froze long enough to need recovering, so")
        print("         this session does not exercise the re-baseline path. Cast and")
        print("         re-seat the rod at a visibly different angle to test it.")


if __name__ == "__main__":
    main()
