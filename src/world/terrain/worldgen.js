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
 * @returns {number} Continentalness [0, 1]:
 *   0.0-0.2: Deep ocean
 *   0.2-0.4: Shallow ocean / coast
 *   0.4-0.6: Lowlands
 *   0.6-0.8: Midlands
 *   0.8-1.0: Highlands / continental interior
 */
export function sampleContinentalness(x, z, seed) {
    const derivedSeed = deriveSeed(seed, 'continentalness');
    const boundHash = (x, z) => hash(x, z, derivedSeed);

    return warpedNoise2D(
        x, z,
        WORLD_PARAMS.continental.octaves,
        WORLD_PARAMS.continental.frequency,
        WORLD_PARAMS.continental.warpStrength,
        boundHash
    );
}

/**
 * Sample temperature at world position
 * Creates latitudinal temperature bands with variation.
 *
 * @param {number} x - World X coordinate
 * @param {number} z - World Z coordinate
 * @param {number} seed - World seed
 * @returns {number} Temperature [0, 1]:
 *   0.0-0.3: Cold (arctic/alpine)
 *   0.3-0.7: Temperate
 *   0.7-1.0: Hot (tropical/desert)
 */
export function sampleTemperature(x, z, seed) {
    const derivedSeed = deriveSeed(seed, 'temperature');
    const boundHash = (x, z) => hash(x, z, derivedSeed);

    return octaveNoise2D(
        x, z,
        WORLD_PARAMS.temperature.octaves,
        WORLD_PARAMS.temperature.frequency,
        boundHash
    );
}

/**
 * Sample humidity at world position
 * Determines precipitation and moisture patterns.
 *
 * @param {number} x - World X coordinate
 * @param {number} z - World Z coordinate
 * @param {number} seed - World seed
 * @returns {number} Humidity [0, 1]:
 *   0.0-0.3: Arid (desert/badlands)
 *   0.3-0.7: Moderate
 *   0.7-1.0: Humid (rainforest/swamp)
 */
export function sampleHumidity(x, z, seed) {
    const derivedSeed = deriveSeed(seed, 'humidity');
    const boundHash = (x, z) => hash(x, z, derivedSeed);

    return octaveNoise2D(
        x, z,
        WORLD_PARAMS.humidity.octaves,
        WORLD_PARAMS.humidity.frequency,
        boundHash
    );
}

/**
 * Sample erosion at world position
 * Adds local detail for valleys, erosion patterns, and terrain roughness.
 *
 * @param {number} x - World X coordinate
 * @param {number} z - World Z coordinate
 * @param {number} seed - World seed
 * @returns {number} Erosion [0, 1]:
 *   0.0: Heavily eroded (valleys, riverbeds)
 *   0.5: Moderate erosion
 *   1.0: Uneroded (peaks, plateaus)
 */
export function sampleErosion(x, z, seed) {
    const derivedSeed = deriveSeed(seed, 'erosion');
    const boundHash = (x, z) => hash(x, z, derivedSeed);

    return octaveNoise2D(
        x, z,
        WORLD_PARAMS.erosion.octaves,
        WORLD_PARAMS.erosion.frequency,
        boundHash
    );
}

/**
 * Sample ridgeness at world position
 * Creates mountain ridges and valleys using ridged multifractal noise.
 *
 * @param {number} x - World X coordinate
 * @param {number} z - World Z coordinate
 * @param {number} seed - World seed
 * @returns {number} Ridgeness [0, 1]:
 *   0.0: Valley / flat terrain
 *   0.5: Slopes
 *   1.0: Sharp ridges / peaks
 */
export function sampleRidgeness(x, z, seed) {
    const derivedSeed = deriveSeed(seed, 'ridgeness');
    const boundHash = (x, z) => hash(x, z, derivedSeed);

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
 * Sample all terrain parameters at world position
 *
 * @param {number} x - World X coordinate
 * @param {number} z - World Z coordinate
 * @param {number} seed - World seed
 * @returns {Object} Terrain parameters:
 *   - continental: Land/ocean distribution [0, 1]
 *   - temperature: Climate temperature [0, 1]
 *   - humidity: Precipitation/moisture [0, 1]
 *   - erosion: Valley/erosion detail [0, 1]
 *   - ridgeness: Mountain ridge formation [0, 1]
 */
export function getTerrainParams(x, z, seed) {
    return {
        continental: sampleContinentalness(x, z, seed),
        temperature: sampleTemperature(x, z, seed),
        humidity: sampleHumidity(x, z, seed),
        erosion: sampleErosion(x, z, seed),
        ridgeness: sampleRidgeness(x, z, seed)
    };
}
