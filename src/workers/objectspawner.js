/**
 * ObjectSpawner - Pure function module for object spawn logic
 *
 * Runs in the terrain worker to generate object positions in parallel
 * with mesh generation. Returns position data as Float32Arrays for
 * zero-copy transfer to main thread.
 */

const CHUNK_SIZE = 16;

// Object definitions - same as main thread ObjectGenerator
export const OBJECT_TYPES = {
    tree: {
        name: 'Tree',
        biomes: ['plains'],
        density: 0.08,
        hasCollision: false,
        usesForestNoise: true
    },
    snowTree: {
        name: 'Snow Tree',
        biomes: ['snow'],
        density: 0.06,
        hasCollision: false,
        usesForestNoise: true
    },
    jungleTree: {
        name: 'Jungle Tree',
        biomes: ['jungle'],
        density: 0.12,
        hasCollision: false,
        usesForestNoise: true
    },
    rock: {
        name: 'Rock',
        biomes: ['plains', 'mountains', 'snow', 'jungle'],
        density: 0.015,
        hasCollision: false
    },
    boulder: {
        name: 'Boulder',
        biomes: ['mountains'],
        density: 0.02,
        hasCollision: false
    },
    grass: {
        name: 'Grass',
        biomes: ['plains'],
        density: 0,  // Disabled for performance
        hasCollision: false
    },
    cactus: {
        name: 'Cactus',
        biomes: ['desert'],
        density: 0.02,
        hasCollision: false
    }
};

/**
 * Deterministic hash function for object placement
 * @param {number} seed - World seed
 * @param {number} x - World X coordinate
 * @param {number} z - World Z coordinate
 * @param {number} salt - Additional salt for variation
 * @returns {number} Value between 0 and 1
 */
function hash(seed, x, z, salt = 0) {
    let h = seed + salt + x * 374761393 + z * 668265263;
    h = (h ^ (h >> 13)) * 1274126177;
    return ((h ^ (h >> 16)) & 0xffffffff) / 0xffffffff;
}

/**
 * Forest noise for clustered tree placement
 * Uses Perlin-like interpolation for natural-looking forest distribution
 * @param {number} seed - World seed
 * @param {number} x - World X coordinate
 * @param {number} z - World Z coordinate
 * @returns {number} Value between 0 and 1 (raised to 0.7 power)
 */
function forestNoise(seed, x, z) {
    const scale = 0.04;
    const X = Math.floor(x * scale);
    const Z = Math.floor(z * scale);
    const fx = (x * scale) - X;
    const fz = (z * scale) - Z;

    // Hermite interpolation
    const u = fx * fx * (3 - 2 * fx);
    const v = fz * fz * (3 - 2 * fz);

    const forestSalt = 99999;
    const a = hash(seed, X, Z, forestSalt);
    const b = hash(seed, X + 1, Z, forestSalt);
    const c = hash(seed, X, Z + 1, forestSalt);
    const d = hash(seed, X + 1, Z + 1, forestSalt);

    const noise = a * (1 - u) * (1 - v) +
                  b * u * (1 - v) +
                  c * (1 - u) * v +
                  d * u * v;

    return Math.pow(noise, 0.7);
}

// Heightmap constants (must match chunkdatagenerator.js)
const HEIGHTMAP_SIZE = 17;  // CHUNK_SIZE + 1

/**
 * Get height from the smoothed heightmap
 * Uses bilinear interpolation for sub-cell positions
 * @param {Float32Array} heightmap - Smoothed heightmap from chunk generation
 * @param {number} localX - Local X coordinate within chunk (0-16)
 * @param {number} localZ - Local Z coordinate within chunk (0-16)
 * @returns {number} Interpolated height from heightmap
 */
function getHeightFromHeightmap(heightmap, localX, localZ) {
    // Clamp to valid range
    const clampedX = Math.max(0, Math.min(CHUNK_SIZE, localX));
    const clampedZ = Math.max(0, Math.min(CHUNK_SIZE, localZ));

    // Get integer and fractional parts
    const ix = Math.floor(clampedX);
    const iz = Math.floor(clampedZ);
    const fx = clampedX - ix;
    const fz = clampedZ - iz;

    // Sample 4 corners
    const i00 = iz * HEIGHTMAP_SIZE + ix;
    const i10 = iz * HEIGHTMAP_SIZE + Math.min(ix + 1, CHUNK_SIZE);
    const i01 = Math.min(iz + 1, CHUNK_SIZE) * HEIGHTMAP_SIZE + ix;
    const i11 = Math.min(iz + 1, CHUNK_SIZE) * HEIGHTMAP_SIZE + Math.min(ix + 1, CHUNK_SIZE);

    const h00 = heightmap[i00];
    const h10 = heightmap[i10];
    const h01 = heightmap[i01];
    const h11 = heightmap[i11];

    // Bilinear interpolation
    const h0 = h00 * (1 - fx) + h10 * fx;
    const h1 = h01 * (1 - fx) + h11 * fx;
    return h0 * (1 - fz) + h1 * fz;
}

/**
 * Get interpolated height for smooth object placement
 * Uses the smoothed heightmap if available, falls back to terrain provider
 * @param {Object} terrainProvider - Worker terrain provider
 * @param {number} x - World X coordinate
 * @param {number} z - World Z coordinate
 * @param {Float32Array|null} heightmap - Smoothed heightmap (optional)
 * @param {number} chunkX - Chunk X index (for heightmap lookup)
 * @param {number} chunkZ - Chunk Z index (for heightmap lookup)
 * @returns {number} Height for object placement
 */
function getObjectPlacementHeight(terrainProvider, x, z, heightmap, chunkX, chunkZ) {
    // Use smoothed heightmap if available (matches rendered terrain exactly)
    if (heightmap) {
        const localX = x - chunkX * CHUNK_SIZE;
        const localZ = z - chunkZ * CHUNK_SIZE;
        return getHeightFromHeightmap(heightmap, localX, localZ);
    }

    // Fallback to continuous height
    if (terrainProvider.getContinuousHeight) {
        return terrainProvider.getContinuousHeight(x, z);
    }

    // Final fallback to integer height + 1 for voxel terrain
    return terrainProvider.getHeight(x, z) + 1;
}

/**
 * Generate object instances for a chunk
 * @param {Object} terrainProvider - Worker terrain provider with getHeight, getBiome, etc.
 * @param {number} chunkX - Chunk X index
 * @param {number} chunkZ - Chunk Z index
 * @param {number} seed - World seed
 * @param {number} waterLevel - Water level (default 6)
 * @param {Float32Array|null} heightmap - Smoothed heightmap for accurate placement (optional)
 * @returns {Object} Map of object type to Float32Array positions {x,y,z,variation}
 */
export function generateObjectInstances(terrainProvider, chunkX, chunkZ, seed, waterLevel = 6, heightmap = null) {
    const startX = chunkX * CHUNK_SIZE;
    const startZ = chunkZ * CHUNK_SIZE;

    // Collect positions per object type
    const objectPositions = {
        tree: [],
        snowTree: [],
        jungleTree: [],
        rock: [],
        boulder: [],
        grass: [],
        cactus: []
    };

    for (let x = startX; x < startX + CHUNK_SIZE; x++) {
        for (let z = startZ; z < startZ + CHUNK_SIZE; z++) {
            const height = terrainProvider.getHeight(x, z);

            // Skip underwater positions
            if (height < waterLevel) continue;

            // Skip positions inside landmark clearings
            if (terrainProvider.landmarkSystem &&
                terrainProvider.landmarkSystem.isInClearing(x, z)) {
                continue;
            }

            const biome = terrainProvider.getBiome(x, z);

            // Place at cell center for consistent positioning
            const placeX = x + 0.5;
            const placeZ = z + 0.5;
            const y = getObjectPlacementHeight(terrainProvider, placeX, placeZ, heightmap, chunkX, chunkZ);

            // Try to place one object type per cell
            let placed = false;
            for (const [type, config] of Object.entries(OBJECT_TYPES)) {
                if (placed) break;
                if (!config.biomes.includes(biome)) continue;

                // Salt based on object type for deterministic but different placement
                const salt = type.charCodeAt(0) * 1000;

                // Calculate effective density with forest noise
                let effectiveDensity = config.density;
                if (config.usesForestNoise) {
                    const forestValue = forestNoise(seed, x, z);
                    effectiveDensity = config.density * (0.05 + 0.95 * forestValue);
                }

                // Hash-based placement decision
                if (hash(seed, x, z, salt) < effectiveDensity) {
                    const variation = hash(seed, x, z, salt + 1);
                    objectPositions[type].push(placeX, y, placeZ, variation);
                    placed = true;
                }
            }
        }
    }

    // Convert to Float32Arrays for transfer
    const result = {};
    for (const [type, positions] of Object.entries(objectPositions)) {
        result[type] = new Float32Array(positions);
    }

    return result;
}

/**
 * Get transferable buffers from static objects
 * @param {Object} staticObjects - Map of object type to Float32Array
 * @returns {ArrayBuffer[]} Array of transferable buffers
 */
export function getStaticObjectTransferables(staticObjects) {
    const transferables = [];
    for (const positionData of Object.values(staticObjects)) {
        if (positionData && positionData.buffer) {
            transferables.push(positionData.buffer);
        }
    }
    return transferables;
}
