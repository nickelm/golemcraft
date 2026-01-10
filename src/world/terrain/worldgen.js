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

/**
 * Get sea level in world units
 * @returns {number} Sea level height in blocks
 */
export function getSeaLevel() {
    return HEIGHT_CONFIG.seaLevelWorld;
}

/**
 * Get water type at world position based on continentalness
 *
 * @param {number} x - World X coordinate
 * @param {number} z - World Z coordinate
 * @param {number} seed - World seed
 * @param {Object} template - Continent template (optional, defaults to DEFAULT_TEMPLATE)
 * @returns {string} Water type: 'deep', 'shallow', or 'none'
 */
export function getWaterType(x, z, seed, template = DEFAULT_TEMPLATE) {
    const continental = sampleContinentalness(x, z, seed, template);

    // Add variation to deep/shallow boundary for organic coastlines
    const boundaryNoiseSeed = deriveSeed(seed, 'deep_boundary');
    const boundaryHash = (x, z) => hash(x, z, boundaryNoiseSeed);
    const boundaryNoise = octaveNoise2D(x, z, 2, 0.008, boundaryHash) * 0.04;
    const deepThreshold = OCEAN_THRESHOLDS.deep + (boundaryNoise - 0.02);

    if (continental < deepThreshold) {
        return 'deep';
    }
    if (continental < OCEAN_THRESHOLDS.shallow) {
        return 'shallow';
    }
    return 'none';
}

/**
 * Get ocean depth at world position
 *
 * @param {number} x - World X coordinate
 * @param {number} z - World Z coordinate
 * @param {number} seed - World seed
 * @param {Object} template - Continent template (optional, defaults to DEFAULT_TEMPLATE)
 * @returns {number|null} Ocean floor height in blocks, or null if on land
 *   - Deep ocean: near floor (HEIGHT_CONFIG.toWorld(0.01))
 *   - Shallow ocean: interpolated between floor and sea level based on continentalness
 *   - Land: null
 */
export function getOceanDepth(x, z, seed, template = DEFAULT_TEMPLATE) {
    const continental = sampleContinentalness(x, z, seed, template);

    // Add variation to deep/shallow boundary for organic coastlines
    const boundaryNoiseSeed = deriveSeed(seed, 'deep_boundary');
    const boundaryHash = (x, z) => hash(x, z, boundaryNoiseSeed);
    const boundaryNoise = octaveNoise2D(x, z, 2, 0.008, boundaryHash) * 0.04;
    const deepThreshold = OCEAN_THRESHOLDS.deep + (boundaryNoise - 0.02);

    // Land - no ocean depth
    if (continental >= OCEAN_THRESHOLDS.shallow) {
        return null;
    }

    // Deep ocean - near floor
    if (continental < deepThreshold) {
        return HEIGHT_CONFIG.toWorld(0.01);
    }

    // Shallow ocean - interpolate between floor and sea level based on continentalness
    const shallowOceanFloor = HEIGHT_CONFIG.toWorld(HEIGHT_CONFIG.bands.shallowOceanFloor);
    const seaLevel = HEIGHT_CONFIG.seaLevelWorld;

    // Normalize continentalness within shallow range [deepThreshold, OCEAN_THRESHOLDS.shallow]
    const shallowRange = OCEAN_THRESHOLDS.shallow - deepThreshold;
    const t = (continental - deepThreshold) / shallowRange;

    // Lerp from shallow ocean floor to sea level
    return shallowOceanFloor + t * (seaLevel - shallowOceanFloor);
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
        frequency: 0.008,    // Climate zones (latitudinal variation)
        octaves: 3
    },
    humidity: {
        frequency: 0.006,    // Precipitation patterns
        octaves: 3
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
    // Sample terrain parameters with template modifiers
    const continental = sampleContinentalness(x, z, seed, template);
    const temperature = sampleTemperature(x, z, seed, template);
    const humidity = sampleHumidity(x, z, seed, template);

    // Ocean check (below 15% continentalness threshold)
    // This means bay areas will naturally become ocean biomes
    if (continental < 0.15) {
        return 'ocean';
    }

    // Classify into climate bands
    const tempBand = temperature < 0.33 ? 'cold' : (temperature < 0.66 ? 'temperate' : 'hot');
    const humidityBand = humidity < 0.33 ? 'dry' : (humidity < 0.66 ? 'moderate' : 'wet');

    // Elevation band from modified continentalness
    // Templates affect biome distribution (bay → ocean, spine → mountains)
    const elevBand = continental < 0.3 ? 'low' : (continental < 0.6 ? 'mid' : 'high');

    // Use climate matrix for biome lookup
    return selectBiomeFromClimate(tempBand, humidityBand, elevBand);
}

/**
 * Calculate terrain height at world position
 *
 * Uses biome height fractions (baseHeightFraction, heightScaleFraction) multiplied
 * by HEIGHT_CONFIG.maxHeight for relative terrain scaling. Supports legacy absolute
 * values (baseHeight, heightScale) for backward compatibility.
 *
 * @param {number} x - World X coordinate
 * @param {number} z - World Z coordinate
 * @param {number} seed - World seed
 * @param {Object} template - Continent template (optional, defaults to DEFAULT_TEMPLATE)
 * @returns {number} Height in blocks [1, HEIGHT_CONFIG.maxHeight]
 */
export function getHeightAt(x, z, seed, template = DEFAULT_TEMPLATE) {
    // Get biome for base height/scale
    const biome = getBiomeAt(x, z, seed, template);
    const biomeConfig = getBiomeConfig(biome);

    // Domain warping for organic terrain (match terrainworker.js)
    const warpSeed = deriveSeed(seed, 'warp');
    const warpHash = (x, z) => hash(x, z, warpSeed);
    const warpStrength = 2.5;
    const warpX = octaveNoise2D(x + 500, z, 2, 0.015, warpHash) * warpStrength;
    const warpZ = octaveNoise2D(x, z + 500, 2, 0.015, warpHash) * warpStrength;

    // Main height noise with warping
    const heightNoiseSeed = deriveSeed(seed, 'height');
    const heightHash = (x, z) => hash(x, z, heightNoiseSeed);
    const heightNoise = octaveNoise2D(x + warpX, z + warpZ, 5, 0.03, heightHash);

    // Micro-detail
    const detailSeed = deriveSeed(seed, 'detail');
    const detailHash = (x, z) => hash(x, z, detailSeed);
    const microDetail = octaveNoise2D(x, z, 2, 0.12, detailHash) * 0.25;

    // Get template modifiers
    const modifiers = getTemplateModifiers(x, z, template);

    // Apply elevation multiplier to detail noise
    const modifiedDetail = microDetail * modifiers.elevationMultiplier;

    // Base height calculation using fractions (with backward compatibility for absolute values)
    const LEGACY_MAX_HEIGHT = 63;  // Used for converting old absolute values to fractions
    const baseHeight = biomeConfig.baseHeightFraction !== undefined
        ? biomeConfig.baseHeightFraction * HEIGHT_CONFIG.maxHeight
        : biomeConfig.baseHeight;
    const heightScale = biomeConfig.heightScaleFraction !== undefined
        ? biomeConfig.heightScaleFraction * HEIGHT_CONFIG.maxHeight
        : biomeConfig.heightScale;

    let height = baseHeight + heightNoise * heightScale + modifiedDetail;

    // Add mountain height contribution (from spines and boosted regions)
    const mountainHeight = sampleMountainHeight(x, z, seed, template);
    height += mountainHeight * 50; // Scale factor to match terrainworker.js peak bonus

    // Peak boost for high-elevation biomes (match terrainworker.js logic)
    const PEAK_BIOMES = ['mountains', 'glacier', 'alpine', 'badlands', 'highlands'];
    if (PEAK_BIOMES.includes(biome)) {
        const peakSeed = deriveSeed(seed, 'peaks');
        const peakHash = (x, z) => hash(x, z, peakSeed);
        const peakNoise = octaveNoise2D(x, z, 3, 0.04, peakHash);
        const peakBonus = peakNoise * 50;
        height += peakBonus;
    }

    // Final clamp to valid range
    return Math.max(1.0, Math.min(HEIGHT_CONFIG.maxHeight, height));
}

/**
 * Sample all terrain parameters at world position
 *
 * @param {number} x - World X coordinate
 * @param {number} z - World Z coordinate
 * @param {number} seed - World seed
 * @param {Object} template - Continent template (optional, defaults to DEFAULT_TEMPLATE)
 * @returns {Object} Terrain parameters:
 *   - continental: Land/ocean distribution [0, 1]
 *   - temperature: Climate temperature [0, 1]
 *   - humidity: Precipitation/moisture [0, 1]
 *   - erosion: Valley/erosion detail [0, 1]
 *   - ridgeness: Mountain ridge formation [0, 1]
 *   - biome: Biome name (string)
 *   - height: Terrain height in blocks [1, HEIGHT_CONFIG.maxHeight]
 *   - waterType: 'deep', 'shallow', or 'none'
 *   - oceanDepth: Ocean floor height in blocks, or null if on land
 */
export function getTerrainParams(x, z, seed, template = DEFAULT_TEMPLATE) {
    return {
        continental: sampleContinentalness(x, z, seed, template),
        temperature: sampleTemperature(x, z, seed, template),
        humidity: sampleHumidity(x, z, seed, template),
        erosion: sampleErosion(x, z, seed, template),
        ridgeness: sampleRidgeness(x, z, seed, template),
        biome: getBiomeAt(x, z, seed, template),
        height: getHeightAt(x, z, seed, template),
        waterType: getWaterType(x, z, seed, template),
        oceanDepth: getOceanDepth(x, z, seed, template)
    };
}
