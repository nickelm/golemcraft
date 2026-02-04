/**
 * TerrainCore - Shared pure terrain generation functions
 *
 * This module contains the core terrain generation algorithms used by both:
 * - terrainworker.js (game terrain generation)
 * - visualizer (2D terrain visualization)
 *
 * All functions are pure (no side effects) and deterministic from seed.
 * No caching is performed here - consumers should implement their own caching.
 */

import { BIOMES } from './biomesystem.js';

// ============================================================================
// NOISE FUNCTIONS
// ============================================================================

/**
 * Hash function for noise generation
 * @param {number} x - X coordinate
 * @param {number} z - Z coordinate
 * @param {number} seed - Random seed
 * @returns {number} Hash value [0, 1]
 */
export function hash(x, z, seed = 12345) {
    let h = seed + x * 374761393 + z * 668265263;
    h = (h ^ (h >> 13)) * 1274126177;
    return ((h ^ (h >> 16)) & 0xffffffff) / 0xffffffff;
}

/**
 * Alternate hash function with different mixing
 * @param {number} x - X coordinate
 * @param {number} z - Z coordinate
 * @param {number} seed - Random seed
 * @returns {number} Hash value [0, 1]
 */
export function hash2(x, z, seed = 12345) {
    let h = (seed * 7919) + x * 668265263 + z * 374761393;
    h = (h ^ (h >> 13)) * 1274126177;
    return ((h ^ (h >> 16)) & 0xffffffff) / 0xffffffff;
}

/**
 * 2D noise with bilinear interpolation
 * @param {number} x - X coordinate
 * @param {number} z - Z coordinate
 * @param {function} hashFn - Hash function to use
 * @returns {number} Noise value [0, 1]
 */
export function noise2D(x, z, hashFn = hash) {
    const X = Math.floor(x);
    const Z = Math.floor(z);
    const fx = x - X;
    const fz = z - Z;
    const u = fx * fx * (3.0 - 2.0 * fx);
    const v = fz * fz * (3.0 - 2.0 * fz);
    const a = hashFn(X, Z);
    const b = hashFn(X + 1, Z);
    const c = hashFn(X, Z + 1);
    const d = hashFn(X + 1, Z + 1);
    return a * (1 - u) * (1 - v) + b * u * (1 - v) + c * (1 - u) * v + d * u * v;
}

/**
 * Multi-octave 2D noise (fractal Brownian motion)
 * @param {number} x - X coordinate
 * @param {number} z - Z coordinate
 * @param {number} octaves - Number of octaves
 * @param {number} baseFreq - Base frequency
 * @param {function} hashFn - Hash function to use
 * @returns {number} Noise value [0, 1]
 */
export function octaveNoise2D(x, z, octaves = 4, baseFreq = 0.05, hashFn = hash) {
    let total = 0;
    let frequency = baseFreq;
    let amplitude = 1;
    let maxValue = 0;

    for (let i = 0; i < octaves; i++) {
        total += noise2D(x * frequency, z * frequency, hashFn) * amplitude;
        maxValue += amplitude;
        amplitude *= 0.5;
        frequency *= 2;
    }

    return total / maxValue;
}

// ============================================================================
// CONTINENTAL NOISE (Phase 3: Deep Oceans)
// ============================================================================

/**
 * Continental noise configuration
 * Very low frequency creates continent-scale land/ocean distribution
 */
export const CONTINENTAL_CONFIG = {
    frequency: 0.002,        // Very low freq = ~500 block wavelength
    octaves: 2,              // Smooth continental shapes
    threshold_deep: 0.22,    // Below = deep_ocean (bottomless abyss)
    threshold_land: 0.38,    // Above = land biomes; between = coastal ocean
};

/**
 * Sample continental noise at world position
 * Returns [0, 1] value indicating how "continental" (land-like) the position is
 * Low values = deep ocean, mid values = coastal ocean, high values = land
 *
 * @param {number} x - World X coordinate
 * @param {number} z - World Z coordinate
 * @param {number} seed - World seed
 * @returns {number} Continentalness value [0, 1]
 */
export function getContinentalNoise(x, z, seed = 12345) {
    // Domain warping for organic coastlines
    const warpStrength = 40;
    const warpX = octaveNoise2D(x + 1000, z, 2, 0.003, (wx, wz) => hash(wx, wz, seed)) * warpStrength;
    const warpZ = octaveNoise2D(x, z + 1000, 2, 0.003, (wx, wz) => hash(wx, wz, seed)) * warpStrength;

    const raw = octaveNoise2D(
        x + warpX,
        z + warpZ,
        CONTINENTAL_CONFIG.octaves,
        CONTINENTAL_CONFIG.frequency,
        (nx, nz) => hash(nx, nz, seed + 99999)  // Unique seed for continental noise
    );

    // Normalize from typical noise range [0.08, 0.45] to [0, 1]
    return Math.max(0, Math.min(1, (raw - 0.08) / 0.37));
}

// ============================================================================
// BIOME SELECTION
// ============================================================================

// Biomes that receive dramatic peak height variation
export const PEAK_BIOMES = ['mountains', 'glacier', 'alpine', 'badlands', 'highlands'];

/**
 * Select biome using Whittaker diagram approach
 * Uses continuous temperature and precipitation values with elevation modifiers
 *
 * @param {number} temp - Raw temperature [0, 1]
 * @param {number} precip - Precipitation/humidity [0, 1]
 * @param {number} elevation - Terrain elevation [0, 1]
 * @returns {string} Biome name
 */
export function selectBiomeFromWhittaker(temp, precip, elevation) {
    // Apply elevation cooling (one-directional, above tree line only)
    const TREE_LINE = 0.55;
    const COOLING_RATE = 0.45;

    let effectiveTemp = temp;
    if (elevation > TREE_LINE) {
        effectiveTemp = temp - (elevation - TREE_LINE) * COOLING_RATE;
    }
    effectiveTemp = Math.max(0, effectiveTemp);

    // High elevation overrides (above 0.75)
    if (elevation > 0.75) {
        if (effectiveTemp < 0.20) return 'glacier';
        if (effectiveTemp < 0.50) return 'alpine';
        return 'mountains';
    }

    // Mid-high elevation (0.60-0.75)
    if (elevation > 0.60) {
        if (effectiveTemp < 0.25) return 'glacier';
        if (effectiveTemp < 0.55) return 'alpine';
        if (precip < 0.35) return 'highlands';
        return 'mountains';
    }

    // FROZEN ZONE (effectiveTemp < 0.20)
    if (effectiveTemp < 0.20) {
        if (precip < 0.35) return 'tundra';
        return 'glacier';
    }

    // COLD ZONE (0.20-0.50)
    if (effectiveTemp < 0.50) {
        if (precip < 0.30) return 'tundra';
        if (precip < 0.65) return 'snow';
        return 'taiga';
    }

    // TEMPERATE ZONE (0.50-0.72)
    if (effectiveTemp < 0.72) {
        if (precip < 0.28) return 'meadow';
        if (precip < 0.50) return 'plains';
        if (precip < 0.68) return 'deciduous_forest';
        if (precip < 0.82) return 'autumn_forest';
        return 'swamp';
    }

    // HOT ZONE (>= 0.72)
    if (precip < 0.20) return 'desert';
    if (precip < 0.35) return 'red_desert';
    if (precip < 0.50) return 'savanna';
    if (precip < 0.70) return 'jungle';
    return elevation < 0.25 ? 'rainforest' : 'jungle';
}

/**
 * Apply sub-biome variation for natural patchiness within larger biomes
 * @param {string} baseBiome - Primary biome from Whittaker lookup
 * @param {number} x - World X coordinate
 * @param {number} z - World Z coordinate
 * @param {number} seed - World seed
 * @returns {string} Final biome (possibly a variant)
 */
export function applySubBiomeVariation(baseBiome, x, z, seed = 12345) {
    const variationNoise = octaveNoise2D(x, z, 2, 0.08, (nx, nz) => hash(nx, nz, seed + 88888));

    const SUB_BIOMES = {
        'plains': { threshold: 0.7, variant: 'meadow' },
        'deciduous_forest': { threshold: 0.75, variant: 'autumn_forest' },
        'desert': { threshold: 0.8, variant: 'red_desert' },
        'jungle': { threshold: 0.85, variant: 'rainforest' }
    };

    const subBiome = SUB_BIOMES[baseBiome];
    if (subBiome && variationNoise > subBiome.threshold) {
        return subBiome.variant;
    }
    return baseBiome;
}

// ============================================================================
// BIOME DETERMINATION
// ============================================================================

/**
 * Get biome at world position
 * @param {number} x - World X coordinate
 * @param {number} z - World Z coordinate
 * @param {number} seed - World seed
 * @returns {string} Biome name
 */
export function getBiome(x, z, seed = 12345) {
    const continentalness = getContinentalNoise(x, z, seed);

    // Deep ocean
    if (continentalness < CONTINENTAL_CONFIG.threshold_deep) {
        return 'deep_ocean';
    }

    // Coastal ocean
    if (continentalness < CONTINENTAL_CONFIG.threshold_land) {
        return 'ocean';
    }

    // Land biomes: use Whittaker climate-based selection
    const elevationNoise = octaveNoise2D(x, z, 4, 0.015, (nx, nz) => hash(nx, nz, seed));
    const tempNoise = octaveNoise2D(x, z, 4, 0.018, (nx, nz) => hash2(nx, nz, seed));
    const humidityNoise = octaveNoise2D(x, z, 3, 0.012, (nx, nz) => hash(nx, nz, seed + 77777));

    // Normalize to [0, 1]
    const elevation = Math.max(0, Math.min(1, (elevationNoise - 0.08) / 0.37));
    const temp = Math.max(0, Math.min(1, (tempNoise - 0.08) / 0.37));
    const humidity = Math.max(0, Math.min(1, (humidityNoise - 0.08) / 0.37));

    // Whittaker-based selection
    let biome = selectBiomeFromWhittaker(temp, humidity, elevation);

    // Apply sub-biome variation
    biome = applySubBiomeVariation(biome, x, z, seed);

    return biome;
}

// ============================================================================
// HEIGHT CALCULATION
// ============================================================================

/**
 * Get base height for a biome
 * @param {Object} biomeData - Biome configuration
 * @param {number} maxHeight - Maximum terrain height
 * @returns {number} Base height in blocks
 */
function getBiomeBaseHeight(biomeData, maxHeight) {
    return biomeData.baseHeightFraction !== undefined
        ? biomeData.baseHeightFraction * maxHeight
        : biomeData.baseHeight;
}

/**
 * Get height scale for a biome
 * @param {Object} biomeData - Biome configuration
 * @param {number} maxHeight - Maximum terrain height
 * @returns {number} Height scale in blocks
 */
function getBiomeHeightScale(biomeData, maxHeight) {
    return biomeData.heightScaleFraction !== undefined
        ? biomeData.heightScaleFraction * maxHeight
        : biomeData.heightScale;
}

/**
 * Calculate continuous terrain height
 * @param {number} x - World X coordinate
 * @param {number} z - World Z coordinate
 * @param {number} seed - World seed
 * @param {number} maxHeight - Maximum terrain height (default 63)
 * @returns {number} Height in blocks
 */
export function getContinuousHeight(x, z, seed = 12345, maxHeight = 63) {
    const biome = getBiome(x, z, seed);
    const biomeData = BIOMES[biome];

    // Deep ocean: bottomless abyss
    if (biome === 'deep_ocean') {
        return 0.5;
    }

    // Domain warping for organic terrain shapes
    const warpStrength = 2.5;
    const warpX = octaveNoise2D(x + 500, z, 2, 0.015, (nx, nz) => hash(nx, nz, seed)) * warpStrength;
    const warpZ = octaveNoise2D(x, z + 500, 2, 0.015, (nx, nz) => hash(nx, nz, seed)) * warpStrength;

    // Main terrain with warped coordinates
    const heightNoise = octaveNoise2D(x + warpX, z + warpZ, 5, 0.03, (nx, nz) => hash(nx, nz, seed));

    // Micro-detail for surface variation
    const microDetail = octaveNoise2D(x, z, 2, 0.12, (nx, nz) => hash2(nx, nz, seed)) * 0.25;

    let height = getBiomeBaseHeight(biomeData, maxHeight) + heightNoise * getBiomeHeightScale(biomeData, maxHeight) + microDetail;

    // Apply peak variation to high-elevation biomes
    if (PEAK_BIOMES.includes(biome)) {
        const peakNoise = octaveNoise2D(x, z, 3, 0.04, (nx, nz) => hash(nx, nz, seed));
        const peakBonus = peakNoise * 50;
        height += peakBonus;
    }

    if (biome === 'jungle') {
        const jungleHillNoise = octaveNoise2D(x, z, 4, 0.08, (nx, nz) => hash(nx, nz, seed));
        height += jungleHillNoise * 4;
    }

    const WATER_LEVEL = 6;

    // River carving
    if (biome !== 'ocean' && biome !== 'deep_ocean' && biome !== 'desert' && isRiver(x, z, seed)) {
        height = Math.min(height, WATER_LEVEL - 1);
    }

    // Lake carving
    if ((biome === 'plains' || biome === 'snow') && isLake(x, z, seed)) {
        height = Math.min(height, WATER_LEVEL - 2);
    }

    // Ocean height clamping
    if (biome === 'ocean') {
        height = Math.min(height, WATER_LEVEL - 2);
    }

    // Clamp to safe range
    return Math.max(1.0, Math.min(maxHeight, height));
}

// ============================================================================
// RIVER DETECTION (Phase 4: Basin Rivers)
// ============================================================================

/**
 * Check if position is part of a river (simplified for visualizer)
 * Uses only local noise - no expensive proximity searches
 * The game's terrainworker.js has a more sophisticated cached version
 *
 * @param {number} x - World X coordinate
 * @param {number} z - World Z coordinate
 * @param {number} seed - World seed
 * @returns {boolean}
 */
export function isRiver(x, z, seed = 12345) {
    const biome = getBiome(x, z, seed);

    // No rivers in these biomes
    if (biome === 'ocean' || biome === 'deep_ocean' ||
        biome === 'desert' || biome === 'red_desert' ||
        biome === 'glacier') {
        return false;
    }

    // No rivers on mountaintops
    const elevationNoise = octaveNoise2D(x, z, 4, 0.015, (nx, nz) => hash(nx, nz, seed));
    const elevation = Math.max(0, Math.min(1, (elevationNoise - 0.08) / 0.37));
    if (elevation > 0.55) return false;

    // River channel from noise (simplified - constant width)
    const riverNoise = octaveNoise2D(x, z, 3, 0.008, (nx, nz) => hash(nx, nz, seed + 55555));
    const isChannel = Math.abs(riverNoise - 0.5) < 0.02;  // Fixed width for visualizer

    if (!isChannel) return false;

    // Wet biomes always show rivers
    const wetBiomes = ['swamp', 'jungle', 'taiga', 'rainforest'];
    if (wetBiomes.includes(biome)) return true;

    // For other biomes, use continental noise as a proxy for "near ocean"
    // Low continentalness = closer to ocean = more likely to have rivers
    const continental = getContinentalNoise(x, z, seed);
    return continental < 0.55;  // Rivers form in coastal/mid-continental areas
}

/**
 * Check if position is a lake
 * @param {number} x - World X coordinate
 * @param {number} z - World Z coordinate
 * @param {number} seed - World seed
 * @returns {boolean}
 */
export function isLake(x, z, seed = 12345) {
    const lakeNoise = octaveNoise2D(x, z, 2, 0.02, (nx, nz) => hash(nx, nz, seed + 66666));
    return lakeNoise > 0.65;
}

// ============================================================================
// VISUALIZER API
// ============================================================================

/**
 * Get all terrain parameters at a world position
 * Used by the visualizer for rendering terrain maps
 *
 * @param {number} x - World X coordinate
 * @param {number} z - World Z coordinate
 * @param {number} seed - World seed
 * @returns {Object} Terrain parameters
 */
export function getTerrainParams(x, z, seed = 12345) {
    const maxHeight = 63;

    // Sample all noise values
    const continental = getContinentalNoise(x, z, seed);
    const tempNoise = octaveNoise2D(x, z, 4, 0.018, (nx, nz) => hash2(nx, nz, seed));
    const humidityNoise = octaveNoise2D(x, z, 3, 0.012, (nx, nz) => hash(nx, nz, seed + 77777));

    // Normalize
    const temperature = Math.max(0, Math.min(1, (tempNoise - 0.08) / 0.37));
    const humidity = Math.max(0, Math.min(1, (humidityNoise - 0.08) / 0.37));

    // Get biome and height
    const biome = getBiome(x, z, seed);
    const height = getContinuousHeight(x, z, seed, maxHeight);
    const heightNormalized = height / maxHeight;

    // River detection
    const river = isRiver(x, z, seed);

    return {
        continental,
        effectiveContinental: continental,  // No island perturbation in simplified version
        temperature,
        humidity,
        biome,
        heightNormalized,
        height: Math.floor(height),
        isRiver: river
    };
}
