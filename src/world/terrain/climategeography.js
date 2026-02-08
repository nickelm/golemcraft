/**
 * ClimateGeography - Pure functions for continental climate modulation
 *
 * Adds spatially-varying temperature and humidity offsets using the continental
 * polar coordinate frame (r, θ). Four effects:
 *   1. Latitude effect: warm-to-cold gradient via dot product with warm direction
 *   2. Windward effect: wet-to-dry gradient via dot product with wind direction
 *   3. Coastal moderation: temperature extremes damped near coast
 *   4. Elevation drying: reduced humidity above treeline
 *
 * Composes with template offsets and clamping. All functions are pure and
 * deterministic from seed.
 */

import { hash } from './terraincore.js';

// ============================================================================
// TEMPLATE PRESETS
// ============================================================================

/**
 * Verdania: Temperate, moderate climate. Wide biome variety.
 */
const CLIMATE_VERDANIA = {
    tempOffset: 0.0,
    tempRange: [0.2, 0.8],
    humidityOffset: 0.0,
    humidityRange: [0.3, 0.7],
    latitudeStrength: 0.18,
    windwardStrength: 0.15,
    coastalModerationStrength: 0.10,
};

/**
 * Grausland: Cold Nordic climate. Heavy snow on windward coast, dry tundra in lee.
 */
const CLIMATE_GRAUSLAND = {
    tempOffset: -0.25,
    tempRange: [0.0, 0.5],
    humidityOffset: 0.1,
    humidityRange: [0.4, 0.9],
    latitudeStrength: 0.15,
    windwardStrength: 0.18,
    coastalModerationStrength: 0.08,
};

/**
 * Petermark: Hot arid/Mediterranean climate. Dry interior, warm coasts.
 */
const CLIMATE_PETERMARK = {
    tempOffset: 0.2,
    tempRange: [0.4, 1.0],
    humidityOffset: -0.2,
    humidityRange: [0.0, 0.5],
    latitudeStrength: 0.20,
    windwardStrength: 0.12,
    coastalModerationStrength: 0.12,
};

const CLIMATE_TEMPLATES = {
    verdania: CLIMATE_VERDANIA,
    grausland: CLIMATE_GRAUSLAND,
    petermark: CLIMATE_PETERMARK,
};

// ============================================================================
// PARAMETER GENERATION
// ============================================================================

/**
 * Generate climate geography parameters for a continent.
 * Deterministic from seed — same inputs always produce same climate.
 *
 * @param {number} seed - Climate seed (derived from world seed)
 * @param {number} baseRadius - Island radius in blocks
 * @param {string} template - Template name ('verdania', 'grausland', 'petermark', 'default')
 * @returns {Object} ClimateParams
 */
export function generateClimateParams(seed, baseRadius, template = 'default') {
    // Derive wind and warm angles from seed
    const windAngle = hash(0, 0, seed + 100) * Math.PI * 2;
    const warmAngle = hash(0, 0, seed + 200) * Math.PI * 2;

    // Pre-compute direction unit vectors
    const windDirX = Math.cos(windAngle);
    const windDirZ = Math.sin(windAngle);
    const warmDirX = Math.cos(warmAngle);
    const warmDirZ = Math.sin(warmAngle);

    const preset = CLIMATE_TEMPLATES[template];

    if (preset) {
        return {
            baseRadius,
            windAngle,
            warmAngle,
            windDirX, windDirZ,
            warmDirX, warmDirZ,
            tempOffset: preset.tempOffset,
            tempRange: [...preset.tempRange],
            humidityOffset: preset.humidityOffset,
            humidityRange: [...preset.humidityRange],
            latitudeStrength: preset.latitudeStrength,
            windwardStrength: preset.windwardStrength,
            coastalModerationStrength: preset.coastalModerationStrength,
        };
    }

    // Default (continent 1+): seed-derived parameters
    return {
        baseRadius,
        windAngle,
        warmAngle,
        windDirX, windDirZ,
        warmDirX, warmDirZ,
        tempOffset: (hash(1, 0, seed + 300) - 0.5) * 0.3,
        tempRange: [
            hash(2, 0, seed + 400) * 0.3,
            0.7 + hash(3, 0, seed + 500) * 0.3,
        ],
        humidityOffset: (hash(4, 0, seed + 600) - 0.5) * 0.3,
        humidityRange: [
            hash(5, 0, seed + 700) * 0.3,
            0.7 + hash(6, 0, seed + 800) * 0.3,
        ],
        latitudeStrength: 0.15 + hash(7, 0, seed + 900) * 0.10,
        windwardStrength: 0.10 + hash(8, 0, seed + 1000) * 0.10,
        coastalModerationStrength: 0.08 + hash(9, 0, seed + 1100) * 0.06,
    };
}

// ============================================================================
// PER-BLOCK EVALUATION
// ============================================================================

/**
 * Apply climate geography modulation to base temperature and humidity.
 * Pure function, O(1) per call.
 *
 * @param {number} x - World X coordinate (relative to continent center at 0,0)
 * @param {number} z - World Z coordinate
 * @param {number} baseTemp - Raw normalized temperature [0, 1]
 * @param {number} baseHumidity - Raw normalized humidity [0, 1]
 * @param {Object} params - ClimateParams from generateClimateParams()
 * @param {number} normalizedElevation - Normalized elevation noise [0, 1] (for drying effect)
 * @returns {{ temperature: number, humidity: number }}
 */
export function evaluateClimate(x, z, baseTemp, baseHumidity, params, normalizedElevation) {
    // Distance from continent center and normalized radius
    const dist = Math.sqrt(x * x + z * z);
    const rNorm = Math.min(dist / params.baseRadius, 1.0);

    // Direction from center (unit vector, zero at center)
    let dirX = 0, dirZ = 0;
    if (dist > 1) {
        dirX = x / dist;
        dirZ = z / dist;
    }

    // --- Temperature ---

    // 1. Latitude effect: dot product with warm direction [-1, 1]
    const latitudeEffect = dirX * params.warmDirX + dirZ * params.warmDirZ;

    // 2. Coastal moderation: smoothstep on inlandness
    //    At rNorm=1.0 (coast): inlandFactor=0 → full coastal moderation
    //    At rNorm=0.6 (inland): inlandFactor=1 → no moderation
    const inlandness = 1.0 - rNorm;
    const coastalRaw = inlandness / 0.4;
    const coastalT = Math.max(0, Math.min(1, coastalRaw));
    const inlandFactor = coastalT * coastalT * (3 - 2 * coastalT); // smoothstep

    // Climate target: template median shifted by latitude and coastal effects
    const tempMedian = (params.tempRange[0] + params.tempRange[1]) / 2;
    const tempTarget = tempMedian
        + latitudeEffect * params.latitudeStrength
        + (tempMedian - (baseTemp + params.tempOffset)) * params.coastalModerationStrength * (1.0 - inlandFactor);

    // Blend: climate target dominates (60%), noise provides local variation (40%)
    const CLIMATE_BLEND = 0.6;
    let effectiveTemp = baseTemp * (1 - CLIMATE_BLEND) + tempTarget * CLIMATE_BLEND
        + params.tempOffset * (1 - CLIMATE_BLEND);

    // Clamp to template range
    effectiveTemp = Math.max(params.tempRange[0], Math.min(params.tempRange[1], effectiveTemp));

    // --- Humidity ---

    // 3. Windward effect: dot product with wind direction [-1, 1]
    const windwardEffect = dirX * params.windDirX + dirZ * params.windDirZ;

    // 4. Elevation drying: smoothstep(0.4, 0.8, elevation) * -0.2
    const elevDryRaw = (normalizedElevation - 0.4) / 0.4;
    const elevDryT = Math.max(0, Math.min(1, elevDryRaw));
    const elevationDrying = elevDryT * elevDryT * (3 - 2 * elevDryT) * -0.2;

    // Humidity target: template median shifted by wind and elevation
    const humidMedian = (params.humidityRange[0] + params.humidityRange[1]) / 2;
    const humidTarget = humidMedian
        + windwardEffect * params.windwardStrength
        + elevationDrying;

    // Blend: climate target dominates, noise provides local variation
    let effectiveHumidity = baseHumidity * (1 - CLIMATE_BLEND) + humidTarget * CLIMATE_BLEND
        + params.humidityOffset * (1 - CLIMATE_BLEND);

    // Clamp to template range
    effectiveHumidity = Math.max(params.humidityRange[0], Math.min(params.humidityRange[1], effectiveHumidity));

    return { temperature: effectiveTemp, humidity: effectiveHumidity };
}
