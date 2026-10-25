#!/usr/bin/env python3
"""
Rework lap images uploaded by older CrewTimer Video Review releases.

Older releases drew an event/gate/time badge and a bow badge along the bottom
edge of each lap image.  For each <uuid>.jpg under ctvideo/<regatta>/ this:

  1. crops off the band holding those badges, making the image shorter,
  2. draws the bow badge again as the app now does, using the bow from the
     image's "bow" metadata,
  3. writes the image back in place with overlay=bow added to its metadata,
     so it is never cropped twice, and
  4. replaces <uuid>-tn.jpg with a thumbnail at most 150px on the longer side.

Images already marked overlay=bow (adjusted, or uploaded by a release that
draws only the bow) are left alone; their thumbnail is created if missing.
Images without bow metadata are skipped.

Requirements:
    pip install google-cloud-storage Pillow

Auth:
    gcloud auth application-default login
    (or set GOOGLE_APPLICATION_CREDENTIALS to a service-account key file)

Usage:
    python adjust_images.py --regatta rm1612 --dry-run   # list what would be done
    python adjust_images.py --regatta rm1612 --preview /tmp/preview
        # write adjusted images and thumbnails locally, upload nothing
    python adjust_images.py --regatta rm1612
    python adjust_images.py --regatta rm1612 --font /path/to/Roboto-Bold.ttf
"""

import argparse
import io
import logging
import math
import os
import posixpath
import sys
from collections import Counter
from concurrent.futures import ThreadPoolExecutor, as_completed

from google.api_core.exceptions import PreconditionFailed
from google.cloud import storage
from PIL import Image, ImageDraw, ImageFont

from make_thumbnails import (DEFAULT_BUCKET, is_source_image, make_thumbnail,
                             thumb_name_for)

THUMB_SIZE = 150
THUMB_QUALITY = 85
THUMB_CACHE_CONTROL = "public, max-age=86400"
# Same qualities and size limit as LapImage.ts, so images stay under the
# storage.rules ctvideo limit the app uploads against.
JPEG_QUALITIES = (85, 70, 50)
MAX_BYTES = 2 * 1024 * 1024
OVERLAY_KEY = "overlay"
OVERLAY_BOW = "bow"
# The app draws with "Roboto, sans-serif"; these are the closest fallbacks.
FONT_CANDIDATES = (
    "Roboto-Bold.ttf",
    "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
    "C:/Windows/Fonts/arialbd.ttf",
)

log = logging.getLogger("adjust_images")


def js_round(value: float) -> int:
    """Math.round: halves round up, unlike Python's round()."""
    return math.floor(value + 0.5)


def old_badge_top(height: int) -> int:
    """First row covered by the bottom badges older releases drew.

    Mirrors LapImage.ts and drawCornerBadge in FinishPhoto.ts: a bow badge at
    the image's font size and a two-line event/time badge at 0.6 of it, both
    centered on the same row.
    """
    font_size = max(16, js_round(height * 0.04))
    small = max(14, js_round(font_size * 0.6))
    margin = js_round(font_size * 0.3)
    row_height = font_size + 2 * js_round(font_size * 0.2)
    row_center = height - margin - row_height / 2
    event_badge = small + js_round(small * 1.15) + 2 * js_round(small * 0.2)
    bow_badge = font_size + 2 * js_round(font_size * 0.2)
    return math.floor(row_center - max(event_badge, bow_badge) / 2)


def draw_bow_badge(img: Image.Image, bow: str, font_path: str) -> Image.Image:
    """Draw the bow in the bottom right corner as drawCornerBadge does."""
    font_size = max(16, js_round(img.height * 0.04))
    font = ImageFont.truetype(font_path, font_size)
    pad_x = js_round(font_size * 0.4)
    pad_y = js_round(font_size * 0.2)
    margin = js_round(font_size * 0.3)
    badge_w = math.ceil(font.getlength(bow)) + 2 * pad_x
    badge_h = font_size + 2 * pad_y
    x = img.width - badge_w - margin
    y = img.height - margin - badge_h

    overlay = Image.new("RGBA", img.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)
    draw.rectangle((x, y, x + badge_w - 1, y + badge_h - 1),
                   fill=(64, 64, 64, js_round(0.6 * 255)))
    draw.text((x + badge_w / 2, y + pad_y + font_size / 2), bow,
              font=font, fill=(255, 255, 255, 255), anchor="mm")
    return Image.alpha_composite(img.convert("RGBA"), overlay).convert("RGB")


def encode_jpeg(img: Image.Image) -> bytes:
    for quality in JPEG_QUALITIES:
        out = io.BytesIO()
        img.save(out, format="JPEG", quality=quality, optimize=True)
        if out.tell() < MAX_BYTES:
            return out.getvalue()
    raise ValueError("image too large at the lowest JPEG quality")


def adjust_image(data: bytes, bow: str, font_path: str) -> bytes:
    with Image.open(io.BytesIO(data)) as src:
        img = src.convert("RGB")
    top = old_badge_top(img.height)
    if top <= 0:
        raise ValueError(f"image too short to crop ({img.height}px)")
    return encode_jpeg(draw_bow_badge(img.crop((0, 0, img.width, top)), bow,
                                      font_path))


def write_preview(directory: str, name: str, data: bytes) -> str:
    path = os.path.join(directory, posixpath.basename(name))
    with open(path, "wb") as f:
        f.write(data)
    return path


def upload_thumbnail(bucket, name: str, data: bytes) -> None:
    thumb = bucket.blob(thumb_name_for(name))
    thumb.cache_control = THUMB_CACHE_CONTROL
    thumb.upload_from_string(data, content_type="image/jpeg")


def process_blob(bucket, blob, thumb_exists: bool, args) -> str:
    """Adjust one image; returns a short outcome used for the summary."""
    meta = dict(blob.metadata or {})
    if meta.get(OVERLAY_KEY) == OVERLAY_BOW:
        if thumb_exists:
            return "already adjusted"
        data = blob.download_as_bytes()
        thumb = make_thumbnail(data, THUMB_SIZE, THUMB_QUALITY)
        if args.preview:
            write_preview(args.preview, thumb_name_for(blob.name), thumb)
        else:
            upload_thumbnail(bucket, blob.name, thumb)
        return "thumbnail created"

    bow = (meta.get("bow") or "").strip()
    if not bow:
        return "no bow metadata"

    data = blob.download_as_bytes(if_generation_match=blob.generation)
    adjusted = adjust_image(data, bow, args.font)
    thumb = make_thumbnail(adjusted, THUMB_SIZE, THUMB_QUALITY)

    if args.preview:
        write_preview(args.preview, blob.name, adjusted)
        write_preview(args.preview, thumb_name_for(blob.name), thumb)
        return "adjusted"

    dst = bucket.blob(blob.name)
    dst.metadata = {**meta, OVERLAY_KEY: OVERLAY_BOW}
    dst.cache_control = blob.cache_control
    try:
        # Fails if the app re-uploaded this image since it was listed.
        dst.upload_from_string(adjusted, content_type="image/jpeg",
                               if_generation_match=blob.generation)
    except PreconditionFailed:
        return "changed during run"
    upload_thumbnail(bucket, blob.name, thumb)
    return "adjusted"


def find_font(requested: str) -> str:
    for path in ([requested] if requested else FONT_CANDIDATES):
        try:
            ImageFont.truetype(path, 16)
            return path
        except OSError:
            continue
    raise SystemExit("No usable bold font found; pass one with --font")


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__,
                                formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--bucket", default=DEFAULT_BUCKET)
    p.add_argument("--regatta", required=True,
                   help="regatta ID, e.g. rm1612 for ctvideo/rm1612/")
    p.add_argument("--font", default="",
                   help="bold TrueType font for the bow badge (default: "
                        "Roboto Bold or a system Arial/DejaVu bold)")
    p.add_argument("--workers", type=int, default=8, help="parallel workers")
    p.add_argument("--preview", metavar="DIR",
                   help="write results to DIR instead of uploading")
    p.add_argument("--dry-run", action="store_true")
    p.add_argument("-v", "--verbose", action="store_true")
    args = p.parse_args()

    logging.basicConfig(level=logging.DEBUG if args.verbose else logging.INFO,
                        format="%(asctime)s %(levelname)s %(message)s")

    regatta = args.regatta.strip().strip("/")
    if not regatta or "/" in regatta:
        p.error("--regatta must be a single regatta ID")
    prefix = f"ctvideo/{regatta}/"
    args.font = find_font(args.font)
    log.info("Using font %s", args.font)
    if args.preview:
        os.makedirs(args.preview, exist_ok=True)

    client = storage.Client()
    bucket = client.bucket(args.bucket)

    log.info("Listing gs://%s/%s", args.bucket, prefix)
    blobs = list(client.list_blobs(args.bucket, prefix=prefix))
    names = {b.name for b in blobs}
    sources = sorted((b for b in blobs if is_source_image(b.name)),
                     key=lambda b: b.name)
    log.info("Found %d images", len(sources))

    if args.dry_run:
        for b in sources:
            meta = b.metadata or {}
            if meta.get(OVERLAY_KEY) == OVERLAY_BOW:
                action = ("skip, already adjusted" if thumb_name_for(b.name) in names
                          else "create thumbnail")
            elif not (meta.get("bow") or "").strip():
                action = "skip, no bow metadata"
            else:
                action = f"adjust, bow {meta['bow'].strip()}"
            print(f"{b.name}: {action}")
        return 0

    outcomes = Counter()
    failed = 0
    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        futures = {pool.submit(process_blob, bucket, b,
                               thumb_name_for(b.name) in names, args): b.name
                   for b in sources}
        for fut in as_completed(futures):
            name = futures[fut]
            try:
                outcome = fut.result()
                outcomes[outcome] += 1
                log.debug("%s: %s", name, outcome)
                if outcome in ("no bow metadata", "changed during run"):
                    log.warning("Skipped %s: %s", name, outcome)
            except Exception as e:  # keep going on bad images
                failed += 1
                log.error("Failed %s: %s", name, e)

    summary = ", ".join(f"{n} {outcome}" for outcome, n in sorted(outcomes.items()))
    log.info("Done: %s, %d failed", summary or "nothing to do", failed)
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
