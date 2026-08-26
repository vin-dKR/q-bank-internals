# Image Background Remover

Remove the background from a photo and replace it with white, black, or real
transparency. Upload, preview, download.

**No AI, no machine learning, no pretrained models, no external services.** The
separation is done with ordinary image processing — Pillow, OpenCV and NumPy —
running entirely on your own machine.

```
Upload  →  analyse background  →  build mask  →  refine edges  →  White / Black / Transparent  →  Download
```

---

## Contents

- [What it does well (and what it doesn't)](#what-it-does-well-and-what-it-doesnt)
- [Installation](#installation)
- [Running it](#running-it)
- [Touching up by hand](#touching-up-by-hand)
- [Whitening photographed paper](#whitening-photographed-paper)
- [How the separation works](#how-the-separation-works)
- [Design decisions](#design-decisions)
- [Project layout](#project-layout)
- [API](#api)
- [Configuration](#configuration)
- [Tests](#tests)
- [Troubleshooting](#troubleshooting)

---

## What it does well (and what it doesn't)

This is a classical image-processing tool, not a segmentation network. Being
straight about the boundaries matters more than overselling it.

**Works well**

| Case | Why |
|---|---|
| Plain white / black / solid-colour backdrops | Background colour is unambiguous |
| Studio and e-commerce product shots | Uniform backdrop, high subject contrast |
| Passport-style portraits | Same |
| Objects with thin parts — antennas, stems, spokes, wire | No aggressive erosion anywhere in the pipeline |
| Soft cast shadows on the backdrop | Detected and removed as backdrop, not subject |
| Subjects that run off the edge of the frame | The frame is never assumed to be background |
| Photographed pages — text, diagrams, tables | Detached marks are kept; thin-ruled cells are cleared |

**Struggles**

| Case | What happens |
|---|---|
| Busy, cluttered, real-world backgrounds | GrabCut does what it can; expect leftover background |
| Backdrop and subject nearly the same colour *at the subject's outline* | The outline can't be found by colour |
| A gap enclosed by something thick that matches the backdrop | Kept, not opened — see below |

### The one tradeoff worth knowing about

Consider two identical-looking situations:

```
   a white shirt inside               the paper inside a table cell,
   a person's outline                 or between bicycle spokes
   ── keep it! ──                     ── remove it! ──
```

Both are backdrop-coloured regions fenced in by the subject, so neither
connects to the image border. Colour can't tell them apart. **Thickness can.**

The backdrop is allowed to leak across roughly six pixels before connectivity
is measured. That is enough to see through a table rule, a wire, a bicycle
spoke or a strand of hair — so those gaps clear normally — and nowhere near
enough to cross an arm, a mug handle or a ring, so those stay filled.

When the fence really is thick and the region really does match the backdrop,
the tool **keeps** the pixels. Leaving a bit of background behind is a far
smaller failure than punching a hole through somebody's shirt.

`BRIDGE_RATIO` in `processor.py` controls how thick a fence is seen through.

---

## Installation

Python **3.9 or newer** (developed and tested on 3.13).

```bash
python -m venv .venv
```

```bash
# Windows
.venv\Scripts\activate

# macOS / Linux
source .venv/bin/activate
```

```bash
pip install -r requirements.txt
```

Four dependencies, nothing heavy:

```
Flask                     web framework
Pillow                    image loading, EXIF, encoding
numpy                     array maths
opencv-python-headless    colour spaces, GrabCut, filtering
```

> `opencv-python-headless` is the server build — same library, without the GUI
> bindings. If you already have `opencv-python` installed, that works too.

---

## Running it

```bash
python app.py
```

Then open <http://127.0.0.1:5000>.

```
HOST=0.0.0.0 PORT=8080 python app.py     # bind elsewhere
FLASK_DEBUG=1 python app.py              # auto-reload while developing
```

For production, run it behind a real WSGI server:

```bash
pip install waitress
waitress-serve --port=8000 app:app
```

### Using it

1. Drag an image onto the drop zone, or click to browse.
2. Wait a moment — a 12-megapixel photo takes a second or two.
3. Fix anything it got wrong by painting on the result — see
   [Touching up by hand](#touching-up-by-hand).
4. Pick **White**, **Black**, or **Transparent**. Switching is instant; the
   image is not re-uploaded or re-processed.
5. Pick **PNG** or **JPG**, then **Download**.

The transparent preview sits on a checkerboard so you can see the transparency.
The checkerboard is a CSS backdrop in the browser — it is never part of the
image. The downloaded PNG has a genuine alpha channel.

### Touching up by hand

No automatic rule gets every image right, so you can paint corrections
directly onto the result.

| Control | What it does |
|---|---|
| **Erase** | Paint away anything the automatic pass kept but you don't want |
| **Restore** | Paint back anything it removed but you did want |
| **Brush size** | Radius of the brush, shown as a ring under the cursor |
| **Snap to edges** | Pulls the painted boundary onto real edges in the photo, so a rough stroke still lands on the outline. Turn it off for freehand control |
| **Whiten paper** | For photos of documents — see [below](#whitening-photographed-paper) |
| **Undo** / **Clear** | Step back one stroke, or drop all of them |

Two things make this reliable rather than fiddly:

**You paint on a preview; the edit lands on the full-size mask.** Strokes are
stored as normalised coordinates and a radius relative to the image's longest
edge, then replayed server-side at full resolution. What you see is what
downloads — a stroke painted on a 1200 px preview cuts exactly the same shape
out of a 4000 px original.

**Strokes always replay from the untouched mask**, in order, rather than
stacking onto the previous edit. Undo is just a shorter list, repeated edits
can't drift, and painting Restore over an Erase does what you'd expect because
the later stroke wins.

The canvas repaints locally as you drag, so painting is immediate no matter how
large the image is; the server result replaces it when you lift the brush.

### Whitening photographed paper

Photograph a page and the paper is never white. It picks up a colour cast from
the room, it's brighter where the lamp falls, and the curl of the page adds its
own gradient. Drop that on a white background and the page reads as a grey-pink
rectangle sitting on white.

**Whiten paper** fixes it, and the result matches the background exactly — the
paper lands on a true 255, not merely close to it. Ink is pulled the other way
at the same time, so the page comes out looking scanned rather than
photographed.

The reason it can do that is *where* the correction is measured. Brightness,
contrast and white-balance sliders apply one adjustment to the whole image, so
setting the lit side to white leaves the shaded side grey; there is no single
adjustment that suits both. Instead this estimates the paper's colour **at every
pixel** and divides it out:

```
     paper colour, per pixel          the page, divided by it
   ┌──────────────────────────┐      ┌──────────────────────────┐
   │ 236  228  210  198  186  │      │ 255  255  255  255  255  │
   │ 232  224  206  194  180  │  ->  │ 255  255  255  255  255  │
   │ 228  219  201  188  174  │      │ 255  255  255  255  255  │
   └──────────────────────────┘      └──────────────────────────┘
     lit ────────────> shaded          uniformly white
```

Dividing removes the colour cast in the same step, because the cast is in the
estimate too — pink paper over pink estimate is 1.0, which is white.

The estimate itself comes from a wide dilation, which keeps the brightest pixel
in each neighbourhood. On a page that is the paper, so the ink drops out of the
estimate without ever being detected as ink.

Three passes run, coarse to fine. The first looks across a wide neighbourhood so
a large drawing cannot be mistaken for shadow — which is also why it cannot
follow anything narrow. The two fine passes that follow catch what it missed,
such as the crease down a curled page. Each pass has a floor on how far it may
brighten any one region: the fine passes need a tight one, because their small
neighbourhood fits *inside* a large black shape, where they would otherwise read
the ink itself as paper and wash it out to grey.

**Both ends of the range are anchored, not just white.** Once the paper is
pinned at 255, the black point is read from the image — the ink's actual
brightness at a low percentile — and mapped to 0, with a gamma above 1 so
midtones deepen instead of flattening into grey.

Anchoring only the white end is a trap. Printed text in a photograph is nowhere
near black; soft focus and a dim room leave body text sitting at two-thirds of
the paper's brightness. Pin only the top of the range and text like that drifts
upward and **disappears into the page**. The black point is what holds it down.

For the same reason the ink level is measured only inside the kept mask. A page
shot on a dark desk would otherwise have its "ink" level read off the desk,
which is far darker than any ink, leaving the text under-corrected.

Measured on a simulated phone photo — soft focus, grey ink, colour cast, curl
shadow, sensor noise:

| | before | after |
|---|---|---|
| lit side | `[223 197 200]` | `[255 255 255]` |
| shaded side | `[149 131 134]` | `[255 255 255]` |
| curl shadow | `[137 120 123]` | `[255 255 255]` |
| paper at exactly 255 | — | **100 %** |
| body text | 105 | **102** |
| hatching detail (std) | 37.9 | **73.2** |
| a large solid black block | — | 14 |

Text keeps its original density against paper that is now pure white, and fine
hatching comes out with roughly twice the local contrast it went in with.

**What it costs.** The tone curve is a document curve: it pulls everything
toward white or black. A photograph printed on the page will lose some of its
mid-grey subtlety, and a very faint pencil mark can clip to white.

It is **off by default and meant for documents**. On a portrait or a product
shot it will flatten the lighting that gives the subject its shape.

---

## How the separation works

```
                     bytes from the browser
                              │
                     decode, apply EXIF orientation
                              │
                     ┌────────┴────────┐
                     │  full resolution │  kept untouched for the final composite
                     └────────┬────────┘
                              │  analysis copy, max 900 px
                              ▼
              ┌─────────────────────────────────┐
              │ sample a band around the border │  → backdrop colour + uniformity
              └────────────────┬────────────────┘
                               ▼
              ┌─────────────────────────────────┐
              │ CIELAB distance from that colour │
              │ + shadow detection               │
              └────────────────┬────────────────┘
                               ▼
              ┌─────────────────────────────────┐
              │ keep only backdrop that reaches │
              │ the frame  (border connectivity) │
              └────────────────┬────────────────┘
                               ▼
                      uniform backdrop?
                     ┌─────────┴─────────┐
                   yes                   no
                     │                    │
              colour ramp α        GrabCut, seeded
                     │             from the above
                     └─────────┬──────────┘
                               ▼
              ┌─────────────────────────────────┐
              │ fill small holes, drop specks   │
              └────────────────┬────────────────┘
                               ▼  scale mask up to full resolution
              ┌─────────────────────────────────┐
              │ guided filter, guided by the    │  ← anti-aliased, edge-aligned α
              │ original full-size photo        │
              └────────────────┬────────────────┘
                               ▼
              ┌─────────────────────────────────┐
              │ remove backdrop colour spill    │  ← this is what kills halos
              └────────────────┬────────────────┘
                               ▼
                 composite at ORIGINAL resolution
```

Each stage in one line:

1. **Border sampling.** A band around the frame gives the backdrop's median
   CIELAB colour and how uniform it is. Median, not mean, so a subject poking
   into the border doesn't drag the estimate.

2. **Colour distance.** Every pixel's CIELAB distance from that colour. CIELAB
   because a distance of 10 means roughly the same amount of visible difference
   anywhere in the space, which plain RGB distance does not.

3. **Shadow detection.** A cast shadow keeps the backdrop's hue, is darker, and
   has no sharp edge anywhere. All three must hold. The sharpness test is what
   protects a plain grey object, which also matches the first two.

4. **Border connectivity.** Only backdrop-coloured regions that connect to the
   frame get removed. This is what keeps a white shirt on a white backdrop.

5. **GrabCut**, only when the backdrop isn't uniform, seeded from steps 2–4
   rather than a blind rectangle. If it collapses and erases the subject, the
   result is thrown away and the colour mask is used instead.

6. **Cleanup.** One small morphological close, fill enclosed gaps under 5 % of
   the subject's area, drop blobs under 5 % of the largest. No erode/dilate
   cycles — those are what eat fingers, antennas and hair.

7. **Guided filter** (He, Sun & Tang, 2010) at full resolution, using the photo
   itself as the guide. Pulls the mask boundary onto the real edges in the
   image and turns a stair-stepped border into a smooth alpha ramp.

8. **Spill removal.** An edge pixel is a mixture: `I = α·F + (1−α)·B`. Solving
   for `F` recovers the subject's own colour. Without it, a subject cut from a
   white backdrop keeps a bright rim when placed on black.

9. **Composite** at the original resolution: `result = F·α + background·(1−α)`.

---

## Design decisions

**The α ramp is normalised against the local subject colour, not a fixed
threshold.** A pixel halfway between subject and backdrop should get α ≈ 0.5.
If you scale colour distance against a fixed cutoff, a high-contrast subject
reaches α = 1.0 while the pixel is still a quarter backdrop — and that
leftover backdrop is exactly what shows up as a halo later. So α is computed as
`|I−B| / |F−B|`, with `F` measured locally from nearby confident subject pixels.

**Analysis runs at ≤ 900 px; the picture never does.** GrabCut and connected
components at 12 MP would be slow for no benefit — the mask is a smooth,
low-frequency thing. It's scaled back up and then sharpened against the
full-resolution image by the guided filter, so edge accuracy is set by the
full-size photo, not by the analysis copy. The output is always the input's
exact dimensions.

**Opacity is forced only where the mask was solid before cleanup.** Closing
bridges narrow gaps — between hair strands, between spokes. Those bridged
pixels are backdrop, and forcing them opaque would paste stripes of backdrop
into the cut-out. They keep their ramp value instead, which is near zero.

**Nothing touches the disk.** Uploads are decoded from memory and results live
in a small expiring in-process cache (6 entries, 15 minutes) so switching
backgrounds doesn't need a re-upload. There are no temporary files, so there is
nothing to leak or clean up.

**Uploads are validated by content, not by name.** The bytes have to decode as
a real image in a supported format. Extension and declared content type are
ignored. Size is capped at 25 MB and 50 megapixels, download filenames are
sanitised, and errors return one sentence — never a stack trace.

---

## Project layout

```
image-background-remover/
│
├── app.py                  Flask routes, upload validation, error handling
├── processor.py            all image processing — no web code in here
├── requirements.txt
├── README.md
│
├── templates/
│   └── index.html
│
├── static/
│   ├── style.css
│   └── script.js
│
└── tests/
    ├── test_processor.py   loading, EXIF, masks, compositing, encoding
    └── test_app.py         routes, downloads, error responses
```

`processor.py` has no Flask import and no knowledge of the web layer. You can
use it on its own:

```python
from PIL import Image
import processor

image = processor.load_image(open("photo.jpg", "rb").read())
foreground, mask = processor.remove_background(image)

processor.apply_background(foreground, mask, "white").save("white.png")
processor.apply_background(foreground, mask, "transparent").save("cutout.png")
processor.apply_background(foreground, mask, "#1e2a3a").save("navy.png")
```

`remove_background` returns the RGB array with backdrop spill removed, and a
float32 alpha map in `[0, 1]` — both at the original resolution.

---

## API

### `POST /api/process`

`multipart/form-data` with an `image` field.

```json
{
  "id": "5rN1x8-QhK2LmA0pWvTdYg",
  "width": 4000,
  "height": 3000,
  "elapsed": 1.34,
  "original": "data:image/webp;base64,...",
  "cutout":   "data:image/webp;base64,..."
}
```

`original` and `cutout` are downscaled previews for display only. `cutout`
carries a real alpha channel, which is what lets the browser switch backgrounds
without asking the server.

### `POST /api/edit`

Applies manual brush strokes and returns a refreshed preview. Strokes replace
any previous edit rather than adding to it.

```json
{
  "id": "5rN1x8-QhK2LmA0pWvTdYg",
  "snap": true,
  "whiten": false,
  "strokes": [
    {"mode": "erase",   "radius": 0.02, "points": [[0.31, 0.78], [0.36, 0.79]]},
    {"mode": "restore", "radius": 0.01, "points": [[0.52, 0.44]]}
  ]
}
```

Coordinates are fractions of width and height; `radius` is a fraction of the
longest edge. Capped at 500 strokes and 40,000 points per request. Responds
`{"cutout": "data:image/webp;base64,..."}`, and every later download uses the
edited mask.

### `GET /api/download/<id>`

| Parameter | Values | Default |
|---|---|---|
| `background` | `white`, `black`, `transparent`, `#RRGGBB` | `white` |
| `format` | `png`, `jpg`, `webp` | `png` |
| `whiten` | `1` to correct photographed paper to true white | `0` |

Returns the composited image at the original resolution as a file download.
`format=jpg` with `background=transparent` falls back to PNG, since JPEG has no
alpha channel. Results expire 15 minutes after processing.

### `GET /api/health`

```json
{"status": "ok", "stored_results": 0}
```

Errors from every endpoint are `{"error": "one readable sentence"}` with a
matching status code.

---

## Configuration

Environment variables:

| Variable | Default | Meaning |
|---|---|---|
| `HOST` | `127.0.0.1` | Interface to bind |
| `PORT` | `5000` | Port |
| `FLASK_DEBUG` | `0` | `1` enables auto-reload |
| `LOG_LEVEL` | `INFO` | `DEBUG`, `INFO`, `WARNING`, … |

Processing constants live at the top of `processor.py`, each with a comment
explaining what moving it costs:

| Constant | Default | Effect |
|---|---|---|
| `WORK_MAX_EDGE` | `900` | Analysis resolution. Higher = slower, marginally finer masks |
| `UNIFORM_BORDER_RATIO` | `0.90` | How uniform a backdrop must be to skip GrabCut |
| `BRIDGE_RATIO` | `0.003` | How thick a fence the backdrop may leak across |
| `HOLE_MAX_RATIO` | `0.05` | Enclosed gaps under this fraction of the subject get filled |
| `SPECK_MIN_AREA` / `SPECK_AREA_RATIO` | `10` / `0.000015` | Noise threshold on a plain backdrop — nothing is judged against the largest blob |
| `COMPONENT_MIN_RATIO` | `0.05` | Busy backgrounds only: blobs under this fraction of the largest get dropped |
| `SHADOW_MAX_CHROMA` | `5.0` | How closely a shadow must match the backdrop's hue |
| `SHADOW_MIN_LIGHTNESS` | `0.55` | Darker than this fraction of the backdrop → treated as object |
| `SHADOW_MAX_GRADIENT` | `2.5` | What counts as a sharp edge |
| `SHADOW_MAX_SHARP_BORDER` | `0.5` | More of a region's outline sharper than that → object, not shadow |
| `PAPER_PASSES` | coarse→fine | Whitening: `(reach, floor)` per pass. Raise a `floor` if a large dark shape washes out; lower a `reach` to track a narrower shadow |
| `PAPER_WHITE_POINT` | `0.90` | Whitening: what counts as paper |
| `PAPER_INK_PERCENTILE` | `8.0` | Whitening: where the black point is read from. Lower keeps faint marks; higher drives text darker |
| `PAPER_GAMMA` | `1.25` | Whitening: above 1 deepens midtones |
| `MAX_IMAGE_PIXELS` | `50_000_000` | Decompression-bomb guard |

Upload limits are `MAX_UPLOAD_BYTES` in `app.py` (25 MB).

---

## Tests

```bash
pip install pytest
python -m pytest tests -q
```

98 tests covering the things that are easy to break:

- loading JPEG / PNG / WEBP, grayscale, RGBA, palette images
- EXIF orientation applied, and images without EXIF left alone
- rejecting empty, truncated, corrupt and non-image uploads
- **the subject surviving** — recall above 97 % on every fixture
- a backdrop-coloured region behind a *thick* fence being kept
- backdrop behind a *thin* fence (a ruled table cell) being cleared
- text on a photographed page not being discarded as noise
- thin features surviving
- cast shadows removed, and a plain grey object *not* mistaken for one
- output resolution matching the input, for every background
- transparent output being genuinely RGBA with transparent pixels
- JPEG refusing transparency instead of silently flattening it
- brush strokes: erase, restore, later-stroke-wins ordering, soft edges,
  full path coverage on a drag, edge snapping, strokes at the image border
- edits reaching the download, clearing them restoring the original, and
  replaying the same list twice giving the same result
- hostile stroke payloads (NaN, negative radius, junk types) being survived
- whitening reaching exactly 255 on both the lit and the shaded side, clearing
  the colour cast, and not blowing out a large dark shape
- soft grey photographed text staying readable rather than fading into the page,
  contrast between ink and paper growing, and detail deepening not flattening
- routes, downloads, filename sanitising, oversized uploads
- error responses never containing a stack trace

---

## Troubleshooting

**Part of my subject was removed.**
Almost always a backdrop and subject that are close in colour at the outline.
Try a backdrop with more contrast. If it's reproducible, raising
`SHADOW_MIN_LIGHTNESS` in `processor.py` makes shadow detection less eager.

**Lots of background is left behind.**
Expected on busy scenes — the tool prefers this over cutting into the subject.
A plainer backdrop fixes it.

**A hole in my object was filled in.**
It's enclosed by something too thick to see through — the tradeoff described
[above](#the-one-tradeoff-worth-knowing-about). Erase it with the brush, or
raise `BRIDGE_RATIO`, at the cost of eventually punching through real subjects.

**Whitening washed out my text / a printed photo.**
Lower `PAPER_INK_PERCENTILE` to keep fainter marks, or `PAPER_GAMMA` to 1.0 for
a gentler curve. The filter is tuned for ink on paper, not for photographs
printed on the page.

**The brush cut a straight edge instead of following the object.**
Turn **Snap to edges** off if you want the stroke exactly where you painted it.
Snapping needs a visible edge to grab; across a low-contrast boundary there is
nothing for it to find.

**A shadow was kept.**
Hard-edged or strongly coloured shadows fail the shadow test on purpose, since
loosening it starts deleting real objects.

**`ModuleNotFoundError: No module named 'cv2'`**
The virtual environment isn't active, or `pip install -r requirements.txt`
hasn't run inside it.

**Upload rejected as too large.**
25 MB / 50 MP by default. Raise `MAX_UPLOAD_BYTES` in `app.py` and
`MAX_IMAGE_PIXELS` in `processor.py`.

**It's slow.**
Roughly 0.5 s at 2 MP and 1.5 s at 12 MP on a normal laptop CPU. If you need
more, lower `WORK_MAX_EDGE` and `REFINE_MAX_PIXELS` in `processor.py` — both
trade edge precision for speed.

---

## Licence

Provided as-is for you to use and modify.
