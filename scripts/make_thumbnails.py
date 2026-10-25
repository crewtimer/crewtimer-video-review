#!/usr/bin/env python3
"""
Create thumbnails for all JPEG images under a Google Cloud Storage prefix.

For each <uuid>.jpeg or <uuid>.jpg found, writes <uuid>-tn.jpeg or
<uuid>-tn.jpg alongside it (same extension as the original),
scaled so the longer side is at most 250px (aspect ratio preserved).

Requirements:
    pip install google-cloud-storage Pillow

Auth:
    gcloud auth application-default login
    (or set GOOGLE_APPLICATION_CREDENTIALS to a service-account key file)

Usage:
    python make_thumbnails.py --prefix ctvideo/rm1612/
    python make_thumbnails.py --prefix ctvideo/rm1612/ --size 250 --workers 16
    python make_thumbnails.py --prefix ctvideo/rm1612/ --overwrite  # regenerate existing
    python make_thumbnails.py --prefix ctvideo/rm1612/ --dry-run    # list what would be done
    python make_thumbnails.py --prefix ctvideo/rm1612/ --delete-mismatched
        # also remove thumbnails whose extension doesn't match the source,
        # e.g. a-tn.jpeg left over from a.jpg
"""

import argparse
import io
import logging
import posixpath
import sys
from concurrent.futures import ThreadPoolExecutor, as_completed

from google.cloud import storage
from PIL import Image, ImageOps

DEFAULT_BUCKET = "crewtimer-results.appspot.com"
THUMB_MARKER = "-tn"
JPEG_EXTS = (".jpeg", ".jpg")

log = logging.getLogger("thumbnails")


def is_source_image(name: str) -> bool:
    stem, ext = posixpath.splitext(name)
    return ext.lower() in JPEG_EXTS and not stem.lower().endswith(THUMB_MARKER)


def thumb_name_for(name: str) -> str:
    # Keep the original extension exactly: a.jpg -> a-tn.jpg, b.JPEG -> b-tn.JPEG
    stem, ext = posixpath.splitext(name)
    return stem + THUMB_MARKER + ext


def find_mismatched_thumbs(all_names: set) -> list:
    """Thumbnails whose source exists but with a different extension.

    e.g. a-tn.jpeg when the source is a.jpg (expected thumb: a-tn.jpg).
    Thumbnails with no source image at all are left alone.
    """
    expected = {}  # stem -> set of correct thumb names
    for n in all_names:
        if is_source_image(n):
            stem, _ = posixpath.splitext(n)
            expected.setdefault(stem, set()).add(thumb_name_for(n))

    mismatched = []
    for n in all_names:
        stem, ext = posixpath.splitext(n)
        if ext.lower() not in JPEG_EXTS or not stem.lower().endswith(THUMB_MARKER):
            continue
        src_stem = stem[: -len(THUMB_MARKER)]
        wanted = expected.get(src_stem)
        if wanted and n not in wanted:
            mismatched.append((n, wanted))
    return sorted(mismatched)


def make_thumbnail(data: bytes, max_size: int, quality: int) -> bytes:
    with Image.open(io.BytesIO(data)) as img:
        img = ImageOps.exif_transpose(img)  # honor camera orientation
        if img.mode != "RGB":
            img = img.convert("RGB")
        # thumbnail() keeps aspect ratio and never upscales
        img.thumbnail((max_size, max_size), Image.Resampling.LANCZOS)
        out = io.BytesIO()
        img.save(out, format="JPEG", quality=quality, optimize=True)
        return out.getvalue()


def process_blob(bucket, blob_name: str, max_size: int, quality: int) -> str:
    src = bucket.blob(blob_name)
    data = src.download_as_bytes()
    thumb = make_thumbnail(data, max_size, quality)
    dst = bucket.blob(thumb_name_for(blob_name))
    dst.cache_control = "public, max-age=86400"
    dst.upload_from_string(thumb, content_type="image/jpeg")
    return dst.name


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__,
                                formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--bucket", default=DEFAULT_BUCKET)
    p.add_argument("--prefix", required=True,
                   help="folder within the bucket, e.g. ctvideo/rm1612/")
    p.add_argument("--size", type=int, default=150, help="max width/height in px")
    p.add_argument("--quality", type=int, default=85, help="JPEG quality (1-95)")
    p.add_argument("--workers", type=int, default=8, help="parallel workers")
    p.add_argument("--overwrite", action="store_true",
                   help="regenerate thumbnails that already exist")
    p.add_argument("--delete-mismatched", action="store_true",
                   help="delete thumbnails whose extension doesn't match the "
                        "source image (e.g. a-tn.jpeg for a.jpg); only deleted "
                        "once the correctly named thumbnail exists")
    p.add_argument("--dry-run", action="store_true")
    p.add_argument("-v", "--verbose", action="store_true")
    args = p.parse_args()

    logging.basicConfig(level=logging.DEBUG if args.verbose else logging.INFO,
                        format="%(asctime)s %(levelname)s %(message)s")

    prefix = args.prefix.strip().lstrip("/")
    if not prefix:
        p.error("--prefix must not be empty")
    if not prefix.endswith("/"):
        prefix += "/"
    client = storage.Client()
    bucket = client.bucket(args.bucket)

    log.info("Listing gs://%s/%s", args.bucket, prefix)
    all_names = {b.name for b in client.list_blobs(args.bucket, prefix=prefix)}

    sources = sorted(n for n in all_names if is_source_image(n))
    if not args.overwrite:
        todo = [n for n in sources if thumb_name_for(n) not in all_names]
    else:
        todo = sources

    mismatched = find_mismatched_thumbs(all_names) if args.delete_mismatched else []

    log.info("Found %d JPEGs, %d need thumbnails", len(sources), len(todo))
    if args.delete_mismatched:
        log.info("Found %d mismatched thumbnails", len(mismatched))
    if args.dry_run:
        for n in todo:
            print(f"create {n} -> {thumb_name_for(n)}")
        for n, _ in mismatched:
            print(f"delete {n}")
        return 0

    ok = failed = 0
    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        futures = {pool.submit(process_blob, bucket, n, args.size, args.quality): n
                   for n in todo}
        for fut in as_completed(futures):
            name = futures[fut]
            try:
                out = fut.result()
                all_names.add(out)
                ok += 1
                log.debug("Wrote %s", out)
                if ok % 100 == 0:
                    log.info("Progress: %d/%d", ok, len(todo))
            except Exception as e:  # keep going on bad images
                failed += 1
                log.error("Failed %s: %s", name, e)

    log.info("Done: %d created, %d failed", ok, failed)

    if mismatched:
        # Only delete once a correctly named replacement is in the bucket
        to_delete = [n for n, wanted in mismatched if wanted & all_names]
        skipped = len(mismatched) - len(to_delete)
        if skipped:
            log.warning("Keeping %d mismatched thumbnails: correct thumbnail "
                        "was not created", skipped)
        deleted = 0
        with ThreadPoolExecutor(max_workers=args.workers) as pool:
            futures = {pool.submit(bucket.blob(n).delete): n for n in to_delete}
            for fut in as_completed(futures):
                name = futures[fut]
                try:
                    fut.result()
                    deleted += 1
                    log.debug("Deleted %s", name)
                except Exception as e:
                    failed += 1
                    log.error("Failed to delete %s: %s", name, e)
        log.info("Deleted %d mismatched thumbnails", deleted)
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
