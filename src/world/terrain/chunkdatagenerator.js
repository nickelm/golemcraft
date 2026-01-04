/**
 * ChunkDataGenerator - SIMPLIFIED APPROACH
 * 
 * New strategy:
 * - Heightfield renders EVERYWHERE (no holes for voxel regions)
 * - Voxels render ON TOP of heightfield where shouldUseVoxels() is true
 * - Render order: voxels first (write Z), heightfield second (gets Z-rejected under voxels)
 * - No transition band, no seam stitching, no gaps!
 * 
 * Future: Add hole mask for cave entrances where heightfield should NOT render.
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
// BASIC GENERATION
// ============================================================================

function generateHeightmap(terrainProvider, chunkX, chunkZ) {
    const worldMinX = chunkX * CHUNK_SIZE;
    const worldMinZ = chunkZ * CHUNK_SIZE;
    const heightmap = new Float32Array(HEIGHTMAP_SIZE * HEIGHTMAP_SIZE);
    
    for (let lz = 0; lz < HEIGHTMAP_SIZE; lz++) {
        for (let lx = 0; lx < HEIGHTMAP_SIZE; lx++) {
            heightmap[getHeightmapIndex(lx, lz)] = terrainProvider.getContinuousHeight(worldMinX + lx, worldMinZ + lz);
        }
    }
    return heightmap;
}

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
// SURFACE MESH - NOW RENDERS EVERYWHERE (no voxel mask skip)
// ============================================================================

function computeHeightmapNormal(heightmap, lx, lz) {
    const getH = (x, z) => {
        const cx = Math.max(0, Math.min(HEIGHTMAP_SIZE - 1, x));
        const cz = Math.max(0, Math.min(HEIGHTMAP_SIZE - 1, z));
        return heightmap[cz * HEIGHTMAP_SIZE + cx];
    };
    
    const hL = getH(lx - 1, lz);
    const hR = getH(lx + 1, lz);
    const hD = getH(lx, lz - 1);
    const hU = getH(lx, lz + 1);
    
    const nx = hL - hR;
    const ny = 2.0;
    const nz = hD - hU;
    const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
    return [nx / len, ny / len, nz / len];
}

function generateSurfaceMesh(heightmap, voxelMask, surfaceTypes) {
    const positions = [];
    const normals = [];
    const uvs = [];
    const colors = [];
    const indices = [];
    
    // Generate triangles for ALL cells - no skipping for voxels!
    // The heightfield renders under voxels; Z-buffer handles occlusion.
    for (let lz = 0; lz < CHUNK_SIZE; lz++) {
        for (let lx = 0; lx < CHUNK_SIZE; lx++) {
            // NO SKIP - render heightfield everywhere
            // Future: skip if holeMask[lz * CHUNK_SIZE + lx] === 1 (cave entrances)
            
            const h00 = heightmap[getHeightmapIndex(lx, lz)];
            const h10 = heightmap[getHeightmapIndex(lx + 1, lz)];
            const h01 = heightmap[getHeightmapIndex(lx, lz + 1)];
            const h11 = heightmap[getHeightmapIndex(lx + 1, lz + 1)];
            
            const n00 = computeHeightmapNormal(heightmap, lx, lz);
            const n10 = computeHeightmapNormal(heightmap, lx + 1, lz);
            const n01 = computeHeightmapNormal(heightmap, lx, lz + 1);
            const n11 = computeHeightmapNormal(heightmap, lx + 1, lz + 1);
            
            const surfaceType = surfaceTypes[lz * CHUNK_SIZE + lx];
            const blockTypeName = Object.keys(BLOCK_TYPE_IDS).find(k => BLOCK_TYPE_IDS[k] === surfaceType) || 'grass';
            const blockUvs = getBlockUVs(blockTypeName);
            
            const ao = 0.9;
            const baseVertex = positions.length / 3;
            
            positions.push(lx, h00, lz);
            normals.push(...n00);
            uvs.push(blockUvs.uMin, blockUvs.vMin);
            colors.push(ao, ao, ao);
            
            positions.push(lx + 1, h10, lz);
            normals.push(...n10);
            uvs.push(blockUvs.uMax, blockUvs.vMin);
            colors.push(ao, ao, ao);
            
            positions.push(lx + 1, h11, lz + 1);
            normals.push(...n11);
            uvs.push(blockUvs.uMax, blockUvs.vMax);
            colors.push(ao, ao, ao);
            
            positions.push(lx, h01, lz + 1);
            normals.push(...n01);
            uvs.push(blockUvs.uMin, blockUvs.vMax);
            colors.push(ao, ao, ao);
            
            // Original winding order
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
// WATER MESH
// ============================================================================

function generateWaterMesh(heightmap) {
    const positions = [];
    const normals = [];
    const uvs = [];
    const colors = [];
    const indices = [];
    
    const waterUvs = getBlockUVs('water');
    const waterY = WATER_LEVEL - 0.2;
    
    for (let lz = 0; lz < CHUNK_SIZE; lz++) {
        for (let lx = 0; lx < CHUNK_SIZE; lx++) {
            const cellHeight = heightmap[lz * HEIGHTMAP_SIZE + lx];
            if (cellHeight >= WATER_LEVEL) continue;
            
            const baseVertex = positions.length / 3;
            const depth = WATER_LEVEL - cellHeight;
            const darken = Math.max(0.3, 1.0 - depth * 0.1);
            const r = 0.6 * darken, g = 0.8 * darken, b = 1.0 * darken;
            
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
// VOXEL MESH - Renders where shouldUseVoxels is true, ON TOP of heightfield
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
                    
                    // Standard visibility check
                    let visible = false;
                    if (neighborType === null) {
                        visible = true;
                    } else if (isBlockTransparent(neighborType)) {
                        visible = true;
                    }
                    
                    // Boundary check: for horizontal faces, also render if neighbor cell
                    // is NOT voxelized (i.e., it's heightfield territory)
                    // This ensures voxel blocks have solid walls at the boundary
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
    
    // Surface mesh renders EVERYWHERE now
    const surface = generateSurfaceMesh(heightmap, voxelMask, surfaceTypes);
    
    // Voxels render on top where mask says so
    const { opaque: voxelOpaque } = generateVoxelMesh(terrainProvider, voxelMask, chunkX, chunkZ);
    
    // Water
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