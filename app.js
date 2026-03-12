const fileInput = document.getElementById("fileInput");
const filenameInput = document.getElementById("filenameInput");
const status = document.getElementById("status");
const editorCanvas = document.getElementById("editorCanvas");
const editorCtx = editorCanvas.getContext("2d");
const emptyState = document.getElementById("emptyState");
const canvasTitle = document.getElementById("canvasTitle");
const canvasHint = document.getElementById("canvasHint");

const modeTabs = [...document.querySelectorAll(".mode-tab")];
const artifactControls = document.getElementById("artifactControls");
const backgroundControls = document.getElementById("backgroundControls");

const fillMode = document.getElementById("fillMode");
const sampleRadius = document.getElementById("sampleRadius");
const sampleRadiusValue = document.getElementById("sampleRadiusValue");
const selectionExpand = document.getElementById("selectionExpand");
const selectionExpandValue = document.getElementById("selectionExpandValue");
const removeButton = document.getElementById("removeButton");

const removeBackgroundButton = document.getElementById("removeBackgroundButton");
const sampleToolButton = document.getElementById("sampleToolButton");
const restoreToolButton = document.getElementById("restoreToolButton");
const clearSamplesButton = document.getElementById("clearSamplesButton");
const sampleSummary = document.getElementById("sampleSummary");
const thresholdRange = document.getElementById("thresholdRange");
const thresholdValue = document.getElementById("thresholdValue");
const thresholdHint = document.getElementById("thresholdHint");
const featherRange = document.getElementById("featherRange");
const featherValue = document.getElementById("featherValue");
const brushSizeRange = document.getElementById("brushSizeRange");
const brushSizeValue = document.getElementById("brushSizeValue");

const undoButton = document.getElementById("undoButton");
const resetButton = document.getElementById("resetButton");
const downloadButton = document.getElementById("downloadButton");

const createBufferCanvas = () => {
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d", { willReadFrequently: true });
  return { canvas, context };
};

const originalBuffer = createBufferCanvas();
const artifactBuffer = createBufferCanvas();
const workingBuffer = createBufferCanvas();

const state = {
  imageLoaded: false,
  activeMode: "artifact",
  backgroundTool: "sample",
  selection: null,
  dragStart: null,
  isSelecting: false,
  isRestoring: false,
  lastPointer: null,
  manualSamples: [],
  backgroundMask: null,
  undoSnapshot: null,
  hasRemovalEdits: false,
};

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

const sortNumeric = (a, b) => a - b;

const median = (values) => {
  if (values.length === 0) {
    return 0;
  }

  const ordered = [...values].sort(sortNumeric);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 === 0
    ? Math.round((ordered[middle - 1] + ordered[middle]) / 2)
    : ordered[middle];
};

const averageColor = (colors) => {
  if (colors.length === 0) {
    return { r: 0, g: 0, b: 0, a: 255 };
  }

  const totals = colors.reduce(
    (acc, color) => {
      acc.r += color.r;
      acc.g += color.g;
      acc.b += color.b;
      acc.a += color.a;
      return acc;
    },
    { r: 0, g: 0, b: 0, a: 0 }
  );

  return {
    r: Math.round(totals.r / colors.length),
    g: Math.round(totals.g / colors.length),
    b: Math.round(totals.b / colors.length),
    a: Math.round(totals.a / colors.length),
  };
};

const getLuminance = (color) => 0.2126 * color.r + 0.7152 * color.g + 0.0722 * color.b;

const getSaturation = (color) => {
  const max = Math.max(color.r, color.g, color.b);
  const min = Math.min(color.r, color.g, color.b);
  return max - min;
};

const smoothstep = (edge0, edge1, value) => {
  if (edge0 === edge1) {
    return value < edge0 ? 0 : 1;
  }

  const normalized = clamp((value - edge0) / (edge1 - edge0), 0, 1);
  return normalized * normalized * (3 - 2 * normalized);
};

const sanitizeFilename = (value) => {
  const cleaned = value
    .trim()
    .replace(/\.png$/i, "")
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "")
    .replace(/\s+/g, " ");

  return cleaned || "artifact-removed";
};

const setStatus = (message) => {
  status.textContent = message;
};

const hasImageDimensions = () => artifactBuffer.canvas.width > 0 && artifactBuffer.canvas.height > 0;

const readPixel = (imageData, x, y) => {
  const index = (y * imageData.width + x) * 4;
  const pixels = imageData.data;

  return {
    r: pixels[index],
    g: pixels[index + 1],
    b: pixels[index + 2],
    a: pixels[index + 3],
  };
};

const writePixel = (imageData, x, y, color) => {
  const index = (y * imageData.width + x) * 4;
  imageData.data[index] = color.r;
  imageData.data[index + 1] = color.g;
  imageData.data[index + 2] = color.b;
  imageData.data[index + 3] = color.a;
};

const normalizeRect = (rect) => {
  const x = Math.min(rect.x1, rect.x2);
  const y = Math.min(rect.y1, rect.y2);
  const width = Math.abs(rect.x2 - rect.x1);
  const height = Math.abs(rect.y2 - rect.y1);
  return { x, y, width, height };
};

const getCanvasPoint = (event) => {
  const bounds = editorCanvas.getBoundingClientRect();
  const scaleX = editorCanvas.width / bounds.width;
  const scaleY = editorCanvas.height / bounds.height;

  return {
    x: clamp(Math.round((event.clientX - bounds.left) * scaleX), 0, editorCanvas.width - 1),
    y: clamp(Math.round((event.clientY - bounds.top) * scaleY), 0, editorCanvas.height - 1),
  };
};

const updateRangeLabels = () => {
  sampleRadiusValue.textContent = `${sampleRadius.value} px`;
  selectionExpandValue.textContent = `${selectionExpand.value} px`;
  thresholdValue.textContent = thresholdRange.value;
  featherValue.textContent = `${featherRange.value} px`;
  brushSizeValue.textContent = `${brushSizeRange.value} px`;
  sampleSummary.textContent = `${state.manualSamples.length} manual background sample${
    state.manualSamples.length === 1 ? "" : "s"
  } added.`;

  const threshold = Number(thresholdRange.value);
  let thresholdMessage = "Sweet spot: 13 is safest, 14-15 can help on stubborn background, and 16+ is risky.";

  if (threshold <= 12) {
    thresholdMessage = "Very protective: this keeps foreground safer, but it may leave more background behind.";
  } else if (threshold === 13) {
    thresholdMessage = "Recommended: 13 is the best balance for protecting the subject while cleaning the background.";
  } else if (threshold <= 15) {
    thresholdMessage = "Aggressive but usable: 14-15 can remove harder background, though edge clipping may start to show.";
  } else {
    thresholdMessage = "High risk: this range can clip foreground details, so use it only for difficult leftovers.";
  }

  thresholdHint.textContent = thresholdMessage;
  thresholdHint.classList.toggle("is-caution", threshold >= 16);
};

const updateCanvasCopy = () => {
  if (!state.imageLoaded) {
    canvasTitle.textContent = "Draw a box around the object to remove.";
    canvasHint.textContent = "Click and drag on the image.";
    return;
  }

  if (state.activeMode === "artifact") {
    canvasTitle.textContent = "Draw a box around the object to remove.";
    canvasHint.textContent = "Click and drag on the image.";
    return;
  }

  if (state.backgroundTool === "restore") {
    canvasTitle.textContent = "Paint original details back into the current result.";
    canvasHint.textContent = "Drag over edges or areas the background remover cut away by accident.";
    return;
  }

  canvasTitle.textContent = "Remove the background into true transparency.";
  canvasHint.textContent = "Auto-detect uses edges first. Click extra background spots if it needs help.";
};

const syncUi = () => {
  const enabled = state.imageLoaded;

  artifactControls.hidden = state.activeMode !== "artifact";
  backgroundControls.hidden = state.activeMode !== "background";

  modeTabs.forEach((tab) => {
    const isActive = tab.dataset.mode === state.activeMode;
    tab.classList.toggle("is-active", isActive);
    tab.setAttribute("aria-pressed", String(isActive));
  });

  sampleToolButton.classList.toggle("is-active", state.backgroundTool === "sample");
  restoreToolButton.classList.toggle("is-active", state.backgroundTool === "restore");

  filenameInput.disabled = !enabled;
  resetButton.disabled = !enabled;
  downloadButton.disabled = !enabled;
  undoButton.disabled = !state.undoSnapshot;
  removeButton.disabled =
    !enabled || state.activeMode !== "artifact" || !state.selection;

  removeBackgroundButton.disabled = !enabled;
  sampleToolButton.disabled = !enabled;
  restoreToolButton.disabled = !enabled;
  clearSamplesButton.disabled = !enabled || state.manualSamples.length === 0;

  editorCanvas.classList.toggle("ready", enabled);
  emptyState.classList.toggle("hidden", enabled);
  editorCanvas.style.cursor =
    enabled && state.activeMode === "background" && state.backgroundTool === "restore"
      ? "none"
      : enabled
        ? "crosshair"
        : "default";

  updateRangeLabels();
  updateCanvasCopy();
};

const captureUndoSnapshot = () => {
  if (!state.imageLoaded) {
    return;
  }

  state.undoSnapshot = {
    artifactImageData: artifactBuffer.context.getImageData(
      0,
      0,
      artifactBuffer.canvas.width,
      artifactBuffer.canvas.height
    ),
    workingImageData: workingBuffer.context.getImageData(
      0,
      0,
      workingBuffer.canvas.width,
      workingBuffer.canvas.height
    ),
    backgroundMask: state.backgroundMask ? new Uint8ClampedArray(state.backgroundMask) : null,
    manualSamples: state.manualSamples.map((point) => ({ ...point })),
    hasRemovalEdits: state.hasRemovalEdits,
  };
};

const rebuildWorkingFromMask = () => {
  if (!state.imageLoaded) {
    return;
  }

  if (!state.backgroundMask) {
    const imageData = artifactBuffer.context.getImageData(
      0,
      0,
      artifactBuffer.canvas.width,
      artifactBuffer.canvas.height
    );
    workingBuffer.context.putImageData(imageData, 0, 0);
    return;
  }

  const imageData = artifactBuffer.context.getImageData(
    0,
    0,
    artifactBuffer.canvas.width,
    artifactBuffer.canvas.height
  );

  for (let index = 0; index < state.backgroundMask.length; index += 1) {
    const alphaIndex = index * 4 + 3;
    imageData.data[alphaIndex] = Math.round(
      imageData.data[alphaIndex] * (state.backgroundMask[index] / 255)
    );
  }

  workingBuffer.context.putImageData(imageData, 0, 0);
};

const render = () => {
  editorCtx.clearRect(0, 0, editorCanvas.width, editorCanvas.height);

  if (!state.imageLoaded) {
    return;
  }

  editorCtx.drawImage(workingBuffer.canvas, 0, 0);

  if (state.activeMode === "artifact" && state.selection) {
    editorCtx.save();
    editorCtx.fillStyle = "rgba(161, 78, 30, 0.14)";
    editorCtx.strokeStyle = "rgba(161, 78, 30, 0.95)";
    editorCtx.lineWidth = 2;
    editorCtx.setLineDash([8, 6]);
    editorCtx.fillRect(state.selection.x, state.selection.y, state.selection.width, state.selection.height);
    editorCtx.strokeRect(state.selection.x, state.selection.y, state.selection.width, state.selection.height);
    editorCtx.restore();
  }

  if (state.activeMode === "background" && state.manualSamples.length > 0) {
    editorCtx.save();
    state.manualSamples.forEach((point, index) => {
      editorCtx.fillStyle = "rgba(255, 248, 238, 0.95)";
      editorCtx.strokeStyle = "rgba(127, 59, 22, 0.95)";
      editorCtx.lineWidth = 2;
      editorCtx.beginPath();
      editorCtx.arc(point.x, point.y, 6, 0, Math.PI * 2);
      editorCtx.fill();
      editorCtx.stroke();

      editorCtx.fillStyle = "rgba(127, 59, 22, 0.95)";
      editorCtx.font = "12px Avenir Next, sans-serif";
      editorCtx.fillText(String(index + 1), point.x + 9, point.y + 4);
    });
    editorCtx.restore();
  }

  if (
    state.activeMode === "background" &&
    state.backgroundTool === "restore" &&
    state.lastPointer
  ) {
    editorCtx.save();
    editorCtx.strokeStyle = "rgba(127, 59, 22, 0.9)";
    editorCtx.lineWidth = 2;
    editorCtx.setLineDash([4, 4]);
    editorCtx.beginPath();
    editorCtx.arc(state.lastPointer.x, state.lastPointer.y, Number(brushSizeRange.value) / 2, 0, Math.PI * 2);
    editorCtx.stroke();
    editorCtx.restore();
  }
};

const setMode = (mode) => {
  state.activeMode = mode;
  state.selection = null;
  state.dragStart = null;
  state.isSelecting = false;
  state.isRestoring = false;
  state.lastPointer = null;
  syncUi();
  render();

  if (!state.imageLoaded) {
    return;
  }

  if (mode === "artifact") {
    setStatus("Artifact mode ready. Drag a box around the object you want to remove.");
  } else {
    setStatus(
      state.backgroundTool === "restore"
        ? "Restore Details is ready. Paint original image pixels back into the current result."
        : "Background mode ready. Remove Background will cut matching backdrop pixels to transparency."
    );
  }
};

const setBackgroundTool = (tool, shouldAnnounce = true) => {
  state.backgroundTool = tool;
  state.selection = null;
  state.lastPointer = null;
  syncUi();
  render();

  if (!state.imageLoaded || !shouldAnnounce) {
    return;
  }

  if (tool === "restore") {
    setStatus("Restore Details is active. Drag across removed areas to paint original pixels back in.");
  } else {
    setStatus("Add Background Samples is active. Click spots that should count as removable background.");
  }
};

const collectRingPixels = (imageData, rect, ringSize) => {
  const pixels = [];
  const left = clamp(rect.x, 0, imageData.width - 1);
  const top = clamp(rect.y, 0, imageData.height - 1);
  const right = clamp(rect.x + rect.width, 0, imageData.width);
  const bottom = clamp(rect.y + rect.height, 0, imageData.height);

  const ringLeft = clamp(left - ringSize, 0, imageData.width);
  const ringTop = clamp(top - ringSize, 0, imageData.height);
  const ringRight = clamp(right + ringSize, 0, imageData.width);
  const ringBottom = clamp(bottom + ringSize, 0, imageData.height);

  for (let y = ringTop; y < ringBottom; y += 1) {
    for (let x = ringLeft; x < ringRight; x += 1) {
      const insideRect = x >= left && x < right && y >= top && y < bottom;
      if (!insideRect) {
        pixels.push(readPixel(imageData, x, y));
      }
    }
  }

  return pixels;
};

const getTransparentRatio = (pixels) => {
  if (pixels.length === 0) {
    return 0;
  }

  const transparentPixels = pixels.filter((pixel) => pixel.a <= 20).length;
  return transparentPixels / pixels.length;
};

const getPreferredFillPixels = (pixels) => {
  const visiblePixels = pixels.filter((pixel) => pixel.a > 20);
  return visiblePixels.length > 0 ? visiblePixels : pixels;
};

const collectStrip = (imageData, startX, startY, endX, endY) => {
  const colors = [];
  const clampedStartX = clamp(startX, 0, imageData.width);
  const clampedStartY = clamp(startY, 0, imageData.height);
  const clampedEndX = clamp(endX, 0, imageData.width);
  const clampedEndY = clamp(endY, 0, imageData.height);

  for (let y = clampedStartY; y < clampedEndY; y += 1) {
    for (let x = clampedStartX; x < clampedEndX; x += 1) {
      colors.push(readPixel(imageData, x, y));
    }
  }

  return colors;
};

const computeSolidFill = (imageData, rect, ringSize, options = {}) => {
  const ringPixels = collectRingPixels(imageData, rect, ringSize);
  if (ringPixels.length === 0) {
    return { r: 255, g: 255, b: 255, a: 255 };
  }

  const preferredPixels = options.preferVisiblePixels
    ? getPreferredFillPixels(ringPixels)
    : ringPixels;

  return {
    r: median(preferredPixels.map((pixel) => pixel.r)),
    g: median(preferredPixels.map((pixel) => pixel.g)),
    b: median(preferredPixels.map((pixel) => pixel.b)),
    a: median(preferredPixels.map((pixel) => pixel.a)),
  };
};

const lerp = (start, end, t) => start + (end - start) * t;

const mixColors = (a, b, t) => ({
  r: Math.round(lerp(a.r, b.r, t)),
  g: Math.round(lerp(a.g, b.g, t)),
  b: Math.round(lerp(a.b, b.b, t)),
  a: Math.round(lerp(a.a, b.a, t)),
});

const computeGradientEdges = (imageData, rect, ringSize, options = {}) => {
  const topColors = collectStrip(
    imageData,
    rect.x - ringSize,
    rect.y - ringSize,
    rect.x + rect.width + ringSize,
    rect.y
  );
  const bottomColors = collectStrip(
    imageData,
    rect.x - ringSize,
    rect.y + rect.height,
    rect.x + rect.width + ringSize,
    rect.y + rect.height + ringSize
  );
  const leftColors = collectStrip(
    imageData,
    rect.x - ringSize,
    rect.y,
    rect.x,
    rect.y + rect.height
  );
  const rightColors = collectStrip(
    imageData,
    rect.x + rect.width,
    rect.y,
    rect.x + rect.width + ringSize,
    rect.y + rect.height
  );

  const normalizeColors = (colors) =>
    options.preferVisiblePixels ? getPreferredFillPixels(colors) : colors;

  const normalizedTop = normalizeColors(topColors);
  const normalizedBottom = normalizeColors(bottomColors);
  const normalizedLeft = normalizeColors(leftColors);
  const normalizedRight = normalizeColors(rightColors);
  const fallback = computeSolidFill(imageData, rect, ringSize, options);

  return {
    top: normalizedTop.length ? averageColor(normalizedTop) : fallback,
    bottom: normalizedBottom.length ? averageColor(normalizedBottom) : fallback,
    left: normalizedLeft.length ? averageColor(normalizedLeft) : fallback,
    right: normalizedRight.length ? averageColor(normalizedRight) : fallback,
  };
};

const expandRect = (rect, expandBy) => {
  const x = clamp(rect.x - expandBy, 0, artifactBuffer.canvas.width);
  const y = clamp(rect.y - expandBy, 0, artifactBuffer.canvas.height);
  const right = clamp(rect.x + rect.width + expandBy, 0, artifactBuffer.canvas.width);
  const bottom = clamp(rect.y + rect.height + expandBy, 0, artifactBuffer.canvas.height);

  return {
    x,
    y,
    width: Math.max(1, right - x),
    height: Math.max(1, bottom - y),
  };
};

const applyArtifactFill = () => {
  if (!state.selection) {
    setStatus("Draw a box first so the app knows what to remove.");
    return;
  }

  captureUndoSnapshot();

  const expandedSelection = expandRect(state.selection, Number(selectionExpand.value));
  const ringSize = Number(sampleRadius.value);
  const sourceContext =
    state.backgroundMask && state.backgroundMask.some((value) => value < 255)
      ? workingBuffer.context
      : artifactBuffer.context;
  const sourceImageData = sourceContext.getImageData(
    0,
    0,
    workingBuffer.canvas.width,
    workingBuffer.canvas.height
  );
  const imageData = artifactBuffer.context.getImageData(
    0,
    0,
    artifactBuffer.canvas.width,
    artifactBuffer.canvas.height
  );
  const ringPixels = collectRingPixels(sourceImageData, expandedSelection, ringSize);
  const useTransparentErase =
    !!state.backgroundMask && getTransparentRatio(ringPixels) >= 0.55;

  if (useTransparentErase) {
    for (let y = expandedSelection.y; y < expandedSelection.y + expandedSelection.height; y += 1) {
      for (let x = expandedSelection.x; x < expandedSelection.x + expandedSelection.width; x += 1) {
        writePixel(imageData, x, y, { r: 0, g: 0, b: 0, a: 0 });
      }
    }
  } else if (fillMode.value === "solid") {
    const fill = computeSolidFill(sourceImageData, expandedSelection, ringSize, {
      preferVisiblePixels: !!state.backgroundMask,
    });

    for (let y = expandedSelection.y; y < expandedSelection.y + expandedSelection.height; y += 1) {
      for (let x = expandedSelection.x; x < expandedSelection.x + expandedSelection.width; x += 1) {
        writePixel(imageData, x, y, fill);
      }
    }
  } else {
    const edges = computeGradientEdges(sourceImageData, expandedSelection, ringSize, {
      preferVisiblePixels: !!state.backgroundMask,
    });
    const maxX = Math.max(1, expandedSelection.width - 1);
    const maxY = Math.max(1, expandedSelection.height - 1);

    for (let y = 0; y < expandedSelection.height; y += 1) {
      const v = y / maxY;
      const vertical = mixColors(edges.top, edges.bottom, v);

      for (let x = 0; x < expandedSelection.width; x += 1) {
        const u = x / maxX;
        const horizontal = mixColors(edges.left, edges.right, u);
        const color = mixColors(vertical, horizontal, 0.5);
        writePixel(imageData, expandedSelection.x + x, expandedSelection.y + y, color);
      }
    }
  }

  artifactBuffer.context.putImageData(imageData, 0, 0);
  rebuildWorkingFromMask();

  state.hasRemovalEdits = true;
  state.selection = null;
  syncUi();
  render();
  setStatus(
    useTransparentErase
      ? "Selection removed to transparency. Your background cutout stays intact."
      : "Selection removed. Switch to Background Remover any time and your edits will stay in place."
  );
};

const sampleColorAtPoint = (imageData, point, radius = 4) => {
  const colors = [];
  const startX = clamp(point.x - radius, 0, imageData.width - 1);
  const endX = clamp(point.x + radius, 0, imageData.width - 1);
  const startY = clamp(point.y - radius, 0, imageData.height - 1);
  const endY = clamp(point.y + radius, 0, imageData.height - 1);

  for (let y = startY; y <= endY; y += 1) {
    for (let x = startX; x <= endX; x += 1) {
      colors.push(readPixel(imageData, x, y));
    }
  }

  return averageColor(colors);
};

const buildAutoSamplePoints = (width, height) => {
  const inset = clamp(Math.round(Math.min(width, height) * 0.025), 2, 16);
  const midX = Math.floor(width / 2);
  const midY = Math.floor(height / 2);

  return [
    { x: inset, y: inset },
    { x: midX, y: inset },
    { x: width - 1 - inset, y: inset },
    { x: inset, y: midY },
    { x: width - 1 - inset, y: midY },
    { x: inset, y: height - 1 - inset },
    { x: midX, y: height - 1 - inset },
    { x: width - 1 - inset, y: height - 1 - inset },
  ];
};

const buildSampleModel = (sampleColors) => ({
  average: averageColor(sampleColors),
  luminance: averageColor(
    sampleColors.map((color) => ({
      r: getLuminance(color),
      g: getLuminance(color),
      b: getLuminance(color),
      a: 255,
    }))
  ).r,
  saturation:
    sampleColors.reduce((total, color) => total + getSaturation(color), 0) /
    Math.max(sampleColors.length, 1),
});

const colorDistanceSquared = (a, b) => {
  const red = a.r - b.r;
  const green = a.g - b.g;
  const blue = a.b - b.b;
  return red * red + green * green + blue * blue;
};

const buildMatchMaps = (imageData, sampleColors, coreThreshold, expansionThreshold) => {
  const coreThresholdSquared = coreThreshold * coreThreshold;
  const expansionThresholdSquared = expansionThreshold * expansionThreshold;
  const coreMatches = new Uint8Array(imageData.width * imageData.height);
  const candidateMatches = new Uint8Array(imageData.width * imageData.height);
  const distances = new Float32Array(imageData.width * imageData.height);

  for (let y = 0; y < imageData.height; y += 1) {
    for (let x = 0; x < imageData.width; x += 1) {
      const index = y * imageData.width + x;
      const pixel = readPixel(imageData, x, y);
      let bestDistance = Number.POSITIVE_INFINITY;

      for (let sampleIndex = 0; sampleIndex < sampleColors.length; sampleIndex += 1) {
        const distance = colorDistanceSquared(pixel, sampleColors[sampleIndex]);
        if (distance < bestDistance) {
          bestDistance = distance;
        }
      }

      distances[index] = bestDistance;
      coreMatches[index] = bestDistance <= coreThresholdSquared ? 1 : 0;
      candidateMatches[index] = bestDistance <= expansionThresholdSquared ? 1 : 0;
    }
  }

  return { coreMatches, candidateMatches, distances };
};

const computeLocalContrast = (imageData, x, y, pixel) => {
  const neighbors = [];

  if (x > 0) {
    neighbors.push(readPixel(imageData, x - 1, y));
  }
  if (x < imageData.width - 1) {
    neighbors.push(readPixel(imageData, x + 1, y));
  }
  if (y > 0) {
    neighbors.push(readPixel(imageData, x, y - 1));
  }
  if (y < imageData.height - 1) {
    neighbors.push(readPixel(imageData, x, y + 1));
  }

  if (neighbors.length === 0) {
    return 0;
  }

  const pixelLuminance = getLuminance(pixel);
  const averageNeighborLuminance =
    neighbors.reduce((total, neighbor) => total + getLuminance(neighbor), 0) / neighbors.length;

  return Math.abs(pixelLuminance - averageNeighborLuminance);
};

const refineMatchMap = (imageData, matches, sampleModel, threshold) => {
  const refined = new Uint8Array(matches);
  const protectLuminanceDelta = Math.max(18, threshold * 0.9);
  const protectSaturationDelta = Math.max(14, threshold * 0.55);
  const strongEdgeContrast = Math.max(16, threshold * 0.6);

  for (let y = 0; y < imageData.height; y += 1) {
    for (let x = 0; x < imageData.width; x += 1) {
      const index = y * imageData.width + x;
      if (!refined[index]) {
        continue;
      }

      const pixel = readPixel(imageData, x, y);
      const luminanceDelta = Math.abs(getLuminance(pixel) - sampleModel.luminance);
      const saturationDelta = Math.abs(getSaturation(pixel) - sampleModel.saturation);
      const localContrast = computeLocalContrast(imageData, x, y, pixel);

      const protectDarkOrLightDetail =
        luminanceDelta > protectLuminanceDelta && localContrast > strongEdgeContrast * 0.45;
      const protectColorDetail =
        saturationDelta > protectSaturationDelta && localContrast > strongEdgeContrast * 0.35;
      const protectStrongEdge = localContrast > strongEdgeContrast;

      if (protectDarkOrLightDetail || protectColorDetail || protectStrongEdge) {
        refined[index] = 0;
      }
    }
  }

  return refined;
};

const countNeighborMatches = (matches, width, height, x, y) => {
  let count = 0;

  for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
    for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
      if (offsetX === 0 && offsetY === 0) {
        continue;
      }

      const nextX = x + offsetX;
      const nextY = y + offsetY;

      if (nextX < 0 || nextY < 0 || nextX >= width || nextY >= height) {
        continue;
      }

      if (matches[nextY * width + nextX]) {
        count += 1;
      }
    }
  }

  return count;
};

const countBackgroundNeighbors = (backgroundMap, width, height, x, y) => {
  let count = 0;

  for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
    for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
      if (offsetX === 0 && offsetY === 0) {
        continue;
      }

      const nextX = x + offsetX;
      const nextY = y + offsetY;

      if (nextX < 0 || nextY < 0 || nextX >= width || nextY >= height) {
        continue;
      }

      if (backgroundMap[nextY * width + nextX]) {
        count += 1;
      }
    }
  }

  return count;
};

const floodConnectedBackground = (
  imageData,
  coreMatches,
  candidateMatches,
  sampleModel,
  threshold,
  seeds
) => {
  const { width, height } = imageData;
  const visited = new Uint8Array(width * height);
  const queue = new Uint32Array(width * height);
  let head = 0;
  let tail = 0;
  const expansionContrastLimit = Math.max(10, threshold * 0.45);
  const expansionLuminanceLimit = Math.max(14, threshold * 0.7);
  const expansionSaturationLimit = Math.max(10, threshold * 0.5);

  const enqueue = (x, y) => {
    if (x < 0 || y < 0 || x >= width || y >= height) {
      return;
    }

    const index = y * width + x;
    if (!candidateMatches[index] || visited[index]) {
      return;
    }

    if (!coreMatches[index]) {
      const pixel = readPixel(imageData, x, y);
      const localContrast = computeLocalContrast(imageData, x, y, pixel);
      const luminanceDelta = Math.abs(getLuminance(pixel) - sampleModel.luminance);
      const saturationDelta = Math.abs(getSaturation(pixel) - sampleModel.saturation);
      const neighborSupport = countNeighborMatches(candidateMatches, width, height, x, y);

      const isSoftExpansionPixel =
        localContrast <= expansionContrastLimit &&
        luminanceDelta <= expansionLuminanceLimit &&
        saturationDelta <= expansionSaturationLimit &&
        neighborSupport >= 4;

      if (!isSoftExpansionPixel) {
        return;
      }
    }

    visited[index] = 1;
    queue[tail] = index;
    tail += 1;
  };

  for (let x = 0; x < width; x += 1) {
    enqueue(x, 0);
    enqueue(x, height - 1);
  }

  for (let y = 1; y < height - 1; y += 1) {
    enqueue(0, y);
    enqueue(width - 1, y);
  }

  seeds.forEach((point) => enqueue(point.x, point.y));

  while (head < tail) {
    const index = queue[head];
    head += 1;

    const x = index % width;
    const y = Math.floor(index / width);

    enqueue(x + 1, y);
    enqueue(x - 1, y);
    enqueue(x, y + 1);
    enqueue(x, y - 1);
  }

  return visited;
};

const growBackgroundFringe = (
  imageData,
  backgroundMap,
  candidateMatches,
  sampleModel,
  threshold
) => {
  const width = imageData.width;
  const height = imageData.height;
  const grown = new Uint8Array(backgroundMap);
  const passes = clamp(Math.round((threshold - 10) / 4), 1, 4);
  const fringeContrastLimit = Math.max(24, threshold * 1.05);
  const fringeLuminanceLimit = Math.max(24, threshold * 1.1);
  const fringeSaturationLimit = Math.max(16, threshold * 0.85);

  for (let pass = 0; pass < passes; pass += 1) {
    const additions = [];

    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const index = y * width + x;
        if (grown[index] || !candidateMatches[index]) {
          continue;
        }

        const backgroundNeighbors = countBackgroundNeighbors(grown, width, height, x, y);
        if (backgroundNeighbors < 2) {
          continue;
        }

        const pixel = readPixel(imageData, x, y);
        const localContrast = computeLocalContrast(imageData, x, y, pixel);
        const luminanceDelta = Math.abs(getLuminance(pixel) - sampleModel.luminance);
        const saturationDelta = Math.abs(getSaturation(pixel) - sampleModel.saturation);

        const isFringeLike =
          localContrast <= fringeContrastLimit &&
          luminanceDelta <= fringeLuminanceLimit &&
          saturationDelta <= fringeSaturationLimit;

        const hasStrongBackgroundSupport = backgroundNeighbors >= 4;
        if (isFringeLike || hasStrongBackgroundSupport) {
          additions.push(index);
        }
      }
    }

    if (additions.length === 0) {
      break;
    }

    additions.forEach((index) => {
      grown[index] = 1;
    });
  }

  return grown;
};

const buildBorderColorModels = (imageData, backgroundMap, stripWidth = 3) => {
  const width = imageData.width;
  const height = imageData.height;

  const collectSidePixels = (side) => {
    const pixels = [];

    if (side === "left" || side === "right") {
      const startX = side === "left" ? 0 : Math.max(0, width - stripWidth);
      const endX = side === "left" ? Math.min(width, stripWidth) : width;

      for (let y = 0; y < height; y += 1) {
        for (let x = startX; x < endX; x += 1) {
          const index = y * width + x;
          if (backgroundMap[index] || x === 0 || x === width - 1) {
            pixels.push(readPixel(imageData, x, y));
          }
        }
      }
    } else {
      const startY = side === "top" ? 0 : Math.max(0, height - stripWidth);
      const endY = side === "top" ? Math.min(height, stripWidth) : height;

      for (let y = startY; y < endY; y += 1) {
        for (let x = 0; x < width; x += 1) {
          const index = y * width + x;
          if (backgroundMap[index] || y === 0 || y === height - 1) {
            pixels.push(readPixel(imageData, x, y));
          }
        }
      }
    }

    return pixels;
  };

  return {
    left: averageColor(collectSidePixels("left")),
    right: averageColor(collectSidePixels("right")),
    top: averageColor(collectSidePixels("top")),
    bottom: averageColor(collectSidePixels("bottom")),
  };
};

const qualifiesAsEdgeResidue = (imageData, x, y, sideColor, sampleModel, threshold) => {
  const pixel = readPixel(imageData, x, y);
  const localContrast = computeLocalContrast(imageData, x, y, pixel);
  const borderDistance = Math.sqrt(colorDistanceSquared(pixel, sideColor));
  const averageDistance = Math.sqrt(colorDistanceSquared(pixel, sampleModel.average));
  const luminanceDelta = Math.abs(getLuminance(pixel) - getLuminance(sideColor));
  const saturationDelta = Math.abs(getSaturation(pixel) - getSaturation(sideColor));

  const borderDistanceLimit = Math.max(28, threshold * 1.65);
  const averageDistanceLimit = Math.max(24, threshold * 1.45);
  const luminanceLimit = Math.max(26, threshold * 1.4);
  const saturationLimit = Math.max(18, threshold);
  const contrastLimit = Math.max(30, threshold * 1.25);

  return (
    (borderDistance <= borderDistanceLimit || averageDistance <= averageDistanceLimit) &&
    luminanceDelta <= luminanceLimit &&
    saturationDelta <= saturationLimit &&
    localContrast <= contrastLimit
  );
};

const cleanupBorderResidue = (imageData, backgroundMap, sampleModel, threshold) => {
  const width = imageData.width;
  const height = imageData.height;
  const cleaned = new Uint8Array(backgroundMap);
  const borderModels = buildBorderColorModels(imageData, cleaned);
  const maxDepth = clamp(Math.round(threshold / 1.8), 6, 18);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < maxDepth; x += 1) {
      const index = y * width + x;
      if (cleaned[index]) {
        continue;
      }
      if (!qualifiesAsEdgeResidue(imageData, x, y, borderModels.left, sampleModel, threshold)) {
        break;
      }
      cleaned[index] = 1;
    }

    for (let offset = 0; offset < maxDepth; offset += 1) {
      const x = width - 1 - offset;
      const index = y * width + x;
      if (cleaned[index]) {
        continue;
      }
      if (!qualifiesAsEdgeResidue(imageData, x, y, borderModels.right, sampleModel, threshold)) {
        break;
      }
      cleaned[index] = 1;
    }
  }

  for (let x = 0; x < width; x += 1) {
    for (let y = 0; y < maxDepth; y += 1) {
      const index = y * width + x;
      if (cleaned[index]) {
        continue;
      }
      if (!qualifiesAsEdgeResidue(imageData, x, y, borderModels.top, sampleModel, threshold)) {
        break;
      }
      cleaned[index] = 1;
    }

    for (let offset = 0; offset < maxDepth; offset += 1) {
      const y = height - 1 - offset;
      const index = y * width + x;
      if (cleaned[index]) {
        continue;
      }
      if (!qualifiesAsEdgeResidue(imageData, x, y, borderModels.bottom, sampleModel, threshold)) {
        break;
      }
      cleaned[index] = 1;
    }
  }

  return cleaned;
};

const hasForegroundNeighbor = (backgroundMap, width, height, x, y) => {
  for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
    for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
      if (offsetX === 0 && offsetY === 0) {
        continue;
      }

      const nextX = x + offsetX;
      const nextY = y + offsetY;

      if (nextX < 0 || nextY < 0 || nextX >= width || nextY >= height) {
        continue;
      }

      if (!backgroundMap[nextY * width + nextX]) {
        return true;
      }
    }
  }

  return false;
};

const createKeepMask = (backgroundMap, _distances, _threshold, featherAmount) => {
  const width = artifactBuffer.canvas.width;
  const height = artifactBuffer.canvas.height;
  const keepMask = new Uint8ClampedArray(width * height);

  if (featherAmount <= 0) {
    for (let index = 0; index < keepMask.length; index += 1) {
      keepMask[index] = backgroundMap[index] ? 0 : 255;
    }
    return keepMask;
  }

  const maxFeatherDistance = Math.max(1, Math.round(featherAmount));
  const distanceToForeground = new Int16Array(width * height).fill(-1);
  const queue = new Uint32Array(width * height);
  let head = 0;
  let tail = 0;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      if (!backgroundMap[index]) {
        keepMask[index] = 255;
        continue;
      }

      if (hasForegroundNeighbor(backgroundMap, width, height, x, y)) {
        distanceToForeground[index] = 1;
        queue[tail] = index;
        tail += 1;
      }
    }
  }

  while (head < tail) {
    const index = queue[head];
    head += 1;
    const currentDistance = distanceToForeground[index];

    if (currentDistance >= maxFeatherDistance) {
      continue;
    }

    const x = index % width;
    const y = Math.floor(index / width);

    for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
      for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
        if (offsetX === 0 && offsetY === 0) {
          continue;
        }

        const nextX = x + offsetX;
        const nextY = y + offsetY;

        if (nextX < 0 || nextY < 0 || nextX >= width || nextY >= height) {
          continue;
        }

        const nextIndex = nextY * width + nextX;
        if (!backgroundMap[nextIndex] || distanceToForeground[nextIndex] !== -1) {
          continue;
        }

        distanceToForeground[nextIndex] = currentDistance + 1;
        queue[tail] = nextIndex;
        tail += 1;
      }
    }
  }

  for (let index = 0; index < keepMask.length; index += 1) {
    if (!backgroundMap[index]) {
      keepMask[index] = 255;
      continue;
    }

    const distance = distanceToForeground[index];
    if (distance === -1) {
      keepMask[index] = 0;
      continue;
    }

    const normalizedDistance = clamp((maxFeatherDistance - distance + 1) / (maxFeatherDistance + 1), 0, 1);
    keepMask[index] = Math.round(normalizedDistance * 72);
  }

  return keepMask;
};

const applyBackgroundRemoval = () => {
  if (!state.imageLoaded) {
    return;
  }

  const imageData = artifactBuffer.context.getImageData(
    0,
    0,
    artifactBuffer.canvas.width,
    artifactBuffer.canvas.height
  );
  const autoSamplePoints = buildAutoSamplePoints(imageData.width, imageData.height);
  const sampleColors = autoSamplePoints
    .concat(state.manualSamples)
    .map((point) => sampleColorAtPoint(imageData, point, 4));
  const threshold = Number(thresholdRange.value);
  const coreThreshold = Math.min(threshold, 12);
  const sampleModel = buildSampleModel(sampleColors);
  const { coreMatches, candidateMatches, distances } = buildMatchMaps(
    imageData,
    sampleColors,
    coreThreshold,
    threshold
  );
  const refinedCoreMatches = refineMatchMap(imageData, coreMatches, sampleModel, coreThreshold);
  const refinedCandidateMatches = refineMatchMap(
    imageData,
    candidateMatches,
    sampleModel,
    threshold
  );
  const backgroundMap = floodConnectedBackground(
    imageData,
    refinedCoreMatches,
    refinedCandidateMatches,
    sampleModel,
    threshold,
    state.manualSamples
  );
  const cleanedBackgroundMap = growBackgroundFringe(
    imageData,
    backgroundMap,
    refinedCandidateMatches,
    sampleModel,
    threshold
  );
  const borderCleanedBackgroundMap = cleanupBorderResidue(
    imageData,
    cleanedBackgroundMap,
    sampleModel,
    threshold
  );

  let removedPixels = 0;
  for (let index = 0; index < borderCleanedBackgroundMap.length; index += 1) {
    if (borderCleanedBackgroundMap[index]) {
      removedPixels += 1;
    }
  }

  if (removedPixels === 0) {
    setStatus("No background area was detected. Raise the threshold or add a few manual sample points.");
    return;
  }

  captureUndoSnapshot();
  state.backgroundMask = createKeepMask(
    borderCleanedBackgroundMap,
    distances,
    threshold,
    Number(featherRange.value)
  );
  rebuildWorkingFromMask();
  state.hasRemovalEdits = true;
  syncUi();
  render();

  const removedPercent = Math.round((removedPixels / borderCleanedBackgroundMap.length) * 100);
  setStatus(
    `Background removed. ${removedPercent}% of the image was cut to transparency. Use Restore Details if the edge needs cleanup.`
  );
};

const applyRestoreBrush = (point) => {
  const radius = Number(brushSizeRange.value) / 2;

  workingBuffer.context.save();
  workingBuffer.context.beginPath();
  workingBuffer.context.arc(point.x, point.y, radius, 0, Math.PI * 2);
  workingBuffer.context.clip();
  workingBuffer.context.drawImage(originalBuffer.canvas, 0, 0);
  workingBuffer.context.restore();

  state.hasRemovalEdits = true;
  render();
};

const resetImage = () => {
  if (!state.imageLoaded) {
    return;
  }

  const width = originalBuffer.canvas.width;
  const height = originalBuffer.canvas.height;
  const originalImageData = originalBuffer.context.getImageData(0, 0, width, height);

  artifactBuffer.context.putImageData(originalImageData, 0, 0);
  workingBuffer.context.putImageData(originalImageData, 0, 0);

  state.selection = null;
  state.dragStart = null;
  state.isSelecting = false;
  state.isRestoring = false;
  state.lastPointer = null;
  state.manualSamples = [];
  state.backgroundMask = null;
  state.undoSnapshot = null;
  state.hasRemovalEdits = false;

  syncUi();
  render();
  setStatus("Image reset to the original upload.");
};

const undoLastAction = () => {
  if (!state.undoSnapshot || !hasImageDimensions()) {
    return;
  }

  artifactBuffer.context.putImageData(state.undoSnapshot.artifactImageData, 0, 0);
  workingBuffer.context.putImageData(state.undoSnapshot.workingImageData, 0, 0);
  state.backgroundMask = state.undoSnapshot.backgroundMask
    ? new Uint8ClampedArray(state.undoSnapshot.backgroundMask)
    : null;
  state.manualSamples = state.undoSnapshot.manualSamples.map((point) => ({ ...point }));
  state.hasRemovalEdits = state.undoSnapshot.hasRemovalEdits;
  state.undoSnapshot = null;
  state.selection = null;
  state.dragStart = null;
  state.isSelecting = false;
  state.isRestoring = false;
  state.lastPointer = null;

  syncUi();
  render();
  setStatus("Last edit undone.");
};

const downloadImage = () => {
  if (!state.hasRemovalEdits) {
    const shouldContinue = window.confirm(
      "You haven't removed any artifacts or backgrounds yet. Do you want to continue downloading anyway?"
    );

    if (!shouldContinue) {
      setStatus("Download canceled. Make an edit first, or continue later if you only needed the original image.");
      return;
    }
  }

  const link = document.createElement("a");
  link.href = workingBuffer.canvas.toDataURL("image/png");
  link.download = `${sanitizeFilename(filenameInput.value)}.png`;
  link.click();
};

const loadImage = (file) => {
  const reader = new FileReader();

  reader.onload = () => {
    const image = new Image();

    image.onload = () => {
      [originalBuffer, artifactBuffer, workingBuffer].forEach((buffer) => {
        buffer.canvas.width = image.width;
        buffer.canvas.height = image.height;
        buffer.context.clearRect(0, 0, image.width, image.height);
        buffer.context.drawImage(image, 0, 0);
      });

      editorCanvas.width = image.width;
      editorCanvas.height = image.height;

      state.imageLoaded = true;
      state.activeMode = "artifact";
      state.backgroundTool = "sample";
      state.selection = null;
      state.dragStart = null;
      state.isSelecting = false;
      state.isRestoring = false;
      state.lastPointer = null;
      state.manualSamples = [];
      state.backgroundMask = null;
      state.undoSnapshot = null;
      state.hasRemovalEdits = false;

      filenameInput.value = sanitizeFilename(file.name.replace(/\.[^.]+$/, ""));
      syncUi();
      render();
      setStatus("Image loaded. Drag a box around the object you want to remove, or switch tabs for background removal.");
    };

    image.src = reader.result;
  };

  reader.readAsDataURL(file);
};

const beginArtifactSelection = (point) => {
  state.dragStart = point;
  state.selection = { x: point.x, y: point.y, width: 0, height: 0 };
  state.isSelecting = true;
  syncUi();
  render();
};

const updateArtifactSelection = (point) => {
  if (!state.isSelecting || !state.dragStart) {
    return;
  }

  state.selection = normalizeRect({
    x1: state.dragStart.x,
    y1: state.dragStart.y,
    x2: point.x,
    y2: point.y,
  });
  syncUi();
  render();
};

const endArtifactSelection = () => {
  if (!state.isSelecting) {
    return;
  }

  state.isSelecting = false;
  state.dragStart = null;

  if (!state.selection || state.selection.width < 2 || state.selection.height < 2) {
    state.selection = null;
    setStatus("Selection cleared. Drag a slightly larger box to remove an object.");
  } else {
    setStatus("Selection ready. Click Remove selection when you like the box.");
  }

  syncUi();
  render();
};

const addManualSample = (point) => {
  state.manualSamples.push(point);
  syncUi();
  render();
  setStatus(
    `${state.manualSamples.length} background sample${
      state.manualSamples.length === 1 ? "" : "s"
    } added. Click Remove Background when you are ready to rerun the cutout.`
  );
};

const handlePointerDown = (event) => {
  if (!state.imageLoaded) {
    return;
  }

  const point = getCanvasPoint(event);
  state.lastPointer = point;

  if (editorCanvas.setPointerCapture) {
    editorCanvas.setPointerCapture(event.pointerId);
  }

  if (state.activeMode === "artifact") {
    beginArtifactSelection(point);
    return;
  }

  if (state.backgroundTool === "sample") {
    addManualSample(point);
    return;
  }

  captureUndoSnapshot();
  state.isRestoring = true;
  applyRestoreBrush(point);
  syncUi();
  setStatus("Restoring original pixels. Keep dragging to paint details back in.");
};

const handlePointerMove = (event) => {
  if (!state.imageLoaded) {
    return;
  }

  const point = getCanvasPoint(event);
  state.lastPointer = point;

  if (state.activeMode === "artifact") {
    updateArtifactSelection(point);
    return;
  }

  if (state.backgroundTool === "restore" && state.isRestoring) {
    applyRestoreBrush(point);
    return;
  }

  render();
};

const handlePointerUp = (event) => {
  if (editorCanvas.releasePointerCapture) {
    try {
      editorCanvas.releasePointerCapture(event.pointerId);
    } catch (error) {
      // Ignore release errors if capture was never taken.
    }
  }

  if (state.activeMode === "artifact") {
    endArtifactSelection();
    return;
  }

  if (state.backgroundTool === "restore" && state.isRestoring) {
    state.isRestoring = false;
    syncUi();
    render();
    setStatus("Restore stroke applied. Undo is available if you want to revert it.");
  }
};

const handlePointerLeave = () => {
  state.lastPointer = null;

  if (state.activeMode === "artifact") {
    endArtifactSelection();
  } else if (state.backgroundTool === "restore" && state.isRestoring) {
    state.isRestoring = false;
    syncUi();
  }

  render();
};

modeTabs.forEach((tab) => {
  tab.addEventListener("click", () => setMode(tab.dataset.mode));
});

fileInput.addEventListener("change", (event) => {
  const [file] = event.target.files;
  if (file) {
    loadImage(file);
  }
});

sampleRadius.addEventListener("input", updateRangeLabels);
selectionExpand.addEventListener("input", updateRangeLabels);
thresholdRange.addEventListener("input", updateRangeLabels);
featherRange.addEventListener("input", updateRangeLabels);
brushSizeRange.addEventListener("input", () => {
  updateRangeLabels();
  render();
});

removeButton.addEventListener("click", applyArtifactFill);
removeBackgroundButton.addEventListener("click", applyBackgroundRemoval);
sampleToolButton.addEventListener("click", () => setBackgroundTool("sample"));
restoreToolButton.addEventListener("click", () => setBackgroundTool("restore"));
clearSamplesButton.addEventListener("click", () => {
  state.manualSamples = [];
  syncUi();
  render();
  setStatus("Manual background sample points cleared.");
});
undoButton.addEventListener("click", undoLastAction);
resetButton.addEventListener("click", resetImage);
downloadButton.addEventListener("click", downloadImage);

editorCanvas.addEventListener("pointerdown", handlePointerDown);
editorCanvas.addEventListener("pointermove", handlePointerMove);
editorCanvas.addEventListener("pointerup", handlePointerUp);
editorCanvas.addEventListener("pointerleave", handlePointerLeave);

syncUi();
render();
