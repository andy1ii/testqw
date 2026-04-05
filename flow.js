var PLOT_NUM_SCANNERS = 4;
var PLOT_TIME_LAPSE_BASE = 3;
var PLOT_HIGHLIGHT_GATE = 0.74;

var plotterRenderQueue = [];
var plotterDrawingLayer;
var plotScanners = [];
var plotterIsPlotting = false;

var flowMaskPixels = [];
var flowLogoScale = 1;
var flowPg;

var plotLogoHrX = 0;
var plotLogoHrY = 0;
var plotLogoHrW = 0;
var plotLogoHrH = 0;

var plotLumaBuffer;
var plotHatchLumaInvert = false;

var flowBgColor = typeof BRAND_NEUTRAL !== 'undefined' ? BRAND_NEUTRAL.OFF_WHITE : '#f5f3f0';
var flowColor1 = typeof BRAND_EXTENDED !== 'undefined' ? BRAND_EXTENDED.ROYAL_BLUE : '#2D69E6';

var flowCurveScale = 0.0022;
var flowSpeedMult = 0.7;

// --- UPLOAD ROUTING HELPERS ---
function getActiveFlowImage() {
  return (typeof usingCustomSourceImage !== 'undefined' && usingCustomSourceImage && uploadedSourceImg) ? uploadedSourceImg : logoImg;
}

function isFlowUpload() {
  return (typeof usingCustomSourceImage !== 'undefined' && usingCustomSourceImage);
}

function palRgb(c) {
  var cc = color(c);
  return [red(cc), green(cc), blue(cc)];
}

function plotMaskAt(fx, fy) {
  var xi = constrain(floor(fx), 0, width - 1);
  var yi = constrain(floor(fy), 0, height - 1);
  return flowMaskPixels[xi + yi * width] === 1;
}

function plotGetHatchRect() {
  if (isWholePageMode || isFlowUpload() || plotLogoHrW < 2 || plotLogoHrH < 2) {
    return { x0: 0, y0: 0, x1: width, y1: height };
  }
  return {
    x0: plotLogoHrX,
    y0: plotLogoHrY,
    x1: plotLogoHrX + plotLogoHrW,
    y1: plotLogoHrY + plotLogoHrH
  };
}

function processPlotterMask() {
  var totalPixels = width * height;
  flowMaskPixels = new Uint8Array(totalPixels);

  var activeImg = getActiveFlowImage();
  if (!activeImg || activeImg.width < 1) {
    plotLogoHrW = 0;
    plotLogoHrH = 0;
    return;
  }

  if (isFlowUpload() && typeof getUploadDrawRect === 'function') {
    var r = getUploadDrawRect(activeImg);
    plotLogoHrX = r.x;
    plotLogoHrY = r.y;
    plotLogoHrW = r.w;
    plotLogoHrH = r.h;
  } else {
    var baseScale = min(width / activeImg.width, height / activeImg.height) * 0.55;
    var minScale = 280 / max(activeImg.width, 1);
    flowLogoScale = max(baseScale, minScale);

    plotLogoHrW = floor(activeImg.width * flowLogoScale);
    plotLogoHrH = floor(activeImg.height * flowLogoScale);
    plotLogoHrX = floor((width - plotLogoHrW) / 2);
    plotLogoHrY = floor((height - plotLogoHrH) / 2);
  }

  if (isWholePageMode || isFlowUpload()) {
    for (var i = 0; i < totalPixels; i++) flowMaskPixels[i] = 1;
  } else {
    if (!flowPg) {
      flowPg = createGraphics(width, height);
      flowPg.pixelDensity(1);
    }
    flowPg.clear();
    flowPg.image(activeImg, plotLogoHrX, plotLogoHrY, plotLogoHrW, plotLogoHrH);
    
    if (typeof fillArtMaskFromLogoComposite === 'function') {
        fillArtMaskFromLogoComposite(flowPg, flowMaskPixels);
    }
  }
}

function plotRebuildLumaBuffer() {
  plotHatchLumaInvert = false;
  var activeImg = getActiveFlowImage();
  if ((isWholePageMode && !isFlowUpload()) || plotLogoHrW < 2 || plotLogoHrH < 2 || !activeImg) {
    return;
  }
  if (!plotLumaBuffer || plotLumaBuffer.width !== plotLogoHrW || plotLumaBuffer.height !== plotLogoHrH) {
    plotLumaBuffer = createGraphics(plotLogoHrW, plotLogoHrH);
    plotLumaBuffer.pixelDensity(1);
  }
  plotLumaBuffer.clear();
  plotLumaBuffer.image(activeImg, 0, 0, plotLogoHrW, plotLogoHrH);
  plotLumaBuffer.loadPixels();
  var px = plotLumaBuffer.pixels;
  var n = plotLogoHrW * plotLogoHrH;
  var sum = 0;
  var cnt = 0;
  for (var i = 0; i < n; i++) {
    var o = i * 4;
    if (px[o + 3] < 24) continue;
    var r = px[o];
    var g = px[o + 1];
    var b = px[o + 2];
    sum += 0.2126 * r + 0.7152 * g + 0.0722 * b;
    cnt++;
  }
  var mean = cnt > 0 ? sum / cnt / 255 : 0.4;
  plotHatchLumaInvert = mean > 0.52;
}

function plotLumaAtLocal(lx, ly) {
  if (!plotLumaBuffer || lx < 0 || ly < 0 || lx >= plotLogoHrW || ly >= plotLogoHrH) {
    return { l: 1, a: 0 };
  }
  var o = (lx + ly * plotLogoHrW) * 4;
  var r = plotLumaBuffer.pixels[o];
  var g = plotLumaBuffer.pixels[o + 1];
  var b = plotLumaBuffer.pixels[o + 2];
  var a = plotLumaBuffer.pixels[o + 3] / 255;
  return { l: (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255, a: a };
}

function plotSubjectHatchLuma(wx, wy) {
  if (!isFlowUpload() && !plotMaskAt(wx, wy)) return null;
  var lx = floor(wx - plotLogoHrX);
  var ly = floor(wy - plotLogoHrY);
  var lumaData = plotLumaAtLocal(lx, ly);
  if (lumaData.a < 0.04) return null;
  var L = constrain(lumaData.l, 0, 1);
  if (plotHatchLumaInvert) L = 1 - L;
  return L;
}

// --- NEW STRICT NON-CROSSING LOGIC ---
function getLineDirection(x, y) {
  var gap = 0.06; // Creates the clean boundary gap between H and V lines
  
  if (isFlowUpload()) {
    var L = plotSubjectHatchLuma(x, y);
    if (L === null) return 'H'; // Outside the image is horizontal
    if (L < 0.5 - gap) return 'V'; // Dark areas are vertical
    if (L > 0.5 + gap) return 'H'; // Light areas are horizontal
    return 'NONE'; // Inside the gap threshold
  } else if (isWholePageMode) {
    // When no image is uploaded, generate geometric patches of non-overlapping lines
    var n = noise(x * 0.006, y * 0.006);
    if (n < 0.5 - gap) return 'V';
    if (n > 0.5 + gap) return 'H';
    return 'NONE';
  } else {
    // For standard logo, use edge detection to create the halo gap
    var center = plotMaskAt(x, y);
    var left = plotMaskAt(x - 6, y);
    var right = plotMaskAt(x + 6, y);
    var up = plotMaskAt(x, y - 6);
    var down = plotMaskAt(x, y + 6);
    
    if (center !== left || center !== right || center !== up || center !== down) {
        return 'NONE'; 
    }
    return center ? 'V' : 'H';
  }
}

function flushHatchSeg(seg) {
  if (seg && seg.vertices.length >= 2) plotterRenderQueue.push(seg);
}

function plotPointInHatchRect(x, y, r) {
  return x >= r.x0 && x <= r.x1 && y >= r.y0 && y <= r.y1;
}

function compileHorizontalHatch(nZ, nScale, hStep, inkRgb, r) {
  var dx = 4; // High resolution for precise stopping
  var maxVerts = 300;

  for (var baseY = r.y0 + hStep * 0.5; baseY < r.y1 - 0.5; baseY += hStep) {
    var seg = null;
    var vertCount = 0;

    for (var x = r.x0; x <= r.x1 + 0.001; x += dx) {
      var py = baseY; // Perfectly straight lines

      var insideBox = plotPointInHatchRect(x, py, r);
      var allowHoriz = insideBox && (getLineDirection(x, py) === 'H');
      
      if (!allowHoriz) {
        flushHatchSeg(seg);
        seg = null;
        vertCount = 0;
        continue;
      }

      if (!seg) {
        seg = { type: 'hLine', color: inkRgb, weight: 1.2, vertices: [] };
        vertCount = 0;
      }
      seg.vertices.push({ x: x, y: py });
      vertCount++;
      if (vertCount >= maxVerts) {
        flushHatchSeg(seg);
        seg = null;
        vertCount = 0;
      }
    }
    flushHatchSeg(seg);
  }
}

function compileVerticalHatch(nZ, nScale, vStep, inkRgb, r) {
  var dy = 4; // High resolution for precise stopping
  var maxVerts = 300;

  for (var baseX = r.x0 + vStep * 0.5; baseX < r.x1 - 0.5; baseX += vStep) {
    var seg = null;
    var vertCount = 0;

    for (var y = r.y0; y <= r.y1 + 0.001; y += dy) {
      var px = baseX; // Perfectly straight lines

      var insideBox = plotPointInHatchRect(px, y, r);
      var allowVert = insideBox && (getLineDirection(px, y) === 'V');
      
      if (!allowVert) {
        flushHatchSeg(seg);
        seg = null;
        vertCount = 0;
        continue;
      }

      if (!seg) {
        seg = { type: 'vLine', color: inkRgb, weight: 1.2, vertices: [] };
        vertCount = 0;
      }
      seg.vertices.push({ x: px, y: y });
      vertCount++;
      if (vertCount >= maxVerts) {
        flushHatchSeg(seg);
        seg = null;
        vertCount = 0;
      }
    }
    flushHatchSeg(seg);
  }
}

function compilePlotterTopology() {
  plotterRenderQueue = [];
  processPlotterMask();

  if (!plotterDrawingLayer) return;

  var paper = color(flowBgColor);
  plotterDrawingLayer.background(red(paper), green(paper), blue(paper));

  var activeImg = getActiveFlowImage();
  if (!activeImg || activeImg.width < 1) {
    plotterIsPlotting = false;
    return;
  }

  var seed = floor(random(100000));
  noiseSeed(seed);
  randomSeed(seed);
  noiseDetail(7, 0.5);

  var nScale = map(flowCurveScale, 0.0005, 0.005, 0.009, 0.026, true);
  var nZ = seed * 0.00001;

  plotRebuildLumaBuffer();

  var hatchR = plotGetHatchRect();
  
  // TIGHTENED SPACING: Match the dense, technical look of the reference
  var hStep = 8; 
  var vStep = 8;

  var inkRgb = palRgb(flowColor1);

  compileHorizontalHatch(nZ, nScale, hStep, inkRgb, hatchR);
  compileVerticalHatch(nZ, nScale, vStep, inkRgb, hatchR);

  plotterRenderQueue.sort((a, b) => {
    var order = { hLine: 0, vLine: 1 };
    var oa = order[a.type];
    var ob = order[b.type];
    return (oa !== undefined ? oa : 0) - (ob !== undefined ? ob : 0);
  });

  plotterIsPlotting = plotterRenderQueue.length > 0;
}

class CNCPlotter {
  constructor(id) {
    this.id = id;
    this.pos = createVector(width * 0.5 + random(-50, 50), height * 0.5 + random(-50, 50));
    this.target = null;
    this.activePath = null;
    this.vIndex = 0;
    this.penDown = false;
    this.speed = 1000; // Adjusted for dense straight lines
  }

  update() {
    var distRemaining = this.speed;
    var safeguardCounter = 0;

    while (distRemaining > 0 && safeguardCounter < 200) {
      safeguardCounter++;

      if (!this.activePath) {
        if (plotterRenderQueue.length === 0) return;

        this.activePath = plotterRenderQueue.shift();
        this.vIndex = 0;
        this.penDown = false;

        var startPt = this.activePath.vertices[0];
        this.target = createVector(startPt.x, startPt.y);
      }

      var d = dist(this.pos.x, this.pos.y, this.target.x, this.target.y);

      if (d <= distRemaining) {
        if (this.penDown && this.activePath.type !== 'dot') {
          this.drawSegment(this.pos.x, this.pos.y, this.target.x, this.target.y);
        }

        this.pos.x = this.target.x;
        this.pos.y = this.target.y;
        distRemaining -= d;

        if (!this.penDown) {
          this.penDown = true;

          if (this.activePath.type === 'dot') {
            plotterDrawingLayer.noStroke();
            plotterDrawingLayer.fill(
              this.activePath.color[0],
              this.activePath.color[1],
              this.activePath.color[2],
              220
            );
            plotterDrawingLayer.circle(this.pos.x, this.pos.y, this.activePath.weight);
            this.activePath = null;
          } else {
            this.vIndex++;
            if (this.vIndex < this.activePath.vertices.length) {
              this.target = createVector(
                this.activePath.vertices[this.vIndex].x,
                this.activePath.vertices[this.vIndex].y
              );
            } else {
              this.activePath = null;
            }
          }
        } else {
          this.vIndex++;
          if (this.vIndex < this.activePath.vertices.length) {
            this.target = createVector(
              this.activePath.vertices[this.vIndex].x,
              this.activePath.vertices[this.vIndex].y
            );
          } else {
            this.activePath = null;
          }
        }
      } else {
        var angle = atan2(this.target.y - this.pos.y, this.target.x - this.pos.x);
        var nextX = this.pos.x + cos(angle) * distRemaining;
        var nextY = this.pos.y + sin(angle) * distRemaining;

        if (this.penDown && this.activePath.type !== 'dot') {
          this.drawSegment(this.pos.x, this.pos.y, nextX, nextY);
        }

        this.pos.x = nextX;
        this.pos.y = nextY;
        distRemaining = 0;
      }
    }
  }

  drawSegment(x1, y1, x2, y2) {
    plotterDrawingLayer.stroke(
      this.activePath.color[0],
      this.activePath.color[1],
      this.activePath.color[2],
      232
    );
    plotterDrawingLayer.strokeWeight(this.activePath.weight);
    plotterDrawingLayer.strokeCap(SQUARE);
    plotterDrawingLayer.strokeJoin(MITER);
    plotterDrawingLayer.line(x1, y1, x2, y2);
  }

  drawHead() {
    if (!this.activePath && plotterRenderQueue.length === 0) return;

    push();
    translate(this.pos.x, this.pos.y);

    if (this.penDown) {
      stroke(190, 70, 50, 200);
    } else {
      stroke(50, 50, 50, 150);
    }

    strokeWeight(1.5);
    line(-10, 0, 10, 0);
    line(0, -10, 0, 10);
    noFill();
    circle(0, 0, 8);

    noStroke();
    fill(50, 50, 50, 150);
    textSize(10);
    text(`P${this.id}`, 8, -8);
    pop();
  }
}

function setupFlow() {
  if (!flowPg) {
    flowPg = createGraphics(width, height);
    flowPg.pixelDensity(1);
  }
  if (!plotterDrawingLayer) {
    plotterDrawingLayer = createGraphics(width, height);
    plotterDrawingLayer.pixelDensity(1);
  } else {
    plotterDrawingLayer.resizeCanvas(width, height);
  }

  plotScanners = [];
  for (var i = 0; i < PLOT_NUM_SCANNERS; i++) {
    plotScanners.push(new CNCPlotter(i + 1));
  }

  compilePlotterTopology();
}

function windowResizedFlow() {
  if (flowPg) flowPg.resizeCanvas(width, height);
  if (plotterDrawingLayer) plotterDrawingLayer.resizeCanvas(width, height);
  plotScanners = [];
  for (var i = 0; i < PLOT_NUM_SCANNERS; i++) {
    plotScanners.push(new CNCPlotter(i + 1));
  }
  compilePlotterTopology();
}

function coverPlotterOutsideLogoBox() {
  if (typeof isWholePageMode !== 'undefined' && isWholePageMode) return;
  if (isFlowUpload()) return;
  if (typeof plotLogoHrW === 'undefined' || plotLogoHrW < 2 || plotLogoHrH < 2) return;

  var paper = color(flowBgColor);
  var x0 = plotLogoHrX;
  var y0 = plotLogoHrY;
  var x1 = plotLogoHrX + plotLogoHrW;
  var y1 = plotLogoHrY + plotLogoHrH;

  push();
  noStroke();
  fill(red(paper), green(paper), blue(paper));
  rect(0, 0, width, y0);
  rect(0, y1, width, height - y1);
  rect(0, y0, x0, y1 - y0);
  rect(x1, y0, width - x1, y1 - y0);
  pop();
}

function drawFlow() {
  var paper = color(flowBgColor);
  background(red(paper), green(paper), blue(paper));

  if (!plotterDrawingLayer) {
    setupFlow();
    return;
  }

  var activeImg = getActiveFlowImage();

  if (!isWholePageMode && !isFlowUpload() && activeImg && activeImg.width > 0 && plotLogoHrW > 0) {
    push();
    tint(255, 14);
    image(activeImg, plotLogoHrX, plotLogoHrY, plotLogoHrW, plotLogoHrH);
    noTint();
    pop();
  }

  image(plotterDrawingLayer, 0, 0);
  coverPlotterOutsideLogoBox();

  var steps = max(1, floor(PLOT_TIME_LAPSE_BASE * flowSpeedMult));
  var stillWorking = false;

  if (plotterIsPlotting) {
    for (var s = 0; s < steps; s++) {
      for (var p of plotScanners) {
        p.update();
        if (p.activePath || plotterRenderQueue.length > 0) stillWorking = true;
      }
    }
    for (var p of plotScanners) {
      p.drawHead();
    }
    if (!stillWorking) plotterIsPlotting = false;
  } else {
    for (var p of plotScanners) {
      p.drawHead();
    }
  }
}