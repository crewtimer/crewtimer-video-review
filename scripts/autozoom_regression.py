#!/usr/bin/env python3
"""Regression test for auto zoom to finish against reviewed crossings.

Runs the app's auto zoom (src/renderer/video/AutoZoomToFinish.ts, through
autozoom_regression_runner.js and the native bow detector) on each scored
crossing of a regatta recorded as <name>_<date>_<time>.mp4 videos with .json
sidecars, and compares where it lands with the reviewed time.

Times come from the regatta's CrewTimer lap data, read once from
crewtimer-results.firebaseio.com and archived in <folder>/crewtimer/ with the
results (for each event's scheduled bows); --refresh reads them again.
Deleted lap records are ignored.

  reference  --gate (G_FinishCamera: the ideal scores for SDFC26)
  start      --hint-gate (F: the Finish waypoint), as the app seeks to a timing
             hint and auto zooms from there; --start reference starts at the
             reference time instead, and --start-offset-ms that far from it.

Each crossing runs in the video that covers its start time, with the
sidecar's course area. Crews of the same event with an earlier reference time
count as already scored.

Error is auto zoom time minus reference time, in ms: positive is late.

Build the native module first (it must load in plain Node, not only Electron).

Examples:
  python3 scripts/autozoom_regression.py
  python3 scripts/autozoom_regression.py --start-offset-ms -125
  python3 scripts/autozoom_regression.py --save /tmp/az.json
  python3 scripts/autozoom_regression.py --baseline /tmp/az.json
"""
import argparse
import json
import os
import re
import statistics
import subprocess
import sys
import tempfile
import urllib.request
from glob import glob

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RUNNER = os.path.join(REPO, "scripts", "autozoom_regression_runner.js")
LAPDATA_URL = "https://crewtimer-results.firebaseio.com/regatta/{regatta}/lapdata.json"
RESULTS_URL = "https://crewtimer.com/results?regatta={regatta}&format=json"
DAY_MS = 86400000

# SDFC26 bows held out of the test: the bow is too blurry to place, or the
# boat is not visible at the finish, and auto zoom does not find the crossing
# from the Finish hint. Others first held out for these reasons were placed
# within 3 ms and are tested.
SDFC26_HOLDOUT = {"5", "27", "109", "136", "247"}
SDFC26_REGATTA = "r16527"


def archived(folder, regatta, name, url, refresh):
    """CrewTimer data, read from the archive in the dataset or fetched into it."""
    path = os.path.join(folder, "crewtimer", f"{regatta}-{name}.json")
    if refresh or not os.path.exists(path):
        print(f"reading {url}", flush=True)
        with urllib.request.urlopen(url, timeout=60) as response:
            data = json.load(response)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w") as f:
            json.dump(data, f, indent=1)
    with open(path) as f:
        return json.load(f)


def time_of_day_ms(text):
    h, m, s = text.split(":")
    return round((int(h) * 3600 + int(m) * 60 + float(s)) * 1000)


def clock(ms):
    ms = round(ms) % DAY_MS
    return f"{ms // 3600000:02d}:{ms // 60000 % 60:02d}:{ms // 1000 % 60:02d}.{ms % 1000:03d}"


def lap_times(lapdata, gate):
    """{(event, bow): local time of day in ms} for a gate's live records.

    A crew timed twice keeps its latest entry."""
    times = {}
    for rec in sorted(lapdata.values(), key=lambda r: r.get("Timestamp", 0)):
        if rec.get("Gate") != gate or rec.get("State") == "Deleted" or not rec.get("Time"):
            continue
        if not rec.get("Bow") or rec.get("EventNum") in (None, "", "?"):
            continue
        times[(rec["EventNum"], rec["Bow"])] = time_of_day_ms(rec["Time"])
    return times


def load_videos(folder):
    """Each video with its local start/stop time of day, fps and sidecar."""
    videos = []
    for sidecar in sorted(glob(os.path.join(folder, "*.json"))):
        video = sidecar[:-5] + ".mp4"
        if not os.path.exists(video):
            continue
        with open(sidecar) as f:
            meta = json.load(f)
        info = meta["file"]
        tz_ms = info.get("tzOffset", 0) * 60000
        videos.append({
            "file": video,
            "fps": info["fps"],
            "numFrames": info.get("numFrames", 1 << 30),
            "startEpochMs": float(info["startTs"]) * 1000,
            "start": (float(info["startTs"]) * 1000 + tz_ms) % DAY_MS,
            "stop": (float(info["stopTs"]) * 1000 + tz_ms) % DAY_MS,
            "courseArea": meta.get("courseArea"),
        })
    return videos


def video_at(videos, t):
    """The video that covers time t with the most margin, as a seek picks."""
    covering = [v for v in videos if v["start"] <= t <= v["stop"]]
    return max(covering, key=lambda v: min(t - v["start"], v["stop"] - t), default=None)


def frame_at(video, t):
    """Estimated frame (1-based, fractional) at local time of day t. The
    runner refines it from frame timestamps."""
    return 1 + (t - video["start"]) * video["fps"] / 1000


def epoch_ms(video, t):
    return video["startEpochMs"] + (t - video["start"])


def bow_order(bows):
    """Distinct bows, numbers in numeric order, then any others."""
    return sorted(set(bows), key=lambda b: (0, int(b), b) if b.isdigit() else (1, 0, b))


def load_cases(args, lapdata, results, videos):
    holdout = {b.strip() for b in args.holdout.split(",") if b.strip()}
    reference = lap_times(lapdata, args.gate)
    from_reference = args.start == "reference" or args.start_offset_ms is not None
    hints = reference if from_reference else lap_times(lapdata, args.hint_gate)
    offset = args.start_offset_ms or 0
    schedule = {e.get("EventNum", ""): [m.group() for m in (re.search(r"\d+$", (x.get("Bow") or "").strip())
                                                            for x in e.get("entries", [])) if m]
                for e in results}
    cases, skipped = [], []
    for (event, bow), ref in sorted(reference.items(), key=lambda kv: kv[1]):
        if (bow in holdout) != args.only_holdout:
            continue
        crossing = f"event {event} bow {bow}"
        hint = hints.get((event, bow))
        if hint is None:
            skipped.append(f"{crossing}: no {args.hint_gate} time")
            continue
        start = hint + offset
        video = video_at(videos, start)
        if video is None:
            skipped.append(f"{crossing}: no video at {clock(start)}")
            continue
        endings = schedule.get(event, [])
        longest = max((len(e) for e in endings), default=0)
        scored = sorted(b for (e, b), t in reference.items() if e == event and b != bow and t < ref)
        cases.append({
            "id": f"{os.path.basename(video['file'])}#{bow}",
            "videoFile": video["file"],
            "bow": bow,
            "eventNum": event,
            "fps": video["fps"],
            "numFrames": video["numFrames"],
            "reviewedMs": ref,
            "reviewedEpochMs": epoch_ms(video, ref),
            "reviewedFrame": frame_at(video, ref),
            "startMs": start,
            "startEpochMs": epoch_ms(video, start),
            "startFrame": frame_at(video, start),
            "scoredBows": scored,
            # As cardLengthForEvent and scheduledBowEndings in BowNumber.ts.
            "cardLength": longest if longest in (1, 2) else "auto",
            "scheduledBowEndings": endings,
            "courseArea": video["courseArea"] or {"enabled": False, "top": 0.25, "bottom": 0.95},
            "hyperZoomMs": args.hyperzoom_ms,
            "travelRightToLeft": not args.left_to_right,
        })
    return cases, skipped, bow_order(holdout)


def run_auto_zoom(cases, jobs):
    chunks = [cases[i::jobs] for i in range(jobs) if cases[i::jobs]]
    with tempfile.TemporaryDirectory() as tmp:
        procs = []
        for i, chunk in enumerate(chunks):
            cin, cout = os.path.join(tmp, f"in{i}.json"), os.path.join(tmp, f"out{i}.json")
            with open(cin, "w") as f:
                json.dump(chunk, f)
            env = {k: v for k, v in os.environ.items() if k != "ELECTRON_RUN_AS_NODE"}
            # The native decoder and detector log freely; keep it for failures.
            log = open(os.path.join(tmp, f"log{i}.txt"), "w")
            procs.append((subprocess.Popen(["node", RUNNER, cin, cout], cwd=REPO, env=env,
                                           stdout=log, stderr=subprocess.STDOUT), cout, log))
        print(f"running auto zoom in {len(procs)} processes...", flush=True)
        results = {}
        for proc, cout, log in procs:
            proc.wait()
            log.close()
            if proc.returncode != 0:
                with open(log.name) as f:
                    sys.stderr.write(f.read()[-4000:])
                sys.exit(f"runner failed (exit {proc.returncode})")
            with open(cout) as f:
                results.update({r["id"]: r for r in json.load(f)})
    return results


def pct(values, limit):
    return 100 * sum(abs(v) <= limit for v in values) / len(values) if values else 0


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--folder", default=os.path.expanduser("~/Documents/regatta/SDFC26"))
    ap.add_argument("--regatta", default=SDFC26_REGATTA, help="CrewTimer regatta id")
    ap.add_argument("--refresh", action="store_true", help="read the CrewTimer data again")
    ap.add_argument("--gate", default="G_FinishCamera", help="gate holding the reference times")
    ap.add_argument("--hint-gate", default="F", help="gate holding the timing hints")
    ap.add_argument("--start", choices=("hint", "reference"), default="hint",
                    help="start auto zoom at the hint or at the reference time")
    ap.add_argument("--start-offset-ms", type=float,
                    help="start this far from the reference time instead of at the hint")
    ap.add_argument("--holdout", default=",".join(sorted(SDFC26_HOLDOUT, key=int)),
                    help="comma-separated bows to leave out (default: the SDFC26 hold-outs)")
    ap.add_argument("--only-holdout", action="store_true", help="run only the held-out bows")
    ap.add_argument("--threshold-ms", type=float, default=3.0, help="report errors larger than this")
    ap.add_argument("--hyperzoom-ms", type=float, default=1.0, help="hyperzoom step auto zoom rounds to")
    ap.add_argument("--left-to-right", action="store_true", help="configured travel direction")
    ap.add_argument("--jobs", type=int, default=4, help="parallel runner processes")
    ap.add_argument("--limit", type=int, help="run only the first N crossings")
    ap.add_argument("--save", help="write per-crossing results to this JSON file")
    ap.add_argument("--baseline", help="compare with results saved earlier by --save")
    ap.add_argument("--fail-over", type=int,
                    help="exit 1 when more than this many crossings miss the threshold or fail")
    args = ap.parse_args()

    lapdata = archived(args.folder, args.regatta, "lapdata",
                       LAPDATA_URL.format(regatta=args.regatta), args.refresh)
    results = archived(args.folder, args.regatta, "results",
                       RESULTS_URL.format(regatta=args.regatta), args.refresh)
    cases, skipped, held_out = load_cases(args, lapdata, results, load_videos(args.folder))
    if args.limit:
        cases = cases[:args.limit]
    if not cases:
        sys.exit(f"no {args.gate} crossings with video in {args.folder}")
    if args.start == "hint" and args.start_offset_ms is None:
        start = f"{args.hint_gate} hint"
    else:
        start = "reference time"
        if args.start_offset_ms:
            start += f" {args.start_offset_ms:+g} ms"
    print(f"{len(cases)} {args.gate} crossings of {args.regatta} in {args.folder} "
          f"({len(held_out)} bows held out{', running only those' if args.only_holdout else ''}), "
          f"starting at the {start}")
    if held_out:
        print(f"held out: {', '.join(held_out)}", flush=True)

    found = run_auto_zoom(cases, max(1, args.jobs))
    rows = []
    for c in cases:
        r = found.get(c["id"], {"status": "no result", "log": []})
        err = None
        if r["status"] == "OK":
            # Rounded so a crossing exactly on the threshold is not reported.
            err = round((r["seekFrame"] - r["reviewedFrame"]) * 1000 / c["fps"], 2)
        rows.append({"id": c["id"], "bow": c["bow"], "event": c["eventNum"],
                     "reviewedTime": clock(c["reviewedMs"]), "startTime": clock(c["startMs"]),
                     "autoTime": clock(c["reviewedMs"] + err) if err is not None else None,
                     "startFromReviewedMs": round(c["startMs"] - c["reviewedMs"]),
                     "reviewedFrame": r.get("reviewedFrame"), "seekFrame": r.get("seekFrame"),
                     "detectedBow": r.get("detectedBow"), "status": r["status"],
                     "errorMs": err, "log": r.get("log", [])})

    ok = [r for r in rows if r["errorMs"] is not None]
    failed = [r for r in rows if r["errorMs"] is None]
    errs = [r["errorMs"] for r in ok]
    outliers = sorted((r for r in ok if abs(r["errorMs"]) > args.threshold_ms),
                      key=lambda r: -abs(r["errorMs"]))

    print(f"\nAuto zoom found {len(ok)} of {len(rows)} crossings")
    if errs:
        print(f"  median {statistics.median(errs):+.2f} ms, mean |err| {statistics.mean(map(abs, errs)):.2f} ms")
        # Both times are on a 1 ms grid (with the default hyperzoom), so
        # within half a step is exact.
        step = args.hyperzoom_ms if args.hyperzoom_ms > 0 else 1
        print(f"  exact {pct(errs, step / 2):.0f}%  "
              + "  ".join(f"within {t:g} ms {pct(errs, t):.0f}%" for t in (1, 2, 3, 5)))
        counts = {}
        for e in errs:
            bucket = round(e / step) * step
            counts[bucket] = counts.get(bucket, 0) + 1
        print("\n  error ms  crossings")
        for bucket in sorted(counts):
            print(f"  {bucket:+8g}  {counts[bucket]:4d}  {'#' * round(60 * counts[bucket] / max(counts.values()))}")

    print(f"\nErrors over {args.threshold_ms:g} ms: {len(outliers)}  (positive = auto zoom later than reference)"
          + (f"\n  bows {', '.join(bow_order(r['bow'] for r in outliers))}" if outliers else ""))
    for r in outliers:
        print(f"  {r['errorMs']:+8.2f} ms  {r['id']:32s} event {r['event']:>3s}  reference {r['reviewedTime']}"
              f"  auto {r['autoTime']}  start {r['startFromReviewedMs']:+5d} ms  read {r['detectedBow'] or '?'}")
    if failed:
        print(f"\nNo crossing found: {len(failed)}\n  bows {', '.join(bow_order(r['bow'] for r in failed))}")
        for r in failed:
            last = r["log"][-1] if r["log"] else ""
            print(f"  {r['id']:32s} event {r['event']:>3s}  start {r['startFromReviewedMs']:+5d} ms"
                  f"  {r['status']}  {last}")
    if skipped:
        print(f"\nNot run: {len(skipped)}")
        for s in skipped:
            print(f"  {s}")
    if held_out:
        print(f"\n{'Ran only the held-out' if args.only_holdout else 'Held out'} bows ({len(held_out)}): "
              f"{', '.join(held_out)}")

    if args.baseline:
        with open(args.baseline) as f:
            base = {r["id"]: r for r in json.load(f)}
        changed = []
        for r in rows:
            b = base.get(r["id"])
            if b is None:
                continue
            be, re_ = b.get("errorMs"), r["errorMs"]
            if (be is None) != (re_ is None) or (be is not None and abs(be - re_) > 0.05):
                changed.append((r, be, re_))
        fmt = lambda v: "  none" if v is None else f"{v:+6.2f}"
        print(f"\nChanged from baseline {args.baseline}: {len(changed)}")
        for r, be, re_ in sorted(changed, key=lambda x: x[0]["id"]):
            print(f"  {r['id']:32s} {fmt(be)} -> {fmt(re_)} ms")

    if args.save:
        with open(args.save, "w") as f:
            json.dump(rows, f, indent=1)
        print(f"\nSaved {args.save}")

    if args.fail_over is not None and len(outliers) + len(failed) > args.fail_over:
        sys.exit(1)


if __name__ == "__main__":
    main()
