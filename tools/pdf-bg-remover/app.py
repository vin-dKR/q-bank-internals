"""Web interface for the background remover.

Keeps the UI concerns here and the image maths in :mod:`processor`. Uploads are
processed entirely in memory -- nothing is written to disk, so there are no
temporary files to leak or clean up.
"""

from __future__ import annotations

import base64
import logging
import os
import secrets
import time
from dataclasses import dataclass
from io import BytesIO
from threading import Lock

import numpy as np
from flask import Flask, Response, jsonify, render_template, request, send_file
from PIL import Image
from werkzeug.exceptions import HTTPException, RequestEntityTooLarge
from werkzeug.utils import secure_filename

import processor
from processor import ImageError

# --------------------------------------------------------------------------
# Configuration
# --------------------------------------------------------------------------

MAX_UPLOAD_BYTES = 25 * 1024 * 1024

#: Longest edge of the images sent to the browser. Downloads are always full
#: resolution -- this only keeps the preview payload small.
PREVIEW_MAX_EDGE = 1200

#: How long a processed result stays available for download, and how many
#: results are held at once. Both are small on purpose: results are large
#: arrays, and there is no reason to keep a user's picture around.
RESULT_TTL_SECONDS = 15 * 60
MAX_STORED_RESULTS = 6

#: Bounds on a touch-up request, so a hostile payload cannot stall a worker.
MAX_STROKES = 500
MAX_POINTS_PER_STROKE = 4000
MAX_TOTAL_POINTS = 40_000

app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = MAX_UPLOAD_BYTES
app.config["JSON_SORT_KEYS"] = False

logging.basicConfig(
    level=os.getenv("LOG_LEVEL", "INFO").upper(),
    format="%(asctime)s  %(levelname)-7s  %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("background-remover")


# --------------------------------------------------------------------------
# In-memory result store
# --------------------------------------------------------------------------


@dataclass
class Result:
    """One processed image, held only long enough to be downloaded."""

    foreground: np.ndarray
    mask: np.ndarray
    name: str
    created: float
    #: The mask after the user's brush strokes, or None if untouched.
    edited: np.ndarray | None = None
    #: Paper-whitened pixels, computed on first use and reused after that.
    whitened: np.ndarray | None = None

    @property
    def alpha(self) -> np.ndarray:
        return self.mask if self.edited is None else self.edited

    def pixels(self, whiten: bool) -> np.ndarray:
        """The foreground, optionally with the paper corrected to true white."""
        if not whiten:
            return self.foreground
        if self.whitened is None:
            # The automatic mask, not the edited one, so the correction stays
            # stable while the user paints and the cached result stays valid.
            self.whitened = processor.whiten_paper(self.foreground, mask=self.mask)
        return self.whitened


class ResultStore:
    """A tiny expiring cache so switching backgrounds needs no re-upload."""

    def __init__(self, max_items: int, ttl: float):
        self._items: dict[str, Result] = {}
        self._max_items = max_items
        self._ttl = ttl
        self._lock = Lock()

    def put(self, result: Result) -> str:
        token = secrets.token_urlsafe(16)
        with self._lock:
            self._purge()
            while len(self._items) >= self._max_items:
                oldest = min(self._items, key=lambda k: self._items[k].created)
                del self._items[oldest]
            self._items[token] = result
        return token

    def get(self, token: str) -> Result | None:
        with self._lock:
            self._purge()
            return self._items.get(token)

    def _purge(self) -> None:
        cutoff = time.time() - self._ttl
        for token in [k for k, v in self._items.items() if v.created < cutoff]:
            del self._items[token]


store = ResultStore(MAX_STORED_RESULTS, RESULT_TTL_SECONDS)


# --------------------------------------------------------------------------
# Helpers
# --------------------------------------------------------------------------


def _preview(image: Image.Image) -> str:
    """Scale an image down for the browser and return it as a data URL.

    WEBP is used because it keeps the alpha channel at a fraction of a PNG's
    size. The downloaded file is unaffected by any of this.
    """
    preview = image
    if max(image.size) > PREVIEW_MAX_EDGE:
        ratio = PREVIEW_MAX_EDGE / max(image.size)
        size = (max(1, round(image.width * ratio)), max(1, round(image.height * ratio)))
        preview = image.resize(size, Image.Resampling.LANCZOS)

    buffer = BytesIO()
    preview.save(buffer, format="WEBP", quality=90, method=4)
    encoded = base64.b64encode(buffer.getvalue()).decode("ascii")
    return f"data:image/webp;base64,{encoded}"


def _flatten(image: Image.Image) -> Image.Image:
    """Put an already-transparent upload on white for the "before" preview.

    A plain RGB conversion would show its transparent areas as black, which
    looks like the picture rather than like missing pixels.
    """
    if image.mode != "RGBA":
        return image.convert("RGB")

    backdrop = Image.new("RGB", image.size, (255, 255, 255))
    backdrop.paste(image, mask=image.getchannel("A"))
    return backdrop


def _safe_name(filename: str | None) -> str:
    """Turn an uploaded filename into a safe basename for the download."""
    base = secure_filename(filename or "")
    base = os.path.splitext(base)[0].strip("._")
    return base[:60] or "image"


def _clean_strokes(raw: object) -> list[dict]:
    """Validate brush strokes from the browser.

    Everything is bounded before it reaches the image code: a payload of a
    million points, or a brush the size of the sun, must not become a
    long-running request.
    """
    if raw is None:
        return []
    if not isinstance(raw, list):
        raise ValueError("Malformed edit request.")
    if len(raw) > MAX_STROKES:
        raise ValueError("Too many brush strokes. Reset the touch-ups and try again.")

    strokes: list[dict] = []
    total_points = 0

    for item in raw:
        if not isinstance(item, dict):
            continue
        if item.get("mode") not in ("erase", "restore"):
            continue

        points = item.get("points")
        if not isinstance(points, list) or not points:
            continue

        cleaned = []
        for point in points[:MAX_POINTS_PER_STROKE]:
            if not isinstance(point, (list, tuple)) or len(point) != 2:
                continue
            try:
                x, y = float(point[0]), float(point[1])
            except (TypeError, ValueError):
                continue
            if x != x or y != y:  # NaN
                continue
            cleaned.append((min(max(x, 0.0), 1.0), min(max(y, 0.0), 1.0)))

        if not cleaned:
            continue

        total_points += len(cleaned)
        if total_points > MAX_TOTAL_POINTS:
            raise ValueError("Too many brush strokes. Reset the touch-ups and try again.")

        try:
            radius = float(item.get("radius", 0.02))
        except (TypeError, ValueError):
            radius = 0.02

        strokes.append(
            {
                "mode": item["mode"],
                "radius": min(max(radius, 0.0005), 0.5),
                "points": cleaned,
            }
        )

    return strokes


def _error(message: str, status: int) -> Response:
    response = jsonify({"error": message})
    response.status_code = status
    return response


# --------------------------------------------------------------------------
# Routes
# --------------------------------------------------------------------------


@app.get("/")
def index() -> str:
    return render_template("index.html", max_upload_mb=MAX_UPLOAD_BYTES // (1024 * 1024))


@app.get("/api/health")
def health() -> Response:
    return jsonify({"status": "ok", "stored_results": len(store._items)})


@app.post("/api/process")
def process() -> Response:
    upload = request.files.get("image")
    if upload is None or not upload.filename:
        return _error("Please choose an image to upload.", 400)

    started = time.perf_counter()
    data = upload.read()

    image = processor.load_image(data)
    del data

    log.info("Received image: %dx%d (%s)", image.width, image.height, image.mode)

    foreground, mask = processor.remove_background(image)

    elapsed = time.perf_counter() - started
    log.info(
        "Removed background from %dx%d in %.2fs (%.1f%% kept)",
        image.width,
        image.height,
        elapsed,
        100.0 * float(mask.mean()),
    )

    token = store.put(
        Result(
            foreground=foreground,
            mask=mask,
            name=_safe_name(upload.filename),
            created=time.time(),
        )
    )

    cutout = processor.apply_background(foreground, mask, "transparent")

    response = jsonify(
        {
            "id": token,
            "width": image.width,
            "height": image.height,
            "elapsed": round(elapsed, 2),
            "original": _preview(_flatten(image)),
            "cutout": _preview(cutout),
        }
    )
    return response


@app.post("/api/edit")
def edit() -> Response:
    """Re-apply the user's brush strokes to the original mask.

    Strokes are always replayed from the untouched mask rather than stacked on
    the previous edit, so undo is just a shorter list and repeated edits cannot
    drift.
    """
    body = request.get_json(silent=True) or {}

    result = store.get(str(body.get("id", "")))
    if result is None:
        return _error("This result has expired. Please upload the image again.", 404)

    try:
        strokes = _clean_strokes(body.get("strokes"))
    except ValueError as exc:
        return _error(str(exc), 400)

    started = time.perf_counter()
    mask = (
        processor.apply_strokes(
            result.mask, result.foreground, strokes, snap_to_edges=bool(body.get("snap", True))
        )
        if strokes
        else result.mask
    )
    result.edited = None if not strokes else mask

    log.info(
        "Applied %d brush stroke(s) to %dx%d in %.2fs",
        len(strokes),
        mask.shape[1],
        mask.shape[0],
        time.perf_counter() - started,
    )

    pixels = result.pixels(bool(body.get("whiten", False)))
    cutout = processor.apply_background(pixels, mask, "transparent")
    return jsonify({"cutout": _preview(cutout)})


@app.get("/api/download/<token>")
def download(token: str) -> Response:
    result = store.get(token)
    if result is None:
        return _error(
            "This result has expired. Please upload the image again.", 404
        )

    background = request.args.get("background", "white")
    fmt = request.args.get("format", "png").lower()

    # Transparency only survives in a format that has an alpha channel.
    if background == "transparent" and fmt in ("jpg", "jpeg"):
        fmt = "png"

    whiten = request.args.get("whiten", "").lower() in ("1", "true", "yes", "on")
    pixels = result.pixels(whiten)

    image = processor.apply_background(pixels, result.alpha, background)
    payload = processor.encode_image(image, fmt)

    extension = "jpg" if fmt in ("jpg", "jpeg") else fmt
    filename = f"{result.name}-{background}.{extension}"

    log.info("Sending %s (%dx%d, %.1f KB)", filename, image.width, image.height, len(payload) / 1024)

    return send_file(
        BytesIO(payload),
        mimetype=f"image/{'jpeg' if extension == 'jpg' else extension}",
        as_attachment=True,
        download_name=filename,
        max_age=0,
    )


# --------------------------------------------------------------------------
# Errors -- users see a sentence, the log gets the detail
# --------------------------------------------------------------------------


@app.errorhandler(ImageError)
def handle_image_error(exc: ImageError) -> Response:
    log.warning("Rejected upload: %s", exc)
    return _error(str(exc), 400)


@app.errorhandler(RequestEntityTooLarge)
def handle_too_large(_: RequestEntityTooLarge) -> Response:
    limit = MAX_UPLOAD_BYTES // (1024 * 1024)
    return _error(f"That file is larger than {limit} MB. Please choose a smaller image.", 413)


@app.errorhandler(MemoryError)
def handle_out_of_memory(_: MemoryError) -> Response:
    log.error("Out of memory while processing an image")
    return _error(
        "Ran out of memory processing that image. Please try a smaller one.", 507
    )


@app.errorhandler(HTTPException)
def handle_http_error(exc: HTTPException) -> Response:
    if request.path.startswith("/api/"):
        return _error(exc.description or "Request failed.", exc.code or 500)
    return exc  # type: ignore[return-value]


@app.errorhandler(Exception)
def handle_unexpected(exc: Exception) -> Response:
    log.exception("Unhandled error while processing a request", exc_info=exc)
    return _error(
        "Unable to process this image. Please upload a valid JPG, PNG, or WEBP image.",
        500,
    )


def main() -> None:
    host = os.getenv("HOST", "127.0.0.1")
    port = int(os.getenv("PORT", "5000"))
    debug = os.getenv("FLASK_DEBUG", "0") == "1"

    log.info("Background remover ready at http://%s:%d", host, port)
    app.run(host=host, port=port, debug=debug, threaded=True)


if __name__ == "__main__":
    main()
