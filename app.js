/* ============================================================
   Reel Factory — batch reel generator
   Runs 100% client-side via ffmpeg.wasm. No uploads, no server.
   ============================================================ */
(() => {
  "use strict";

  /* ---------- static data ---------- */
  const FORMATS = [
    { id: "reel", label: "Reel / Story", ratio: "9:16", w: 1080, h: 1920 },
    { id: "portrait", label: "Portrait post", ratio: "4:5", w: 1080, h: 1350 },
    { id: "square", label: "Square post", ratio: "1:1", w: 1080, h: 1080 },
  ];

  const FONTS = [
    {
      id: "archivo",
      label: "Archivo Black",
      family: "Archivo Black",
      weight: "400",
    },
    { id: "anton", label: "Anton", family: "Anton", weight: "400" },
    { id: "bebas", label: "Bebas Neue", family: "Bebas Neue", weight: "400" },
    {
      id: "montserrat",
      label: "Montserrat Bold",
      family: "Montserrat",
      weight: "800",
    },
    { id: "poppins", label: "Poppins Bold", family: "Poppins", weight: "700" },
    { id: "oswald", label: "Oswald", family: "Oswald", weight: "600" },
    { id: "inter", label: "Inter Bold", family: "Inter", weight: "800" },
    {
      id: "playfair",
      label: "Playfair Display",
      family: "Playfair Display",
      weight: "700",
    },
    { id: "caveat", label: "Caveat (script)", family: "Caveat", weight: "700" },
    {
      id: "pacifico",
      label: "Pacifico (script)",
      family: "Pacifico",
      weight: "400",
    },
    {
      id: "marker",
      label: "Permanent Marker",
      family: "Permanent Marker",
      weight: "400",
    },
  ];

  const BG_COLOR_PRESETS = [
    "#000000",
    "#FFFFFF",
    "#1C1D24",
    "#D6FF3D",
    "#FF5C42",
    "#8C7CFF",
    "#0E1F17",
    "#2B0E12",
  ];

  /* ---------- state ---------- */
  const state = {
    file: null,
    videoEl: null,
    meta: null,
    format: FORMATS[0],
    backgrounds: [],
    overlays: [],
    results: [],
    queue: [], // {id, bg, ov}
    videoPosition: 50, // 0=top-aligned, 50=centered, 100=bottom-aligned (global)
  };
  let idSeq = 1;
  const uid = () => "id" + idSeq++;

  let ffmpeg = null;
  let ffmpegReady = false;
  let ffmpegProgressHooked = false;

  /* ---------- batch timer state (no quality impact) ---------- */
  let batchStart = 0;
  let currentVideoStart = 0;
  let currentProgress = 0; // 0..1 for the video currently encoding
  let completedDurations = [];
  let timerInterval = null;

  function formatClock(ms) {
    if (!isFinite(ms) || ms < 0) return "0:00";
    const totalSec = Math.floor(ms / 1000);
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
    return `${m}:${String(s).padStart(2, "0")}`;
  }

  function resetTimerUI() {
    if (timerElapsed) timerElapsed.textContent = "Elapsed 0:00";
    if (timerRemaining) timerRemaining.textContent = "calculating…";
    if (timerEta) timerEta.textContent = "";
  }

  function updateTimerUI(total, done) {
    if (!timerElapsed || !timerRemaining || !timerEta) return;
    const now = performance.now();
    const elapsed = batchStart ? now - batchStart : 0;
    timerElapsed.textContent = `Elapsed ${formatClock(elapsed)}`;
    const remainingCount = total - done;
    if (remainingCount <= 0) return;
    if (!completedDurations.length && done === 0) {
      timerRemaining.textContent = "calculating…";
      timerEta.textContent = done === 0 ? `Video 1 of ${total}` : "";
      return;
    }
    const avg =
      completedDurations.length > 0
        ? completedDurations.reduce((a, b) => a + b, 0) /
          completedDurations.length
        : now - currentVideoStart;
    // Discount the part of the current video already done (if ffmpeg gave us progress).
    const currentDoneFrac =
      done < total ? Math.max(0, Math.min(1, currentProgress || 0)) : 0;
    const remainingMs =
      avg * (remainingCount - 1) + avg * (1 - currentDoneFrac);
    timerRemaining.textContent = `~${formatClock(remainingMs)} left`;
    try {
      const eta = new Date(Date.now() + Math.max(0, remainingMs));
      const etaStr = eta.toLocaleTimeString([], {
        hour: "numeric",
        minute: "2-digit",
      });
      timerEta.textContent = `Done ~${etaStr}`;
    } catch (e) {
      timerEta.textContent = "";
    }
  }

  /* ---------- element refs ---------- */
  const $ = (sel) => document.querySelector(sel);
  const dropzone = $("#dropzone");
  const dropzoneInner = $("#dropzoneInner");
  const fileInput = $("#fileInput");
  const previewVideo = $("#previewVideo");
  const sourceMeta = $("#sourceMeta");
  const changeFileBtn = $("#changeFileBtn");

  const step2 = $("#step2"),
    step3 = $("#step3"),
    step4 = $("#step4"),
    step5 = $("#step5");
  const formatGrid = $("#formatGrid");
  const videoPosition = $("#videoPosition");
  const videoPositionValue = $("#videoPositionValue");
  const videoNoRoomHint = $("#videoNoRoomHint");

  const addColorBtn = $("#addColorBtn");
  const addImageBtn = $("#addImageBtn");
  const bgImageInput = $("#bgImageInput");
  const bgList = $("#bgList");
  const bgEmptyHint = $("#bgEmptyHint");

  const overlayText = $("#overlayText");
  const overlayFont = $("#overlayFont");
  const overlayColor = $("#overlayColor");
  const overlaySize = $("#overlaySize");
  const overlayPosition = $("#overlayPosition");
  const overlayStyle = $("#overlayStyle");
  const overlayLivePreview = $("#overlayLivePreview");
  const addOverlayBtn = $("#addOverlayBtn");
  const overlayList = $("#overlayList");
  const overlayEmptyHint = $("#overlayEmptyHint");

  const comboSummary = $("#comboSummary");
  const pickBg = $("#pickBg");
  const pickOv = $("#pickOv");
  const addToQueueBtn = $("#addToQueueBtn");
  const queueList = $("#queueList");
  const generateBtn = $("#generateBtn");

  const progressArea = $("#progressArea");
  const progressFill = $("#progressFill");
  const progressLabel = $("#progressLabel");
  const timerElapsed = $("#timerElapsed");
  const timerRemaining = $("#timerRemaining");
  const timerEta = $("#timerEta");
  const filmstrip = $("#filmstrip");
  const resultsBar = $("#resultsBar");
  const resultsCount = $("#resultsCount");
  const downloadZipBtn = $("#downloadZipBtn");

  const engineDot = $("#engineDot");
  const engineStatusText = $("#engineStatusText");

  /* ============================================================
     STEP 1 — source video
     ============================================================ */
  dropzone.addEventListener("click", () => fileInput.click());
  ["dragenter", "dragover"].forEach((evt) =>
    dropzone.addEventListener(evt, (e) => {
      e.preventDefault();
      dropzone.classList.add("drag");
    }),
  );
  ["dragleave", "drop"].forEach((evt) =>
    dropzone.addEventListener(evt, (e) => {
      e.preventDefault();
      dropzone.classList.remove("drag");
    }),
  );
  dropzone.addEventListener("drop", (e) => {
    const f = e.dataTransfer.files && e.dataTransfer.files[0];
    if (f) loadSourceFile(f);
  });
  fileInput.addEventListener("change", (e) => {
    if (e.target.files[0]) loadSourceFile(e.target.files[0]);
  });
  changeFileBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    fileInput.value = "";
    fileInput.click();
  });

  function loadSourceFile(file) {
    state.file = file;
    const url = URL.createObjectURL(file);
    previewVideo.src = url;
    previewVideo.hidden = false;
    dropzoneInner.hidden = true;

    previewVideo.addEventListener(
      "loadedmetadata",
      function onMeta() {
        previewVideo.removeEventListener("loadedmetadata", onMeta);
        const w = previewVideo.videoWidth,
          h = previewVideo.videoHeight;
        const orientation =
          w === h ? "square" : w > h ? "horizontal" : "vertical";
        state.meta = { w, h, duration: previewVideo.duration, orientation };
        state.videoEl = previewVideo;

        $("#metaName").textContent =
          file.name.length > 28 ? file.name.slice(0, 25) + "…" : file.name;
        $("#metaRes").textContent = `${w}×${h}`;
        $("#metaOrient").textContent = orientation;
        $("#metaDur").textContent = formatDuration(previewVideo.duration);
        sourceMeta.hidden = false;

        unlock(step2);

        const seekTo = Math.min(0.3, (previewVideo.duration || 1) * 0.1);
        previewVideo.addEventListener(
          "seeked",
          () => {
            renderOverlayLivePreview();
            updateVideoPosUI();
          },
          { once: true },
        );
        previewVideo.currentTime = seekTo;
        renderOverlayLivePreview();
        updateVideoPosUI();
        // Hide engine load latency from the batch timer.
        if (typeof requestIdleCallback === "function") {
          requestIdleCallback(() => prewarmEngine());
        } else {
          setTimeout(() => prewarmEngine(), 500);
        }
      },
      { once: true },
    );
  }

  function formatDuration(sec) {
    if (!isFinite(sec)) return "—";
    const m = Math.floor(sec / 60),
      s = Math.round(sec % 60);
    return `${m}:${String(s).padStart(2, "0")}`;
  }

  function unlock(el) {
    el.classList.remove("locked");
  }

  /* ============================================================
     STEP 2 — format
     ============================================================ */
  function renderFormatGrid() {
    formatGrid.innerHTML = "";
    FORMATS.forEach((fmt) => {
      const div = document.createElement("div");
      div.className =
        "format-opt" + (fmt.id === state.format.id ? " active" : "");
      const shapeH = 64;
      const shapeW = Math.round(shapeH * (fmt.w / fmt.h));
      div.innerHTML = `
        <div class="format-shape" style="width:${shapeW}px;height:${shapeH}px"></div>
        <h3>${fmt.label}</h3>
        <span>${fmt.ratio} · ${fmt.w}×${fmt.h}</span>`;
      div.addEventListener("click", () => {
        state.format = fmt;
        renderFormatGrid();
        unlock(step3);
        renderOverlayLivePreview();
        updateVideoPosUI();
        updateComboSummary();
      });
      formatGrid.appendChild(div);
    });
  }
  renderFormatGrid();

  /* ============================================================
     Clip (video) vertical position, global for all outputs.
     UI lives in Step 4 next to the text overlay preview.
     0 = top-aligned, 50 = centered, 100 = bottom-aligned.
     Clamped so the clip always stays fully visible.
     ============================================================ */
  function clampVideoPos(v) {
    const n = parseInt(v, 10);
    if (!isFinite(n)) return 50;
    return Math.max(0, Math.min(100, n));
  }

  function setVideoPosition(v, rerender = true) {
    state.videoPosition = clampVideoPos(v);
    if (videoPosition) videoPosition.value = state.videoPosition;
    if (videoPositionValue)
      videoPositionValue.textContent = state.videoPosition + "%";
    if (rerender) renderOverlayLivePreview();
    updateVideoPosUI();
  }

  function videoFreeSpacePx(fmtW, fmtH, meta) {
    if (!meta || !meta.w || !meta.h) return 0;
    const scale = Math.min(fmtW / meta.w, fmtH / meta.h);
    return Math.max(0, fmtH - meta.h * scale);
  }

  function updateVideoPosUI() {
    if (!videoNoRoomHint) return;
    const free = videoFreeSpacePx(
      state.format.w,
      state.format.h,
      state.meta,
    );
    videoNoRoomHint.hidden = !(state.meta && free < 2);
    if (videoPosition) videoPosition.disabled = Boolean(state.meta && free < 2);
  }

  if (videoPosition) {
    videoPosition.addEventListener("input", () => {
      setVideoPosition(videoPosition.value);
    });
  }
  document
    .querySelectorAll(".mini-btn[data-vpos]")
    .forEach((btn) => {
      btn.addEventListener("click", () => {
        setVideoPosition(btn.dataset.vpos);
      });
    });

  // Drag the clip up/down directly in the live preview canvas.
  // Maps pointer travel onto the free letterbox space so it can never crop.
  (() => {
    if (!overlayLivePreview) return;
    let dragging = false;
    let startClientY = 0;
    let startPos = 50;
    let freeCanvasPx = 0;

    function canvasVideoMetrics() {
      const cvs = overlayLivePreview;
      const vw = state.videoEl ? state.videoEl.videoWidth : 0;
      const vh = state.videoEl ? state.videoEl.videoHeight : 0;
      if (!vw || !vh) return null;
      const scale = Math.min(cvs.width / vw, cvs.height / vh);
      const dispH = vh * scale;
      return { free: cvs.height - dispH };
    }

    overlayLivePreview.addEventListener("pointerdown", (e) => {
      const m = canvasVideoMetrics();
      if (!m || m.free < 2) return;
      dragging = true;
      startClientY = e.clientY;
      startPos = state.videoPosition;
      freeCanvasPx = m.free;
      overlayLivePreview.classList.add("dragging");
      overlayLivePreview.setPointerCapture(e.pointerId);
      e.preventDefault();
    });
    overlayLivePreview.addEventListener("pointermove", (e) => {
      if (!dragging) return;
      const rect = overlayLivePreview.getBoundingClientRect();
      const scaleY = overlayLivePreview.height / rect.height;
      const dyCanvas = (e.clientY - startClientY) * scaleY;
      const dPct = freeCanvasPx > 0 ? (dyCanvas / freeCanvasPx) * 100 : 0;
      setVideoPosition(Math.round(startPos + dPct));
    });
    const endDrag = () => {
      dragging = false;
      overlayLivePreview.classList.remove("dragging");
    };
    overlayLivePreview.addEventListener("pointerup", endDrag);
    overlayLivePreview.addEventListener("pointercancel", endDrag);
  })();
  setVideoPosition(50, false);

  /* ============================================================
     STEP 3 — backgrounds
     ============================================================ */
  addColorBtn.addEventListener("click", () => {
    const picker = document.createElement("input");
    picker.type = "color";
    picker.value =
      BG_COLOR_PRESETS[state.backgrounds.length % BG_COLOR_PRESETS.length];
    picker.addEventListener(
      "input",
      () => {
        addBackground({
          id: uid(),
          type: "color",
          value: picker.value,
          name: picker.value.toUpperCase(),
        });
      },
      { once: true },
    );
    picker.click();
  });

  addImageBtn.addEventListener("click", () => bgImageInput.click());
  bgImageInput.addEventListener("change", async (e) => {
    const files = Array.from(e.target.files || []);
    for (const f of files) {
      const url = URL.createObjectURL(f);
      const img = await loadImage(url);
      addBackground({
        id: uid(),
        type: "image",
        value: url,
        img,
        name: f.name.replace(/\.[^.]+$/, ""),
      });
    }
    bgImageInput.value = "";
  });

  function loadImage(src) {
    return new Promise((res, rej) => {
      const img = new Image();
      img.onload = () => res(img);
      img.onerror = rej;
      img.src = src;
    });
  }

  function addBackground(bg) {
    state.backgrounds.push(bg);
    renderBgList();
    unlock(step4);
    updateComboSummary();
    renderOverlayLivePreview();
    pickBg.value = bg.id;
  }
  function renderBgList() {
    bgList.innerHTML = "";
    bgEmptyHint.hidden = state.backgrounds.length > 0;
    state.backgrounds.forEach((bg) => {
      const chip = document.createElement("div");
      chip.className = "bg-chip";
      if (bg.type === "color") chip.style.background = bg.value;
      else chip.style.backgroundImage = `url(${bg.value})`;
      chip.innerHTML = `<button class="remove-x" title="remove">✕</button><span class="bg-name">${escapeHtml(bg.name)}</span>`;
      chip.querySelector(".remove-x").addEventListener("click", () => {
        state.backgrounds = state.backgrounds.filter((b) => b.id !== bg.id);
        renderBgList();
        updateComboSummary();
        renderOverlayLivePreview();
      });
      bgList.appendChild(chip);
    });
  }

  /* ============================================================
     STEP 4 — text overlays
     ============================================================ */
  FONTS.forEach((f) => {
    const opt = document.createElement("option");
    opt.value = f.id;
    opt.textContent = f.label;
    opt.style.fontFamily = `"${f.family}"`;
    overlayFont.appendChild(opt);
  });

  [
    overlayText,
    overlayFont,
    overlayColor,
    overlaySize,
    overlayPosition,
    overlayStyle,
  ].forEach((el) => el.addEventListener("input", renderOverlayLivePreview));

  async function renderOverlayLivePreview() {
    resizeLivePreviewCanvas();
    const cvs = overlayLivePreview;
    const ctx = cvs.getContext("2d");
    ctx.clearRect(0, 0, cvs.width, cvs.height);

    const bg = state.backgrounds[0] || null;
    drawBackground(ctx, bg, cvs.width, cvs.height);
    drawContainVideoFrame(
      ctx,
      state.videoEl,
      cvs.width,
      cvs.height,
      state.videoPosition,
    );

    const fmt = state.format;
    const scale = cvs.height / fmt.h;
    const overlay = currentOverlayDraft();
    if (!overlay.text.trim()) return;
    await drawTextOverlay(ctx, overlay, cvs.width, cvs.height, scale);
  }

  function currentOverlayDraft() {
    return {
      text: overlayText.value,
      fontId: overlayFont.value,
      color: overlayColor.value,
      size: parseInt(overlaySize.value, 10),
      position: parseInt(overlayPosition.value, 10),
      style: overlayStyle.value,
    };
  }

  overlayPosition.addEventListener("input", () => {
    $("#overlayPositionValue").textContent = overlayPosition.value + "%";
  });
  document
    .querySelectorAll(".position-presets .mini-btn[data-pos]")
    .forEach((btn) => {
      btn.addEventListener("click", () => {
        overlayPosition.value = btn.dataset.pos;
        overlayPosition.dispatchEvent(new Event("input"));
      });
    });

  function autoPositionAboveVideo() {
    if (!state.meta) return;
    const fmt = state.format;
    const scale = Math.min(fmt.w / state.meta.w, fmt.h / state.meta.h);
    const videoDisplayHeight = state.meta.h * scale;
    const vPos = clampVideoPos(state.videoPosition) / 100;
    const videoTopPx = (fmt.h - videoDisplayHeight) * vPos;
    const size = parseInt(overlaySize.value, 10) || 64;
    const gapPx = fmt.h * 0.02;
    const approxTextHeight = size * 1.3;
    const desiredCenterPx = videoTopPx - gapPx - approxTextHeight / 2;
    const pct = Math.max(
      3,
      Math.min(95, Math.round((desiredCenterPx / fmt.h) * 100)),
    );
    overlayPosition.value = pct;
    overlayPosition.dispatchEvent(new Event("input"));
  }
  $("#autoAboveBtn").addEventListener("click", autoPositionAboveVideo);

  function resizeLivePreviewCanvas() {
    const targetH = 260;
    overlayLivePreview.height = targetH;
    overlayLivePreview.width = Math.round(
      targetH * (state.format.w / state.format.h),
    );
  }

  addOverlayBtn.addEventListener("click", () => {
    const draft = currentOverlayDraft();
    if (!draft.text.trim()) {
      overlayText.focus();
      return;
    }
    draft.id = uid();
    state.overlays.push(draft);
    renderOverlayList();
    overlayText.value = "";
    renderOverlayLivePreview();
    updateComboSummary();
    pickOv.value = draft.id;
  });

  function renderOverlayList() {
    overlayList.innerHTML = "";
    overlayEmptyHint.hidden = state.overlays.length > 0;
    state.overlays.forEach((ov) => {
      const font = FONTS.find((f) => f.id === ov.fontId);
      const row = document.createElement("div");
      row.className = "overlay-row";
      row.innerHTML = `
        <div class="swatch" style="color:${ov.color}; font-family:'${font.family}'; font-weight:${font.weight}">${escapeHtml(ov.text.slice(0, 14))}</div>
        <div class="info">
          <div class="txt">${escapeHtml(ov.text)}</div>
          <div class="meta">${font.label} · ${ov.position}% down · ${ov.style}</div>        </div>
        <button class="remove-x" title="remove">✕</button>`;
      row.querySelector(".remove-x").addEventListener("click", () => {
        state.overlays = state.overlays.filter((o) => o.id !== ov.id);
        renderOverlayList();
        updateComboSummary();
      });
      overlayList.appendChild(row);
    });
  }

  /* ============================================================
     Canvas rendering — backgrounds & text (shared by preview + export)
     ============================================================ */
  function drawCover(ctx, img, x, y, w, h) {
    const scale = Math.max(w / img.width, h / img.height);
    const dw = img.width * scale,
      dh = img.height * scale;
    ctx.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
  }

  function drawBackground(ctx, bg, w, h) {
    if (!bg || bg.type === "color") {
      ctx.fillStyle = bg ? bg.value : "#000000";
      ctx.fillRect(0, 0, w, h);
    } else {
      drawCover(ctx, bg.img, 0, 0, w, h);
    }
  }
  function drawContainVideoFrame(ctx, videoEl, w, h, posPct = 50) {
    if (!videoEl || !videoEl.videoWidth) return;
    const scale = Math.min(w / videoEl.videoWidth, h / videoEl.videoHeight);
    const dw = videoEl.videoWidth * scale,
      dh = videoEl.videoHeight * scale;
    const p = clampVideoPos(posPct) / 100;
    const dx = (w - dw) / 2;
    const dy = (h - dh) * p; // 0=top, 0.5=center, 1=bottom — always fully visible
    ctx.drawImage(videoEl, dx, dy, dw, dh);
  }

  function wrapLines(ctx, text, maxWidth) {
    const paragraphs = text.split("\n");
    const lines = [];
    for (const para of paragraphs) {
      const words = para.split(" ");
      let line = "";
      for (const word of words) {
        const test = line ? line + " " + word : word;
        if (ctx.measureText(test).width > maxWidth && line) {
          lines.push(line);
          line = word;
        } else {
          line = test;
        }
      }
      lines.push(line);
    }
    return lines;
  }

  async function drawTextOverlay(ctx, overlay, W, H, scale = 1) {
    const font = FONTS.find((f) => f.id === overlay.fontId) || FONTS[0];
    const size = overlay.size * scale;
    const family = `"${font.family}"`;
    try {
      await document.fonts.load(`${font.weight} ${size}px ${family}`);
    } catch (e) {
      /* fall back silently */
    }

    ctx.font = `${font.weight} ${size}px ${family}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";

    const maxWidth = W * 0.84;
    const lines = wrapLines(ctx, overlay.text, maxWidth);
    const lineHeight = size * 1.18;
    const blockHeight = lines.length * lineHeight;

    const posPct =
      typeof overlay.position === "number"
        ? overlay.position
        : parseInt(overlay.position, 10) || 50;
    const centerY = H * (posPct / 100);
    let startY = centerY - blockHeight / 2 + size;

    const cx = W / 2;

    if (overlay.style === "badge") {
      const padX = size * 0.5,
        padY = size * 0.35;
      let maxLineW = 0;
      lines.forEach((l) => {
        maxLineW = Math.max(maxLineW, ctx.measureText(l).width);
      });
      const bx = cx - maxLineW / 2 - padX;
      const by = startY - size * 0.85 - padY;
      const bw = maxLineW + padX * 2;
      const bh = blockHeight + padY * 2;
      const r = size * 0.18;
      ctx.fillStyle = "rgba(0,0,0,0.55)";
      roundRect(ctx, bx, by, bw, bh, r);
      ctx.fill();
    }

    lines.forEach((line, i) => {
      const y = startY + i * lineHeight;
      if (overlay.style === "stroke") {
        ctx.lineJoin = "round";
        ctx.miterLimit = 2;
        ctx.lineWidth = size * 0.09;
        ctx.strokeStyle = "rgba(0,0,0,0.85)";
        ctx.strokeText(line, cx, y);
        ctx.shadowColor = "rgba(0,0,0,0.35)";
        ctx.shadowBlur = size * 0.12;
      } else {
        ctx.shadowColor = "rgba(0,0,0,0.55)";
        ctx.shadowBlur = size * 0.18;
        ctx.shadowOffsetY = size * 0.03;
      }
      ctx.fillStyle = overlay.color;
      ctx.fillText(line, cx, y);
      ctx.shadowBlur = 0;
      ctx.shadowOffsetY = 0;
    });
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function escapeHtml(s) {
    return (s || "").replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[c],
    );
  }

  /* ============================================================
     STEP 5 — queue-based batch builder
     ============================================================ */
  function populatePickers() {
    const curBg = pickBg.value,
      curOv = pickOv.value;
    pickBg.innerHTML = state.backgrounds
      .map((bg) => `<option value="${bg.id}">${escapeHtml(bg.name)}</option>`)
      .join("");
    pickOv.innerHTML =
      '<option value="">— no text —</option>' +
      state.overlays
        .map(
          (ov) =>
            `<option value="${ov.id}">${escapeHtml(ov.text.slice(0, 30))}</option>`,
        )
        .join("");
    if (state.backgrounds.some((b) => b.id === curBg)) pickBg.value = curBg;
    if (state.overlays.some((o) => o.id === curOv)) pickOv.value = curOv;
  }

  addToQueueBtn.addEventListener("click", () => {
    if (!state.backgrounds.length) return;
    const bg =
      state.backgrounds.find((b) => b.id === pickBg.value) ||
      state.backgrounds[0];
    const ov = state.overlays.find((o) => o.id === pickOv.value) || null;
    state.queue.push({ id: uid(), bg, ov });
    renderQueueList();
    updateComboSummary();
  });

  function renderQueueList() {
    queueList.innerHTML = "";
    state.queue.forEach((item) => {
      const row = document.createElement("div");
      row.className = "overlay-row";
      const swatchBg = item.bg.type === "color" ? item.bg.value : "#000";
      row.innerHTML = `
        <div class="swatch" style="background:${swatchBg}"></div>
        <div class="info">
          <div class="txt">${escapeHtml(item.bg.name)}${item.ov ? ' + "' + escapeHtml(item.ov.text.slice(0, 24)) + '"' : " (no text)"}</div>
        </div>
        <button class="remove-x" title="remove">✕</button>`;
      row.querySelector(".remove-x").addEventListener("click", () => {
        state.queue = state.queue.filter((q) => q.id !== item.id);
        renderQueueList();
        updateComboSummary();
      });
      queueList.appendChild(row);
    });
  }

  function updateComboSummary() {
    if (state.backgrounds.length > 0) unlock(step5);
    populatePickers();
    const n = state.queue.length;
    comboSummary.textContent = n
      ? `${n} video${n === 1 ? "" : "s"} queued and ready to generate.`
      : 'Pick a background + overlay above, then "add to batch." Repeat for every video you want.';
    generateBtn.disabled = !state.file || n === 0;
  }
  updateComboSummary();

  function comboFilename(combo, idx) {
    const bgName = combo.bg.name.replace(/[^a-z0-9]+/gi, "-").slice(0, 20);
    const ovName = combo.ov
      ? combo.ov.text.replace(/[^a-z0-9]+/gi, "-").slice(0, 24)
      : "notext";
    return `reel_${String(idx + 1).padStart(2, "0")}_${bgName}_${ovName}.mp4`;
  }

  async function ensureEngineLoaded() {
    if (ffmpegReady) return;
    engineDot.className = "dot busy";
    engineStatusText.textContent = "loading engine (first time only)…";
    const { FFmpeg } = FFmpegWASM;
    ffmpeg = new FFmpeg();
    ffmpeg.on("log", ({ message }) => console.log("[ffmpeg]", message));
    // Live per-video progress (0..1) feeds the ETA ticker. Guarded: if this
    // vendored build never emits progress, the timer falls back to per-video averages.
    try {
      if (!ffmpegProgressHooked) {
        ffmpegProgressHooked = true;
        ffmpeg.on("progress", ({ progress }) => {
          if (isFinite(progress)) {
            currentProgress = Math.max(0, Math.min(1, progress));
          }
        });
      }
    } catch (e) {
      /* progress events unsupported — timer still works */
    }
    await ffmpeg.load({
      coreURL: new URL("vendor/ffmpeg-core.js", document.baseURI).toString(),
      wasmURL: new URL("vendor/ffmpeg-core.wasm", document.baseURI).toString(),
    });
    ffmpegReady = true;
    engineDot.className = "dot ready";
    engineStatusText.textContent = "engine ready";
  }

  // Safe speedup (no quality change): start downloading/compiling the engine
  // in the background as soon as we have a source video, so Generate feels faster.
  function prewarmEngine() {
    if (ffmpegReady) return;
    ensureEngineLoaded().catch((e) =>
      console.warn("[engine prewarm failed]", e),
    );
  }

  async function canvasToPngBytes(canvas) {
    const blob = await new Promise((res) => canvas.toBlob(res, "image/png"));
    const buf = await blob.arrayBuffer();
    return new Uint8Array(buf);
  }

  generateBtn.addEventListener("click", runBatch);

  async function runBatch() {
    const combos = state.queue;
    if (!combos.length || !state.file) return;

    generateBtn.disabled = true;
    progressArea.hidden = false;
    resultsBar.hidden = true;
    filmstrip.innerHTML = "";
    state.results = [];
    progressFill.style.width = "0%";

    // Timer init
    batchStart = performance.now();
    completedDurations = [];
    currentProgress = 0;
    resetTimerUI();
    if (timerInterval) clearInterval(timerInterval);
    timerInterval = setInterval(
      () => updateTimerUI(combos.length, state.results.length),
      500,
    );

    combos.forEach((c, i) => {
      const f = document.createElement("div");
      f.className = "frame";
      f.id = "frame-" + i;
      f.innerHTML = `<span class="lbl">${i + 1}</span>`;
      filmstrip.appendChild(f);
    });

    // Safe speedup cache (no quality change): identical backgrounds / text
    // overlays reuse their already-encoded PNG bytes instead of re-rendering.
    const bgCache = new Map();
    const txCache = new Map();

    try {
      progressLabel.textContent = "Loading engine…";
      updateTimerUI(combos.length, 0);
      await ensureEngineLoaded();

      progressLabel.textContent = "Reading source video…";
      const inputBytes = new Uint8Array(await state.file.arrayBuffer());
      const srcExtMatch = /\.([a-z0-9]+)$/i.exec(state.file.name || "");
      const srcName =
        "input." + (srcExtMatch ? srcExtMatch[1].toLowerCase() : "mp4");
      await ffmpeg.writeFile(srcName, inputBytes);

      const fmt = state.format;
      const W = fmt.w,
        H = fmt.h;

      for (let i = 0; i < combos.length; i++) {
        const combo = combos[i];
        const frameEl = document.getElementById("frame-" + i);
        frameEl.className = "frame working";
        currentVideoStart = performance.now();
        currentProgress = 0;
        progressLabel.textContent = `Rendering video ${i + 1} of ${combos.length}…`;
        updateTimerUI(combos.length, i);

        let bgBytes = bgCache.get(combo.bg.id);
        if (!bgBytes) {
          const bgCanvas = document.createElement("canvas");
          bgCanvas.width = W;
          bgCanvas.height = H;
          drawBackground(bgCanvas.getContext("2d"), combo.bg, W, H);
          bgBytes = await canvasToPngBytes(bgCanvas);
          bgCache.set(combo.bg.id, bgBytes);
        }
        await ffmpeg.writeFile("bg.png", bgBytes);

        let hasText = false;
        if (combo.ov) {
          let txBytes = txCache.get(combo.ov.id);
          if (!txBytes) {
            const txCanvas = document.createElement("canvas");
            txCanvas.width = W;
            txCanvas.height = H;
            const txCtx = txCanvas.getContext("2d");
            txCtx.clearRect(0, 0, W, H);
            await drawTextOverlay(txCtx, combo.ov, W, H, 1);
            txBytes = await canvasToPngBytes(txCanvas);
            txCache.set(combo.ov.id, txBytes);
          }

          await ffmpeg.writeFile("tx.png", txBytes);
          hasText = true;
        }

        const outName = `out${i}.mp4`;
        const args = ["-loop", "1", "-i", "bg.png", "-i", srcName];
        if (hasText) args.push("-loop", "1", "-i", "tx.png");

        const vFrac = (clampVideoPos(state.videoPosition) / 100).toFixed(3);
        const yExpr = `(${H}-h)*${vFrac}`;
        const filter = hasText
          ? `[1:v]scale=${W}:${H}:force_original_aspect_ratio=decrease[v1];[0:v][v1]overlay=(${W}-w)/2:${yExpr}[b1];[b1][2:v]overlay=0:0:shortest=1[outv]`
          : `[1:v]scale=${W}:${H}:force_original_aspect_ratio=decrease[v1];[0:v][v1]overlay=(${W}-w)/2:${yExpr}:shortest=1[outv]`;

        const durSec = isFinite(state.meta.duration)
          ? state.meta.duration
          : null;

        args.push(
          "-filter_complex",
          filter,
          "-map",
          "[outv]",
          "-map",
          "1:a?",
          "-c:v",
          "libx264",
          "-preset",
          "ultrafast",
          "-crf",
          "28",
          "-c:a",
          "aac",
          "-b:a",
          "128k",
          "-pix_fmt",
          "yuv420p",
          "-movflags",
          "+faststart",
          "-shortest",
        );
        if (durSec) args.push("-t", durSec.toFixed(2));
        args.push(outName);

        await ffmpeg.exec(args);
        const data = await ffmpeg.readFile(outName);
        const blob = new Blob([data.buffer], { type: "video/mp4" });
        const url = URL.createObjectURL(blob);
        const filename = comboFilename(combo, i);
        state.results.push({ name: filename, blob, url });

        await ffmpeg.deleteFile(outName);
        if (hasText) await ffmpeg.deleteFile("tx.png");
        await ffmpeg.deleteFile("bg.png");

        completedDurations.push(performance.now() - currentVideoStart);
        currentProgress = 1;

        frameEl.className = "frame done";
        frameEl.innerHTML = `<video muted playsinline src="${url}"></video><span class="lbl">${i + 1}</span>`;
        progressFill.style.width = `${Math.round(((i + 1) / combos.length) * 100)}%`;
        updateTimerUI(combos.length, state.results.length);
      }

      await ffmpeg.deleteFile(srcName);

      const totalMs = performance.now() - batchStart;
      progressLabel.textContent = `Done — ${combos.length} videos ready in ${formatClock(totalMs)}.`;
      if (timerRemaining)
        timerRemaining.textContent = `Done in ${formatClock(totalMs)}`;
      if (timerElapsed)
        timerElapsed.textContent = `Elapsed ${formatClock(totalMs)}`;
      if (timerEta) timerEta.textContent = `${combos.length} videos ready`;
      resultsCount.textContent = combos.length;
      resultsBar.hidden = false;
    } catch (err) {
      console.error(err);
      progressLabel.textContent =
        "Something went wrong: " + (err && err.message ? err.message : err);
      if (timerRemaining) timerRemaining.textContent = "paused (error)";
    } finally {
      if (timerInterval) {
        clearInterval(timerInterval);
        timerInterval = null;
      }
      generateBtn.disabled = false;
    }
  }

  downloadZipBtn.addEventListener("click", async () => {
    downloadZipBtn.disabled = true;
    downloadZipBtn.textContent = "zipping…";
    const zip = new JSZip();
    state.results.forEach((r) => zip.file(r.name, r.blob));
    const content = await zip.generateAsync({ type: "blob" });
    const url = URL.createObjectURL(content);
    const a = document.createElement("a");
    a.href = url;
    a.download = "reel-factory-batch.zip";
    document.body.appendChild(a);
    a.click();
    a.remove();
    downloadZipBtn.disabled = false;
    downloadZipBtn.textContent = "Download all (.zip)";
  });
})();
