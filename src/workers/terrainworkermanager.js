/**
 * TerrainWorkerManager - Manages communication with the terrain web worker
 * 
 * Handles:
 * - Worker initialization
 * - Chunk request queue with priority
 * - Chunk cancellation when out of range
 * - Receiving mesh geometry AND block data from worker
 * - Creating Three.js meshes
 * - Storing block data in ChunkBlockCache for collision queries
 * 
 * The worker is the SINGLE SOURCE OF TRUTH for terrain data.
 */

import * as THREE from 'three';
import { ChunkBlockCache } from '../world/chunkblockcache.js';

export class TerrainWorkerManager {
    constructor(scene, opaqueMaterial, waterMaterial, onChunkReady) {
        this.scene = scene;
        this.opaqueMaterial = opaqueMaterial;
        this.waterMaterial = waterMaterial;
        this.onChunkReady = onChunkReady;

        // Worker state
        this.worker = null;
        this.isReady = false;
        this.readyResolve = null;

        // Request management
        this.pendingRequests = new Map();  // key -> { chunkX, chunkZ, priority, context }
        this.processingChunks = new Set(); // Keys currently being processed
        this.cancelledChunks = new Set();  // Keys cancelled while processing

        // Block data cache - THE source of truth for collision
        this.blockCache = new ChunkBlockCache();

        // Stats
        this.stats = {
            totalGenerated: 0,
            totalCancelled: 0,
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

        // Store block data in cache (for collision queries)
        if (chunkData.blockData) {
            this.blockCache.setChunkData(chunkX, chunkZ, chunkData.blockData);
        }

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
     */
    createMeshesFromData(chunkData) {
        const result = {
            opaqueMesh: null,
            waterMesh: null,
            worldX: chunkData.worldX,
            worldZ: chunkData.worldZ
        };

        // Create opaque mesh
        if (!chunkData.opaque.isEmpty) {
            result.opaqueMesh = this.createMesh(chunkData.opaque, this.opaqueMaterial);
            result.opaqueMesh.position.set(chunkData.worldX, 0, chunkData.worldZ);
            result.opaqueMesh.receiveShadow = true;
        }

        // Create water mesh
        if (!chunkData.water.isEmpty) {
            result.waterMesh = this.createMesh(chunkData.water, this.waterMaterial);
            result.waterMesh.position.set(chunkData.worldX, 0, chunkData.worldZ);
            result.waterMesh.renderOrder = 1;
        }

        return result;
    }

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
     * Initialize the worker with world seed
     */
    init(seed) {
        return new Promise((resolve) => {
            this.readyResolve = resolve;
            this.worker.postMessage({ type: 'init', data: { seed } });
        });
    }

    /**
     * Request chunk generation with priority
     */
    requestChunk(chunkX, chunkZ, priority, context = {}) {
        const key = `${chunkX},${chunkZ}`;

        // Don't re-request if processing
        if (this.processingChunks.has(key)) {
            return;
        }

        // Update priority if already pending
        if (this.pendingRequests.has(key)) {
            const existing = this.pendingRequests.get(key);
            existing.priority = Math.min(existing.priority, priority);
            return;
        }

        this.pendingRequests.set(key, {
            chunkX,
            chunkZ,
            priority,
            context
        });

        this.processQueue();
    }

    /**
     * Cancel a pending chunk request
     */
    cancelRequest(chunkX, chunkZ) {
        const key = `${chunkX},${chunkZ}`;

        if (this.pendingRequests.has(key)) {
            this.pendingRequests.delete(key);
        }

        // If already processing, mark for cancellation
        if (this.processingChunks.has(key)) {
            this.cancelledChunks.add(key);
        }

        // Also remove from block cache
        this.blockCache.removeChunk(chunkX, chunkZ);
    }

    /**
     * Update priorities based on camera position
     */
    updatePriorities(cameraX, cameraZ, unloadRadius) {
        const CHUNK_SIZE = 16;
        const cameraChunkX = Math.floor(cameraX / CHUNK_SIZE);
        const cameraChunkZ = Math.floor(cameraZ / CHUNK_SIZE);

        // Cancel chunks that are too far
        for (const [key, request] of this.pendingRequests) {
            const dx = Math.abs(request.chunkX - cameraChunkX);
            const dz = Math.abs(request.chunkZ - cameraChunkZ);

            if (dx > unloadRadius || dz > unloadRadius) {
                this.pendingRequests.delete(key);
            } else {
                // Update priority
                const centerX = request.chunkX * CHUNK_SIZE + CHUNK_SIZE / 2;
                const centerZ = request.chunkZ * CHUNK_SIZE + CHUNK_SIZE / 2;
                const distX = centerX - cameraX;
                const distZ = centerZ - cameraZ;
                request.priority = distX * distX + distZ * distZ;
            }
        }
    }

    /**
     * Process the queue - send next chunk to worker
     */
    processQueue() {
        if (!this.isReady) return;
        if (this.processingChunks.size > 0) return; // One at a time
        if (this.pendingRequests.size === 0) return;

        // Find highest priority (lowest value)
        let bestKey = null;
        let bestPriority = Infinity;

        for (const [key, request] of this.pendingRequests) {
            if (request.priority < bestPriority) {
                bestPriority = request.priority;
                bestKey = key;
            }
        }

        if (!bestKey) return;

        const request = this.pendingRequests.get(bestKey);
        this.pendingRequests.delete(bestKey);
        this.processingChunks.add(bestKey);

        this.worker.postMessage({
            type: 'generateChunk',
            data: {
                chunkX: request.chunkX,
                chunkZ: request.chunkZ,
                destroyedBlocks: request.context.destroyedBlocks || [],
                landmarkBlocks: request.context.landmarkBlocks || []
            }
        });
    }

    /**
     * Get block type at world coordinates (queries the block cache)
     * This is the main thread's way to query terrain data
     */
    getBlockType(x, y, z) {
        return this.blockCache.getBlockType(x, y, z);
    }

    /**
     * Check if block data is loaded for a chunk
     */
    hasBlockData(chunkX, chunkZ) {
        return this.blockCache.hasChunk(chunkX, chunkZ);
    }

    /**
     * Get stats for performance monitor
     */
    getStats() {
        return {
            pendingCount: this.pendingRequests.size,
            processingCount: this.processingChunks.size,
            totalGenerated: this.stats.totalGenerated,
            totalCancelled: this.stats.totalCancelled,
            avgGenTime: this.stats.avgGenTime.toFixed(1),
            blockCacheSize: this.blockCache.size
        };
    }

    /**
     * Clean up
     */
    dispose() {
        if (this.worker) {
            this.worker.terminate();
            this.worker = null;
        }
        this.pendingRequests.clear();
        this.processingChunks.clear();
        this.cancelledChunks.clear();
        this.blockCache.clear();
    }
}