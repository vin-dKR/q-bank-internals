#!/usr/bin/env python3
"""Browser front end for pdf_dewatermark.py.

Upload a PDF, review every watermark candidate the detector found -- with the
actual pixels it would delete and the actual content-stream bytes it would cut --
confirm the ones that are right, then download the cleaned file.

    pip install fastapi uvicorn python-multipart
    python app.py                 # http://127.0.0.1:8000

Nothing leaves the machine: uploads live in a temp directory and are deleted
after SESSION_TTL.
"""

from __future__ import annotations

import asyncio
import base64
import contextlib
import math
import shutil
import sys
import tempfile
import time
import uuid
from collections import Counter
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

import cv2
import fitz
import numpy as np
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse
from pydantic import BaseModel, Field

import dewatermark as dw
import pdf_dewatermark as pw

HERE = Path(__file__).parent
SESSIONS = Path(tempfile.gettempdir()) / "pdf_dewatermark_sessions"
SESSION_TTL = 6 * 3600
MAX_UPLOAD = 300 * 1024 * 1024
PREVIEW_DPI = 96
CROP_DPI = 130
RASTER_DPI = 200
SCAN_DPI = 32  # thumbnails for the whole-document sweep
INFER_FLOOR = 0.60  # below this, a repeated XObject is not even offered

@asynccontextmanager
async def lifespan(_app: FastAPI):
    """Keep client hang-ups out of the console.

    Closing a tab or hitting reload mid-request resets the socket. On Windows the
    proactor transport then tries to shut down a socket that is already gone and
    dumps a ConnectionResetError traceback from an asyncio callback. The server is
    fine -- the request simply has nobody left to answer -- but a traceback makes
    a working tool look broken.
    """
    loop = asyncio.get_running_loop()
    base = loop.get_exception_handler()

    def handler(active_loop, context):
        exc = context.get("exception")
        if isinstance(exc, (ConnectionResetError, ConnectionAbortedError, BrokenPipeError)):
            return
        if base is not None:
            base(active_loop, context)
        else:
            active_loop.default_exception_handler(context)

    loop.set_exception_handler(handler)
    yield


app = FastAPI(title="Excise", lifespan=lifespan)
STATE: dict[str, dict[str, Any]] = {}


# ---------------------------------------------------------------------------
# session plumbing
# ---------------------------------------------------------------------------


def _sweep() -> None:
    if not SESSIONS.exists():
        return
    cutoff = time.time() - SESSION_TTL
    for d in SESSIONS.iterdir():
        try:
            if d.is_dir() and d.stat().st_mtime < cutoff:
                shutil.rmtree(d, ignore_errors=True)
                STATE.pop(d.name, None)
        except OSError:
            pass


def _session(token: str) -> dict[str, Any]:
    if token not in STATE or not str(token).isalnum():
        raise HTTPException(404, "Session expired. Upload the PDF again.")
    return STATE[token]


# ---------------------------------------------------------------------------
# rendering helpers
# ---------------------------------------------------------------------------


def _render(page: fitz.Page, dpi: int) -> np.ndarray:
    pix = page.get_pixmap(dpi=dpi, alpha=False)
    arr = np.frombuffer(pix.samples, np.uint8).reshape(pix.height, pix.width, pix.n)
    return arr[:, :, :3].copy()  # RGB


def _jpg_b64(rgb: np.ndarray, quality: int = 68) -> str:
    """Thumbnails go out as JPEG. A sweep of a long document is thousands of these
    held in the browser at once, and PNG makes that roughly eight times heavier.
    Compression artefacts are irrelevant here -- the change figure is measured on
    the raw render, before encoding."""
    ok, buf = cv2.imencode(".jpg", rgb[:, :, ::-1], [int(cv2.IMWRITE_JPEG_QUALITY), quality])
    if not ok:
        return ""
    return "data:image/jpeg;base64," + base64.b64encode(buf.tobytes()).decode()


def _png_b64(rgb: np.ndarray) -> str:
    ok, buf = cv2.imencode(".png", rgb[:, :, ::-1])
    if not ok:
        return ""
    return "data:image/png;base64," + base64.b64encode(buf.tobytes()).decode()


def _apply(doc: fitz.Document, sel: dict, pages: list[int] | None = None) -> dict:
    return pw.clean_vector(
        doc,
        drop_names=set(),
        drop_fingerprints=set(sel["drop"]),
        strip_tagged=sel["tagged"],
        strip_annots=sel["annots"],
        pages=pages,
        text_targets=sel.get("text"),
    )


def _diff_bbox(a: np.ndarray, b: np.ndarray, tol: int = 8):
    mask = np.abs(a.astype(np.int16) - b.astype(np.int16)).max(2) > tol
    if not mask.any():
        return None, mask
    ys, xs = np.nonzero(mask)
    return (int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max())), mask


def _exhibit(path: Path, sel: dict, page_index: int) -> dict:
    """Trial-remove one candidate on one page and return before / after / what-leaves."""
    before_doc = fitz.open(path)
    after_doc = fitz.open(path)
    _apply(after_doc, sel, pages=[page_index])
    before = _render(before_doc[page_index], CROP_DPI)
    after = _render(after_doc[page_index], CROP_DPI)
    before_doc.close()
    after_doc.close()

    bbox, mask = _diff_bbox(before, after)
    h, w = before.shape[:2]
    if bbox is None:
        return {"empty": True, "affected": 0.0, "blanks_page": False}

    # If the page renders blank once this candidate is gone, the candidate IS the
    # page -- a flattened scan drawn as one image -- not a watermark on it.
    blanks_page = bool((after > 246).all())

    pad = 10
    x0, y0, x1, y1 = bbox
    x0, y0 = max(0, x0 - pad), max(0, y0 - pad)
    x1, y1 = min(w - 1, x1 + pad), min(h - 1, y1 + pad)

    crop_before = before[y0 : y1 + 1, x0 : x1 + 1]
    crop_after = after[y0 : y1 + 1, x0 : x1 + 1]

    # "what leaves": the removed pixels only, everything else knocked out to white
    leaves = np.full_like(crop_before, 255)
    m = mask[y0 : y1 + 1, x0 : x1 + 1]
    leaves[m] = crop_before[m]

    # A mark made of small scattered pieces spans nearly the whole page, so the
    # crop above is page-sized with almost nothing in it -- useless as a small
    # preview. Dilate to merge each mark into one blob, take the biggest, and
    # zoom to it. Dilation is wide enough to join the letters of a word but not
    # to join marks sitting at opposite ends of the page.
    detail = None
    reach = max(3, int(0.02 * w))
    merged = cv2.dilate(mask.astype(np.uint8), np.ones((reach, reach), np.uint8))
    count, labels, cstats, _ = cv2.connectedComponentsWithStats(merged, 8)
    if count > 1:
        big = 1 + int(np.argmax(cstats[1:, cv2.CC_STAT_AREA]))
        bx, by = int(cstats[big, cv2.CC_STAT_LEFT]), int(cstats[big, cv2.CC_STAT_TOP])
        bw, bh = int(cstats[big, cv2.CC_STAT_WIDTH]), int(cstats[big, cv2.CC_STAT_HEIGHT])
        cx, cy = bx + bw // 2, by + bh // 2
        half_w, half_h = max(bw // 2 + 8, 55), max(bh // 2 + 8, 36)
        dx0, dy0 = max(0, cx - half_w), max(0, cy - half_h)
        dx1, dy1 = min(w - 1, cx + half_w), min(h - 1, cy + half_h)
        piece = np.full_like(before[dy0 : dy1 + 1, dx0 : dx1 + 1], 255)
        pm = mask[dy0 : dy1 + 1, dx0 : dx1 + 1]
        piece[pm] = before[dy0 : dy1 + 1, dx0 : dx1 + 1][pm]
        detail = _png_b64(piece)

    return {
        "empty": False,
        "blanks_page": blanks_page,
        "before": _png_b64(crop_before),
        "after": _png_b64(crop_after),
        "leaves": _png_b64(leaves),
        "detail": detail or _png_b64(leaves),
        "affected": round(100.0 * mask.mean(), 2),
        "bbox_pt": [round(v * 72.0 / CROP_DPI, 1) for v in (x0, y0, x1, y1)],
    }


def _tone_profile(src: Path, page_index: int = 0) -> dict:
    """Measure the grey tones on a page so the pixel sliders are not guesswork.

    A levels curve can only separate two tones that sit in different bands. This
    finds the distinct mid-grey clusters and says whether a white point exists
    that clears one without destroying the other.
    """
    doc = fitz.open(src)
    page_index = max(0, min(page_index, doc.page_count - 1))
    page = doc[page_index]
    rgb = None
    # Prefer the embedded image itself. Re-rendering resamples it, and resampling
    # shifts the very tones being measured.
    for im in page.get_images(full=True):
        try:
            rects = page.get_image_rects(im[0])
            if rects and rects[0].width >= page.rect.width * 0.9:
                pm = fitz.Pixmap(doc, im[0])
                # convert rather than slice: a CMYK image also reports n >= 3, and
                # taking its first three channels yields an inverted histogram and
                # a destructive white-point suggestion
                if pm.colorspace is None or pm.colorspace.name != "DeviceRGB":
                    pm = fitz.Pixmap(fitz.csRGB, pm)
                rgb = np.frombuffer(pm.samples, np.uint8).reshape(pm.height, pm.width, pm.n)[:, :, :3].copy()
                break
        except Exception:
            pass
    if rgb is None:
        rgb = _render(page, 150)
    doc.close()

    grey = cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY)
    total = grey.size
    hist = np.bincount(grey.ravel(), minlength=256).astype(np.float64)

    chroma = float((rgb.astype(np.int16).max(2) - rgb.astype(np.int16).min(2))[
        (grey > 150) & (grey < 246)].mean()) if ((grey > 150) & (grey < 246)).any() else 0.0

    bands = [
        {"label": "ink", "lo": 0, "hi": 60, "pct": round(100 * hist[0:60].sum() / total, 2)},
        {"label": "midtones", "lo": 60, "hi": 150, "pct": round(100 * hist[60:150].sum() / total, 2)},
        {"label": "light grey", "lo": 150, "hi": 210, "pct": round(100 * hist[150:210].sum() / total, 2)},
        {"label": "very light", "lo": 210, "hi": 247, "pct": round(100 * hist[210:247].sum() / total, 2)},
        {"label": "paper", "lo": 247, "hi": 256, "pct": round(100 * hist[247:256].sum() / total, 2)},
    ]

    # Split the mid greys by SHAPE, not by histogram peak. Watermark strokes and a
    # grey banner can share a tonal band and show one merged peak; as connected
    # components they separate cleanly -- many small strokes vs a few wide fills.
    mask = ((grey > 150) & (grey < 246)).astype(np.uint8)
    count, labels, stats, _ = cv2.connectedComponentsWithStats(mask, 8)
    areas = stats[:, cv2.CC_STAT_AREA].astype(np.float64)
    sums = np.bincount(labels.ravel(), weights=grey.ravel().astype(np.float64), minlength=count)
    means = sums / np.maximum(areas, 1)

    # min area filters out antialiasing crumbs, which otherwise drag both means together
    page_w = grey.shape[1]
    min_area = max(80, int(0.00005 * grey.size))
    strokes = [i for i in range(1, count) if areas[i] >= min_area and stats[i, cv2.CC_STAT_WIDTH] <= page_w * 0.25]
    fills = [i for i in range(1, count) if areas[i] >= min_area and stats[i, cv2.CC_STAT_WIDTH] > page_w * 0.25]

    def _centre(idx: list[int]) -> int | None:
        """Median blob tone. A median beats a histogram peak here: these populations
        are only a few hundred blobs, too sparse for argmax to be stable."""
        if not idx:
            return None
        return int(round(float(np.median([means[i] for i in idx]))))

    wm_grey, content_grey = _centre(strokes), _centre(fills)
    populations = []
    if wm_grey is not None:
        populations.append({"label": "repeated light strokes", "hint": "watermark-like",
                            "grey": wm_grey, "blobs": len(strokes)})
    if content_grey is not None:
        populations.append({"label": "wide grey fills", "hint": "banners, rules, shading",
                            "grey": content_grey, "blobs": len(fills)})

    recommend, overlap = None, False
    if wm_grey is not None:
        if content_grey is not None and (wm_grey - content_grey) < 26:
            # Tones overlap: no white point clears one without eating the other.
            # Err high -- leaving faint watermark beats destroying real content.
            overlap = True
            recommend = min(246, wm_grey + 4)
        else:
            recommend = max(60, wm_grey - 8)
    return {
        "page": page_index,
        "bands": bands,
        "populations": populations,
        "watermark_grey": wm_grey,
        "content_grey": content_grey,
        "recommend_white": recommend,
        "overlap": overlap,
        "chroma": round(chroma, 2),
        "neutral": chroma < 8,
    }


def _covered_by_tagged(path: Path, fingerprint: str, page_index: int) -> bool:
    """True if this XObject's draw already sits inside a tagged watermark block.

    When it does, ticking both candidates removes the same pixels once, and the
    XObject would report zero draws removed -- which reads like a failure. Better
    to say so up front.
    """
    doc = fitz.open(path)
    try:
        page = doc[page_index]
        _, data = pw._page_content(doc, page)
        names = pw.names_for_fingerprints(doc, page, {fingerprint}, {})
    finally:
        doc.close()
    tagged = pw.find_marked_blocks(data, pw.is_watermark_tag)
    draws = pw.find_xobject_draws(data, names)
    if not tagged or not draws:
        return False
    return all(any(t0 <= d0 and d1 <= t1 for t0, t1 in tagged) for d0, d1 in draws)


def _text_check(src: Path, out: Path, samples: int = 8) -> tuple[bool, int]:
    """Compare extracted text between the two files on disk.

    Both documents must be opened fresh. Reading get_text() off the in-memory
    document after save(garbage=4) returns stale text and reports a false
    mismatch on output that is in fact identical.
    """
    a, b = fitz.open(src), fitz.open(out)
    try:
        n = min(a.page_count, b.page_count)
        if n == 0:
            return True, 0
        step = max(1, n // samples)
        pages = list(range(0, n, step))[:samples]
        for i in pages:
            if a[i].get_text() != b[i].get_text():
                return False, len(pages)
        return True, len(pages)
    finally:
        a.close()
        b.close()


def _snippet(path: Path, sel: dict, page_index: int) -> str:
    """The actual content-stream bytes this candidate would cut."""
    doc = fitz.open(path)
    try:
        page = doc[page_index]
        _, data = pw._page_content(doc, page)
        spans: list[tuple[int, int]] = []
        if sel["tagged"]:
            spans += pw.find_marked_blocks(data, pw.is_watermark_tag)
        if sel["drop"]:
            # sel["drop"] holds fingerprints; the content stream names objects, so
            # resolve to this page's names first or nothing ever matches
            names = pw.names_for_fingerprints(doc, page, set(sel["drop"]), {})
            spans += pw.find_xobject_draws(data, names)
        for target in sel.get("text") or []:
            spans += pw.find_text_blocks(data, tuple(target["colour"]), target.get("rotation"))
        if not spans:
            return ""
        s, e = sorted(spans)[0]
        text = data[s:e].decode("latin-1", "replace").strip()
        return text if len(text) <= 600 else text[:600] + "\n…"
    finally:
        doc.close()


# ---------------------------------------------------------------------------
# candidate assembly
# ---------------------------------------------------------------------------


def build_candidates(path: Path, report: dict) -> list[dict]:
    sampled = max(1, report["sampled"])
    total = report["page_count"]
    out: list[dict] = []

    if report["tagged_watermark_pages"]:
        share = len(report["tagged_watermark_pages"]) / sampled
        out.append(
            {
                "id": "tagged",
                "kind": "tagged",
                "title": "Tagged watermark artifact",
                "object": "/Artifact <</Subtype/Watermark/Type/Pagination>>",
                "confidence": "declared",
                "signal": ("The producer marked this block as a watermark artifact (PDF 32000 §14.8.2.2)"
                           + ("" if sampled >= total else f" — checked on {sampled} pages sampled from {total}")),
                "note": "Tagged as decoration, not content — safe to cut.",
                "pages": round(share * total),
                "coverage": round(share, 4),
                "sample_page": report["tagged_watermark_pages"][0],
                "recommended": True,
            }
        )

    for fp, meta in report["xobjects"].items():
        name = meta["name"]
        if meta.get("bytes") == 0:
            continue  # draws nothing
        private = (meta.get("private") or "").lower()
        oc = (meta.get("oc_name") or "").lower()
        if private == "watermark":
            conf, signal, note = (
                "declared",
                "Flagged /PieceInfo << /ADBE_CompoundType << /Private /Watermark",
                "The editing tool that stamped this file labelled the object a watermark.",
            )
        elif any(w in oc for w in pw.WATERMARK_WORDS):
            conf, signal, note = (
                "declared",
                f"On the optional-content layer {meta['oc_name']!r}",
                "Sits on a layer whose name says watermark.",
            )
        elif meta["coverage"] >= INFER_FLOOR:
            conf, signal, note = (
                "inferred",
                # only say "sampled" when pages were actually skipped
                (f"Drawn on all {total} pages" if sampled >= total else
                 f"Drawn on {meta['coverage']:.0%} of {sampled} pages sampled from {total}"),
                "Nothing in the file says this is a watermark — repetition is the only evidence. "
                "Page numbers and letterheads repeat too. Check the crop.",
            )
        else:
            continue

        sample_page = meta.get("first_page", 0)
        covered = bool(report["tagged_watermark_pages"]) and _covered_by_tagged(path, fp, sample_page)
        if covered:
            note = ("Already inside the tagged artifact above, so that candidate removes it. "
                    "Tick this only if you leave the tagged one unticked.")

        aliases = meta.get("aliases") or [name]
        out.append(
            {
                # identity is the fingerprint: the same object is called different
                # things on different pages, and a name is reused for other objects
                "id": f"xobject:{fp}",
                "kind": "xobject",
                "name": name,
                "fingerprint": fp,
                # say what it actually is; "Form object" on an image is just wrong
                "title": ("Image" if (meta.get("subtype") or "").lower() == "image"
                          else "Form object") + f" /{name}",
                "object": (f"/{name} — xref {meta['xref']}, {meta['bytes']} bytes, bbox {meta['rect']}"
                           + (f", also called /{'/'.join(aliases[1:4])}" if len(aliases) > 1 else "")),
                "confidence": conf,
                "signal": signal,
                "note": note,
                "covered": covered,
                "pages": round(meta["coverage"] * total),
                "coverage": round(meta["coverage"], 4),
                "sample_page": sample_page,
                "recommended": conf == "declared" and not covered,
            }
        )

    if report["annots"]:
        removable = {k: v for k, v in report["annots"].items() if k in ("Watermark", "Stamp")}
        if removable:
            # count and sample only the subtypes actually removed -- Links and Popups
            # are annotations too and are never touched
            first = min(report.get("annot_pages", {}).get(k, 0) for k in removable)
            out.append(
                {
                    "id": "annots",
                    "kind": "annots",
                    "title": "Watermark and stamp annotations",
                    "object": ", ".join(f"{v}× {k}" for k, v in removable.items()),
                    "confidence": "declared",
                    "signal": "Annotation subtype is /Watermark or /Stamp",
                    "note": "Annotations sit above the page content and carry their own subtype.",
                    "pages": sum(removable.values()),
                    "coverage": 0,
                    "sample_page": first,
                    "recommended": True,
                }
            )

    # Two different objects can carry the same resource name. They are separate
    # candidates now, so give the labels something to tell them apart by.
    seen: Counter = Counter(c["title"] for c in out)
    for c in out:
        if seen[c["title"]] > 1 and c.get("kind") == "xobject":
            rect = (report["xobjects"].get(c["fingerprint"]) or {}).get("rect")
            if rect:
                c["title"] += f" · {round(rect[2] - rect[0])}×{round(rect[3] - rect[1])}"
            else:
                c["title"] += f" · {c['fingerprint'][:6]}"

    order = {"declared": 0, "inferred": 1}
    out.sort(key=lambda c: (order[c["confidence"]], -c["coverage"]))
    return out


def selection(ids: list[str], candidates: list[dict]) -> dict:
    chosen = [c for c in candidates if c["id"] in ids]
    return {
        "tagged": any(c["kind"] == "tagged" for c in chosen),
        "annots": any(c["kind"] == "annots" for c in chosen),
        "drop": [c["fingerprint"] for c in chosen
                 if c["kind"] == "xobject" and c.get("fingerprint")],
        "text": [{"colour": c["colour"], "rotation": c["rotation"]}
                 for c in chosen if c["kind"] == "text"],
    }


# ---------------------------------------------------------------------------
# routes
# ---------------------------------------------------------------------------


@app.get("/", response_class=HTMLResponse)
def index() -> str:
    return (HERE / "static" / "index.html").read_text(encoding="utf-8")


# The page is read from disk on every request, but the Python only loads at
# startup. Edit both and a stale server serves a new UI that calls endpoints it
# does not have -- which surfaces as an unexplained request failure. Compare the
# source files on disk against what this process actually loaded.
_SOURCES = {p: (HERE / p).stat().st_mtime for p in ("app.py", "pdf_dewatermark.py", "dewatermark.py")
            if (HERE / p).exists()}


@app.get("/api/version")
def api_version():
    changed = []
    for name, loaded_at in _SOURCES.items():
        try:
            if (HERE / name).stat().st_mtime > loaded_at + 1:
                changed.append(name)
        except OSError:
            pass
    return {"stale": bool(changed), "changed": changed}


@app.post("/api/analyze")
async def api_analyze(file: UploadFile = File(...)):
    _sweep()
    if not (file.filename or "").lower().endswith(".pdf"):
        raise HTTPException(400, "That is not a PDF.")
    # read in chunks and stop at the limit: reading the whole body first would mean
    # the cap never actually bounds the allocation it exists to bound
    chunks: list[bytes] = []
    read = 0
    while True:
        chunk = await file.read(1 << 20)
        if not chunk:
            break
        read += len(chunk)
        if read > MAX_UPLOAD:
            raise HTTPException(413, f"PDF is larger than {MAX_UPLOAD // 1024 // 1024} MB.")
        chunks.append(chunk)
    blob = b"".join(chunks)

    token = uuid.uuid4().hex
    sdir = SESSIONS / token
    sdir.mkdir(parents=True, exist_ok=True)
    src = sdir / "input.pdf"
    src.write_bytes(blob)

    doc = fitz.open(src)
    if doc.is_encrypted and not doc.authenticate(""):
        shutil.rmtree(sdir, ignore_errors=True)
        raise HTTPException(400, "This PDF is password protected. Decrypt it first.")
    if doc.page_count < 1:
        doc.close()
        shutil.rmtree(sdir, ignore_errors=True)
        raise HTTPException(400, "This PDF has no pages.")

    sample = min(doc.page_count, 60) if doc.page_count > 120 else None
    report = pw.analyze(doc, sample=sample)
    doc.close()

    candidates = build_candidates(src, report)
    for c in candidates:
        sel = selection([c["id"]], candidates)
        try:
            c["exhibit"] = _exhibit(src, sel, c["sample_page"])
            c["snippet"] = _snippet(src, sel, c["sample_page"])
        except Exception as exc:  # a bad candidate must not sink the whole review
            c["exhibit"] = {"empty": True, "affected": 0.0, "error": str(exc)}
            c["snippet"] = ""

    # A candidate whose removal leaves a blank page is the page itself. Offering it
    # as a watermark invites deleting the document.
    # Only an inferred candidate can be the page itself. A declared watermark on an
    # otherwise-empty page also blanks it, and dropping that would make the one
    # thing the file explicitly labels a watermark impossible to remove.
    page_is_image = any(c["exhibit"].get("blanks_page") and c["confidence"] != "declared"
                        for c in candidates)
    candidates = [c for c in candidates
                  if not (c["exhibit"].get("blanks_page") and c["confidence"] != "declared")]

    STATE[token] = {"dir": sdir, "src": src, "name": file.filename, "candidates": candidates,
                    "report": report, "size": len(blob)}

    return JSONResponse(
        {
            "token": token,
            "filename": file.filename,
            "size": len(blob),
            "pages": report["page_count"],
            "sampled": report["sampled"],
            "text_pages": report["text_pages"],
            "scanned": report["scanned"],
            "page_is_image": page_is_image,
            "raster_defaults": dw.DEFAULTS,
            "tone": _tone_profile(src) if (page_is_image or report["scanned"] or not candidates) else None,
            "candidates": candidates,
            "sample_page": candidates[0]["sample_page"] if candidates else 0,
        }
    )


class ScanReq(BaseModel):
    token: str
    ids: list[str] = []
    start: int = 0
    count: int = 24
    step: int = Field(1, ge=1, le=1000)
    raster: bool = False
    sat_thresh: int = 18
    val_thresh: int = 110
    white_point: int = 205
    black_point: int = 55
    despeckle: int = 0


@app.post("/api/scan")
def api_scan(req: ScanReq):
    """Thumbnail plus change figure for a batch of pages.

    Checking a long document one page at a time is the slow way to gain
    confidence. What matters is which pages behave differently from the rest, so
    this returns a cheap thumbnail and the share of pixels that changed, and the
    caller flags the odd ones out.
    """
    st = _session(req.token)
    src: Path = st["src"]
    before_doc = fitz.open(src)
    total = before_doc.page_count
    pages = [p for p in range(req.start, min(req.start + req.count * req.step, total), req.step)]
    if not pages:
        before_doc.close()
        return {"results": [], "total": total, "done": True}

    after_doc = None
    if not req.raster:
        after_doc = fitz.open(src)
        _apply(after_doc, selection(req.ids, st["candidates"]), pages=pages)

    params = {"sat_thresh": req.sat_thresh, "val_thresh": req.val_thresh,
              "white_point": req.white_point, "black_point": req.black_point,
              "despeckle": req.despeckle}

    results = []
    for i in pages:
        before = _render(before_doc[i], SCAN_DPI)
        if req.raster:
            cleaned = dw.remove_watermark(np.ascontiguousarray(before[:, :, ::-1]), **params)
            after = cv2.cvtColor(cleaned, cv2.COLOR_GRAY2RGB)
        else:
            after = _render(after_doc[i], SCAN_DPI)
        if after.shape != before.shape:
            after = cv2.resize(after, (before.shape[1], before.shape[0]))
        changed = float((np.abs(before.astype(np.int16) - after.astype(np.int16)).max(2) > 8).mean())
        results.append({"page": i, "changed_pct": round(100 * changed, 2), "thumb": _jpg_b64(after)})

    before_doc.close()
    if after_doc is not None:
        after_doc.close()
    last = pages[-1]
    return {"results": results, "total": total, "done": last + req.step >= total}


class PickReq(BaseModel):
    token: str
    page: int = 0
    x: float = 0.5  # 0..1 across the rendered page
    y: float = 0.5


def _text_targets_at(page: fitz.Page, pt: fitz.Point) -> list[dict]:
    """Text spans under the click, described by the signature used to remove them."""
    out: list[dict] = []
    try:
        data = page.get_text("dict")
    except Exception:
        return out
    for block in data.get("blocks", []):
        for line in block.get("lines", []):
            direction = line.get("dir", (1.0, 0.0))
            for span in line.get("spans", []):
                if not fitz.Rect(span["bbox"]).contains(pt):
                    continue
                c = int(span.get("color", 0))
                colour = (((c >> 16) & 255) / 255.0, ((c >> 8) & 255) / 255.0, (c & 255) / 255.0)
                # get_text() reports direction with y pointing down; content-stream
                # matrices have y pointing up, so the angle's sign flips between them
                rot = math.atan2(-direction[1], direction[0])
                out.append({
                    "colour": [round(v, 4) for v in colour],
                    "rotation": round(rot, 4),
                    "text": (span.get("text") or "").strip()[:60],
                    "size": round(float(span.get("size", 0)), 1),
                    "font": span.get("font", ""),
                })
    return out


@app.post("/api/pick")
def api_pick(req: PickReq):
    """Identify what draws at a point, so anything the signals missed can be named."""
    st = _session(req.token)
    src: Path = st["src"]
    doc = fitz.open(src)
    page_index = max(0, min(req.page, doc.page_count - 1))
    page = doc[page_index]
    pt = fitz.Point(req.x * page.rect.width, req.y * page.rect.height)

    found: list[dict] = []

    for t in _text_targets_at(page, pt):
        grey = sum(t["colour"]) / 3.0
        found.append({
            "id": f"text:{t['colour'][0]:.3f},{t['colour'][1]:.3f},{t['colour'][2]:.3f},{t['rotation']:.3f}",
            "kind": "text",
            "title": f"Text “{t['text']}”" if t["text"] else "Text at this point",
            "object": f"{t['font']} {t['size']}pt, fill rgb({', '.join(str(round(v,2)) for v in t['colour'])})"
                      f", {round(math.degrees(t['rotation']))}°",
            "confidence": "picked",
            "signal": "You pointed at it",
            "note": ("Every text block painted in this colour at this angle will go. "
                     + ("This is light grey and set on a slant, which is what a text watermark looks like."
                        if grey > 0.55 and abs(t["rotation"]) > 0.05
                        else "Check the crop — this colour and angle may also be used by real content.")),
            "colour": t["colour"],
            "rotation": t["rotation"],
            "sample_page": page_index,
            "recommended": False,
            "pages": 0,
            "coverage": 0,
        })

    # page_drawables() already filters out images reached through a form -- their
    # Do lives in the form's stream, not this page's, so removal would find nothing
    fp_cache: dict[int, str] = {}
    for name, xref, rect in pw.page_drawables(doc, page):
        if rect is None:
            try:
                rect = page.get_xobject_rects(xref)[0] if hasattr(page, "get_xobject_rects") else None
            except Exception:
                rect = None
        if rect is None or not fitz.Rect(rect).contains(pt):
            continue
        fp = pw.object_fingerprint(doc, xref, fp_cache)
        if any(f["id"] == f"xobject:{fp}" for f in found):
            continue
        found.append({
            "id": f"xobject:{fp}", "kind": "xobject", "name": name, "fingerprint": fp,
            "title": f"Object /{name}", "object": f"xref {xref}",
            "confidence": "picked", "signal": "You pointed at it",
            "note": "Every page that draws this same object will lose it.",
            "sample_page": page_index, "recommended": False, "pages": 0, "coverage": 0,
        })
    doc.close()

    # existing candidates whose removal actually changes pixels under the click
    stored = {c["id"]: c for c in st["candidates"]}
    known = set(stored)
    for c in st["candidates"]:
        bbox = (c.get("exhibit") or {}).get("bbox_pt")
        if bbox and bbox[0] <= pt.x <= bbox[2] and bbox[1] <= pt.y <= bbox[3]:
            if c["id"] not in {f["id"] for f in found}:
                found.append({**c, "signal": c["signal"] + " — and it covers this point"})

    # a point may land on something already listed; reuse that entry so it keeps
    # its exhibit rather than coming back as a bare duplicate
    found = [dict(stored[c["id"]]) if c["id"] in known else c for c in found]

    for c in found:
        if c["id"] in known:
            continue
        sel = selection([c["id"]], st["candidates"] + found)
        try:
            c["exhibit"] = _exhibit(src, sel, c["sample_page"])
            c["snippet"] = _snippet(src, sel, c["sample_page"])
            c["pages"] = _count_pages(src, sel)
        except Exception as exc:
            c["exhibit"] = {"empty": True, "affected": 0.0, "error": str(exc)}
            c["snippet"] = ""

    fresh = [c for c in found if c["id"] not in known]
    st["candidates"] = st["candidates"] + fresh
    return {"found": found, "added": [c["id"] for c in fresh]}


def _count_pages(src: Path, sel: dict, limit: int = 40) -> int:
    """How many pages this selection actually changes, extrapolated from a sample."""
    doc = fitz.open(src)
    total = doc.page_count
    step = max(1, total // limit)
    pages = list(range(0, total, step))[:limit]
    doc.close()
    probe = fitz.open(src)
    stats = pw.clean_vector(
        probe, drop_names=set(), drop_fingerprints=set(sel["drop"]), strip_tagged=sel["tagged"],
        strip_annots=False, pages=pages, text_targets=sel.get("text"),
    )
    probe.close()
    hit = stats.get("pages_changed", 0)
    return int(round(total * hit / max(1, len(pages))))


class RasterReq(BaseModel):
    token: str
    page: int = 0
    sat_thresh: int = 18
    val_thresh: int = 110
    white_point: int = 205
    black_point: int = 55
    despeckle: int = 0


def _raster_params(req: "RasterReq") -> dict:
    return {
        "sat_thresh": req.sat_thresh,
        "val_thresh": req.val_thresh,
        "white_point": req.white_point,
        "black_point": req.black_point,
        "despeckle": req.despeckle,
    }


@app.post("/api/raster_preview")
def api_raster_preview(req: RasterReq):
    """Pixel pipeline on one page, for tuning by eye before committing."""
    st = _session(req.token)
    doc = fitz.open(st["src"])
    page_index = max(0, min(req.page, doc.page_count - 1))
    rgb = _render(doc[page_index], PREVIEW_DPI)
    doc.close()
    cleaned = dw.remove_watermark(np.ascontiguousarray(rgb[:, :, ::-1]), **_raster_params(req))
    return {
        "page": page_index,
        "pages": st["report"]["page_count"],
        "before": _png_b64(rgb),
        "after": _png_b64(cv2.cvtColor(cleaned, cv2.COLOR_GRAY2RGB)),
        "ink_pct": round(100.0 * (cleaned < 128).mean(), 2),
        "white_pct": round(100.0 * (cleaned == 255).mean(), 2),
    }


@app.post("/api/clean_raster")
def api_clean_raster(req: RasterReq):
    """Render every page, clean the bitmaps, rebuild. The text layer does not survive."""
    st = _session(req.token)
    src: Path = st["src"]
    doc = fitz.open(src)
    dpi = pw.native_dpi(doc, default=RASTER_DPI)
    out_doc = pw.clean_raster(doc, dpi=dpi, **_raster_params(req))
    pages = doc.page_count
    doc.close()
    out = st["dir"] / (Path(st["name"]).stem + "_pixels.pdf")
    out_doc.save(str(out), garbage=4, deflate=True)
    out_doc.close()
    st["out"] = out
    return {
        "download": f"/api/download/{req.token}",
        "filename": out.name,
        "pages_changed": pages,
        "tagged_blocks": 0,
        "xobject_draws": 0,
        "annots": 0,
        "size_before": st["size"],
        "size_after": out.stat().st_size,
        "text_intact": False,
        "text_checked": 0,
        "raster": True,
        "dpi": dpi,
    }


class PreviewReq(BaseModel):
    token: str
    ids: list[str] = []
    page: int = 0


@app.post("/api/preview")
def api_preview(req: PreviewReq):
    st = _session(req.token)
    src: Path = st["src"]
    doc = fitz.open(src)
    page_index = max(0, min(req.page, doc.page_count - 1))
    before = _render(doc[page_index], PREVIEW_DPI)
    doc.close()

    after_doc = fitz.open(src)
    _apply(after_doc, selection(req.ids, st["candidates"]), pages=[page_index])
    after = _render(after_doc[page_index], PREVIEW_DPI)
    after_doc.close()

    _, mask = _diff_bbox(before, after)
    return {
        "page": page_index,
        "pages": st["report"]["page_count"],
        "before": _png_b64(before),
        "after": _png_b64(after),
        "changed_pct": round(100.0 * mask.mean(), 2),
    }


class CleanReq(BaseModel):
    token: str
    ids: list[str] = []
    pages: list[int] | None = None  # None means every page


@app.post("/api/clean")
def api_clean(req: CleanReq):
    st = _session(req.token)
    if not req.ids:
        raise HTTPException(400, "Select at least one thing to remove.")
    src: Path = st["src"]
    sel = selection(req.ids, st["candidates"])

    doc = fitz.open(src)
    scope = None
    if req.pages is not None:
        scope = sorted({p for p in req.pages if 0 <= p < doc.page_count})
        if not scope:
            doc.close()
            raise HTTPException(400, "No pages selected. Include at least one page.")
    stats = _apply(doc, sel, pages=scope)
    out = st["dir"] / (Path(st["name"]).stem + "_clean.pdf")
    doc.save(str(out), garbage=4, deflate=True)
    doc.close()

    text_intact, text_checked = _text_check(src, out)
    st["out"] = out
    return {
        "download": f"/api/download/{req.token}",
        "filename": out.name,
        "pages_changed": stats.get("pages_changed", 0),
        "tagged_blocks": stats.get("tagged_blocks", 0),
        "xobject_draws": stats.get("xobject_draws", 0),
        "annots": stats.get("annots", 0),
        "size_before": st["size"],
        "size_after": out.stat().st_size,
        "text_intact": text_intact,
        "text_checked": text_checked,
        # removing a text watermark changes the text layer on purpose, so a
        # difference here is the expected outcome rather than a warning sign
        "text_expected_change": bool(sel.get("text")),
        "text_blocks": stats.get("text_blocks", 0),
        "scoped_pages": len(scope) if scope is not None else None,
        "skipped_shared": stats.get("skipped_shared", 0),
    }


@app.get("/api/download/{token}")
def api_download(token: str):
    st = _session(token)
    out = st.get("out")
    if not out or not Path(out).exists():
        raise HTTPException(404, "Nothing cleaned yet.")
    return FileResponse(str(out), media_type="application/pdf", filename=Path(out).name)


def _free_port(host: str, start: int, tries: int = 12) -> int | None:
    """First free port at or after `start`, so a stale server is not a dead end."""
    import socket

    for port in range(start, start + tries):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            # no SO_REUSEADDR: this is purely a "is anyone on this port" probe, and
            # the flag only widens what bind() will accept
            try:
                s.bind((host, port))
                return port
            except OSError:
                continue
    return None


if __name__ == "__main__":
    import argparse

    import uvicorn

    ap = argparse.ArgumentParser(description="Browser front end for pdf_dewatermark.py")
    ap.add_argument("--port", type=int, default=8000)
    ap.add_argument("--host", default="127.0.0.1")
    cli = ap.parse_args()

    port = _free_port(cli.host, cli.port)
    if port is None:
        print(f"Ports {cli.port}-{cli.port + 11} are all busy. Free one, or pass --port.")
        raise SystemExit(1)
    if port != cli.port:
        print(f"Port {cli.port} is in use - an older Excise is probably still running.")
        print(f"Using {port} instead. To reclaim {cli.port}:")
        print(f'  powershell "Get-NetTCPConnection -LocalPort {cli.port} -State Listen | '
              f'ForEach-Object {{ Stop-Process -Id $_.OwningProcess -Force }}"')

    # The selector loop has no proactor shutdown race, so the reset noise never
    # reaches the console in the first place. Nothing here needs the proactor.
    if sys.platform == "win32":
        with contextlib.suppress(AttributeError, DeprecationWarning):
            asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())

    SESSIONS.mkdir(parents=True, exist_ok=True)
    print(f"Excise - http://{cli.host}:{port}")
    print("Stop it with Ctrl+C.")
    try:
        uvicorn.run(app, host=cli.host, port=port, log_level="warning")
    except KeyboardInterrupt:
        pass
    print("Excise stopped.")
