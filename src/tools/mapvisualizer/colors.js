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

const ELEVATION_GRADIENT = [
  { value: 0.00, color: [15, 30, 80] },       // Deep ocean floor
  { value: 0.02, color: [20, 50, 120] },      // Deep ocean
  { value: 0.08, color: [40, 80, 160] },      // Shallow ocean
  { value: 0.10, color: [60, 100, 180] },     // Sea level (exact)
  { value: 0.12, color: [240, 220, 130] },    // Beach/shore
  { value: 0.20, color: [80, 160, 60] },      // Lowland (green)
  { value: 0.35, color: [60, 140, 50] },      // Midland (darker green)
  { value: 0.50, color: [140, 130, 80] },     // Highland (brown-green)
  { value: 0.65, color: [160, 140, 100] },    // Highland (brown)
  { value: 0.80, color: [140, 140, 140] },    // Mountain (gray)
  { value: 0.90, color: [180, 180, 180] },    // High mountain
  { value: 1.00, color: [255, 255, 255] },    // Peak (white)
];

// Biome colors - discrete mapping for biome visualization
const BIOME_COLORS = {
  // Water biomes
  ocean: [15, 40, 100],           // Deep ocean - very dark blue
  shallow_ocean: [50, 100, 180],  // Shallow ocean - medium blue
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

// Composite mode colors - for gameplay-accurate visualization
const COMPOSITE_COLORS = {
    deepOcean: [15, 30, 80],        // Very dark blue (impassable)
    shallowOcean: [40, 80, 160],    // Medium blue
    coastalWater: [60, 120, 180],   // Lighter blue near shore
    beach: [238, 214, 175],         // Sandy tan
    snowPeak: [250, 250, 255],      // White with slight blue
    mountains: [140, 140, 140],     // Gray
    river: [64, 128, 192],          // River blue (basin rivers from Phase 4)
};

// Map mode names to gradients
const MODE_GRADIENTS = {
  continental: CONTINENTAL_GRADIENT,
  effectiveContinental: CONTINENTAL_GRADIENT,  // Island-perturbed continentalness
  temperature: TEMPERATURE_GRADIENT,
  humidity: HUMIDITY_GRADIENT,
  elevation: ELEVATION_GRADIENT
};

// Map mode names to parameter names
const MODE_PARAMS = {
  continental: 'continental',
  effectiveContinental: 'effectiveContinental',  // Shows island perturbation effect
  temperature: 'temperature',
  humidity: 'humidity',
  elevation: 'heightNormalized'  // Use normalized [0, 1] for gradient sampling
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
 * Linear interpolation between two RGB colors
 * @param {Array} color1 - First color [r, g, b]
 * @param {Array} color2 - Second color [r, g, b]
 * @param {number} t - Interpolation factor [0, 1]
 * @returns {Array} Interpolated color [r, g, b]
 */
function lerpColor(color1, color2, t) {
  return [
    Math.floor(color1[0] + (color2[0] - color1[0]) * t),
    Math.floor(color1[1] + (color2[1] - color1[1]) * t),
    Math.floor(color1[2] + (color2[2] - color1[2]) * t)
  ];
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
  // Elevation mode shows raw height data - color is purely based on heightNormalized
  // (waterType is NOT used here; that's for composite mode which shows gameplay view)
  if (mode === 'elevation' && neighbors) {
    const height = params.height;  // World-scaled for hillshade
    const normalizedHeight = params.heightNormalized;  // Use normalized [0, 1] for color
    const baseColor = sampleGradient(normalizedHeight, ELEVATION_GRADIENT);

    const shade = calculateHillshade(
      height,
      neighbors.left,
      neighbors.right,
      neighbors.up,
      neighbors.down
    );

    const r = Math.min(255, Math.max(0, Math.floor(baseColor[0] * shade)));
    const g = Math.min(255, Math.max(0, Math.floor(baseColor[1] * shade)));
    const b = Math.min(255, Math.max(0, Math.floor(baseColor[2] * shade)));

    return [r, g, b];
  }

  // Fallback for elevation without neighbors (shouldn't happen)
  if (mode === 'elevation') {
    return sampleGradient(params.heightNormalized, ELEVATION_GRADIENT);
  }

  // Composite mode: height-based water detection + biome colors with elevation overrides + hillshade
  if (mode === 'composite') {
    const height = params.height;
    const heightNormalized = params.heightNormalized;
    const continentalness = params.effectiveContinental;

    // LAYER 1: Deep ocean (impassable) - overrides everything
    // Use both continentalness and height to catch all deep ocean
    if (continentalness < 0.08 || heightNormalized < 0.02) {
      return [...COMPOSITE_COLORS.deepOcean];
    }

    // LAYER 2: Shallow ocean (underwater) - below sea level (0.10)
    if (heightNormalized < 0.10) {
      // Blend based on depth - deeper = darker
      const depthFactor = heightNormalized / 0.10;
      return lerpColor(COMPOSITE_COLORS.shallowOcean, COMPOSITE_COLORS.coastalWater, depthFactor);
    }

    // LAYER 3: Rivers - check for basin rivers (Phase 4)
    if (params.isRiver) {
      return [...COMPOSITE_COLORS.river];
    }

    // LAYER 4: Land - determine biome with elevation overrides
    let biome = params.biome;

    // Beach override: near sea level AND near coast
    if (heightNormalized < 0.15 && heightNormalized >= 0.10 && continentalness < 0.35) {
      biome = 'beach';
    }

    // Mountain override: high elevation
    if (heightNormalized > 0.70) {
      biome = 'mountains';
    }

    // Snow peak override: very high elevation
    if (heightNormalized > 0.85) {
      biome = 'snow';
    }

    // LAYER 5: Get biome base color
    const baseColor = BIOME_COLORS[biome] || [128, 128, 128];

    // LAYER 6: Apply hillshade
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

    const r = Math.min(255, Math.max(0, Math.floor(baseColor[0] * shade)));
    const g = Math.min(255, Math.max(0, Math.floor(baseColor[1] * shade)));
    const b = Math.min(255, Math.max(0, Math.floor(baseColor[2] * shade)));

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
