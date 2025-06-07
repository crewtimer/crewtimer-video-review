#!/usr/bin/env python3
"""
extractTS.py

Video-based Frame-Timestamp Analyzer with Adaptive Bit‐Threshold, full logging of misses,
gray‐colored charts, automatic histogram binning, and integer‐ms logging (no fractional ms).

If the JSON file is missing required fields or cannot be parsed as expected,
the script will still decode every frame and produce bar‐ and histogram‐plots,
but will skip all JSON‐based offset/threshold comparisons and outlier logging.

Usage:
    python3 extractTS.py --dir "/path/to/folder" --overlay_x 0 --overlay_y 0 --debug
    python3 extractTS.py --file "/path/to/video/BaseName" --overlay_x 0 --overlay_y 0
"""

import os
import sys
import json
import argparse
import logging
import glob
import datetime

import cv2
import numpy as np
import matplotlib.pyplot as plt

# -----------------------------------------------------------------------------
# Decode the 128×3 overlay into a 64-bit integer via Adaptive Threshold,
# returning (ticks, overlay_crop, bit_string). Raises if no clear bit‐split.
# -----------------------------------------------------------------------------
def decode_overlay_from_frame(frame_bgr, ov_x=0, ov_y=0):
    """
    Crop a 128×3 region from frame at (ov_x, ov_y), read 64 bits via adaptive threshold:
      - For each bit i, sum the B+G+R of two horizontally adjacent pixels on row ov_y+1.
      - Sort those 64 sums, find the largest gap. Threshold = midpoint of that gap.
      - bit_i = '1' if sum_i > threshold, else '0'. If largest gap < 10, raise ValueError.
    Returns:
      ticks       : 64-bit Python int parsed from the 64-bit bit_string.
      overlay_bgr : cropped 3×128×3 BGR array (for saving if needed).
      bit_string  : 64-character '0'/'1' string.
    """
    h, w, _ = frame_bgr.shape
    if ov_x + 128 > w or ov_y + 3 > h:
        raise ValueError(f"Frame too small for a 128×3 overlay at ({ov_x},{ov_y}); size=({w}×{h})")

    overlay = frame_bgr[ov_y:ov_y + 3, ov_x:ov_x + 128]  # shape = (3,128,3)
    mid_row = overlay[1, :, :]  # shape = (128,3) in BGR

    sums_list = []
    for i in range(64):
        x0 = i * 2
        x1 = x0 + 1
        pix0 = mid_row[x0]
        pix1 = mid_row[x1]
        sum_i = int(pix0[0]) + int(pix0[1]) + int(pix0[2]) + \
                int(pix1[0]) + int(pix1[1]) + int(pix1[2])
        sums_list.append((sum_i, i))

    sorted_sums = sorted([s for s, _ in sums_list])
    diffs = [sorted_sums[j + 1] - sorted_sums[j] for j in range(63)]
    j_max = int(np.argmax(diffs))
    max_gap = diffs[j_max]

    # If no clear gap between black/white bits, consider decode failed
    if max_gap < 10:
        raise ValueError("No clear black/white gap in overlay (max_gap < 10)")

    thr = (sorted_sums[j_max] + sorted_sums[j_max + 1]) / 2.0

    sum_dict = {bit_index: sum_value for (sum_value, bit_index) in sums_list}
    bits = ['1' if sum_dict[i] > thr else '0' for i in range(64)]
    bit_string = "".join(bits)
    ticks = int(bit_string, 2)
    return ticks, overlay, bit_string

# -----------------------------------------------------------------------------
# Convert .NET ticks (100 ns since 0001-01-01) → epoch_ms (float)
# -----------------------------------------------------------------------------
EPOCH = datetime.datetime(1970, 1, 1, tzinfo=datetime.timezone.utc)

def ticks_to_epoch_ms(ticks):
    """
    1 tick = 100 ns = 0.0001 ms.
    Ticks start at 0001-01-01. Convert ticks to a UTC datetime, then to ms since Unix epoch.
    """
    total_microsec = ticks // 10  # 1 tick = 0.1 μs
    dt = datetime.datetime.min + datetime.timedelta(microseconds=total_microsec)
    dt_utc = dt.replace(tzinfo=datetime.timezone.utc)
    delta = dt_utc - EPOCH
    return delta.total_seconds() * 1000.0

def format_epoch_ms_to_local(ms, tz_offset_min):
    """
    Given epoch_ms (float) and tz_offset_min (minutes east of UTC), return "HH:MM:SS.mmm".
    """
    try:
        dt_utc = datetime.datetime.utcfromtimestamp(ms / 1000.0)
        dt_local = dt_utc + datetime.timedelta(minutes=tz_offset_min)
        return dt_local.strftime("%H:%M:%S.%f")[:-3]
    except Exception:
        return "InvalidLocal"

# -----------------------------------------------------------------------------
# Process one MP4 + JSON pair (or JSON‐invalid case)
# -----------------------------------------------------------------------------
def process_single_pair(video_path, json_path, output_dir,
                        ov_x, ov_y,
                        verbose=False, debug=False):
    base = os.path.splitext(os.path.basename(video_path))[0]
    out_prefix = os.path.join(output_dir, base)

    # --- Attempt to read JSON; if invalid or missing fields, set json_ok=False ---
    json_ok = True
    try:
        with open(json_path, "r") as f:
            meta = json.load(f)
        file_info = meta.get("file", {})
        startTs       = float(file_info["startTs"])
        stopTs        = float(file_info["stopTs"])
        num_frames    = int(file_info["numFrames"])
        tz_offset_min = int(file_info.get("tzOffset", 0))
    except Exception as e:
        logging.warning(f"[{base}] JSON invalid or missing fields: {e} – skipping JSON-based comparisons.")
        json_ok = False
        startTs_ms     = None
        stopTs_ms      = None
        num_frames     = None
        tz_offset_min  = 0

    if json_ok:
        startTs_ms = startTs * 1000.0
        stopTs_ms  = stopTs  * 1000.0
        if num_frames < 2:
            logging.warning(f"[{base}] JSON.numFrames < 2; JSON comparisons skipped.")
            json_ok = False

    # If JSON was parsed successfully, compute nominal_interval & threshold_ms (float)
    if json_ok:
        nominal_interval_ms = ((stopTs_ms - startTs_ms) / (num_frames - 1))
        threshold_ms = 2 * nominal_interval_ms
        logging.info(
            f"[{base}] JSON startTs={startTs_ms:.3f} ms, stopTs={stopTs_ms:.3f} ms, "
            f"numFrames={num_frames}, nominal_interval_ms={nominal_interval_ms:.3f}, "
            f"threshold_ms={threshold_ms:.3f}, tzOffset={tz_offset_min} min"
        )
    else:
        threshold_ms = None
        logging.info(f"[{base}] Proceeding without JSON‐based threshold/outlier checks.")

    # --- Open the video ---
    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        logging.error(f"[{base}] Cannot open video '{video_path}'.")
        return

    epoch_ms_list = []
    valid_indices = []
    valid_frames  = []    # store first 5 valid frames if --debug
    total_frames_read = 0
    misses = []          # list of (last_valid_idx, last_valid_ms, missed_idx)
    last_valid_idx = None
    last_valid_ms  = None

    # -------------------------
    # STEP 1: Decode frame 0 (always attempt, no JSON filter)
    # -------------------------
    ret0, frame0 = cap.read()
    if ret0:
        total_frames_read += 1
        try:
            ticks0, overlay0, bits0 = decode_overlay_from_frame(frame0, ov_x, ov_y)
            epoch0 = ticks_to_epoch_ms(ticks0)
            epoch_ms_list.append(epoch0)
            valid_indices.append(0)
            last_valid_idx = 0
            last_valid_ms  = epoch0
            if debug:
                valid_frames.append((0, frame0.copy(), ticks0, epoch0, bits0))
            if verbose:
                local0 = format_epoch_ms_to_local(epoch0, tz_offset_min)
                logging.debug(f"[{base}] Frame 0000 → ticks={ticks0}, epoch_ms={epoch0:.3f}, local={local0}, bits={bits0}")
        except Exception as e:
            misses.append((None, None, 0))
            overlay_crop0 = frame0[ov_y:ov_y + 3, ov_x:ov_x + 128]
            miss_path = out_prefix + f"_miss_0000.png"
            overlay_rgb = cv2.cvtColor(overlay_crop0, cv2.COLOR_BGR2RGB)
            plt.imsave(miss_path, overlay_rgb)
            logging.warning(f"[{base}] Frame 0000 decode failed: {e} → saved overlay to '{os.path.basename(miss_path)}'")
    else:
        logging.error(f"[{base}] Cannot read frame 0 from video.")
        cap.release()
        return

    frame_idx = 1

    # -------------------------
    # STEP 2: Loop over frames 1..EOF (no JSON filter),
    #         log MISS if decode fails
    # -------------------------
    while True:
        ret, frame = cap.read()
        if not ret:
            break
        total_frames_read += 1

        try:
            overlay_crop = frame[ov_y:ov_y + 3, ov_x:ov_x + 128]
            ticks, _, bit_string = decode_overlay_from_frame(frame, ov_x, ov_y)
            epoch_ms = ticks_to_epoch_ms(ticks)

            # Always accept any successfully decoded timestamp
            epoch_ms_list.append(epoch_ms)
            valid_indices.append(frame_idx)
            last_valid_idx = frame_idx
            last_valid_ms  = epoch_ms
            if debug and len(valid_frames) < 5:
                valid_frames.append((frame_idx, frame.copy(), ticks, epoch_ms, bit_string))
            if verbose:
                local_str = format_epoch_ms_to_local(epoch_ms, tz_offset_min)
                logging.debug(
                    f"[{base}] Frame {frame_idx:04d} → ticks={ticks}, epoch_ms={epoch_ms:.3f}, local={local_str}, bits={bit_string}"
                )

        except Exception as e:
            # Record a MISS
            misses.append((last_valid_idx, last_valid_ms, frame_idx))
            miss_path = out_prefix + f"_miss_{frame_idx:04d}.png"
            overlay_rgb = cv2.cvtColor(overlay_crop, cv2.COLOR_BGR2RGB)
            plt.imsave(miss_path, overlay_rgb)
            logging.debug(f"[{base}] Frame {frame_idx:04d} decode failed ({e}) → saved overlay to '{os.path.basename(miss_path)}'")

        frame_idx += 1

    cap.release()

    n_valid = len(epoch_ms_list)
    if n_valid < 1:
        logging.warning(f"[{base}] No valid frame timestamps decoded; skipping.")
        return

    # -------------------------
    # STEP 3: Write log header (integer‐ms formatting)
    # -------------------------
    log_lines = []
    if json_ok:
        # First frame vs. JSON start
        first_frame_idx = valid_indices[0]
        first_frame_ms  = epoch_ms_list[0]
        offset_start_ms = int(round(first_frame_ms - startTs_ms))
        first_frame_local = format_epoch_ms_to_local(first_frame_ms, tz_offset_min)
        start_ts_local    = format_epoch_ms_to_local(startTs_ms, tz_offset_min)
        log_lines.append(
            f"# JSON startTs:            {int(round(startTs_ms))} ms    (Local {start_ts_local})"
        )
        log_lines.append(
            f"# First decoded frame idx:  {first_frame_idx} → {int(round(first_frame_ms))} ms    (Local {first_frame_local})"
        )
        log_lines.append(f"# Offset_start:            {offset_start_ms} ms")
        if abs(offset_start_ms) > 0:
            log_lines.append(
                f"# ALERT: First frame TS does not match JSON start (offset {offset_start_ms} ms)"
            )
        log_lines.append("")

        # Last frame vs. JSON stop
        last_frame_idx = valid_indices[-1]
        last_frame_ms  = epoch_ms_list[-1]
        offset_end_ms  = int(round(last_frame_ms - stopTs_ms))
        last_frame_local = format_epoch_ms_to_local(last_frame_ms, tz_offset_min)
        stop_ts_local    = format_epoch_ms_to_local(stopTs_ms, tz_offset_min)
        log_lines.append(
            f"# JSON stopTs:             {int(round(stopTs_ms))} ms    (Local {stop_ts_local})"
        )
        log_lines.append(
            f"# Last decoded frame idx:   {last_frame_idx} → {int(round(last_frame_ms))} ms    (Local {last_frame_local})"
        )
        log_lines.append(f"# Offset_end:              {offset_end_ms} ms")
        if abs(offset_end_ms) > 0:
            log_lines.append(
                f"# ALERT: Last frame TS does not match JSON stop (offset {offset_end_ms} ms)"
            )
        log_lines.append("")
    else:
        log_lines.append("# JSON invalid or missing; skipped JSON-based start/stop comparisons.")
        log_lines.append("")

    # Frame counts and Δt info
    total_span_ms = epoch_ms_list[-1] - epoch_ms_list[0] if n_valid > 1 else 0
    observed_fps = int(round((n_valid - 1) * 1000.0 / total_span_ms)) if (n_valid > 1 and total_span_ms > 0) else 0

    log_lines.append(f"# Observed average FPS:    {observed_fps} Hz")
    log_lines.append(f"# Total frames read:       {total_frames_read}")
    log_lines.append(f"# Valid timestamps:        {n_valid}")
    log_lines.append(f"# Frames expected (JSON):  {num_frames if json_ok else 'N/A'}")
    if json_ok:
        thr_ms = int(round(threshold_ms))
        log_lines.append(f"# Gaps (|Δt|) ≥ {thr_ms} ms")
    else:
        log_lines.append("# Gaps (|Δt|) ≥ N/A (no JSON)")
    log_lines.append("")

    # -------------------------
    # STEP 4: Compute raw Δt (no wrap)
    # -------------------------
    raw = np.array(epoch_ms_list, dtype=np.float64)
    deltas_ms = np.diff(raw)  # length = n_valid−1

    # -------------------------
    # STEP 5: Write OUTLIER lines if JSON is valid, then MISS lines
    # -------------------------
    lag_log = out_prefix + "_lag.log"
    with open(lag_log, "w", encoding="utf-8") as logf:
        logf.write("\n".join(log_lines) + "\n")

        if json_ok:
            thr_ms = int(round(threshold_ms))
            for idx, dt in enumerate(deltas_ms, start=1):
                abs_dt = int(round(abs(dt)))
                if abs_dt >= thr_ms:
                    frame_idx_out = valid_indices[idx]
                    ts_curr = raw[idx]
                    local_time = format_epoch_ms_to_local(ts_curr, tz_offset_min)
                    if dt > 0:
                        sign_str = f"|Δt| = {abs_dt} ms ≥ {thr_ms} ms (lag)"
                    else:
                        sign_str = f"|Δt| = {abs_dt} ms ≥ {thr_ms} ms (negative outlier)"
                    logf.write(f"OUTLIER: Frame {frame_idx_out} (Local {local_time}) : {sign_str}\n")

        # Log every MISS event
        for last_idx, last_ms, miss_idx in misses:
            if last_idx is None:
                last_idx_str = "None"
                last_ms_str = "None"
            else:
                last_idx_str = str(last_idx)
                last_ms_str = f"{int(round(last_ms))} ms"
            logf.write(f"MISS: last valid idx = {last_idx_str}, last valid ts = {last_ms_str}, failed idx = {miss_idx}\n")

    logging.info(f"[{base}] Wrote lag/offset log: '{lag_log}'")

    # -------------------------
    # STEP 6: Plot bar chart of raw Δt_ms (medium gray)
    # -------------------------
    plt.figure(figsize=(10, 4))
    x = np.arange(1, n_valid)
    plt.bar(x, deltas_ms, width=0.8, color='gray', edgecolor='darkgray')

    if json_ok:
        thr_ms = int(round(threshold_ms))
        plt.axhline(thr_ms, color="darkgray", linestyle="--", label=f"+{thr_ms} ms")
        plt.axhline(-thr_ms, color="darkgray", linestyle="--", label=f"-{thr_ms} ms")

    plt.xlabel("Frame index")
    plt.ylabel("Inter-frame Δt (ms)")
    title_suffix = "" if json_ok else " (no JSON)"
    plt.title(f"Durations [{title_suffix}{base}]")

    if json_ok:
        plt.legend()
    plt.ticklabel_format(axis='y', style='plain', useOffset=False)
    plt.tight_layout()

    duration_plot = out_prefix + "_duration_plot.jpg"
    plt.savefig(duration_plot, dpi=150, format="jpg")
    plt.close()
    logging.info(f"[{base}] Saved duration plot: '{duration_plot}'")

    # -------------------------
    # STEP 7: Plot histogram of Δt_ms with bins='auto'
    # -------------------------
    plt.figure(figsize=(6, 4))
    plt.hist(deltas_ms, bins='auto', color='gray', edgecolor='darkgray')
    plt.xlabel("Inter-frame Δt (ms)")
    plt.ylabel("Count")
    plt.title(f"Histogram of Δt [{title_suffix}{base}]")
    plt.ticklabel_format(axis='y', style='plain', useOffset=False)
    plt.tight_layout()

    hist_plot = out_prefix + "_histogram.jpg"
    plt.savefig(hist_plot, dpi=150, format="jpg")
    plt.close()
    logging.info(f"[{base}] Saved histogram (auto bins): '{hist_plot}'")


# -----------------------------------------------------------------------------
# Find all MP4+JSON pairs in a directory
# -----------------------------------------------------------------------------
def find_pairs_in_directory(directory):
    pattern = os.path.join(directory, "*.mp4")
    for vid in sorted(glob.glob(pattern)):
        base, _ = os.path.splitext(os.path.basename(vid))
        js = os.path.join(directory, base + ".json")
        if os.path.isfile(js):
            yield vid, js
        else:
            logging.warning(f"No JSON found for '{vid}', skipping.")


# -----------------------------------------------------------------------------
# Main entry-point
# -----------------------------------------------------------------------------
def main():
    parser = argparse.ArgumentParser(
        description="Analyze per-frame timestamps in an MP4 (overlay→ms)."
    )
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--dir", "-d", help="Directory of .mp4 + matching .json")
    group.add_argument("--file", "-f", help="Base path (no extension) for one .mp4 + .json")
    parser.add_argument("--overlay_x", type=int, default=0, help="Overlay top-left X (default=0)")
    parser.add_argument("--overlay_y", type=int, default=0, help="Overlay top-left Y (default=0)")
    parser.add_argument("--output", "-o", default=None, help="Output dir for logs/plots")
    parser.add_argument("--verbose", action="store_true", help="Enable DEBUG logging")
    parser.add_argument("--debug", action="store_true",
                        help="Dump first 5 valid frames/timestamps of the first file")
    args = parser.parse_args()

    log_level = logging.DEBUG if args.verbose else logging.INFO
    logging.basicConfig(level=log_level, format="[%(levelname)s] %(message)s")

    first_file = True

    if args.dir:
        directory = os.path.abspath(args.dir)
        if not os.path.isdir(directory):
            logging.error(f"Directory '{directory}' not found.")
            sys.exit(1)

        out_base = os.path.abspath(args.output) if args.output else None
        pairs = list(find_pairs_in_directory(directory))
        if not pairs:
            logging.error(f"No valid pairs in '{directory}'.")
            sys.exit(1)

        for video_path, json_path in pairs:
            target_out = out_base or os.path.dirname(video_path)
            os.makedirs(target_out, exist_ok=True)
            process_single_pair(
                video_path=video_path,
                json_path=json_path,
                output_dir=target_out,
                ov_x=args.overlay_x,
                ov_y=args.overlay_y,
                verbose=args.verbose,
                debug=args.debug and first_file
            )
            first_file = False

    else:
        base = os.path.abspath(args.file)
        video_path = base + ".mp4"
        json_path = base + ".json"
        if not os.path.isfile(video_path) or not os.path.isfile(json_path):
            logging.error("Video or JSON not found.")
            sys.exit(1)

        out_dir = os.path.abspath(args.output) if args.output else os.path.dirname(video_path)
        os.makedirs(out_dir, exist_ok=True)
        process_single_pair(
            video_path=video_path,
            json_path=json_path,
            output_dir=out_dir,
            ov_x=args.overlay_x,
            ov_y=args.overlay_y,
            verbose=args.verbose,
            debug=args.debug
        )

if __name__ == "__main__":
    main()
