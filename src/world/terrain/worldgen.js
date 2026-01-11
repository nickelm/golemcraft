/**
 * World Generation - Single source of truth for terrain sampling
 *
 * Pure functions for sampling terrain parameters at any world position.
 * Used by both terrainworker.js (3D generation) and map visualizer (2D).
 *
 * All noise functions use deterministic seeds derived from world seed.
 * Parameters are independent and can be sampled separately or together.
 */

import { hash, octaveNoise2D, ridgedNoise2D, warpedNoise2D } from '../../utils/math/noise.js';
import { DEFAULT_TEMPLATE, getTemplateModifiers } from './templates.js';
import { getBiomeConfig } from './biomesystem.js';
import { LinearFeatureIndex } from '../features/linearfeature.js';

/**
 * Ocean threshold constants based on continentalness
 * Used to distinguish deep ocean, shallow ocean, and land
 */
export const OCEAN_THRESHOLDS = {
    deep: 0.10,      // continentalness below this = deep ocean
    shallow: 0.25,   // continentalness below this = shallow ocean
    land: 0.25,      // continentalness above this = land
};

/**
 * Height configuration for relative terrain scaling
 * All heights defined as fractions [0, 1] for easy scaling to any max height
 */
export const HEIGHT_CONFIG = {
    maxHeight: 63,  // Current max, can be changed to 127, 255, etc.

    // Height bands as fractions of maxHeight
    bands: {
        deepOceanFloor: 0.00,    // 0% - bottom of world
        shallowOceanFloor: 0.02, // 2% - shallow ocean has visible floor
        seaLevel: 0.10,          // 10% - water surface
        lowland: 0.25,           // 25% - plains, beaches
        midland: 0.45,           // 45% - forests, hills
        highland: 0.65,          // 65% - foothills
        mountain: 0.85,          // 85% - mountain slopes
        peak: 1.00,              // 100% - highest peaks
    },

    /**
     * Convert a fraction to world units
     * @param {number} fraction - Height as fraction [0, 1]
     * @returns {number} Height in world units (blocks)
     */
    toWorld(fraction) {
        return Math.round(fraction * this.maxHeight);
    },

    /**
     * Get sea level in world units
     * @returns {number} Sea level height in blocks
     */
    get seaLevelWorld() {
        return this.toWorld(this.bands.seaLevel);
    }
};

// =============================================================================
// River Carving System
// =============================================================================

/**
 * Module-level river spatial index for efficient carving queries
 * Built once when world data is available, used by getHeightAtNormalized
 */
let _riverIndex = null;

/**
 * Build the river spatial index from generated river data
 * Must be called before terrain generation to enable river carving
 *
 * @param {Array<LinearFeature>} rivers - Array of river features from WorldGenerator
 * @returns {LinearFeatureIndex} The built index
 */
export function buildRiverIndex(rivers) {
    _riverIndex = new LinearFeatureIndex(128);
    for (const river of rivers) {
        _riverIndex.add(river);
    }
    console.log(`River index built: ${rivers.length} rivers indexed`);
    return _riverIndex;
}

/**
 * Clear the river index (for cleanup or reinitialization)
 */
export function clearRiverIndex() {
    _riverIndex = null;
}

/**
 * Get river influence at a world position
 * @param {number} x - World X coordinate
 * @param {number} z - World Z coordinate
 * @returns {Object|null} River influence data or null if not near a river
 */
function getRiverInfluenceAt(x, z) {
    if (!_riverIndex) return null;

    const result = _riverIndex.getInfluenceAt(x, z);
    if (!result) return null;

    return result.influence;
}

/**
 * Flag to skip river carving - used during river generation to avoid feedback loop
 * @private
 */
let _skipRiverCarving = false;

/**
 * Get height for river generation (without river carving applied)
 * This prevents feedback loops during river tracing
 *
 * @param {number} x - World X coordinate
 * @param {number} z - World Z coordinate
 * @param {number} seed - World seed
 * @param {Object} template - Continent template
 * @returns {number} Normalized height [0, 1] without river carving
 */
export function getHeightForRiverGen(x, z, seed, template) {
    _skipRiverCarving = true;
    const height = getHeightAtNormalized(x, z, seed, template);
    _skipRiverCarving = false;
    return height;
}

/**
 * Apply river carving to terrain height
 * Creates V-shaped valley profile with depth based on river width
 *
 * @param {number} baseHeight - Original normalized height [0, 1]
 * @param {Object} riverInfluence - Influence data from getRiverInfluenceAt
 * @returns {number} Carved normalized height [0, 1]
 */
function applyRiverCarving(baseHeight, riverInfluence) {
    const { width, centerDistance, influence } = riverInfluence;

    // River bed height (slightly below sea level for water fill)
    const riverBed = HEIGHT_CONFIG.bands.seaLevel - 0.02;  // ~0.08 normalized

    // Profile: V-shape using centerDistance
    // centerDistance: 0 = center, 1 = edge
    const carveProfile = Math.max(0, 1 - centerDistance);

    // Smooth the profile edges (inline smoothstep)
    const smoothedProfile = carveProfile * carveProfile * (3 - 2 * carveProfile);

    // Calculate carved height
    // Blend toward riverBed based on profile and influence
    const carveStrength = smoothedProfile * influence * 0.8;
    const carvedHeight = baseHeight + (riverBed - baseHeight) * carveStrength;

    // Never carve below river bed
    return Math.max(riverBed, carvedHeight);
}

/**
 * Biome height bands - defines the normalized height range [0, 1] for each biome
 * These determine where terrain heights fall in world space:
 * - Ocean areas: 0.00 - 0.10 (deep to shallow)
 * - Lowlands: 0.10 - 0.30
 * - Midlands: 0.30 - 0.55
 * - Highlands: 0.55 - 0.75
 * - Mountains: 0.75 - 1.00
 */
export const BIOME_HEIGHT_BANDS = {
    // Water biomes (below sea level)
    ocean: { min: 0.02, max: 0.08 },
    beach: { min: 0.10, max: 0.18 },

    // Lowland biomes
    plains: { min: 0.12, max: 0.35 },
    meadow: { min: 0.11, max: 0.28 },
    savanna: { min: 0.12, max: 0.32 },
    swamp: { min: 0.10, max: 0.22 },
    desert: { min: 0.11, max: 0.30 },
    tundra: { min: 0.12, max: 0.28 },

    // Midland biomes
    red_desert: { min: 0.15, max: 0.42 },
    taiga: { min: 0.15, max: 0.40 },
    jungle: { min: 0.18, max: 0.48 },
    rainforest: { min: 0.20, max: 0.52 },
    autumn_forest: { min: 0.18, max: 0.42 },
    deciduous_forest: { min: 0.22, max: 0.55 },
    snow: { min: 0.15, max: 0.38 },

    // Highland biomes
    badlands: { min: 0.25, max: 0.65 },
    highlands: { min: 0.30, max: 0.68 },
    volcanic: { min: 0.28, max: 0.72 },

    // Mountain biomes (reaching peaks)
    alpine: { min: 0.45, max: 0.88 },
    glacier: { min: 0.40, max: 0.85 },
    mountains: { min: 0.50, max: 1.00 },
};

/**
 * Get sea level in world units
 * @returns {number} Sea level height in blocks
 */
export function getSeaLevel() {
    return HEIGHT_CONFIG.seaLevelWorld;
}

/**
 * Get water type at world position based on coast proximity gradient
 * Uses gradient-based classification:
 * - Near coast (high gradient) → shallow water
 * - Far from coast (low gradient) → deep water
 *
 * @param {number} x - World X coordinate
 * @param {number} z - World Z coordinate
 * @param {number} seed - World seed
 * @param {Object} template - Continent template (optional, defaults to DEFAULT_TEMPLATE)
 * @returns {string} Water type: 'deep', 'shallow', or 'none'
 */
export function getWaterType(x, z, seed, template = DEFAULT_TEMPLATE) {
    const continental = getEffectiveContinentalness(x, z, seed, template);

    // Land
    if (continental >= OCEAN_THRESHOLDS.shallow) {
        return 'none';
    }

    // Use coast proximity for deep/shallow classification
    const coastProximity = getCoastProximity(x, z, seed, template);

    // High proximity = shallow, low proximity = deep
    // Add noise for organic boundary between shallow/deep
    const boundaryNoiseSeed = deriveSeed(seed, 'deep_boundary');
    const boundaryHash = (x, z) => hash(x, z, boundaryNoiseSeed);
    const boundaryNoise = octaveNoise2D(x, z, 2, 0.008, boundaryHash) * 0.1;
    const shallowThreshold = 0.3 + boundaryNoise;  // ~30% gradient = shallow

    return coastProximity > shallowThreshold ? 'shallow' : 'deep';
}

/**
 * Get ocean depth at world position
 * Uses gradient-based coast proximity to determine depth:
 * - Near coast (high gradient) → shallow water
 * - Far from coast (low gradient) → deep water
 *
 * @param {number} x - World X coordinate
 * @param {number} z - World Z coordinate
 * @param {number} seed - World seed
 * @param {Object} template - Continent template (optional, defaults to DEFAULT_TEMPLATE)
 * @returns {number|null} Ocean floor height in blocks, or null if on land
 *   - Near coast: close to sea level
 *   - Far from coast: near floor
 *   - Land: null
 */
export function getOceanDepth(x, z, seed, template = DEFAULT_TEMPLATE) {
    const continental = getEffectiveContinentalness(x, z, seed, template);

    // Land - no ocean depth
    if (continental >= OCEAN_THRESHOLDS.shallow) {
        return null;
    }

    // Use gradient to determine coast proximity
    const coastProximity = getCoastProximity(x, z, seed, template);

    const shallowOceanFloor = HEIGHT_CONFIG.toWorld(HEIGHT_CONFIG.bands.shallowOceanFloor);
    const seaLevel = HEIGHT_CONFIG.seaLevelWorld;
    const deepFloor = HEIGHT_CONFIG.toWorld(0.01);

    // Blend based on coast proximity:
    // High proximity (near coast) → shallower (closer to sea level)
    // Low proximity (far from coast) → deeper (closer to floor)
    const depth = deepFloor + coastProximity * (seaLevel - deepFloor);

    return Math.max(deepFloor, Math.min(seaLevel, depth));
}

/**
 * World generation parameters
 * Configuration for all terrain noise layers
 */
export const WORLD_PARAMS = {
    continental: {
        frequency: 0.002,    // Large-scale land/ocean distribution
        octaves: 4,
        warpStrength: 30     // Creates organic coastlines
    },
    temperature: {
        frequency: 0.0015,   // Large climate zones (~666 block wavelength for continent-scale biomes)
        octaves: 2           // Fewer octaves = smoother, less fragmented biomes
    },
    humidity: {
        frequency: 0.0012,   // Precipitation patterns (~833 block wavelength)
        octaves: 2           // Fewer octaves for smoother moisture regions
    },
    erosion: {
        frequency: 0.015,    // Local valleys and erosion detail
        octaves: 2
    },
    ridgeness: {
        frequency: 0.012,    // Mountain ridge generation
        octaves: 4,
        persistence: 0.5,
        lacunarity: 2.0      // Standard fractal parameters
    }
};

/**
 * Derive an independent seed from world seed and string salt
 * @param {number} worldSeed - Base world seed
 * @param {string} salt - String identifier for parameter (e.g., 'continentalness')
 * @returns {number} Derived seed unique to this parameter
 */
export function deriveSeed(worldSeed, salt) {
    // Simple string hash (deterministic across runs)
    let saltHash = 0;
    for (let i = 0; i < salt.length; i++) {
        saltHash = ((saltHash << 5) - saltHash) + salt.charCodeAt(i);
        saltHash = saltHash & saltHash;  // Convert to 32-bit int
    }
    return worldSeed + saltHash;
}

/**
 * Sample continentalness at world position
 * Determines land vs ocean distribution using domain warping for organic coastlines.
 *
 * @param {number} x - World X coordinate
 * @param {number} z - World Z coordinate
 * @param {number} seed - World seed
 * @param {Object} template - Continent template (optional, defaults to DEFAULT_TEMPLATE)
 * @returns {number} Continentalness [0, 1]:
 *   0.0-0.2: Deep ocean
 *   0.2-0.4: Shallow ocean / coast
 *   0.4-0.6: Lowlands
 *   0.6-0.8: Midlands
 *   0.8-1.0: Highlands / continental interior
 */
export function sampleContinentalness(x, z, seed, template = DEFAULT_TEMPLATE) {
    const derivedSeed = deriveSeed(seed, 'continentalness');
    const boundHash = (x, z) => hash(x, z, derivedSeed);

    // Get base continentalness from noise
    const base = warpedNoise2D(
        x, z,
        WORLD_PARAMS.continental.octaves,
        WORLD_PARAMS.continental.frequency,
        WORLD_PARAMS.continental.warpStrength,
        boundHash
    );

    // Apply template modifiers (bay carving, radial falloff)
    const modifiers = getTemplateModifiers(x, z, template);
    return base * modifiers.continentalnessMultiplier;
}

/**
 * Sample island noise at world position
 * Higher frequency than continental noise to create small island features.
 *
 * @param {number} x - World X coordinate
 * @param {number} z - World Z coordinate
 * @param {number} seed - World seed
 * @returns {number} Island noise [0, 1]
 */
export function getIslandNoise(x, z, seed) {
    const derivedSeed = deriveSeed(seed, 'islands');
    const boundHash = (x, z) => hash(x, z, derivedSeed);

    // Higher frequency than continental noise - creates small island features
    return octaveNoise2D(x, z, 3, 0.015, boundHash);
}

/**
 * Estimate distance to coastline using continentalness gradient
 * High gradient = near coast (continentalness changes rapidly)
 * Low gradient = far from coast (uniform deep ocean or inland)
 *
 * @param {number} x - World X coordinate
 * @param {number} z - World Z coordinate
 * @param {number} seed - World seed
 * @param {Object} template - Continent template
 * @returns {number} Coast proximity [0, 1]:
 *   1 = very close to coast (high gradient)
 *   0 = far from coast (low gradient)
 */
export function getCoastProximity(x, z, seed, template = DEFAULT_TEMPLATE) {
    const sampleDistance = 16;  // Distance to sample for gradient (in blocks)

    // Sample continentalness at neighboring points
    const cLeft = getEffectiveContinentalness(x - sampleDistance, z, seed, template);
    const cRight = getEffectiveContinentalness(x + sampleDistance, z, seed, template);
    const cUp = getEffectiveContinentalness(x, z - sampleDistance, seed, template);
    const cDown = getEffectiveContinentalness(x, z + sampleDistance, seed, template);

    // Calculate gradient magnitude using central differences
    const dx = (cRight - cLeft) / (2 * sampleDistance);
    const dz = (cDown - cUp) / (2 * sampleDistance);
    const gradientMagnitude = Math.sqrt(dx * dx + dz * dz);

    // Normalize gradient to [0, 1]
    // Typical gradient near coast is ~0.01-0.02, deep ocean is ~0.001
    const normalizedGradient = Math.min(1, gradientMagnitude * 100);

    return normalizedGradient;
}

/**
 * Get effective continentalness with island perturbation
 * Modifies the base continentalness in shallow ocean areas to create islands,
 * irregular coastlines, and lagoons.
 *
 * @param {number} x - World X coordinate
 * @param {number} z - World Z coordinate
 * @param {number} seed - World seed
 * @param {Object} template - Continent template (optional, defaults to DEFAULT_TEMPLATE)
 * @returns {number} Effective continentalness [0, 1] with island perturbations
 */
export function getEffectiveContinentalness(x, z, seed, template = DEFAULT_TEMPLATE) {
    const base = sampleContinentalness(x, z, seed, template);

    // Only perturb in the shallow ocean band (potential island zone)
    // Zone extends from just above deep ocean to slightly above land threshold
    // This creates: islands in shallow water, irregular coastlines, lagoons in land
    if (base > 0.12 && base < 0.35) {
        const islandNoise = getIslandNoise(x, z, seed);
        // Add island bumps - can push shallow ocean above land threshold
        const perturbation = (islandNoise - 0.5) * 0.15;
        return base + perturbation;
    }

    return base;
}

/**
 * Sample temperature at world position
 * Creates latitudinal temperature bands with variation.
 *
 * @param {number} x - World X coordinate
 * @param {number} z - World Z coordinate
 * @param {number} seed - World seed
 * @param {Object} template - Continent template (optional, not used for temperature)
 * @returns {number} Temperature [0, 1]:
 *   0.0-0.3: Cold (arctic/alpine)
 *   0.3-0.7: Temperate
 *   0.7-1.0: Hot (tropical/desert)
 */
export function sampleTemperature(x, z, seed, template = DEFAULT_TEMPLATE) {
    const derivedSeed = deriveSeed(seed, 'temperature');
    const boundHash = (x, z) => hash(x, z, derivedSeed);

    // Templates don't modify temperature (climate is independent of continent shape)
    const raw = octaveNoise2D(
        x, z,
        WORLD_PARAMS.temperature.octaves,
        WORLD_PARAMS.temperature.frequency,
        boundHash
    );

    // Normalize hash-based noise from [0.08, 0.45] to [0, 1]
    return Math.max(0, Math.min(1, (raw - 0.08) / 0.37));
}

/**
 * Sample humidity at world position
 * Determines precipitation and moisture patterns.
 *
 * @param {number} x - World X coordinate
 * @param {number} z - World Z coordinate
 * @param {number} seed - World seed
 * @param {Object} template - Continent template (optional, not used for humidity)
 * @returns {number} Humidity [0, 1]:
 *   0.0-0.3: Arid (desert/badlands)
 *   0.3-0.7: Moderate
 *   0.7-1.0: Humid (rainforest/swamp)
 */
export function sampleHumidity(x, z, seed, template = DEFAULT_TEMPLATE) {
    const derivedSeed = deriveSeed(seed, 'humidity');
    const boundHash = (x, z) => hash(x, z, derivedSeed);

    // Templates don't modify humidity (climate is independent of continent shape)
    const raw = octaveNoise2D(
        x, z,
        WORLD_PARAMS.humidity.octaves,
        WORLD_PARAMS.humidity.frequency,
        boundHash
    );

    // Normalize hash-based noise from [0.08, 0.45] to [0, 1]
    return Math.max(0, Math.min(1, (raw - 0.08) / 0.37));
}

/**
 * Sample erosion at world position
 * Adds local detail for valleys, erosion patterns, and terrain roughness.
 *
 * @param {number} x - World X coordinate
 * @param {number} z - World Z coordinate
 * @param {number} seed - World seed
 * @param {Object} template - Continent template (optional, defaults to DEFAULT_TEMPLATE)
 * @returns {number} Erosion [0, 1]:
 *   0.0: Heavily eroded (valleys, riverbeds)
 *   0.5: Moderate erosion
 *   1.0: Uneroded (peaks, plateaus)
 */
export function sampleErosion(x, z, seed, template = DEFAULT_TEMPLATE) {
    const derivedSeed = deriveSeed(seed, 'erosion');
    const boundHash = (x, z) => hash(x, z, derivedSeed);

    // Get base erosion from noise
    const base = octaveNoise2D(
        x, z,
        WORLD_PARAMS.erosion.octaves,
        WORLD_PARAMS.erosion.frequency,
        boundHash
    );

    // Apply template modifiers (flattening effect)
    const modifiers = getTemplateModifiers(x, z, template);
    return base * modifiers.elevationMultiplier;
}

/**
 * Sample ridgeness at world position
 * Creates mountain ridges and valleys using ridged multifractal noise.
 *
 * @param {number} x - World X coordinate
 * @param {number} z - World Z coordinate
 * @param {number} seed - World seed
 * @param {Object} template - Continent template (optional, not used directly - see sampleMountainHeight)
 * @returns {number} Ridgeness [0, 1]:
 *   0.0: Valley / flat terrain
 *   0.5: Slopes
 *   1.0: Sharp ridges / peaks
 */
export function sampleRidgeness(x, z, seed, template = DEFAULT_TEMPLATE) {
    const derivedSeed = deriveSeed(seed, 'ridgeness');
    const boundHash = (x, z) => hash(x, z, derivedSeed);

    // Templates don't modify ridgeness directly (see sampleMountainHeight for template effects)
    return ridgedNoise2D(
        x, z,
        WORLD_PARAMS.ridgeness.octaves,
        WORLD_PARAMS.ridgeness.frequency,
        WORLD_PARAMS.ridgeness.persistence,
        WORLD_PARAMS.ridgeness.lacunarity,
        boundHash
    );
}

/**
 * Sample mountain height contribution from templates
 * Provides additional height from mountain spines and boosted regions.
 *
 * @param {number} x - World X coordinate
 * @param {number} z - World Z coordinate
 * @param {number} seed - World seed
 * @param {Object} template - Continent template (optional, defaults to DEFAULT_TEMPLATE)
 * @returns {number} Mountain height multiplier [0, 1]:
 *   Returns ridgeness weighted by template's mountainBoost and ridgeWeight.
 *   Multiply by scale factor (e.g., 50) when applying to terrain height.
 */
export function sampleMountainHeight(x, z, seed, template = DEFAULT_TEMPLATE) {
    // Get template modifiers
    const modifiers = getTemplateModifiers(x, z, template);

    // Get ridge noise
    const ridge = sampleRidgeness(x, z, seed, template);

    // Return weighted ridge contribution
    return ridge * modifiers.ridgeWeight * modifiers.mountainBoost;
}

/**
 * Select biome from climate parameters using 3x3 climate matrix
 *
 * @param {string} temp - Temperature band: 'cold', 'temperate', or 'hot'
 * @param {string} humidity - Humidity band: 'dry', 'moderate', or 'wet'
 * @param {string} elev - Elevation band: 'low', 'mid', or 'high'
 * @returns {string} Biome name
 */
function selectBiomeFromClimate(temp, humidity, elev) {
    // HOT CLIMATES
    if (temp === 'hot') {
        if (humidity === 'dry') {
            if (elev === 'low') return 'desert';
            if (elev === 'mid') return 'red_desert';
            return 'badlands';  // high
        }
        if (humidity === 'moderate') {
            if (elev === 'low' || elev === 'mid') return 'savanna';
            return 'badlands';  // high
        }
        // wet
        if (elev === 'low') return 'jungle';  // Will be replaced by beach near ocean
        if (elev === 'mid') return 'jungle';
        return 'jungle';  // high
    }

    // TEMPERATE CLIMATES
    if (temp === 'temperate') {
        if (humidity === 'dry') {
            if (elev === 'low') return 'meadow';
            if (elev === 'mid') return 'plains';
            return 'mountains';  // high
        }
        if (humidity === 'moderate') {
            if (elev === 'low') return 'meadow';
            if (elev === 'mid') return 'deciduous_forest';
            return 'mountains';  // high
        }
        // wet
        if (elev === 'low') return 'swamp';
        if (elev === 'mid') return 'autumn_forest';
        return 'deciduous_forest';  // high
    }

    // COLD CLIMATES
    if (temp === 'cold') {
        if (humidity === 'dry') {
            if (elev === 'low' || elev === 'mid') return 'tundra';
            return 'mountains';  // high
        }
        if (humidity === 'moderate') {
            if (elev === 'low') return 'glacier';
            if (elev === 'mid') return 'taiga';
            return 'glacier';  // high
        }
        // wet
        if (elev === 'low') return 'glacier';
        if (elev === 'mid') return 'taiga';
        return 'glacier';  // high
    }

    return 'plains';  // Fallback
}

/**
 * Determine biome at world position using climate classification
 *
 * @param {number} x - World X coordinate
 * @param {number} z - World Z coordinate
 * @param {number} seed - World seed
 * @param {Object} template - Continent template (optional, defaults to DEFAULT_TEMPLATE)
 * @returns {string} Biome name (e.g., 'plains', 'ocean', 'mountains')
 */
export function getBiomeAt(x, z, seed, template = DEFAULT_TEMPLATE) {
    // Use effective continentalness (with island perturbation) for land/ocean determination
    const continental = getEffectiveContinentalness(x, z, seed, template);
    const temperature = sampleTemperature(x, z, seed, template);
    const humidity = sampleHumidity(x, z, seed, template);

    // Ocean check (below 15% continentalness threshold)
    // Island perturbation can push shallow ocean above this threshold (creating islands)
    // or push land below it (creating lagoons)
    if (continental < 0.15) {
        return 'ocean';
    }

    // Classify into climate bands
    const tempBand = temperature < 0.33 ? 'cold' : (temperature < 0.66 ? 'temperate' : 'hot');
    const humidityBand = humidity < 0.33 ? 'dry' : (humidity < 0.66 ? 'moderate' : 'wet');

    // Elevation band from effective continentalness
    // Island perturbation affects elevation (islands tend to be low elevation)
    const elevBand = continental < 0.3 ? 'low' : (continental < 0.6 ? 'mid' : 'high');

    // Use climate matrix for biome lookup
    return selectBiomeFromClimate(tempBand, humidityBand, elevBand);
}

/**
 * Linear interpolation helper
 * @param {number} a - Start value
 * @param {number} b - End value
 * @param {number} t - Interpolation factor [0, 1]
 * @returns {number} Interpolated value
 */
function lerp(a, b, t) {
    return a + (b - a) * t;
}

/**
 * Sample base terrain noise at world position
 * Returns normalized height in [0, 1] range
 *
 * @param {number} x - World X coordinate
 * @param {number} z - World Z coordinate
 * @param {number} seed - World seed
 * @returns {number} Base terrain noise [0, 1]
 */
function getBaseTerrainNoise(x, z, seed) {
    // Domain warping for organic terrain
    const warpSeed = deriveSeed(seed, 'warp');
    const warpHash = (x, z) => hash(x, z, warpSeed);
    const warpStrength = 2.5;
    const warpX = octaveNoise2D(x + 500, z, 2, 0.015, warpHash) * warpStrength;
    const warpZ = octaveNoise2D(x, z + 500, 2, 0.015, warpHash) * warpStrength;

    // Main height noise with warping
    const heightNoiseSeed = deriveSeed(seed, 'height');
    const heightHash = (x, z) => hash(x, z, heightNoiseSeed);
    const heightNoise = octaveNoise2D(x + warpX, z + warpZ, 5, 0.03, heightHash);

    // Micro-detail noise for local variation
    const detailSeed = deriveSeed(seed, 'detail');
    const detailHash = (x, z) => hash(x, z, detailSeed);
    const microDetail = octaveNoise2D(x, z, 2, 0.12, detailHash) * 0.15;

    // Combine and normalize to [0, 1]
    // octaveNoise2D returns roughly [0.08, 0.45], normalize this range
    const combined = (heightNoise - 0.08) / 0.37 + microDetail;
    return Math.max(0, Math.min(1, combined));
}

/**
 * Calculate inland distance factor for elevation gradient
 * Creates higher elevation in continental interiors, lower near coasts
 * This is critical for river flow - rivers need consistent downhill to ocean
 *
 * @param {number} x - World X coordinate
 * @param {number} z - World Z coordinate
 * @param {number} seed - World seed
 * @param {Object} template - Continent template
 * @returns {number} Inland factor [0, 1]: 0 = at coast, 1 = deep inland
 */
function getInlandFactor(x, z, seed, template) {
    // Sample continentalness in a ring around the point to estimate coast distance
    const sampleDistances = [50, 100, 200, 400];
    const sampleCount = 8;

    let totalOceanProximity = 0;
    let samples = 0;

    for (const radius of sampleDistances) {
        for (let i = 0; i < sampleCount; i++) {
            const angle = (i / sampleCount) * Math.PI * 2;
            const sx = x + Math.cos(angle) * radius;
            const sz = z + Math.sin(angle) * radius;

            const continental = getEffectiveContinentalness(sx, sz, seed, template);

            // If any nearby sample is ocean (continental < 0.15), we're near coast
            if (continental < 0.15) {
                // Weight by inverse distance - closer ocean = lower inland factor
                totalOceanProximity += (1 - radius / 500);
                samples++;
            }
        }
    }

    if (samples === 0) {
        // No ocean found nearby - we're deep inland
        return 1.0;
    }

    // Average ocean proximity, invert to get inland factor
    const avgOceanProximity = totalOceanProximity / samples;
    return Math.max(0, 1 - avgOceanProximity * 1.5);
}

/**
 * Calculate normalized terrain height at world position
 * All calculations work in [0, 1] space before final scaling.
 *
 * Height distribution targets:
 * - Ocean areas: 0.00 - 0.10 (deep to shallow)
 * - Lowlands: 0.10 - 0.30
 * - Midlands: 0.30 - 0.55
 * - Highlands: 0.55 - 0.75
 * - Mountains: 0.75 - 1.00
 *
 * @param {number} x - World X coordinate
 * @param {number} z - World Z coordinate
 * @param {number} seed - World seed
 * @param {Object} template - Continent template (optional, defaults to DEFAULT_TEMPLATE)
 * @returns {number} Normalized height [0, 1]
 */
export function getHeightAtNormalized(x, z, seed, template = DEFAULT_TEMPLATE) {
    // Get template modifiers for ocean detection and terrain shaping
    const modifiers = getTemplateModifiers(x, z, template);

    // Ocean check - if continentalnessMultiplier is low, this is ocean per template
    if (modifiers.continentalnessMultiplier < 0.3) {
        // Map to ocean depths based on how deep into ocean we are
        const oceanDepth = modifiers.continentalnessMultiplier / 0.3;
        return HEIGHT_CONFIG.bands.deepOceanFloor +
               oceanDepth * (HEIGHT_CONFIG.bands.seaLevel - HEIGHT_CONFIG.bands.deepOceanFloor);
    }

    // Get base terrain noise in [0, 1]
    const baseNoise = getBaseTerrainNoise(x, z, seed);

    // Get biome and its height band
    const biome = getBiomeAt(x, z, seed, template);
    const biomeHeightBand = BIOME_HEIGHT_BANDS[biome] || { min: 0.12, max: 0.35 };

    // Map noise to biome's height range
    let height = biomeHeightBand.min + baseNoise * (biomeHeightBand.max - biomeHeightBand.min);

    // INLAND ELEVATION BOOST - Critical for river flow!
    // Adds elevation based on distance from coast, creating consistent slope toward ocean
    const inlandFactor = getInlandFactor(x, z, seed, template);
    const inlandBoost = inlandFactor * 0.15; // Up to 15% height boost deep inland
    height += inlandBoost;

    // Mountain boost - ADDITIVE to push toward peaks
    if (modifiers.mountainBoost > 0) {
        // Get ridge noise for mountain detail
        const ridge = sampleRidgeness(x, z, seed, template);
        const weightedRidge = ridge * modifiers.ridgeWeight;

        // Calculate headroom to peak and add mountain contribution
        const headroom = HEIGHT_CONFIG.bands.peak - height;
        height += modifiers.mountainBoost * weightedRidge * headroom * 0.8;
    }

    // Peak boost for high-elevation biomes
    const PEAK_BIOMES = ['mountains', 'glacier', 'alpine', 'badlands', 'highlands', 'volcanic'];
    if (PEAK_BIOMES.includes(biome)) {
        const peakSeed = deriveSeed(seed, 'peaks');
        const peakHash = (x, z) => hash(x, z, peakSeed);
        const peakNoise = octaveNoise2D(x, z, 3, 0.04, peakHash);

        // Normalize peak noise and add headroom-based boost
        const normalizedPeak = (peakNoise - 0.08) / 0.37;
        const headroom = HEIGHT_CONFIG.bands.peak - height;
        height += normalizedPeak * headroom * 0.5;
    }

    // Apply elevation flattening from template
    // elevationMultiplier < 1 means flatten terrain toward sea level
    if (modifiers.elevationMultiplier < 1.0) {
        const flatBase = HEIGHT_CONFIG.bands.seaLevel + 0.03; // Slightly above sea level
        height = lerp(flatBase, height, modifiers.elevationMultiplier);
    }

    // Apply river carving (after all terrain modifiers)
    // Skip during river generation to avoid feedback loop
    if (!_skipRiverCarving) {
        const riverInfluence = getRiverInfluenceAt(x, z);
        if (riverInfluence) {
            height = applyRiverCarving(height, riverInfluence);
        }
    }

    // Final clamp to valid normalized range
    return Math.max(0, Math.min(1, height));
}

/**
 * Calculate terrain height at world position
 * Returns height in world units (blocks).
 *
 * @param {number} x - World X coordinate
 * @param {number} z - World Z coordinate
 * @param {number} seed - World seed
 * @param {Object} template - Continent template (optional, defaults to DEFAULT_TEMPLATE)
 * @returns {number} Height in blocks [1, HEIGHT_CONFIG.maxHeight]
 */
export function getHeightAt(x, z, seed, template = DEFAULT_TEMPLATE) {
    const normalized = getHeightAtNormalized(x, z, seed, template);
    return Math.max(1, Math.round(normalized * HEIGHT_CONFIG.maxHeight));
}

/**
 * Sample all terrain parameters at world position
 *
 * @param {number} x - World X coordinate
 * @param {number} z - World Z coordinate
 * @param {number} seed - World seed
 * @param {Object} template - Continent template (optional, defaults to DEFAULT_TEMPLATE)
 * @returns {Object} Terrain parameters:
 *   - continental: Base land/ocean distribution [0, 1]
 *   - effectiveContinental: Island-perturbed continentalness [0, 1]
 *   - temperature: Climate temperature [0, 1]
 *   - humidity: Precipitation/moisture [0, 1]
 *   - erosion: Valley/erosion detail [0, 1]
 *   - ridgeness: Mountain ridge formation [0, 1]
 *   - biome: Biome name (string)
 *   - heightNormalized: Normalized height [0, 1] for visualizer color mapping
 *   - height: Terrain height in blocks [1, HEIGHT_CONFIG.maxHeight]
 *   - waterType: 'deep', 'shallow', or 'none'
 *   - oceanDepth: Ocean floor height in blocks, or null if on land
 */
export function getTerrainParams(x, z, seed, template = DEFAULT_TEMPLATE) {
    const heightNormalized = getHeightAtNormalized(x, z, seed, template);
    return {
        continental: sampleContinentalness(x, z, seed, template),
        effectiveContinental: getEffectiveContinentalness(x, z, seed, template),
        temperature: sampleTemperature(x, z, seed, template),
        humidity: sampleHumidity(x, z, seed, template),
        erosion: sampleErosion(x, z, seed, template),
        ridgeness: sampleRidgeness(x, z, seed, template),
        biome: getBiomeAt(x, z, seed, template),
        heightNormalized: heightNormalized,
        height: Math.max(1, Math.round(heightNormalized * HEIGHT_CONFIG.maxHeight)),
        waterType: getWaterType(x, z, seed, template),
        oceanDepth: getOceanDepth(x, z, seed, template)
    };
}
