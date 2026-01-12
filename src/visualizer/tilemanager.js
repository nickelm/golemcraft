/**
 * TileManager - Coordinates async tile loading with priority-based scheduling
 *
 * Manages a Web Worker for tile generation, prioritizes tiles by distance from
 * viewport center, and triggers re-renders when tiles arrive.
 */

const MAX_PENDING_REQUESTS = 8;     // Max concurrent worker requests
const TILE_SIZE = 128;              // Must match worker
const MAX_REFINEMENT_LEVEL = 5;     // Full resolution level

export class TileManager {
    /**
     * @param {TileCache} tileCache - TileCache instance for storing generated tiles
     * @param {Function} onTileReady - Callback when a new tile is ready (triggers re-render)
     */
    constructor(tileCache, onTileReady) {
        this.tileCache = tileCache;
        this.onTileReady = onTileReady;

        // Worker state
        this.worker = null;
        this.workerReady = false;
        this.workerFailed = false;

        // Configuration
        this.seed = 0;
        this.template = null;
        this.mode = 'continental';

        // Viewport state
        this.viewX = 0;
        this.viewZ = 0;
        this.zoom = 1;
        this.canvasWidth = 0;
        this.canvasHeight = 0;
        this.lodLevel = 0;

        // Request tracking
        this.nextRequestId = 1;
        this.pendingRequests = new Map();  // requestId -> { tileX, tileZ, lodLevel, mode, refinementLevel }
        this.requestQueue = [];            // Tiles waiting to be sent to worker

        // Visible tiles cache (updated on viewport change)
        this.visibleTileCoords = [];

        // Progressive rendering configuration
        this.progressiveEnabled = true;    // Enable coarse-to-fine rendering
    }

    /**
     * Initialize the Web Worker
     * @param {number} seed - World seed
     * @param {Object} template - Terrain template
     * @returns {Promise<boolean>} True if worker initialized successfully
     */
    async initWorker(seed, template) {
        this.seed = seed;
        this.template = template;

        return new Promise((resolve) => {
            try {
                // Set up message handler BEFORE creating worker
                // This ensures we don't miss the 'ready' message
                this._initResolved = false;
                this._initResolve = (success) => {
                    if (!this._initResolved) {
                        this._initResolved = true;
                        clearTimeout(timeout);
                        resolve(success);
                    }
                };

                this.worker = new Worker(
                    new URL('./tilegenerator.worker.js', import.meta.url),
                    { type: 'module' }
                );

                this.worker.onmessage = (e) => this._handleWorkerMessage(e.data);
                this.worker.onerror = (e) => this._handleWorkerError(e);

                // Wait for ready signal with timeout (10s for module loading)
                const timeout = setTimeout(() => {
                    if (!this._initResolved && !this.workerReady) {
                        console.warn('TileManager: Worker initialization timeout, using fallback');
                        this.workerFailed = true;
                        this._initResolve(false);
                    }
                }, 10000);
            } catch (error) {
                console.error('TileManager: Failed to create worker:', error);
                this.workerFailed = true;
                resolve(false);
            }
        });
    }

    /**
     * Update configuration (seed/template/mode change)
     * Cancels pending requests and clears queue
     * @param {number} seed - World seed
     * @param {Object} template - Terrain template
     * @param {string} [mode] - Visualization mode
     */
    updateConfig(seed, template, mode) {
        this.seed = seed;
        this.template = template;
        if (mode !== undefined) {
            this.mode = mode;
        }

        // Cancel all pending work
        this.cancelAllPending();
    }

    /**
     * Set visualization mode
     * @param {string} mode - Visualization mode
     */
    setMode(mode) {
        if (this.mode !== mode) {
            this.mode = mode;
            this.cancelAllPending();
        }
    }

    /**
     * Update viewport and trigger tile loading
     * @param {number} viewX - View center X in world coordinates
     * @param {number} viewZ - View center Z in world coordinates
     * @param {number} zoom - Zoom level (pixels per world block)
     * @param {number} canvasWidth - Canvas width in pixels
     * @param {number} canvasHeight - Canvas height in pixels
     */
    updateViewport(viewX, viewZ, zoom, canvasWidth, canvasHeight) {
        this.viewX = viewX;
        this.viewZ = viewZ;
        this.zoom = zoom;
        this.canvasWidth = canvasWidth;
        this.canvasHeight = canvasHeight;
        this.lodLevel = this._calculateLOD(zoom);

        // Calculate visible tiles
        this._updateVisibleTiles();

        // Queue tiles that aren't cached
        this._queueMissingTiles();

        // Process queue
        this._processQueue();
    }

    /**
     * Get tiles that are visible and cached (for render loop)
     * Returns best available refinement level for each tile
     * @returns {Array<{tileX: number, tileZ: number, imageData: ImageData, screenX: number, screenY: number, scaledSize: number, refinementLevel: number}>}
     */
    getVisibleTiles() {
        const result = [];
        const worldTileSize = this._getWorldTileSize();
        const halfWidth = this.canvasWidth / 2;
        const halfHeight = this.canvasHeight / 2;

        for (const { tileX, tileZ } of this.visibleTileCoords) {
            // Get best available refinement for this tile
            const best = this.tileCache.getBestAvailable(
                tileX, tileZ, this.mode, this.seed, this.lodLevel
            );

            if (best) {
                // Calculate screen position
                const screenX = halfWidth + (tileX - this.viewX) * this.zoom;
                const screenY = halfHeight + (tileZ - this.viewZ) * this.zoom;
                const scaledSize = worldTileSize * this.zoom;

                result.push({
                    tileX,
                    tileZ,
                    imageData: best.imageData,
                    screenX,
                    screenY,
                    scaledSize,
                    refinementLevel: best.refinementLevel
                });
            }
        }

        return result;
    }

    /**
     * Get coordinates of tiles that are pending generation
     * @returns {Array<{tileX: number, tileZ: number}>}
     */
    getPendingTiles() {
        const pending = [];

        // From active requests
        for (const req of this.pendingRequests.values()) {
            if (req.lodLevel === this.lodLevel && req.mode === this.mode) {
                pending.push({ tileX: req.tileX, tileZ: req.tileZ });
            }
        }

        // From queue
        for (const item of this.requestQueue) {
            if (item.lodLevel === this.lodLevel && item.mode === this.mode) {
                pending.push({ tileX: item.tileX, tileZ: item.tileZ });
            }
        }

        return pending;
    }

    /**
     * Get count of pending requests
     * @returns {number}
     */
    getPendingCount() {
        return this.pendingRequests.size + this.requestQueue.length;
    }

    /**
     * Cancel all pending requests and clear queue
     */
    cancelAllPending() {
        this.pendingRequests.clear();
        this.requestQueue = [];
    }

    /**
     * Check if worker is available for async generation
     * @returns {boolean}
     */
    isWorkerAvailable() {
        return this.workerReady && !this.workerFailed;
    }

    /**
     * Clean up resources
     */
    destroy() {
        if (this.worker) {
            this.worker.terminate();
            this.worker = null;
        }
        this.workerReady = false;
        this.cancelAllPending();
    }

    // --- Private Methods ---

    /**
     * Handle message from worker
     * @private
     */
    _handleWorkerMessage(message) {
        switch (message.type) {
            case 'ready': {
                const wasNotReady = !this.workerReady;
                this.workerReady = true;
                this.workerFailed = false;  // Recover if ready arrives late
                console.log('TileManager: Worker ready');
                if (this._initResolve) {
                    this._initResolve(true);
                    this._initResolve = null;
                }
                // If worker became ready after timeout, notify via callback
                // so visualizer can switch to async rendering
                if (wasNotReady && this.onTileReady) {
                    this.onTileReady(null, null);
                }
                // Process any queued requests now that worker is ready
                this._processQueue();
                break;
            }

            case 'tile': {
                const { requestId, tileX, tileZ, lodLevel, mode, buffer, width, height } = message;

                // Remove from pending
                this.pendingRequests.delete(requestId);

                // Create ImageData from buffer
                const imageData = new ImageData(
                    new Uint8ClampedArray(buffer),
                    width,
                    height
                );

                // Store in cache at full refinement level (5)
                this.tileCache.setTile(tileX, tileZ, mode, this.seed, lodLevel, imageData, MAX_REFINEMENT_LEVEL);

                // Trigger re-render
                if (this.onTileReady) {
                    this.onTileReady(tileX, tileZ);
                }

                // Process more from queue
                this._processQueue();
                break;
            }

            case 'tile_progressive': {
                // Progressive refinement tile
                const { requestId, tileX, tileZ, lodLevel, refinementLevel, mode, buffer, width, height } = message;

                // Remove from pending
                this.pendingRequests.delete(requestId);

                // Create ImageData from buffer (may be smaller than TILE_SIZE)
                const imageData = new ImageData(
                    new Uint8ClampedArray(buffer),
                    width,
                    height
                );

                // Store in cache with refinement level
                this.tileCache.setTile(tileX, tileZ, mode, this.seed, lodLevel, imageData, refinementLevel);

                // Trigger re-render
                if (this.onTileReady) {
                    this.onTileReady(tileX, tileZ);
                }

                // Process more from queue (including next refinement level)
                this._processQueue();
                break;
            }

            case 'error': {
                const { requestId, tileX, tileZ, error } = message;
                console.warn(`TileManager: Tile generation error at (${tileX}, ${tileZ}):`, error);
                this.pendingRequests.delete(requestId);
                this._processQueue();
                break;
            }

            case 'pong':
                // Health check response, ignore
                break;

            default:
                console.warn('TileManager: Unknown message type:', message.type);
        }
    }

    /**
     * Handle worker error
     * @private
     */
    _handleWorkerError(error) {
        console.error('TileManager: Worker error:', error);
        this.workerFailed = true;

        if (this._initResolve) {
            this._initResolve(false);
            this._initResolve = null;
        }
    }

    /**
     * Calculate LOD level from zoom
     * @private
     */
    _calculateLOD(zoom) {
        if (zoom >= 1) return 0;
        const lod = Math.floor(-Math.log2(zoom));
        return Math.min(lod, 6);
    }

    /**
     * Get world size covered by a tile at current LOD
     * @private
     */
    _getWorldTileSize() {
        return TILE_SIZE * (1 << this.lodLevel);
    }

    /**
     * Align coordinate to tile grid
     * @private
     */
    _alignToGrid(coord) {
        const worldTileSize = this._getWorldTileSize();
        return Math.floor(coord / worldTileSize) * worldTileSize;
    }

    /**
     * Update list of visible tile coordinates
     * @private
     */
    _updateVisibleTiles() {
        const worldTileSize = this._getWorldTileSize();
        const halfWidth = this.canvasWidth / 2;
        const halfHeight = this.canvasHeight / 2;

        // Calculate visible world bounds
        const worldLeft = this.viewX - halfWidth / this.zoom;
        const worldRight = this.viewX + halfWidth / this.zoom;
        const worldTop = this.viewZ - halfHeight / this.zoom;
        const worldBottom = this.viewZ + halfHeight / this.zoom;

        // Calculate tile range
        const tileStartX = this._alignToGrid(Math.floor(worldLeft));
        const tileEndX = this._alignToGrid(Math.ceil(worldRight)) + worldTileSize;
        const tileStartZ = this._alignToGrid(Math.floor(worldTop));
        const tileEndZ = this._alignToGrid(Math.ceil(worldBottom)) + worldTileSize;

        // Build list of visible tiles with distance from center
        const tiles = [];
        for (let tileZ = tileStartZ; tileZ < tileEndZ; tileZ += worldTileSize) {
            for (let tileX = tileStartX; tileX < tileEndX; tileX += worldTileSize) {
                // Calculate distance from viewport center (for priority)
                const tileCenterX = tileX + worldTileSize / 2;
                const tileCenterZ = tileZ + worldTileSize / 2;
                const dx = tileCenterX - this.viewX;
                const dz = tileCenterZ - this.viewZ;
                const distSq = dx * dx + dz * dz;

                tiles.push({ tileX, tileZ, distSq });
            }
        }

        // Sort by distance (closest first)
        tiles.sort((a, b) => a.distSq - b.distSq);

        this.visibleTileCoords = tiles;
    }

    /**
     * Queue tiles that need generation (with progressive refinement support)
     * @private
     */
    _queueMissingTiles() {
        // Clear existing queue (viewport may have changed)
        this.requestQueue = [];

        // Build set of already pending tile keys (including refinement level)
        const pendingKeys = new Set();
        for (const req of this.pendingRequests.values()) {
            const refLevel = req.refinementLevel !== undefined ? req.refinementLevel : MAX_REFINEMENT_LEVEL;
            pendingKeys.add(`${req.tileX},${req.tileZ},${req.lodLevel},${req.mode},${refLevel}`);
        }

        if (this.progressiveEnabled) {
            // Progressive mode: queue next refinement level for each tile
            for (const { tileX, tileZ } of this.visibleTileCoords) {
                // Check current refinement level
                const currentLevel = this.tileCache.getCurrentRefinementLevel(
                    tileX, tileZ, this.mode, this.seed, this.lodLevel
                );

                // If already at full resolution, skip
                if (currentLevel >= MAX_REFINEMENT_LEVEL) {
                    continue;
                }

                // Queue next refinement level (starting from 1, since 0 is done synchronously)
                const nextLevel = Math.max(1, currentLevel + 1);
                const key = `${tileX},${tileZ},${this.lodLevel},${this.mode},${nextLevel}`;

                // Skip if already pending
                if (pendingKeys.has(key)) {
                    continue;
                }

                this.requestQueue.push({
                    tileX,
                    tileZ,
                    lodLevel: this.lodLevel,
                    mode: this.mode,
                    refinementLevel: nextLevel,
                    progressive: true
                });
            }
        } else {
            // Non-progressive mode: queue full resolution tiles
            for (const { tileX, tileZ } of this.visibleTileCoords) {
                const key = `${tileX},${tileZ},${this.lodLevel},${this.mode},${MAX_REFINEMENT_LEVEL}`;

                // Skip if already cached at full resolution
                if (this.tileCache.hasTile(tileX, tileZ, this.mode, this.seed, this.lodLevel)) {
                    continue;
                }

                // Skip if already pending
                if (pendingKeys.has(key)) {
                    continue;
                }

                this.requestQueue.push({
                    tileX,
                    tileZ,
                    lodLevel: this.lodLevel,
                    mode: this.mode,
                    refinementLevel: MAX_REFINEMENT_LEVEL,
                    progressive: false
                });
            }
        }
    }

    /**
     * Send requests from queue to worker
     * @private
     */
    _processQueue() {
        if (!this.workerReady || this.workerFailed) {
            return;
        }

        // Send requests up to max concurrent limit
        while (this.requestQueue.length > 0 && this.pendingRequests.size < MAX_PENDING_REQUESTS) {
            const item = this.requestQueue.shift();
            const requestId = this.nextRequestId++;

            // Track pending request
            this.pendingRequests.set(requestId, {
                tileX: item.tileX,
                tileZ: item.tileZ,
                lodLevel: item.lodLevel,
                mode: item.mode,
                refinementLevel: item.refinementLevel
            });

            if (item.progressive) {
                // Send progressive refinement request
                this.worker.postMessage({
                    type: 'generate_progressive',
                    data: {
                        requestId,
                        tileX: item.tileX,
                        tileZ: item.tileZ,
                        lodLevel: item.lodLevel,
                        refinementLevel: item.refinementLevel,
                        seed: this.seed,
                        mode: item.mode,
                        template: this.template
                    }
                });
            } else {
                // Send full resolution request
                this.worker.postMessage({
                    type: 'generate',
                    data: {
                        requestId,
                        tileX: item.tileX,
                        tileZ: item.tileZ,
                        lodLevel: item.lodLevel,
                        tileSize: TILE_SIZE,
                        seed: this.seed,
                        mode: item.mode,
                        template: this.template
                    }
                });
            }
        }
    }

    /**
     * Enable or disable progressive rendering
     * @param {boolean} enabled - Whether to use coarse-to-fine rendering
     */
    setProgressiveEnabled(enabled) {
        this.progressiveEnabled = enabled;
    }
}
