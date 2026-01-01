import * as THREE from 'three';
import { TerrainGenerator, WATER_LEVEL } from './terrain/terraingenerator.js';
import { ChunkedTerrain } from './terrain/terrainchunks.js';
import { ObjectGenerator } from './objects/objectgenerator.js';
import { ChunkLoader } from './chunkloader.js';

/**
 * WorldManager - High-level coordinator for all world systems
 * 
 * Manages:
 * - Terrain generation (height, biomes)
 * - Chunk loading/unloading
 * - Object placement (trees, rocks)
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
        
        // Create chunked terrain renderer
        this.chunkedTerrain = new ChunkedTerrain(this.scene, this.terrain, terrainTexture);
        
        // Create object generator
        this.objectGenerator = new ObjectGenerator(this.terrain, seed);
        
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
        // This gives us 544x544 blocks of initial terrain
        const initialRadius = 8;
        
        for (let x = -initialRadius; x <= initialRadius; x++) {
            for (let z = -initialRadius; z <= initialRadius; z++) {
                this.chunkLoader.loadChunk(x, z);
            }
        }
        
        // Generate objects for initial chunks
        this.generateInitialObjects();
        
        const genTime = performance.now() - startTime;
        console.log(`Initial world generated in ${genTime.toFixed(0)}ms`);
        console.log(`Chunks: ${this.chunkLoader.loadedChunks.size}`);
        console.log(`Faces: ${this.chunkedTerrain.totalFaces}`);
    }
    
    /**
     * Generate objects for initial world
     * Note: In future, objects will be generated per-chunk on demand
     */
    generateInitialObjects() {
        // For now, generate objects for a 500x500 area
        // TODO: Make this chunk-based in future update
        this.objectGenerator.generate(this.scene, 500, 500, WATER_LEVEL);
    }
    
    /**
     * Update world systems (chunk loading/unloading)
     * @param {THREE.Vector3} playerPosition - Current player position
     */
    update(playerPosition) {
        this.updateCount++;
        
        // Update chunk loading every 10 frames (performance optimization)
        if (this.updateCount % 10 === 0) {
            this.chunkLoader.update(playerPosition);
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
        const chunks = Math.ceil(distance / 32); // Convert blocks to chunks
        this.chunkLoader.setDrawDistance(chunks);
    }
    
    /**
     * Get world stats for debugging
     * @returns {Object} Stats object
     */
    getStats() {
        const chunkStats = this.chunkLoader.getStats();
        
        return {
            seed: this.seed,
            worldId: this.worldId,
            waterLevel: WATER_LEVEL,
            chunks: chunkStats,
            terrain: {
                totalFaces: this.chunkedTerrain.totalFaces,
                totalChunks: this.chunkedTerrain.totalChunks
            }
        };
    }
    
    /**
     * Clean up resources
     */
    dispose() {
        this.chunkLoader.clearAll();
        this.chunkedTerrain.dispose();
    }
}

export { WATER_LEVEL };