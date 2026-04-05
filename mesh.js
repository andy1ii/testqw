// --- KINETIC (MESH) MODE VARIABLES ---
// We replace the string with an array of code snippets, ordered by visual density.
let meshCodeRamp = [
  " ", " ", ".", "-", ":", ";", "=", "+", "<", ">", "/", "\\",
  "()", "{}", "[]", "0", "1", "=>", "&&", "||", "let", "var",
  "NaN", "null", "true", "false", "0x00", "0xFF", "#", "@"
]; 
let meshGridSize = 30; 
let meshAlphaMask;
let meshPg;

function setupMesh() {
  if (typeof cursorFont !== 'undefined') {
    textFont(cursorFont);
  } else {
    textFont('monospace');
  }
  // Slightly reduced textSize (from 0.9 to 0.75) to prevent longer 
  // keywords from bleeding too heavily out of their grid cells.
  textSize(meshGridSize * 0.75); 
  textAlign(CENTER, CENTER);
  noStroke();

  processMeshMask();
}

function windowResizedMesh() {
  if (meshPg) {
    meshPg.resizeCanvas(width, height);
  }
  processMeshMask();
}

function processMeshMask() {
  // If logoImg is exactly 2x2, it's the dummy image from sketch.js, meaning no user upload yet
  if (!logoImg || (logoImg.width === 2 && logoImg.height === 2)) {
    isWholePageMode = true;
    return;
  }
  
  isWholePageMode = false;

  if (!meshPg) {
    meshPg = createGraphics(width, height);
  } else if (meshPg.width !== width || meshPg.height !== height) {
    meshPg.resizeCanvas(width, height);
  }

  if (!meshAlphaMask) {
    meshAlphaMask = createImage(width, height);
  } else if (meshAlphaMask.width !== width || meshAlphaMask.height !== height) {
    meshAlphaMask.resize(width, height);
  }

  // Use the unified global sizing function from sketch.js
  let rect = getUploadDrawRect(logoImg);
  let hrW = rect.w;
  let hrH = rect.h; 
  let hrX = rect.x;
  let hrY = rect.y;

  meshPg.clear();
  meshPg.background(0);
  meshPg.image(logoImg, hrX, hrY, hrW, hrH);
  meshPg.loadPixels();
  
  meshAlphaMask.loadPixels();
  let totalPixels = width * height;
  
  for (let i = 0; i < totalPixels; i++) {
    let isMask = meshPg.pixels[i * 4] > 128; // threshold
    let o = i * 4;
    meshAlphaMask.pixels[o] = 255;
    meshAlphaMask.pixels[o+1] = 255;
    meshAlphaMask.pixels[o+2] = 255;
    meshAlphaMask.pixels[o+3] = isMask ? 255 : 0;
  }
  meshAlphaMask.updatePixels();
}

function drawMesh() {
  // Clear the canvas to allow transparency masks to work correctly
  clear();

  // Draw the ASCII noise background
  let speed = 0.005; 
  let t = frameCount * speed;
  
  // Use primary color from your harmony logic if available, else fallback
  let primaryColor = '#C2CB7F'; 
  if (typeof window.artColors !== 'undefined' && window.artColors.length > 0) {
    primaryColor = window.artColors[0];
  }
  fill(primaryColor);

  for (let x = 0; x < width; x += meshGridSize) {
    for (let y = 0; y < height; y += meshGridSize) {
      let n = noise(x * 0.004, y * 0.004, t);
      
      // Map the noise value to the length of our array
      let charIndex = floor(map(n, 0, 1, 0, meshCodeRamp.length));
      charIndex = constrain(charIndex, 0, meshCodeRamp.length - 1);
      
      // Pull the snippet from the array instead of a string
      let snippet = meshCodeRamp[charIndex];

      if (snippet === ' ') continue;
      text(snippet, x + meshGridSize / 2, y + meshGridSize / 2);
    }
  }

  // Mask it to the shape of the uploaded logo
  if (!isWholePageMode && meshAlphaMask) {
    drawingContext.globalCompositeOperation = 'destination-in';
    image(meshAlphaMask, 0, 0);
  }

  // Draw the dark background behind the masked ASCII
  drawingContext.globalCompositeOperation = 'destination-over';
  background('#1c1c1c'); 
  drawingContext.globalCompositeOperation = 'source-over'; // Reset
}