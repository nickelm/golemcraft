import * as THREE from 'three';
import { BLOCK_TYPES, WATER_LEVEL } from './terrain.js';

/**
 * ChunkedTerrain - Optimized terrain with merged geometry per chunk
 * 
 * Each chunk is a SINGLE mesh with all block faces merged into one geometry.
 * This minimizes draw calls (1 per chunk) while enabling frustum culling.
 * 
 * For a 500x500 world with 32x32 chunks:
 * - ~256 total chunks
 * - Maybe 30-50 visible at ground level looking one direction
 * - = 30-50 draw calls instead of thousands
 */

export const CHUNK_SIZE = 32;

// Texture atlas configuration
const ATLAS_SIZE = 720;      // 720x720 pixels
const CELL_SIZE = 72;        // Each cell is 72x72 (64 tile + 4 gutter on each side)
const TILE_SIZE = 64;        // Actual tile is 64x64
const GUTTER = 4;            // 4px gutter

// Get UV coordinates for a block type
function getBlockUVs(blockType) {
    const [col, row] = BLOCK_TYPES[blockType].tile;
    
    // Calculate UV bounds with gutter offset
    const uMin = (col * CELL_SIZE + GUTTER) / ATLAS_SIZE;
    const uMax = (col * CELL_SIZE + GUTTER + TILE_SIZE) / ATLAS_SIZE;
    const vMax = 1 - (row * CELL_SIZE + GUTTER) / ATLAS_SIZE;
    const vMin = 1 - (row * CELL_SIZE + GUTTER + TILE_SIZE) / ATLAS_SIZE;
    
    return { uMin, uMax, vMin, vMax };
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
// Maps to: bottom-left, top-left, top-right, bottom-right of texture
const FACE_UVS = [[0, 0], [0, 1], [1, 1], [1, 0]];

export class ChunkedTerrain {
    constructor(scene, terrain, terrainTexture) {
        this.scene = scene;
        this.terrain = terrain;
        this.terrainTexture = terrainTexture;
        this.chunks = new Map(); // key: "chunkX,chunkZ" -> { mesh, waterMesh }
        
        // Create shared materials
        this.opaqueMaterial = new THREE.MeshLambertMaterial({
            map: terrainTexture,
            side: THREE.FrontSide
        });
        
        this.waterMaterial = new THREE.MeshLambertMaterial({
            map: terrainTexture,
            transparent: true,
            opacity: 0.7,
            side: THREE.DoubleSide
        });
        
        // Stats
        this.totalChunks = 0;
        this.totalFaces = 0;
    }
    
    /**
     * Generate all chunks for the world
     */
    generate(width, depth) {
        console.log(`Generating merged-geometry chunks (${CHUNK_SIZE}x${CHUNK_SIZE})...`);
        const startTime = performance.now();
        
        const minChunkX = Math.floor(-width / 2 / CHUNK_SIZE);
        const maxChunkX = Math.floor((width / 2 - 1) / CHUNK_SIZE);
        const minChunkZ = Math.floor(-depth / 2 / CHUNK_SIZE);
        const maxChunkZ = Math.floor((depth / 2 - 1) / CHUNK_SIZE);
        
        let totalFaces = 0;
        
        for (let chunkX = minChunkX; chunkX <= maxChunkX; chunkX++) {
            for (let chunkZ = minChunkZ; chunkZ <= maxChunkZ; chunkZ++) {
                const faces = this.generateChunk(chunkX, chunkZ);
                totalFaces += faces;
                this.totalChunks++;
            }
        }
        
        this.totalFaces = totalFaces;
        
        const genTime = performance.now() - startTime;
        console.log(`Chunk generation: ${genTime.toFixed(0)}ms`);
        console.log(`Chunks: ${this.totalChunks}, Total faces: ${totalFaces}, Draw calls: ~${this.totalChunks * 2}`);
    }
    
    /**
     * Generate a single chunk with merged geometry
     */
    generateChunk(chunkX, chunkZ) {
        const key = `${chunkX},${chunkZ}`;
        
        // World coordinate bounds
        const worldMinX = chunkX * CHUNK_SIZE;
        const worldMaxX = worldMinX + CHUNK_SIZE;
        const worldMinZ = chunkZ * CHUNK_SIZE;
        const worldMaxZ = worldMinZ + CHUNK_SIZE;
        
        // Collect faces for opaque and transparent geometry separately
        const opaqueData = { positions: [], normals: [], uvs: [], indices: [] };
        const waterData = { positions: [], normals: [], uvs: [], indices: [] };
        
        let minY = Infinity, maxY = -Infinity;
        
        // Scan all positions in chunk
        for (let x = worldMinX; x < worldMaxX; x++) {
            for (let z = worldMinZ; z < worldMaxZ; z++) {
                const terrainHeight = this.terrain.getHeight(x, z);
                const maxH = Math.max(terrainHeight, WATER_LEVEL);
                
                for (let y = 0; y <= maxH; y++) {
                    const blockType = this.terrain.getBlockType(x, y, z);
                    if (!blockType) continue;
                    
                    const isWater = blockType === 'water' || blockType === 'water_full';
                    const isTransparent = isWater || blockType === 'ice';
                    const data = isTransparent ? waterData : opaqueData;
                    
                    // Add visible faces
                    const facesAdded = this.addBlockFaces(x, y, z, blockType, data, isTransparent);
                    
                    if (facesAdded > 0) {
                        minY = Math.min(minY, y);
                        maxY = Math.max(maxY, y);
                    }
                }
            }
        }
        
        // Handle empty chunks
        if (opaqueData.positions.length === 0 && waterData.positions.length === 0) {
            return 0;
        }
        
        // Clamp Y bounds
        if (minY === Infinity) minY = 0;
        if (maxY === -Infinity) maxY = WATER_LEVEL;
        
        // Create meshes
        const chunkData = { opaqueMesh: null, waterMesh: null };
        let faceCount = 0;
        
        // Opaque mesh
        if (opaqueData.positions.length > 0) {
            const mesh = this.createMeshFromData(opaqueData, this.opaqueMaterial, false);
            mesh.position.set(worldMinX, 0, worldMinZ);
            mesh.receiveShadow = true;
            this.scene.add(mesh);
            chunkData.opaqueMesh = mesh;
            faceCount += opaqueData.indices.length / 6;
        }
        
        // Water mesh (rendered after opaque)
        if (waterData.positions.length > 0) {
            const mesh = this.createMeshFromData(waterData, this.waterMaterial, true);
            mesh.position.set(worldMinX, 0, worldMinZ);
            mesh.renderOrder = 1;
            this.scene.add(mesh);
            chunkData.waterMesh = mesh;
            faceCount += waterData.indices.length / 6;
        }
        
        this.chunks.set(key, chunkData);
        
        return faceCount;
    }
    
    /**
     * Add visible faces for a block to the geometry data
     */
    addBlockFaces(worldX, worldY, worldZ, blockType, data, isTransparent) {
        const uvs = getBlockUVs(blockType);
        let facesAdded = 0;
        
        // Check each face
        for (const [faceName, face] of Object.entries(FACES)) {
            const [nx, ny, nz] = face.dir;
            const neighborX = worldX + nx;
            const neighborY = worldY + ny;
            const neighborZ = worldZ + nz;
            
            // Check if face is visible
            const neighborType = this.terrain.getBlockType(neighborX, neighborY, neighborZ);
            
            // Face is visible if neighbor is air, or if we're opaque and neighbor is transparent
            let visible = false;
            if (neighborType === null) {
                visible = true;
            } else if (!isTransparent) {
                // Opaque block: show face if neighbor is water/ice
                const neighborTransparent = neighborType === 'water' || neighborType === 'water_full' || neighborType === 'ice';
                visible = neighborTransparent;
            }
            // Transparent blocks (water/ice): only show face if neighbor is air
            // (already handled by neighborType === null check)
            
            if (!visible) continue;
            
            // Special case: water surface is pushed down
            const isWaterSurface = blockType === 'water' && faceName === 'top';
            const yOffset = isWaterSurface ? -0.2 : 0;
            
            // Add face vertices
            // Position relative to chunk origin
            const localX = worldX - Math.floor(worldX / CHUNK_SIZE) * CHUNK_SIZE;
            const localZ = worldZ - Math.floor(worldZ / CHUNK_SIZE) * CHUNK_SIZE;
            
            const baseVertex = data.positions.length / 3;
            
            for (let i = 0; i < 4; i++) {
                const [vx, vy, vz] = face.verts[i];
                
                // Position
                data.positions.push(
                    localX + vx,
                    worldY + vy + (vy === 1 ? yOffset : 0),
                    localZ + vz
                );
                
                // Normal
                data.normals.push(nx, ny, nz);
                
                // UV (map [0,1] to block's atlas region)
                const [uvX, uvY] = FACE_UVS[i];
                data.uvs.push(
                    uvs.uMin + uvX * (uvs.uMax - uvs.uMin),
                    uvs.vMin + uvY * (uvs.vMax - uvs.vMin)
                );
            }
            
            // Add two triangles (CCW winding)
            data.indices.push(
                baseVertex, baseVertex + 1, baseVertex + 2,
                baseVertex, baseVertex + 2, baseVertex + 3
            );
            
            facesAdded++;
        }
        
        return facesAdded;
    }
    
    /**
     * Create a mesh from collected geometry data
     */
    createMeshFromData(data, material, isTransparent) {
        const geometry = new THREE.BufferGeometry();
        
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(data.positions, 3));
        geometry.setAttribute('normal', new THREE.Float32BufferAttribute(data.normals, 3));
        geometry.setAttribute('uv', new THREE.Float32BufferAttribute(data.uvs, 2));
        geometry.setIndex(data.indices);
        
        // Compute bounding sphere for frustum culling
        geometry.computeBoundingSphere();
        
        const mesh = new THREE.Mesh(geometry, material);
        return mesh;
    }
    
    /**
     * Get chunk at world position
     */
    getChunkAt(worldX, worldZ) {
        const chunkX = Math.floor(worldX / CHUNK_SIZE);
        const chunkZ = Math.floor(worldZ / CHUNK_SIZE);
        return this.chunks.get(`${chunkX},${chunkZ}`);
    }
    
    /**
     * Dispose all chunks
     */
    dispose() {
        this.chunks.forEach((chunk) => {
            if (chunk.opaqueMesh) {
                chunk.opaqueMesh.geometry.dispose();
                this.scene.remove(chunk.opaqueMesh);
            }
            if (chunk.waterMesh) {
                chunk.waterMesh.geometry.dispose();
                this.scene.remove(chunk.waterMesh);
            }
        });
        this.chunks.clear();
        
        this.opaqueMaterial.dispose();
        this.waterMaterial.dispose();
    }
}