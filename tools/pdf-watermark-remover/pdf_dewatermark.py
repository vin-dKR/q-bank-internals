#!/usr/bin/env python3
"""Remove watermarks from PDFs at the PDF-object level.

Two strategies, picked automatically:

  vector  Surgery on the page content streams. Deletes the operators that draw
          the watermark and nothing else. Text stays selectable, fonts, vectors
          and layout are untouched, file usually gets smaller. Lossless.

  raster  Render every page to a bitmap, run the chroma/levels pipeline from
          dewatermark.py, rebuild the PDF from the cleaned bitmaps. For scanned
          PDFs where the watermark is fused into the page image and there is no
          object to delete. Destroys the text layer -- last resort.

What vector mode can find:

  1. /Artifact <</Subtype/Watermark>> BDC ... EMC   marked-content blocks (the
     spec-compliant way to tag a watermark; Acrobat, PDFelement, Foxit use it)
  2. Form XObjects flagged /PieceInfo << /ADBE_CompoundType << /Private /Watermark
  3. Marked content bound to an optional-content group named like a watermark
  4. /Watermark and /Stamp annotations
  5. Any XObject drawn on >= --repeat-threshold of pages at one size (opt-in
     heuristic for watermarks that carry no tag at all)

Usage:
    python pdf_dewatermark.py inspect  in.pdf
    python pdf_dewatermark.py clean    in.pdf out.pdf
    python pdf_dewatermark.py clean    in.pdf out.pdf --drop Fm0 --repeat-threshold 0.9
    python pdf_dewatermark.py clean    in.pdf out.pdf --mode raster --dpi 200
"""

from __future__ import annotations

import argparse
import hashlib
import io
import math
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path

import fitz  # PyMuPDF

# ---------------------------------------------------------------------------
# Content stream lexer
#
# Content streams are PostScript-ish: operands first, then the operator. To cut
# out a drawing instruction safely we need real token boundaries -- a bare regex
# for "EMC" would happily match those three letters inside a string literal or
# inside the binary payload of an inline image.
# ---------------------------------------------------------------------------

_WS = b"\x00\t\n\x0c\r "
_DELIMS = b"()<>[]{}/%"


def _skip_literal_string(d: bytes, i: int) -> int:
    """d[i] == '('. Returns index just past the matching ')'."""
    n, depth, i = len(d), 1, i + 1
    while i < n:
        c = d[i]
        if c == 0x5C:  # backslash escape
            i += 2
            continue
        if c == 0x28:
            depth += 1
        elif c == 0x29:
            depth -= 1
            if depth == 0:
                return i + 1
        i += 1
    return n


def _skip_hex_string(d: bytes, i: int) -> int:
    j = d.find(b">", i + 1)
    return len(d) if j < 0 else j + 1


def _skip_dict(d: bytes, i: int) -> int:
    """d[i:i+2] == '<<'. Returns index just past the matching '>>'."""
    n, depth = len(d), 0
    while i < n:
        c = d[i]
        if c == 0x28:
            i = _skip_literal_string(d, i)
            continue
        if c == 0x3C:
            if d[i + 1 : i + 2] == b"<":
                depth += 1
                i += 2
                continue
            i = _skip_hex_string(d, i)
            continue
        if c == 0x3E and d[i + 1 : i + 2] == b">":
            depth -= 1
            i += 2
            if depth == 0:
                return i
            continue
        i += 1
    return n


def _skip_array(d: bytes, i: int) -> int:
    n, depth = len(d), 0
    while i < n:
        c = d[i]
        if c == 0x28:
            i = _skip_literal_string(d, i)
            continue
        if c == 0x3C:
            i = _skip_dict(d, i) if d[i + 1 : i + 2] == b"<" else _skip_hex_string(d, i)
            continue
        if c == 0x5B:
            depth += 1
        elif c == 0x5D:
            depth -= 1
            if depth == 0:
                return i + 1
        i += 1
    return n


def iter_operators(d: bytes):
    """Yield (operator, operand_start, operator_start, operator_end).

    operand_start is where this operator's operands begin, so d[operand_start:
    operator_start] is the full operand text -- that is how the property dict of
    a BDC or the /Name of a Do is recovered.
    """
    n, i, operand_start = len(d), 0, 0
    while i < n:
        c = d[i]
        if c in _WS:
            i += 1
            continue
        if c == 0x25:  # comment
            j = d.find(b"\n", i)
            i = n if j < 0 else j + 1
            continue
        if c == 0x28:
            i = _skip_literal_string(d, i)
            continue
        if c == 0x3C:
            i = _skip_dict(d, i) if d[i + 1 : i + 2] == b"<" else _skip_hex_string(d, i)
            continue
        if c == 0x5B:
            i = _skip_array(d, i)
            continue
        if c == 0x2F:  # /Name
            i += 1
            while i < n and d[i] not in _WS and d[i] not in _DELIMS:
                i += 1
            continue
        if c in b"]>})":  # stray closer
            i += 1
            continue
        j = i
        while j < n and d[j] not in _WS and d[j] not in _DELIMS:
            j += 1
        tok = d[i:j]
        if not tok:
            i += 1
            continue
        # numbers and keywords are operands, everything else bare is an operator
        if tok[:1].isdigit() or tok[:1] in b"+-." or tok in (b"true", b"false", b"null"):
            i = j
            continue
        yield tok, operand_start, i, j
        if tok == b"ID":  # inline image: binary payload runs until EI
            m = re.compile(rb"[\s>](EI)(?=[\s\]/<(]|$)").search(d, j)
            j = m.end() if m else n
        i = j
        operand_start = j


def _apply_deletions(d: bytes, spans: list[tuple[int, int]]) -> bytes:
    if not spans:
        return d
    spans = sorted(spans)
    out, cursor = bytearray(), 0
    for start, end in spans:
        if start < cursor:  # nested/overlapping, already covered
            continue
        out += d[cursor:start]
        out += b"\n"
        cursor = end
    out += d[cursor:]
    return bytes(out)


def find_marked_blocks(d: bytes, is_watermark) -> list[tuple[int, int]]:
    """Byte spans of whole BDC..EMC blocks whose property operand satisfies is_watermark."""
    stack: list[tuple[int, bool]] = []
    spans: list[tuple[int, int]] = []
    for tok, ostart, opstart, opend in iter_operators(d):
        if tok in (b"BDC", b"BMC"):
            stack.append((ostart, bool(is_watermark(d[ostart:opstart]))))
        elif tok == b"EMC":
            if not stack:
                continue
            start, flagged = stack.pop()
            if flagged and not any(f for _, f in stack):  # skip if an ancestor already covers it
                spans.append((start, opend))
    return spans


def find_xobject_draws(d: bytes, names: set[str]) -> list[tuple[int, int]]:
    """Byte spans of `/Name Do` for the given names, widened to the enclosing q..Q pair."""
    if not names:
        return []
    qstack: list[list] = []  # [start_pos, kill_flag]
    spans: list[tuple[int, int]] = []
    for tok, ostart, opstart, opend in iter_operators(d):
        if tok == b"q":
            qstack.append([ostart, False])
        elif tok == b"Q":
            if qstack:
                start, kill = qstack.pop()
                if kill:
                    spans.append((start, opend))
        elif tok == b"Do":
            operand = d[ostart:opstart].strip()
            if operand.startswith(b"/"):
                parts = operand[1:].split()
                name = parts[0].decode("latin-1", "replace") if parts else ""
                if name in names:
                    if qstack:
                        qstack[-1][1] = True
                    else:
                        spans.append((ostart, opend))
    return spans


def strip_marked_blocks(d: bytes, is_watermark) -> tuple[bytes, int]:
    spans = find_marked_blocks(d, is_watermark)
    return _apply_deletions(d, spans), len(spans)


def strip_xobject_draws(d: bytes, names: set[str]) -> tuple[bytes, int]:
    spans = find_xobject_draws(d, names)
    return _apply_deletions(d, spans), len(spans)


def _numbers(operands: bytes) -> list[float]:
    out: list[float] = []
    for tok in operands.replace(b"[", b" ").replace(b"]", b" ").split():
        try:
            out.append(float(tok))
        except ValueError:
            continue
    return out


def _cmyk_to_rgb(c: float, m: float, y: float, k: float) -> tuple[float, float, float]:
    return ((1 - c) * (1 - k), (1 - m) * (1 - k), (1 - y) * (1 - k))


def _matmul(m: list[float], n: list[float]) -> list[float]:
    """PDF matrix product [a b c d e f] x [a b c d e f]."""
    a1, b1, c1, d1, e1, f1 = m
    a2, b2, c2, d2, e2, f2 = n
    return [
        a1 * a2 + b1 * c2, a1 * b2 + b1 * d2,
        c1 * a2 + d1 * c2, c1 * b2 + d1 * d2,
        e1 * a2 + f1 * c2 + e2, e1 * b2 + f1 * d2 + f2,
    ]


def iter_text_blocks(d: bytes):
    """Yield (start, end, fill_rgb, text_matrix) for every BT..ET block.

    Carries the graphics state across q/Q so the fill colour in force at ET is the
    colour the text was actually painted in. That colour, plus the rotation baked
    into the text matrix, is a precise signature for a text watermark -- it picks
    out light grey text set on a slant without touching level black body text.
    """
    fill: tuple[float, float, float] = (0.0, 0.0, 0.0)
    ctm: list[float] = [1.0, 0.0, 0.0, 1.0, 0.0, 0.0]
    stack: list[tuple[tuple[float, float, float], list[float]]] = []
    bt_start: int | None = None
    tm: list[float] | None = None

    for tok, ostart, opstart, opend in iter_operators(d):
        ops = d[ostart:opstart]
        if tok == b"q":
            stack.append((fill, list(ctm)))
        elif tok == b"Q":
            if stack:
                fill, ctm = stack.pop()
        elif tok == b"cm":
            n = _numbers(ops)
            if len(n) >= 6:
                ctm = _matmul(n[:6], ctm)
        elif tok == b"g":
            n = _numbers(ops)
            if n:
                fill = (n[0], n[0], n[0])
        elif tok == b"rg":
            n = _numbers(ops)
            if len(n) >= 3:
                fill = (n[0], n[1], n[2])
        elif tok == b"k":
            n = _numbers(ops)
            if len(n) >= 4:
                fill = _cmyk_to_rgb(*n[:4])
        elif tok in (b"sc", b"scn"):
            n = [x for x in _numbers(ops)]
            if len(n) == 1:
                fill = (n[0], n[0], n[0])
            elif len(n) == 3:
                fill = (n[0], n[1], n[2])
            elif len(n) >= 4:
                fill = _cmyk_to_rgb(*n[:4])
        elif tok == b"BT":
            bt_start, tm = ostart, None
        elif tok == b"Tm":
            n = _numbers(ops)
            if len(n) >= 6:
                tm = n[:6]
        elif tok == b"ET":
            if bt_start is not None:
                # rotation can live in the text matrix or in the graphics matrix;
                # only their product describes how the glyphs actually sit
                effective = _matmul(tm, ctm) if tm else list(ctm)
                yield bt_start, opend, fill, effective
                bt_start, tm = None, None


def _angle_delta(a: float, b: float) -> float:
    d = abs(a - b) % math.pi
    return min(d, math.pi - d)


def find_text_blocks(
    d: bytes,
    colour: tuple[float, float, float],
    rotation: float | None = None,
    colour_tol: float = 0.08,
    rot_tol: float = 0.12,
) -> list[tuple[int, int]]:
    """Byte spans of text blocks painted in `colour` at `rotation` (radians)."""
    spans: list[tuple[int, int]] = []
    for start, end, fill, tm in iter_text_blocks(d):
        if max(abs(f - c) for f, c in zip(fill, colour)) > colour_tol:
            continue
        if rotation is not None:
            if tm is None:
                continue
            if _angle_delta(math.atan2(tm[1], tm[0]), rotation) > rot_tol:
                continue
        spans.append((start, end))
    return spans


def strip_text_blocks(d: bytes, colour, rotation=None, **kw) -> tuple[bytes, int]:
    spans = find_text_blocks(d, colour, rotation, **kw)
    return _apply_deletions(d, spans), len(spans)


def is_watermark_tag(props: bytes) -> bool:
    """A marked-content property list that declares the block a watermark artifact."""
    low = props.lower()
    return b"/artifact" in low and b"/watermark" in low


# ---------------------------------------------------------------------------
# PDF inspection
# ---------------------------------------------------------------------------

WATERMARK_WORDS = ("watermark", "stamp", "confidential", "draft", "sample", "copyright")


def _page_content(doc: fitz.Document, page: fitz.Page) -> tuple[list[int], bytes]:
    xrefs = page.get_contents()
    data = b"\n".join(doc.xref_stream(x) or b"" for x in xrefs)
    return xrefs, data


def object_fingerprint(doc: fitz.Document, xref: int, cache: dict | None = None) -> str:
    """Identity of an XObject, independent of the name a page happens to give it.

    Resource names are page-local. In the validation file `/Fm0` resolves to 814
    different objects and `/Im0` to 332 -- one per page. Removing by name alone
    therefore deletes whatever that name means on every other page, which can be
    unrelated artwork. Objects are matched by this fingerprint instead, so what
    gets cut is the thing the crop actually showed.

    Hashes the raw (still compressed) stream plus the few dictionary keys that
    describe its shape. Deliberately NOT the whole dictionary: a producer that
    copies its watermark onto every page gives each copy its own object, whose
    dictionary embeds that page's own resource xrefs, so dictionary hashing makes
    938 identical watermarks look like 938 unrelated objects and collapses every
    coverage figure to a single page. The stream bytes are identical across those
    copies, which is exactly the identity wanted here.
    """
    if cache is not None and xref in cache:
        return cache[xref]
    h = hashlib.md5()
    try:
        h.update(doc.xref_stream_raw(xref) or b"")   # raw: no decompression cost
    except Exception:
        h.update(f"xref:{xref}".encode())
    for key in ("Subtype", "Width", "Height", "BBox", "ColorSpace", "BitsPerComponent"):
        try:
            val = doc.xref_get_key(xref, key)
            if val and val[0] != "null":
                h.update(f"{key}={val[1]}".encode("utf-8", "replace"))
        except Exception:
            pass
    fp = h.hexdigest()[:16]
    if cache is not None:
        cache[xref] = fp
    return fp


def page_drawables(doc: fitz.Document, page: fitz.Page):
    """(name, xref, rect) for everything this page draws directly: forms and images.

    Nested objects are skipped for both kinds. A form invoked from inside another
    form, like an image reached through one, has its `Do` in that parent's stream
    and not in this page's -- offering it would be a candidate that removes
    nothing, or worse, one that matches a different page-level object of the same
    name.
    """
    for x in page.get_xobjects():
        # (xref, name, invoker, bbox); invoker != 0 means another XObject draws it
        if x[1] and not x[2]:
            yield x[1], x[0], x[3]
    for im in page.get_images(full=True):
        # referencer != 0 means the image is reached through a form, whose own Do
        # is what this page's content stream carries
        if im[9] or not im[7]:
            continue
        rect = None
        try:
            rects = page.get_image_rects(im[0])
            if rects:
                rect = rects[0]
        except Exception:
            pass
        yield im[7], im[0], rect


def names_for_fingerprints(doc, page, fingerprints: set[str], cache: dict) -> set[str]:
    """Which resource names on this page point at the objects we mean to cut."""
    return {name for name, xref, _ in page_drawables(doc, page)
            if object_fingerprint(doc, xref, cache) in fingerprints}


def _xobject_flags(doc: fitz.Document, xref: int) -> dict:
    """Read the telltale keys off a form/image XObject."""
    info = {"private": "", "oc_name": "", "subtype": ""}
    try:
        info["subtype"] = (doc.xref_get_key(xref, "Subtype") or ("", ""))[1].lstrip("/")
        private = doc.xref_get_key(xref, "PieceInfo/ADBE_CompoundType/Private")
        if private and private[0] != "null":
            info["private"] = str(private[1]).lstrip("/")
        oc = doc.xref_get_key(xref, "OC/OCGs/Name")
        if oc and oc[0] != "null":
            info["oc_name"] = str(oc[1]).strip("()")
    except Exception:
        pass
    return info


def _stream_len(doc: fitz.Document, xref: int) -> int:
    try:
        return len(doc.xref_stream(xref) or b"")
    except Exception:
        return -1


def analyze(doc: fitz.Document, sample: int | None = None) -> dict:
    """Survey the document and report every watermark candidate."""
    total = doc.page_count
    pages = range(total) if not sample else sorted(set(range(0, total, max(1, total // sample))))[:sample]

    tagged_pages: list[int] = []
    # keyed by fingerprint, not by name: a name means different things on different
    # pages, so counting by name overstates coverage and mixes unrelated objects
    fp_pages: Counter = Counter()
    fp_meta: dict[str, dict] = {}
    fp_rects: dict[str, Counter] = defaultdict(Counter)
    fp_names: dict[str, Counter] = defaultdict(Counter)
    fp_cache: dict[int, str] = {}
    annot_pages: dict[str, int] = {}
    annots: Counter = Counter()
    text_pages = image_only_pages = 0

    for i in pages:
        page = doc[i]
        _, data = _page_content(doc, page)
        if re.search(rb"/Artifact\s*<<[^>]*?/Subtype\s*/Watermark", data):
            tagged_pages.append(i)

        here = set()
        for name, xref, rect in page_drawables(doc, page):
            fp = object_fingerprint(doc, xref, fp_cache)
            here.add(fp)
            fp_names[fp][name] += 1
            if fp not in fp_meta:
                meta = _xobject_flags(doc, xref)
                meta["xref"] = xref
                meta["bytes"] = _stream_len(doc, xref)
                meta["first_page"] = i
                meta["fingerprint"] = fp
                fp_meta[fp] = meta
            if rect is not None:
                fp_rects[fp][tuple(round(v) for v in rect)] += 1

        for fp in here:
            fp_pages[fp] += 1

        for a in page.annots() or []:
            kind = a.type[1]
            annots[kind] += 1
            annot_pages.setdefault(kind, i)

        has_text = bool(page.get_text().strip())
        text_pages += has_text
        if not has_text and page.get_images():
            image_only_pages += 1

    scanned = image_only_pages > len(pages) * 0.5
    return {
        "page_count": total,
        "sampled": len(pages),
        "tagged_watermark_pages": tagged_pages,
        "xobjects": {
            fp: {
                **fp_meta[fp],
                "name": fp_names[fp].most_common(1)[0][0] if fp_names[fp] else "?",
                "aliases": sorted(fp_names[fp]),
                "pages": fp_pages[fp],
                "coverage": fp_pages[fp] / len(pages),
                "rect": fp_rects[fp].most_common(1)[0][0] if fp_rects[fp] else None,
            }
            for fp in sorted(fp_pages, key=lambda k: -fp_pages[k])
        },
        "annots": dict(annots),
        "annot_pages": annot_pages,
        "text_pages": text_pages,
        "image_only_pages": image_only_pages,
        "scanned": scanned,
        "ocgs": doc.get_ocgs(),
    }


def watermark_targets(report: dict, repeat_threshold: float | None) -> tuple[set[str], dict[str, str]]:
    """Fingerprints to drop, with a reason for each. Empty streams are ignored."""
    picked: dict[str, str] = {}
    for fp, meta in report["xobjects"].items():
        if meta.get("bytes") == 0:
            continue  # draws nothing -- leave it alone
        if meta.get("private", "").lower() == "watermark":
            picked[fp] = "PieceInfo /Private /Watermark"
        elif any(w in meta.get("oc_name", "").lower() for w in WATERMARK_WORDS):
            picked[fp] = f"optional-content group {meta['oc_name']!r}"
        elif repeat_threshold is not None and meta["coverage"] >= repeat_threshold:
            picked[fp] = f"drawn on {meta['coverage']:.0%} of pages"
    return set(picked), picked


# ---------------------------------------------------------------------------
# Cleaning
# ---------------------------------------------------------------------------


def clean_vector(
    doc: fitz.Document,
    drop_names: set[str],
    strip_tagged: bool = True,
    strip_annots: bool = True,
    pages: range | list[int] | None = None,
    verbose: bool = False,
    text_targets: list[dict] | None = None,
    drop_fingerprints: set[str] | None = None,
) -> dict:
    """Cut the watermark drawing operators out of the page content streams.

    `drop_fingerprints` is the accurate way to name a target; `drop_names` is kept
    for callers that only have a name, and is resolved to fingerprints on the page
    the name was taken from.
    """
    stats = Counter()
    written_tuples: set[tuple[int, ...]] = set()
    fp_cache: dict[int, str] = {}
    targets = set(drop_fingerprints or ())

    # Every distinct /Contents set each stream takes part in, across the WHOLE
    # document rather than just the pages being processed. Rewriting a page writes
    # the joined result into its first stream and blanks the rest, so a stream that
    # another page uses differently must be spotted BEFORE that happens -- noticing
    # afterwards means the other page has already been destroyed.
    stream_tuples: dict[int, set[tuple]] = defaultdict(set)
    for idx in range(doc.page_count):
        whole = tuple(doc[idx].get_contents())
        for x in whole:
            stream_tuples[x].add(whole)

    for i in pages if pages is not None else range(doc.page_count):
        page = doc[i]

        # Annotations live on the page object, not in the content stream, so they
        # must be handled before any of the content-stream guards below can skip.
        if strip_annots:
            for a in list(page.annots() or []):
                if a.type[1] in ("Watermark", "Stamp"):
                    page.delete_annot(a)
                    stats["annots"] += 1

        xrefs, data = _page_content(doc, page)
        if not xrefs:
            continue
        key = tuple(xrefs)
        if key in written_tuples:
            continue                      # identical stream set, already rewritten
        # Safe only if every stream this page uses is used exclusively by pages with
        # this exact same set. Those pages all want the identical rewrite, and the
        # dedup above gives it to them once. Any other sharing pattern would blank
        # or overwrite a stream some other page still needs.
        if any(stream_tuples[x] != {key} for x in xrefs):
            stats["skipped_shared"] += 1
            continue

        # resolve targets to the names this particular page uses for them
        names = set(names_for_fingerprints(doc, page, targets, fp_cache)) if targets else set()
        if drop_names and not targets:
            names |= set(drop_names)

        new = data
        if strip_tagged:
            new, n_tag = strip_marked_blocks(new, is_watermark_tag)
            stats["tagged_blocks"] += n_tag
        if names:
            new, n_do = strip_xobject_draws(new, names)
            stats["xobject_draws"] += n_do
        for target in text_targets or []:
            new, n_txt = strip_text_blocks(
                new, tuple(target["colour"]), target.get("rotation")
            )
            stats["text_blocks"] += n_txt

        if new != data:
            doc.update_stream(xrefs[0], new)
            for extra in xrefs[1:]:
                doc.update_stream(extra, b" ")
            written_tuples.add(key)
            stats["pages_changed"] += 1
            if verbose:
                print(f"  page {i + 1}: content stream {len(data)} -> {len(new)} bytes")

    return dict(stats)


def native_dpi(doc: fitz.Document, default: int = 200, sample: int = 8) -> int:
    """Resolution of the page images themselves, for pages that are one flat image.

    Rendering a 150 dpi scan at 200 dpi upsamples it: the file grows, and resampling
    softens strokes and can smear a watermark back in as grey haze. Matching the
    source resolution avoids inventing detail that was never there.
    """
    found: list[float] = []
    n = min(doc.page_count, sample)
    for i in range(n):
        page = doc[i]
        width_in = page.rect.width / 72.0
        if width_in <= 0:
            continue
        for im in page.get_images(full=True):
            try:
                rects = page.get_image_rects(im[0])
            except Exception:
                continue
            # only trust images that span essentially the whole page
            if rects and rects[0].width >= page.rect.width * 0.9:
                found.append(im[2] / width_in)
    if not found:
        return default
    return max(72, min(600, int(round(sorted(found)[len(found) // 2]))))


def clean_raster(doc: fitz.Document, dpi: int = 200, **kw) -> fitz.Document:
    """Render, clean the bitmaps, rebuild. Loses the text layer."""
    import cv2
    import numpy as np

    from dewatermark import remove_watermark

    out = fitz.open()
    for i in range(doc.page_count):
        page = doc[i]
        pix = page.get_pixmap(dpi=dpi, alpha=False)
        img = np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.height, pix.width, pix.n)
        if pix.n == 3:
            img = img[:, :, ::-1]  # RGB -> BGR
        clean = remove_watermark(np.ascontiguousarray(img), **kw)
        ok, buf = cv2.imencode(".png", clean)
        if not ok:
            raise RuntimeError(f"failed to encode page {i + 1}")
        new_page = out.new_page(width=page.rect.width, height=page.rect.height)
        new_page.insert_image(new_page.rect, stream=buf.tobytes())
        if (i + 1) % 25 == 0:
            print(f"  rasterised {i + 1}/{doc.page_count} pages", file=sys.stderr)
    return out


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------


def _fmt_report(report: dict) -> str:
    b = io.StringIO()
    w = b.write
    w(f"pages              : {report['page_count']}")
    if report["sampled"] != report["page_count"]:
        w(f"  (sampled {report['sampled']})")
    w("\n")
    w(f"pages with text    : {report['text_pages']}\n")
    w(f"image-only pages   : {report['image_only_pages']}"
      f"{'   <- looks scanned, vector mode may find nothing' if report['scanned'] else ''}\n")
    tagged = report["tagged_watermark_pages"]
    w(f"tagged /Watermark  : {len(tagged)} page(s)"
      f"{'  e.g. ' + ', '.join(str(p + 1) for p in tagged[:5]) if tagged else ''}\n")
    if report["annots"]:
        w(f"annotations        : {report['annots']}\n")
    if report["ocgs"]:
        names = [v.get("name", "?") for v in report["ocgs"].values()]
        w(f"optional content   : {names}\n")

    w("\nXObjects drawn on pages:\n")
    w(f"  {'name':<12}{'pages':>7}{'cover':>8}{'bytes':>10}  {'flags':<28}rect\n")
    for _fp, m in list(report["xobjects"].items())[:20]:
        flags = []
        if m.get("private"):
            flags.append(f"Private/{m['private']}")
        if m.get("oc_name"):
            flags.append(f"OC:{m['oc_name']}")
        if m.get("bytes") == 0:
            flags.append("EMPTY")
        if len(m.get("aliases") or []) > 1:
            flags.append("aka " + "/".join(m["aliases"][1:4]))
        w(f"  {m['name']:<12}{m['pages']:>7}{m['coverage']:>7.0%}{m['bytes']:>10}  "
          f"{', '.join(flags):<28}{m['rect']}\n")
    return b.getvalue()


def _parse_pages(spec: str | None, total: int) -> list[int] | None:
    if not spec:
        return None
    out: set[int] = set()
    for part in spec.split(","):
        part = part.strip()
        if "-" in part:
            a, _, b = part.partition("-")
            out.update(range(int(a) - 1, int(b)))
        elif part:
            out.add(int(part) - 1)
    return sorted(p for p in out if 0 <= p < total)


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)

    insp = sub.add_parser("inspect", help="report watermark candidates without changing anything")
    insp.add_argument("input", type=Path)
    insp.add_argument("--sample", type=int, default=None, help="only sample N pages (fast on huge files)")

    cl = sub.add_parser("clean", help="write a de-watermarked copy")
    cl.add_argument("input", type=Path)
    cl.add_argument("output", type=Path)
    cl.add_argument("--mode", choices=["auto", "vector", "raster"], default="auto")
    cl.add_argument("--drop", action="append", default=[], metavar="NAME",
                    help="also drop this XObject by name (repeatable)")
    cl.add_argument("--repeat-threshold", type=float, default=None, metavar="F",
                    help="treat any XObject drawn on >= F of pages as a watermark, e.g. 0.9")
    cl.add_argument("--keep-tagged", action="store_true", help="do not remove /Artifact /Watermark blocks")
    cl.add_argument("--keep-annots", action="store_true", help="do not remove Watermark/Stamp annotations")
    cl.add_argument("--pages", default=None, help="page ranges, 1-based, e.g. 1-10,42")
    cl.add_argument("--dry-run", action="store_true", help="report what would change, write nothing")
    cl.add_argument("-v", "--verbose", action="store_true")
    cl.add_argument("--dpi", type=int, default=200, help="raster mode render resolution")
    for flag, key in (("--sat", "sat_thresh"), ("--val", "val_thresh"),
                      ("--white", "white_point"), ("--black", "black_point"),
                      ("--despeckle", "despeckle")):
        cl.add_argument(flag, type=int, default=None, dest=key, help="raster mode: see dewatermark.py")

    args = ap.parse_args(argv)
    doc = fitz.open(args.input)
    if doc.is_encrypted and not doc.authenticate(""):
        print("error: PDF is password protected", file=sys.stderr)
        return 2

    if args.cmd == "inspect":
        print(_fmt_report(analyze(doc, sample=args.sample)))
        return 0

    report = analyze(doc, sample=min(doc.page_count, 60) if doc.page_count > 120 else None)
    drop, reasons = watermark_targets(report, args.repeat_threshold)
    # --drop takes a name, which is only meaningful on the page it came from; resolve
    # it to the object's fingerprint so the same object is cut wherever it appears
    label = {fp: m["name"] for fp, m in report["xobjects"].items()}
    by_name = {m["name"]: fp for fp, m in report["xobjects"].items()}
    for name in args.drop:
        fp = by_name.get(name)
        if fp is None:
            print(f"  no object named /{name} was found -- run `inspect`", file=sys.stderr)
            continue
        drop.add(fp)
        reasons.setdefault(fp, "requested with --drop")

    mode = args.mode
    if mode == "auto":
        # only /Watermark and /Stamp are ever removed, so only those count as a find:
        # a scanned form with Widget annotations must still fall back to raster
        removable_annots = any(k in ("Watermark", "Stamp") for k in report["annots"])
        found = bool(report["tagged_watermark_pages"]) or bool(drop) or removable_annots
        mode = "vector" if found else "raster"
        if mode == "raster":
            print("no watermark object found -- falling back to raster mode", file=sys.stderr)

    print(f"mode: {mode}")
    if mode == "vector":
        if report["tagged_watermark_pages"] and not args.keep_tagged:
            print(f"  removing /Artifact <</Subtype/Watermark>> blocks "
                  f"({len(report['tagged_watermark_pages'])} of {report['sampled']} sampled pages carry one)")
        for fp in sorted(drop):
            print(f"  dropping XObject /{label.get(fp, fp)}  ({reasons.get(fp, 'requested')})")
        if not report["tagged_watermark_pages"] and not drop:
            print("  nothing to remove -- run `inspect` and pass --drop or --repeat-threshold", file=sys.stderr)
            return 1
        if args.dry_run:
            print("dry run: no file written")
            return 0
        stats = clean_vector(
            doc,
            drop_names=set(),
            drop_fingerprints=drop,
            strip_tagged=not args.keep_tagged,
            strip_annots=not args.keep_annots,
            pages=_parse_pages(args.pages, doc.page_count),
            verbose=args.verbose,
        )
        print(f"  removed {stats.get('tagged_blocks', 0)} tagged block(s), "
              f"{stats.get('xobject_draws', 0)} XObject draw(s), "
              f"{stats.get('annots', 0)} annotation(s) across {stats.get('pages_changed', 0)} page(s)")
        out_doc = doc
    else:
        if args.dry_run:
            print("dry run: no file written")
            return 0
        kw = {k: v for k, v in vars(args).items()
              if k in ("sat_thresh", "val_thresh", "white_point", "black_point", "despeckle") and v is not None}
        out_doc = clean_raster(doc, dpi=args.dpi, **kw)

    args.output.parent.mkdir(parents=True, exist_ok=True)
    out_doc.save(str(args.output), garbage=4, deflate=True)
    before = args.input.stat().st_size
    after = args.output.stat().st_size
    print(f"{args.input} -> {args.output}  ({before / 1e6:.1f} MB -> {after / 1e6:.1f} MB)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
