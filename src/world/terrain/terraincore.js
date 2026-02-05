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

/**
 * Normalize raw octave noise to near-uniform [0, 1] distribution.
 * octaveNoise2D output clusters around [0.1-0.45] due to bilinear interpolation
 * and multi-octave averaging (central limit theorem). Two steps:
 * 1. Linear remap from practical range [0.06, 0.45] to [0, 1]
 *    (offset 0.06 centers the distribution peak at ~0.50)
 * 2. Smoothstep redistribution to push values toward extremes
 */
export function normalizeNoise(rawNoise) {
    let t = (rawNoise - 0.06) / 0.39;
    t = Math.max(0, Math.min(1, t));
    // Smoothstep: 3t^2 - 2t^3 pushes values away from center, spreading distribution
    return t * t * (3 - 2 * t);
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
    const COOLING_RATE = 0.30;  // Reduced from 0.45 to avoid pushing too many areas cold

    let effectiveTemp = temp;
    if (elevation > TREE_LINE) {
        effectiveTemp = temp - (elevation - TREE_LINE) * COOLING_RATE;
    }
    effectiveTemp = Math.max(0, effectiveTemp);

    // High elevation overrides (above 0.75)
    if (elevation > 0.75) {
        if (effectiveTemp < 0.20) return 'glacier';
        if (effectiveTemp < 0.45) return 'alpine';
        return 'mountains';
    }

    // Mid-high elevation (0.60-0.75)
    if (elevation > 0.60) {
        if (effectiveTemp < 0.25) return 'glacier';
        if (effectiveTemp < 0.50) return 'alpine';
        if (precip < 0.35) return 'highlands';
        return 'mountains';
    }

    // FROZEN ZONE (effectiveTemp < 0.12)
    if (effectiveTemp < 0.12) {
        if (precip < 0.35) return 'tundra';
        return 'glacier';
    }

    // COLD ZONE (0.12-0.35)
    if (effectiveTemp < 0.35) {
        if (precip < 0.30) return 'tundra';
        if (precip < 0.65) return 'snow';
        return 'taiga';
    }

    // TEMPERATE ZONE (0.35-0.65)
    if (effectiveTemp < 0.65) {
        if (precip < 0.25) return 'meadow';
        if (precip < 0.48) return 'plains';
        if (precip < 0.65) return 'deciduous_forest';
        if (precip < 0.80) return 'autumn_forest';
        return 'swamp';
    }

    // HOT ZONE (>= 0.65)
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

    // Normalize to [0, 1] with smoothstep redistribution
    const elevation = normalizeNoise(elevationNoise);
    const temp = normalizeNoise(tempNoise);
    const humidity = normalizeNoise(humidityNoise);

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

    // River valley carving (graduated with sloped banks, proportional depth)
    if (biome !== 'ocean' && biome !== 'deep_ocean') {
        const riverInfo = getRiverInfluence(x, z, seed);
        if (riverInfo && riverInfo.influence > 0) {
            // Carve depth proportional to height: 20% of height, min 3, max 8 blocks
            const carveDepth = Math.min(Math.max(3, height * 0.2), 8);
            const riverBed = Math.max(WATER_LEVEL - 1, height - carveDepth);
            if (height > riverBed) {
                const t = riverInfo.influence;
                const smooth = t * t * (3 - 2 * t);  // smoothstep for natural bank profile
                height = height - (height - riverBed) * smooth;
            }
        }
    }

    // Lake carving (isLake handles its own biome/elevation filtering)
    if (isLake(x, z, seed)) {
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
// RIVER DETECTION (Multi-factor river system)
// ============================================================================

/**
 * Get river influence at a position for graduated valley carving.
 * Returns null if no river influence, otherwise { isRiver, influence }.
 * influence = 1.0 at river center, smoothly falls to 0.0 at bank edge.
 *
 * Multi-factor filtering:
 * - Biome blocking (no rivers in desert, badlands, glacier, ocean)
 * - Elevation filtering (no rivers above tree line)
 * - River density noise (creates regions with/without rivers)
 * - Variable width via downstream noise (narrow upstream, wide downstream)
 * - Bank zone at 2.5x river width for graduated valley carving
 *
 * @param {number} x - World X coordinate
 * @param {number} z - World Z coordinate
 * @param {number} seed - World seed
 * @returns {{ isRiver: boolean, influence: number } | null}
 */
export function getRiverInfluence(x, z, seed = 12345) {
    const biome = getBiome(x, z, seed);

    // Blocked biomes: no rivers at all
    if (biome === 'ocean' || biome === 'deep_ocean' ||
        biome === 'desert' || biome === 'red_desert' ||
        biome === 'badlands' || biome === 'glacier') {
        return null;
    }

    // Elevation filter: allow mountain streams up to 0.70, block above
    const elevationNoise = octaveNoise2D(x, z, 4, 0.015, (nx, nz) => hash(nx, nz, seed));
    const elevation = normalizeNoise(elevationNoise);
    if (elevation > 0.70) return null;

    // River density noise: creates regions with vs without rivers
    // MUST normalize — raw octaveNoise2D clusters around [0.1-0.45]
    const wetBiomes = ['swamp', 'jungle', 'taiga', 'rainforest'];
    const isWet = wetBiomes.includes(biome);

    if (!isWet) {
        const riverDensityNoise = normalizeNoise(octaveNoise2D(x, z, 2, 0.003, (nx, nz) => hash(nx, nz, seed + 44444)));
        const reducedDensityBiomes = ['tundra', 'savanna', 'mountains', 'alpine', 'highlands'];
        const densityThreshold = reducedDensityBiomes.includes(biome) ? 0.55 : 0.45;
        if (riverDensityNoise < densityThreshold) return null;
    }

    // River channel noise (meandering isoline at 0.5)
    // MUST normalize — raw octaveNoise2D clusters around [0.1-0.45], rarely reaching 0.5
    const riverNoiseRaw = octaveNoise2D(x, z, 3, 0.008, (nx, nz) => hash(nx, nz, seed + 55555));
    const riverNoise = normalizeNoise(riverNoiseRaw);
    const distFromCenter = Math.abs(riverNoise - 0.5);

    // Downstream width variation (normalized for proper 0-1 distribution)
    const downstreamNoise = normalizeNoise(octaveNoise2D(x, z, 2, 0.002, (nx, nz) => hash(nx, nz, seed + 33333)));
    const baseWidth = 0.015 + downstreamNoise * 0.025;  // Range: 0.015 to 0.040

    // Mountain streams get narrower above tree line
    let elevationWidthFactor = 1.0;
    if (elevation > 0.55) {
        elevationWidthFactor = 1.0 - (elevation - 0.55) / 0.15;  // 1.0 at 0.55, 0.0 at 0.70
    }
    const riverWidth = baseWidth * (0.5 + 0.5 * elevationWidthFactor);  // 50-100% of base width

    // Bank zone extends to 3x river width for valley carving
    const bankWidth = riverWidth * 3.0;
    if (distFromCenter > bankWidth) return null;

    const isRiverChannel = distFromCenter < riverWidth;

    // Compute influence: 1.0 at center/channel, smoothstep falloff in bank zone
    let influence;
    if (isRiverChannel) {
        influence = 1.0;
    } else {
        const bankDist = (distFromCenter - riverWidth) / (bankWidth - riverWidth);
        const t = 1.0 - bankDist;  // 1.0 at river edge, 0.0 at bank edge
        influence = t * t * (3 - 2 * t);  // smoothstep
    }

    return { isRiver: isRiverChannel, influence };
}

/**
 * Check if position is part of a river (boolean wrapper around getRiverInfluence)
 * @param {number} x - World X coordinate
 * @param {number} z - World Z coordinate
 * @param {number} seed - World seed
 * @returns {boolean}
 */
export function isRiver(x, z, seed = 12345) {
    const info = getRiverInfluence(x, z, seed);
    return info !== null && info.isRiver;
}

/**
 * Check if position is a lake
 * Filtered by biome and elevation - no lakes on mountains or in oceans
 * @param {number} x - World X coordinate
 * @param {number} z - World Z coordinate
 * @param {number} seed - World seed
 * @returns {boolean}
 */
export function isLake(x, z, seed = 12345) {
    const biome = getBiome(x, z, seed);

    // No lakes in ocean or on high mountains
    if (biome === 'ocean' || biome === 'deep_ocean') return false;

    const elevationNoise = octaveNoise2D(x, z, 4, 0.015, (nx, nz) => hash(nx, nz, seed));
    const elevation = normalizeNoise(elevationNoise);
    if (elevation > 0.55) return false;

    // MUST normalize — raw octaveNoise2D clusters around [0.1-0.45], never reaching 0.50+
    const lakeNoiseRaw = octaveNoise2D(x, z, 2, 0.02, (nx, nz) => hash(nx, nz, seed + 66666));
    const lakeNoise = normalizeNoise(lakeNoiseRaw);

    // Swamp: more frequent lakes (~35% of swamp area)
    if (biome === 'swamp') return lakeNoise > 0.65;

    // Default: ~25% of qualifying areas
    return lakeNoise > 0.75;
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

    // Normalize with smoothstep redistribution
    const temperature = normalizeNoise(tempNoise);
    const humidity = normalizeNoise(humidityNoise);

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
