import * as THREE from 'three';
import { BLOCK_TYPES, createBlockGeometry, WATER_LEVEL } from './terrain.js';

/**
 * ChunkedTerrain - Divides terrain into chunks for frustum culling
 * 
 * Each chunk is a separate set of InstancedMesh objects that Three.js
 * can cull when outside the camera's view frustum.
 */

export const CHUNK_SIZE = 16;

export class ChunkedTerrain {
    constructor(scene, terrain, terrainTexture) {
        this.scene = scene;
        this.terrain = terrain;
        this.terrainTexture = terrainTexture;
        this.chunks = new Map(); // key: "chunkX,chunkZ" -> { meshes: [], boundingBox }
        
        // Stats
        this.totalChunks = 0;
        this.totalBlocks = 0;
        this.visibleBlocks = 0;
    }
    
    /**
     * Generate all chunks for the world
     */
    generate(width, depth) {
        console.log(`Generating chunked terrain (${CHUNK_SIZE}x${CHUNK_SIZE} chunks)...`);
        const startTime = performance.now();
        
        // Calculate chunk boundaries
        const minChunkX = Math.floor(-width / 2 / CHUNK_SIZE);
        const maxChunkX = Math.floor((width / 2 - 1) / CHUNK_SIZE);
        const minChunkZ = Math.floor(-depth / 2 / CHUNK_SIZE);
        const maxChunkZ = Math.floor((depth / 2 - 1) / CHUNK_SIZE);
        
        let totalBlocks = 0;
        let visibleBlocks = 0;
        
        // Generate each chunk
        for (let chunkX = minChunkX; chunkX <= maxChunkX; chunkX++) {
            for (let chunkZ = minChunkZ; chunkZ <= maxChunkZ; chunkZ++) {
                const result = this.generateChunk(chunkX, chunkZ);
                totalBlocks += result.total;
                visibleBlocks += result.visible;
                this.totalChunks++;
            }
        }
        
        this.totalBlocks = totalBlocks;
        this.visibleBlocks = visibleBlocks;
        
        const genTime = performance.now() - startTime;
        console.log(`Chunked terrain generation: ${genTime.toFixed(1)}ms`);
        console.log(`Chunks: ${this.totalChunks}, Total blocks: ${totalBlocks}, Visible: ${visibleBlocks} (${(visibleBlocks/totalBlocks*100).toFixed(1)}% rendered)`);
    }
    
    /**
     * Generate a single chunk
     */
    generateChunk(chunkX, chunkZ) {
        const key = `${chunkX},${chunkZ}`;
        
        // World coordinates for this chunk
        const worldMinX = chunkX * CHUNK_SIZE;
        const worldMaxX = worldMinX + CHUNK_SIZE;
        const worldMinZ = chunkZ * CHUNK_SIZE;
        const worldMaxZ = worldMinZ + CHUNK_SIZE;
        
        // Collect blocks by type
        const blockPositions = {};
        Object.keys(BLOCK_TYPES).forEach(type => {
            blockPositions[type] = [];
        });
        
        let totalBlocks = 0;
        let visibleBlocks = 0;
        let minY = Infinity;
        let maxY = -Infinity;
        
        // Scan all positions in chunk
        for (let x = worldMinX; x < worldMaxX; x++) {
            for (let z = worldMinZ; z < worldMaxZ; z++) {
                const terrainHeight = this.terrain.getHeight(x, z);
                const maxH = Math.max(terrainHeight, WATER_LEVEL);
                
                for (let y = 0; y <= maxH; y++) {
                    const blockType = this.terrain.getBlockType(x, y, z);
                    if (!blockType) continue;
                    
                    totalBlocks++;
                    
                    // Surface-only optimization
                    const isWater = blockType === 'water' || blockType === 'water_full';
                    if (isWater || this.isBlockVisible(x, y, z)) {
                        blockPositions[blockType].push({ x, y, z });
                        visibleBlocks++;
                        
                        // Track Y bounds for bounding box
                        minY = Math.min(minY, y);
                        maxY = Math.max(maxY, y);
                    }
                }
            }
        }
        
        // Handle empty chunks
        if (visibleBlocks === 0) {
            return { total: totalBlocks, visible: 0 };
        }
        
        // Create a parent group for this chunk (enables frustum culling)
        const chunkGroup = new THREE.Group();
        chunkGroup.name = `chunk_${chunkX}_${chunkZ}`;
        
        // Set bounding box for frustum culling
        // Group position at chunk center
        const centerX = worldMinX + CHUNK_SIZE / 2;
        const centerZ = worldMinZ + CHUNK_SIZE / 2;
        const centerY = (minY + maxY) / 2;
        
        chunkGroup.position.set(centerX, centerY, centerZ);
        
        // Create instanced meshes for each block type in this chunk
        const meshes = [];
        
        Object.keys(BLOCK_TYPES).forEach(blockType => {
            const positions = blockPositions[blockType];
            if (positions.length === 0) return;
            
            const geometry = createBlockGeometry(blockType);
            const material = this.createMaterial(blockType);
            
            const instancedMesh = new THREE.InstancedMesh(geometry, material, positions.length);
            instancedMesh.receiveShadow = true;
            
            // Water renders after opaque
            if (blockType === 'water' || blockType === 'water_full' || blockType === 'ice') {
                instancedMesh.renderOrder = 1;
            }
            
            // Set instance matrices (positions relative to chunk center)
            const matrix = new THREE.Matrix4();
            positions.forEach((pos, i) => {
                matrix.setPosition(
                    pos.x - centerX,
                    pos.y - centerY,
                    pos.z - centerZ
                );
                instancedMesh.setMatrixAt(i, matrix);
            });
            
            instancedMesh.instanceMatrix.needsUpdate = true;
            
            // Compute bounding sphere for better culling
            instancedMesh.computeBoundingSphere();
            
            chunkGroup.add(instancedMesh);
            meshes.push(instancedMesh);
        });
        
        // Compute bounding box for the group
        const halfSize = CHUNK_SIZE / 2;
        const heightHalf = (maxY - minY) / 2 + 1;
        
        // Create custom bounding box for frustum culling
        chunkGroup.userData.boundingBox = new THREE.Box3(
            new THREE.Vector3(-halfSize, -heightHalf, -halfSize),
            new THREE.Vector3(halfSize, heightHalf, halfSize)
        );
        
        this.scene.add(chunkGroup);
        
        // Store chunk data
        this.chunks.set(key, {
            group: chunkGroup,
            meshes,
            worldMinX,
            worldMinZ,
            blockCount: visibleBlocks
        });
        
        return { total: totalBlocks, visible: visibleBlocks };
    }
    
    /**
     * Create material for block type
     */
    createMaterial(blockType) {
        if (blockType === 'water' || blockType === 'water_full') {
            return new THREE.MeshLambertMaterial({
                map: this.terrainTexture,
                transparent: true,
                opacity: 0.8,
                side: THREE.DoubleSide
            });
        } else if (blockType === 'ice') {
            return new THREE.MeshLambertMaterial({
                map: this.terrainTexture,
                transparent: true,
                opacity: 0.85
            });
        } else {
            return new THREE.MeshLambertMaterial({
                map: this.terrainTexture,
                flatShading: false
            });
        }
    }
    
    /**
     * Check if block has at least one exposed face
     */
    isBlockVisible(x, y, z) {
        const isAirOrWater = (type) => type === null || type === 'water' || type === 'water_full' || type === 'ice';
        
        if (isAirOrWater(this.terrain.getBlockType(x, y + 1, z))) return true;
        if (isAirOrWater(this.terrain.getBlockType(x, y - 1, z))) return true;
        if (isAirOrWater(this.terrain.getBlockType(x + 1, y, z))) return true;
        if (isAirOrWater(this.terrain.getBlockType(x - 1, y, z))) return true;
        if (isAirOrWater(this.terrain.getBlockType(x, y, z + 1))) return true;
        if (isAirOrWater(this.terrain.getBlockType(x, y, z - 1))) return true;
        
        return false;
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
     * Debug: log visible chunk count (call in render loop to verify culling)
     */
    countVisibleChunks(camera) {
        const frustum = new THREE.Frustum();
        const projScreenMatrix = new THREE.Matrix4();
        
        projScreenMatrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
        frustum.setFromProjectionMatrix(projScreenMatrix);
        
        let visible = 0;
        let totalBlocks = 0;
        
        this.chunks.forEach((chunk) => {
            // Check if chunk group intersects frustum
            const box = chunk.group.userData.boundingBox.clone();
            box.translate(chunk.group.position);
            
            if (frustum.intersectsBox(box)) {
                visible++;
                totalBlocks += chunk.blockCount;
            }
        });
        
        return { visibleChunks: visible, totalChunks: this.chunks.size, visibleBlocks: totalBlocks };
    }
    
    /**
     * Clean up all chunks
     */
    dispose() {
        this.chunks.forEach((chunk) => {
            chunk.meshes.forEach(mesh => {
                mesh.geometry.dispose();
                mesh.material.dispose();
            });
            this.scene.remove(chunk.group);
        });
        this.chunks.clear();
    }
}