import { app } from "../../../scripts/app.js";
import { api } from "../../../scripts/api.js";

const NODE_ID = "CS_Compare_Any";
const STYLE_ID = "cinestyle-compare-any-style";
const STATE = Symbol("cinestyle-compare-any-state");
const WIDGET = Symbol("cinestyle-compare-any-widget");
// The preview fills the DOM widget, and the widget fills the node body, so the
// only height the layout has to guarantee is the smallest usable one: head +
// a 180px stage + the media controls. Everything above that is user-owned.
const WIDGET_MIN_HEIGHT = 260;
const NODE_MIN_WIDTH = 560;
const NODE_MIN_HEIGHT = 300;
const GRID_GAP = 6;
const SPLIT_MIN_SIZE = 120;
// Redraws are coalesced into one frame, and a large source is re-drawn at high
// quality once the node stops changing size.
const INTERACTION_SETTLE_MS = 140;

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

function formatFrameCode(frame, fps) {
    const frameRate = Math.max(1, Math.round(Number(fps) || 1));
    const totalFrames = Math.max(0, Math.floor(Number(frame) || 0));
    const minuteFrames = frameRate * 60;
    const minutes = Math.floor(totalFrames / minuteFrames);
    const seconds = Math.floor(totalFrames / frameRate) % 60;
    const frameInSecond = totalFrames % frameRate;
    return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}:${String(frameInSecond).padStart(2, "0")}`;
}

function latestPayload(output) {
    const values = output?.compare_any;
    if (!Array.isArray(values) || !values.length) return {};
    const payload = values[values.length - 1];
    return payload && typeof payload === "object" ? payload : {};
}

function normaliseViewportLayout(layout) {
    const value = String(layout || "").toLowerCase();
    return value === "vertical" || value === "horizontal" || value === "single" ? value : "single";
}

function defaultComparePosition(layout) {
    return normaliseViewportLayout(layout) === "single" ? 50 : 0;
}

function applyComparePosition(state) {
    state?.compareViewport?.style.setProperty("--compare-position", `${Number(state.comparePosition) || 0}%`);
}

function mediaUrl(source, frame = null) {
    let value = String(source?.video_url || source?.image_url || "");
    if (!source?.video_url && Number.isFinite(Number(frame))) {
        value += `${value.includes("?") ? "&" : "?"}frame=${Math.max(0, Math.round(Number(frame)))}`;
    }
    // The route token is a fresh uuid per cached preview, so a token+frame URL
    // always returns the same bytes. Cache-busting it re-encodes and re-downloads
    // a full-size image on every seek and every re-render.
    return value ? api.apiURL(value) : "";
}

function addStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      .cs-compare-any-shell{position:relative;display:grid;grid-template-rows:auto minmax(0,1fr) auto;gap:8px;box-sizing:border-box;width:100%;height:100%;padding:8px;background:var(--comfy-input-bg,#17191e);color:var(--input-text,#e6e9ef);font:12px/1.35 system-ui,sans-serif}
      .cs-compare-any-head,.cs-compare-any-controls{display:flex;align-items:center;gap:6px;flex-wrap:wrap}
      .cs-compare-any-controls[hidden]{display:none}
      .cs-compare-any-head{justify-content:space-between;color:var(--descrip-text,#9da5b4)}
      .cs-compare-any-title{font-weight:600;color:var(--input-text,#e6e9ef)}
      .cs-compare-any-status{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:75%;color:var(--descrip-text,#9da5b4)}
      .cs-compare-any-grid{position:relative;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));grid-template-rows:minmax(0,1fr);gap:6px;min-height:0}
      .cs-compare-any-layout-single .cs-compare-any-grid{grid-template-columns:1fr}
      .cs-compare-any-viewport{position:relative;box-sizing:border-box;min-width:0;min-height:0;overflow:hidden;border:1px solid var(--border-color,#3c424d);border-radius:5px;background:#808080}
      .cs-compare-any-viewport canvas{display:block;width:100%;height:100%;min-height:0}
      .cs-compare-any-source{grid-column:1;grid-row:1}
      .cs-compare-any-compare{grid-column:2;grid-row:1}
      .cs-compare-any-layout-vertical .cs-compare-any-grid{grid-template-columns:1fr;grid-template-rows:repeat(2,minmax(0,1fr))}
      .cs-compare-any-layout-vertical .cs-compare-any-source{grid-column:1;grid-row:1}
      .cs-compare-any-layout-vertical .cs-compare-any-compare{grid-column:1;grid-row:2}
      .cs-compare-any-layout-single .cs-compare-any-source{display:none}
      .cs-compare-any-layout-single .cs-compare-any-compare{grid-column:1;grid-row:1}
      .cs-compare-any-divider{position:absolute;z-index:3;top:0;bottom:0;left:var(--compare-position,0%);width:2px;transform:translateX(-1px);background:#f4f7fb;box-shadow:0 0 0 1px #11141980;cursor:ew-resize;touch-action:none}
      .cs-compare-any-divider::before{content:"";position:absolute;top:50%;left:50%;width:22px;height:22px;transform:translate(-50%,-50%);border:2px solid #f4f7fb;border-radius:50%;background:#20232a;box-shadow:0 2px 8px #000b}
      .cs-compare-any-divider::after{content:"↔";position:absolute;top:50%;left:50%;transform:translate(-50%,-53%);color:#f4f7fb;font-size:13px;line-height:1}
      .cs-compare-any-diff{display:none;box-sizing:border-box;width:100%;height:100%;min-width:0;min-height:0;grid-template-columns:minmax(0,var(--cs-compare-split-first,1fr)) minmax(0,var(--cs-compare-split-second,1fr));gap:6px;overflow:hidden;font:11px/1.45 ui-monospace,SFMono-Regular,Consolas,monospace}
      .cs-compare-any-layout-vertical .cs-compare-any-diff{grid-template-columns:1fr;grid-template-rows:minmax(0,var(--cs-compare-split-first,1fr)) minmax(0,var(--cs-compare-split-second,1fr))}
      .cs-compare-any-diff-pane{display:grid;grid-template-rows:auto minmax(0,1fr);min-width:0;min-height:0;overflow:hidden;background:#111419}
      .cs-compare-any-diff-label{padding:4px 8px;border-bottom:1px solid var(--border-color,#3c424d);color:var(--descrip-text,#9da5b4);font:600 11px/1.35 system-ui,sans-serif;user-select:none}
      .cs-compare-any-diff-content{min-width:0;min-height:0;overflow:auto;padding:5px 0}
      .cs-compare-any-diff-line{display:grid;grid-template-columns:24px minmax(0,1fr);box-sizing:border-box;min-height:16px;padding:0 8px;white-space:pre-wrap;overflow-wrap:anywhere}
      .cs-compare-any-diff-prefix{padding-right:5px;color:#707987;text-align:center;user-select:none}
      .cs-compare-any-diff-line-content{min-width:0;white-space:pre-wrap;overflow-wrap:anywhere}
      .cs-compare-any-diff-line.equal{color:#7f8794}
      .cs-compare-any-diff-line.delete.a{background:#60272b80;color:#ffc5c8}
      .cs-compare-any-diff-line.insert.b{background:#1e563680;color:#c6f4ce}
      .cs-compare-any-diff-line.replace.a{background:#60272b55;color:#ffc5c8}
      .cs-compare-any-diff-line.replace.b{background:#1e563655;color:#c6f4ce}
      .cs-compare-any-text{display:none;box-sizing:border-box;width:100%;height:100%;margin:0;padding:8px;overflow:auto;white-space:pre-wrap;overflow-wrap:anywhere;font:11px/1.45 ui-monospace,SFMono-Regular,Consolas,monospace;color:#dce2ea}
      .cs-compare-any-diff-part.equal{color:#7f8794}
      .cs-compare-any-diff-part.changed.a{background:#9c3b4580;color:#fff0f1}
      .cs-compare-any-diff-part.changed.b{background:#2c895080;color:#effff2}
      .cs-compare-any-button{min-height:26px;min-width:30px;border:1px solid var(--border-color,#424956);border-radius:4px;padding:4px 7px;background:#20232a;color:#e9edf3;cursor:pointer}
      .cs-compare-any-button:hover{border-color:#65aeea;background:#282d36}
      .cs-compare-any-button.playing{background:#317ec4;border-color:#6db6ee}
      .cs-compare-any-controls input[type=range]{flex:1;min-width:100px}
      .cs-compare-any-zoom-group{display:flex;align-items:center;gap:4px;margin-left:auto}
      .cs-compare-any-zoom-button{min-width:27px;padding-inline:5px;font-size:14px;line-height:1}
      .cs-compare-any-readout{min-width:72px;color:var(--descrip-text,#9da5b4);font-variant-numeric:tabular-nums;text-align:right;white-space:nowrap}
      .cs-compare-any-readout-total{min-width:72px;color:var(--descrip-text,#9da5b4);font-variant-numeric:tabular-nums;white-space:nowrap}
      .cs-compare-any-error{position:absolute;z-index:4;inset:0;display:flex;align-items:center;justify-content:center;padding:18px;box-sizing:border-box;text-align:center;color:#ff9ba2;white-space:pre-wrap;pointer-events:none}
      .cs-compare-any-loading{position:absolute;z-index:6;inset:0;display:flex;align-items:center;justify-content:center;padding:18px;box-sizing:border-box;background:#08090bd9;color:#dce7f3;text-align:center;white-space:pre-wrap;pointer-events:none}
      .cs-compare-any-loading[hidden],.cs-compare-any-error[hidden]{display:none}
      .cs-compare-any-audio-button{min-width:48px}
      .cs-compare-any-media-only .cs-compare-any-diff,.cs-compare-any-media-only .cs-compare-any-text{display:none}
      .cs-compare-any-diff-mode .cs-compare-any-grid{grid-template-columns:1fr;grid-template-rows:minmax(0,1fr);gap:0}
      .cs-compare-any-diff-mode .cs-compare-any-source{display:none}
      .cs-compare-any-diff-mode .cs-compare-any-compare{grid-column:1;grid-row:1;width:100%;height:100%}
      .cs-compare-any-diff-mode .cs-compare-any-diff{display:grid}
      .cs-compare-any-diff-mode .cs-compare-any-viewport canvas,.cs-compare-any-diff-mode .cs-compare-any-divider{display:none}
      .cs-compare-any-diff-mode .cs-compare-any-viewport{background:#111419}
      .cs-compare-any-diff-mode .cs-compare-any-compare{overflow:hidden}
      .cs-compare-any-resize-handle{position:absolute;z-index:5;right:24px;bottom:1px;left:8px;height:10px;cursor:ns-resize;touch-action:none}
      .cs-compare-any-resize-handle::after{content:"";position:absolute;top:4px;left:50%;width:34px;height:2px;border-radius:2px;transform:translateX(-50%);background:#8c96a5;opacity:.72}
      .cs-compare-any-resize-handle:hover::after{background:#b8d9f5;opacity:1}
      .cs-compare-any-split-handle{display:none;position:absolute;z-index:7;background:transparent;touch-action:none}
      .cs-compare-any-diff-mode .cs-compare-any-split-handle{display:block}
      .cs-compare-any-split-handle-horizontal{top:0;bottom:0;width:10px;cursor:col-resize}
      .cs-compare-any-split-handle-vertical{right:0;left:0;height:10px;cursor:row-resize}
      .cs-compare-any-split-handle::after{content:"";position:absolute;background:#8c96a5;opacity:.75;border-radius:2px}
      .cs-compare-any-split-handle-horizontal::after{top:50%;left:4px;width:2px;height:34px;transform:translateY(-50%)}
      .cs-compare-any-split-handle-vertical::after{top:4px;left:50%;width:34px;height:2px;transform:translateX(-50%)}
      .cs-compare-any-split-handle:hover::after{background:#b8d9f5;opacity:1}
      .cs-compare-any-pan-ready{cursor:grab}
      .cs-compare-any-pan-active{cursor:grabbing}
      .cs-compare-any-corner-grip{position:absolute;z-index:6;right:0;bottom:0;width:20px;height:18px;cursor:nwse-resize;touch-action:none;opacity:.45;clip-path:polygon(100% 0,100% 100%,0 100%);background:repeating-linear-gradient(135deg,transparent 0 3px,#8c96a5 3px 4.5px)}
      .cs-compare-any-corner-grip:hover{opacity:1}
    `;
    document.head.appendChild(style);
}

function sourceDimensions(source) {
    return [
        Number(source?.videoWidth || source?.naturalWidth || 0),
        Number(source?.videoHeight || source?.naturalHeight || 0),
    ];
}

function normalizedMediaSize(source) {
    // Compare at equal long edge: every source is described in units of its own
    // longest side, so one shared scale puts both long edges on the same number
    // of screen pixels while each keeps its original aspect ratio.
    const [sourceWidth, sourceHeight] = sourceDimensions(source);
    if (!sourceWidth || !sourceHeight) return null;
    const longEdge = Math.max(sourceWidth, sourceHeight);
    return { width: sourceWidth / longEdge, height: sourceHeight / longEdge };
}

function sharedMediaScale(sources, width, height) {
    // One common scale for both panes. Fitted separately, the wider source hits
    // its limit first as the node narrows, the panes fall out of step and the
    // wipe drifts; a shared scale pins the ratio and the two centres together.
    let scale = 0;
    for (const source of sources) {
        const normalized = normalizedMediaSize(source);
        if (!normalized) continue;
        const fit = Math.min(width / normalized.width, height / normalized.height);
        scale = scale > 0 ? Math.min(scale, fit) : fit;
    }
    return scale;
}

function containedRect(source, width, height, zoom = 1, panX = 0, panY = 0, baseScale = 0) {
    const [sourceWidth, sourceHeight] = sourceDimensions(source);
    if (!source || !sourceWidth || !sourceHeight) return;
    // baseScale is measured in long-edge units; without it a lone source is just
    // fitted to the stage.
    const normalized = baseScale > 0 ? normalizedMediaSize(source) : null;
    const unitWidth = normalized ? normalized.width : sourceWidth;
    const unitHeight = normalized ? normalized.height : sourceHeight;
    const scale = baseScale > 0 ? baseScale : Math.min(width / sourceWidth, height / sourceHeight);
    const drawWidth = unitWidth * scale * zoom;
    const drawHeight = unitHeight * scale * zoom;
    return {
        x: (width - drawWidth) * 0.5 + panX,
        y: (height - drawHeight) * 0.5 + panY,
        width: drawWidth,
        height: drawHeight,
    };
}

function drawContained(context, source, width, height, zoom = 1, panX = 0, panY = 0, baseScale = 0) {
    const rect = containedRect(source, width, height, zoom, panX, panY, baseScale);
    if (!rect) return;
    context.drawImage(source, rect.x, rect.y, rect.width, rect.height);
}

function clampComparePan(state, width, height, baseScale = 0) {
    if (!state || state.compareZoom <= 1) {
        state.comparePanX = 0;
        state.comparePanY = 0;
        return;
    }
    const sourceA = state.kind === "VIDEO" ? state.videoA : state.imageA;
    const sourceB = state.kind === "VIDEO" ? state.videoB : state.imageB;
    const scale = baseScale > 0 ? baseScale : sharedMediaScale([sourceA, sourceB], width, height);
    const rectA = containedRect(sourceA, width, height, state.compareZoom, 0, 0, scale);
    const rectB = containedRect(sourceB, width, height, state.compareZoom, 0, 0, scale);
    const maxWidth = Math.max(rectA?.width || 0, rectB?.width || 0);
    const maxHeight = Math.max(rectA?.height || 0, rectB?.height || 0);
    const maxX = Math.max(0, (maxWidth - width) * 0.5);
    const maxY = Math.max(0, (maxHeight - height) * 0.5);
    state.comparePanX = clamp(Number(state.comparePanX) || 0, -maxX, maxX);
    state.comparePanY = clamp(Number(state.comparePanY) || 0, -maxY, maxY);
}

function setupCanvas(canvas, quality = "high") {
    const width = Math.max(1, Number(canvas.clientWidth) || 0);
    const height = Math.max(1, Number(canvas.clientHeight) || 0);
    const ratio = Math.max(1, window.devicePixelRatio || 1);
    const pixelWidth = Math.max(2, Math.round(width * ratio));
    const pixelHeight = Math.max(2, Math.round(height * ratio));
    if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
        canvas.width = pixelWidth;
        canvas.height = pixelHeight;
    }
    const context = canvas.getContext("2d");
    if (!context) return null;
    context.imageSmoothingEnabled = true;
    // Resampling a multi-megapixel source at high quality costs tens of
    // milliseconds per pane, so it only runs once the size has settled.
    context.imageSmoothingQuality = quality;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    return { context, width, height };
}

function drawMedia(state, quality = "high") {
    if (!state || state.mode !== "media") return;
    const canvasSource = setupCanvas(state.canvasA, quality);
    const canvasCompare = setupCanvas(state.canvasCompare, quality);
    if (!canvasSource || !canvasCompare) return;
    const sourceA = state.kind === "VIDEO" ? state.videoA : state.imageA;
    const sourceB = state.kind === "VIDEO" ? state.videoB : state.imageB;
    const source = canvasSource;
    // One scale for both panes, taken from the wipe stage so A and B stay
    // registered with each other at every node size.
    const scale = sharedMediaScale([sourceA, sourceB], canvasCompare.width, canvasCompare.height);
    source.context.save();
    source.context.beginPath();
    source.context.rect(0, 0, source.width, source.height);
    source.context.clip();
    // Keep the canvas transparent so the viewport's gray background remains
    // visible behind RGBA media, matching CS Preview Any.
    source.context.clearRect(0, 0, source.width, source.height);
    drawContained(source.context, sourceA, source.width, source.height, state.compareZoom, state.comparePanX, state.comparePanY, scale);
    source.context.restore();
    const { context, width, height } = canvasCompare;
    clampComparePan(state, width, height, scale);
    context.save();
    context.beginPath();
    context.rect(0, 0, width, height);
    context.clip();
    context.clearRect(0, 0, width, height);
    drawContained(context, sourceB, width, height, state.compareZoom, state.comparePanX, state.comparePanY, scale);
    const requestedPosition = Number(state.comparePosition);
    const position = clamp(Number.isFinite(requestedPosition) ? requestedPosition : 0, 0, 100) / 100;
    context.save();
    context.beginPath();
    context.rect(0, 0, width * position, height);
    context.clip();
    context.clearRect(0, 0, width * position, height);
    drawContained(context, sourceA, width, height, state.compareZoom, state.comparePanX, state.comparePanY, scale);
    context.restore();
    context.restore();
}

function scheduleRedraw(state, quality = "high") {
    if (!state || state.disposed) return;
    // A queued high-quality pass must not be downgraded by a low-quality one.
    state.redrawQuality = quality === "high" ? "high" : state.redrawQuality || "low";
    if (state.redrawFrame != null) return;
    state.redrawFrame = requestAnimationFrame(() => {
        state.redrawFrame = null;
        const pending = state.redrawQuality || "high";
        state.redrawQuality = null;
        if (!state.disposed) drawMedia(state, pending);
    });
}

function beginInteraction(state) {
    // Resize, divider, pan and zoom drags all redraw the same two panes. Do the
    // cheap pass while the pointer is moving and the sharp pass once it stops.
    if (state.settleTimer != null) clearTimeout(state.settleTimer);
    state.settleTimer = setTimeout(() => {
        state.settleTimer = null;
        if (!state.disposed) drawMedia(state, "high");
    }, INTERACTION_SETTLE_MS);
    scheduleRedraw(state, "low");
}

function forceCompareRefresh(state) {
    if (!state || state.disposed) return;
    drawMedia(state, "high");
    if (state.compareRefreshFrame != null) cancelAnimationFrame(state.compareRefreshFrame);
    state.compareRefreshFrame = requestAnimationFrame(() => {
        state.compareRefreshFrame = requestAnimationFrame(() => {
            state.compareRefreshFrame = null;
            if (!state.disposed) drawMedia(state, "high");
        });
    });
}

function setNodeHeight(state, height) {
    const node = state?.node;
    if (!node) return false;
    const nextHeight = Math.max(NODE_MIN_HEIGHT, Math.round(Number(height) || 0));
    const currentHeight = Number(node.size?.[1]) || 0;
    if (Math.abs(nextHeight - currentHeight) < 1) return false;
    const nextWidth = Math.max(NODE_MIN_WIDTH, Number(node.size?.[0]) || NODE_MIN_WIDTH);
    node.setSize?.([nextWidth, nextHeight]);
    node.graph?.setDirtyCanvas?.(true, true);
    return true;
}

function splitAxis(state) {
    return state.layout === "vertical" ? "vertical" : "horizontal";
}

function splitTrackSize(state) {
    const width = Number(state.grid?.clientWidth) || 0;
    const height = Number(state.grid?.clientHeight) || 0;
    const total = splitAxis(state) === "vertical" ? height : width;
    return Math.max(0, total - GRID_GAP);
}

function applyDiffSplit(state, firstSize, preserveRatio = false) {
    if (!state?.grid || !state.splitHandle) return false;
    const axis = splitAxis(state);
    const total = splitTrackSize(state);
    if (total <= 0) return false;
    let first = Number(firstSize);
    if (preserveRatio || !Number.isFinite(first)) first = total * (Number.isFinite(state.splitRatio) ? state.splitRatio : 0.5);
    first = clamp(first, Math.min(SPLIT_MIN_SIZE, total / 2), Math.max(Math.min(SPLIT_MIN_SIZE, total / 2), total - Math.min(SPLIT_MIN_SIZE, total / 2)));
    const second = Math.max(0, total - first);
    state.splitRatio = total > 0 ? first / total : 0.5;
    state.grid.style.setProperty("--cs-compare-split-first", `${Math.round(first)}px`);
    state.grid.style.setProperty("--cs-compare-split-second", `${Math.round(second)}px`);
    state.splitHandle.classList.toggle("cs-compare-any-split-handle-horizontal", axis === "horizontal");
    state.splitHandle.classList.toggle("cs-compare-any-split-handle-vertical", axis === "vertical");
    if (axis === "horizontal") {
        state.splitHandle.style.left = `${Math.round(first + GRID_GAP / 2 - 5)}px`;
        state.splitHandle.style.top = "0px";
        state.splitHandle.style.bottom = "0px";
        state.splitHandle.style.right = "auto";
        state.splitHandle.style.height = "auto";
    } else {
        state.splitHandle.style.top = `${Math.round(first + GRID_GAP / 2 - 5)}px`;
        state.splitHandle.style.left = "0px";
        state.splitHandle.style.right = "0px";
        state.splitHandle.style.bottom = "auto";
        state.splitHandle.style.width = "auto";
    }
    return true;
}

function syncDiffSplitToGrid(state) {
    if (!state || state.mode !== "diff" || state.splitDragging) return false;
    return applyDiffSplit(state, null, true);
}

function attachDiffSplitHandle(state) {
    const handle = state?.splitHandle;
    if (!handle) return;
    let drag = null;
    const finish = (event) => {
        if (!drag || event.pointerId !== drag.pointerId) return;
        drag = null;
        state.splitDragging = false;
        handle.releasePointerCapture?.(event.pointerId);
        nodeGraphDirty(state.node);
    };
    handle.addEventListener("pointerdown", (event) => {
        if (event.button !== 0 || state.mode !== "diff") return;
        event.preventDefault();
        event.stopPropagation();
        const axis = splitAxis(state);
        const rect = state.grid.getBoundingClientRect();
        const cssScale = axis === "vertical"
            ? rect.height / Math.max(1, state.grid.clientHeight)
            : rect.width / Math.max(1, state.grid.clientWidth);
        const total = splitTrackSize(state);
        const first = total * (Number.isFinite(state.splitRatio) ? state.splitRatio : 0.5);
        drag = {
            pointerId: event.pointerId,
            axis,
            startPointer: axis === "vertical" ? event.clientY : event.clientX,
            startFirst: first,
            cssScale: Number.isFinite(cssScale) && cssScale > 0 ? cssScale : 1,
        };
        state.splitDragging = true;
        handle.setPointerCapture?.(event.pointerId);
    });
    handle.addEventListener("pointermove", (event) => {
        if (!drag || event.pointerId !== drag.pointerId) return;
        event.preventDefault();
        event.stopPropagation();
        const pointer = drag.axis === "vertical" ? event.clientY : event.clientX;
        applyDiffSplit(state, drag.startFirst + (pointer - drag.startPointer) / drag.cssScale);
        nodeGraphDirty(state.node);
    });
    handle.addEventListener("pointerup", finish);
    handle.addEventListener("pointercancel", finish);
}

function nodeGraphDirty(node) {
    node?.graph?.setDirtyCanvas?.(true, true);
}

function setCompareZoom(state, requested) {
    state.compareZoom = clamp(Number(requested) || 1, 1, 4);
    if (state.compareZoom <= 1) {
        state.comparePanX = 0;
        state.comparePanY = 0;
    }
    const width = Number(state.canvasCompare?.clientWidth) || 0;
    const height = Number(state.canvasCompare?.clientHeight) || 0;
    if (width > 0 && height > 0) clampComparePan(state, width, height);
    state.sourceViewport?.classList.toggle("cs-compare-any-pan-ready", state.compareZoom > 1);
    state.compareViewport?.classList.toggle("cs-compare-any-pan-ready", state.compareZoom > 1);
    beginInteraction(state);
}

function attachHeightHandle(state, handle) {
    if (!handle) return;
    let drag = null;
    const finish = (event) => {
        if (!drag || event.pointerId !== drag.pointerId) return;
        drag = null;
        handle.releasePointerCapture?.(event.pointerId);
    };
    handle.addEventListener("pointerdown", (event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.stopPropagation();
        drag = {
            pointerId: event.pointerId,
            startY: event.clientY,
            startNodeHeight: Number(state.node?.size?.[1]) || NODE_MIN_HEIGHT,
        };
        handle.setPointerCapture?.(event.pointerId);
    });
    handle.addEventListener("pointermove", (event) => {
        if (!drag || event.pointerId !== drag.pointerId) return;
        event.preventDefault();
        // The stage fills the node, so the handle only has to move the outer
        // node height; the CSS grid grows the viewport with it.
        const scale = Number(app.canvas?.ds?.scale) || 1;
        setNodeHeight(state, drag.startNodeHeight + (event.clientY - drag.startY) / scale);
    });
    handle.addEventListener("pointerup", finish);
    handle.addEventListener("pointercancel", finish);
}

function setViewportLayout(state, layout) {
    const next = normaliseViewportLayout(layout);
    if (state.layout !== next) {
        state.splitRatio = 0.5;
        if (!state.comparePositionManual) state.comparePosition = defaultComparePosition(next);
    }
    state.layout = next;
    state.shell.classList.toggle("cs-compare-any-layout-vertical", next === "vertical");
    state.shell.classList.toggle("cs-compare-any-layout-single", next === "single");
    applyComparePosition(state);
    syncDiffSplitToGrid(state);
    scheduleRedraw(state);
}

function setAudioChoice(state, choice) {
    state.audioChoice = choice === "B" || choice === "MUTE" ? choice : "A";
    state.videoA.muted = state.audioChoice !== "A";
    state.videoB.muted = state.audioChoice !== "B";
    if (state.audioButton) {
        const muted = state.audioChoice === "MUTE";
        state.audioButton.textContent = muted ? "🔇" : `🔊 ${state.audioChoice}`;
        state.audioButton.title = muted ? "Mute audio" : `Play source ${state.audioChoice} audio`;
        state.audioButton.setAttribute("aria-label", muted ? "Mute audio" : `Play source ${state.audioChoice} audio`);
        state.audioButton.setAttribute("aria-pressed", muted ? "true" : "false");
    }
}

function clearMediaCanvases(state) {
    for (const canvas of [state.canvasA, state.canvasCompare]) {
        const prepared = setupCanvas(canvas);
        if (!prepared) continue;
        prepared.context.fillStyle = "#08090b";
        prepared.context.fillRect(0, 0, prepared.width, prepared.height);
    }
}

function stopCacheProgress(state) {
    if (state.progressTimer != null) {
        clearTimeout(state.progressTimer);
        state.progressTimer = null;
    }
    state.progressSerial = (state.progressSerial || 0) + 1;
    if (state.loading) state.loading.hidden = true;
}

function beginCacheProgress(node) {
    const state = node?.[STATE];
    if (!state) return;
    stopCacheProgress(state);
    const serial = state.progressSerial;
    state.mode = "loading";
    state.shell.classList.remove("cs-compare-any-diff-mode");
    state.shell.classList.add("cs-compare-any-media-only");
    state.controls.hidden = true;
    state.error.hidden = true;
    state.canvasA.hidden = false;
    state.canvasCompare.hidden = false;
    state.sourceText.hidden = true;
    state.diff.hidden = true;
    state.divider.hidden = true;
    clearMediaCanvases(state);
    state.loading.hidden = false;
    state.loading.textContent = "Loading comparison cache 0%";

    const poll = async () => {
        if (state.disposed || state.progressSerial !== serial) return;
        try {
            const response = await api.fetchApi(`/cinestyle/compare-any-progress?node_id=${encodeURIComponent(String(node.id))}`);
            const result = await response.json().catch(() => ({}));
            if (state.progressSerial !== serial || state.disposed) return;
            const progress = clamp(Number(result.progress) || 0, 0, 100);
            if (result.status === "failed") {
                state.loading.textContent = String(result.message || "Unable to prepare comparison cache");
                state.progressTimer = setTimeout(() => stopCacheProgress(state), 3000);
                return;
            }
            state.loading.textContent = `${String(result.message || "Loading comparison cache")} ${progress}%`;
            state.loading.hidden = false;
            if (result.status === "ready") {
                state.progressTimer = setTimeout(() => {
                    if (state.progressSerial === serial && state.mode === "loading") stopCacheProgress(state);
                }, 500);
                return;
            }
            state.progressTimer = setTimeout(poll, 180);
        } catch {
            if (state.progressSerial === serial && !state.disposed) state.progressTimer = setTimeout(poll, 300);
        }
    };
    poll();
}

function bindComparePanZoom(state) {
    const viewports = [state.sourceViewport, state.compareViewport].filter(Boolean);
    for (const viewport of viewports) {
        viewport.addEventListener("wheel", (event) => {
            if (state.mode !== "media") return;
            event.preventDefault();
            event.stopPropagation();
            setCompareZoom(state, state.compareZoom + (event.deltaY < 0 ? 0.1 : -0.1));
        }, { passive: false });
        let drag = null;
        viewport.addEventListener("pointerdown", (event) => {
            if (event.button !== 0 || state.compareZoom <= 1 || event.target.closest?.(".cs-compare-any-divider,.cs-compare-any-resize-handle")) return;
            event.preventDefault();
            event.stopPropagation();
            drag = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, panX: state.comparePanX, panY: state.comparePanY };
            viewport.setPointerCapture?.(event.pointerId);
            viewport.classList.add("cs-compare-any-pan-active");
        });
        viewport.addEventListener("pointermove", (event) => {
            if (!drag || event.pointerId !== drag.pointerId) return;
            const width = Number(viewport.clientWidth) || 0;
            const height = Number(viewport.clientHeight) || 0;
            state.comparePanX = drag.panX + event.clientX - drag.startX;
            state.comparePanY = drag.panY + event.clientY - drag.startY;
            if (width > 0 && height > 0) clampComparePan(state, width, height);
            beginInteraction(state);
        });
        const finish = (event) => {
            if (!drag || event.pointerId !== drag.pointerId) return;
            drag = null;
            viewport.releasePointerCapture?.(event.pointerId);
            viewport.classList.remove("cs-compare-any-pan-active");
        };
        viewport.addEventListener("pointerup", finish);
        viewport.addEventListener("pointercancel", finish);
    }
}

function animationTick(state) {
    if (!state || state.disposed) return;
    // The loop exists only to drive playback; a paused or still-image node must
    // not keep waking the page every frame.
    if (state.mode !== "media" || state.kind !== "VIDEO" || !state.playing) {
        state.animationFrame = null;
        return;
    }
    const master = !state.videoA.ended && state.videoA.readyState >= 2 ? state.videoA : state.videoB;
    const maxFrame = Math.max(0, state.frames - 1);
    const maxSeconds = maxFrame / Math.max(0.001, state.fps);
    const frame = clamp(Math.round(master.currentTime * state.fps), 0, maxFrame);
    if (Math.abs(state.videoA.currentTime - master.currentTime) > 1 / Math.max(1, state.fps)) state.videoA.currentTime = master.currentTime;
    if (Math.abs(state.videoB.currentTime - master.currentTime) > 1 / Math.max(1, state.fps)) state.videoB.currentTime = master.currentTime;
    if (frame !== state.frame) {
        state.frame = frame;
        updateFrameControls(state);
    }
    // Both cached previews use the same padded timeline. Stop from
    // the shared frame index so a tiny container-duration mismatch
    // cannot leave one side on a different last frame.
    if (frame >= maxFrame && (master.ended || master.currentTime >= maxSeconds)) stopPlayback(state);
    drawMedia(state, "low");
    state.animationFrame = requestAnimationFrame(() => animationTick(state));
}

function startAnimationLoop(state) {
    if (!state || state.disposed || state.animationFrame != null) return;
    state.animationFrame = requestAnimationFrame(() => animationTick(state));
}

function stopAnimationLoop(state) {
    if (!state) return;
    if (state.animationFrame != null) cancelAnimationFrame(state.animationFrame);
    state.animationFrame = null;
}

function updateFrameControls(state) {
    if (!state.timeline) return;
    state.timeline.value = String(state.frame);
    if (state.kind === "VIDEO") {
        state.readout.textContent = formatFrameCode(state.frame, state.fps);
        state.readoutTotal.textContent = formatFrameCode(state.frames, state.fps);
    } else {
        state.readout.textContent = String(state.frame);
        state.readoutTotal.textContent = String(state.frames);
    }
}

function seekFrame(state, frame, pause = true) {
    const next = clamp(Math.round(Number(frame) || 0), 0, Math.max(0, state.frames - 1));
    state.frame = next;
    if (pause) {
        state.playing = false;
        state.videoA.pause();
        state.videoB.pause();
        state.playButton.classList.remove("playing");
        state.playButton.textContent = ">";
    }
    if (state.kind === "VIDEO") {
        const seconds = next / Math.max(0.001, state.fps);
        state.videoA.currentTime = seconds;
        state.videoB.currentTime = seconds;
    } else if (state.kind === "IMAGE" || state.kind === "MASK") {
        loadImageFrames(state, next);
    }
    updateFrameControls(state);
    drawMedia(state);
}

function loadImageFrames(state, frame = state.frame) {
    if (!state || (state.kind !== "IMAGE" && state.kind !== "MASK")) return;
    const urlA = mediaUrl(state.imageSourceA, frame);
    const urlB = mediaUrl(state.imageSourceB, frame);
    state.imageA.dataset.frame = String(Math.max(0, Math.round(Number(frame) || 0)));
    state.imageB.dataset.frame = state.imageA.dataset.frame;
    if (state.imageA.src !== urlA) state.imageA.src = urlA;
    if (state.imageB.src !== urlB) state.imageB.src = urlB;
}

function stopPlayback(state) {
    state.playing = false;
    stopAnimationLoop(state);
    state.videoA.pause();
    state.videoB.pause();
    state.playButton.classList.remove("playing");
    state.playButton.textContent = ">";
}

async function startVideo(video) {
    // Call play() synchronously from the click handler. Waiting for canplay
    // first loses the user-activation token and browsers reject audible play.
    try {
        const result = video.play();
        if (result && typeof result.then === "function") {
            await result;
        }
        return true;
    } catch {
        return false;
    }
}

async function togglePlayback(state) {
    if (state.playing) {
        stopPlayback(state);
        return;
    }
    const maxSeconds = Math.max(0, (state.frames - 1) / Math.max(0.001, state.fps));
    if (state.frame >= state.frames - 1) seekFrame(state, 0, false);
    const starts = [startVideo(state.videoA), startVideo(state.videoB)];
    // Reflect the user's click immediately while the media elements finish
    // buffering in the background.
    state.playing = true;
    state.playButton.classList.add("playing");
    state.playButton.textContent = "||";
    startAnimationLoop(state);
    const started = await Promise.all(starts);
    if (!started.some(Boolean)) {
        stopPlayback(state);
        state.status.textContent = "Video preview is still loading";
        return;
    }
    try {
        forceCompareRefresh(state);
        if (state.videoA.currentTime > maxSeconds + 0.1) seekFrame(state, 0, false);
    } catch (error) {
        stopPlayback(state);
        state.status.textContent = error?.message || "Unable to play preview";
    }
}

function setMediaSources(state, payload) {
    const sources = payload.sources || {};
    const timeline = payload.timeline || {};
    state.mode = "media";
    applyComparePosition(state);
    state.kind = String(payload.media_kind || "MEDIA");
    state.frames = Math.max(1, Number(timeline.frames || 1));
    state.fps = Math.max(0.001, Number(timeline.fps || 24));
    state.frame = clamp(state.frame, 0, state.frames - 1);
    state.timeline.max = String(Math.max(0, state.frames - 1));
    state.imageSourceA = sources.a || null;
    state.imageSourceB = sources.b || null;
    const isVideo = state.kind === "VIDEO";
    state.videoA.onloadedmetadata = isVideo ? () => seekFrame(state, state.frame, false) : null;
    state.videoB.onloadedmetadata = isVideo ? () => seekFrame(state, state.frame, false) : null;
    // The shared animation loop only runs while playing, so a paused seek has to
    // repaint from the seeked event itself.
    state.videoA.onseeked = isVideo ? () => scheduleRedraw(state) : null;
    state.videoB.onseeked = isVideo ? () => scheduleRedraw(state) : null;
    const onVideoEnded = () => {
        if (state.playing && state.videoA.ended && state.videoB.ended) stopPlayback(state);
    };
    state.videoA.onended = isVideo ? onVideoEnded : null;
    state.videoB.onended = isVideo ? onVideoEnded : null;
    state.imageA.onload = () => { if (state.mode === "media" && state.imageA.dataset.frame === String(state.frame)) drawMedia(state); };
    state.imageB.onload = () => { if (state.mode === "media" && state.imageB.dataset.frame === String(state.frame)) drawMedia(state); };
    state.imageA.onerror = () => { if (state.mode === "media") state.status.textContent = "Unable to load source A image"; };
    state.imageB.onerror = () => { if (state.mode === "media") state.status.textContent = "Unable to load source B image"; };
    if (isVideo) {
        state.imageA.removeAttribute("src");
        state.imageB.removeAttribute("src");
        const urlA = mediaUrl(sources.a);
        const urlB = mediaUrl(sources.b);
        if (state.videoA.src !== urlA) { state.videoA.src = urlA; state.videoA.load(); }
        if (state.videoB.src !== urlB) { state.videoB.src = urlB; state.videoB.load(); }
    } else {
        stopPlayback(state);
        state.videoA.removeAttribute("src");
        state.videoB.removeAttribute("src");
        loadImageFrames(state, state.frame);
    }
    state.status.textContent = `${state.kind} · ${state.frames} frames · ${state.fps.toFixed(3)} fps`;
    state.playButton.disabled = false;
    state.prevButton.disabled = false;
    state.nextButton.disabled = false;
    state.timeline.disabled = false;
    state.controls.hidden = false;
    state.playButton.hidden = state.kind !== "VIDEO";
    state.playButton.disabled = state.kind !== "VIDEO";
    state.audioButton.hidden = state.kind !== "VIDEO";
    state.audioButton.disabled = state.kind !== "VIDEO";
    setAudioChoice(state, state.audioChoice);
    state.zoomButtons.forEach((button) => { button.disabled = false; });
    updateFrameControls(state);
    drawMedia(state);
}

function appendParts(parent, parts, side) {
    for (const part of Array.isArray(parts) ? parts : []) {
        const span = document.createElement("span");
        span.className = `cs-compare-any-diff-part ${part.kind || "equal"} ${side}`;
        span.textContent = String(part.text || "");
        parent.appendChild(span);
    }
}

function createDiffPane(side, rows) {
    const pane = document.createElement("section");
    pane.className = `cs-compare-any-diff-pane cs-compare-any-diff-pane-${side}`;
    const label = document.createElement("div");
    label.className = "cs-compare-any-diff-label";
    label.textContent = side.toUpperCase();
    const body = document.createElement("div");
    body.className = `cs-compare-any-diff-content cs-compare-any-diff-content-${side}`;
    for (const row of rows) {
        const operation = String(row?.op || "equal");
        const line = document.createElement("div");
        line.className = `cs-compare-any-diff-line ${operation} ${side}`;
        const prefix = document.createElement("span");
        prefix.className = "cs-compare-any-diff-prefix";
        prefix.textContent = operation === "equal" || (operation === "insert" && side === "a") || (operation === "delete" && side === "b") ? " " : side === "a" ? "−" : "+";
        const lineContent = document.createElement("span");
        lineContent.className = "cs-compare-any-diff-line-content";
        appendParts(lineContent, row?.[`${side}_parts`], side);
        if (!lineContent.childNodes.length) lineContent.textContent = String(row?.[side] || "");
        line.append(prefix, lineContent);
        body.appendChild(line);
    }
    pane.append(label, body);
    return pane;
}

function renderDiff(state, payload) {
    stopCacheProgress(state);
    state.mode = "diff";
    stopPlayback(state);
    state.kind = String(payload.diff_kind || payload.type_a || "DIFF");
    state.status.textContent = `${state.kind} · text comparison`;
    state.playButton.disabled = true;
    state.prevButton.disabled = true;
    state.nextButton.disabled = true;
    state.timeline.disabled = true;
    state.zoomButtons.forEach((button) => { button.disabled = true; });
    state.controls.hidden = true;
    state.error.hidden = true;
    const rows = Array.isArray(payload.rows) ? payload.rows : [];
    state.diff.replaceChildren(createDiffPane("a", rows), createDiffPane("b", rows));
    const contentA = state.diff.querySelector(".cs-compare-any-diff-content-a");
    const contentB = state.diff.querySelector(".cs-compare-any-diff-content-b");
    let scrollSyncFrame = null;
    const syncScroll = (source, target) => {
        if (!source || !target || scrollSyncFrame != null) return;
        target.scrollTop = source.scrollTop;
        target.scrollLeft = source.scrollLeft;
        scrollSyncFrame = requestAnimationFrame(() => { scrollSyncFrame = null; });
    };
    contentA?.addEventListener("scroll", () => syncScroll(contentA, contentB), { passive: true });
    contentB?.addEventListener("scroll", () => syncScroll(contentB, contentA), { passive: true });
    state.shell.classList.add("cs-compare-any-diff-mode");
    state.shell.classList.remove("cs-compare-any-media-only");
    state.divider.hidden = true;
    state.canvasA.hidden = true;
    state.canvasCompare.hidden = true;
    state.sourceText.hidden = true;
    state.diff.hidden = false;
}

function renderError(state, payload) {
    stopCacheProgress(state);
    state.mode = "error";
    stopPlayback(state);
    state.status.textContent = "Type mismatch or unsupported input";
    state.playButton.disabled = true;
    state.prevButton.disabled = true;
    state.nextButton.disabled = true;
    state.timeline.disabled = true;
    state.zoomButtons.forEach((button) => { button.disabled = true; });
    state.controls.hidden = true;
    state.error.hidden = false;
    const unsupported = payload.type_a === "UNSUPPORTED" && payload.type_b === "UNSUPPORTED";
    state.error.textContent = unsupported ? "Unsupported Input Type" : "source_a and source-b must be the same type";
    state.shell.classList.remove("cs-compare-any-diff-mode");
    state.shell.classList.add("cs-compare-any-media-only");
    state.canvasA.hidden = false;
    state.canvasCompare.hidden = false;
    state.sourceText.hidden = true;
    state.divider.hidden = true;
    state.diff.hidden = true;
    clearMediaCanvases(state);
}

function renderMedia(state, payload) {
    stopCacheProgress(state);
    stopPlayback(state);
    setCompareZoom(state, 1);
    state.error.hidden = true;
    state.shell.classList.remove("cs-compare-any-diff-mode");
    state.shell.classList.add("cs-compare-any-media-only");
    state.canvasA.hidden = false;
    state.canvasCompare.hidden = false;
    state.sourceText.hidden = true;
    state.diff.hidden = true;
    state.divider.hidden = false;
    setMediaSources(state, payload);
}

function updateNode(node, output) {
    const state = node?.[STATE];
    if (!state || !output) return;
    const payload = latestPayload(output);
    const layout = normaliseViewportLayout(payload.view_port_layout);
    if (state.layout !== layout && !state.comparePositionManual) state.comparePosition = defaultComparePosition(layout);
    const mode = String(payload.mode || "error").toLowerCase();
    state.layout = layout;
    state.shell.classList.toggle("cs-compare-any-layout-vertical", layout === "vertical");
    state.shell.classList.toggle("cs-compare-any-layout-single", layout === "single");
    applyComparePosition(state);
    if (mode === "media") renderMedia(state, payload);
    else if (mode === "diff") renderDiff(state, payload);
    else renderError(state, payload);
    // The stage follows the node size, so a new output never resizes the node.
    syncDiffSplitToGrid(state);
    scheduleRedraw(state);
    node.graph?.setDirtyCanvas?.(true, true);
}

function addViewport(node) {
    addStyles();
    const shell = document.createElement("div");
    const configuredLayout = node?.widgets?.find((widget) => widget?.name === "view_port_layout")?.value;
    const initialLayout = normaliseViewportLayout(configuredLayout);
    shell.className = `cs-compare-any-shell cs-compare-any-media-only cs-compare-any-layout-${initialLayout}`;
    shell.innerHTML = `
      <div class="cs-compare-any-head"><span class="cs-compare-any-title">CS Compare Any</span><span class="cs-compare-any-status">Waiting for execution...</span></div>
      <div class="cs-compare-any-grid">
        <div class="cs-compare-any-viewport cs-compare-any-source"><canvas class="cs-compare-any-canvas-a"></canvas><pre class="cs-compare-any-text cs-compare-any-text-a"></pre></div>
        <div class="cs-compare-any-viewport cs-compare-any-compare"><canvas class="cs-compare-any-canvas-compare"></canvas><div class="cs-compare-any-diff"></div><div class="cs-compare-any-divider" title="Drag to compare A and B"></div><div class="cs-compare-any-error" hidden></div><div class="cs-compare-any-loading" hidden>Loading comparison cache 0%</div><div class="cs-compare-any-resize-handle" data-resize="bottom" title="Resize viewport" aria-label="Resize viewport"></div></div>
        <div class="cs-compare-any-split-handle" title="Resize comparison panes" aria-label="Resize comparison panes"></div>
      </div>
      <div class="cs-compare-any-controls" hidden><button class="cs-compare-any-button cs-compare-any-prev" type="button" title="Previous frame" aria-label="Previous frame" disabled>|&lt;</button><button class="cs-compare-any-button cs-compare-any-play" type="button" title="Play or pause" aria-label="Play or pause" disabled>&gt;</button><button class="cs-compare-any-button cs-compare-any-next" type="button" title="Next frame" aria-label="Next frame" disabled>&gt;|</button><button class="cs-compare-any-button cs-compare-any-audio-button" type="button" title="Play source A audio" aria-label="Play source A audio" disabled>🔊 A</button><input class="cs-compare-any-timeline" type="range" min="0" max="0" step="1" value="0" aria-label="Frame timeline" disabled><span class="cs-compare-any-readout">00:00:00</span><span class="cs-compare-any-readout-separator">/</span><span class="cs-compare-any-readout-total">00:00:00</span><div class="cs-compare-any-zoom-group"><button class="cs-compare-any-button cs-compare-any-zoom-button" data-zoom="in" type="button" title="Zoom in" aria-label="Zoom in" disabled>+</button><button class="cs-compare-any-button cs-compare-any-zoom-button" data-zoom="fit" type="button" title="Fit" aria-label="Fit" disabled>Fit</button><button class="cs-compare-any-button cs-compare-any-zoom-button" data-zoom="out" type="button" title="Zoom out" aria-label="Zoom out" disabled>−</button></div></div>`;
    // The shell covers the whole node body, so its bottom-right corner has to
    // reach the canvas or the node resize grip stays dead.
    const inOuterResizeZone = (event) => {
        const rect = shell.getBoundingClientRect();
        return event.clientX >= rect.right - 26 && event.clientY >= rect.bottom - 24;
    };
    for (const type of ["pointerdown", "click", "dblclick", "wheel"]) {
        shell.addEventListener(type, (event) => {
            if (type !== "wheel" && inOuterResizeZone(event)) return;
            event.stopPropagation();
        }, { passive: false });
    }
    // The widget element sits above the canvas, so litegraph never sees a press
    // inside the node body. A grip in the shell's own corner keeps the classic
    // bottom-right resize available without exposing the whole stage to it.
    const cornerGrip = document.createElement("div");
    cornerGrip.className = "cs-compare-any-corner-grip";
    cornerGrip.setAttribute("title", "Drag to resize node");
    shell.appendChild(cornerGrip);
    let gripDrag = null;
    const gripScale = () => Number(app.canvas?.ds?.scale) || 1;
    const gripFinish = (event) => {
        if (!gripDrag || event.pointerId !== gripDrag.pointerId) return;
        gripDrag = null;
        cornerGrip.releasePointerCapture?.(event.pointerId);
    };
    cornerGrip.addEventListener("pointerdown", (event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.stopPropagation();
        gripDrag = {
            pointerId: event.pointerId,
            startX: event.clientX,
            startY: event.clientY,
            startWidth: Number(node.size?.[0]) || NODE_MIN_WIDTH,
            startHeight: Number(node.size?.[1]) || NODE_MIN_HEIGHT,
            scale: gripScale(),
        };
        cornerGrip.setPointerCapture?.(event.pointerId);
    });
    cornerGrip.addEventListener("pointermove", (event) => {
        if (!gripDrag || event.pointerId !== gripDrag.pointerId) return;
        event.preventDefault();
        event.stopPropagation();
        const nextWidth = Math.max(NODE_MIN_WIDTH, Math.round(gripDrag.startWidth + (event.clientX - gripDrag.startX) / gripDrag.scale));
        const nextHeight = Math.max(NODE_MIN_HEIGHT, Math.round(gripDrag.startHeight + (event.clientY - gripDrag.startY) / gripDrag.scale));
        if (nextWidth === Math.round(Number(node.size?.[0]) || 0) && nextHeight === Math.round(Number(node.size?.[1]) || 0)) return;
        node.setSize?.([nextWidth, nextHeight]);
        node.graph?.setDirtyCanvas?.(true, true);
    });
    cornerGrip.addEventListener("pointerup", gripFinish);
    cornerGrip.addEventListener("pointercancel", gripFinish);
    const videoA = document.createElement("video");
    const videoB = document.createElement("video");
    const imageA = new Image();
    const imageB = new Image();
    for (const image of [imageA, imageB]) {
        image.decoding = "async";
        image.setAttribute("aria-hidden", "true");
    }
    for (const video of [videoA, videoB]) {
        video.preload = "auto";
        video.muted = true;
        video.playsInline = true;
        video.setAttribute("aria-hidden", "true");
        video.style.position = "absolute";
        video.style.width = "1px";
        video.style.height = "1px";
        video.style.opacity = "0";
        video.style.pointerEvents = "none";
    }
    shell.append(videoA, videoB);
    const widget = node.addDOMWidget("compare_any_view", "compare_any_view", shell, { margin: 4 });
    widget.serialize = false;
    widget.options = { ...(widget.options || {}), serialize: false, canvasOnly: false };
    const state = {
        shell,
        widget,
        head: shell.querySelector(".cs-compare-any-head"),
        status: shell.querySelector(".cs-compare-any-status"),
        canvasA: shell.querySelector(".cs-compare-any-canvas-a"),
        canvasCompare: shell.querySelector(".cs-compare-any-canvas-compare"),
        sourceViewport: shell.querySelector(".cs-compare-any-source"),
        compareViewport: shell.querySelector(".cs-compare-any-compare"),
        grid: shell.querySelector(".cs-compare-any-grid"),
        splitHandle: shell.querySelector(".cs-compare-any-split-handle"),
        sourceText: shell.querySelector(".cs-compare-any-text-a"),
        diff: shell.querySelector(".cs-compare-any-diff"),
        divider: shell.querySelector(".cs-compare-any-divider"),
        error: shell.querySelector(".cs-compare-any-error"),
        loading: shell.querySelector(".cs-compare-any-loading"),
        controls: shell.querySelector(".cs-compare-any-controls"),
        timeline: shell.querySelector(".cs-compare-any-timeline"),
        readout: shell.querySelector(".cs-compare-any-readout"),
        readoutTotal: shell.querySelector(".cs-compare-any-readout-total"),
        zoomButtons: [...shell.querySelectorAll(".cs-compare-any-zoom-button")],
        audioButton: shell.querySelector(".cs-compare-any-audio-button"),
        playButton: shell.querySelector(".cs-compare-any-play"),
        prevButton: shell.querySelector(".cs-compare-any-prev"),
        nextButton: shell.querySelector(".cs-compare-any-next"),
        videoA,
        videoB,
        imageA,
        imageB,
        imageSourceA: null,
        imageSourceB: null,
        mode: "none",
        kind: "",
        frame: 0,
        frames: 1,
        fps: 24,
        playing: false,
        comparePosition: defaultComparePosition(initialLayout),
        comparePositionManual: false,
        compareZoom: 1,
        comparePanX: 0,
        comparePanY: 0,
        audioChoice: "A",
        layout: initialLayout,
        splitRatio: 0.5,
        splitDragging: false,
        node,
        disposed: false,
        animationFrame: null,
        compareRefreshFrame: null,
        redrawFrame: null,
        redrawQuality: null,
        settleTimer: null,
        progressTimer: null,
        progressSerial: 0,
    };
    // The stage owns the whole widget and the widget owns the rest of the node
    // body. A fixed floor with no ceiling keeps the outer node height in the
    // user's hands: growing the node grows the preview instead of leaving a gap
    // under the controls, and shrinking it stops fighting the drag.
    widget.options.getMinHeight = () => WIDGET_MIN_HEIGHT;
    widget.options.getMaxHeight = () => undefined;
    state.timeline.addEventListener("input", () => seekFrame(state, state.timeline.value));
    state.prevButton.addEventListener("click", () => seekFrame(state, state.frame - 1));
    state.nextButton.addEventListener("click", () => seekFrame(state, state.frame + 1));
    state.playButton.addEventListener("click", () => togglePlayback(state));
    state.audioButton.addEventListener("click", () => {
        const next = state.audioChoice === "A" ? "B" : state.audioChoice === "B" ? "MUTE" : "A";
        setAudioChoice(state, next);
    });
    state.zoomButtons.forEach((button) => button.addEventListener("click", () => {
        if (button.dataset.zoom === "fit") setCompareZoom(state, 1);
        else setCompareZoom(state, state.compareZoom + (button.dataset.zoom === "in" ? 0.1 : -0.1));
    }));
    setAudioChoice(state, "A");
    state.playButton.disabled = true;
    state.audioButton.disabled = true;
    state.audioButton.hidden = true;
    state.prevButton.disabled = true;
    state.nextButton.disabled = true;
    state.timeline.disabled = true;
    state.zoomButtons.forEach((button) => { button.disabled = true; });
    applyComparePosition(state);
    state.shell.querySelectorAll("[data-resize]").forEach((handle) => attachHeightHandle(state, handle));
    attachDiffSplitHandle(state);
    bindComparePanZoom(state);
    let dragging = false;
    const updateDivider = (event) => {
        const rect = state.divider.parentElement.getBoundingClientRect();
        state.comparePosition = clamp(((event.clientX - rect.left) / Math.max(1, rect.width)) * 100, 0, 100);
        state.divider.parentElement.style.setProperty("--compare-position", `${state.comparePosition}%`);
        beginInteraction(state);
    };
    state.divider.addEventListener("pointerdown", (event) => { if (event.button !== 0) return; event.preventDefault(); state.comparePositionManual = true; dragging = true; state.divider.setPointerCapture?.(event.pointerId); updateDivider(event); });
    state.divider.addEventListener("pointermove", (event) => { if (dragging) updateDivider(event); });
    const stopDragging = (event) => { if (!dragging) return; dragging = false; state.divider.releasePointerCapture?.(event.pointerId); forceCompareRefresh(state); };
    state.divider.addEventListener("pointerup", stopDragging);
    state.divider.addEventListener("pointercancel", stopDragging);
    const originalResize = node.onResize;
    node.onResize = function () {
        const result = originalResize?.apply(this, arguments);
        beginInteraction(state);
        syncDiffSplitToGrid(state);
        return result;
    };
    const resizeObserver = new ResizeObserver(() => {
        beginInteraction(state);
        syncDiffSplitToGrid(state);
    });
    resizeObserver.observe(state.grid);
    state.dispose = () => { state.disposed = true; stopCacheProgress(state); stopAnimationLoop(state); cancelAnimationFrame(state.animationFrame); cancelAnimationFrame(state.compareRefreshFrame); cancelAnimationFrame(state.redrawFrame); if (state.settleTimer != null) clearTimeout(state.settleTimer); resizeObserver.disconnect(); videoA.pause(); videoB.pause(); videoA.removeAttribute("src"); videoB.removeAttribute("src"); imageA.onload = null; imageB.onload = null; imageA.removeAttribute("src"); imageB.removeAttribute("src"); };
    node[STATE] = state;
    node[WIDGET] = widget;
    scheduleRedraw(state);
    return state;
}

function graphNode(locator) {
    const rawId = String(locator || "").split(":").at(-1);
    const numericId = Number(rawId);
    const ids = Number.isFinite(numericId) ? [numericId, rawId] : [rawId];
    const graphs = [app.canvas?.graph, app.graph, app.rootGraph].filter(Boolean);
    for (const graph of graphs) {
        for (const id of ids) {
            const node = graph.getNodeById?.(id);
            if (node) return node;
        }
    }
    return null;
}

api.addEventListener("executing", ({ detail }) => {
    if (detail == null) return;
    const node = graphNode(detail);
    if (node?.type === NODE_ID || node?.comfyClass === NODE_ID) beginCacheProgress(node);
});

app.registerExtension({
    name: "CineStyle.CompareAny",
    async beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData?.name !== NODE_ID) return;
        const originalCreated = nodeType.prototype.onNodeCreated;
        nodeType.prototype.onNodeCreated = function () {
            originalCreated?.apply(this, arguments);
            addViewport(this);
            this.setSize?.([NODE_MIN_WIDTH, NODE_MIN_HEIGHT]);
        };
        const originalExecuted = nodeType.prototype.onExecuted;
        nodeType.prototype.onExecuted = function (output) {
            updateNode(this, output);
            originalExecuted?.apply(this, arguments);
        };
        const originalRemoved = nodeType.prototype.onRemoved;
        nodeType.prototype.onRemoved = function () {
            this[STATE]?.dispose?.();
            originalRemoved?.apply(this, arguments);
        };
    },
    loadedGraphNode(node) {
        if (node?.type !== NODE_ID && node?.comfyClass !== NODE_ID) return;
        if (!node[STATE]) addViewport(node);
        const width = Math.max(NODE_MIN_WIDTH, Number(node.size?.[0]) || NODE_MIN_WIDTH);
        const storedHeight = Number(node.size?.[1]) || NODE_MIN_HEIGHT;
        // 650px was the old two-viewport default. Collapse that legacy size
        // so loaded nodes do not retain an empty upper area.
        const height = storedHeight === 650 ? NODE_MIN_HEIGHT : Math.max(NODE_MIN_HEIGHT, storedHeight);
        node.setSize?.([width, height]);
    },
    onNodeOutputsUpdated(outputs) {
        for (const [locator, output] of Object.entries(outputs || {})) {
            const node = graphNode(locator);
            if (node && (node.type === NODE_ID || node.comfyClass === NODE_ID)) updateNode(node, output);
        }
    },
});
