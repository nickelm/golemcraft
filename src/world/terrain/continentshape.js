/**
 * ContinentShape - Pure functions for continental coastline generation
 *
 * This module provides coastline shape generation via:
 * 1. Coarse SDF for O(1) proximity queries (256x256 grid)
 * 2. Low-frequency silhouette for major bays/peninsulas
 * 3. High-frequency fbm for detailed coastline geometry
 *
 * All functions are pure and deterministic from seed.
 */

import { hash, octaveNoise2D, normalizeNoise } from './terraincore.js';

// ============================================================================
// COAST ZONE CONSTANTS
// ============================================================================

/**
 * Coast zones based on signed distance from coastline
 * Positive = inland, Negative = ocean
 */
export const COAST_ZONES = {
    DEEP_INLAND: 'deep_inland',     // >100 blocks: normal terrain, no coast logic
    COASTAL_TAPER: 'coastal_taper', // 50-100 blocks: height tapers toward sea level
    BEACH: 'beach',                 // 0-50 blocks: sand surface, gentle slope
    SHALLOW: 'shallow',             // -30 to 0: visible floor, wading depth
    DEEP_OCEAN: 'deep_ocean'        // <-30: bottomless, impassable
};

// ============================================================================
// CONFIGURATION
// ============================================================================

export const CONTINENT_SHAPE_CONFIG = {
    // SDF grid
    sdfResolution: 256,           // Grid cells per axis
    sdfCellSize: 20,              // World blocks per SDF cell

    // Low-frequency silhouette (major bays and peninsulas)
    silhouetteOctaves: 3,         // Noise octaves for silhouette
    silhouetteLobes: 6,           // Average number of major coastal features
    silhouetteAmplitude: 0.22,    // Fraction of baseRadius for variation

    // High-frequency coastline detail
    fbmOctaves: 5,                // Noise octaves for detailed coastline
    fbmFrequency: 0.015,          // Spatial frequency of detail
    fbmAmplitude: 15,             // Max deviation in blocks

    // Zone thresholds (signed distance from coast)
    zoneDeepInland: 100,          // Beyond this: normal terrain
    zoneCoastalTaper: 50,         // 50-100: height blend zone
    zoneBeach: 0,                 // 0-50: beach zone
    zoneShallow: -30,             // -30 to 0: shallow water
    // Below -30: deep ocean
};

// ============================================================================
// SILHOUETTE FUNCTIONS
// ============================================================================

/**
 * Get nominal radius at a given angle around the island.
 * This defines the low-frequency silhouette (major bays and peninsulas).
 *
 * @param {number} angle - Angle in radians from island center
 * @param {number} shapeSeed - Seed for shape variation
 * @param {number} baseRadius - Base island radius in blocks
 * @returns {number} Nominal radius at this angle
 */
export function getNominalRadius(angle, shapeSeed, baseRadius) {
    const { silhouetteOctaves, silhouetteLobes, silhouetteAmplitude } = CONTINENT_SHAPE_CONFIG;
    const amplitude = baseRadius * silhouetteAmplitude;

    // Build up noise along the angular coordinate
    // Use 2D sampling to ensure smooth wrap-around at 2*PI
    let noise = 0;
    let amp = amplitude;
    let freq = silhouetteLobes;

    for (let o = 0; o < silhouetteOctaves; o++) {
        // Sample in a circle to get wrap-around behavior
        const sampleX = Math.cos(angle * freq) * 100 + o * 1000;
        const sampleZ = Math.sin(angle * freq) * 100;

        // Use octaveNoise2D with low frequency for smooth variation
        const n = octaveNoise2D(sampleX, sampleZ, 1, 0.01, (nx, nz) => hash(nx, nz, shapeSeed + o * 7777));
        noise += (n - 0.5) * 2 * amp;  // Center around 0, scale by amplitude

        amp *= 0.5;
        freq *= 2;
    }

    return baseRadius + noise;
}

// ============================================================================
// DETAILED COASTLINE
// ============================================================================

/**
 * Get detailed coast distance at a world position.
 * Uses high-frequency fbm to add inlets, headlands, and natural coastline variation.
 *
 * @param {number} worldX - World X coordinate
 * @param {number} worldZ - World Z coordinate
 * @param {number} coastSeed - Seed for coastline detail
 * @param {number} shapeSeed - Seed for silhouette shape
 * @param {number} baseRadius - Base island radius in blocks
 * @returns {number} Signed distance: positive = inland, negative = ocean
 */
export function getDetailedCoastDistance(worldX, worldZ, coastSeed, shapeSeed, baseRadius) {
    const { fbmOctaves, fbmFrequency, fbmAmplitude } = CONTINENT_SHAPE_CONFIG;

    // Distance from island center
    const distFromCenter = Math.sqrt(worldX * worldX + worldZ * worldZ);

    // Angle for silhouette lookup
    const angle = Math.atan2(worldZ, worldX);

    // Get low-frequency silhouette radius
    const nominalRadius = getNominalRadius(angle, shapeSeed, baseRadius);

    // Add high-frequency fbm detail
    const fbmNoise = octaveNoise2D(
        worldX, worldZ,
        fbmOctaves,
        fbmFrequency,
        (nx, nz) => hash(nx, nz, coastSeed)
    );

    // Normalize and center around 0, then scale by amplitude
    const detail = (normalizeNoise(fbmNoise) - 0.5) * 2 * fbmAmplitude;

    // Final coastline position
    const coastRadius = nominalRadius + detail;

    // Signed distance: positive = inland, negative = ocean
    return coastRadius - distFromCenter;
}

// ============================================================================
// COARSE SDF GENERATION
// ============================================================================

/**
 * Generate coarse SDF grid for O(1) proximity queries.
 * The SDF stores approximate distance to the nominal coastline (without fbm detail).
 * Used for early-out optimization in chunk generation.
 *
 * @param {number} shapeSeed - Seed for silhouette shape
 * @param {number} baseRadius - Base island radius in blocks
 * @param {number} resolution - Grid resolution (default 256)
 * @param {number} cellSize - World blocks per grid cell (default 20)
 * @returns {Float32Array} SDF grid (resolution x resolution)
 */
export function generateCoarseSDF(shapeSeed, baseRadius, resolution = 256, cellSize = 20) {
    const sdf = new Float32Array(resolution * resolution);
    const halfRes = resolution / 2;

    for (let gz = 0; gz < resolution; gz++) {
        for (let gx = 0; gx < resolution; gx++) {
            // Convert grid coords to world coords (centered at 0, 0)
            const worldX = (gx - halfRes) * cellSize;
            const worldZ = (gz - halfRes) * cellSize;

            // Distance from island center
            const distFromCenter = Math.sqrt(worldX * worldX + worldZ * worldZ);

            // Angle for silhouette lookup
            const angle = Math.atan2(worldZ, worldX);

            // Get nominal radius (no fbm detail for coarse SDF)
            const nominalRadius = getNominalRadius(angle, shapeSeed, baseRadius);

            // Signed distance: positive = inside island, negative = ocean
            sdf[gz * resolution + gx] = nominalRadius - distFromCenter;
        }
    }

    return sdf;
}

/**
 * Query coarse SDF at a world position.
 * Uses bilinear interpolation for smooth results.
 *
 * @param {Float32Array} sdf - SDF grid from generateCoarseSDF
 * @param {number} resolution - Grid resolution
 * @param {number} cellSize - World blocks per grid cell
 * @param {number} worldX - World X coordinate
 * @param {number} worldZ - World Z coordinate
 * @returns {number} Approximate signed distance to coast
 */
export function queryCoarseSDF(sdf, resolution, cellSize, worldX, worldZ) {
    const halfRes = resolution / 2;

    // Convert world coords to grid coords (floating point)
    const gx = worldX / cellSize + halfRes;
    const gz = worldZ / cellSize + halfRes;

    // Clamp to grid bounds with margin
    if (gx < 0 || gx >= resolution - 1 || gz < 0 || gz >= resolution - 1) {
        // Outside grid: estimate based on distance from center
        const dist = Math.sqrt(worldX * worldX + worldZ * worldZ);
        const approxRadius = resolution * cellSize / 2 * 0.4;  // Rough estimate
        return approxRadius - dist;
    }

    // Bilinear interpolation
    const x0 = Math.floor(gx);
    const z0 = Math.floor(gz);
    const fx = gx - x0;
    const fz = gz - z0;

    const v00 = sdf[z0 * resolution + x0];
    const v10 = sdf[z0 * resolution + x0 + 1];
    const v01 = sdf[(z0 + 1) * resolution + x0];
    const v11 = sdf[(z0 + 1) * resolution + x0 + 1];

    const v0 = v00 * (1 - fx) + v10 * fx;
    const v1 = v01 * (1 - fx) + v11 * fx;

    return v0 * (1 - fz) + v1 * fz;
}

// ============================================================================
// ZONE CLASSIFICATION
// ============================================================================

/**
 * Determine coast zone from signed distance.
 *
 * @param {number} signedDist - Signed distance to coast (positive = inland)
 * @returns {string} Zone constant from COAST_ZONES
 */
export function getCoastZone(signedDist) {
    const { zoneDeepInland, zoneCoastalTaper, zoneBeach, zoneShallow } = CONTINENT_SHAPE_CONFIG;

    if (signedDist > zoneDeepInland) return COAST_ZONES.DEEP_INLAND;
    if (signedDist > zoneCoastalTaper) return COAST_ZONES.COASTAL_TAPER;
    if (signedDist > zoneBeach) return COAST_ZONES.BEACH;
    if (signedDist > zoneShallow) return COAST_ZONES.SHALLOW;
    return COAST_ZONES.DEEP_OCEAN;
}

// ============================================================================
// STARTING POSITION
// ============================================================================

/**
 * Compute deterministic starting position from seed.
 * Places player on the coast at a seeded angle, offset inland.
 *
 * @param {number} startSeed - Seed for start position
 * @param {number} shapeSeed - Seed for silhouette shape
 * @param {number} baseRadius - Base island radius in blocks
 * @returns {{ x: number, z: number, angle: number }} Start position
 */
export function computeStartPosition(startSeed, shapeSeed, baseRadius) {
    // Deterministic starting angle from seed
    const startAngle = hash(0, 0, startSeed) * 2 * Math.PI;

    // Get coast radius at this angle
    const coastRadius = getNominalRadius(startAngle, shapeSeed, baseRadius);

    // Offset inland: 30-45 blocks from nominal coast
    const inlandOffset = 30 + hash(1, 0, startSeed) * 15;
    const startRadius = coastRadius - inlandOffset;

    return {
        x: Math.cos(startAngle) * startRadius,
        z: Math.sin(startAngle) * startRadius,
        angle: startAngle
    };
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Smoothstep interpolation.
 * @param {number} edge0 - Lower edge
 * @param {number} edge1 - Upper edge
 * @param {number} x - Value to interpolate
 * @returns {number} Smoothstepped value [0, 1]
 */
export function smoothstep(edge0, edge1, x) {
    const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
    return t * t * (3 - 2 * t);
}

/**
 * Linear interpolation.
 * @param {number} a - Start value
 * @param {number} b - End value
 * @param {number} t - Interpolation factor [0, 1]
 * @returns {number} Interpolated value
 */
export function lerp(a, b, t) {
    return a + (b - a) * t;
}
