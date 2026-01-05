/**
 * TerrainWorkerManager - Manages communication with the terrain web worker
 * 
 * Handles:
 * - Worker initialization
 * - Chunk request queue with priority
 * - Chunk cancellation when out of range
 * - Receiving mesh geometry AND block data from worker
 * - Creating Three.js meshes (surface + voxel)
 * - Storing terrain data in ChunkBlockCache for collision queries
 * 
 * SMOOTH TERRAIN ARCHITECTURE:
 * - Receives both surface mesh (smooth terrain) and voxel mesh (caves/structures)
 * - Stores heightmap and voxelMask for collision routing
 * - Creates separate Three.js meshes for surface and voxel geometry
 * - Render order: voxels first (0), surface second (1), water last (2)
 * 
 * The worker is the SINGLE SOURCE OF TRUTH for terrain data.
 */

import * as THREE from 'three';
import { ChunkBlockCache } from '../world/chunkblockcache.js';

// DEBUG: Set to true to see cancellation logging
const DEBUG_CANCELLATION = false;

export class TerrainWorkerManager {
    constructor(scene, opaqueMaterial, waterMaterial, onChunkReady, surfaceMaterial = null) {
        this.scene = scene;
        this.opaqueMaterial = opaqueMaterial;
        this.waterMaterial = waterMaterial;
        this.surfaceMaterial = surfaceMaterial || opaqueMaterial;  // Fallback to opaque if not provided
        this.onChunkReady = onChunkReady;

        // Worker state
        this.worker = null;
        this.isReady = false;
        this.readyResolve = null;

        // Request management
        this.pendingRequests = new Map();  // key -> { chunkX, chunkZ, priority, context }
        this.processingChunks = new Set(); // Keys currently being processed
        this.cancelledChunks = new Set();  // Keys cancelled while processing

        // Terrain data cache - THE source of truth for collision
        this.blockCache = new ChunkBlockCache();

        // Stats
        this.stats = {
            totalGenerated: 0,
            totalCancelled: 0,
            totalDropped: 0,  // Dropped from queue before processing
            genTimes: [],
            avgGenTime: 0
        };

        // Create worker
        this.initWorker();
    }

    initWorker() {
        this.worker = new Worker(
            new URL('./terrainworker.js', import.meta.url),
            { type: 'module' }
        );

        this.worker.onmessage = (e) => this.handleWorkerMessage(e.data);
        this.worker.onerror = (e) => this.handleWorkerError(e);
    }

    handleWorkerMessage(data) {
        switch (data.type) {
            case 'ready':
                this.isReady = true;
                console.log('Terrain worker ready');
                if (this.readyResolve) {
                    this.readyResolve();
                    this.readyResolve = null;
                }
                this.processQueue();
                break;

            case 'chunkGenerated':
                this.handleChunkGenerated(data);
                break;

            case 'error':
                console.error('Terrain worker error:', data.error);
                const key = `${data.chunkX},${data.chunkZ}`;
                this.processingChunks.delete(key);
                this.processQueue();
                break;
        }
    }

    handleWorkerError(e) {
        console.error('Terrain worker error:', e);
    }

    handleChunkGenerated(data) {
        const { chunkX, chunkZ, chunkData, genTime } = data;
        const key = `${chunkX},${chunkZ}`;

        this.processingChunks.delete(key);

        // Check if cancelled while processing
        if (this.cancelledChunks.has(key)) {
            this.cancelledChunks.delete(key);
            this.stats.totalCancelled++;
            if (DEBUG_CANCELLATION) {
                console.log(`🚫 CANCELLED chunk ${key} after generation (total: ${this.stats.totalCancelled})`);
            }
            this.processQueue();
            return;
        }

        // Track generation time
        this.stats.genTimes.push(genTime);
        if (this.stats.genTimes.length > 100) {
            this.stats.genTimes.shift();
        }
        this.stats.avgGenTime = this.stats.genTimes.reduce((a, b) => a + b, 0) / this.stats.genTimes.length;
        this.stats.totalGenerated++;

        // Store terrain data in cache (heightmap, voxelMask, blockData)
        this.blockCache.setChunkData(chunkX, chunkZ, {
            heightmap: chunkData.heightmap,
            voxelMask: chunkData.voxelMask,
            surfaceTypes: chunkData.surfaceTypes,
            blockData: chunkData.blockData
        });

        // Create Three.js meshes
        const meshes = this.createMeshesFromData(chunkData);

        // Notify callback
        if (this.onChunkReady) {
            this.onChunkReady(chunkX, chunkZ, meshes);
        }

        this.processQueue();
    }

    /**
     * Create Three.js meshes from worker-generated geometry data
     * Creates both surface mesh (smooth terrain) and voxel mesh (caves/structures)
     *
     * RENDER ORDER:
     * - Voxels render FIRST (renderOrder=0) to write Z-buffer
     * - Surface renders SECOND (renderOrder=1) and gets Z-rejected under voxels
     * - Water renders LAST (renderOrder=2) for transparency
     */
    createMeshesFromData(chunkData) {
        const result = {
            surfaceMesh: null,   // Smooth terrain with splatting
            opaqueMesh: null,    // Voxel geometry (caves, structures)
            waterMesh: null,     // Water
            worldX: chunkData.worldX,
            worldZ: chunkData.worldZ
        };

        // Create voxel opaque mesh (renders first, writes Z-buffer)
        if (!chunkData.opaque.isEmpty) {
            result.opaqueMesh = this.createMesh(chunkData.opaque, this.opaqueMaterial);
            result.opaqueMesh.position.set(chunkData.worldX, 0, chunkData.worldZ);
            result.opaqueMesh.receiveShadow = true;
            result.opaqueMesh.renderOrder = 0;  // Render first
        }

        // Create surface mesh (smooth terrain with splatting) - renders second
        if (!chunkData.surface.isEmpty) {
            result.surfaceMesh = this.createSurfaceMesh(chunkData.surface, this.surfaceMaterial);
            result.surfaceMesh.position.set(chunkData.worldX, 0, chunkData.worldZ);
            result.surfaceMesh.receiveShadow = true;
            result.surfaceMesh.renderOrder = 1;  // Render after voxels (Z-rejected where voxels exist)
        }

        // Create water mesh - renders last (transparent)
        if (!chunkData.water.isEmpty) {
            result.waterMesh = this.createMesh(chunkData.water, this.waterMaterial);
            result.waterMesh.position.set(chunkData.worldX, 0, chunkData.worldZ);
            result.waterMesh.renderOrder = 2;  // Render last (transparent)
        }

        return result;
    }

    /**
     * Create a standard mesh (for voxels and water)
     */
    createMesh(data, material) {
        const geometry = new THREE.BufferGeometry();

        geometry.setAttribute('position', new THREE.BufferAttribute(data.positions, 3));
        geometry.setAttribute('normal', new THREE.BufferAttribute(data.normals, 3));
        geometry.setAttribute('uv', new THREE.BufferAttribute(data.uvs, 2));
        geometry.setAttribute('color', new THREE.BufferAttribute(data.colors, 3));
        geometry.setIndex(new THREE.BufferAttribute(data.indices, 1));

        geometry.computeBoundingSphere();

        return new THREE.Mesh(geometry, material);
    }

    /**
     * Create a surface mesh with splatting attributes
     * Includes additional vertex attributes for texture blending
     */
    createSurfaceMesh(data, material) {
        const geometry = new THREE.BufferGeometry();

        // Standard attributes
        geometry.setAttribute('position', new THREE.BufferAttribute(data.positions, 3));
        geometry.setAttribute('normal', new THREE.BufferAttribute(data.normals, 3));
        geometry.setAttribute('uv', new THREE.BufferAttribute(data.uvs, 2));
        geometry.setAttribute('color', new THREE.BufferAttribute(data.colors, 3));

        // Splatting attributes for texture blending
        if (data.tileIndices && data.blendWeights) {
            geometry.setAttribute('aTileIndices', new THREE.BufferAttribute(data.tileIndices, 4));
            geometry.setAttribute('aBlendWeights', new THREE.BufferAttribute(data.blendWeights, 4));
        }

        geometry.setIndex(new THREE.BufferAttribute(data.indices, 1));
        geometry.computeBoundingSphere();

        return new THREE.Mesh(geometry, material);
    }

    /**
     * Initialize the worker with world seed
     */
    init(seed) {
        return new Promise((resolve) => {
            this.readyResolve = resolve;
            this.worker.postMessage({
                type: 'init',
                data: { seed }
            });
        });
    }

    /**
     * Request a chunk to be generated
     * @param {number} chunkX - Chunk X coordinate
     * @param {number} chunkZ - Chunk Z coordinate
     * @param {number} priority - Lower = higher priority (distance from player)
     * @param {Object} context - Additional context (destroyed blocks, etc.)
     */
    requestChunk(chunkX, chunkZ, priority, context = {}) {
        const key = `${chunkX},${chunkZ}`;

        // Don't re-request if already processing
        if (this.processingChunks.has(key)) {
            return;
        }

        // Update priority if already pending
        if (this.pendingRequests.has(key)) {
            const existing = this.pendingRequests.get(key);
            existing.priority = Math.min(existing.priority, priority);
            return;
        }

        this.pendingRequests.set(key, { chunkX, chunkZ, priority, context });
        this.processQueue();
    }

    /**
     * Cancel a pending or processing chunk request
     */
    cancelRequest(chunkX, chunkZ) {
        const key = `${chunkX},${chunkZ}`;

        // Remove from pending queue
        if (this.pendingRequests.has(key)) {
            this.pendingRequests.delete(key);
            this.stats.totalDropped++;
            if (DEBUG_CANCELLATION) {
                console.log(`🗑️ DROPPED chunk ${key} from queue (total: ${this.stats.totalDropped})`);
            }
            return;
        }

        // Mark as cancelled if currently processing
        if (this.processingChunks.has(key)) {
            this.cancelledChunks.add(key);
            if (DEBUG_CANCELLATION) {
                console.log(`⏳ CANCELLING chunk ${key} (in progress)`);
            }
        }
    }

    /**
     * Process the request queue, sending highest priority chunks to worker
     */
    processQueue() {
        if (!this.isReady) return;
        if (this.pendingRequests.size === 0) return;

        // Only process one chunk at a time - worker is single-threaded
        if (this.processingChunks.size > 0) return;

        // Find highest priority request (lowest priority number)
        let bestKey = null;
        let bestPriority = Infinity;

        this.pendingRequests.forEach((request, key) => {
            if (request.priority < bestPriority) {
                bestPriority = request.priority;
                bestKey = key;
            }
        });

        if (bestKey === null) return;

        const request = this.pendingRequests.get(bestKey);
        this.pendingRequests.delete(bestKey);
        this.processingChunks.add(bestKey);

        // Send to worker
        this.worker.postMessage({
            type: 'generateChunk',
            data: {
                chunkX: request.chunkX,
                chunkZ: request.chunkZ,
                destroyedBlocks: request.context.destroyedBlocks || []
            }
        });
    }

    /**
     * Get block type at world coordinates (from cache)
     */
    getBlockType(x, y, z) {
        return this.blockCache.getBlockType(x, y, z);
    }

    /**
     * Get ground height at world coordinates
     * Routes to smooth (heightmap) or voxel collision based on mask
     */
    getGroundHeight(x, z) {
        return this.blockCache.getGroundHeight(x, z);
    }

    /**
     * Check if a chunk has been loaded
     */
    isChunkLoaded(chunkX, chunkZ) {
        return this.blockCache.hasChunk(chunkX, chunkZ);
    }

    /**
     * Unload a chunk from the cache
     */
    unloadChunk(chunkX, chunkZ) {
        this.blockCache.removeChunk(chunkX, chunkZ);
    }

    /**
     * Update destroyed blocks in worker
     */
    updateDestroyedBlocks(blocks) {
        this.worker.postMessage({
            type: 'updateDestroyedBlocks',
            data: { blocks: Array.from(blocks) }
        });
    }

    /**
     * Get stats for debugging
     */
    getStats() {
        return {
            ...this.stats,
            pendingCount: this.pendingRequests.size,
            processingCount: this.processingChunks.size,
            cachedChunks: this.blockCache.size
        };
    }
}