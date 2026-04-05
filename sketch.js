// Global State required by the incorporated files
let currentMode = 'cube'; // Default: Raster
let logoImg = null;       
let isWholePageMode = true; // IMPORTANT: Set true to fill screen immediately

// --- UPLOAD STATE VARIABLES ---
let usingCustomSourceImage = false;
let uploadedSourceImg = null;
let uploadIllustrationSimplify = 0;
let uploadIllustrationSparsity = 0;

// --- PRELOAD FONT ---
let cursorFont;
function preload() {
  cursorFont = loadFont('resources/CursorMono260219-Regular.otf');
}
// --------------------------------------

function setup() {
  // 1. Create Canvas that fills the entire browser window
  createCanvas(windowWidth, windowHeight);
  pixelDensity(1);

  // --- CRITICAL FIX FOR ART STYLES NOT LOADING ---
  // Create a dummy 2x2 image. This bypasses the early `if(!logoImg) return;` 
  // aborts in the mode files, allowing them to draw the full-screen background immediately.
  logoImg = createImage(2, 2);
  logoImg.loadPixels();
  for (let i = 0; i < logoImg.pixels.length; i++) {
    logoImg.pixels[i] = 255;
  }
  logoImg.updatePixels();

  // 2. Initialize color harmonies
  if (typeof syncAllModeHarmonyColors === 'function') {
    if (typeof artColorHarmonyByMode === 'object' && artColorHarmonyByMode.cube === undefined) {
       artColorHarmonyByMode.cube = 'complementary';
    }
    syncAllModeHarmonyColors(); 
  }
  
  // 3. Setup UI HTML Event Listeners
  setupHTMLInterface();

  // 4. Trigger the initial mode setup so art previews immediately
  triggerModeSetup(currentMode);
}

function draw() {
  push();
  
  // If an image is uploaded, use the detailed rendering fallback
  if (usingCustomSourceImage && uploadedSourceImg) {
    drawUploadedStyledImage(currentMode);
    pop();
    return;
  }
  
  // Route p5 draw loop to the active mode's draw function
  switch (currentMode) {
    case 'cube':
      if (typeof drawCube === 'function') drawCube();
      break;
    case 'mesh':
      if (typeof drawMesh === 'function') drawMesh();
      break;
    case 'shader':
      background(typeof shaderBgColor !== 'undefined' ? shaderBgColor : '#f0f0f0');
      if (typeof drawShader === 'function') drawShader(); 
      break;
    case 'flow':
      if (typeof drawFlow === 'function') drawFlow();
      break;
  }
  
  pop();
}

function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
  
  // Inform active mode of resize to regenerate structures
  if (currentMode === 'cube' && typeof windowResizedCube === 'function') windowResizedCube();
  if (currentMode === 'mesh' && typeof windowResizedMesh === 'function') windowResizedMesh();
  if (currentMode === 'shader' && typeof windowResizedShader === 'function') windowResizedShader();
  if (currentMode === 'flow' && typeof windowResizedFlow === 'function') windowResizedFlow();
}

// --- HTML UI MANAGEMENT ---

function setupHTMLInterface() {
  // Mode Selection
  const modeItems = document.querySelectorAll('#mode-selector li:not(.disabled)');
  modeItems.forEach(item => {
    item.addEventListener('click', (e) => {
      // Update active UI state
      modeItems.forEach(li => li.classList.remove('active'));
      const clickedItem = e.currentTarget; 
      clickedItem.classList.add('active');
      
      clear(); 
      currentMode = clickedItem.getAttribute('data-mode');
      
      // Update Harmony for new mode
      if (typeof window.getArtColorHarmonyForMode === 'function' && 
          typeof window.applyModeHarmonyColors === 'function') {
         const harmonyId = window.getArtColorHarmonyForMode(currentMode);
         window.applyModeHarmonyColors(currentMode, harmonyId, true);
      }
      
      triggerModeSetup(currentMode);
    });
  });

  // Image Upload Logic
  const uploadBtn = document.getElementById('upload-btn');
  const fileInput = document.getElementById('file-upload');
  
  uploadBtn.addEventListener('click', () => fileInput.click());
  
  fileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = function(event) {
        loadImage(event.target.result, (img) => {
          uploadedSourceImg = img; 
          logoImg = buildMaskImageFromSource(img); // Smart mask for generative modes
          usingCustomSourceImage = true;
          isWholePageMode = false; // Switch to masked trace mode
          clear();
          triggerModeSetup(currentMode); 
        });
      };
      reader.readAsDataURL(file);
    }
  });

  // Shuffle Colors Button
  const shuffleBtn = document.getElementById('shuffle-btn');
  if (shuffleBtn) {
    shuffleBtn.addEventListener('click', () => {
      if (typeof window.shuffleArtColorsForMode === 'function') {
        window.shuffleArtColorsForMode(currentMode);
        if (currentMode === 'cube' && typeof generateQuadtreePattern === 'function') {
          generateQuadtreePattern();
        }
      }
    });
  }
}

function triggerModeSetup(mode) {
  switch (mode) {
    case 'cube':
      if (typeof setupCube === 'function') {
        if (typeof window.bgColor === 'undefined') window.bgColor = '#1C1C1C';
        if (typeof window.fillColor === 'undefined') window.fillColor = '#FF8000';
        setupCube(); 
        if (typeof generateQuadtreePattern === 'function') generateQuadtreePattern();
      }
      break;
    case 'mesh':
      if (typeof setupMesh === 'function') {
        setupMesh();
      }
      break;
    case 'shader':
      if (typeof setupShader === 'function') setupShader();
      break;
    case 'flow':
      if (typeof setupFlow === 'function') setupFlow();
      break;
  }
}

// ============================================================================
// UPLOAD STYLING & PROCESSING HELPER FUNCTIONS
// ============================================================================

function brandOffWhite() { return '#f5f3f0'; }
function brandOffBlack() { return '#131211'; }

function getUploadIllustrationSparsity() {
  return constrain(typeof uploadIllustrationSparsity === 'number' ? uploadIllustrationSparsity : 0, 0, 1);
}

function uploadSparsitySkipCellSketch(ix, iy, salt) {
  const sp = getUploadIllustrationSparsity();
  if (sp < 0.001) return false;
  return (fract(sin(ix * 12.9898 + iy * 78.233 + (salt | 0) * 47.31) * 43758.5453) < sp * 0.9);
}

function getUploadDrawRect(sourceImg) {
  const iw = max(sourceImg.width, 1);
  const ih = max(sourceImg.height, 1);
  const fitScale = min((width * 0.95) / iw, (height * 0.95) / ih); // Increased to fill screen
  const scale = max(fitScale, 0.01);
  const w = max(1, floor(iw * scale));
  const h = max(1, floor(ih * scale));
  return { x: floor((width - w) * 0.5), y: floor((height - h) * 0.5), w: w, h: h };
}

function getUploadStyleBackgroundHex(modeName) {
  if (modeName === 'cube') return typeof bgColor !== 'undefined' ? bgColor : brandOffBlack();
  if (modeName === 'mesh') return '#000000';
  if (modeName === 'flow') return typeof flowBgColor !== 'undefined' ? flowBgColor : brandOffWhite();
  if (modeName === 'shader') return typeof shaderBgColor !== 'undefined' ? shaderBgColor : '#282624';
  return '#000000';
}

function syncDomBackgroundForUploadStyle(modeName) {
  const bg = getUploadStyleBackgroundHex(modeName);
  document.documentElement.style.backgroundColor = bg;
  document.body.style.backgroundColor = bg;
}

function buildGrayPixelsFromImage(sourceImg, w, h) {
  const pg = createGraphics(w, h);
  pg.pixelDensity(1);
  pg.image(sourceImg, 0, 0, w, h);
  pg.loadPixels();
  const gray = new Uint8Array(w * h);
  for (let i = 0, p = 0; p < gray.length; p++, i += 4) {
    gray[p] = floor(0.2126 * pg.pixels[i] + 0.7152 * pg.pixels[i + 1] + 0.0722 * pg.pixels[i + 2]);
  }
  pg.remove();
  return gray;
}

function drawUploadStyleAtmosphere(modeName) {
  const t = frameCount * 0.008;
  if (modeName === 'mesh') {
      textFont('monospace');
      textAlign(CENTER, CENTER);
      textSize(10);
      noStroke();
      const mc = color('#e8e8e8');
      const step = 11;
      for (let y = step; y < height; y += step) {
        for (let x = step; x < width; x += step) {
          if (noise(x * 0.04, y * 0.04, t) > 0.42) continue;
          const ch = noise(x * 0.09, y * 0.09) > 0.5 ? '0' : '1';
          fill(red(mc), green(mc), blue(mc), 22 + noise(x, y) * 28);
          text(ch, x, y);
        }
      }
  }
}

function drawImageStyleAscii(sourceImg, rect, skipBaseBackground = false) {
  if (!skipBaseBackground) background(brandOffWhite());
  const edgeChars = '/\\|_-+=*#@';
  const fillChars = '.,:;i1';
  const cell = 9;
  const w = max(24, floor(rect.w / cell));
  const h = max(24, floor(rect.h / cell));
  const gray = buildGrayPixelsFromImage(sourceImg, w, h);
  const glyphC = color('#e8e8e8');
  const fillProb = 0.25;
  const edgeGate = 53;

  textFont('monospace');
  textSize(cell * 1.0);
  textAlign(CENTER, CENTER);
  noStroke();

  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const idx = x + y * w;
      const luma = gray[idx];

      const gx = gray[idx + 1] - gray[idx - 1];
      const gy = gray[idx + w] - gray[idx - w];
      const edgeMag = abs(gx) + abs(gy);

      if (luma > 235) continue;

      let ch = '';
      let alphaV = 0;

      if (edgeMag > edgeGate) {
        const edgeIdx = floor(map(edgeMag, edgeGate, 255, 0, edgeChars.length - 1, true));
        ch = edgeChars[edgeIdx];
        alphaV = map(edgeMag, edgeGate, 255, 130, 255, true);
      } else if (luma < 170 && fract(sin(x * 47.13 + y * 91.71) * 9811.31) < fillProb) {
        const fillIdx = floor(map(luma, 0, 170, fillChars.length - 1, 0, true));
        ch = fillChars[fillIdx];
        alphaV = map(luma, 170, 0, 50, 120, true);
      } else {
        continue;
      }

      fill(red(glyphC), green(glyphC), blue(glyphC), alphaV);
      text(ch, rect.x + x * cell + cell * 0.5, rect.y + y * cell + cell * 0.5);
    }
  }
}

function drawUploadedStyledImage(modeName) {
  syncDomBackgroundForUploadStyle(modeName);
  const rect = getUploadDrawRect(uploadedSourceImg);
  
  // Shader, Cube, Mesh, and Flow native support for uploads via `usingCustomSourceImage`
  if (modeName === 'shader' && typeof drawShader === 'function') {
    drawShader();
    return;
  }
  if (modeName === 'cube' && typeof drawCube === 'function') {
    drawCube();
    return;
  }
  if (modeName === 'mesh' && typeof drawMesh === 'function') {
    drawMesh();
    return;
  }
  if (modeName === 'flow' && typeof drawFlow === 'function') {
    drawFlow();
    return;
  }

  background(getUploadStyleBackgroundHex(modeName));
  drawUploadStyleAtmosphere(modeName);
  
  if (modeName === 'mesh') {
    drawImageStyleAscii(uploadedSourceImg, rect, true);
  } else {
    image(uploadedSourceImg, rect.x, rect.y, rect.w, rect.h);
  }
}

function buildMaskImageFromSource(sourceImg) {
  sourceImg.loadPixels();
  const totalPixels = sourceImg.width * sourceImg.height;
  if (!totalPixels) return sourceImg;

  const histogram = new Array(256).fill(0);
  const lumaValues = new Uint8Array(totalPixels);

  for (let i = 0, p = 0; p < totalPixels; p++, i += 4) {
    const luma = Math.round(0.2126 * sourceImg.pixels[i] + 0.7152 * sourceImg.pixels[i + 1] + 0.0722 * sourceImg.pixels[i + 2]);
    lumaValues[p] = luma;
    if (sourceImg.pixels[i + 3] > 10) histogram[luma]++;
  }

  let sum = 0; for (let i = 0; i < 256; i++) sum += i * histogram[i];
  let threshold = 128, weightBg = 0, sumBg = 0, maxVariance = -1;
  const totalCount = histogram.reduce((acc, v) => acc + v, 0);

  if (totalCount > 0) {
    for (let i = 0; i < 256; i++) {
      weightBg += histogram[i];
      if (weightBg === 0) continue;
      const weightFg = totalCount - weightBg;
      if (weightFg === 0) break;
      sumBg += i * histogram[i];
      const meanBg = sumBg / weightBg;
      const meanFg = (sum - sumBg) / weightFg;
      const between = weightBg * weightFg * (meanBg - meanFg) * (meanBg - meanFg);
      if (between > maxVariance) { maxVariance = between; threshold = i; }
    }
  }

  const maskImg = createImage(sourceImg.width, sourceImg.height);
  maskImg.loadPixels();
  
  let brightCount = 0;
  for (let p = 0; p < totalPixels; p++) if (lumaValues[p] >= threshold) brightCount++;
  const keepBright = (brightCount / totalPixels) <= 0.72;

  for (let i = 0, p = 0; p < totalPixels; p++, i += 4) {
    if (sourceImg.pixels[i + 3] < 10) {
      maskImg.pixels[i] = maskImg.pixels[i + 1] = maskImg.pixels[i + 2] = maskImg.pixels[i + 3] = 0;
      continue;
    }
    const pass = keepBright ? (lumaValues[p] >= threshold) : (lumaValues[p] <= threshold);
    maskImg.pixels[i] = maskImg.pixels[i + 1] = maskImg.pixels[i + 2] = 255;
    maskImg.pixels[i + 3] = pass ? 255 : 0;
  }
  maskImg.updatePixels();
  return maskImg;
}