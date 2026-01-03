import * as THREE from 'three';
import { TerrainGenerator, WATER_LEVEL } from './terrain/terraingenerator.js';
import { ChunkedTerrain } from './terrain/terrainchunks.js';
import { ObjectGenerator } from './objects/objectgenerator.js';
import { ChunkLoader } from './chunkloader.js';
import { LandmarkSystem } from './landmarks/landmarksystem.js';

/**
 * WorldManager - High-level coordinator for all world systems
 * 
 * Manages:
 * - Terrain generation (height, biomes)
 * - Chunk loading/unloading
 * - Object placement (trees, rocks)
 * - Landmark generation (temples, ruins)
 * - Block modifications (craters, destruction)
 * - World persistence
 * 
 * Provides a clean API for Game to interact with the world.
 */
export class WorldManager {
    constructor(scene, terrainTexture, seed, worldId, isMobile = false) {
        this.scene = scene;
        this.seed = seed;
        this.worldId = worldId;
        this.isMobile = isMobile;
        
        console.log(`Creating world: seed=${seed}, id=${worldId}`);
        
        // Create terrain generator
        this.terrain = new TerrainGenerator(seed);
        
        // Create landmark system (procedural POIs like temples)
        this.landmarkSystem = new LandmarkSystem(this.terrain, seed);
        
        // Connect landmark system to terrain generator
        this.terrain.setLandmarkSystem(this.landmarkSystem);
        
        // Create chunked terrain renderer
        this.chunkedTerrain = new ChunkedTerrain(this.scene, this.terrain, terrainTexture);
        
        // Create object generator (with landmark system for exclusion zones)
        this.objectGenerator = new ObjectGenerator(this.terrain, seed, this.landmarkSystem);
        
        // Create chunk loader (pass null for mobSpawner, will be set later if needed)
        this.chunkLoader = new ChunkLoader(
            worldId,
            this.chunkedTerrain,
            this.objectGenerator,
            null
        );
        
        // Generate initial chunks around spawn
        this.generateInitialWorld();
        
        // Stats
        this.updateCount = 0;
    }
    
    /**
     * Generate initial world around spawn point (0, 0)
     */
    generateInitialWorld() {
        console.log('Generating initial world chunks...');
        const startTime = performance.now();
        
        // Generate a 17x17 grid of chunks centered at spawn (0, 0)
        // This gives us 272x272 blocks of initial terrain (with 16x16 chunks)
        const initialRadius = 8;
        
        for (let x = -initialRadius; x <= initialRadius; x++) {
            for (let z = -initialRadius; z <= initialRadius; z++) {
                this.chunkLoader.loadChunk(x, z);
            }
        }
        
        const genTime = performance.now() - startTime;
        console.log(`Initial world generated in ${genTime.toFixed(0)}ms`);
        console.log(`Chunks: ${this.chunkLoader.loadedChunks.size}`);
        console.log(`Faces: ${this.chunkedTerrain.totalFaces}`);
        
        // Log landmark stats
        const landmarks = this.landmarkSystem.getAllLandmarks();
        console.log(`Landmarks generated: ${landmarks.length}`);
        landmarks.forEach(l => {
            console.log(`  - ${l.type} at (${l.centerX}, ${l.centerZ})`);
        });
    }
    
    /**
     * Update world systems (chunk loading/unloading, object visibility)
     * @param {THREE.Vector3} playerPosition - Current player position
     */
    update(playerPosition) {
        this.updateCount++;
        
        // Update chunk loading every 10 frames (performance optimization)
        if (this.updateCount % 10 === 0) {
            this.chunkLoader.update(playerPosition);
        }
        
        // Update object visibility every 5 frames (Solution C - distance culling)
        if (this.updateCount % 5 === 0 && this.objectGenerator) {
            this.objectGenerator.updateObjectVisibility(playerPosition);
        }
    }
    
    /**
     * Get terrain height at position (for entity spawning, etc.)
     * @param {number} x - World X coordinate
     * @param {number} z - World Z coordinate
     * @returns {number} Terrain height
     */
    getHeight(x, z) {
        return this.terrain.getHeight(x, z);
    }
    
    /**
     * Get interpolated height at any position (for smooth entity movement)
     * @param {number} x - World X coordinate (can be fractional)
     * @param {number} z - World Z coordinate (can be fractional)
     * @returns {number} Interpolated height
     */
    getInterpolatedHeight(x, z) {
        return this.terrain.getInterpolatedHeight(x, z);
    }
    
    /**
     * Get biome at position
     * @param {number} x - World X coordinate
     * @param {number} z - World Z coordinate
     * @returns {string} Biome name
     */
    getBiome(x, z) {
        return this.terrain.getBiome(x, z);
    }
    
    /**
     * Get block type at position
     * @param {number} x - World X coordinate
     * @param {number} y - World Y coordinate
     * @param {number} z - World Z coordinate
     * @returns {string|null} Block type or null if air
     */
    getBlockType(x, y, z) {
        return this.terrain.getBlockType(x, y, z);
    }
    
    /**
     * Destroy a block (for explosions, mining, etc.)
     * @param {number} x - World X coordinate
     * @param {number} y - World Y coordinate
     * @param {number} z - World Z coordinate
     */
    destroyBlock(x, y, z) {
        this.terrain.destroyBlock(x, y, z);
        this.chunkLoader.markBlockDestroyed(x, y, z);
    }
    
    /**
     * Create explosion crater
     * @param {THREE.Vector3} position - Explosion center
     * @param {number} radius - Explosion radius
     */
    createExplosionCrater(position, radius) {
        const centerX = Math.floor(position.x);
        const centerY = Math.floor(position.y);
        const centerZ = Math.floor(position.z);
        const intRadius = Math.ceil(radius);
        
        for (let dx = -intRadius; dx <= intRadius; dx++) {
            for (let dy = -intRadius; dy <= intRadius; dy++) {
                for (let dz = -intRadius; dz <= intRadius; dz++) {
                    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
                    if (dist <= radius) {
                        const x = centerX + dx;
                        const y = centerY + dy;
                        const z = centerZ + dz;
                        
                        if (y > 0) {
                            const blockType = this.terrain.getBlockType(x, y, z);
                            if (blockType && blockType !== 'water' && blockType !== 'water_full') {
                                this.destroyBlock(x, y, z);
                            }
                        }
                    }
                }
            }
        }
        
        // Regenerate affected chunks
        this.chunkedTerrain.regenerateChunksInRadius(centerX, centerZ, intRadius + 1);
    }
    
    /**
     * Get landmarks near a position (for mob spawning, etc.)
     * @param {number} x - World X coordinate
     * @param {number} z - World Z coordinate
     * @param {number} radius - Search radius
     * @returns {Array} Array of landmarks within radius
     */
    getLandmarksNear(x, z, radius) {
        const landmarks = this.landmarkSystem.getAllLandmarks();
        return landmarks.filter(l => {
            const dx = l.centerX - x;
            const dz = l.centerZ - z;
            return Math.sqrt(dx * dx + dz * dz) <= radius;
        });
    }
    
    /**
     * Get all landmarks in the world (for debug/map display)
     * @returns {Array} Array of all generated landmarks
     */
    getAllLandmarks() {
        return this.landmarkSystem.getAllLandmarks();
    }
    
    /**
     * Save world state
     */
    save() {
        this.chunkLoader.saveModifiedChunks();
    }
    
    /**
     * Set draw distance
     * @param {number} distance - Draw distance in blocks
     */
    setDrawDistance(distance) {
        const CHUNK_SIZE = 16; // Must match terrainchunks.js
        const chunks = Math.ceil(distance / CHUNK_SIZE);
        this.chunkLoader.setDrawDistance(chunks);
    }
    
    /**
     * Set object render distance (configurable for future settings)
     * @param {number} distance - Object render distance in blocks
     */
    setObjectRenderDistance(distance) {
        if (this.objectGenerator) {
            this.objectGenerator.objectRenderDistance = distance;
        }
    }
    
    /**
     * Get world stats for debugging
     * @returns {Object} Stats object
     */
    getStats() {
        const chunkStats = this.chunkLoader.getStats();
        const landmarks = this.landmarkSystem.getAllLandmarks();
        
        return {
            seed: this.seed,
            worldId: this.worldId,
            waterLevel: WATER_LEVEL,
            chunks: chunkStats,
            terrain: {
                totalFaces: this.chunkedTerrain.totalFaces,
                totalChunks: this.chunkedTerrain.totalChunks
            },
            objects: {
                renderDistance: this.objectGenerator?.objectRenderDistance || 0,
                chunkCount: this.objectGenerator?.objectsByChunk.size || 0
            },
            landmarks: {
                count: landmarks.length,
                types: landmarks.reduce((acc, l) => {
                    acc[l.type] = (acc[l.type] || 0) + 1;
                    return acc;
                }, {})
            }
        };
    }
    
    /**
     * Clean up resources
     */
    dispose() {
        this.chunkLoader.clearAll();
        this.chunkedTerrain.dispose();
        this.landmarkSystem.clearCache();
    }
}

export { WATER_LEVEL };