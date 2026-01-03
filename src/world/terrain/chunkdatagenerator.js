/**
 * ChunkDataGenerator - Pure data generation for chunk meshes AND block data
 * 
 * This module contains NO Three.js dependencies and can be used by:
 * - Web Worker (primary - generates everything)
 * 
 * It generates:
 * - Mesh data: raw typed arrays (positions, normals, uvs, colors, indices)
 * - Block data: Uint8Array for collision queries on main thread
 * 
 * The worker is the SINGLE SOURCE OF TRUTH for terrain data.
 */

// ============================================================================
// CONSTANTS
// ============================================================================

export const CHUNK_SIZE = 16;
export const MAX_HEIGHT = 64;
export const WATER_LEVEL = 6;

// Texture atlas configuration
const ATLAS_SIZE = 720;
const CELL_SIZE = 72;
const TILE_SIZE = 64;
const GUTTER = 4;

// Block type definitions with tileset coordinates
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

// Block type ID encoding for the block data array
// Must match ChunkBlockCache.js
const BLOCK_TYPE_IDS = {
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

/**
 * Get block type ID for encoding
 */
function getBlockTypeId(typeName) {
    return BLOCK_TYPE_IDS[typeName] ?? 0;
}

/**
 * Calculate array index for a block position in the block data array
 */
function getBlockIndex(localX, y, localZ) {
    return y * (CHUNK_SIZE * CHUNK_SIZE) + localZ * CHUNK_SIZE + localX;
}

// Face definitions: normal direction and vertex offsets
// Vertices must be in CCW order when looking at the face from outside the cube
const FACES = {
    top:    { dir: [0, 1, 0],  verts: [[0,1,1], [1,1,1], [1,1,0], [0,1,0]] },
    bottom: { dir: [0, -1, 0], verts: [[0,0,0], [1,0,0], [1,0,1], [0,0,1]] },
    front:  { dir: [0, 0, 1],  verts: [[1,0,1], [1,1,1], [0,1,1], [0,0,1]] },
    back:   { dir: [0, 0, -1], verts: [[0,0,0], [0,1,0], [1,1,0], [1,0,0]] },
    right:  { dir: [1, 0, 0],  verts: [[1,0,0], [1,1,0], [1,1,1], [1,0,1]] },
    left:   { dir: [-1, 0, 0], verts: [[0,0,1], [0,1,1], [0,1,0], [0,0,0]] }
};

// UV coordinates for each face vertex
const FACE_UVS = [[0, 0], [0, 1], [1, 1], [1, 0]];

/**
 * Ambient Occlusion neighbor offsets for each face vertex
 */
const FACE_AO_NEIGHBORS = {
    top: [
        [[-1, 1, 0], [-1, 1, 1], [0, 1, 1]],
        [[1, 1, 0], [1, 1, 1], [0, 1, 1]],
        [[1, 1, 0], [1, 1, -1], [0, 1, -1]],
        [[-1, 1, 0], [-1, 1, -1], [0, 1, -1]]
    ],
    bottom: [
        [[-1, -1, 0], [-1, -1, -1], [0, -1, -1]],
        [[1, -1, 0], [1, -1, -1], [0, -1, -1]],
        [[1, -1, 0], [1, -1, 1], [0, -1, 1]],
        [[-1, -1, 0], [-1, -1, 1], [0, -1, 1]]
    ],
    front: [
        [[1, 0, 1], [1, -1, 1], [0, -1, 1]],
        [[1, 0, 1], [1, 1, 1], [0, 1, 1]],
        [[-1, 0, 1], [-1, 1, 1], [0, 1, 1]],
        [[-1, 0, 1], [-1, -1, 1], [0, -1, 1]]
    ],
    back: [
        [[-1, 0, -1], [-1, -1, -1], [0, -1, -1]],
        [[-1, 0, -1], [-1, 1, -1], [0, 1, -1]],
        [[1, 0, -1], [1, 1, -1], [0, 1, -1]],
        [[1, 0, -1], [1, -1, -1], [0, -1, -1]]
    ],
    right: [
        [[1, 0, -1], [1, -1, -1], [1, -1, 0]],
        [[1, 0, -1], [1, 1, -1], [1, 1, 0]],
        [[1, 0, 1], [1, 1, 1], [1, 1, 0]],
        [[1, 0, 1], [1, -1, 1], [1, -1, 0]]
    ],
    left: [
        [[-1, 0, 1], [-1, -1, 1], [-1, -1, 0]],
        [[-1, 0, 1], [-1, 1, 1], [-1, 1, 0]],
        [[-1, 0, -1], [-1, 1, -1], [-1, 1, 0]],
        [[-1, 0, -1], [-1, -1, -1], [-1, -1, 0]]
    ]
};

// AO intensity levels based on neighbor count (0-3 solid neighbors)
const AO_LEVELS = [1.0, 0.75, 0.5, 0.35];

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Get UV coordinates for a block type
 */
function getBlockUVs(blockType) {
    const blockDef = BLOCK_TYPES[blockType];
    if (!blockDef) {
        console.warn(`Unknown block type: ${blockType}`);
        return { uMin: 0, uMax: 1, vMin: 0, vMax: 1 };
    }
    
    const [col, row] = blockDef.tile;
    const uMin = (col * CELL_SIZE + GUTTER) / ATLAS_SIZE;
    const uMax = (col * CELL_SIZE + GUTTER + TILE_SIZE) / ATLAS_SIZE;
    const vMax = 1 - (row * CELL_SIZE + GUTTER) / ATLAS_SIZE;
    const vMin = 1 - (row * CELL_SIZE + GUTTER + TILE_SIZE) / ATLAS_SIZE;
    
    return { uMin, uMax, vMin, vMax };
}

/**
 * Check if a block type is transparent
 */
function isBlockTransparent(blockType) {
    return blockType === 'water' || blockType === 'water_full' || blockType === 'ice';
}

// ============================================================================
// MAIN GENERATION FUNCTION
// ============================================================================

/**
 * Generate chunk mesh data AND block data array
 * 
 * @param {Object} terrainProvider - Object with getHeight(x,z) and getBlockType(x,y,z) methods
 * @param {number} chunkX - Chunk X coordinate
 * @param {number} chunkZ - Chunk Z coordinate
 * @returns {Object} { opaque, water, blockData, worldX, worldZ }
 */
export function generateChunkData(terrainProvider, chunkX, chunkZ) {
    const worldMinX = chunkX * CHUNK_SIZE;
    const worldMinZ = chunkZ * CHUNK_SIZE;
    
    const opaqueData = { positions: [], normals: [], uvs: [], colors: [], indices: [] };
    const waterData = { positions: [], normals: [], uvs: [], colors: [], indices: [] };
    
    // Block data array for collision - initialize to air (0)
    const blockData = new Uint8Array(CHUNK_SIZE * MAX_HEIGHT * CHUNK_SIZE);
    
    // Include extra height for landmarks
    const LANDMARK_MAX_HEIGHT = 20;
    
    for (let x = worldMinX; x < worldMinX + CHUNK_SIZE; x++) {
        for (let z = worldMinZ; z < worldMinZ + CHUNK_SIZE; z++) {
            const localX = x - worldMinX;
            const localZ = z - worldMinZ;
            
            const terrainHeight = terrainProvider.getHeight(x, z);
            const maxH = Math.min(
                Math.max(terrainHeight, WATER_LEVEL) + LANDMARK_MAX_HEIGHT,
                MAX_HEIGHT - 1
            );
            
            for (let y = 0; y <= maxH; y++) {
                const blockType = terrainProvider.getBlockType(x, y, z);
                
                // Store block type in the block data array
                const blockIndex = getBlockIndex(localX, y, localZ);
                blockData[blockIndex] = getBlockTypeId(blockType);
                
                if (!blockType) continue;
                
                const isWater = blockType === 'water' || blockType === 'water_full';
                const isTransparent = isBlockTransparent(blockType);
                const data = isTransparent ? waterData : opaqueData;
                
                addBlockFaces(terrainProvider, data, x, y, z, localX, localZ, blockType, isTransparent);
            }
        }
    }
    
    return {
        opaque: arrayifyData(opaqueData),
        water: arrayifyData(waterData),
        blockData: blockData,
        worldX: worldMinX,
        worldZ: worldMinZ
    };
}

/**
 * Add visible faces for a block to the geometry data
 */
function addBlockFaces(terrainProvider, data, worldX, worldY, worldZ, localX, localZ, blockType, isTransparent) {
    const uvs = getBlockUVs(blockType);
    
    for (const [faceName, face] of Object.entries(FACES)) {
        // Water surface only renders top face
        if (blockType === 'water' && faceName !== 'top') continue;
        
        const [nx, ny, nz] = face.dir;
        const neighborX = worldX + nx;
        const neighborY = worldY + ny;
        const neighborZ = worldZ + nz;
        
        // Check if face is visible
        const neighborType = terrainProvider.getBlockType(neighborX, neighborY, neighborZ);
        
        let visible = false;
        if (neighborType === null) {
            visible = true;
        } else if (!isTransparent) {
            // Opaque block: show face if neighbor is water/ice
            const neighborTransparent = isBlockTransparent(neighborType);
            visible = neighborTransparent;
        }
        // Transparent blocks: only show face if neighbor is air
        
        if (!visible) continue;
        
        // Special case: water surface is pushed down
        const isWaterSurface = blockType === 'water' && faceName === 'top';
        const yOffset = isWaterSurface ? -0.2 : 0;
        
        // Get AO neighbor offsets for this face
        const aoNeighbors = FACE_AO_NEIGHBORS[faceName];
        
        const baseVertex = data.positions.length / 3;
        
        for (let i = 0; i < 4; i++) {
            const [vx, vy, vz] = face.verts[i];
            
            // Position (local to chunk)
            data.positions.push(
                localX + vx,
                worldY + vy + (vy === 1 ? yOffset : 0),
                localZ + vz
            );
            
            // Normal
            data.normals.push(nx, ny, nz);
            
            // UV
            const [uvX, uvY] = FACE_UVS[i];
            data.uvs.push(
                uvs.uMin + uvX * (uvs.uMax - uvs.uMin),
                uvs.vMin + uvY * (uvs.vMax - uvs.vMin)
            );
            
            // Calculate AO for this vertex
            let solidCount = 0;
            const vertexAO = aoNeighbors[i];
            for (const [dx, dy, dz] of vertexAO) {
                const checkType = terrainProvider.getBlockType(
                    worldX + dx,
                    worldY + dy,
                    worldZ + dz
                );
                if (checkType !== null && !isBlockTransparent(checkType)) {
                    solidCount++;
                }
            }
            
            const ao = AO_LEVELS[solidCount];
            
            // Water depth coloring
            if (isTransparent && (blockType === 'water' || blockType === 'water_full')) {
                const depth = WATER_LEVEL - worldY;
                const depthFactor = Math.max(0.1, Math.pow(0.5, depth));
                const blueness = Math.min(1.0, 0.3 + depth * 0.2);
                const r = ao * depthFactor * (1.0 - blueness * 0.8);
                const g = ao * depthFactor * (1.0 - blueness * 0.5);
                const b = ao * Math.max(0.4, depthFactor + blueness * 0.3);
                data.colors.push(r, g, b);
            } else {
                data.colors.push(ao, ao, ao);
            }
        }
        
        // Add two triangles (CCW winding)
        data.indices.push(
            baseVertex, baseVertex + 1, baseVertex + 2,
            baseVertex, baseVertex + 2, baseVertex + 3
        );
    }
}

/**
 * Convert array data to typed arrays for transfer
 */
function arrayifyData(data) {
    return {
        positions: new Float32Array(data.positions),
        normals: new Float32Array(data.normals),
        uvs: new Float32Array(data.uvs),
        colors: new Float32Array(data.colors),
        indices: new Uint32Array(data.indices),
        isEmpty: data.positions.length === 0
    };
}

/**
 * Get the list of transferable buffers from chunk data
 * Used for zero-copy transfer to/from worker
 */
export function getTransferables(chunkData) {
    return [
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
        chunkData.blockData.buffer  // Add block data to transferables
    ];
}