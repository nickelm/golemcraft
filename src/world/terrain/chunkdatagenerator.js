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
 */

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

function generateSurfaceMesh(heightmap, voxelMask, surfaceTypes, terrainProvider, chunkX, chunkZ) {
    const worldMinX = chunkX * CHUNK_SIZE;
    const worldMinZ = chunkZ * CHUNK_SIZE;
    
    const positions = [];
    const normals = [];
    const uvs = [];
    const colors = [];
    const indices = [];
    
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
            
            const surfaceType = surfaceTypes[lz * CHUNK_SIZE + lx];
            const blockTypeName = Object.keys(BLOCK_TYPE_IDS).find(k => BLOCK_TYPE_IDS[k] === surfaceType) || 'grass';
            const blockUvs = getBlockUVs(blockTypeName);
            
            const baseVertex = positions.length / 3;
            
            positions.push(lx, h00, lz);
            normals.push(...n00);
            uvs.push(blockUvs.uMin, blockUvs.vMin);
            colors.push(ao00, ao00, ao00);
            
            positions.push(lx + 1, h10, lz);
            normals.push(...n10);
            uvs.push(blockUvs.uMax, blockUvs.vMin);
            colors.push(ao10, ao10, ao10);
            
            positions.push(lx + 1, h11, lz + 1);
            normals.push(...n11);
            uvs.push(blockUvs.uMax, blockUvs.vMax);
            colors.push(ao11, ao11, ao11);
            
            positions.push(lx, h01, lz + 1);
            normals.push(...n01);
            uvs.push(blockUvs.uMin, blockUvs.vMax);
            colors.push(ao01, ao01, ao01);
            
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

export function generateChunkData(terrainProvider, chunkX, chunkZ) {
    const worldMinX = chunkX * CHUNK_SIZE;
    const worldMinZ = chunkZ * CHUNK_SIZE;
    
    const heightmap = generateHeightmap(terrainProvider, chunkX, chunkZ);
    const voxelMask = generateVoxelMask(terrainProvider, chunkX, chunkZ);
    const surfaceTypes = generateSurfaceTypes(terrainProvider, chunkX, chunkZ);
    const blockData = generateBlockData(terrainProvider, chunkX, chunkZ);
    
    const surface = generateSurfaceMesh(heightmap, voxelMask, surfaceTypes, terrainProvider, chunkX, chunkZ);
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
    return [
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
}