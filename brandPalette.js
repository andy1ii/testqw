/**
 * Cursor Creative Generator — design system colors from brand palette docs
 * (Primary neutrals, Cursor orange + tints on white, Extended 100% on white, Color-on-Color pairs).
 */
var BRAND_NEUTRAL = {
  PURE_BLACK: '#000000',
  OFF_BLACK: '#131211',
  BROWN_4: '#282624',
  BROWN_3: '#5c5753',
  BROWN_2: '#aaa399',
  BROWN_1: '#e4dfd8',
  OFF_WHITE: '#f5f3f0',
  PURE_WHITE: '#ffffff',
};

/** Orange — 100% / 50% / 20% on white (Extended Palette strip). */
var BRAND_ORANGE = '#EA4D00';
var BRAND_ORANGE_50_W = '#F5A680';
var BRAND_ORANGE_20_W = '#FBDBD2';

/**
 * Extended palette — 100% on white row (12 columns, left → right).
 */
var BRAND_EXTENDED = {
  ORANGE_RED: '#EF510D',
  ORANGE: '#FF7F32',
  EARTH_BROWN: '#8B5C44',
  OCHRE: '#9a6f3f',
  GOLD: '#C29600',
  OLIVE: '#977E00',
  FOREST_GREEN: '#2A7930',
  KELLY: '#329F21',
  TEAL: '#1FA094',
  ROYAL_BLUE: '#2D69E6',
  PERIWINKLE: '#7170C1',
  MAGENTA: '#D567BD',
  RED: '#E12C28',
};

/**
 * Color-on-color / tone-on-tone spec — pastel paper + saturated ink (exact hex from brand doc).
 */
var BRAND_TONE_ON_COLOR = {
  ORANGE: { paper: '#FFE0D1', ink: '#FF6A43' },
  ORANGE_LIGHT: { paper: '#FFE5DA', ink: '#FF896D' },
  GOLD: { paper: '#EDE6CF', ink: '#D0AF4F' },
  YELLOW: { paper: '#F8EED0', ink: '#EDC042' },
  GREEN_DARK: { paper: '#D3E7D3', ink: '#2C7435' },
  GREEN_LIGHT: { paper: '#D0ECD4', ink: '#6AB47C' },
  TURQUOISE: { paper: '#D9F1EC', ink: '#39AFA1' },
  BLUE: { paper: '#D7E0F8', ink: '#4A71C6' },
  PURPLE: { paper: '#E4E0F3', ink: '#8B7CB8' },
  LAVENDER: { paper: '#EEE9F3', ink: '#C262B7' },
};

/**
 * Raster (cube) logo defaults — dark charcoal field + solid orange circles (swatch: #1C1C1C / #FF8000).
 * Grid line is a slightly lighter grey so the faint stroke reads on the background.
 */
var BRAND_RASTER_NEUTRAL = {
  bg: '#1C1C1C',
  line: '#3D3D3D',
  fill: '#FF8000',
  accent: '#FF8000',
};

/**
 * Kinetic (mesh) — muted multi-color glyph field on white for the logo showcase.
 * Upload / trace stage color follows `meshStageBg` (Kinetic controls → Background).
 */
var BRAND_KINETIC_SYNTAX = {
  stageBg: BRAND_NEUTRAL.PURE_WHITE,
  bg: BRAND_NEUTRAL.PURE_WHITE,
  comment: '#8A939E',
  keyword: '#B54D62',
  func: '#5C8DB8',
  var: '#6A6E78',
  num: '#D99084',
  operator: '#A493C4',
  default: '#6A6E78',
  lineNum: '#717684',
  cursor: '#4A4F58',
  meshUiPrimary: '#6A6E78',
  /**
   * Per-character kinetic palette — dusty rose, coral, slate/teal blues, sage/olive, mustard/gold, plum, lavender, charcoal.
   * Each glyph picks by (line, token, char) hash so words are not a single solid fill.
   */
  glyphAccents: [
    '#C47B7F',
    '#D99084',
    '#C17A6A',
    '#5B7C99',
    '#8FAFCC',
    '#6199A8',
    '#5E9B91',
    '#7D9A7E',
    '#7F8F5E',
    '#C4A64A',
    '#D4B876',
    '#9B7A8F',
    '#A493C4',
    '#5C8DB8',
    '#DEB896',
    '#5C5F66',
    '#88A4BE',
  ],
};

/** Flat list of every canonical hex (for snapping uploads of palette PNGs to spec values). */
function getBrandPaletteHexCatalog() {
  const out = [];
  const add = (h) => {
    if (h && typeof h === 'string') out.push(h);
  };
  Object.values(BRAND_NEUTRAL).forEach(add);
  Object.values(BRAND_RASTER_NEUTRAL).forEach(add);
  Object.keys(BRAND_KINETIC_SYNTAX).forEach(function (k) {
    const v = BRAND_KINETIC_SYNTAX[k];
    if (typeof v === 'string') add(v);
    else if (Array.isArray(v)) v.forEach(add);
  });
  add(BRAND_ORANGE);
  add(BRAND_ORANGE_50_W);
  add(BRAND_ORANGE_20_W);
  Object.values(BRAND_EXTENDED).forEach(add);
  Object.values(BRAND_TONE_ON_COLOR).forEach((pair) => {
    add(pair.paper);
    add(pair.ink);
  });
  const seen = new Set();
  return out.filter((h) => {
    const k = h.toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

window.getBrandPaletteHexCatalog = getBrandPaletteHexCatalog;