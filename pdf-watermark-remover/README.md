# Watermark Removal Tool — Task Specification

A command-line tool that strips a watermark/stamp from **PDFs** and from **scanned text images**, without damaging the text underneath.

Two levels, and the higher one should always be tried first:

| Level | Tool | How it works | Cost |
|---|---|---|---|
| **PDF object** | `pdf_dewatermark.py` | Deletes the operators that *draw* the watermark from the page content streams | Lossless — text stays selectable, nothing else changes |
| **Pixel** | `dewatermark.py` | Chroma-mask + levels stretch on a bitmap | Lossy — only for watermarks fused into a scan |

Most watermarked PDFs in the wild are the first case: the watermark is a distinct PDF object, usually tagged as one, and can simply be cut out. Rasterising such a file to clean it pixel-wise throws away the text layer to solve a problem that had an exact solution.

---

## 1. The Task

### Problem

Scanned images of printed characters carry two defects:

1. A **translucent pink stamp** — a diagonal band overlapping the right side of each image. In places it sits directly on top of the characters, so it cannot simply be cut away.
2. A **dirty background** — the "white" paper is actually light grey (RGB ~235–250) with scanner haze, plus faint bleed-through from adjacent rows above and below the crop.

### Goal

Produce clean images where the background is exactly `#FFFFFF`, the stamp is fully gone, and every character — including characters lying under the stamp — survives intact with smooth anti-aliased edges.

### Constraint

No generative inpainting. The result must be a deterministic, reversible transform so batches of thousands of images process identically and reproducibly.

### Key Insight

The watermark and the text differ along an axis that is trivial to separate:

| | Saturation | Brightness |
|---|---|---|
| Pink stamp | ~31 (coloured) | ~230–250 (light) |
| Text ink | ~0 (neutral grey) | ~11–60 (dark) |
| Paper | ~0 (neutral) | ~250 (light) |
| Ink **under** stamp | high (coloured) | low (dark) |

So a pixel is watermark only if it is **coloured AND light**. The second half of that test is what saves the characters sitting on the stamp — they are coloured but dark, so they fail the test and are kept.

---

## 2. Input

### Accepted formats

`.png` `.jpg` `.jpeg` `.bmp` `.tif` `.tiff` `.webp`

### Accepted colour modes

| Mode | Handling |
|---|---|
| Grayscale (H×W) | Promoted to 3-channel |
| BGR (H×W×3) | Used directly |
| BGRA (H×W×4) | Alpha composited onto white first |

### Accepted paths

| Argument | Meaning |
|---|---|
| `input.png` | Single file |
| `inputs/` | Directory — every image inside is processed, non-images skipped |

### Assumptions the input must satisfy

- Text is **dark and neutral** (black/grey, not coloured).
- Watermark is **coloured and lighter than the text**.
- Background is light.

If the watermark is grey, or darker than the text, or sits over dark artwork, threshold masking will not work — see *Limitations*.

### Sample input used for validation

| File | Dimensions | Channels | Size |
|---|---|---|---|
| `..._option_0_....png` | 541 × 105 | RGBA | 27.4 KB |
| `..._option_1_....png` | 541 × 105 | RGBA | 31.0 KB |
| `..._option_2_....png` | 558 × 105 | RGBA | 31.6 KB |
| `..._option_3_....png` | 545 × 105 | RGBA | 24.7 KB |

---

## 3. Output

### Format

- **Always PNG** (lossless — critical, since JPEG would reintroduce colour fringing around the very edges just cleaned).
- **Single-channel 8-bit grayscale.** Colour is discarded deliberately: once the stamp is removed there is no meaningful colour left, and grayscale guarantees no residual tint survives anywhere.
- **Identical dimensions to the input.** No cropping, scaling, or padding — pixel `(x, y)` out corresponds to pixel `(x, y)` in.

### Value guarantees

| Region | Output value |
|---|---|
| Background / paper | Exactly `255` |
| Watermark area | Exactly `255` |
| Character cores | Exactly `0` |
| Character edges | Smooth `1`–`254` ramp (anti-aliasing preserved) |

### Naming

`<original_stem>_clean.png`

### Path behaviour

| Input | Output arg | Result |
|---|---|---|
| File | File path | Written to that exact path |
| File | Directory | `<dir>/<stem>_clean.png` |
| Directory | Directory | Created if absent, one output per input image |

### Console output

One line per file (`source -> destination`), then a total count. Unreadable files print a `skip` warning to stderr and do not abort the batch.

### Sample output produced

| File | Dimensions | Channels |
|---|---|---|
| `..._option_0_..._clean.png` | 541 × 105 | Grayscale |
| `..._option_1_..._clean.png` | 541 × 105 | Grayscale |
| `..._option_2_..._clean.png` | 558 × 105 | Grayscale |
| `..._option_3_..._clean.png` | 545 × 105 | Grayscale |

---

## 4. Pipeline

### PDF level (`pdf_dewatermark.py`)

```
input.pdf
    │
    ├─ inspect ──────────────── survey every page, rank watermark candidates
    │
    ├─ vector mode (default) ── lex each page content stream, delete:
    │     ├─ /Artifact <</Subtype/Watermark>> BDC … EMC blocks
    │     ├─ q … /Fm Do … Q  where the form is flagged /Private /Watermark
    │     ├─ q … /Fm Do … Q  where an OCG is named Watermark/Confidential/…
    │     ├─ /Watermark and /Stamp annotations
    │     └─ anything drawn on ≥ --repeat-threshold of pages (opt-in)
    │        then garbage-collect the now-orphaned image objects
    │
    ├─ raster mode (fallback) ─ render → image pipeline below → rebuild
    │
    └─ output.pdf
```

Mode selection is automatic: if any watermark object is found, vector; otherwise raster.

**Why a lexer and not a regex.** Content streams are PostScript-ish, and the
three letters `EMC` occur inside string literals and inside the binary payload of
inline images. Cutting on a raw regex match eventually corrupts a page. The lexer
in `iter_operators()` skips strings, hex strings, dicts, arrays and inline-image
payloads, so `BDC`/`EMC`/`Do`/`q`/`Q` are only ever matched as real operators, and
`q … Q` nesting is tracked so a deletion never leaves the graphics state unbalanced.

### Pixel level (`dewatermark.py`)

```
input image
    │
    ├─ 0. Alpha flatten ─────── composite RGBA onto white
    │
    ├─ 1. Chroma mask ───────── HSV; wipe pixels where sat > 18 AND val > 110
    │                           (coloured + light = stamp; coloured + dark = ink, kept)
    │
    ├─ 2. Levels stretch ────── grayscale; remap [55, 205] → [0, 255], clamp
    │                           (kills haze, residual tint, keeps edge gradients)
    │
    ├─ 3. Despeckle (opt) ───── drop connected ink blobs smaller than N px
    │
    └─ output image
```

Steps 1 and 2 do essentially all the work. Step 3 is cosmetic cleanup for dust and row bleed-through.

---

## 5. Usage

### PDF

```bash
# 1. always look first — changes nothing
python pdf_dewatermark.py inspect in.pdf
python pdf_dewatermark.py inspect in.pdf --sample 40      # fast on huge files

# 2. clean (auto-detects vector vs raster)
python pdf_dewatermark.py clean in.pdf out.pdf

# untagged watermark: name it, or let the repetition heuristic find it
python pdf_dewatermark.py clean in.pdf out.pdf --drop Fm0
python pdf_dewatermark.py clean in.pdf out.pdf --repeat-threshold 0.9

# scanned PDF with no watermark object to delete
python pdf_dewatermark.py clean in.pdf out.pdf --mode raster --dpi 200 --sat 12
```

| Flag | Effect |
|---|---|
| `--mode auto\|vector\|raster` | Force a strategy. `auto` picks vector when any watermark object is found. |
| `--drop NAME` | Also delete this XObject by name (repeatable). Get names from `inspect`. |
| `--repeat-threshold F` | Treat any XObject drawn on ≥ F of pages as a watermark, e.g. `0.9`. |
| `--pages 1-10,42` | Restrict to page ranges, 1-based. |
| `--keep-tagged` / `--keep-annots` | Leave tagged blocks / annotations alone. |
| `--dry-run` | Report what would change, write nothing. |
| `--dpi` `--sat` `--val` `--white` `--black` `--despeckle` | Raster mode only — passed to the pixel pipeline. |

`inspect` flags XObjects with an empty stream as `EMPTY`; those draw nothing and are
never removed, so leftover header/footer stubs are not mistaken for watermarks.

### Images

```bash
# single file
python dewatermark.py input.png output.png

# whole folder
python dewatermark.py uploads/ cleaned/

# folder with speckle removal, tuned thresholds
python dewatermark.py uploads/ cleaned/ --despeckle 6 --sat 12 --white 190
```

### Parameters

| Flag | Default | Range | Effect |
|---|---|---|---|
| `--sat` | `18` | 0–255 | Minimum saturation to count as watermark colour. **Lower** if pink still shows. |
| `--val` | `110` | 0–255 | Coloured pixels brighter than this get wiped. **Raise** if letters are being eaten. |
| `--white` | `205` | 0–255 | Grey level mapped to pure white. **Lower** if background stays grey. |
| `--black` | `55` | 0–255 | Grey level mapped to pure black. **Raise** for bolder text. |
| `--despeckle` | `0` | 0+ | Remove ink blobs under N pixels. `0` disables. Start at `6`. |

### Tuning guide

| Symptom | Fix |
|---|---|
| Watermark still visible | Lower `--sat` to 12 |
| Characters thinning or vanishing | Raise `--val` to 140, or lower `--black` |
| Background still grey | Lower `--white` to 190 |
| Text too faint | Raise `--black` to 80 |
| Dust and specks remain | Set `--despeckle 6` |
| Thin strokes disappearing | Lower `--despeckle` or set to `0` |

---

## 6. Requirements

```
PyMuPDF          # PDF level
opencv-python    # pixel level
numpy
```

```bash
pip install PyMuPDF opencv-python numpy
```

Tested on PyMuPDF 1.25.5, OpenCV 4.11, NumPy 2.2, Python 3.13.

---

## 7. Integration

`remove_watermark(img, sat_thresh, val_thresh, white_point, black_point, despeckle)` is a pure function: NumPy array in, NumPy array out, no I/O and no global state. Import it directly to embed the tool elsewhere.

```python
import cv2
from dewatermark import remove_watermark

img = cv2.imread("input.png", cv2.IMREAD_UNCHANGED)
clean = remove_watermark(img, sat_thresh=18, val_thresh=110)
cv2.imwrite("output.png", clean)
```

### Browser review UI — `app.py`

```bash
pip install fastapi uvicorn python-multipart
python app.py            # http://127.0.0.1:8000
```

Upload → review → confirm → download. The review step exists because detection
signal 4 (repetition) is a guess, and because a watermark is the one thing in a
document you cannot undo deleting. Nothing is removed until you tick it.

Each candidate is shown as an **exhibit**: three synced crops of a real page —
*before*, *after*, and **what leaves** (the deleted pixels alone, everything else
knocked out to white) — plus the literal content-stream bytes that would be cut,
with the operators highlighted. Judging "is this the watermark?" is then a matter
of looking at it rather than trusting a label.

Every card carries that answer in its header, so "remove what?" never needs a
click: a thumbnail of the mark itself, taken from the *what leaves* crop. The
thumbnail uses a **detail** crop rather than the full one. A mark made of small
scattered pieces — answer ticks, page numbers — spans nearly the whole page, so
its full crop is page-sized and near-empty, which shrinks to a blank rectangle.
The detail crop dilates the mask to merge each mark into a blob, takes the
largest, and zooms to it: wide enough to join the letters of a word, not wide
enough to join marks at opposite ends of the page. A scattered tick icon then
reads as a tick icon instead of an empty box. The label sits below the crop,
never over it — covering the mark would defeat the point of showing it.

Behaviour worth knowing:

- **Producer-declared candidates are pre-ticked. Inferred ones are not** — they
  carry an amber `inferred — verify` badge, because a page number or letterhead
  repeats on every page too. This is not hypothetical: in the validation file the
  green tick and red cross answer icons (`/Im0`, `/Im1`) are drawn on 98 % of
  pages and are duly offered as inferred candidates. Their *what leaves* crop
  shows the answer marks disappearing, so they are rejected at a glance — which
  is the entire reason the confirmation step exists. Note their share of the page
  as well: 0.03 % and 0.24 %, against 4.6 % for the real watermark.
- **Overlapping candidates are marked `duplicate` and unticked.** If a form
  object's draw already sits inside a tagged watermark block, ticking both cuts
  the same pixels once. Without this the run reports "0 object draws removed",
  which reads like a failure when it is really redundancy.
- **The page proof** renders any page of the real document with the current
  selection applied, before/after, with the share of pixels that change. Arrow
  keys flip pages.
- **Sweep checks the whole document.** Paging through 938 pages by hand is not a
  review, it is a chore that gets abandoned around page 20. Sweep renders every
  page as a thumbnail with the share of pixels that changed, then flags the pages
  that break the pattern:

  | Flag | Meaning |
  |---|---|
  | magenta, `0%` | Nothing was removed. The watermark is absent, or drawn some other way. |
  | amber | Changed by an unusual amount against the median. |
  | unmarked | Behaved like everything else. |

  It lives in the page-proof panel as a second tab, not in a section further
  down the page: the panel is sticky, so the whole-document check is always one
  click away rather than a scroll past the entire candidate list. Opening the tab
  for the first time starts the check itself — an empty grid behind a button reads
  as broken. Clicking any thumbnail switches back to the single-page view on that
  page, in the same panel.

  "Only the odd ones" hides the rest, so a 938-page document collapses to the
  handful worth opening; click any thumbnail to load it in the proof. When nothing
  is flagged, that uniformity *is* the result — one watermark, removed identically
  throughout.

  The grid works like a page manager: **list or grid** view, a **zoom** control for
  thumbnail size, and a tick on every page. Ticks decide **which pages the removal
  applies to** — untick a page and it is left alone. Shift-click a tick to set a
  whole range, or use *Include all* / *Exclude all* / *Exclude the odd ones*.
  Clicking the thumbnail itself opens that page in the proof rather than toggling
  it, so inspecting and choosing never collide. Excluding every page is refused
  rather than silently producing an unchanged file.

  938 pages sweep in about 18 seconds (~19 ms/page) at 32 dpi. Thumbnails are JPEG
  rather than PNG: a long sweep holds thousands in the browser at once, and PNG
  made that roughly eight times heavier (45 MB against 11 MB). The change figure is
  measured on the raw render before encoding, so compression never affects it.
- **Click anything on the page to identify what draws it.** The automatic signals
  only find what a producer declared or what repeats; a plain light-grey text
  watermark carries neither marker and is invisible to all of them. Clicking the
  mark reports the object under that point — a text span with its fill colour,
  size, font and angle, or an image with its xref — and adds it as a candidate
  with the same exhibit and snippet as any other. This is the escape hatch for
  everything detection misses.

  Text targets are matched by **fill colour plus effective rotation**, never by
  the string, so no font decoding is needed and every instance goes at once.
  Rotation is read from the text matrix *and* the graphics matrix combined —
  watermark tools put it in either, and only the product says how the glyphs
  really sit. Note that `get_text()` reports direction with y pointing down while
  content-stream matrices point y up, so the angle's sign flips between the two;
  getting that backwards silently matches nothing.

  Removing a text watermark changes the text layer on purpose, so the result panel
  reports "changed, as intended" rather than raising a warning.
- **When it falls back to pixels it shows a tone reading** rather than leaving you
  to guess at the sliders: whether the watermark is coloured or neutral grey, the
  measured grey of the watermark strokes, the measured grey of genuine grey
  content, a suggested white point, and a warning when the two tones sit too close
  for any setting to separate them. The two populations are split by *shape*
  (many small strokes vs a few wide fills), not by histogram peak — they often
  share one merged peak, and a median over blobs is stable where argmax is not.
- **After removal** it reopens both files from disk and compares extracted text
  across 8 sampled pages. Comparing against the still-open in-memory document
  instead reports a false mismatch — `save(garbage=4)` renumbers objects and the
  loaded page text goes stale.

**One primary action, and it moves rather than being duplicated.** Before the cut
it sits in the proof panel header, reachable without scrolling past the candidate
list: greyed while nothing is ticked, *Cut and download* once something is. After
the cut it moves into the fixed bottom dock beside *Start over*, reading *Download
<file>* — so the finished file and the way to begin again sit together, and the
outcome card just points at it instead of carrying a third copy. Below 1181px the
header has no room, so the dock carries it in both states. `syncActions()` is the
only writer and `doCut()` the only handler, so the two elements cannot disagree;
exactly one is on screen at any width, verified before and after the cut.

Change your ticks after cutting and it reverts to *Cut and download* — the
finished file no longer matches the choices, so offering it would hand you a stale
download. Amber is the colour of cutting; a file already cut is finished rather
than pending, so the done state switches to the keep colour.

**The result is a mark, not a card.** What a cut changed — tagged blocks, object
draws, annotations, size, and the text comparison — sits behind a small `i` in the
proof header, in the slot the Cut button vacates. It appears only once there is a
cut to describe and disappears the moment the selection changes, since the figures
then describe a file that no longer matches. Click outside or press `Esc` to
dismiss. A permanently docked outcome card would hold the page open with numbers
most runs never need; a reader who does want them is one click away.

Uploads live in a temp directory, are never sent anywhere, and are swept after
six hours. The server binds to `127.0.0.1` only.

**`ConnectionResetError: [WinError 10054]` in the console.** Harmless, and now
silenced. Closing a tab or reloading mid-request resets the socket; the Windows
proactor transport then shuts down a socket that is already gone and dumps a
traceback from an asyncio callback. The server never stopped serving. `app.py`
runs the selector event loop on Windows, which has no such race, and installs an
asyncio exception handler that drops `ConnectionResetError`,
`ConnectionAbortedError` and `BrokenPipeError` — a client that has hung up is not
an error worth printing.

| Endpoint | Purpose |
|---|---|
| `POST /api/analyze` | Upload a PDF, get candidates with exhibits and snippets |
| `POST /api/preview` | Render one page with a given selection applied |
| `POST /api/scan` | Thumbnail + change figure for a batch of pages (the sweep) |
| `POST /api/pick` | Identify whatever draws at a clicked point |
| `POST /api/clean` | Apply the confirmed selection, verify text, return stats |
| `GET /api/download/{token}` | Fetch the cleaned PDF |

### Other wrappers

- **Watched folder** — `watchdog` observer that processes anything dropped into a directory.
- **Browser, no server** — the *pixel* maths is per-pixel and ports to a `<canvas>` `ImageData` loop in roughly 30 lines of JavaScript. The PDF-level surgery cannot move client-side without a PDF parser.

---

## 8. Limitations

### PDF level

| Case | Why it fails | Alternative |
|---|---|---|
| Watermark fused into a scanned page image | There is no separate object to delete | `--mode raster`, or mask + `cv2.inpaint` |
| Watermark drawn inline with the body text, untagged, on some pages only | The repetition heuristic will not reach threshold | `inspect`, then `--drop NAME --pages …` |
| Watermark is body text drawn in a light colour | It is real page text, not an XObject; deleting it risks deleting content | Text-level redaction, reviewed by hand |
| Encrypted / password-protected PDF | Content streams cannot be read | Supply the password and decrypt first |
| Pages sharing part of a content stream | Rewriting one would blank a stream another page still needs | Those pages are skipped and counted as `skipped_shared`, never silently corrupted |
| Linearised or signed PDF | Rewriting content streams invalidates the signature | Expected — a signed file cannot be edited and stay valid |

**Objects are matched by identity, not by name.** A resource name like `/Fm0` is
page-local: in the validation file it resolves to 814 different objects and
`/Im0` to 332, one per page. Cutting by name alone would delete whatever that
name happens to mean on every other page. Each object is fingerprinted instead —
md5 of its raw (still compressed) stream plus `Subtype`, `Width`, `Height`,
`BBox`, `ColorSpace`, `BitsPerComponent` — and removal resolves that fingerprint
back to whatever each page calls it.

Fingerprint the *dictionary* instead and the opposite failure appears: a producer
that stamps its watermark onto every page gives each copy its own object whose
dictionary embeds that page's resource xrefs, so 938 identical watermarks look
like 938 unrelated objects and every coverage figure collapses to one page. The
stream bytes are identical across those copies, which is the identity wanted. A
side effect worth having: `/Fm0` and `/Fm3` in the validation file are the same
watermark under two names, and they now collapse into a single candidate.

A watermark is only removable this way because it is a *separate object*. Verify
the output before relying on it: the check used here was that extracted text is
byte-identical on all 938 pages and that changed pixels fall only inside the
watermark's bounding box.

**Flattened PDFs.** Tools like iLovePDF can rewrite a document so each page is a
single image. The page content stream then reads, in full:

```
q 594.873 0 0 842 0.0635 0 cm /X0 Do Q
```

`/X0` *is* the page. There is no watermark object because there are no objects —
the watermark, the words and the figures are the same pixels. The UI detects this
(a candidate whose removal leaves a blank page is the page) and switches to pixel
cleanup instead of offering to delete the document.

### When the pixel pipeline cannot finish the job either

A grey watermark is separable only if its tonal band sits clear of the document's
real greys. Measured on a flattened physics workbook:

| | Grey level |
|---|---|
| Watermark strokes | 217–227 |
| Genuine grey content (section banner, rules) | 197–209 |
| Paper | 250+ |

Those bands nearly touch. `--white 225` removes most of the watermark and keeps
the banner; `--white 185` removes all of it and destroys the banner. There is no
setting that does both, because a global levels curve cannot separate two tones
that overlap. Flat-fielding across pages (dividing by the per-pixel maximum of all
pages, which cancels anything common to every page) removes the parts of the
watermark that sit at the same place on every page, but not the rest — the tiling
shifts page to page.

For that case the honest options are a mask plus `cv2.inpaint`, a directional
filter keyed to the watermark's angle and stroke width, or a learned inpainting
model. Nothing in this tool will fully clear it.

### Pixel level

| Case | Why it fails | Alternative |
|---|---|---|
| Grey or black watermark | No colour to key on — step 1 cannot separate it from ink | Manual mask + `cv2.inpaint` |
| Watermark darker than text | Brightness test inverts and wipes the text | Flip the `val` comparison, or key on hue range |
| Watermark over photos/artwork | Levels stretch would destroy the tonal range of the artwork | LaMa or similar inpainting model |
| Coloured text | Text fails the neutrality assumption and gets wiped with the stamp | Key on the watermark's specific hue band instead of saturation alone |
| Very low-contrast scans | Levels window `[55, 205]` clips real detail | Widen the window, or use CLAHE before step 2 |

---

## 9. Files

| File | Description |
|---|---|
| `pdf_dewatermark.py` | PDF-level tool — `inspect` and `clean` |
| `dewatermark.py` | Pixel-level tool, and the raster fallback the PDF tool imports |
| `app.py` | FastAPI server for the browser review UI |
| `static/index.html` | The review UI — single file, no external assets |
| `README.md` | This document |
| `before_after.png` | Validation strip — before / after / diff |
| `cleaned/` | Processed output |

---

## 10. Validation run

`ssc-mts-previous-year-paper-13-july-2022.pdf` — 938 pages, 16.1 MB, produced by
PDFium, watermarked with Wondershare PDFelement.

`inspect` found the watermark tagged the spec-compliant way on every page:

```
/Artifact <</Subtype/Watermark/Type/Pagination>> BDC
  q /GS3 gs .55036 0 0 .55036 76.5 198.148 cm /Fm0 Do Q
EMC
```

`Fm0` is a form XObject flagged `/PieceInfo << /ADBE_CompoundType << /Private /Watermark`,
wrapping one 834 × 719 RGB + SMask logo image drawn on all 938 pages. Two further
forms (`wspe_X2`, `wspe_X3`, `/Private /Header`) have `/Length 0` — they draw
nothing and were correctly left alone.

| Check | Result |
|---|---|
| Pages processed | 938 / 938, in 9 s |
| Watermark image object still referenced | No — garbage-collected |
| Residual `/Subtype /Watermark` tags | 0 |
| Extracted text vs original | Byte-identical on all 938 pages |
| Pixels changed | 3.1 %, confined to the watermark's bounding box |
| Vector path A (tagged block) vs path B (`--drop` + `q…Q`) | Pixel-identical output |
| Size | 16.1 MB → 16.0 MB |
