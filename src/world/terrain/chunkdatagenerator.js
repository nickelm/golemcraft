/**
 * ChunkDataGenerator - Pure data generation for chunk meshes AND block data
 * 
 * This module contains NO Three.js dependencies and can be used by:
 * - Web Worker (primary - generates everything)
 * 
 * It generates:
 * - Heightmap: Float32Array of continuous heights for smooth terrain
 * - Surface mesh: triangulated heightmap with texture blending
 * - Voxel mesh: block geometry for caves, structures, cliffs
 * - Block data: Uint8Array for collision in voxel regions
 * - Voxel mask: Uint8Array indicating which cells use voxel collision
 * 
 * The worker is the SINGLE SOURCE OF TRUTH for terrain data.
 * 
 * SMOOTH TERRAIN ARCHITECTURE:
 * - Heightmap stores continuous float heights at grid vertices
 * - Surface mesh renders smooth terrain as triangles
 * - Voxel mask indicates XZ cells that need voxel rendering/collision
 * - Block data only queried for collision in voxel regions
 */

// ============================================================================
// CONSTANTS
// ============================================================================

export const CHUNK_SIZE = 16;
export const CHUNK_HEIGHT = 64;
export const MAX_HEIGHT = 64;
export const WATER_LEVEL = 6;

// Heightmap has +1 vertices in each dimension (corners, not centers)
const HEIGHTMAP_SIZE = CHUNK_SIZE + 1;

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

// Face definitions for voxel mesh generation
const FACES = {
    top:    { dir: [0, 1, 0], verts: [[0,1,0], [0,1,1], [1,1,1], [1,1,0]] },
    bottom: { dir: [0, -1, 0], verts: [[0,0,1], [0,0,0], [1,0,0], [1,0,1]] },
    front:  { dir: [0, 0, 1], verts: [[0,0,1], [1,0,1], [1,1,1], [0,1,1]] },
    back:   { dir: [0, 0, -1], verts: [[1,0,0], [0,0,0], [0,1,0], [1,1,0]] },
    right:  { dir: [1, 0, 0], verts: [[1,0,1], [1,0,0], [1,1,0], [1,1,1]] },
    left:   { dir: [-1, 0, 0], verts: [[0,0,0], [0,0,1], [0,1,1], [0,1,0]] }
};

// UV coordinates for face vertices
const FACE_UVS = [[0, 0], [1, 0], [1, 1], [0, 1]];

// AO neighbor offsets per face per vertex
const FACE_AO_NEIGHBORS = {
    top: [
        [[0, 1, -1], [-1, 1, -1], [-1, 1, 0]],
        [[0, 1, 1], [-1, 1, 1], [-1, 1, 0]],
        [[0, 1, 1], [1, 1, 1], [1, 1, 0]],
        [[0, 1, -1], [1, 1, -1], [1, 1, 0]]
    ],
    bottom: [
        [[0, -1, 1], [-1, -1, 1], [-1, -1, 0]],
        [[0, -1, -1], [-1, -1, -1], [-1, -1, 0]],
        [[0, -1, -1], [1, -1, -1], [1, -1, 0]],
        [[0, -1, 1], [1, -1, 1], [1, -1, 0]]
    ],
    front: [
        [[0, -1, 1], [-1, -1, 1], [-1, 0, 1]],
        [[0, -1, 1], [1, -1, 1], [1, 0, 1]],
        [[0, 1, 1], [1, 1, 1], [1, 0, 1]],
        [[0, 1, 1], [-1, 1, 1], [-1, 0, 1]]
    ],
    back: [
        [[0, -1, -1], [1, -1, -1], [1, 0, -1]],
        [[0, -1, -1], [-1, -1, -1], [-1, 0, -1]],
        [[0, 1, -1], [-1, 1, -1], [-1, 0, -1]],
        [[0, 1, -1], [1, 1, -1], [1, 0, -1]]
    ],
    right: [
        [[1, 0, 1], [1, -1, 1], [1, -1, 0]],
        [[1, 0, -1], [1, -1, -1], [1, -1, 0]],
        [[1, 0, -1], [1, 1, -1], [1, 1, 0]],
        [[1, 0, 1], [1, 1, 1], [1, 1, 0]]
    ],
    left: [
        [[-1, 0, -1], [-1, -1, -1], [-1, -1, 0]],
        [[-1, 0, 1], [-1, -1, 1], [-1, -1, 0]],
        [[-1, 0, 1], [-1, 1, 1], [-1, 1, 0]],
        [[-1, 0, -1], [-1, 1, -1], [-1, 1, 0]]
    ]
};

// AO intensity levels based on neighbor count (0-3 solid neighbors)
const AO_LEVELS = [1.0, 0.75, 0.5, 0.35];

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Get block type ID for encoding
 */
function getBlockTypeId(typeName) {
    return BLOCK_TYPE_IDS[typeName] ?? 0;
}

/**
 * Get block index in the 3D voxel array
 */
export function getBlockIndex(localX, y, localZ) {
    return y * (CHUNK_SIZE * CHUNK_SIZE) + localZ * CHUNK_SIZE + localX;
}

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

/**
 * Get heightmap index for local coordinates
 */
function getHeightmapIndex(localX, localZ) {
    return localZ * HEIGHTMAP_SIZE + localX;
}

// ============================================================================
// HEIGHTMAP GENERATION
// ============================================================================

/**
 * Generate continuous heightmap for a chunk
 * Heights are at grid vertices (corners), so we need CHUNK_SIZE+1 in each dimension
 * 
 * @param {Object} terrainProvider - Provider with getContinuousHeight(x, z)
 * @param {number} chunkX - Chunk X coordinate
 * @param {number} chunkZ - Chunk Z coordinate
 * @returns {Float32Array} Heightmap with (CHUNK_SIZE+1)² values
 */
function generateHeightmap(terrainProvider, chunkX, chunkZ) {
    const worldMinX = chunkX * CHUNK_SIZE;
    const worldMinZ = chunkZ * CHUNK_SIZE;
    
    const heightmap = new Float32Array(HEIGHTMAP_SIZE * HEIGHTMAP_SIZE);
    
    for (let lz = 0; lz < HEIGHTMAP_SIZE; lz++) {
        for (let lx = 0; lx < HEIGHTMAP_SIZE; lx++) {
            const wx = worldMinX + lx;
            const wz = worldMinZ + lz;
            const index = getHeightmapIndex(lx, lz);
            heightmap[index] = terrainProvider.getContinuousHeight(wx, wz);
        }
    }
    
    return heightmap;
}

/**
 * Generate voxel mask indicating which cells use voxel rendering/collision
 * 
 * @param {Object} terrainProvider - Provider with shouldUseVoxels(x, z)
 * @param {number} chunkX - Chunk X coordinate
 * @param {number} chunkZ - Chunk Z coordinate
 * @returns {Uint8Array} Mask with CHUNK_SIZE² values (0=smooth, 1=voxel)
 */
function generateVoxelMask(terrainProvider, chunkX, chunkZ) {
    const worldMinX = chunkX * CHUNK_SIZE;
    const worldMinZ = chunkZ * CHUNK_SIZE;
    
    const mask = new Uint8Array(CHUNK_SIZE * CHUNK_SIZE);
    
    for (let lz = 0; lz < CHUNK_SIZE; lz++) {
        for (let lx = 0; lx < CHUNK_SIZE; lx++) {
            const wx = worldMinX + lx;
            const wz = worldMinZ + lz;
            const index = lz * CHUNK_SIZE + lx;
            mask[index] = terrainProvider.shouldUseVoxels(wx, wz) ? 1 : 0;
        }
    }
    
    return mask;
}

/**
 * Generate surface type array for texture assignment
 * 
 * @param {Object} terrainProvider - Provider with getSurfaceBlockType(x, z)
 * @param {number} chunkX - Chunk X coordinate
 * @param {number} chunkZ - Chunk Z coordinate
 * @returns {Uint8Array} Surface types with CHUNK_SIZE² values
 */
function generateSurfaceTypes(terrainProvider, chunkX, chunkZ) {
    const worldMinX = chunkX * CHUNK_SIZE;
    const worldMinZ = chunkZ * CHUNK_SIZE;
    
    const surfaceTypes = new Uint8Array(CHUNK_SIZE * CHUNK_SIZE);
    
    for (let lz = 0; lz < CHUNK_SIZE; lz++) {
        for (let lx = 0; lx < CHUNK_SIZE; lx++) {
            const wx = worldMinX + lx;
            const wz = worldMinZ + lz;
            const index = lz * CHUNK_SIZE + lx;
            const blockType = terrainProvider.getSurfaceBlockType(wx, wz);
            surfaceTypes[index] = getBlockTypeId(blockType);
        }
    }
    
    return surfaceTypes;
}

// ============================================================================
// SURFACE MESH GENERATION (Smooth Terrain)
// ============================================================================

/**
 * Compute normal from heightmap using central differences
 * 
 * @param {Float32Array} heightmap - Heightmap array
 * @param {number} lx - Local X coordinate
 * @param {number} lz - Local Z coordinate
 * @returns {number[]} Normal vector [nx, ny, nz]
 */
function computeHeightmapNormal(heightmap, lx, lz) {
    // Sample heights with boundary clamping
    const getH = (x, z) => {
        const cx = Math.max(0, Math.min(HEIGHTMAP_SIZE - 1, x));
        const cz = Math.max(0, Math.min(HEIGHTMAP_SIZE - 1, z));
        return heightmap[getHeightmapIndex(cx, cz)];
    };
    
    const hL = getH(lx - 1, lz);
    const hR = getH(lx + 1, lz);
    const hD = getH(lx, lz - 1);
    const hU = getH(lx, lz + 1);
    
    // Gradient-based normal (scale of 2.0 in Y for reasonable steepness)
    const nx = hL - hR;
    const ny = 2.0;
    const nz = hD - hU;
    
    // Normalize
    const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
    return [nx / len, ny / len, nz / len];
}

/**
 * Generate surface mesh from heightmap
 * 
 * Boundary vertices (adjacent to voxel cells) are snapped to the highest
 * adjacent voxel top. No gap triangles - holes at height discontinuities
 * are accepted for now.
 * 
 * @param {Float32Array} heightmap - Continuous heights
 * @param {Uint8Array} voxelMask - Which cells use voxels
 * @param {Uint8Array} surfaceTypes - Block type per cell
 * @param {Object} terrainProvider - For terrain queries
 * @param {number} chunkX - Chunk X coordinate
 * @param {number} chunkZ - Chunk Z coordinate
 * @param {Uint8Array} blockData - Full 3D voxel data for height lookups
 * @returns {Object} Mesh data { positions, normals, uvs, colors, indices }
 */
function generateSurfaceMesh(heightmap, voxelMask, surfaceTypes, terrainProvider, chunkX, chunkZ, blockData) {
    const positions = [];
    const normals = [];
    const uvs = [];
    const colors = [];
    const indices = [];
    
    const VERTEX_SIZE = CHUNK_SIZE + 1;
    
    // Helper: get top solid voxel Y at a given local XZ from blockData
    function getVoxelTopY(lx, lz) {
        if (lx < 0 || lx >= CHUNK_SIZE || lz < 0 || lz >= CHUNK_SIZE) {
            return 0;
        }
        
        // Scan down from top to find highest solid block
        for (let y = CHUNK_HEIGHT - 1; y >= 0; y--) {
            const idx = y * CHUNK_SIZE * CHUNK_SIZE + lz * CHUNK_SIZE + lx;
            if (blockData[idx] !== 0) {
                return y + 1; // Top of block
            }
        }
        return 0;
    }
    
    // Helper: check if cell is voxelized
    function isVoxel(lx, lz) {
        if (lx < 0 || lx >= CHUNK_SIZE || lz < 0 || lz >= CHUNK_SIZE) {
            return false;
        }
        return voxelMask[lz * CHUNK_SIZE + lx] === 1;
    }
    
    // Helper: check if a vertex touches any voxel cell
    function isVertexOnBoundary(vx, vz) {
        return isVoxel(vx - 1, vz - 1) || isVoxel(vx, vz - 1) || 
               isVoxel(vx - 1, vz) || isVoxel(vx, vz);
    }
    
    // Helper: get the highest voxel top among all adjacent voxel cells
    function getHighestAdjacentVoxelTop(vx, vz) {
        let maxHeight = 0;
        
        const cells = [
            [vx - 1, vz - 1],
            [vx, vz - 1],
            [vx - 1, vz],
            [vx, vz]
        ];
        
        for (const [cx, cz] of cells) {
            if (isVoxel(cx, cz)) {
                const h = getVoxelTopY(cx, cz);
                if (h > maxHeight) {
                    maxHeight = h;
                }
            }
        }
        
        return maxHeight;
    }
    
    // Helper: get vertex height - snap to highest adjacent voxel if on boundary
    function getVertexHeight(vx, vz) {
        const rawH = heightmap[vz * VERTEX_SIZE + vx];
        
        if (isVertexOnBoundary(vx, vz)) {
            // Snap to highest adjacent voxel top
            return getHighestAdjacentVoxelTop(vx, vz);
        }
        
        return rawH;
    }
    
    // Generate triangles for each smooth cell
    for (let lz = 0; lz < CHUNK_SIZE; lz++) {
        for (let lx = 0; lx < CHUNK_SIZE; lx++) {
            const maskIndex = lz * CHUNK_SIZE + lx;
            
            // Skip voxelized cells
            if (voxelMask[maskIndex] === 1) {
                continue;
            }
            
            // Get heights at four corners (snapped if on boundary)
            const h00 = getVertexHeight(lx, lz);
            const h10 = getVertexHeight(lx + 1, lz);
            const h01 = getVertexHeight(lx, lz + 1);
            const h11 = getVertexHeight(lx + 1, lz + 1);
            
            // Get normals
            const n00 = computeHeightmapNormal(heightmap, lx, lz);
            const n10 = computeHeightmapNormal(heightmap, lx + 1, lz);
            const n01 = computeHeightmapNormal(heightmap, lx, lz + 1);
            const n11 = computeHeightmapNormal(heightmap, lx + 1, lz + 1);
            
            // Get surface type for UVs
            const surfaceType = surfaceTypes[maskIndex];
            const blockTypeName = Object.keys(BLOCK_TYPE_IDS).find(
                key => BLOCK_TYPE_IDS[key] === surfaceType
            ) || 'grass';
            const blockUvs = getBlockUVs(blockTypeName);
            
            const ao = 0.9;
            const baseVertex = positions.length / 3;
            
            // Emit 4 vertices for this cell
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
            
            // Two triangles (CCW from above)
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
// VOXEL MESH GENERATION (Existing, but only for masked cells)
// ============================================================================

/**
 * Check if a cell is in the voxel mask (within chunk bounds)
 */
function isCellVoxelized(lx, lz, voxelMask) {
    if (lx < 0 || lx >= CHUNK_SIZE || lz < 0 || lz >= CHUNK_SIZE) {
        // Outside chunk - assume smooth (conservative)
        return false;
    }
    return voxelMask[lz * CHUNK_SIZE + lx] === 1;
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
 * Generate water mesh for ALL cells (both smooth and voxel regions)
 * Water is always rendered as a flat plane at WATER_LEVEL
 * 
 * @param {Object} terrainProvider - Terrain data provider
 * @param {Float32Array} heightmap - Continuous heights  
 * @param {number} chunkX - Chunk X coordinate
 * @param {number} chunkZ - Chunk Z coordinate
 * @returns {Object} Water mesh data
 */
function generateWaterMesh(terrainProvider, heightmap, chunkX, chunkZ) {
    const worldMinX = chunkX * CHUNK_SIZE;
    const worldMinZ = chunkZ * CHUNK_SIZE;
    
    const positions = [];
    const normals = [];
    const uvs = [];
    const colors = [];
    const indices = [];
    
    const waterUvs = getBlockUVs('water');
    
    for (let lz = 0; lz < CHUNK_SIZE; lz++) {
        for (let lx = 0; lx < CHUNK_SIZE; lx++) {
            // Check if any corner is below water level
            const h00 = heightmap[getHeightmapIndex(lx, lz)];
            const h10 = heightmap[getHeightmapIndex(lx + 1, lz)];
            const h01 = heightmap[getHeightmapIndex(lx, lz + 1)];
            const h11 = heightmap[getHeightmapIndex(lx + 1, lz + 1)];
            
            const maxHeight = Math.max(h00, h10, h01, h11);
            
            // Only generate water if terrain is below water level
            if (maxHeight >= WATER_LEVEL) {
                continue;
            }
            
            // Water surface at WATER_LEVEL (not below)
            const waterY = WATER_LEVEL;
            
            // Calculate water depth for coloring
            const avgHeight = (h00 + h10 + h01 + h11) / 4;
            const depth = WATER_LEVEL - avgHeight;
            const depthFactor = Math.max(0.3, Math.pow(0.7, depth));
            const blueness = Math.min(1.0, 0.3 + depth * 0.15);
            
            const r = depthFactor * (1.0 - blueness * 0.7);
            const g = depthFactor * (1.0 - blueness * 0.4);
            const b = Math.max(0.5, depthFactor + blueness * 0.3);
            
            const baseVertex = positions.length / 3;
            
            // Vertex 0: (lx, waterY, lz)
            positions.push(lx, waterY, lz);
            normals.push(0, 1, 0);
            uvs.push(waterUvs.uMin, waterUvs.vMin);
            colors.push(r, g, b);
            
            // Vertex 1: (lx+1, waterY, lz)
            positions.push(lx + 1, waterY, lz);
            normals.push(0, 1, 0);
            uvs.push(waterUvs.uMax, waterUvs.vMin);
            colors.push(r, g, b);
            
            // Vertex 2: (lx+1, waterY, lz+1)
            positions.push(lx + 1, waterY, lz + 1);
            normals.push(0, 1, 0);
            uvs.push(waterUvs.uMax, waterUvs.vMax);
            colors.push(r, g, b);
            
            // Vertex 3: (lx, waterY, lz+1)
            positions.push(lx, waterY, lz + 1);
            normals.push(0, 1, 0);
            uvs.push(waterUvs.uMin, waterUvs.vMax);
            colors.push(r, g, b);
            
            // Triangle 1: 0-2-1 (CCW when viewed from above)
            indices.push(baseVertex, baseVertex + 2, baseVertex + 1);
            // Triangle 2: 0-3-2 (CCW when viewed from above)
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

/**
 * Generate voxel mesh for masked cells only
 * 
 * @param {Object} terrainProvider - Terrain data provider
 * @param {Uint8Array} voxelMask - Which cells use voxels
 * @param {number} chunkX - Chunk X coordinate
 * @param {number} chunkZ - Chunk Z coordinate
 * @returns {Object} { opaque, water } mesh data
 */
function generateVoxelMesh(terrainProvider, voxelMask, chunkX, chunkZ) {
    const worldMinX = chunkX * CHUNK_SIZE;
    const worldMinZ = chunkZ * CHUNK_SIZE;
    
    const opaqueData = { positions: [], normals: [], uvs: [], colors: [], indices: [] };
    
    const LANDMARK_MAX_HEIGHT = 20;
    
    for (let lz = 0; lz < CHUNK_SIZE; lz++) {
        for (let lx = 0; lx < CHUNK_SIZE; lx++) {
            const maskIndex = lz * CHUNK_SIZE + lx;
            
            // Only generate voxel mesh for masked cells
            if (voxelMask[maskIndex] !== 1) {
                continue;
            }
            
            const x = worldMinX + lx;
            const z = worldMinZ + lz;
            
            const terrainHeight = terrainProvider.getHeight(x, z);
            const maxH = Math.min(
                Math.max(terrainHeight, WATER_LEVEL) + LANDMARK_MAX_HEIGHT,
                MAX_HEIGHT - 1
            );
            
            for (let y = 0; y <= maxH; y++) {
                const blockType = terrainProvider.getBlockType(x, y, z);
                if (!blockType) continue;
                
                // Skip water blocks - water is handled by generateWaterMesh
                const isWater = blockType === 'water' || blockType === 'water_full';
                if (isWater) continue;
                
                const isTransparent = isBlockTransparent(blockType);
                
                // Use standard face culling - voxel data exists for all cells
                addBlockFaces(terrainProvider, opaqueData, x, y, z, lx, lz, blockType, isTransparent);
            }
        }
    }
    
    return {
        opaque: arrayifyData(opaqueData)
    };
}

/**
 * Generate block data array for collision (all cells, for completeness)
 * In voxel regions, this is queried for collision
 * In smooth regions, heightmap is used instead
 */
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
            const maxH = Math.min(
                Math.max(terrainHeight, WATER_LEVEL) + LANDMARK_MAX_HEIGHT,
                MAX_HEIGHT - 1
            );
            
            for (let y = 0; y <= maxH; y++) {
                const blockType = terrainProvider.getBlockType(x, y, z);
                const blockIndex = getBlockIndex(lx, y, lz);
                blockData[blockIndex] = getBlockTypeId(blockType);
            }
        }
    }
    
    return blockData;
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

// ============================================================================
// MAIN GENERATION FUNCTION
// ============================================================================

/**
 * Generate complete chunk data including:
 * - Heightmap (continuous floats)
 * - Voxel mask (which cells use voxels)
 * - Surface mesh (smooth terrain)
 * - Voxel mesh (caves, structures, cliffs)
 * - Block data (for voxel collision)
 * 
 * @param {Object} terrainProvider - Object with terrain generation methods
 * @param {number} chunkX - Chunk X coordinate
 * @param {number} chunkZ - Chunk Z coordinate
 * @returns {Object} Complete chunk data for transfer
 */
export function generateChunkData(terrainProvider, chunkX, chunkZ) {
    const worldMinX = chunkX * CHUNK_SIZE;
    const worldMinZ = chunkZ * CHUNK_SIZE;
    
    // Generate heightmap (continuous floats)
    const heightmap = generateHeightmap(terrainProvider, chunkX, chunkZ);
    
    // Generate voxel mask (which cells need voxel rendering)
    const voxelMask = generateVoxelMask(terrainProvider, chunkX, chunkZ);
    
    // Generate surface types for texture mapping
    const surfaceTypes = generateSurfaceTypes(terrainProvider, chunkX, chunkZ);
    
    // Generate block data for voxel collision (needed for surface mesh gap triangles)
    const blockData = generateBlockData(terrainProvider, chunkX, chunkZ);
    
    // Generate surface mesh (smooth terrain, skips masked cells)
    const surface = generateSurfaceMesh(heightmap, voxelMask, surfaceTypes, terrainProvider, chunkX, chunkZ, blockData);
    
    // Generate voxel mesh (only for masked cells - no water, that's separate now)
    const { opaque: voxelOpaque } = generateVoxelMesh(terrainProvider, voxelMask, chunkX, chunkZ);
    
    // Generate water mesh for ALL cells (both smooth and voxel)
    const water = generateWaterMesh(terrainProvider, heightmap, chunkX, chunkZ);
    
    // Combine surface and voxel opaque meshes
    // For now, we keep them separate to allow different materials
    // Main thread can merge if desired
    
    return {
        // Smooth terrain data
        heightmap,
        voxelMask,
        surfaceTypes,
        surface,
        
        // Voxel terrain data (for backwards compatibility, also used for voxel regions)
        opaque: voxelOpaque,
        water,
        blockData,
        
        // Chunk position
        worldX: worldMinX,
        worldZ: worldMinZ
    };
}

/**
 * Get the list of transferable buffers from chunk data
 * Used for zero-copy transfer to/from worker
 */
export function getTransferables(chunkData) {
    const transferables = [
        // Smooth terrain
        chunkData.heightmap.buffer,
        chunkData.voxelMask.buffer,
        chunkData.surfaceTypes.buffer,
        chunkData.surface.positions.buffer,
        chunkData.surface.normals.buffer,
        chunkData.surface.uvs.buffer,
        chunkData.surface.colors.buffer,
        chunkData.surface.indices.buffer,
        
        // Voxel terrain
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
    
    return transferables;
}