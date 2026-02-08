import * as THREE from 'three';
import { BLOCK_TYPES, WATER_LEVEL } from './chunkdatagenerator.js';
import {
    terrainSplatVertexShader,
    terrainSplatFragmentShader
} from '../../shaders/terrainsplat.js';
import {
    voxelLambertVertexShader,
    voxelLambertFragmentShader
} from '../../shaders/voxellambert.js';

/**
 * ChunkedTerrain - Optimized terrain with merged geometry per chunk
 *
 * Each chunk is a SINGLE mesh with all block faces merged into one geometry.
 * This minimizes draw calls (1 per chunk) while enabling frustum culling.
 *
 * IMPROVEMENTS in this version:
 * - PBR materials (MeshStandardMaterial) for better lighting response
 * - More transparent water (opacity 0.65)
 * - Optional mobile fallback to Lambert materials
 * - Texture splatting for smooth biome transitions
 */

export const CHUNK_SIZE = 16;

// Face definitions: normal direction and vertex offsets
const FACES = {
    top:    { dir: [0, 1, 0],  verts: [[0,1,1], [1,1,1], [1,1,0], [0,1,0]] },
    bottom: { dir: [0, -1, 0], verts: [[0,0,0], [1,0,0], [1,0,1], [0,0,1]] },
    front:  { dir: [0, 0, 1],  verts: [[1,0,1], [1,1,1], [0,1,1], [0,0,1]] },
    back:   { dir: [0, 0, -1], verts: [[0,0,0], [0,1,0], [1,1,0], [1,0,0]] },
    right:  { dir: [1, 0, 0],  verts: [[1,0,0], [1,1,0], [1,1,1], [1,0,1]] },
    left:   { dir: [-1, 0, 0], verts: [[0,0,1], [0,1,1], [0,1,0], [0,0,0]] }
};

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

const AO_LEVELS = [1.0, 0.75, 0.5, 0.35];

export class ChunkedTerrain {
    /**
     * @param {THREE.Scene} scene
     * @param {Object} terrain
     * @param {THREE.DataArrayTexture} diffuseArray - Diffuse texture array (128x128x9)
     * @param {THREE.Texture} waterTexture - Water texture (128x128 2D texture)
     */
    constructor(scene, terrain, diffuseArray, waterTexture) {
        this.scene = scene;
        this.terrain = terrain;
        this.diffuseArray = diffuseArray;
        this.chunks = new Map();

        // Create splatting material for surface mesh (smooth terrain with biome blending)
        this.surfaceMaterial = this.createSplatMaterial(diffuseArray);

        // Custom voxel shader material - matches terrain splatting shader lighting exactly
        this.opaqueMaterial = this.createVoxelMaterial(diffuseArray);

        // Water uses standard material for transparency
        this.waterMaterial = new THREE.MeshLambertMaterial({
            map: waterTexture,
            transparent: true,
            opacity: 0.65,
            side: THREE.DoubleSide,
            vertexColors: true,
            depthWrite: false
        });

        console.log('Using unified Lambert shaders + 4-texture splatting');

        // Stats
        this.totalChunks = 0;
        this.totalFaces = 0;
    }

    /**
     * Create the texture splatting ShaderMaterial for smooth terrain
     * @param {THREE.DataArrayTexture} diffuseArray - Diffuse texture array
     * @returns {THREE.ShaderMaterial}
     */
    createSplatMaterial(diffuseArray) {
        const uniforms = THREE.UniformsUtils.merge([
            THREE.UniformsLib.lights,
            THREE.UniformsLib.fog,
            THREE.UniformsLib.shadowmap,
            {
                diffuse: { value: new THREE.Color(0xffffff) },
                opacity: { value: 1.0 },
                uDiffuseArray: { value: diffuseArray },
                uTileScale: { value: 1.0 }
            }
        ]);

        const material = new THREE.ShaderMaterial({
            uniforms: uniforms,
            vertexShader: terrainSplatVertexShader,
            fragmentShader: terrainSplatFragmentShader,
            lights: true,
            fog: true,
            vertexColors: true,
            side: THREE.FrontSide
        });

        // Polygon offset to prevent z-fighting between surface and voxel meshes
        material.polygonOffset = true;
        material.polygonOffsetFactor = 1;
        material.polygonOffsetUnits = 1;

        return material;
    }

    /**
     * Create the custom voxel Lambert ShaderMaterial
     * Uses identical lighting calculations as the terrain splatting shader
     * @param {THREE.DataArrayTexture} diffuseArray - Diffuse texture array
     * @returns {THREE.ShaderMaterial}
     */
    createVoxelMaterial(diffuseArray) {
        return new THREE.ShaderMaterial({
            uniforms: THREE.UniformsUtils.merge([
                THREE.UniformsLib.lights,
                THREE.UniformsLib.fog,
                THREE.UniformsLib.shadowmap,
                {
                    diffuse: { value: new THREE.Color(0xffffff) },
                    opacity: { value: 1.0 },
                    uDiffuseArray: { value: diffuseArray },
                    uTileScale: { value: 1.0 }
                }
            ]),
            vertexShader: voxelLambertVertexShader,
            fragmentShader: voxelLambertFragmentShader,
            lights: true,
            fog: true,
            vertexColors: true,
            side: THREE.FrontSide
        });
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
        
        const worldMinX = chunkX * CHUNK_SIZE;
        const worldMaxX = worldMinX + CHUNK_SIZE;
        const worldMinZ = chunkZ * CHUNK_SIZE;
        const worldMaxZ = worldMinZ + CHUNK_SIZE;
        
        const opaqueData = { positions: [], normals: [], uvs: [], colors: [], indices: [] };
        const waterData = { positions: [], normals: [], uvs: [], colors: [], indices: [] };
        
        let minY = Infinity, maxY = -Infinity;
        
        const LANDMARK_MAX_HEIGHT = 20;
        
        for (let x = worldMinX; x < worldMaxX; x++) {
            for (let z = worldMinZ; z < worldMaxZ; z++) {
                const terrainHeight = this.terrain.getHeight(x, z);
                const maxH = Math.max(terrainHeight, WATER_LEVEL) + LANDMARK_MAX_HEIGHT;
                
                for (let y = 0; y <= maxH; y++) {
                    const blockType = this.terrain.getBlockType(x, y, z);
                    if (!blockType) continue;
                    
                    const isWater = blockType === 'water' || blockType === 'water_full';
                    const isTransparent = isWater || blockType === 'ice';
                    const data = isTransparent ? waterData : opaqueData;
                    
                    const facesAdded = this.addBlockFaces(x, y, z, blockType, data, isTransparent);
                    
                    if (facesAdded > 0) {
                        minY = Math.min(minY, y);
                        maxY = Math.max(maxY, y);
                    }
                }
            }
        }
        
        if (opaqueData.positions.length === 0 && waterData.positions.length === 0) {
            return 0;
        }
        
        if (minY === Infinity) minY = 0;
        if (maxY === -Infinity) maxY = WATER_LEVEL;
        
        const chunkData = { opaqueMesh: null, waterMesh: null };
        let faceCount = 0;
        
        if (opaqueData.positions.length > 0) {
            const mesh = this.createMeshFromData(opaqueData, this.opaqueMaterial, false);
            mesh.position.set(worldMinX, 0, worldMinZ);
            mesh.receiveShadow = true;
            this.scene.add(mesh);
            chunkData.opaqueMesh = mesh;
            faceCount += opaqueData.indices.length / 6;
        }
        
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
        // Simple 0-1 UVs (legacy path - actual rendering uses worker-generated meshes)
        const uvs = { uMin: 0, uMax: 1, vMin: 0, vMax: 1 };
        let facesAdded = 0;
        
        for (const [faceName, face] of Object.entries(FACES)) {
            const [nx, ny, nz] = face.dir;
            const neighborX = worldX + nx;
            const neighborY = worldY + ny;
            const neighborZ = worldZ + nz;
            
            const neighborType = this.terrain.getBlockType(neighborX, neighborY, neighborZ);
            
            let visible = false;
            if (neighborType === null) {
                visible = true;
            } else if (!isTransparent) {
                const neighborTransparent = neighborType === 'water' || neighborType === 'water_full' || neighborType === 'ice';
                visible = neighborTransparent;
            }
            
            if (!visible) continue;
            
            const isWaterSurface = blockType === 'water' && faceName === 'top';
            const yOffset = isWaterSurface ? -0.2 : 0;
            
            const localX = worldX - Math.floor(worldX / CHUNK_SIZE) * CHUNK_SIZE;
            const localZ = worldZ - Math.floor(worldZ / CHUNK_SIZE) * CHUNK_SIZE;
            
            const aoNeighbors = FACE_AO_NEIGHBORS[faceName];
            const baseVertex = data.positions.length / 3;
            
            for (let i = 0; i < 4; i++) {
                const [vx, vy, vz] = face.verts[i];
                
                data.positions.push(
                    localX + vx,
                    worldY + vy + (vy === 1 ? yOffset : 0),
                    localZ + vz
                );
                
                data.normals.push(nx, ny, nz);
                
                const [uIdx, vIdx] = FACE_UVS[i];
                data.uvs.push(
                    uIdx === 0 ? uvs.uMin : uvs.uMax,
                    vIdx === 0 ? uvs.vMin : uvs.vMax
                );
                
                // AO calculation
                let aoLevel = 0;
                if (!isTransparent && aoNeighbors) {
                    const [n1, n2, n3] = aoNeighbors[i];
                    const s1 = this.terrain.getBlockType(worldX + n1[0], worldY + n1[1], worldZ + n1[2]) !== null ? 1 : 0;
                    const s2 = this.terrain.getBlockType(worldX + n2[0], worldY + n2[1], worldZ + n2[2]) !== null ? 1 : 0;
                    const s3 = this.terrain.getBlockType(worldX + n3[0], worldY + n3[1], worldZ + n3[2]) !== null ? 1 : 0;
                    aoLevel = s1 + s2 + s3;
                    if (s1 && s3) aoLevel = 3;
                }
                
                const ao = AO_LEVELS[aoLevel];
                data.colors.push(ao, ao, ao);
            }
            
            data.indices.push(
                baseVertex, baseVertex + 1, baseVertex + 2,
                baseVertex, baseVertex + 2, baseVertex + 3
            );
            
            facesAdded++;
        }
        
        return facesAdded;
    }
    
    createMeshFromData(data, material, transparent) {
        const geometry = new THREE.BufferGeometry();
        
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(data.positions, 3));
        geometry.setAttribute('normal', new THREE.Float32BufferAttribute(data.normals, 3));
        geometry.setAttribute('uv', new THREE.Float32BufferAttribute(data.uvs, 2));
        geometry.setAttribute('color', new THREE.Float32BufferAttribute(data.colors, 3));
        geometry.setIndex(data.indices);
        
        geometry.computeBoundingSphere();
        
        const mesh = new THREE.Mesh(geometry, material);
        if (transparent) {
            mesh.renderOrder = 1;
        }
        
        return mesh;
    }
    
    /**
     * Add meshes to the scene (for chunks loaded from worker)
     */
    addChunkMeshes(chunkX, chunkZ, meshes) {
        const key = `${chunkX},${chunkZ}`;
        
        if (meshes.surfaceMesh) {
            this.scene.add(meshes.surfaceMesh);
        }
        if (meshes.opaqueMesh) {
            this.scene.add(meshes.opaqueMesh);
        }
        if (meshes.waterMesh) {
            this.scene.add(meshes.waterMesh);
        }
        
        this.chunks.set(key, meshes);
    }
    
    /**
     * Remove chunk meshes from scene
     */
    removeChunk(chunkX, chunkZ) {
        const key = `${chunkX},${chunkZ}`;
        const meshes = this.chunks.get(key);
        
        if (meshes) {
            if (meshes.surfaceMesh) {
                this.scene.remove(meshes.surfaceMesh);
                meshes.surfaceMesh.geometry.dispose();
            }
            if (meshes.opaqueMesh) {
                this.scene.remove(meshes.opaqueMesh);
                meshes.opaqueMesh.geometry.dispose();
            }
            if (meshes.waterMesh) {
                this.scene.remove(meshes.waterMesh);
                meshes.waterMesh.geometry.dispose();
            }
            this.chunks.delete(key);
        }
    }
    
    hasChunk(chunkX, chunkZ) {
        return this.chunks.has(`${chunkX},${chunkZ}`);
    }

    /**
     * Set the worker manager reference for mesh rebuilding
     * @param {TerrainWorkerManager} workerManager - The worker manager instance
     */
    setWorkerManager(workerManager) {
        this.workerManager = workerManager;
    }

    /**
     * Rebuild a chunk mesh on main thread from cached data
     * Replaces existing meshes in scene with newly generated ones
     *
     * @param {number} chunkX - Chunk X coordinate
     * @param {number} chunkZ - Chunk Z coordinate
     * @returns {boolean} True if mesh was rebuilt, false if chunk not loaded
     */
    rebuildChunkMesh(chunkX, chunkZ) {
        const key = `${chunkX},${chunkZ}`;
        const existingMeshes = this.chunks.get(key);

        // Can't rebuild if chunk isn't loaded or no worker manager
        if (!existingMeshes || !this.workerManager) {
            return false;
        }

        // Generate new meshes from cached data
        const newMeshes = this.workerManager.rebuildChunkMesh(chunkX, chunkZ);
        if (!newMeshes) {
            return false;
        }

        // Remove old surface mesh
        if (existingMeshes.surfaceMesh) {
            this.scene.remove(existingMeshes.surfaceMesh);
            existingMeshes.surfaceMesh.geometry.dispose();
        }

        // Remove old opaque mesh
        if (existingMeshes.opaqueMesh) {
            this.scene.remove(existingMeshes.opaqueMesh);
            existingMeshes.opaqueMesh.geometry.dispose();
        }

        // Remove old water mesh
        if (existingMeshes.waterMesh) {
            this.scene.remove(existingMeshes.waterMesh);
            existingMeshes.waterMesh.geometry.dispose();
        }

        // Add new meshes to scene
        if (newMeshes.surfaceMesh) {
            this.scene.add(newMeshes.surfaceMesh);
        }
        if (newMeshes.opaqueMesh) {
            this.scene.add(newMeshes.opaqueMesh);
        }
        if (newMeshes.waterMesh) {
            this.scene.add(newMeshes.waterMesh);
        }

        // Store new meshes
        this.chunks.set(key, newMeshes);
        return true;
    }

    /**
     * Request regeneration of a chunk at world position
     * Rebuilds mesh immediately using cached data (no worker round-trip)
     */
    regenerateChunkAt(x, z) {
        const chunkX = Math.floor(x / CHUNK_SIZE);
        const chunkZ = Math.floor(z / CHUNK_SIZE);
        this.rebuildChunkMesh(chunkX, chunkZ);
    }

    /**
     * Regenerate chunks in a radius around world position
     * Rebuilds all affected chunk meshes immediately using cached data
     *
     * @param {number} x - World X coordinate (center)
     * @param {number} z - World Z coordinate (center)
     * @param {number} radius - Radius in world units
     */
    regenerateChunksInRadius(x, z, radius) {
        const centerChunkX = Math.floor(x / CHUNK_SIZE);
        const centerChunkZ = Math.floor(z / CHUNK_SIZE);
        const chunkRadius = Math.ceil(radius / CHUNK_SIZE) + 1;

        let rebuiltCount = 0;
        for (let dx = -chunkRadius; dx <= chunkRadius; dx++) {
            for (let dz = -chunkRadius; dz <= chunkRadius; dz++) {
                if (this.rebuildChunkMesh(centerChunkX + dx, centerChunkZ + dz)) {
                    rebuiltCount++;
                }
            }
        }

        if (rebuiltCount > 0) {
            console.log(`[ChunkedTerrain] Rebuilt ${rebuiltCount} chunk meshes around (${centerChunkX}, ${centerChunkZ})`);
        }
    }

}