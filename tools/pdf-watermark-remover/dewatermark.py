#!/usr/bin/env python3
"""Watermark removal for scanned text images.

Chroma-mask + levels-stretch pipeline described in README.md section 4.
A pixel is watermark only if it is coloured AND light; ink under the stamp is
coloured but dark, so it fails the test and survives.

Used standalone on images, and as the raster fallback inside pdf_dewatermark.py.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

import cv2
import numpy as np

IMAGE_EXTS = {".png", ".jpg", ".jpeg", ".bmp", ".tif", ".tiff", ".webp"}

DEFAULTS = dict(sat_thresh=18, val_thresh=110, white_point=205, black_point=55, despeckle=0)


def flatten_alpha(img: np.ndarray) -> np.ndarray:
    """Step 0 -- promote to 3-channel BGR, compositing any alpha onto white."""
    if img.ndim == 2:
        return cv2.cvtColor(img, cv2.COLOR_GRAY2BGR)
    if img.shape[2] == 4:
        bgr = img[:, :, :3].astype(np.float32)
        alpha = img[:, :, 3:4].astype(np.float32) / 255.0
        return (bgr * alpha + 255.0 * (1.0 - alpha)).round().clip(0, 255).astype(np.uint8)
    return img


def remove_watermark(
    img: np.ndarray,
    sat_thresh: int = 18,
    val_thresh: int = 110,
    white_point: int = 205,
    black_point: int = 55,
    despeckle: int = 0,
) -> np.ndarray:
    """NumPy array in, single-channel uint8 array out. No I/O, no global state."""
    bgr = flatten_alpha(img)

    # Step 1 -- chroma mask: coloured AND light == stamp, wipe to white.
    hsv = cv2.cvtColor(bgr, cv2.COLOR_BGR2HSV)
    stamp = (hsv[:, :, 1] > sat_thresh) & (hsv[:, :, 2] > val_thresh)
    bgr = bgr.copy()
    bgr[stamp] = 255

    # Step 2 -- levels stretch: remap [black_point, white_point] onto [0, 255].
    grey = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY).astype(np.float32)
    lo, hi = float(black_point), float(white_point)
    if hi <= lo:
        hi = lo + 1.0
    out = ((grey - lo) * (255.0 / (hi - lo))).clip(0, 255).round().astype(np.uint8)

    # Step 3 -- despeckle: drop connected ink blobs smaller than N pixels.
    if despeckle > 0:
        ink = (out < 128).astype(np.uint8)
        count, labels, stats, _ = cv2.connectedComponentsWithStats(ink, connectivity=8)
        small = np.zeros(count, dtype=bool)
        small[1:] = stats[1:, cv2.CC_STAT_AREA] < despeckle
        out[small[labels]] = 255

    return out


def _resolve_output(src: Path, out_arg: Path, out_is_dir: bool) -> Path:
    if out_is_dir:
        return out_arg / f"{src.stem}_clean.png"
    return out_arg


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Strip a coloured watermark and flatten the page to white.")
    ap.add_argument("input", type=Path, help="image file or directory of images")
    ap.add_argument("output", type=Path, help="output file or directory")
    ap.add_argument("--sat", type=int, default=DEFAULTS["sat_thresh"], help="min saturation counted as watermark")
    ap.add_argument("--val", type=int, default=DEFAULTS["val_thresh"], help="coloured pixels brighter than this are wiped")
    ap.add_argument("--white", type=int, default=DEFAULTS["white_point"], help="grey level mapped to pure white")
    ap.add_argument("--black", type=int, default=DEFAULTS["black_point"], help="grey level mapped to pure black")
    ap.add_argument("--despeckle", type=int, default=DEFAULTS["despeckle"], help="remove ink blobs under N px (0 disables)")
    args = ap.parse_args(argv)

    if args.input.is_dir():
        sources = sorted(p for p in args.input.iterdir() if p.suffix.lower() in IMAGE_EXTS)
        args.output.mkdir(parents=True, exist_ok=True)
        out_is_dir = True
    else:
        sources = [args.input]
        out_is_dir = args.output.is_dir() or args.output.suffix == ""
        if out_is_dir:
            args.output.mkdir(parents=True, exist_ok=True)

    written = 0
    for src in sources:
        img = cv2.imread(str(src), cv2.IMREAD_UNCHANGED)
        if img is None:
            print(f"skip: cannot read {src}", file=sys.stderr)
            continue
        clean = remove_watermark(img, args.sat, args.val, args.white, args.black, args.despeckle)
        dst = _resolve_output(src, args.output, out_is_dir)
        dst.parent.mkdir(parents=True, exist_ok=True)
        cv2.imwrite(str(dst), clean)
        print(f"{src} -> {dst}")
        written += 1

    print(f"{written} file(s) written")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
