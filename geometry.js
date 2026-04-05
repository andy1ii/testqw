// --- 3D GEOMETRY MODE: Uniform voxel grid — logo mask, stepped Z depth; flat fill + ink outlines ---
let shaderBgColor = '#F4F2EB';
let maxDepth = 8;
let gapScale = 0.92;

let shaderBaseColor = '#FFFFFF';
let shaderAccentColor = '#DCDFE3';
/** Outline on voxel edges (also driven by harmony / Accent 2 picker). */
let shaderAccentColor2 = '#5C5A55';

// INCREASED ZOOM AND BRICK SCALE FOR BETTER PERFORMANCE & BIGGER CUBES
let shaderZoom = 16.0;
let shaderTimeMult = 0.2;
let shaderBrickScale = 3.5; 
let shaderBrickGap = 0.95;
/** Scales Z stack range (≈ baseline → `maxDepth`); 1 = full, lower = flatter terrain. */
let shaderExtrusion = 1.0;

let shaderCanvas;
let shaderBlocks = [];

const LOGO_MIN_CUBES = 2;
/** More stairs → sharper stepped extrusion bands. */
const DEPTH_STAIRS = 14;
/** Above this percentile of tier counts, squash spikes (homepage logo only). */
const EXTRUSION_OUTLIER_PERCENTILE = 0.92;

let _qtHrX;
let _qtHrY;
let _qtHrW;
let _qtHrH;
let _qtImgW;
let _qtImgH;
let _qtRefStep;
/** Set during rebuild: sample ink from uploaded photo for extrusion depths (mask still drives voxels). */
let _shaderUseUploadSource = false;

// CACHING AND ASYNC FLAGS FOR SMOOTH TRANSITIONS
let _shaderBuildPending = false;
let _lastShaderWidth = 0;
let _lastShaderHeight = 0;
let _lastShaderUpload = null;
let _lastShaderWholePage = null;

/** Effective max stacked cubes after extrusion slider (`maxDepth` × multiplier, clamped). */
function shaderExtrudeCapCubes() {
  const ext = typeof shaderExtrusion === 'number' ? constrain(shaderExtrusion, 0.12, 1.85) : 1;
  return constrain(round(LOGO_MIN_CUBES + (maxDepth - LOGO_MIN_CUBES) * ext), LOGO_MIN_CUBES, 32);
}

/** sRGB #RRGGBB → 0–255 channels (string math only; no `color()` / global colorMode). */
function shaderParseHexRgb(hex) {
  const h = String(hex || '#000000').replace('#', '').trim();
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h.padEnd(6, '0').slice(0, 6);
  return {
    r: parseInt(full.slice(0, 2), 16) || 0,
    g: parseInt(full.slice(2, 4), 16) || 0,
    b: parseInt(full.slice(4, 6), 16) || 0
  };
}

function sampleInkAtCell(px, py, hrX, hrY, hrW, hrH, imgW, imgH) {
  const src = _shaderUseUploadSource ? uploadedSourceImg : logoImg;
  if ((!_shaderUseUploadSource && isWholePageMode) || !src || !src.pixels || src.pixels.length < imgW * imgH * 4) {
    return 0.45;
  }
  let u = (px - hrX) / max(hrW, 1);
  let v = (py - hrY) / max(hrH, 1);
  u = u < 0 ? 0 : (u > 1 ? 1 : u);
  v = v < 0 ? 0 : (v > 1 ? 1 : v);
  
  const ix = (u * (imgW - 1)) | 0;
  const iy = (v * (imgH - 1)) | 0;
  const o = (ix + iy * imgW) << 2;
  const lum = (0.2126 * src.pixels[o] + 0.7152 * src.pixels[o + 1] + 0.0722 * src.pixels[o + 2]) / 255;
  const al = src.pixels[o + 3] / 255;
  const val = (1 - lum) * 0.78 + al * 0.22;
  return val < 0 ? 0 : (val > 1 ? 1 : val);
}

// OPTIMIZED: Bitwise operators and inline lookups to prevent millions of GC collections
function maskPixelIsLogo(maskPx, mw, mh, ix, iy) {
  const xi = ix < 0 ? 0 : (ix >= mw ? mw - 1 : ix | 0);
  const yi = iy < 0 ? 0 : (iy >= mh ? mh - 1 : iy | 0);
  const o = (xi + yi * mw) << 2; 
  const a = maskPx[o + 3];
  if (a >= 100) return true;
  return a > 20 && (maskPx[o] + maskPx[o + 1] + maskPx[o + 2]) > 600;
}

// OPTIMIZED: Double-stepping and removed array creation per iteration
function distToTransparentEdge(px, py, maskPixels, mw, mh, maxR) {
  const px_i = px | 0;
  const py_i = py | 0;
  if (!maskPixelIsLogo(maskPixels, mw, mh, px_i, py_i)) return 0;

  for (let r = 2; r <= maxR; r += 2) { 
    const qh = px_i - r;
    const qj = px_i + r;
    const qk = py_i - r;
    const qm = py_i + r;

    if (qh >= 0 && !maskPixelIsLogo(maskPixels, mw, mh, qh, py_i)) return r;
    if (qj < mw && !maskPixelIsLogo(maskPixels, mw, mh, qj, py_i)) return r;
    if (qk >= 0 && !maskPixelIsLogo(maskPixels, mw, mh, px_i, qk)) return r;
    if (qm < mh && !maskPixelIsLogo(maskPixels, mw, mh, px_i, qm)) return r;

    if (!maskPixelIsLogo(maskPixels, mw, mh, qh, qk)) return r;
    if (!maskPixelIsLogo(maskPixels, mw, mh, qj, qk)) return r;
    if (!maskPixelIsLogo(maskPixels, mw, mh, qh, qm)) return r;
    if (!maskPixelIsLogo(maskPixels, mw, mh, qj, qm)) return r;
  }
  return maxR;
}

function numCubesForMaskCell(px, py, refStep, ink01, maskPixels, mw, mh) {
  const cap = shaderExtrudeCapCubes();
  const normSpan = max(refStep * 22, LOGO_MIN_CUBES * 4);
  const maxR = Math.min(floor(min(mw, mh) * 0.5), Math.ceil(normSpan));
  const edgeDist = distToTransparentEdge(px, py, maskPixels, mw, mh, maxR);
  const dN = constrain(edgeDist / normSpan, 0, 1);
  const stepped = constrain(floor(dN * DEPTH_STAIRS) / max(1, DEPTH_STAIRS - 1), 0, 1);
  let n = round(cap - stepped * (cap - LOGO_MIN_CUBES));
  n -= floor(pow(ink01, 0.9) * 3);
  n = LOGO_MIN_CUBES + round((n - LOGO_MIN_CUBES) * 0.72);
  return constrain(n, LOGO_MIN_CUBES, cap);
}

function flattenShaderExtrusionOutliers(blocks) {
  const nb = blocks.length;
  if (nb < 2) return;

  const cap = shaderExtrudeCapCubes();
  const orig = [];
  for (let i = 0; i < nb; i++) {
    orig.push(constrain(floor(blocks[i].numCubes), LOGO_MIN_CUBES, cap));
  }

  const sorted = [...orig].sort((a, b) => a - b);
  const qi = constrain(floor(EXTRUSION_OUTLIER_PERCENTILE * (sorted.length - 1)), 0, sorted.length - 1);
  const globalCap = min(cap, sorted[qi] + 1);

  const grid = new Map();
  for (let i = 0; i < nb; i++) {
    const k = blocks[i].gx + ',' + blocks[i].gy;
    const v = orig[i];
    if (!grid.has(k) || grid.get(k) < v) grid.set(k, v);
  }

  for (let i = 0; i < nb; i++) {
    const gx = blocks[i].gx;
    const gy = blocks[i].gy;
    let neighMax = LOGO_MIN_CUBES;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const t = grid.get(gx + dx + ',' + (gy + dy));
        if (t !== undefined) neighMax = max(neighMax, t);
      }
    }
    const localCap = min(globalCap, neighMax + 1);
    blocks[i].numCubes = constrain(min(orig[i], localCap), LOGO_MIN_CUBES, cap);
  }
}

function cellIntersectsLogo(maskPx, mw, mh, x0, y0, x1, y1) {
  const w = x1 - x0;
  const h = y1 - y0;
  const nx = min(12, max(2, 2 + floor(w / 10)));
  const ny = min(12, max(2, 2 + floor(h / 10)));
  const stepX = w / nx;
  const stepY = h / ny;
  for (let j = 0; j < ny; j++) {
    const fy = y0 + (j + 0.5) * stepY;
    for (let i = 0; i < nx; i++) {
      const fx = x0 + (i + 0.5) * stepX;
      if (maskPixelIsLogo(maskPx, mw, mh, fx, fy)) return true;
    }
  }
  return false;
}

// OPTIMIZED: 16x speedup by stepping pixels by 4
function maskBoundingBox(maskPx, mw, mh) {
  let minX = mw, minY = mh, maxX = -1, maxY = -1;
  for (let y = 0; y < mh; y += 4) {
    const row = y * mw * 4;
    for (let x = 0; x < mw; x += 4) {
      const o = row + (x << 2);
      const a = maskPx[o + 3];
      if (a >= 100 || (a > 20 && (maskPx[o] + maskPx[o + 1] + maskPx[o + 2]) > 600)) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return null;
  return { minX, minY, maxX: maxX + 4, maxY: maxY + 4 };
}

function expandSquareBounds(bb, pad, mw, mh) {
  const bw = bb.maxX - bb.minX;
  const bh = bb.maxY - bb.minY;
  const side = max(bw, bh) + pad * 2;
  const cx = (bb.minX + bb.maxX) * 0.5;
  const cy = (bb.minY + bb.maxY) * 0.5;
  let x0 = floor(cx - side * 0.5);
  let y0 = floor(cy - side * 0.5);
  x0 = constrain(x0, 0, mw - 2);
  y0 = constrain(y0, 0, mh - 2);
  let x1 = floor(x0 + side);
  let y1 = floor(y0 + side);
  x1 = min(mw, max(x1, x0 + 8));
  y1 = min(mh, max(y1, y0 + 8));
  return { x0, y0, x1, y1 };
}

function emitUniformVoxelGridBlocks(maskPx, mw, mh, region, cellPx, outBlocks, fillAllCells) {
  const g = max(6, floor(cellPx));
  const xStart = floor(region.x0 / g) * g;
  const yStart = floor(region.y0 / g) * g;
  const tileAll = fillAllCells === true;
  for (let y0 = yStart; y0 < region.y1; y0 += g) {
    for (let x0 = xStart; x0 < region.x1; x0 += g) {
      const x1 = min(mw, x0 + g);
      const y1 = min(mh, y0 + g);
      if (x1 <= x0 || y1 <= y0) continue;

      const touchesLogo = cellIntersectsLogo(maskPx, mw, mh, x0, y0, x1, y1);
      if (!touchesLogo && !tileAll) continue;

      const cwCell = x1 - x0;
      const chCell = y1 - y0;
      const pxGeo = x0 + cwCell * 0.5;
      const pyGeo = y0 + chCell * 0.5;

      let numCubes;
      if (!touchesLogo && tileAll) {
        numCubes = LOGO_MIN_CUBES;
      } else {
        let anchorPx = pxGeo;
        let anchorPy = pyGeo;
        let cxi = floor(constrain(anchorPx, x0, x1 - 1));
        let cyi = floor(constrain(anchorPy, y0, y1 - 1));

        if (!maskPixelIsLogo(maskPx, mw, mh, cxi, cyi)) {
          let found = false;
          const nx = 8;
          const ny = 8;
          outer: for (let j = 0; j < ny; j++) {
            const fy = y0 + floor((j / max(1, ny - 1)) * max(0, chCell - 1));
            for (let ii = 0; ii < nx; ii++) {
              const fx = x0 + floor((ii / max(1, nx - 1)) * max(0, cwCell - 1));
              if (maskPixelIsLogo(maskPx, mw, mh, fx, fy)) {
                anchorPx = fx + 0.5;
                anchorPy = fy + 0.5;
                found = true;
                break outer;
              }
            }
          }
          if (!found) {
            if (tileAll) numCubes = LOGO_MIN_CUBES;
            else continue;
          }
        }

        if (numCubes === undefined) {
          cxi = floor(constrain(anchorPx, x0, x1 - 1));
          cyi = floor(constrain(anchorPy, y0, y1 - 1));
          const ink =
            isWholePageMode && !_shaderUseUploadSource
              ? noise(floor(cxi / max(8, _qtRefStep)) * 0.17, floor(cyi / max(8, _qtRefStep)) * 0.19) * 0.55 +
                0.28
              : sampleInkAtCell(anchorPx, anchorPy, _qtHrX, _qtHrY, _qtHrW, _qtHrH, _qtImgW, _qtImgH);
          numCubes = numCubesForMaskCell(anchorPx, anchorPy, _qtRefStep, ink, maskPx, mw, mh);
        }
      }

      if (
        tileAll &&
        typeof window.uploadSparsitySkipCell === 'function' &&
        window.uploadSparsitySkipCell(floor(x0 / g), floor(y0 / g), 11)
      ) {
        continue;
      }

      outBlocks.push({
        cx: pxGeo - mw * 0.5,
        cy: pyGeo - mh * 0.5,
        cell: g,
        numCubes,
        gx: floor(x0 / g),
        gy: floor(y0 / g)
      });
    }
  }
}

function rebuildShaderGeometry() {
  if (!logoImg || logoImg.width < 1) return;
  if (typeof width !== 'number' || width < 32) return;

  const useUploadMask = typeof usingCustomSourceImage !== 'undefined' && usingCustomSourceImage && typeof uploadedSourceImg !== 'undefined' && uploadedSourceImg && uploadedSourceImg.width > 0;
  _shaderUseUploadSource = useUploadMask;

  // FAST CACHE: If screen size or image hasn't changed, skip heavy generation instantly
  if (_lastShaderWidth === width && 
      _lastShaderHeight === height && 
      _lastShaderUpload === uploadedSourceImg && 
      _lastShaderWholePage === isWholePageMode && 
      shaderBlocks.length > 0) {
      return; 
  }

  _lastShaderWidth = width;
  _lastShaderHeight = height;
  _lastShaderUpload = uploadedSourceImg;
  _lastShaderWholePage = isWholePageMode;
  shaderBlocks = [];

  if (!isWholePageMode || useUploadMask) {
    logoImg.loadPixels();
    if (useUploadMask) uploadedSourceImg.loadPixels();
  }

  const area = width * height;
  const basePerf = area > 2200000 ? 20 : area > 1300000 ? 16 : 12;
  const scale = typeof shaderBrickScale === 'number' ? constrain(shaderBrickScale, 0.45, 10.35) : 3.5;
  let step = max(5, floor(basePerf * scale));
  if (isWholePageMode) step = max(floor(20 * scale), step + 2);

  if (useUploadMask && typeof getUploadIllustrationSimplify === 'function') {
    const tu = getUploadIllustrationSimplify();
    step = max(5, min(200, floor(step * (1 + tu * 1.5))));
  }

  let imgW = max(logoImg.width, 1);
  let imgH = max(logoImg.height, 1);
  let hrW, hrH, hrX, hrY;
  if (
    useUploadMask &&
    typeof getUploadDrawRect === 'function' &&
    typeof uploadedSourceImg !== 'undefined' &&
    uploadedSourceImg &&
    uploadedSourceImg.width > 0
  ) {
    const r = getUploadDrawRect(uploadedSourceImg);
    hrX = r.x;
    hrY = r.y;
    hrW = r.w;
    hrH = r.h;
  } else {
    let baseScale = min(width / imgW, height / imgH) * 0.55;
    let minScale = 280 / imgW;
    let scaleFactor = max(baseScale, minScale);
    hrW = floor(imgW * scaleFactor);
    hrH = floor(imgH * scaleFactor);
    hrX = floor((width - hrW) / 2);
    hrY = floor((height - hrH) / 2);
  }

  const mask = createGraphics(width, height);
  mask.pixelDensity(1);
  mask.clear();
  
  // FIX: Force generative mode to fill the entire screen background 
  if (!isWholePageMode || useUploadMask) {
    mask.image(logoImg, hrX, hrY, hrW, hrH);
  } else {
    mask.background(255); 
  }
  
  mask.loadPixels();
  const maskPx = mask.pixels;
  const mw = width;
  const mh = height;

  const brickGap = typeof shaderBrickGap === 'number' ? constrain(shaderBrickGap, 0.78, 0.995) : 0.97;
  const refStep = step * brickGap;

  _qtHrX = hrX;
  _qtHrY = hrY;
  _qtHrW = hrW;
  _qtHrH = hrH;
  _qtImgW = imgW;
  _qtImgH = imgH;
  _qtRefStep = refStep;

  const bb = maskBoundingBox(maskPx, mw, mh);
  if (!bb) {
    mask.remove();
    return;
  }

  const pad = max(floor(refStep * 1.2), 8);
  const root = expandSquareBounds(bb, pad, mw, mh);
  const gridCell = max(6, floor(refStep));

  /* Custom uploads or whole page: tile the full canvas with voxels */
  if (useUploadMask || isWholePageMode) {
    emitUniformVoxelGridBlocks(
      maskPx,
      mw,
      mh,
      { x0: 0, y0: 0, x1: mw, y1: mh },
      gridCell,
      shaderBlocks,
      true
    );
  } else {
    emitUniformVoxelGridBlocks(maskPx, mw, mh, root, gridCell, shaderBlocks, false);

    if (shaderBlocks.length === 0) {
      emitUniformVoxelGridBlocks(
        maskPx,
        mw,
        mh,
        {
          x0: bb.minX,
          y0: bb.minY,
          x1: bb.maxX,
          y1: bb.maxY
        },
        gridCell,
        shaderBlocks,
        false
      );
    }
  }

  if (!useUploadMask && !isWholePageMode && shaderBlocks.length > 0) {
    flattenShaderExtrusionOutliers(shaderBlocks);
  }

  mask.remove();
}

function setupShader() {
  if (!shaderCanvas) {
    shaderCanvas = createGraphics(width, height, WEBGL);
  }
  _shaderBuildPending = true; // Queues heavy math to run AFTER UI updates to prevent lag
}

function windowResizedShader() {
  if (shaderCanvas) shaderCanvas.resizeCanvas(width, height);
  _shaderBuildPending = true;
}

function shaderBrickFaceRgb(b, z) {
  const palette = [
    shaderParseHexRgb(typeof shaderBaseColor !== 'undefined' ? shaderBaseColor : '#FFFFFF'),
    shaderParseHexRgb(typeof shaderAccentColor !== 'undefined' ? shaderAccentColor : '#DCDFE3'),
    shaderParseHexRgb(typeof shaderAccentColor2 !== 'undefined' ? shaderAccentColor2 : '#5C5A55')
  ];
  const gx = typeof b.gx === 'number' ? b.gx | 0 : 0;
  const gy = typeof b.gy === 'number' ? b.gy | 0 : 0;
  const zi = z | 0;
  let h = Math.imul(gx, 374761393) + Math.imul(gy, 668265263) + Math.imul(zi, 1274126177);
  h = (h ^ (h >>> 13)) | 0;
  h = Math.imul(h, 1274126177);
  const idx = ((h ^ (h >>> 16)) >>> 0) % 3;
  const c = palette[idx];
  return [c.r, c.g, c.b];
}

function drawShader() {
  // If we just entered this mode or resized, generate geometry NOW so UI doesn't stutter on click
  if (_shaderBuildPending) {
    rebuildShaderGeometry();
    _shaderBuildPending = false;
  }

  background(shaderBgColor);
  shaderCanvas.clear();

  const bgRgb = shaderParseHexRgb(shaderBgColor);
  const strokeRgb = shaderParseHexRgb(typeof shaderAccentColor2 !== 'undefined' ? shaderAccentColor2 : '#5C5A55');
  shaderCanvas.background(bgRgb.r, bgRgb.g, bgRgb.b, 255);

  const cw = max(shaderCanvas.width, 1);
  const ch = max(shaderCanvas.height, 1);
  const zf = typeof shaderZoom === 'number' ? map(shaderZoom, 2.0, 20.0, 0.78, 1.12) : 1;

  const fov = PI / 3.0;
  const cameraZ = (ch / 2.0) / tan(fov / 2.0);

  shaderCanvas.perspective(fov, cw / ch, cameraZ * 0.01, cameraZ * 10);
  shaderCanvas.camera(0, 0, cameraZ * zf, 0, 0, 0, 0, 1, 0);

  shaderCanvas.push();
  shaderCanvas.rotateX(0);
  shaderCanvas.rotateY(0);

  /* Flat technical look: no lights — depth reads from perspective + crisp edges only. */
  for (let i = 0; i < shaderBlocks.length; i++) {
    const b = shaderBlocks[i];
    const cell = b.cell;
    const s = cell * gapScale;
    const n = constrain(floor(b.numCubes), LOGO_MIN_CUBES, shaderExtrudeCapCubes());

    shaderCanvas.push();
    shaderCanvas.translate(b.cx, b.cy - cell * 0.5, 0);

    for (let z = 0; z < n; z++) {
      shaderCanvas.push();
      shaderCanvas.translate(0, 0, z * cell + cell * 0.5);

      /* Logo or upload: same flat paper + outline (upload only changes mask / extrusion via ink sampling). */
      shaderCanvas.fill(bgRgb.r, bgRgb.g, bgRgb.b);
      shaderCanvas.stroke(strokeRgb.r, strokeRgb.g, strokeRgb.b);
      shaderCanvas.strokeWeight(1.5); // Slightly thicker outline for huge blocks

      shaderCanvas.box(s, s, s);
      shaderCanvas.pop();
    }

    shaderCanvas.pop();
  }

  shaderCanvas.pop();

  imageMode(CORNER);
  image(shaderCanvas, 0, 0);
}