/* Image Background Remover -- browser side.
 *
 * The server returns the cut-out as a transparent WEBP once. Switching between
 * white, black and transparent only changes the backdrop CSS behind it, so
 * previews are instant and the image is uploaded exactly once.
 */

(function () {
  "use strict";

  const dropzone     = document.getElementById("dropzone");
  const fileInput    = document.getElementById("fileInput");
  const chooseBtn    = document.getElementById("chooseBtn");
  const progress     = document.getElementById("progress");
  const progressText = document.getElementById("progressText");
  const result       = document.getElementById("result");
  const beforeImg    = document.getElementById("beforeImg");
  const afterStage   = document.getElementById("afterStage");
  const afterCanvas  = document.getElementById("afterCanvas");
  const brushCursor  = document.getElementById("brushCursor");
  const downloadBtn  = document.getElementById("downloadBtn");
  const resetBtn     = document.getElementById("resetBtn");
  const meta         = document.getElementById("meta");
  const errorBox     = document.getElementById("error");

  const brushSize    = document.getElementById("brushSize");
  const snapEdges    = document.getElementById("snapEdges");
  const whitenPaper  = document.getElementById("whitenPaper");
  const undoBtn      = document.getElementById("undoBtn");
  const clearEditsBtn = document.getElementById("clearEditsBtn");
  const retouchStatus = document.getElementById("retouchStatus");

  const bgButtons    = document.querySelectorAll("[data-bg].segmented__btn");
  const fmtButtons   = document.querySelectorAll("[data-format]");
  const brushButtons = document.querySelectorAll("[data-brush]");

  /* The stages the server actually works through, shown on a timer because a
     single POST gives us no finer-grained progress to report. */
  const STAGES = [
    "Reading image…",
    "Analysing the background…",
    "Separating the subject…",
    "Refining edges…",
    "Finishing up…",
  ];

  let current    = null;      // { id, width, height, elapsed }
  let background = "white";
  let format     = "png";
  let stageTimer = null;

  /* -- retouch state ---------------------------------------------------- */

  const ctx        = afterCanvas.getContext("2d");
  const eraseLayer = document.createElement("canvas");   // what the brush removed
  const keepLayer  = document.createElement("canvas");   // what the brush brought back
  const scratch    = document.createElement("canvas");   // temp for masked draws

  let cutoutImg   = new Image();   // current result, from the server
  let originalImg = new Image();   // the untouched upload, for Restore
  let strokes     = [];            // every stroke since upload, in order
  let painting    = null;          // the stroke in progress
  let brushMode   = "erase";
  let syncSeq     = 0;             // guards against out-of-order responses

  /* -- view state ------------------------------------------------------- */

  function show(section) {
    dropzone.hidden = section !== "upload";
    progress.hidden = section !== "working";
    result.hidden   = section !== "result";
  }

  function showError(message) {
    errorBox.textContent = message;
    errorBox.hidden = false;
  }

  function clearError() {
    errorBox.hidden = true;
    errorBox.textContent = "";
  }

  function startStages() {
    let index = 0;
    progressText.textContent = STAGES[0];
    stageTimer = setInterval(function () {
      index = Math.min(index + 1, STAGES.length - 1);
      progressText.textContent = STAGES[index];
    }, 900);
  }

  function stopStages() {
    clearInterval(stageTimer);
    stageTimer = null;
  }

  /* -- retouch: painting ------------------------------------------------ */

  function sizeLayers(width, height) {
    [afterCanvas, eraseLayer, keepLayer, scratch].forEach(function (canvas) {
      canvas.width = width;
      canvas.height = height;
    });
  }

  function clearLayers() {
    [eraseLayer, keepLayer].forEach(function (canvas) {
      canvas.getContext("2d").clearRect(0, 0, canvas.width, canvas.height);
    });
  }

  /* Draw one dab or segment into a layer. `erase` punches it back out of the
     opposite layer, so whichever stroke came last is the one that wins. */
  function stamp(layer, stroke, from, to, erase) {
    const c = layer.getContext("2d");
    c.save();
    c.globalCompositeOperation = erase ? "destination-out" : "source-over";
    c.strokeStyle = c.fillStyle = "#fff";
    c.lineWidth = stroke.px * 2;
    c.lineCap = c.lineJoin = "round";

    if (from && (from[0] !== to[0] || from[1] !== to[1])) {
      c.beginPath();
      c.moveTo(from[0], from[1]);
      c.lineTo(to[0], to[1]);
      c.stroke();
    } else {
      c.beginPath();
      c.arc(to[0], to[1], stroke.px, 0, Math.PI * 2);
      c.fill();
    }
    c.restore();
  }

  function render() {
    if (!cutoutImg.width) return;
    const w = afterCanvas.width, h = afterCanvas.height;

    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(cutoutImg, 0, 0, w, h);

    // Restore: paint the original photo back, but only inside the kept mask.
    const s = scratch.getContext("2d");
    s.clearRect(0, 0, w, h);
    s.drawImage(originalImg, 0, 0, w, h);
    s.globalCompositeOperation = "destination-in";
    s.drawImage(keepLayer, 0, 0);
    s.globalCompositeOperation = "source-over";
    ctx.drawImage(scratch, 0, 0);

    // Erase: cut the painted area away.
    ctx.globalCompositeOperation = "destination-out";
    ctx.drawImage(eraseLayer, 0, 0);
    ctx.globalCompositeOperation = "source-over";
  }

  function canvasPoint(event) {
    const box = afterCanvas.getBoundingClientRect();
    return [
      (event.clientX - box.left) * (afterCanvas.width / box.width),
      (event.clientY - box.top) * (afterCanvas.height / box.height),
    ];
  }

  /* Brush radius is stored as a fraction of the longest edge, so a stroke
     painted on the preview lands in the same place on the full-size mask. */
  function brushRadius() {
    const displayed = afterCanvas.getBoundingClientRect().width || afterCanvas.width;
    const px = (Number(brushSize.value) / 2) * (afterCanvas.width / displayed);
    return { px: px, fraction: px / Math.max(afterCanvas.width, afterCanvas.height) };
  }

  function updateButtons() {
    undoBtn.disabled = strokes.length === 0;
    clearEditsBtn.disabled = strokes.length === 0;
  }

  afterCanvas.addEventListener("pointerdown", function (event) {
    if (!current || event.button !== 0) return;
    event.preventDefault();
    try {
      afterCanvas.setPointerCapture(event.pointerId);
    } catch (_) {
      /* Capture is a convenience, not a requirement. */
    }

    const radius = brushRadius();
    const point = canvasPoint(event);

    painting = { mode: brushMode, px: radius.px, radius: radius.fraction, points: [point] };
    stamp(brushMode === "erase" ? eraseLayer : keepLayer, painting, null, point, false);
    stamp(brushMode === "erase" ? keepLayer : eraseLayer, painting, null, point, true);
    render();
  });

  afterCanvas.addEventListener("pointermove", function (event) {
    moveCursor(event);
    if (!painting) return;

    const point = canvasPoint(event);
    const previous = painting.points[painting.points.length - 1];
    painting.points.push(point);

    stamp(painting.mode === "erase" ? eraseLayer : keepLayer, painting, previous, point, false);
    stamp(painting.mode === "erase" ? keepLayer : eraseLayer, painting, previous, point, true);
    render();
  });

  function finishStroke() {
    if (!painting) return;

    const w = afterCanvas.width, h = afterCanvas.height;
    strokes.push({
      mode: painting.mode,
      radius: painting.radius,
      points: painting.points.map(function (p) { return [p[0] / w, p[1] / h]; }),
    });

    painting = null;
    updateButtons();
    syncEdits();
  }

  afterCanvas.addEventListener("pointerup", finishStroke);
  afterCanvas.addEventListener("pointercancel", finishStroke);

  afterCanvas.addEventListener("pointerenter", function (event) {
    brushCursor.hidden = false;
    moveCursor(event);
  });

  afterCanvas.addEventListener("pointerleave", function () {
    if (!painting) brushCursor.hidden = true;
  });

  function moveCursor(event) {
    const stage = afterStage.getBoundingClientRect();
    const size = Number(brushSize.value);
    brushCursor.style.width = size + "px";
    brushCursor.style.height = size + "px";
    brushCursor.style.left = (event.clientX - stage.left) + "px";
    brushCursor.style.top = (event.clientY - stage.top) + "px";
    brushCursor.dataset.mode = brushMode;
  }

  /* -- retouch: syncing with the server --------------------------------- */

  async function syncEdits() {
    if (!current) return;

    const seq = ++syncSeq;
    retouchStatus.textContent = "Applying…";

    try {
      const response = await fetch("/api/edit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: current.id,
          strokes: strokes,
          snap: snapEdges.checked,
          whiten: whitenPaper.checked,
        }),
      });

      const payload = await response.json().catch(function () { return null; });
      if (!response.ok) {
        throw new Error((payload && payload.error) || "Could not apply that edit.");
      }
      if (seq !== syncSeq) return;   // a newer stroke already went out

      // The server's result already contains every stroke, so the local
      // layers have to go or the edits would be applied twice.
      await load(cutoutImg, payload.cutout);
      if (seq !== syncSeq) return;

      clearLayers();
      render();
      retouchStatus.textContent = strokes.length
        ? strokes.length + (strokes.length === 1 ? " edit" : " edits")
        : "";
    } catch (err) {
      if (seq === syncSeq) retouchStatus.textContent = err.message;
    }
  }

  function load(image, src) {
    return new Promise(function (resolve, reject) {
      image.onload = function () { resolve(image); };
      image.onerror = function () { reject(new Error("Could not load the preview.")); };
      image.src = src;
    });
  }

  brushButtons.forEach(function (button) {
    button.addEventListener("click", function () {
      brushMode = button.dataset.brush;
      activate(brushButtons, button);
      brushCursor.dataset.mode = brushMode;
    });
  });

  undoBtn.addEventListener("click", function () {
    if (!strokes.length) return;
    strokes.pop();
    updateButtons();
    syncEdits();
  });

  clearEditsBtn.addEventListener("click", function () {
    if (!strokes.length) return;
    strokes = [];
    updateButtons();
    syncEdits();
  });

  snapEdges.addEventListener("change", function () {
    if (strokes.length) syncEdits();   // only affects how strokes are applied
  });

  whitenPaper.addEventListener("change", syncEdits);

  /* -- segmented controls ----------------------------------------------- */

  function activate(buttons, button) {
    buttons.forEach(function (other) {
      const isActive = other === button;
      other.classList.toggle("is-active", isActive);
      other.setAttribute("aria-checked", String(isActive));
    });
  }

  bgButtons.forEach(function (button) {
    button.addEventListener("click", function () {
      background = button.dataset.bg;
      activate(bgButtons, button);
      afterStage.dataset.bg = background;

      // JPEG has no alpha channel, so it cannot hold a transparent result.
      fmtButtons.forEach(function (fmtButton) {
        if (fmtButton.dataset.format === "jpg") {
          fmtButton.disabled = background === "transparent";
        }
      });

      if (background === "transparent" && format === "jpg") {
        const png = document.querySelector('[data-format="png"]');
        format = "png";
        activate(fmtButtons, png);
      }
    });
  });

  fmtButtons.forEach(function (button) {
    button.addEventListener("click", function () {
      if (button.disabled) return;
      format = button.dataset.format;
      activate(fmtButtons, button);
    });
  });

  /* -- upload ----------------------------------------------------------- */

  chooseBtn.addEventListener("click", function (event) {
    event.stopPropagation();
    fileInput.click();
  });

  dropzone.addEventListener("click", function () { fileInput.click(); });

  dropzone.addEventListener("keydown", function (event) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      fileInput.click();
    }
  });

  fileInput.addEventListener("change", function () {
    if (fileInput.files && fileInput.files[0]) upload(fileInput.files[0]);
    fileInput.value = "";   // let the same file be picked again
  });

  ["dragenter", "dragover"].forEach(function (name) {
    dropzone.addEventListener(name, function (event) {
      event.preventDefault();
      dropzone.classList.add("is-dragging");
    });
  });

  ["dragleave", "drop"].forEach(function (name) {
    dropzone.addEventListener(name, function (event) {
      event.preventDefault();
      dropzone.classList.remove("is-dragging");
    });
  });

  dropzone.addEventListener("drop", function (event) {
    const files = event.dataTransfer && event.dataTransfer.files;
    if (files && files[0]) upload(files[0]);
  });

  // Dropping anywhere else should not make the browser navigate to the file.
  window.addEventListener("dragover", function (e) { e.preventDefault(); });
  window.addEventListener("drop", function (e) { e.preventDefault(); });

  /* -- processing ------------------------------------------------------- */

  async function upload(file) {
    clearError();

    if (!file.type.startsWith("image/") && !/\.(jpe?g|png|webp|tiff?|bmp)$/i.test(file.name)) {
      showError("That does not look like an image. Please choose a JPG, PNG, or WEBP file.");
      return;
    }

    const body = new FormData();
    body.append("image", file);

    show("working");
    startStages();

    try {
      const response = await fetch("/api/process", { method: "POST", body: body });

      let payload = null;
      try {
        payload = await response.json();
      } catch (_) {
        payload = null;
      }

      if (!response.ok) {
        throw new Error(
          (payload && payload.error) ||
          "Unable to process this image. Please try a different file."
        );
      }

      current  = payload;
      strokes  = [];
      painting = null;
      syncSeq++;                       // abandon any edit still in flight
      retouchStatus.textContent = "";
      updateButtons();

      beforeImg.src = payload.original;
      await Promise.all([
        load(cutoutImg, payload.cutout),
        load(originalImg, payload.original),
      ]);

      sizeLayers(cutoutImg.naturalWidth, cutoutImg.naturalHeight);
      clearLayers();
      render();

      meta.textContent =
        payload.width + " × " + payload.height + " pixels" +
        " · processed in " + payload.elapsed.toFixed(2) + "s" +
        " · the download keeps the original resolution";

      show("result");
    } catch (err) {
      showError(err.message);
      show("upload");
    } finally {
      stopStages();
    }
  }

  /* -- download & reset ------------------------------------------------- */

  downloadBtn.addEventListener("click", function () {
    if (!current) return;
    const url = "/api/download/" + encodeURIComponent(current.id) +
                "?background=" + encodeURIComponent(background) +
                "&format=" + encodeURIComponent(format) +
                "&whiten=" + (whitenPaper.checked ? "1" : "0");
    window.location.assign(url);
  });

  resetBtn.addEventListener("click", function () {
    current  = null;
    strokes  = [];
    painting = null;
    syncSeq++;
    retouchStatus.textContent = "";
    updateButtons();

    beforeImg.removeAttribute("src");
    cutoutImg = new Image();
    originalImg = new Image();
    ctx.clearRect(0, 0, afterCanvas.width, afterCanvas.height);
    clearLayers();

    clearError();
    show("upload");
  });

  show("upload");
})();
