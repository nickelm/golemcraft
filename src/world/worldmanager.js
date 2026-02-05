/**
 * WorldManager - High-level coordinator for all world systems
 *
 * Architecture:
 * - Web worker generates ALL terrain data (mesh + block data + landmarks + objects)
 * - Main thread receives and stores block data in ChunkBlockCache
 * - Collision queries the cache - NO terrain regeneration on main thread
 * - Worker is the SINGLE SOURCE OF TRUTH
 *
 * Manages:
 * - Chunk loading/unloading with worker
 * - Object mesh creation (trees, rocks) - positions computed in worker
 * - Block modifications (craters, destruction) - stored locally, synced to worker
 * - World persistence
 *
 * Terrain queries:
 * - getHeight(), getInterpolatedHeight(), getBlockType() - via TerrainDataProvider/ChunkBlockCache
 * - getBiome() - via TerrainDataProvider (biome data cached per chunk)
 *
 * Landmarks:
 * - LandmarkRegistry on main thread receives metadata from worker
 * - No generation on main thread - worker is source of truth
 */

import * as THREE from 'three';
import { WATER_LEVEL } from './terrain/chunkdatagenerator.js';
import { ChunkedTerrain } from './terrain/terrainchunks.js';
import { ObjectGenerator } from './objects/objectgenerator.js';
import { ChunkLoader } from './chunkloader.js';
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
     * @param {Object} options.continent - Continental mode config { enabled: boolean, baseRadius: number }
     */
    constructor(scene, terrainTexture, seed, worldId, options = {}) {
        this.scene = scene;
        this.seed = seed;
        this.worldId = worldId;

        // Graphics settings (resolved from settingsManager)
        this.textureBlending = options.textureBlending || 'high';
        this.drawDistance = options.drawDistance || 'far';

        // Continental mode config
        this.continentConfig = options.continent || null;

        // Texture arrays (for desktop shader)
        this.diffuseArray = options.diffuseArray || null;
        this.normalArray = options.normalArray || null;
        this.useTextureArrays = options.useTextureArrays || false;

        // Legacy isMobile detection - now derived from textureBlending
        this.isMobile = this.textureBlending !== 'high';

        this.initialized = false;

        console.log(`Creating world: seed=${seed}, id=${worldId}, textureBlending=${this.textureBlending}, useTextureArrays=${this.useTextureArrays}`);

        // Block modifications - tracked locally and synced to worker
        this.destroyedBlocks = new Set();

        // Create chunked terrain renderer (pass texture array options)
        this.chunkedTerrain = new ChunkedTerrain(
            this.scene,
            null,
            terrainTexture,
            this.textureBlending,
            {
                diffuseArray: this.diffuseArray,
                normalArray: this.normalArray,
                useTextureArrays: this.useTextureArrays
            }
        );

        // Create object generator (mesh factory only - positions come from worker)
        this.objectGenerator = new ObjectGenerator(seed);

        // Create chunk loader (no initial sync load)
        this.chunkLoader = new ChunkLoader(
            worldId,
            this.chunkedTerrain,
            this.objectGenerator,
            null,
            this.drawDistance  // Pass from constructor options
        );

        // Connect destroyedBlocks to chunk loader for worker context
        this.chunkLoader.setDestroyedBlocksRef(this.destroyedBlocks);

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

        // Initialize worker with textureBlending setting and continental config
        await this.chunkLoader.initWorker(this.seed, this.textureBlending, this.continentConfig);

        // Create terrain data provider that routes to worker's block cache
        this.terrainDataProvider = new TerrainDataProvider(this.chunkLoader.workerManager);

        // Initialize heightfield collision system with the block cache
        // This enables smooth collision on heightfield terrain (voxelMask = 0)
        initHeightfieldCollision(this.chunkLoader.workerManager.blockCache);

        // Wire up worker manager to chunked terrain for mesh rebuilding
        this.chunkedTerrain.setWorkerManager(this.chunkLoader.workerManager);

        // In continental mode, use worker's start position for initial chunk loading
        // (unless a saved position was provided)
        let loadAroundPosition = playerPosition;
        const workerStart = this.chunkLoader.workerManager.startPosition;
        if (workerStart && (!playerPosition || (playerPosition.x === 0 && playerPosition.z === 0))) {
            loadAroundPosition = { x: workerStart.x, y: 10, z: workerStart.z };
            console.log(`Continental mode: loading chunks around start position (${workerStart.x.toFixed(0)}, ${workerStart.z.toFixed(0)})`);
        }

        // Request chunks around player position
        const chunksNeeded = this.chunkLoader.requestChunksAround(loadAroundPosition);
        console.log(`Queued ${chunksNeeded} chunks for initial load`);

        // Wait for minimum safe terrain around the load position
        await this.waitForSafeTerrain(loadAroundPosition, onProgress);

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
        // Not yet initialized - return 0
        return 0;
    }

    /**
     * Get interpolated height at any position
     */
    getInterpolatedHeight(x, z) {
        if (this.terrainDataProvider) {
            return this.terrainDataProvider.getInterpolatedHeight(x, z);
        }
        return 0;
    }

    /**
     * Get biome at position
     * Uses the worker's block cache (biome data stored per chunk)
     */
    getBiome(x, z) {
        if (this.terrainDataProvider) {
            const biome = this.terrainDataProvider.getBiome(Math.floor(x), Math.floor(z));
            if (biome) return biome;
        }
        // Default for unloaded chunks
        return 'plains';
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
            return this.terrainDataProvider.getBlockType(fx, fy, fz);
        }
        // Not yet initialized
        return null;
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
     * Stores locally and syncs to worker for chunk regeneration
     */
    destroyBlock(x, y, z) {
        const key = `${Math.floor(x)},${Math.floor(y)},${Math.floor(z)}`;
        this.destroyedBlocks.add(key);

        // Sync to worker and trigger chunk regeneration
        if (this.chunkLoader.workerManager) {
            this.chunkLoader.workerManager.updateDestroyedBlocks(this.destroyedBlocks);
        }
        this.chunkedTerrain.regenerateChunkAt(x, z);
    }

    /**
     * Create explosion crater
     * Destroys blocks in cache for immediate mesh rebuild, then syncs to worker for persistence
     * Also marks heightfield holes where crater is visible from above
     */
    createExplosionCrater(position, radius) {
        const intRadius = Math.ceil(radius);
        const px = Math.floor(position.x);
        const py = Math.floor(position.y);
        const pz = Math.floor(position.z);

        // Track which (x,z) cells have blocks destroyed at or near surface
        const holeCells = new Set();

        // Get block cache for immediate destruction
        const blockCache = this.chunkLoader.workerManager?.blockCache;

        for (let dx = -intRadius; dx <= intRadius; dx++) {
            for (let dy = -intRadius; dy <= intRadius; dy++) {
                for (let dz = -intRadius; dz <= intRadius; dz++) {
                    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
                    if (dist <= radius) {
                        const bx = px + dx;
                        const by = py + dy;
                        const bz = pz + dz;
                        if (by > 0) {  // Bedrock at y=0 is indestructible
                            // Add to destroyedBlocks set for persistence/worker sync
                            const key = `${bx},${by},${bz}`;
                            this.destroyedBlocks.add(key);

                            // Destroy block in cache for immediate mesh rebuild
                            if (blockCache) {
                                blockCache.destroyBlockAt(bx, by, bz);
                            }

                            // Check if this block is at or near the terrain surface
                            // Mark (x,z) as a hole cell if explosion reaches surface level
                            const terrainHeight = this.getHeight(bx, bz);
                            if (by >= terrainHeight - 1 && by <= terrainHeight + 1) {
                                holeCells.add(`${bx},${bz}`);
                            }
                        }
                    }
                }
            }
        }

        // Add heightfield holes where crater is visible from above
        if (blockCache) {
            for (const cellKey of holeCells) {
                const [x, z] = cellKey.split(',').map(Number);
                blockCache.addHeightfieldHole(x, z);
            }
        }

        // Sync to worker for persistence (background)
        if (this.chunkLoader.workerManager) {
            this.chunkLoader.workerManager.updateDestroyedBlocks(this.destroyedBlocks);
            this.chunkLoader.workerManager.updateHeightfieldHoles();
        }

        // Rebuild chunk meshes immediately (no worker round-trip)
        this.chunkedTerrain.regenerateChunksInRadius(px, pz, intRadius + 1);

        // Remove trees and other objects in explosion radius
        if (this.objectGenerator) {
            this.objectGenerator.removeObjectsInRadius(position, radius + 1);
        }

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