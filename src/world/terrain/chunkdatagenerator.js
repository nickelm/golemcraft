/**
 * ChunkDataGenerator - IMPROVED VERSION
 *
 * Strategy:
 * - Heightfield renders EVERYWHERE (no holes for voxel regions)
 * - Voxels render ON TOP of heightfield where shouldUseVoxels() is true
 * - Render order: voxels first (write Z), heightfield second (gets Z-rejected under voxels)
 *
 * IMPROVEMENTS in this version:
 * 1. Fixed normal computation (was using arbitrary ny=2.0)
 * 2. Added heightmap smoothing to eliminate single-block peaks
 * 3. Improved water transparency with better depth colors
 * 4. Edge pixels NOT smoothed to preserve chunk boundary continuity
 * 5. Texture splatting for smooth biome transitions
 */

import { BIOMES } from './biomesystem.js';

// ============================================================================
// CONSTANTS
// ============================================================================

export const CHUNK_SIZE = 16;
export const CHUNK_HEIGHT = 64;
export const MAX_HEIGHT = 64;
export const WATER_LEVEL = 6;

const HEIGHTMAP_SIZE = CHUNK_SIZE + 1;

const ATLAS_SIZE = 720;
const CELL_SIZE = 72;
const TILE_SIZE = 64;
const GUTTER = 4;

// Mapping from surface block types to atlas tile indices for splatting shader
const SURFACE_TILE_INDICES = {
    grass: 0,      // [0,0] in atlas
    stone: 1,      // [1,0]
    snow: 2,       // [2,0]
    dirt: 3,       // [3,0]
    sand: 5,       // [5,0]
    ice: 6         // [6,0]
};

// Texture splatting noise and height bias configuration
const BLEND_NOISE_SCALE = 0.2;       // Spatial frequency of noise (lower = smoother)
const BLEND_NOISE_AMPLITUDE = 0.08;  // How much noise affects weights (±8%) - reduced for less spotty dithering

const HEIGHT_BIAS = {
    snow:  { minHeight: 18, bonus: 0.3 },
    stone: { minHeight: 22, bonus: 0.2 },
    sand:  { maxHeight: 9,  bonus: 0.25 }  // WATER_LEVEL + 3
};

export const BLOCK_TYPES = {
    grass: { tile: [0, 0] },
    dirt: { tile: [3, 0] },
    stone: { tile: [1, 0] },
    snow: { tile: [2, 0] },
    sand: { tile: [5, 0] },
    water: { tile: [4, 0], transparent: true },
    water_full: { tile: [4, 0], transparent: true },
    ice: { tile: [6, 0] },
    mayan_stone: { tile: [7, 0] }
};

export const BLOCK_TYPE_IDS = {
    air: 0,
    grass: 1,
    dirt: 2,
    stone: 3,
    snow: 4,
    sand: 5,
    water: 6,
    water_full: 7,
    ice: 8,
    mayan_stone: 9
};

// Face definitions - correct CCW winding
const FACES = {
    top:    { dir: [0, 1, 0],  verts: [[0,1,0], [0,1,1], [1,1,1], [1,1,0]] },
    bottom: { dir: [0, -1, 0], verts: [[0,0,0], [1,0,0], [1,0,1], [0,0,1]] },
    north:  { dir: [0, 0, -1], verts: [[1,0,0], [0,0,0], [0,1,0], [1,1,0]] },
    south:  { dir: [0, 0, 1],  verts: [[0,0,1], [1,0,1], [1,1,1], [0,1,1]] },
    east:   { dir: [1, 0, 0],  verts: [[1,0,1], [1,0,0], [1,1,0], [1,1,1]] },
    west:   { dir: [-1, 0, 0], verts: [[0,0,0], [0,0,1], [0,1,1], [0,1,0]] }
};

const FACE_AO_NEIGHBORS = {
    top: [
        [[-1, 1, 0], [-1, 1, -1], [0, 1, -1]],
        [[0, 1, 1], [-1, 1, 1], [-1, 1, 0]],
        [[1, 1, 0], [1, 1, 1], [0, 1, 1]],
        [[0, 1, -1], [1, 1, -1], [1, 1, 0]]
    ],
    bottom: [
        [[-1, -1, 0], [-1, -1, -1], [0, -1, -1]],
        [[1, -1, 0], [1, -1, -1], [0, -1, -1]],
        [[1, -1, 0], [1, -1, 1], [0, -1, 1]],
        [[-1, -1, 0], [-1, -1, 1], [0, -1, 1]]
    ],
    north: [
        [[1, 0, -1], [1, -1, -1], [0, -1, -1]],
        [[-1, 0, -1], [-1, -1, -1], [0, -1, -1]],
        [[-1, 0, -1], [-1, 1, -1], [0, 1, -1]],
        [[1, 0, -1], [1, 1, -1], [0, 1, -1]]
    ],
    south: [
        [[-1, 0, 1], [-1, -1, 1], [0, -1, 1]],
        [[1, 0, 1], [1, -1, 1], [0, -1, 1]],
        [[1, 0, 1], [1, 1, 1], [0, 1, 1]],
        [[-1, 0, 1], [-1, 1, 1], [0, 1, 1]]
    ],
    east: [
        [[1, 0, -1], [1, -1, -1], [1, -1, 0]],
        [[1, 0, 1], [1, -1, 1], [1, -1, 0]],
        [[1, 0, 1], [1, 1, 1], [1, 1, 0]],
        [[1, 0, -1], [1, 1, -1], [1, 1, 0]]
    ],
    west: [
        [[-1, 0, 1], [-1, -1, 1], [-1, -1, 0]],
        [[-1, 0, -1], [-1, -1, -1], [-1, -1, 0]],
        [[-1, 0, -1], [-1, 1, -1], [-1, 1, 0]],
        [[-1, 0, 1], [-1, 1, 1], [-1, 1, 0]]
    ]
};

// ============================================================================
// HELPERS
// ============================================================================

export function getBlockTypeId(blockType) {
    return BLOCK_TYPE_IDS[blockType] ?? 0;
}

export function getBlockIndex(localX, y, localZ) {
    return y * (CHUNK_SIZE * CHUNK_SIZE) + localZ * CHUNK_SIZE + localX;
}

function getBlockUVs(blockType) {
    const blockDef = BLOCK_TYPES[blockType];
    if (!blockDef) return { uMin: 0, uMax: 1, vMin: 0, vMax: 1 };
    const [col, row] = blockDef.tile;
    const uMin = (col * CELL_SIZE + GUTTER) / ATLAS_SIZE;
    const uMax = (col * CELL_SIZE + GUTTER + TILE_SIZE) / ATLAS_SIZE;
    const vMax = 1 - (row * CELL_SIZE + GUTTER) / ATLAS_SIZE;
    const vMin = 1 - (row * CELL_SIZE + GUTTER + TILE_SIZE) / ATLAS_SIZE;
    return { uMin, uMax, vMin, vMax };
}

function isBlockTransparent(blockType) {
    return blockType === 'water' || blockType === 'water_full' || blockType === 'ice';
}

function getHeightmapIndex(localX, localZ) {
    return localZ * HEIGHTMAP_SIZE + localX;
}

/**
 * Improved hash function for blend noise with better distribution
 * Uses multiple rounds of mixing for more uniform results
 * @returns {number} Value between 0 and 1
 */
function blendHash(x, z, seed = 12345) {
    // Use 32-bit safe operations
    let h = (seed | 0) >>> 0;
    h = ((h + (x | 0)) | 0) >>> 0;
    h = (h ^ (h >>> 16)) >>> 0;
    h = ((h * 0x85ebca6b) | 0) >>> 0;
    h = ((h + (z | 0)) | 0) >>> 0;
    h = (h ^ (h >>> 13)) >>> 0;
    h = ((h * 0xc2b2ae35) | 0) >>> 0;
    h = (h ^ (h >>> 16)) >>> 0;
    return h / 0xffffffff;
}


/**
 * Interpolated noise for smooth blend perturbation
 * @returns {number} Value between -1 and 1
 */
function blendNoise(x, z, seed) {
    const X = Math.floor(x);
    const Z = Math.floor(z);
    const fx = x - X;
    const fz = z - Z;
    // Smooth interpolation
    const u = fx * fx * (3.0 - 2.0 * fx);
    const v = fz * fz * (3.0 - 2.0 * fz);
    // Sample corners
    const a = blendHash(X, Z, seed);
    const b = blendHash(X + 1, Z, seed);
    const c = blendHash(X, Z + 1, seed);
    const d = blendHash(X + 1, Z + 1, seed);
    // Bilinear interpolation, remap to -1..1
    const value = a * (1 - u) * (1 - v) + b * u * (1 - v) + c * (1 - u) * v + d * u * v;
    return (value - 0.5) * 2;
}

// ============================================================================
// BIOME BLEND WEIGHT COMPUTATION FOR TEXTURE SPLATTING
// ============================================================================

/**
 * Compute blend weights for texture splatting at a vertex position.
 * Samples biomes in a 5x5 area around the vertex and computes weights
 * based on the frequency of each surface type, with noise perturbation
 * and height-based bias for more natural transitions.
 *
 * @param {number} worldX - World X coordinate of vertex
 * @param {number} worldZ - World Z coordinate of vertex
 * @param {number} terrainHeight - Height at this vertex for height-based bias
 * @param {Object} terrainProvider - Provider with getBiome() and biome data access
 * @param {Object} biomes - BIOMES configuration object
 * @returns {Object} { tileIndices: [4], weights: [4] } - padded to 4 entries
 */
function computeBlendWeights(worldX, worldZ, terrainHeight, terrainProvider, biomes) {
    const SAMPLE_RADIUS = 1;  // 3x3 sample area - narrower transitions, less spotty dithering
    const surfaceVotes = new Map();  // surfaceType -> count

    // Sample biomes in a grid around the vertex
    for (let dx = -SAMPLE_RADIUS; dx <= SAMPLE_RADIUS; dx++) {
        for (let dz = -SAMPLE_RADIUS; dz <= SAMPLE_RADIUS; dz++) {
            const biome = terrainProvider.getBiome(worldX + dx, worldZ + dz);
            const biomeData = biomes[biome];
            if (biomeData) {
                const surfaceType = biomeData.surface;
                surfaceVotes.set(surfaceType, (surfaceVotes.get(surfaceType) || 0) + 1);
            }
        }
    }

    // Sort by vote count (descending), take top 4
    const sorted = [...surfaceVotes.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 4);

    // Calculate total for normalization
    const totalVotes = sorted.reduce((sum, [_, count]) => sum + count, 0);

    // Build result arrays with base weights
    const tileIndices = [];
    const weights = [];
    const surfaceTypes = [];  // Track surface types for height bias

    for (let i = 0; i < 4; i++) {
        if (i < sorted.length) {
            const [surfaceType, count] = sorted[i];
            tileIndices.push(SURFACE_TILE_INDICES[surfaceType] ?? 0);
            weights.push(count / totalVotes);
            surfaceTypes.push(surfaceType);
        } else {
            // Pad with zeros (first tile, zero weight)
            tileIndices.push(tileIndices[0] ?? 0);
            weights.push(0);
            surfaceTypes.push(null);
        }
    }

    // Apply noise perturbation to each weight
    // Use different seed offsets per surface type so they don't all shift together
    const noiseX = worldX * BLEND_NOISE_SCALE;
    const noiseZ = worldZ * BLEND_NOISE_SCALE;
    for (let i = 0; i < 4; i++) {
        if (weights[i] > 0) {
            const seedOffset = tileIndices[i] * 31337;  // Different seed per tile type
            const noisePerturbation = blendNoise(noiseX, noiseZ, 12345 + seedOffset) * BLEND_NOISE_AMPLITUDE;
            weights[i] += noisePerturbation;
        }
    }

    // Apply height-based bias (only to surface types already present)
    for (let i = 0; i < 4; i++) {
        const surfaceType = surfaceTypes[i];
        if (surfaceType && weights[i] > 0) {
            const bias = HEIGHT_BIAS[surfaceType];
            if (bias) {
                if (bias.minHeight !== undefined && terrainHeight > bias.minHeight) {
                    weights[i] += bias.bonus;
                } else if (bias.maxHeight !== undefined && terrainHeight < bias.maxHeight) {
                    weights[i] += bias.bonus;
                }
            }
        }
    }

    // Clamp and renormalize
    let total = 0;
    for (let i = 0; i < 4; i++) {
        weights[i] = Math.max(0, weights[i]);
        total += weights[i];
    }
    if (total > 0.001) {
        for (let i = 0; i < 4; i++) {
            weights[i] /= total;
        }
    } else {
        // Fallback: all weight to first tile
        weights[0] = 1.0;
    }

    return { tileIndices, weights };
}

/**
 * Select a single tile for a quad using noise-based dithering.
 * Uses deterministic hash noise to create natural-looking stippled
 * transitions at biome boundaries.
 *
 * This is used in low-power mode instead of texture blending,
 * creating a classic 8-bit style stippled transition effect.
 *
 * @param {number} worldX - World X coordinate of quad center
 * @param {number} worldZ - World Z coordinate of quad center
 * @param {number} terrainHeight - Height at this position
 * @param {Object} terrainProvider - Provider with getBiome()
 * @param {Object} biomes - BIOMES configuration
 * @returns {number} Single tile index for this quad
 */
function computeDitheredTileSelection(worldX, worldZ, terrainHeight, terrainProvider, biomes) {
    // Get blend weights using existing function
    const blend = computeBlendWeights(worldX, worldZ, terrainHeight, terrainProvider, biomes);

    // Get the two most significant tiles
    const primaryTile = blend.tileIndices[0];
    const secondaryTile = blend.tileIndices[1];
    const secondaryWeight = blend.weights[1];

    // If completely dominant tile (>95% weight), skip dithering
    if (secondaryWeight < 0.05) {
        return primaryTile;
    }

    // Use integer coordinates for hash
    const ix = Math.floor(worldX);
    const iz = Math.floor(worldZ);

    // Generate per-quad noise using hash function
    // The hash function should give unique values for each (ix, iz) pair
    const noise = blendHash(ix, iz, 54321);

    // Threshold dithering: compare noise against secondary weight
    // If noise < secondary weight, pick secondary tile
    // This creates natural-looking stippled patterns
    if (noise < secondaryWeight) {
        return secondaryTile;
    }

    // Also check third tile if it has significant weight
    const tertiaryWeight = blend.weights[2];
    if (tertiaryWeight > 0.08) {
        // Use different seed for tertiary tile check
        const noise2 = blendHash(ix, iz, 98765);
        if (noise2 < tertiaryWeight) {
            return blend.tileIndices[2];
        }
    }

    return primaryTile;
}

/**
 * Remap a vertex's blend weights to match a fixed tile index order.
 *
 * The quad uses a fixed set of tile indices (from center sample).
 * Each vertex may have different surface types in its blend result.
 * This function maps the vertex's weights to the quad's tile order.
 *
 * @param {Object} vertexBlend - { tileIndices: [4], weights: [4] } from vertex
 * @param {Array} quadTileIndices - [4] fixed tile indices for the quad
 * @returns {Array} [4] weights remapped to quad's tile order
 */
function remapWeightsToTileOrder(vertexBlend, quadTileIndices) {
    const remappedWeights = [0, 0, 0, 0];

    // For each tile in the vertex's blend, find where it goes in quad order
    for (let i = 0; i < 4; i++) {
        const tileIndex = vertexBlend.tileIndices[i];
        const weight = vertexBlend.weights[i];

        // Find this tile in the quad's tile list
        const quadSlot = quadTileIndices.indexOf(tileIndex);
        if (quadSlot !== -1) {
            remappedWeights[quadSlot] += weight;
        }
        // If tile not in quad's list, its weight is lost (distributed to others via normalization)
    }

    // Normalize weights to sum to 1.0
    const total = remappedWeights.reduce((a, b) => a + b, 0);
    if (total > 0.001) {
        for (let i = 0; i < 4; i++) {
            remappedWeights[i] /= total;
        }
    } else {
        // Fallback: all weight to first tile
        remappedWeights[0] = 1.0;
    }

    return remappedWeights;
}

/**
 * Compute unified tile indices from all 4 quad vertices.
 * Collects all unique tile indices from the vertices and picks
 * the top 4 by total weight contribution.
 */
function computeQuadTileIndices(blend00, blend10, blend01, blend11) {
    const tileWeights = new Map(); // tileIndex -> totalWeight

    // Accumulate weights from all 4 vertices
    for (const blend of [blend00, blend10, blend01, blend11]) {
        for (let i = 0; i < 4; i++) {
            const tile = blend.tileIndices[i];
            const weight = blend.weights[i];
            tileWeights.set(tile, (tileWeights.get(tile) || 0) + weight);
        }
    }

    // Sort by total weight, take top 4
    const sorted = [...tileWeights.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 4);

    // Build result array, padded to 4 entries
    const result = [];
    for (let i = 0; i < 4; i++) {
        if (i < sorted.length) {
            result.push(sorted[i][0]);
        } else {
            result.push(result[0] ?? 0);
        }
    }

    return result;
}

// ============================================================================
// HEIGHTMAP GENERATION WITH SMOOTHING
// ============================================================================

function generateHeightmap(terrainProvider, chunkX, chunkZ) {
    const worldMinX = chunkX * CHUNK_SIZE;
    const worldMinZ = chunkZ * CHUNK_SIZE;
    
    // First pass: sample raw continuous heights
    const rawHeightmap = new Float32Array(HEIGHTMAP_SIZE * HEIGHTMAP_SIZE);
    for (let lz = 0; lz < HEIGHTMAP_SIZE; lz++) {
        for (let lx = 0; lx < HEIGHTMAP_SIZE; lx++) {
            rawHeightmap[getHeightmapIndex(lx, lz)] = 
                terrainProvider.getContinuousHeight(worldMinX + lx, worldMinZ + lz);
        }
    }
    
    // Second pass: Gaussian smoothing (interior only)
    const smoothed = smoothHeightmap(rawHeightmap, HEIGHTMAP_SIZE, 0.35);
    
    // Third pass: remove isolated peaks (interior only)
    return removeIsolatedPeaks(smoothed, HEIGHTMAP_SIZE, 0.7);
}

/**
 * Apply Gaussian smoothing to heightmap
 * IMPORTANT: Only smooth interior pixels to preserve chunk boundary continuity
 */
function smoothHeightmap(heightmap, size, strength) {
    const output = new Float32Array(heightmap.length);
    output.set(heightmap);  // Start with original values (preserves edges)
    
    const kernel = [
        [1, 2, 1],
        [2, 4, 2],
        [1, 2, 1]
    ];
    const kernelSum = 16;
    
    // Only smooth interior pixels (1 to size-2)
    for (let z = 1; z < size - 1; z++) {
        for (let x = 1; x < size - 1; x++) {
            const idx = z * size + x;
            let sum = 0;
            
            for (let kz = -1; kz <= 1; kz++) {
                for (let kx = -1; kx <= 1; kx++) {
                    sum += heightmap[(z + kz) * size + (x + kx)] * kernel[kz + 1][kx + 1];
                }
            }
            
            output[idx] = heightmap[idx] * (1 - strength) + (sum / kernelSum) * strength;
        }
    }
    
    return output;
}

/**
 * Remove isolated peaks and valleys
 * IMPORTANT: Only process interior pixels to preserve chunk boundary continuity
 */
function removeIsolatedPeaks(heightmap, size, threshold) {
    const output = new Float32Array(heightmap.length);
    output.set(heightmap);
    
    // Only process interior pixels (1 to size-2)
    for (let z = 1; z < size - 1; z++) {
        for (let x = 1; x < size - 1; x++) {
            const idx = z * size + x;
            const h = heightmap[idx];
            
            let maxNeighbor = -Infinity;
            let minNeighbor = Infinity;
            let sum = 0;
            let count = 0;
            
            for (let dz = -1; dz <= 1; dz++) {
                for (let dx = -1; dx <= 1; dx++) {
                    if (dx === 0 && dz === 0) continue;
                    const nh = heightmap[(z + dz) * size + (x + dx)];
                    maxNeighbor = Math.max(maxNeighbor, nh);
                    minNeighbor = Math.min(minNeighbor, nh);
                    sum += nh;
                    count++;
                }
            }
            
            const avg = sum / count;
            
            if (h > maxNeighbor + threshold) {
                output[idx] = avg + threshold * 0.25;
            }
            else if (h < minNeighbor - threshold) {
                output[idx] = avg - threshold * 0.25;
            }
        }
    }
    
    return output;
}

// ============================================================================
// VOXEL MASK AND SURFACE TYPES
// ============================================================================

function generateVoxelMask(terrainProvider, chunkX, chunkZ) {
    const worldMinX = chunkX * CHUNK_SIZE;
    const worldMinZ = chunkZ * CHUNK_SIZE;
    const mask = new Uint8Array(CHUNK_SIZE * CHUNK_SIZE);
    
    for (let lz = 0; lz < CHUNK_SIZE; lz++) {
        for (let lx = 0; lx < CHUNK_SIZE; lx++) {
            mask[lz * CHUNK_SIZE + lx] = terrainProvider.shouldUseVoxels(worldMinX + lx, worldMinZ + lz) ? 1 : 0;
        }
    }
    return mask;
}

function generateSurfaceTypes(terrainProvider, chunkX, chunkZ) {
    const worldMinX = chunkX * CHUNK_SIZE;
    const worldMinZ = chunkZ * CHUNK_SIZE;
    const surfaceTypes = new Uint8Array(CHUNK_SIZE * CHUNK_SIZE);
    
    for (let lz = 0; lz < CHUNK_SIZE; lz++) {
        for (let lx = 0; lx < CHUNK_SIZE; lx++) {
            const blockType = terrainProvider.getSurfaceBlockType(worldMinX + lx, worldMinZ + lz);
            surfaceTypes[lz * CHUNK_SIZE + lx] = getBlockTypeId(blockType);
        }
    }
    return surfaceTypes;
}

function generateBlockData(terrainProvider, chunkX, chunkZ) {
    const worldMinX = chunkX * CHUNK_SIZE;
    const worldMinZ = chunkZ * CHUNK_SIZE;
    const blockData = new Uint8Array(CHUNK_SIZE * MAX_HEIGHT * CHUNK_SIZE);
    const LANDMARK_MAX_HEIGHT = 20;
    
    for (let lz = 0; lz < CHUNK_SIZE; lz++) {
        for (let lx = 0; lx < CHUNK_SIZE; lx++) {
            const x = worldMinX + lx;
            const z = worldMinZ + lz;
            const terrainHeight = terrainProvider.getHeight(x, z);
            const maxH = Math.min(Math.max(terrainHeight, WATER_LEVEL) + LANDMARK_MAX_HEIGHT, MAX_HEIGHT - 1);
            
            for (let y = 0; y <= maxH; y++) {
                const blockType = terrainProvider.getBlockType(x, y, z);
                blockData[getBlockIndex(lx, y, lz)] = getBlockTypeId(blockType);
            }
        }
    }
    return blockData;
}

// ============================================================================
// SURFACE MESH - IMPROVED NORMAL COMPUTATION
// ============================================================================

/**
 * Compute heightmap normal using proper gradient calculation
 * FIXED: Original used arbitrary ny=2.0 constant
 */
/**
 * Compute normal at heightmap vertex
 * Uses terrainProvider for boundary samples to ensure continuous normals across chunks
 */
function computeHeightmapNormal(heightmap, lx, lz, terrainProvider, worldMinX, worldMinZ) {
    // Get height, using terrainProvider for out-of-bounds samples
    const getH = (x, z) => {
        if (x >= 0 && x < HEIGHTMAP_SIZE && z >= 0 && z < HEIGHTMAP_SIZE) {
            return heightmap[z * HEIGHTMAP_SIZE + x];
        }
        // Out of bounds - query actual terrain for continuous normals across chunks
        const worldX = worldMinX + x;
        const worldZ = worldMinZ + z;
        return terrainProvider.getContinuousHeight(worldX, worldZ);
    };
    
    const hL = getH(lx - 1, lz);
    const hR = getH(lx + 1, lz);
    const hD = getH(lx, lz - 1);
    const hU = getH(lx, lz + 1);
    
    const dHdx = (hR - hL) * 0.5;
    const dHdz = (hU - hD) * 0.5;
    
    let nx = -dHdx;
    let ny = 1.0;
    let nz = -dHdz;
    
    const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
    return [nx / len, ny / len, nz / len];
}

/**
 * Compute ambient occlusion at heightmap vertex using concavity
 * Samples neighbors in a radius - if vertex is lower than average, it's occluded
 * 
 * @returns {number} AO value 0.0 (fully occluded) to 1.0 (no occlusion)
 */
function computeHeightmapAO(heightmap, lx, lz, terrainProvider, worldMinX, worldMinZ) {
    const getH = (x, z) => {
        if (x >= 0 && x < HEIGHTMAP_SIZE && z >= 0 && z < HEIGHTMAP_SIZE) {
            return heightmap[z * HEIGHTMAP_SIZE + x];
        }
        const worldX = worldMinX + x;
        const worldZ = worldMinZ + z;
        return terrainProvider.getContinuousHeight(worldX, worldZ);
    };
    
    const centerH = getH(lx, lz);
    
    // Sample 8 neighbors at radius 2 for broader AO effect
    const radius = 2;
    const neighbors = [
        [-radius, 0], [radius, 0], [0, -radius], [0, radius],  // Cardinals
        [-radius, -radius], [radius, -radius], [-radius, radius], [radius, radius]  // Diagonals
    ];
    
    let totalDiff = 0;
    for (const [dx, dz] of neighbors) {
        const neighborH = getH(lx + dx, lz + dz);
        // Positive diff means neighbor is higher (we're in a valley)
        totalDiff += Math.max(0, neighborH - centerH);
    }
    
    // Average height difference
    const avgDiff = totalDiff / neighbors.length;
    
    // Convert to AO: more difference = more occlusion
    // Scale factor controls sensitivity (higher = more contrast)
    const aoScale = 0.15;
    const occlusion = Math.min(1.0, avgDiff * aoScale);
    
    // Return AO value (1 = bright, lower = darker)
    // Clamp minimum to 0.5 to avoid completely black areas
    return Math.max(0.5, 1.0 - occlusion);
}

function generateSurfaceMesh(heightmap, voxelMask, surfaceTypes, terrainProvider, chunkX, chunkZ, useDithering = false) {
    const worldMinX = chunkX * CHUNK_SIZE;
    const worldMinZ = chunkZ * CHUNK_SIZE;

    const positions = [];
    const normals = [];
    const uvs = [];
    const colors = [];
    const indices = [];

    // Splatting attributes - only used when NOT dithering
    const tileIndices = [];   // vec4: 4 tile indices per vertex
    const blendWeights = [];  // vec4: 4 blend weights per vertex

    // Dithering attribute - only used when dithering
    const selectedTiles = []; // float: 1 tile index per vertex

    for (let lz = 0; lz < CHUNK_SIZE; lz++) {
        for (let lx = 0; lx < CHUNK_SIZE; lx++) {
            const h00 = heightmap[getHeightmapIndex(lx, lz)];
            const h10 = heightmap[getHeightmapIndex(lx + 1, lz)];
            const h01 = heightmap[getHeightmapIndex(lx, lz + 1)];
            const h11 = heightmap[getHeightmapIndex(lx + 1, lz + 1)];

            const n00 = computeHeightmapNormal(heightmap, lx, lz, terrainProvider, worldMinX, worldMinZ);
            const n10 = computeHeightmapNormal(heightmap, lx + 1, lz, terrainProvider, worldMinX, worldMinZ);
            const n01 = computeHeightmapNormal(heightmap, lx, lz + 1, terrainProvider, worldMinX, worldMinZ);
            const n11 = computeHeightmapNormal(heightmap, lx + 1, lz + 1, terrainProvider, worldMinX, worldMinZ);

            // Compute AO for each vertex
            const ao00 = computeHeightmapAO(heightmap, lx, lz, terrainProvider, worldMinX, worldMinZ);
            const ao10 = computeHeightmapAO(heightmap, lx + 1, lz, terrainProvider, worldMinX, worldMinZ);
            const ao01 = computeHeightmapAO(heightmap, lx, lz + 1, terrainProvider, worldMinX, worldMinZ);
            const ao11 = computeHeightmapAO(heightmap, lx + 1, lz + 1, terrainProvider, worldMinX, worldMinZ);

            // Pass LOCAL tile UVs (0-1) for splatting shader to use
            const baseVertex = positions.length / 3;

            if (useDithering) {
                // DITHERED MODE: Pick one tile for entire quad using weighted dithering
                const centerX = worldMinX + lx + 0.5;
                const centerZ = worldMinZ + lz + 0.5;
                const centerH = (h00 + h10 + h01 + h11) / 4;
                const selectedTile = computeDitheredTileSelection(
                    centerX, centerZ, centerH, terrainProvider, BIOMES
                );

                // Vertex 0: (lx, lz) -> local UV (0, 0)
                positions.push(lx, h00, lz);
                normals.push(...n00);
                uvs.push(0, 0);
                colors.push(ao00, ao00, ao00);
                selectedTiles.push(selectedTile);

                // Vertex 1: (lx+1, lz) -> local UV (1, 0)
                positions.push(lx + 1, h10, lz);
                normals.push(...n10);
                uvs.push(1, 0);
                colors.push(ao10, ao10, ao10);
                selectedTiles.push(selectedTile);

                // Vertex 2: (lx+1, lz+1) -> local UV (1, 1)
                positions.push(lx + 1, h11, lz + 1);
                normals.push(...n11);
                uvs.push(1, 1);
                colors.push(ao11, ao11, ao11);
                selectedTiles.push(selectedTile);

                // Vertex 3: (lx, lz+1) -> local UV (0, 1)
                positions.push(lx, h01, lz + 1);
                normals.push(...n01);
                uvs.push(0, 1);
                colors.push(ao01, ao01, ao01);
                selectedTiles.push(selectedTile);
            } else {
                // SPLATTING MODE: Compute blend weights for texture blending
                const blend00 = computeBlendWeights(worldMinX + lx, worldMinZ + lz, h00, terrainProvider, BIOMES);
                const blend10 = computeBlendWeights(worldMinX + lx + 1, worldMinZ + lz, h10, terrainProvider, BIOMES);
                const blend01 = computeBlendWeights(worldMinX + lx, worldMinZ + lz + 1, h01, terrainProvider, BIOMES);
                const blend11 = computeBlendWeights(worldMinX + lx + 1, worldMinZ + lz + 1, h11, terrainProvider, BIOMES);

                // Compute tile indices from union of all 4 vertices (prevents weight loss at boundaries)
                const quadTileIndices = computeQuadTileIndices(blend00, blend10, blend01, blend11);

                // Remap each vertex's weights to match the quad's tile index order
                const weights00 = remapWeightsToTileOrder(blend00, quadTileIndices);
                const weights10 = remapWeightsToTileOrder(blend10, quadTileIndices);
                const weights01 = remapWeightsToTileOrder(blend01, quadTileIndices);
                const weights11 = remapWeightsToTileOrder(blend11, quadTileIndices);

                // Vertex 0: (lx, lz) -> local UV (0, 0)
                positions.push(lx, h00, lz);
                normals.push(...n00);
                uvs.push(0, 0);
                colors.push(ao00, ao00, ao00);
                tileIndices.push(...quadTileIndices);
                blendWeights.push(...weights00);

                // Vertex 1: (lx+1, lz) -> local UV (1, 0)
                positions.push(lx + 1, h10, lz);
                normals.push(...n10);
                uvs.push(1, 0);
                colors.push(ao10, ao10, ao10);
                tileIndices.push(...quadTileIndices);
                blendWeights.push(...weights10);

                // Vertex 2: (lx+1, lz+1) -> local UV (1, 1)
                positions.push(lx + 1, h11, lz + 1);
                normals.push(...n11);
                uvs.push(1, 1);
                colors.push(ao11, ao11, ao11);
                tileIndices.push(...quadTileIndices);
                blendWeights.push(...weights11);

                // Vertex 3: (lx, lz+1) -> local UV (0, 1)
                positions.push(lx, h01, lz + 1);
                normals.push(...n01);
                uvs.push(0, 1);
                colors.push(ao01, ao01, ao01);
                tileIndices.push(...quadTileIndices);
                blendWeights.push(...weights01);
            }

            indices.push(baseVertex, baseVertex + 2, baseVertex + 1);
            indices.push(baseVertex, baseVertex + 3, baseVertex + 2);
        }
    }

    // Return appropriate data structure based on mode
    const result = {
        positions: new Float32Array(positions),
        normals: new Float32Array(normals),
        uvs: new Float32Array(uvs),
        colors: new Float32Array(colors),
        indices: new Uint32Array(indices),
        isEmpty: positions.length === 0
    };

    if (useDithering) {
        result.selectedTiles = new Float32Array(selectedTiles);
    } else {
        result.tileIndices = new Float32Array(tileIndices);
        result.blendWeights = new Float32Array(blendWeights);
    }

    return result;
}

// ============================================================================
// WATER MESH - MORE TRANSPARENT
// ============================================================================

function generateWaterMesh(heightmap) {
    const positions = [];
    const normals = [];
    const uvs = [];
    const colors = [];
    const indices = [];
    
    const waterUvs = getBlockUVs('water');
    const waterY = WATER_LEVEL - 0.15;
    
    for (let lz = 0; lz < CHUNK_SIZE; lz++) {
        for (let lx = 0; lx < CHUNK_SIZE; lx++) {
            const cellHeight = heightmap[lz * HEIGHTMAP_SIZE + lx];
            if (cellHeight >= WATER_LEVEL) continue;
            
            const baseVertex = positions.length / 3;
            const depth = WATER_LEVEL - cellHeight;
            
            // Less aggressive darkening for more transparent water
            // Material opacity is 0.65, vertex colors add depth variation
            const depthFactor = Math.max(0.6, 1.0 - depth * 0.05);
            
            // Brighter, more cyan-tinted water
            const r = 0.6 * depthFactor;
            const g = 0.88 * depthFactor;
            const b = 0.98 * depthFactor;
            
            positions.push(lx, waterY, lz);
            normals.push(0, 1, 0);
            uvs.push(waterUvs.uMin, waterUvs.vMin);
            colors.push(r, g, b);
            
            positions.push(lx + 1, waterY, lz);
            normals.push(0, 1, 0);
            uvs.push(waterUvs.uMax, waterUvs.vMin);
            colors.push(r, g, b);
            
            positions.push(lx + 1, waterY, lz + 1);
            normals.push(0, 1, 0);
            uvs.push(waterUvs.uMax, waterUvs.vMax);
            colors.push(r, g, b);
            
            positions.push(lx, waterY, lz + 1);
            normals.push(0, 1, 0);
            uvs.push(waterUvs.uMin, waterUvs.vMax);
            colors.push(r, g, b);
            
            indices.push(baseVertex, baseVertex + 2, baseVertex + 1);
            indices.push(baseVertex, baseVertex + 3, baseVertex + 2);
        }
    }
    
    return {
        positions: new Float32Array(positions),
        normals: new Float32Array(normals),
        uvs: new Float32Array(uvs),
        colors: new Float32Array(colors),
        indices: new Uint32Array(indices),
        isEmpty: positions.length === 0
    };
}

// ============================================================================
// VOXEL MESH
// ============================================================================

function generateVoxelMesh(terrainProvider, voxelMask, chunkX, chunkZ) {
    const worldMinX = chunkX * CHUNK_SIZE;
    const worldMinZ = chunkZ * CHUNK_SIZE;
    const opaqueData = { positions: [], normals: [], uvs: [], colors: [], indices: [] };
    const LANDMARK_MAX_HEIGHT = 20;
    
    for (let lz = 0; lz < CHUNK_SIZE; lz++) {
        for (let lx = 0; lx < CHUNK_SIZE; lx++) {
            if (voxelMask[lz * CHUNK_SIZE + lx] !== 1) continue;
            
            const x = worldMinX + lx;
            const z = worldMinZ + lz;
            const terrainHeight = terrainProvider.getHeight(x, z);
            const maxH = Math.min(Math.max(terrainHeight, WATER_LEVEL) + LANDMARK_MAX_HEIGHT, MAX_HEIGHT - 1);
            
            for (let y = 0; y <= maxH; y++) {
                const blockType = terrainProvider.getBlockType(x, y, z);
                if (!blockType) continue;
                if (blockType === 'water' || blockType === 'water_full') continue;
                
                const blockUvs = getBlockUVs(blockType);
                
                for (const [faceName, face] of Object.entries(FACES)) {
                    const [nx, ny, nz] = face.dir;
                    const neighborX = x + nx;
                    const neighborY = y + ny;
                    const neighborZ = z + nz;
                    const neighborType = terrainProvider.getBlockType(neighborX, neighborY, neighborZ);
                    
                    let visible = false;
                    if (neighborType === null) {
                        visible = true;
                    } else if (isBlockTransparent(neighborType)) {
                        visible = true;
                    }
                    
                    if (!visible && ny === 0) {
                        if (!terrainProvider.shouldUseVoxels(neighborX, neighborZ)) {
                            visible = true;
                        }
                    }
                    
                    if (!visible) continue;
                    
                    const aoNeighbors = FACE_AO_NEIGHBORS[faceName];
                    const baseVertex = opaqueData.positions.length / 3;
                    
                    for (let i = 0; i < 4; i++) {
                        const [vx, vy, vz] = face.verts[i];
                        
                        opaqueData.positions.push(lx + vx, y + vy, lz + vz);
                        opaqueData.normals.push(nx, ny, nz);
                        
                        const u = (i === 0 || i === 3) ? blockUvs.uMin : blockUvs.uMax;
                        const v = (i === 0 || i === 1) ? blockUvs.vMin : blockUvs.vMax;
                        opaqueData.uvs.push(u, v);
                        
                        const [side1Offset, cornerOffset, side2Offset] = aoNeighbors[i];
                        const side1 = terrainProvider.getBlockType(x + side1Offset[0], y + side1Offset[1], z + side1Offset[2]) !== null ? 1 : 0;
                        const corner = terrainProvider.getBlockType(x + cornerOffset[0], y + cornerOffset[1], z + cornerOffset[2]) !== null ? 1 : 0;
                        const side2 = terrainProvider.getBlockType(x + side2Offset[0], y + side2Offset[1], z + side2Offset[2]) !== null ? 1 : 0;
                        
                        const ao = (side1 && side2) ? 0 : 3 - (side1 + side2 + corner);
                        const aoValue = 0.5 + ao * 0.125;
                        opaqueData.colors.push(aoValue, aoValue, aoValue);
                    }
                    
                    opaqueData.indices.push(baseVertex, baseVertex + 1, baseVertex + 2);
                    opaqueData.indices.push(baseVertex, baseVertex + 2, baseVertex + 3);
                }
            }
        }
    }
    
    return {
        opaque: {
            positions: new Float32Array(opaqueData.positions),
            normals: new Float32Array(opaqueData.normals),
            uvs: new Float32Array(opaqueData.uvs),
            colors: new Float32Array(opaqueData.colors),
            indices: new Uint32Array(opaqueData.indices),
            isEmpty: opaqueData.positions.length === 0
        }
    };
}

// ============================================================================
// MAIN
// ============================================================================

export function generateChunkData(terrainProvider, chunkX, chunkZ, useDithering = false) {
    const worldMinX = chunkX * CHUNK_SIZE;
    const worldMinZ = chunkZ * CHUNK_SIZE;

    const heightmap = generateHeightmap(terrainProvider, chunkX, chunkZ);
    const voxelMask = generateVoxelMask(terrainProvider, chunkX, chunkZ);
    const surfaceTypes = generateSurfaceTypes(terrainProvider, chunkX, chunkZ);
    const blockData = generateBlockData(terrainProvider, chunkX, chunkZ);

    const surface = generateSurfaceMesh(heightmap, voxelMask, surfaceTypes, terrainProvider, chunkX, chunkZ, useDithering);
    const { opaque: voxelOpaque } = generateVoxelMesh(terrainProvider, voxelMask, chunkX, chunkZ);
    const water = generateWaterMesh(heightmap);

    return {
        heightmap,
        voxelMask,
        surfaceTypes,
        surface,
        opaque: voxelOpaque,
        water,
        blockData,
        worldX: worldMinX,
        worldZ: worldMinZ
    };
}

export function getTransferables(chunkData) {
    const transferables = [
        chunkData.heightmap.buffer,
        chunkData.voxelMask.buffer,
        chunkData.surfaceTypes.buffer,
        chunkData.surface.positions.buffer,
        chunkData.surface.normals.buffer,
        chunkData.surface.uvs.buffer,
        chunkData.surface.colors.buffer,
        chunkData.surface.indices.buffer,
        chunkData.opaque.positions.buffer,
        chunkData.opaque.normals.buffer,
        chunkData.opaque.uvs.buffer,
        chunkData.opaque.colors.buffer,
        chunkData.opaque.indices.buffer,
        chunkData.water.positions.buffer,
        chunkData.water.normals.buffer,
        chunkData.water.uvs.buffer,
        chunkData.water.colors.buffer,
        chunkData.water.indices.buffer,
        chunkData.blockData.buffer
    ];

    // Add mode-specific surface buffers
    if (chunkData.surface.selectedTiles) {
        // Dithering mode: single tile per vertex
        transferables.push(chunkData.surface.selectedTiles.buffer);
    } else if (chunkData.surface.tileIndices && chunkData.surface.blendWeights) {
        // Splatting mode: 4 tiles + weights per vertex
        transferables.push(chunkData.surface.tileIndices.buffer);
        transferables.push(chunkData.surface.blendWeights.buffer);
    }

    return transferables;
}