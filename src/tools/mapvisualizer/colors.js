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

// Map mode names to gradients
const MODE_GRADIENTS = {
  continental: CONTINENTAL_GRADIENT,
  temperature: TEMPERATURE_GRADIENT,
  humidity: HUMIDITY_GRADIENT,
  erosion: EROSION_GRADIENT,
  ridgeness: RIDGENESS_GRADIENT
};

// Map mode names to parameter names
const MODE_PARAMS = {
  continental: 'continental',
  temperature: 'temperature',
  humidity: 'humidity',
  erosion: 'erosion',
  ridgeness: 'ridgeness'
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
 * Get RGB color for a given mode and terrain parameters
 * @param {Object} params - Terrain parameters from getTerrainParams
 * @param {string} mode - Visualization mode name
 * @returns {Array} RGB color [r, g, b] in range [0, 255]
 */
export function getColorForMode(params, mode) {
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
