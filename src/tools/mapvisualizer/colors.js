/**
 * Color gradient system for terrain visualizer
 * Maps terrain parameters to RGB colors for visualization
 */

// Gradient definitions - each is an array of { value, color: [r,g,b] } stops

const CONTINENTAL_GRADIENT = [
  { value: 0.0, color: [0, 50, 120] },      // Deep ocean (dark blue)
  { value: 0.2, color: [30, 100, 180] },    // Shallow ocean (blue)
  { value: 0.3, color: [220, 200, 120] },   // Beach/lowlands (tan)
  { value: 0.5, color: [100, 150, 60] },    // Plains (green)
  { value: 0.7, color: [140, 120, 80] },    // Hills (brown)
  { value: 0.85, color: [180, 180, 180] },  // Mountains (gray)
  { value: 1.0, color: [255, 255, 255] }    // Peaks (white)
];

const TEMPERATURE_GRADIENT = [
  { value: 0.0, color: [0, 50, 150] },      // Freezing (blue)
  { value: 0.25, color: [120, 180, 240] },  // Cold (light blue)
  { value: 0.5, color: [220, 220, 200] },   // Temperate (white-yellow)
  { value: 0.75, color: [240, 150, 60] },   // Warm (orange)
  { value: 1.0, color: [200, 40, 0] }       // Hot (red)
];

const HUMIDITY_GRADIENT = [
  { value: 0.0, color: [220, 180, 80] },    // Arid (yellow-brown)
  { value: 0.3, color: [200, 200, 120] },   // Dry (tan)
  { value: 0.5, color: [120, 180, 100] },   // Moderate (green)
  { value: 0.7, color: [60, 150, 120] },    // Humid (teal)
  { value: 1.0, color: [40, 100, 150] }     // Wet (cyan-blue)
];

const EROSION_GRADIENT = [
  { value: 0.0, color: [40, 40, 40] },      // Deep valleys (dark gray)
  { value: 0.3, color: [100, 100, 100] },   // Eroded (medium gray)
  { value: 0.7, color: [180, 180, 180] },   // Smooth (light gray)
  { value: 1.0, color: [240, 240, 240] }    // Peaks (near white)
];

const RIDGENESS_GRADIENT = [
  { value: 0.0, color: [0, 0, 0] },         // Valleys (black)
  { value: 0.2, color: [60, 40, 20] },      // Slopes (dark brown)
  { value: 0.5, color: [140, 100, 60] },    // Hills (brown)
  { value: 0.8, color: [200, 180, 160] },   // Ridges (tan)
  { value: 1.0, color: [255, 255, 255] }    // Sharp ridges (white)
];

const ELEVATION_GRADIENT = [
  { value: 0.0, color: [20, 50, 120] },      // Deep underwater (< 0)
  { value: 0.095, color: [30, 80, 160] },    // Underwater (0-6)
  { value: 0.19, color: [80, 160, 60] },     // Lowland (6-12)
  { value: 0.317, color: [140, 180, 60] },   // Upland (12-20)
  { value: 0.555, color: [160, 120, 60] },   // Highland (20-35)
  { value: 0.794, color: [140, 140, 140] },  // Mountain (35-50)
  { value: 1.0, color: [250, 250, 250] }     // Peak (> 50)
];

// Biome colors - discrete mapping for biome visualization
const BIOME_COLORS = {
  // Water biomes
  ocean: [30, 80, 160],
  beach: [220, 200, 120],

  // Temperate biomes
  plains: [77, 204, 64],
  savanna: [200, 190, 110],
  taiga: [89, 102, 89],

  // Forest biomes
  jungle: [51, 102, 38],
  rainforest: [64, 170, 80],
  swamp: [80, 110, 80],

  // Dry biomes
  desert: [242, 217, 128],
  badlands: [200, 100, 70],

  // Cold biomes
  snow: [240, 250, 255],
  tundra: [242, 250, 255],
  alpine: [240, 220, 230],

  // Mountain biomes
  mountains: [153, 153, 153],
  highlands: [200, 190, 180],
  volcanic: [165, 90, 65],

  // Climate matrix biomes
  red_desert: [230, 128, 83],
  meadow: [180, 230, 128],
  deciduous_forest: [120, 200, 108],
  autumn_forest: [217, 153, 89],
  glacier: [204, 230, 250]
};

// Map mode names to gradients
const MODE_GRADIENTS = {
  continental: CONTINENTAL_GRADIENT,
  temperature: TEMPERATURE_GRADIENT,
  humidity: HUMIDITY_GRADIENT,
  erosion: EROSION_GRADIENT,
  ridgeness: RIDGENESS_GRADIENT,
  elevation: ELEVATION_GRADIENT
};

// Map mode names to parameter names
const MODE_PARAMS = {
  continental: 'continental',
  temperature: 'temperature',
  humidity: 'humidity',
  erosion: 'erosion',
  ridgeness: 'ridgeness',
  elevation: 'height'
};

/**
 * Sample a color gradient at a given value
 * @param {number} value - Value to sample [0, 1]
 * @param {Array} gradient - Array of { value, color: [r,g,b] } stops
 * @returns {Array} RGB color [r, g, b] in range [0, 255]
 */
function sampleGradient(value, gradient) {
  // Clamp value to [0, 1]
  value = Math.max(0, Math.min(1, value));

  // Handle edge cases
  if (value <= gradient[0].value) {
    return [...gradient[0].color];
  }
  if (value >= gradient[gradient.length - 1].value) {
    return [...gradient[gradient.length - 1].color];
  }

  // Find the two stops that bracket this value
  for (let i = 0; i < gradient.length - 1; i++) {
    const stop1 = gradient[i];
    const stop2 = gradient[i + 1];

    if (value >= stop1.value && value <= stop2.value) {
      // Linear interpolation between the two stops
      const range = stop2.value - stop1.value;
      const t = (value - stop1.value) / range;

      const r = Math.floor(stop1.color[0] + (stop2.color[0] - stop1.color[0]) * t);
      const g = Math.floor(stop1.color[1] + (stop2.color[1] - stop1.color[1]) * t);
      const b = Math.floor(stop1.color[2] + (stop2.color[2] - stop1.color[2]) * t);

      return [r, g, b];
    }
  }

  // Fallback (should never reach here)
  return [...gradient[gradient.length - 1].color];
}

/**
 * Calculate hillshade brightness multiplier from terrain normals
 * @param {number} heightCenter - Height at center pixel
 * @param {number} heightLeft - Height 1 unit to the left
 * @param {number} heightRight - Height 1 unit to the right
 * @param {number} heightUp - Height 1 unit up (z-1)
 * @param {number} heightDown - Height 1 unit down (z+1)
 * @returns {number} Brightness multiplier [0.6, 1.4]
 */
function calculateHillshade(heightCenter, heightLeft, heightRight, heightUp, heightDown) {
  // Compute gradients in world space
  const dx = heightRight - heightLeft;
  const dz = heightDown - heightUp;

  // Surface normal (approximate, unnormalized is fine for dot product)
  const nx = -dx;
  const ny = 2; // vertical scale factor
  const nz = -dz;

  // Normalize
  const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
  const normalX = nx / len;
  const normalY = ny / len;
  const normalZ = nz / len;

  // Light direction: northwest, 45° elevation
  const lightX = 0.7;
  const lightY = 0.7;
  const lightZ = -0.3;

  // Normalize light (already close to unit length)
  const lightLen = Math.sqrt(lightX * lightX + lightY * lightY + lightZ * lightZ);
  const lx = lightX / lightLen;
  const ly = lightY / lightLen;
  const lz = lightZ / lightLen;

  // Dot product for diffuse shading
  const shade = normalX * lx + normalY * ly + normalZ * lz;

  // Map [-1, 1] → [0.6, 1.4] for subtle shading
  return 0.6 + (shade + 1) * 0.4;
}

/**
 * Get RGB color for a given mode and terrain parameters
 * @param {Object} params - Terrain parameters from getTerrainParams
 * @param {string} mode - Visualization mode name
 * @param {Object} neighbors - Optional neighbor heights for hillshade (left, right, up, down)
 * @returns {Array} RGB color [r, g, b] in range [0, 255]
 */
export function getColorForMode(params, mode, neighbors = null) {
  // Special case: biome mode uses discrete colors
  if (mode === 'biome') {
    const biomeName = params.biome;
    return BIOME_COLORS[biomeName] || [128, 128, 128]; // Gray fallback for unknown biomes
  }

  // Special case: elevation mode with hillshade
  if (mode === 'elevation' && neighbors) {
    const height = params.height;

    // Normalize height [1, 63] → [0, 1]
    const normalizedHeight = (height - 1) / 62;

    // Sample base color from elevation gradient
    const baseColor = sampleGradient(normalizedHeight, ELEVATION_GRADIENT);

    // Calculate hillshade if neighbors provided
    const shade = calculateHillshade(
      height,
      neighbors.left,
      neighbors.right,
      neighbors.up,
      neighbors.down
    );

    // Apply hillshade to base color
    const r = Math.min(255, Math.max(0, Math.floor(baseColor[0] * shade)));
    const g = Math.min(255, Math.max(0, Math.floor(baseColor[1] * shade)));
    const b = Math.min(255, Math.max(0, Math.floor(baseColor[2] * shade)));

    return [r, g, b];
  }

  // Fallback for elevation without neighbors (shouldn't happen)
  if (mode === 'elevation') {
    const height = params.height;
    const normalizedHeight = (height - 1) / 62;
    return sampleGradient(normalizedHeight, ELEVATION_GRADIENT);
  }

  // Composite mode: biome colors + hillshade + water + contours
  if (mode === 'composite') {
    const height = params.height;
    const WATER_LEVEL = 6;

    // Water override: render as water blue if below water level
    if (height < WATER_LEVEL) {
      return [30, 80, 160];
    }

    // Get biome color as base
    const biomeName = params.biome;
    const baseColor = BIOME_COLORS[biomeName] || [128, 128, 128];

    // Calculate hillshade if neighbors provided
    let shade = 1.0;
    if (neighbors) {
      shade = calculateHillshade(
        height,
        neighbors.left,
        neighbors.right,
        neighbors.up,
        neighbors.down
      );
    }

    // Apply hillshade to base color
    let r = Math.min(255, Math.max(0, Math.floor(baseColor[0] * shade)));
    let g = Math.min(255, Math.max(0, Math.floor(baseColor[1] * shade)));
    let b = Math.min(255, Math.max(0, Math.floor(baseColor[2] * shade)));

    // Add contour lines every 10 units (darken pixels where height % 10 < 0.5)
    if (height % 10 < 0.5) {
      const contourDarken = 0.7;
      r = Math.floor(r * contourDarken);
      g = Math.floor(g * contourDarken);
      b = Math.floor(b * contourDarken);
    }

    return [r, g, b];
  }

  // Standard gradient modes
  const gradient = MODE_GRADIENTS[mode];
  const paramName = MODE_PARAMS[mode];

  if (!gradient || !paramName) {
    // Fallback to grayscale if mode not recognized
    const value = params[paramName] || 0;
    const gray = Math.floor(value * 255);
    return [gray, gray, gray];
  }

  const value = params[paramName];
  return sampleGradient(value, gradient);
}
