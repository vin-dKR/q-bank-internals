"""Tests for the web layer: uploads, downloads and error responses."""

from __future__ import annotations

import io
import os
import sys
import time

import cv2
import numpy as np
import pytest
from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import app as web


@pytest.fixture()
def client():
    web.app.config["TESTING"] = True
    with web.app.test_client() as test_client:
        yield test_client


def sample_png(width=320, height=240) -> bytes:
    rgb = np.full((height, width, 3), 248, np.uint8)
    cv2.ellipse(rgb, (width // 2, height // 2), (70, 80), 0, 0, 360, (40, 60, 100), -1)
    buffer = io.BytesIO()
    Image.fromarray(rgb).save(buffer, format="PNG")
    return buffer.getvalue()


def upload(client, data=None, filename="photo.png"):
    return client.post(
        "/api/process",
        data={"image": (io.BytesIO(data if data is not None else sample_png()), filename)},
        content_type="multipart/form-data",
    )


# --------------------------------------------------------------------------


def test_index_page_renders(client):
    response = client.get("/")
    assert response.status_code == 200
    assert b"Image Background Remover" in response.data


def test_health(client):
    response = client.get("/api/health")
    assert response.status_code == 200
    assert response.get_json()["status"] == "ok"


def test_process_returns_previews_and_dimensions(client):
    response = upload(client)
    assert response.status_code == 200

    payload = response.get_json()
    assert payload["width"] == 320 and payload["height"] == 240
    assert payload["original"].startswith("data:image/webp;base64,")
    assert payload["cutout"].startswith("data:image/webp;base64,")
    assert payload["id"]


def test_process_without_a_file(client):
    response = client.post("/api/process", data={}, content_type="multipart/form-data")
    assert response.status_code == 400
    assert "error" in response.get_json()


def test_process_rejects_a_non_image(client):
    response = upload(client, data=b"not an image at all" * 50, filename="evil.png")
    assert response.status_code == 400
    body = response.get_json()["error"]
    assert "Traceback" not in body and "Error" not in body.split(".")[0]


@pytest.mark.parametrize("background", ["white", "black", "transparent"])
def test_download_each_background(client, background):
    token = upload(client).get_json()["id"]

    response = client.get(f"/api/download/{token}?background={background}&format=png")
    assert response.status_code == 200
    assert response.mimetype == "image/png"

    image = Image.open(io.BytesIO(response.data))
    assert image.size == (320, 240), "the download changed resolution"

    if background == "transparent":
        assert image.mode == "RGBA"
        assert np.asarray(image)[..., 3].min() == 0
    else:
        expected = 255 if background == "white" else 0
        assert np.asarray(image.convert("RGB"))[2, 2, 0] == expected


def test_download_as_jpeg(client):
    token = upload(client).get_json()["id"]
    response = client.get(f"/api/download/{token}?background=white&format=jpg")

    assert response.status_code == 200
    assert response.mimetype == "image/jpeg"
    assert Image.open(io.BytesIO(response.data)).format == "JPEG"


def test_transparent_download_falls_back_to_png_when_jpeg_is_asked_for(client):
    token = upload(client).get_json()["id"]
    response = client.get(f"/api/download/{token}?background=transparent&format=jpg")

    assert response.status_code == 200
    assert response.mimetype == "image/png"
    assert Image.open(io.BytesIO(response.data)).mode == "RGBA"


def test_download_filename_is_sanitised(client):
    token = upload(client, filename="../../etc/passwd.png").get_json()["id"]
    response = client.get(f"/api/download/{token}?background=white")

    disposition = response.headers["Content-Disposition"]
    assert ".." not in disposition and "/" not in disposition.split("filename=")[-1]


def test_download_with_an_unknown_token(client):
    response = client.get("/api/download/nope-not-a-real-token?background=white")
    assert response.status_code == 404
    assert "expired" in response.get_json()["error"]


def test_download_with_an_invalid_background(client):
    token = upload(client).get_json()["id"]
    response = client.get(f"/api/download/{token}?background=neon-taupe")

    assert response.status_code == 400
    assert "error" in response.get_json()


def test_oversized_upload_is_rejected(client):
    oversized = b"x" * (web.MAX_UPLOAD_BYTES + 1024)
    response = client.post(
        "/api/process",
        data={"image": (io.BytesIO(oversized), "big.png")},
        content_type="multipart/form-data",
    )
    assert response.status_code == 413
    assert "MB" in response.get_json()["error"]


def test_errors_never_leak_a_stack_trace(client):
    response = upload(client, data=b"\x89PNG\r\n\x1a\n" + b"corrupt" * 100)
    assert response.status_code == 400
    body = response.get_data(as_text=True)
    assert "Traceback" not in body
    assert 'File "' not in body


# --------------------------------------------------------------------------
# Manual touch-ups
# --------------------------------------------------------------------------


def edit(client, token, strokes, snap=False):
    return client.post(
        "/api/edit", json={"id": token, "strokes": strokes, "snap": snap}
    )


def test_edit_returns_an_updated_preview(client):
    token = upload(client).get_json()["id"]
    response = edit(client, token, [
        {"mode": "erase", "radius": 0.1, "points": [[0.5, 0.5]]}
    ])

    assert response.status_code == 200
    assert response.get_json()["cutout"].startswith("data:image/webp;base64,")


def test_edit_changes_what_gets_downloaded(client):
    token = upload(client).get_json()["id"]

    before = np.asarray(Image.open(io.BytesIO(
        client.get(f"/api/download/{token}?background=transparent").data
    )))[..., 3]

    edit(client, token, [{"mode": "erase", "radius": 0.25, "points": [[0.5, 0.5]]}])

    after = np.asarray(Image.open(io.BytesIO(
        client.get(f"/api/download/{token}?background=transparent").data
    )))[..., 3]

    assert after[120, 160] < before[120, 160], "the erase did not reach the download"
    assert after.shape == before.shape


def test_clearing_strokes_restores_the_original_result(client):
    token = upload(client).get_json()["id"]
    original = client.get(f"/api/download/{token}?background=transparent").data

    edit(client, token, [{"mode": "erase", "radius": 0.3, "points": [[0.5, 0.5]]}])
    edit(client, token, [])

    assert client.get(f"/api/download/{token}?background=transparent").data == original


def test_edits_replay_from_the_original_rather_than_stacking(client):
    """Sending the same list twice must give the same result."""
    token = upload(client).get_json()["id"]
    strokes = [{"mode": "erase", "radius": 0.2, "points": [[0.4, 0.5]]}]

    edit(client, token, strokes)
    once = client.get(f"/api/download/{token}?background=transparent").data
    edit(client, token, strokes)
    twice = client.get(f"/api/download/{token}?background=transparent").data

    assert once == twice


def test_edit_with_an_unknown_token(client):
    response = edit(client, "not-a-real-token", [])
    assert response.status_code == 404


def test_edit_rejects_a_malformed_payload(client):
    token = upload(client).get_json()["id"]
    response = client.post("/api/edit", json={"id": token, "strokes": "lots"})

    assert response.status_code == 400
    assert "error" in response.get_json()


def test_edit_rejects_too_many_points(client):
    token = upload(client).get_json()["id"]
    huge = [{"mode": "erase", "radius": 0.01,
             "points": [[0.5, 0.5]] * (web.MAX_POINTS_PER_STROKE)}
            for _ in range(20)]

    response = edit(client, token, huge)
    assert response.status_code == 400


def test_edit_survives_hostile_stroke_values(client):
    token = upload(client).get_json()["id"]
    response = edit(client, token, [
        {"mode": "erase", "radius": 1e9, "points": [[-5, 12], [float("nan"), 0.5]]},
        {"mode": "erase", "radius": -3, "points": [["x", "y"]]},
        {"mode": "restore", "points": [[0.5, 0.5]]},
        "not a stroke",
    ])
    assert response.status_code == 200


def tinted_page(width=320, height=240) -> bytes:
    """An unevenly lit, colour-cast page filling the whole frame."""
    yy, xx = np.mgrid[0:height, 0:width].astype(np.float32)
    lighting = 1.0 - 0.3 * (xx / width)
    page = np.clip(
        np.dstack([lighting * 234, lighting * 206, lighting * 210]), 0, 255
    ).astype(np.uint8)
    cv2.putText(page, "hello", (40, 130), cv2.FONT_HERSHEY_SIMPLEX, 1.2, (60, 40, 44), 3)

    buffer = io.BytesIO()
    Image.fromarray(page).save(buffer, format="PNG")
    return buffer.getvalue()


def test_whiten_increases_contrast_in_the_download(client):
    """Paper goes lighter and ink goes darker, so the gap between them grows."""
    token = upload(client, data=tinted_page()).get_json()["id"]

    def fetch(flag):
        data = client.get(f"/api/download/{token}?background=white&whiten={flag}").data
        return np.asarray(Image.open(io.BytesIO(data)).convert("RGB"))

    plain, white = fetch(0), fetch(1)
    assert white.shape == plain.shape

    ink = plain.min(axis=2) < 160          # where the lettering is
    assert ink.any()

    assert white[ink].mean() < plain[ink].mean(), "the ink did not get darker"
    assert white[~ink].mean() >= plain[~ink].mean(), "the paper did not get lighter"


def test_whitened_page_reaches_pure_white(client):
    """The page should end up the same white as the background behind it."""
    token = upload(client, data=tinted_page()).get_json()["id"]
    out = np.asarray(Image.open(io.BytesIO(
        client.get(f"/api/download/{token}?background=white&whiten=1").data
    )).convert("RGB"))

    corner = out[4, 4]
    assert corner.tolist() == [255, 255, 255], f"page corner is {corner.tolist()}"


def test_whiten_flag_is_accepted_by_the_edit_endpoint(client):
    token = upload(client, data=tinted_page()).get_json()["id"]
    response = client.post("/api/edit", json={"id": token, "strokes": [], "whiten": True})

    assert response.status_code == 200
    assert response.get_json()["cutout"].startswith("data:image/webp;base64,")


def test_whiten_defaults_to_off(client):
    token = upload(client, data=tinted_page()).get_json()["id"]
    default = client.get(f"/api/download/{token}?background=white").data
    explicit = client.get(f"/api/download/{token}?background=white&whiten=0").data
    assert default == explicit


def test_store_evicts_the_oldest_result():
    store = web.ResultStore(max_items=2, ttl=600)
    now = time.time()
    tokens = [
        store.put(
            web.Result(
                foreground=np.zeros((4, 4, 3), np.uint8),
                mask=np.zeros((4, 4), np.float32),
                name="x",
                created=now + i,
            )
        )
        for i in range(3)
    ]

    assert store.get(tokens[0]) is None, "the oldest result should have been evicted"
    assert store.get(tokens[2]) is not None


def test_store_expires_old_results():
    store = web.ResultStore(max_items=8, ttl=0.0)
    token = store.put(
        web.Result(
            foreground=np.zeros((4, 4, 3), np.uint8),
            mask=np.zeros((4, 4), np.float32),
            name="x",
            created=0.0,
        )
    )
    assert store.get(token) is None
