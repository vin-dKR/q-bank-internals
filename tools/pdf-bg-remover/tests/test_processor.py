"""Tests for the image-processing pipeline.

The invariants that matter most: the subject survives, the resolution never
changes, and transparent output really is transparent.
"""

from __future__ import annotations

import io
import os
import sys

import cv2
import numpy as np
import pytest
from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import processor
from processor import ImageError


# --------------------------------------------------------------------------
# Fixtures
# --------------------------------------------------------------------------


def make_subject(width=640, height=480, bg=(248, 248, 248), fg=(40, 60, 100)):
    """A plain background with one clearly-different object on it."""
    rgb = np.full((height, width, 3), bg, np.uint8)
    truth = np.zeros((height, width), np.uint8)
    centre = (width // 2, height // 2)
    axes = (width // 5, height // 3)
    cv2.ellipse(rgb, centre, axes, 0, 0, 360, fg, -1, cv2.LINE_AA)
    cv2.ellipse(truth, centre, axes, 0, 0, 360, 255, -1, cv2.LINE_AA)
    return Image.fromarray(rgb), truth > 127


def encode(image: Image.Image, fmt="PNG", **kwargs) -> bytes:
    buffer = io.BytesIO()
    image.save(buffer, format=fmt, **kwargs)
    return buffer.getvalue()


@pytest.fixture(scope="module")
def subject():
    return make_subject()


# --------------------------------------------------------------------------
# Loading
# --------------------------------------------------------------------------


def test_loads_jpeg_png_and_webp():
    image, _ = make_subject()
    for fmt in ("JPEG", "PNG", "WEBP"):
        loaded = processor.load_image(encode(image, fmt))
        assert loaded.size == image.size
        assert loaded.mode in ("RGB", "RGBA")


def test_grayscale_is_converted_to_rgb():
    image, _ = make_subject()
    loaded = processor.load_image(encode(image.convert("L"), "PNG"))
    assert loaded.mode == "RGB"


def test_rgba_input_keeps_its_alpha_channel():
    image, _ = make_subject()
    loaded = processor.load_image(encode(image.convert("RGBA"), "PNG"))
    assert loaded.mode == "RGBA"


def test_palette_image_is_converted():
    image, _ = make_subject()
    loaded = processor.load_image(encode(image.convert("P"), "PNG"))
    assert loaded.mode in ("RGB", "RGBA")


def test_empty_upload_is_rejected():
    with pytest.raises(ImageError):
        processor.load_image(b"")


def test_non_image_bytes_are_rejected():
    with pytest.raises(ImageError):
        processor.load_image(b"this is definitely not an image" * 20)


def test_truncated_image_is_rejected():
    image, _ = make_subject()
    data = encode(image, "PNG")
    with pytest.raises(ImageError):
        processor.load_image(data[: len(data) // 3])


def test_extension_is_not_trusted():
    """A .png name on non-image bytes must still be refused."""
    with pytest.raises(ImageError):
        processor.load_image(b"\x89PNG\r\n\x1a\n" + b"garbage" * 50)


# --------------------------------------------------------------------------
# EXIF orientation
# --------------------------------------------------------------------------


def test_exif_orientation_is_applied():
    """Orientation 6 means "rotate 90 deg", so width and height swap."""
    image, _ = make_subject(width=400, height=300)

    exif = Image.Exif()
    exif[0x0112] = 6
    data = encode(image, "JPEG", exif=exif.tobytes(), quality=95)

    loaded = processor.load_image(data)
    assert loaded.size == (300, 400), "EXIF orientation was not applied"


def test_image_without_exif_is_not_rotated():
    image, _ = make_subject(width=400, height=300)
    loaded = processor.load_image(encode(image, "JPEG", quality=95))
    assert loaded.size == (400, 300)


# --------------------------------------------------------------------------
# Segmentation
# --------------------------------------------------------------------------


def test_mask_matches_image_dimensions(subject):
    image, _ = subject
    foreground, mask = processor.remove_background(image)

    assert foreground.shape[:2] == (image.height, image.width)
    assert mask.shape == (image.height, image.width)
    assert foreground.dtype == np.uint8
    assert mask.dtype == np.float32


def test_mask_is_a_normalised_alpha_map(subject):
    image, _ = subject
    _, mask = processor.remove_background(image)
    assert mask.min() >= 0.0 and mask.max() <= 1.0


def test_subject_is_fully_preserved(subject):
    """The headline requirement: never cut into the object."""
    image, truth = subject
    _, mask = processor.remove_background(image)

    kept = (mask > 0.5)
    recall = (kept & truth).sum() / truth.sum()
    assert recall > 0.97, f"only {recall:.1%} of the subject survived"


def test_background_is_actually_removed(subject):
    image, truth = subject
    _, mask = processor.remove_background(image)

    background_alpha = mask[~truth]
    assert background_alpha.mean() < 0.10, "most of the background is still opaque"


def test_object_the_same_colour_as_the_background_is_kept():
    """A white shirt on a white backdrop must not be punched through."""
    rgb = np.full((480, 640, 3), 252, np.uint8)
    cv2.ellipse(rgb, (320, 240), (140, 190), 0, 0, 360, (30, 30, 35), -1, cv2.LINE_AA)
    cv2.ellipse(rgb, (320, 270), (90, 110), 0, 0, 360, (250, 250, 250), -1, cv2.LINE_AA)

    _, mask = processor.remove_background(Image.fromarray(rgb))

    # Sample the middle of the same-coloured interior region.
    assert mask[270, 320] > 0.9, "the background-coloured interior was removed"


def test_thin_features_survive():
    """Antennas, spokes and stems must not be eroded away."""
    rgb = np.full((480, 640, 3), 245, np.uint8)
    cv2.rectangle(rgb, (250, 240), (390, 400), (40, 40, 40), -1)
    cv2.line(rgb, (250, 240), (190, 90), (40, 40, 40), 3, cv2.LINE_AA)
    cv2.line(rgb, (390, 240), (450, 90), (40, 40, 40), 3, cv2.LINE_AA)

    _, mask = processor.remove_background(Image.fromarray(rgb))

    assert mask[100, 192] > 0.4, "the left thin feature was removed"
    assert mask[100, 448] > 0.4, "the right thin feature was removed"


def test_subject_touching_the_frame_is_kept():
    rgb = np.full((480, 640, 3), 240, np.uint8)
    cv2.rectangle(rgb, (160, 160), (480, 480), (80, 120, 60), -1)

    _, mask = processor.remove_background(Image.fromarray(rgb))
    assert mask[470, 320] > 0.9, "the part running off the frame was removed"


def test_many_small_marks_survive_next_to_one_large_one():
    """A photographed page: text must not be discarded as noise.

    Every word is thousands of times smaller than a diagram on the same page,
    so blobs must not be judged against the largest one.
    """
    page = np.full((560, 900, 3), (226, 200, 203), np.uint8)
    ink = (70, 45, 48)

    cv2.putText(page, "The diagram is given below.", (50, 60),
                cv2.FONT_HERSHEY_SIMPLEX, 0.9, ink, 2, cv2.LINE_AA)
    cv2.ellipse(page, (450, 330), (210, 110), 0, 0, 360, ink, -1, cv2.LINE_AA)

    _, mask = processor.remove_background(Image.fromarray(page))

    text = np.zeros((560, 900), np.uint8)
    cv2.putText(text, "The diagram is given below.", (50, 60),
                cv2.FONT_HERSHEY_SIMPLEX, 0.9, 255, 2, cv2.LINE_AA)
    strokes = text > 200

    assert mask[strokes].mean() > 0.8, "the text was deleted as specks"
    assert mask[330, 450] > 0.9, "the diagram was removed"


def test_backdrop_behind_a_thin_fence_is_removed():
    """A table cell is backdrop enclosed by hairline rules -- not subject.

    Contrast with the shirt above, which is enclosed by something thick.
    """
    rgb = np.full((500, 700, 3), 245, np.uint8)
    ink = (60, 50, 50)
    for x in (100, 300, 500, 600):
        cv2.line(rgb, (x, 120), (x, 380), ink, 2)
    for y in (120, 250, 380):
        cv2.line(rgb, (100, y), (600, y), ink, 2)

    _, mask = processor.remove_background(Image.fromarray(rgb))

    assert mask[200, 200] < 0.2, "backdrop inside a thin-ruled cell was kept"
    assert mask[250, 300] > 0.5, "the table rule itself was removed"


def test_cast_shadow_is_removed():
    """A soft shadow on the backdrop is backdrop, not subject."""
    rgb = np.full((480, 640, 3), 246, np.uint8)
    shadow = np.zeros((480, 640), np.float32)
    cv2.ellipse(shadow, (330, 400), (170, 34), 0, 0, 360, 1.0, -1)
    shadow = cv2.GaussianBlur(shadow, (0, 0), 22)
    rgb = np.clip(rgb.astype(np.float32) - shadow[..., None] * 36, 0, 255).astype(np.uint8)
    cv2.ellipse(rgb, (320, 240), (90, 140), 0, 0, 360, (55, 80, 130), -1, cv2.LINE_AA)

    _, mask = processor.remove_background(Image.fromarray(rgb))

    assert mask[240, 320] > 0.9, "the subject was removed"
    assert mask[400, 200] < 0.3, "the cast shadow was kept as foreground"


def test_neutral_grey_object_is_not_mistaken_for_a_shadow():
    """A grey object shares the backdrop's hue and is darker -- like a shadow.

    Its sharp outline is what must save it.
    """
    rgb = np.full((480, 640, 3), 250, np.uint8)
    cv2.rectangle(rgb, (220, 150), (420, 350), (175, 175, 175), -1)

    _, mask = processor.remove_background(Image.fromarray(rgb))

    assert mask[250, 320] > 0.9, "a plain grey object was deleted as a shadow"
    assert mask[250, 240] > 0.9, "the grey object was partly deleted"


def test_existing_transparency_is_respected():
    rgb = np.full((300, 300, 3), 250, np.uint8)
    cv2.circle(rgb, (150, 150), 90, (30, 40, 60), -1, cv2.LINE_AA)
    alpha = np.full((300, 300), 255, np.uint8)
    alpha[:60, :] = 0  # caller already marked this strip as transparent

    image = Image.fromarray(np.dstack([rgb, alpha]), mode="RGBA")
    _, mask = processor.remove_background(image)

    assert mask[20, 150] == 0.0, "pre-existing transparency was overridden"


def test_original_image_is_not_modified(subject):
    image, _ = subject
    before = np.asarray(image.convert("RGB")).copy()
    processor.remove_background(image)
    assert np.array_equal(before, np.asarray(image.convert("RGB")))


# --------------------------------------------------------------------------
# Compositing
# --------------------------------------------------------------------------


def test_white_background(subject):
    image, truth = subject
    foreground, mask = processor.remove_background(image)
    out = processor.apply_background(foreground, mask, "white")

    assert out.mode == "RGB"
    assert out.size == image.size
    pixels = np.asarray(out)
    assert pixels[2, 2].tolist() == [255, 255, 255], "corner is not white"


def test_black_background(subject):
    image, _ = subject
    foreground, mask = processor.remove_background(image)
    out = processor.apply_background(foreground, mask, "black")

    assert out.mode == "RGB"
    assert np.asarray(out)[2, 2].tolist() == [0, 0, 0], "corner is not black"


def test_transparent_background_has_a_real_alpha_channel(subject):
    image, truth = subject
    foreground, mask = processor.remove_background(image)
    out = processor.apply_background(foreground, mask, "transparent")

    assert out.mode == "RGBA"
    assert out.size == image.size

    alpha = np.asarray(out)[..., 3]
    assert alpha[2, 2] == 0, "background corner is opaque"
    assert alpha[truth].mean() > 240, "the subject is not opaque"


def test_custom_hex_background(subject):
    image, _ = subject
    foreground, mask = processor.remove_background(image)
    out = processor.apply_background(foreground, mask, "#ff8800")
    assert np.asarray(out)[2, 2].tolist() == [255, 136, 0]


def test_invalid_background_is_rejected(subject):
    image, _ = subject
    foreground, mask = processor.remove_background(image)
    with pytest.raises(ImageError):
        processor.apply_background(foreground, mask, "chartreuse-ish")


def test_mismatched_mask_is_rejected():
    with pytest.raises(ValueError):
        processor.apply_background(
            np.zeros((10, 10, 3), np.uint8), np.zeros((5, 5), np.float32), "white"
        )


@pytest.mark.parametrize("background", ["white", "black", "transparent", "#123456"])
def test_output_resolution_always_matches_input(background):
    image, _ = make_subject(width=523, height=317)  # deliberately odd numbers
    foreground, mask = processor.remove_background(image)
    out = processor.apply_background(foreground, mask, background)
    assert out.size == image.size


# --------------------------------------------------------------------------
# Encoding
# --------------------------------------------------------------------------


def test_png_round_trip_keeps_transparency(subject):
    image, _ = subject
    foreground, mask = processor.remove_background(image)
    out = processor.apply_background(foreground, mask, "transparent")

    data = processor.encode_image(out, "png")
    reopened = Image.open(io.BytesIO(data))

    assert reopened.mode == "RGBA"
    assert reopened.size == image.size
    assert np.asarray(reopened)[..., 3].min() == 0


def test_jpeg_output_is_rgb_and_high_quality(subject):
    image, _ = subject
    foreground, mask = processor.remove_background(image)
    out = processor.apply_background(foreground, mask, "white")

    data = processor.encode_image(out, "jpg")
    reopened = Image.open(io.BytesIO(data))

    assert reopened.format == "JPEG"
    assert reopened.size == image.size


def test_jpeg_refuses_transparency(subject):
    image, _ = subject
    foreground, mask = processor.remove_background(image)
    out = processor.apply_background(foreground, mask, "transparent")

    with pytest.raises(ImageError):
        processor.encode_image(out, "jpg")


def test_unknown_output_format_is_rejected(subject):
    image, _ = subject
    foreground, mask = processor.remove_background(image)
    out = processor.apply_background(foreground, mask, "white")

    with pytest.raises(ImageError):
        processor.encode_image(out, "gif")


# --------------------------------------------------------------------------
# Paper whitening
# --------------------------------------------------------------------------


def lit_page(width=800, height=560):
    """A photographed page: colour cast, uneven lighting, ink."""
    yy, xx = np.mgrid[0:height, 0:width].astype(np.float32)
    lighting = (1.0 - 0.30 * (xx / width)) * (1.0 - 0.10 * (yy / height))
    page = np.dstack([lighting * 236, lighting * 208, lighting * 212])
    page = np.clip(page, 0, 255).astype(np.uint8)

    ink = (60, 40, 44)
    cv2.putText(page, "The diagram is given below", (40, 70),
                cv2.FONT_HERSHEY_SIMPLEX, 0.9, ink, 2, cv2.LINE_AA)
    cv2.ellipse(page, (400, 320), (150, 70), 0, 0, 360, ink, -1, cv2.LINE_AA)

    marks = np.zeros((height, width), np.uint8)
    cv2.putText(marks, "The diagram is given below", (40, 70),
                cv2.FONT_HERSHEY_SIMPLEX, 0.9, 255, 2, cv2.LINE_AA)
    cv2.ellipse(marks, (400, 320), (150, 70), 0, 0, 360, 255, -1, cv2.LINE_AA)
    paper = ~cv2.dilate(marks, np.ones((11, 11), np.uint8)).astype(bool)

    return page, paper, marks > 200


def test_whitening_makes_paper_pure_white_everywhere():
    """The whole point: the page must match a pure white background."""
    page, paper, _ = lit_page()
    out = processor.whiten_paper(page)

    assert out[paper].min() == 255, "some paper is still darker than white"


def test_whitening_fixes_the_dark_side_not_just_the_bright_side():
    """A global brightness bump would leave the shaded edge grey."""
    page, paper, _ = lit_page()
    out = processor.whiten_paper(page)

    left = out[:, :120][paper[:, :120]].mean()
    right = out[:, -120:][paper[:, -120:]].mean()

    assert abs(left - right) < 1.0, "the lighting gradient survived"
    assert right == 255.0


def test_whitening_removes_the_colour_cast():
    page, paper, _ = lit_page()
    out = processor.whiten_paper(page)

    channels = out[paper].reshape(-1, 3).mean(axis=0)
    assert channels.max() - channels.min() < 1.0, "the paper is still tinted"


def test_whitening_keeps_ink_dark():
    page, _, marks = lit_page()
    out = processor.whiten_paper(page)

    assert out[marks].mean() < 150, "the ink was washed out"


def soft_page(width=900, height=620):
    """A page as a phone actually captures it: soft focus, grey ink, noise.

    Printed text in a photograph is nothing like pure black. Pinning only the
    white end of the range lets ink this light drift up into the paper and
    disappear, which is the failure this fixture exists to catch.
    """
    yy, xx = np.mgrid[0:height, 0:width].astype(np.float32)
    light = (1.0 - 0.26 * (xx / width)) * (1.0 - 0.10 * (yy / height))
    page = np.clip(
        np.dstack([light * 232, light * 205, light * 210]), 0, 255
    ).astype(np.uint8)

    ink = (78, 58, 64)
    lines = ["(1) A - Cartilage fish, B - Bony fish",
             "(2) A - Cartilage fish, B - Cartilage fish"]
    for i, line in enumerate(lines):
        cv2.putText(page, line, (40, 300 + i * 60),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.8, ink, 2, cv2.LINE_AA)

    marks = np.zeros((height, width), np.uint8)
    for i, line in enumerate(lines):
        cv2.putText(marks, line, (40, 300 + i * 60),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.8, 255, 2, cv2.LINE_AA)

    page = cv2.GaussianBlur(page, (0, 0), 1.4)
    page = np.clip(
        page.astype(np.float32) + np.random.default_rng(4).normal(0, 3.0, page.shape),
        0, 255,
    ).astype(np.uint8)

    paper = np.zeros((height, width), bool)
    paper[430:600, 30:870] = True          # blank strip below the text
    return page, paper, marks > 150


def test_whitening_keeps_soft_photographed_text_readable():
    """The regression that matters: grey text must not vanish into the page."""
    page, _, marks = soft_page()
    out = processor.whiten_paper(page)

    assert out[marks].mean() < 150, (
        f"soft text washed out to {out[marks].mean():.0f} -- it is disappearing"
    )


def test_whitening_a_soft_page_still_reaches_pure_white():
    page, paper, _ = soft_page()
    out = processor.whiten_paper(page)
    assert out[paper].min() == 255


def test_whitening_increases_contrast_between_ink_and_paper():
    page, paper, marks = soft_page()
    out = processor.whiten_paper(page)

    before = page[paper].mean() - page[marks].mean()
    after = out[paper].mean() - out[marks].mean()
    assert after > before * 1.4, "the page was not actually enhanced"


def test_whitening_deepens_rather_than_flattens_detail():
    """Hatching and halftones should gain contrast, not turn into flat grey."""
    page, _, _ = soft_page()
    region = np.s_[280:360, 30:800]

    before = page[region].std()
    after = processor.whiten_paper(page)[region].std()
    assert after > before, "detail was flattened"


def test_whitening_keeps_a_large_black_area_black():
    """A fine pass fits inside a big dark shape; it must not read it as paper."""
    page, _, _ = soft_page()
    cv2.rectangle(page, (500, 60), (840, 240), (70, 52, 58), -1)

    out = processor.whiten_paper(page)
    assert out[100:200, 540:800].mean() < 120, "a large dark block was washed out"


def test_whitening_does_not_blow_out_a_large_dark_shape():
    page, _, _ = lit_page()
    out = processor.whiten_paper(page)
    assert out[320, 400].mean() < 170, "the big drawing was erased as shadow"


def test_whitening_preserves_size_and_dtype():
    page, _, _ = lit_page(width=523, height=317)
    out = processor.whiten_paper(page)
    assert out.shape == page.shape and out.dtype == np.uint8


def test_whitening_never_modifies_its_input():
    page, _, _ = lit_page()
    before = page.copy()
    processor.whiten_paper(page)
    assert np.array_equal(page, before)


def test_whitening_strength_zero_is_a_no_op():
    page, _, _ = lit_page()
    assert np.array_equal(processor.whiten_paper(page, strength=0.0), page)


def test_whitening_strength_blends():
    page, paper, _ = lit_page()
    half = processor.whiten_paper(page, strength=0.5)[paper].mean()
    full = processor.whiten_paper(page, strength=1.0)[paper].mean()
    assert page[paper].mean() < half < full


def test_whitening_a_tiny_image_does_not_crash():
    tiny = np.full((5, 7, 3), 200, np.uint8)
    out = processor.whiten_paper(tiny)
    assert out.shape == tiny.shape


# --------------------------------------------------------------------------
# Manual brush strokes
# --------------------------------------------------------------------------


def flat_mask(height=200, width=300, value=1.0):
    return np.full((height, width), value, np.float32)


def flat_image(height=200, width=300, value=128):
    return np.full((height, width, 3), value, np.uint8)


def test_erase_stroke_clears_where_it_is_painted():
    mask = flat_mask()
    out = processor.apply_strokes(
        mask,
        flat_image(),
        [{"mode": "erase", "radius": 0.08, "points": [[0.5, 0.5]]}],
        snap_to_edges=False,
    )
    assert out[100, 150] < 0.05, "the centre of an erase stroke is still opaque"
    assert out[10, 10] == 1.0, "the stroke leaked across the whole mask"


def test_restore_stroke_brings_alpha_back():
    mask = flat_mask(value=0.0)
    out = processor.apply_strokes(
        mask,
        flat_image(),
        [{"mode": "restore", "radius": 0.08, "points": [[0.5, 0.5]]}],
        snap_to_edges=False,
    )
    assert out[100, 150] > 0.95, "the centre of a restore stroke is still transparent"
    assert out[10, 10] == 0.0


def test_strokes_apply_in_order_so_the_last_one_wins():
    mask = flat_mask()
    point = [[0.5, 0.5]]
    out = processor.apply_strokes(
        mask,
        flat_image(),
        [
            {"mode": "erase", "radius": 0.1, "points": point},
            {"mode": "restore", "radius": 0.1, "points": point},
        ],
        snap_to_edges=False,
    )
    assert out[100, 150] > 0.95, "the later restore did not override the erase"


def test_a_dragged_stroke_covers_the_whole_path():
    mask = flat_mask()
    out = processor.apply_strokes(
        mask,
        flat_image(),
        [{"mode": "erase", "radius": 0.03, "points": [[0.2, 0.5], [0.5, 0.5], [0.8, 0.5]]}],
        snap_to_edges=False,
    )
    for x in (0.2, 0.35, 0.5, 0.65, 0.8):
        assert out[100, int(x * 300)] < 0.1, f"gap in the stroke at x={x}"


def test_stroke_edges_are_soft():
    mask = flat_mask()
    out = processor.apply_strokes(
        mask,
        flat_image(),
        [{"mode": "erase", "radius": 0.1, "points": [[0.5, 0.5]]}],
        snap_to_edges=False,
    )
    band = out[100, :]
    assert np.any((band > 0.05) & (band < 0.95)), "the brush left a hard-edged hole"


def test_strokes_never_modify_the_mask_they_are_given():
    mask = flat_mask()
    before = mask.copy()
    processor.apply_strokes(
        mask, flat_image(),
        [{"mode": "erase", "radius": 0.2, "points": [[0.5, 0.5]]}],
        snap_to_edges=False,
    )
    assert np.array_equal(mask, before)


def test_strokes_keep_the_mask_shape_and_range():
    mask = flat_mask()
    out = processor.apply_strokes(
        mask, flat_image(),
        [
            {"mode": "erase", "radius": 0.3, "points": [[0.1, 0.1], [0.9, 0.9]]},
            {"mode": "restore", "radius": 0.2, "points": [[0.5, 0.2]]},
        ],
    )
    assert out.shape == mask.shape and out.dtype == np.float32
    assert out.min() >= 0.0 and out.max() <= 1.0


def test_strokes_at_the_very_edge_do_not_crash():
    mask = flat_mask()
    for point in ([[0.0, 0.0]], [[1.0, 1.0]], [[0.0, 1.0]], [[1.0, 0.0]]):
        out = processor.apply_strokes(
            mask, flat_image(), [{"mode": "erase", "radius": 0.05, "points": point}]
        )
        assert out.shape == mask.shape


def test_unknown_or_empty_strokes_are_ignored():
    mask = flat_mask()
    out = processor.apply_strokes(
        mask,
        flat_image(),
        [
            {"mode": "sharpen", "radius": 0.2, "points": [[0.5, 0.5]]},
            {"mode": "erase", "radius": 0.2, "points": []},
            {},
        ],
        snap_to_edges=False,
    )
    assert np.array_equal(out, mask)


def test_snapping_pulls_the_stroke_onto_a_real_edge():
    """A stroke painted across a sharp boundary should follow it."""
    image = np.full((200, 300, 3), 240, np.uint8)
    image[:, 150:] = 20                       # a hard vertical edge at x=150
    mask = flat_mask()

    stroke = [{"mode": "erase", "radius": 0.12, "points": [[0.5, 0.5]]}]
    plain = processor.apply_strokes(mask, image, stroke, snap_to_edges=False)
    snapped = processor.apply_strokes(mask, image, stroke, snap_to_edges=True)

    # Snapping should separate the two sides of the edge more than a plain
    # round dab, which treats both sides identically.
    left, right = slice(120, 148), slice(152, 180)
    assert abs(snapped[100, left].mean() - snapped[100, right].mean()) > \
           abs(plain[100, left].mean() - plain[100, right].mean())


# --------------------------------------------------------------------------
# Background parsing
# --------------------------------------------------------------------------


@pytest.mark.parametrize(
    "value,expected",
    [
        ("white", (255, 255, 255)),
        ("WHITE", (255, 255, 255)),
        ("black", (0, 0, 0)),
        ("transparent", None),
        ("#00ff7f", (0, 255, 127)),
        ("00ff7f", (0, 255, 127)),
        ("", (255, 255, 255)),
    ],
)
def test_parse_background(value, expected):
    assert processor.parse_background(value) == expected
