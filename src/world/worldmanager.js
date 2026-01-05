/**
 * WorldManager - High-level coordinator for all world systems
 * 
 * Architecture:
 * - Web worker generates ALL terrain data (mesh + block data + landmarks)
 * - Main thread receives and stores block data in ChunkBlockCache
 * - Collision queries the cache - NO terrain regeneration on main thread
 * - Worker is the SINGLE SOURCE OF TRUTH
 * 
 * Manages:
 * - Chunk loading/unloading with worker
 * - Object placement (trees, rocks) - uses local TerrainGenerator for now
 * - Block modifications (craters, destruction)
 * - World persistence
 * 
 * Note: TerrainGenerator and LandmarkSystem are kept on main thread ONLY for:
 * - Object exclusion zones (don't spawn trees inside temples)
 * - Object height placement
 * TODO: Move object spawning to worker to eliminate main thread terrain entirely
 */

import * as THREE from 'three';
import { TerrainGenerator, WATER_LEVEL } from './terrain/terraingenerator.js';
import { ChunkedTerrain } from './terrain/terrainchunks.js';
import { ObjectGenerator } from './objects/objectgenerator.js';
import { ChunkLoader } from './chunkloader.js';
import { LandmarkSystem } from './landmarks/landmarksystem.js';
import { TerrainDataProvider } from './terraindataprovider.js';
import { initHeightfieldCollision } from '../collision.js';

// Re-export WATER_LEVEL for API compatibility
export { WATER_LEVEL };

export class WorldManager {
    /**
     * @param {THREE.Scene} scene
     * @param {THREE.Texture} terrainTexture
     * @param {number} seed
     * @param {string} worldId
     * @param {Object} options - Graphics options
     * @param {string} options.textureBlending - 'high' | 'medium' | 'low'
     * @param {string} options.drawDistance - 'far' | 'medium' | 'near'
     */
    constructor(scene, terrainTexture, seed, worldId, options = {}) {
        this.scene = scene;
        this.seed = seed;
        this.worldId = worldId;

        // Graphics settings (resolved from settingsManager)
        this.textureBlending = options.textureBlending || 'high';
        this.drawDistance = options.drawDistance || 'far';

        // Legacy isMobile detection - now derived from textureBlending
        this.isMobile = this.textureBlending !== 'high';

        this.initialized = false;

        console.log(`Creating world: seed=${seed}, id=${worldId}, textureBlending=${this.textureBlending}`);

        // Create terrain generator (kept for object placement - uses height data)
        // Note: Worker is the source of truth for collision, but objects still need
        // height queries during placement and landmark exclusion zones
        this.terrain = new TerrainGenerator(seed);

        // Create landmark system (kept ONLY for object exclusion zones)
        // The worker has its own LandmarkSystem for actual block generation
        this.landmarkSystem = new LandmarkSystem(this.terrain, seed);

        // Connect landmark system to terrain generator (for object height queries)
        this.terrain.setLandmarkSystem(this.landmarkSystem);

        // Create chunked terrain renderer
        this.chunkedTerrain = new ChunkedTerrain(this.scene, this.terrain, terrainTexture, this.textureBlending);

        // Create object generator
        // Pass 'this' (WorldManager) as terrain provider - it has getHeight() and getBiome()
        // that use the block cache, ensuring trees are at correct height
        this.objectGenerator = new ObjectGenerator(this, seed, this.landmarkSystem);

        // Create chunk loader (no initial sync load)
        this.chunkLoader = new ChunkLoader(
            worldId,
            this.chunkedTerrain,
            this.objectGenerator,
            null
        );

        // Terrain data provider will be created after worker is initialized
        // This is what collision and game logic should use
        this.terrainDataProvider = null;

        // Stats
        this.updateCount = 0;
    }

    /**
     * Initialize the world (async)
     * Call this before starting the game loop
     * @param {Object} playerPosition - Initial player position {x, y, z}
     * @param {Function} onProgress - Callback for progress updates (loaded, total)
     * @returns {Promise} Resolves when initial chunks are ready
     */
    async init(playerPosition, onProgress = null) {
        console.log('Initializing world...');
        const startTime = performance.now();

        // Initialize worker with textureBlending setting
        await this.chunkLoader.initWorker(this.seed, this.textureBlending);

        // Create terrain data provider that routes to worker's block cache
        this.terrainDataProvider = new TerrainDataProvider(this.chunkLoader.workerManager);

        // Initialize heightfield collision system with the block cache
        // This enables smooth collision on heightfield terrain (voxelMask = 0)
        initHeightfieldCollision(this.chunkLoader.workerManager.blockCache);

        // Request chunks around player position
        const chunksNeeded = this.chunkLoader.requestChunksAround(playerPosition);
        console.log(`Queued ${chunksNeeded} chunks for initial load`);

        // Wait for minimum safe terrain
        await this.waitForSafeTerrain(playerPosition, onProgress);

        const initTime = performance.now() - startTime;
        console.log(`World initialized in ${initTime.toFixed(0)}ms`);
        console.log(`Chunks loaded: ${this.chunkLoader.chunksWithMeshes.size}`);

        this.initialized = true;
        return true;
    }

    /**
     * Wait until minimum safe terrain exists around player
     * @param {Object} position - Player position
     * @param {Function} onProgress - Progress callback
     */
    async waitForSafeTerrain(position, onProgress) {
        const minSafeChunks = (this.chunkLoader.minSafeDistance * 2 + 1) ** 2;
        
        return new Promise((resolve) => {
            const checkReady = () => {
                const loaded = this.chunkLoader.chunksWithMeshes.size;
                const pending = this.chunkLoader.getPendingCount();
                const total = loaded + pending;

                if (onProgress) {
                    onProgress(loaded, minSafeChunks);
                }

                if (this.chunkLoader.hasSafeTerrainAround(position)) {
                    resolve();
                } else {
                    requestAnimationFrame(checkReady);
                }
            };
            checkReady();
        });
    }

    /**
     * Update world systems
     * @returns {boolean} True if game should pause for loading
     */
    update(playerPosition) {
        if (!this.initialized) return true;

        this.updateCount++;

        // Update chunk loading every frame when loading, every 10 frames otherwise
        const updateFrequency = this.chunkLoader.isLoading ? 1 : 10;
        
        let needsLoading = false;
        if (this.updateCount % updateFrequency === 0) {
            needsLoading = this.chunkLoader.update(playerPosition);
        }

        // Update object visibility every 5 frames
        if (this.updateCount % 5 === 0 && this.objectGenerator) {
            this.objectGenerator.updateObjectVisibility(playerPosition);
        }

        return needsLoading;
    }

    /**
     * Get terrain height at position
     * Uses the worker's block cache data
     */
    getHeight(x, z) {
        if (this.terrainDataProvider) {
            return this.terrainDataProvider.getHeight(Math.floor(x), Math.floor(z));
        }
        // Fallback to old terrain generator if not initialized
        return this.terrain.getHeight(x, z);
    }

    /**
     * Get interpolated height at any position
     */
    getInterpolatedHeight(x, z) {
        if (this.terrainDataProvider) {
            return this.terrainDataProvider.getInterpolatedHeight(x, z);
        }
        return this.terrain.getInterpolatedHeight(x, z);
    }

    /**
     * Get biome at position
     * TODO: Move biome data to worker and cache
     */
    getBiome(x, z) {
        return this.terrain.getBiome(x, z);
    }

    /**
     * Get block type at position
     * Uses the worker's block cache - SINGLE SOURCE OF TRUTH
     */
    getBlockType(x, y, z) {
        const fx = Math.floor(x);
        const fy = Math.floor(y);
        const fz = Math.floor(z);
        
        if (this.terrainDataProvider) {
            const result = this.terrainDataProvider.getBlockType(fx, fy, fz);
            return result;
        }
        // Fallback - should not happen in normal operation
        console.warn('[BLOCK] Using fallback terrain!');
        return this.terrain.getBlockType(x, y, z);
    }
    
    /**
     * Debug: Dump block column at position
     */
    debugBlockColumn(x, z) {
        console.log(`\n=== Block Column at (${x}, ${z}) ===`);
        const chunkX = Math.floor(x / 16);
        const chunkZ = Math.floor(z / 16);
        console.log(`Chunk: (${chunkX}, ${chunkZ})`);
        console.log(`Has block data: ${this.chunkLoader.workerManager.hasBlockData(chunkX, chunkZ)}`);
        
        for (let y = 15; y >= 0; y--) {
            const block = this.getBlockType(x, y, z);
            const solid = block !== null && block !== 'water' && block !== 'water_full';
            console.log(`  Y=${y}: ${block || 'air'} ${solid ? '■' : '·'}`);
        }
        console.log('===========================\n');
    }

    /**
     * Destroy a block
     * TODO: Need to notify worker and update block cache
     */
    destroyBlock(x, y, z) {
        this.terrain.destroyBlock(x, y, z);
        this.chunkLoader.markBlockDestroyed(x, y, z);
        this.chunkedTerrain.regenerateChunkAt(x, z);
    }

    /**
     * Create explosion crater
     */
    createExplosionCrater(position, radius) {
        const intRadius = Math.ceil(radius);
        const px = Math.floor(position.x);
        const py = Math.floor(position.y);
        const pz = Math.floor(position.z);

        for (let dx = -intRadius; dx <= intRadius; dx++) {
            for (let dy = -intRadius; dy <= intRadius; dy++) {
                for (let dz = -intRadius; dz <= intRadius; dz++) {
                    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
                    if (dist <= radius) {
                        const bx = px + dx;
                        const by = py + dy;
                        const bz = pz + dz;
                        if (by > 0) {
                            this.terrain.destroyBlock(bx, by, bz);
                        }
                    }
                }
            }
        }

        this.chunkedTerrain.regenerateChunksInRadius(px, pz, intRadius + 1);
        this.chunkLoader.saveModifiedChunks();
    }

    /**
     * Get water level
     */
    getWaterLevel() {
        return WATER_LEVEL;
    }

    /**
     * Check if position is underwater
     */
    isUnderwater(x, y, z) {
        return y <= WATER_LEVEL && this.getHeight(x, z) < WATER_LEVEL;
    }

    /**
     * Get worker stats for performance monitor
     */
    getWorkerStats() {
        return this.chunkLoader.getWorkerStats();
    }

    /**
     * Check if currently loading
     */
    isLoading() {
        return this.chunkLoader.isLoading;
    }

    /**
     * Set loading state change callback
     */
    setLoadingCallback(callback) {
        this.chunkLoader.onLoadingStateChange = callback;
    }

    /**
     * Set mob spawner
     */
    setMobSpawner(mobSpawner) {
        this.chunkLoader.mobSpawner = mobSpawner;
    }

    /**
     * Get loaded chunks
     */
    getLoadedChunks() {
        return this.chunkLoader.loadedChunks;
    }

    /**
     * Clean up resources
     */
    dispose() {
        this.chunkLoader.dispose();
        if (this.chunkedTerrain.dispose) {
            this.chunkedTerrain.dispose();
        }
    }
}