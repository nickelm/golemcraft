/**
 * Template Editor - TileRenderer
 *
 * Manages the main canvas and tile-based terrain rendering.
 * Uses TileManager for async worker-based tile generation.
 * Supports progressive coarse-to-fine rendering for instant feedback.
 */

import { TILE_SIZE, MAX_CACHED_TILES, COLORS, EVENTS, REFINEMENT_LEVELS, MAX_REFINEMENT_LEVEL } from '../core/constants.js';
import { calculateLOD, worldToCanvas, getVisibleWorldBounds } from '../utils/coordinates.js';
import { TileCache } from '../../tools/mapvisualizer/tilecache.js';
import { TileManager } from '../../visualizer/tilemanager.js';
import { getTerrainParams } from '../../world/terrain/worldgen.js';
import { getColorForMode } from '../../tools/mapvisualizer/colors.js';

export class TileRenderer {
    /**
     * @param {HTMLCanvasElement} canvas - The main rendering canvas
     * @param {EditorState} state - Editor state instance
     * @param {EventBus} eventBus - Event bus for communication
     */
    constructor(canvas, state, eventBus) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d', { willReadFrequently: true });
        this.state = state;
        this.eventBus = eventBus;

        // Tile caching
        this.tileCache = new TileCache(TILE_SIZE, MAX_CACHED_TILES);

        // Tile manager for async generation
        this.tileManager = null;
        this.tileManagerReady = false;
        this.useAsyncRendering = true;

        // Render scheduling
        this.renderPending = false;
        this.renderRequestId = null;

        // Reusable temporary canvas for tile drawing (avoids allocation per tile)
        this._tempCanvas = null;
        this._tempCtx = null;

        // Previous viewport state for incremental pan optimization
        this._lastViewX = null;
        this._lastViewZ = null;
        this._lastZoom = null;

        // Bind methods
        this._onTileReady = this._onTileReady.bind(this);
        this._onStateChange = this._onStateChange.bind(this);

        // Subscribe to state changes
        this.state.subscribe(this._onStateChange);

        // Initialize
        this._initTileManager();
    }

    /**
     * Initialize the tile manager with web worker
     */
    async _initTileManager() {
        try {
            this.tileManager = new TileManager(this.tileCache, this._onTileReady);

            const success = await this.tileManager.initWorker(
                this.state.seed,
                this.state.template
            );

            if (success) {
                this.tileManager.setMode(this.state.mode);
                this.tileManagerReady = true;
                this.useAsyncRendering = true;
                console.log('TileRenderer: Worker initialized');
                this.scheduleRender();
            } else {
                console.warn('TileRenderer: Worker failed, using sync fallback');
                this.useAsyncRendering = false;
                this.scheduleRender();
            }
        } catch (error) {
            console.error('TileRenderer: Failed to init TileManager:', error);
            this.useAsyncRendering = false;
            this.scheduleRender();
        }
    }

    /**
     * Handle tile ready from worker
     */
    _onTileReady(tileX, tileZ) {
        // Check if worker recovered after timeout (tileX/tileZ will be null)
        if (tileX === null && tileZ === null && this.tileManager?.isWorkerAvailable()) {
            console.log('TileRenderer: Worker recovered, switching to async rendering');
            this.tileManagerReady = true;
            this.useAsyncRendering = true;
            this.tileManager.setMode(this.state.mode);
        }

        this.scheduleRender();
        this.eventBus.emit(EVENTS.TILE_READY, { tileX, tileZ });
    }

    /**
     * Handle state changes
     */
    _onStateChange({ type, data }) {
        switch (type) {
            case EVENTS.VIEWPORT_CHANGE:
                this.scheduleRender();
                break;

            case EVENTS.SEED_CHANGE:
            case EVENTS.TEMPLATE_CHANGE:
                this._onConfigChange();
                break;

            case EVENTS.MODE_CHANGE:
                this._onModeChange(data.mode);
                break;

            case EVENTS.LAYER_TOGGLE:
                // Overlays are rendered separately, just schedule redraw
                this.scheduleRender();
                break;
        }
    }

    /**
     * Handle seed/template change
     */
    _onConfigChange() {
        // Clear tile cache
        this.tileCache.invalidate();

        // Update tile manager
        if (this.tileManager) {
            this.tileManager.updateConfig(
                this.state.seed,
                this.state.template,
                this.state.mode
            );
        }

        this.scheduleRender();
    }

    /**
     * Handle visualization mode change
     */
    _onModeChange(mode) {
        // Clear cache since colors change with mode
        this.tileCache.invalidate();

        if (this.tileManager) {
            this.tileManager.setMode(mode);
        }

        this.scheduleRender();
    }

    /**
     * Schedule a render on the next animation frame
     */
    scheduleRender() {
        if (this.renderPending) return;

        this.renderPending = true;
        this.renderRequestId = requestAnimationFrame(() => {
            this.renderPending = false;
            this.render();
        });
    }

    /**
     * Resize canvas to match container
     */
    resize() {
        const container = this.canvas.parentElement;
        const rect = container.getBoundingClientRect();

        const dpr = window.devicePixelRatio || 1;
        this.canvas.width = rect.width * dpr;
        this.canvas.height = rect.height * dpr;
        this.canvas.style.width = `${rect.width}px`;
        this.canvas.style.height = `${rect.height}px`;

        this.ctx.scale(dpr, dpr);

        this.scheduleRender();
    }

    /**
     * Get canvas dimensions (CSS pixels, not device pixels)
     */
    getCanvasSize() {
        const dpr = window.devicePixelRatio || 1;
        return {
            width: this.canvas.width / dpr,
            height: this.canvas.height / dpr
        };
    }

    /**
     * Get or create a reusable temporary canvas for tile drawing
     * Resizes as needed to accommodate different tile sizes
     * @private
     */
    _getTempCanvas(width, height) {
        if (!this._tempCanvas || this._tempCanvas.width < width || this._tempCanvas.height < height) {
            // Create or resize temp canvas to accommodate the tile
            const newWidth = Math.max(width, this._tempCanvas?.width || 0);
            const newHeight = Math.max(height, this._tempCanvas?.height || 0);
            this._tempCanvas = new OffscreenCanvas(newWidth, newHeight);
            this._tempCtx = this._tempCanvas.getContext('2d');
        }
        return { canvas: this._tempCanvas, ctx: this._tempCtx };
    }

    /**
     * Main render method
     */
    render() {
        const { width, height } = this.getCanvasSize();

        // Clear canvas
        this.ctx.fillStyle = COLORS.background;
        this.ctx.fillRect(0, 0, width, height);

        // Render tiles
        if (this.useAsyncRendering && this.tileManagerReady) {
            this._renderAsync(width, height);
        } else {
            this._renderSync(width, height);
        }

        // Emit render complete event (overlays listen to this)
        this.eventBus.emit(EVENTS.RENDER_REQUEST, { width, height, ctx: this.ctx });
    }

    /**
     * Async render path - uses Web Worker for tile generation
     * Non-blocking: only draws tiles that are already cached
     * Generates synchronous level 0 previews for instant feedback
     */
    _renderAsync(width, height) {
        const { viewX, viewZ, zoom, seed, template, mode } = this.state;
        const lodLevel = calculateLOD(zoom);
        const worldTileSize = TILE_SIZE * (1 << lodLevel);
        const halfWidth = width / 2;
        const halfHeight = height / 2;

        // Update tile manager with current viewport
        this.tileManager.updateViewport(viewX, viewZ, zoom, width, height);

        // Get visible tile coordinates
        const visibleCoords = this.tileManager.visibleTileCoords;

        // Generate synchronous level 0 previews for tiles that have nothing cached
        for (const { tileX, tileZ } of visibleCoords) {
            const currentLevel = this.tileCache.getCurrentRefinementLevel(
                tileX, tileZ, mode, seed, lodLevel
            );

            // If no refinement cached, generate level 0 synchronously
            if (currentLevel < 0) {
                const preview = this._generateInstantPreview(tileX, tileZ, lodLevel, seed, template, mode);
                this.tileCache.setTile(tileX, tileZ, mode, seed, lodLevel, preview, 0);
            }
        }

        // Get tiles that are ready (from memory cache) - now includes level 0 previews
        const visibleTiles = this.tileManager.getVisibleTiles();

        // Draw cached tiles with appropriate upscaling
        for (const tile of visibleTiles) {
            // Get the actual size of the cached image
            const imageWidth = tile.imageData.width;
            const imageHeight = tile.imageData.height;

            // Reuse temp canvas to avoid allocation per tile
            const { canvas: tempCanvas, ctx: tempCtx } = this._getTempCanvas(imageWidth, imageHeight);
            tempCtx.putImageData(tile.imageData, 0, 0);

            // Use blocky upscaling for non-full-resolution tiles (pixel art style)
            // Use smooth interpolation only when zoomed out with full resolution tiles
            const isFullResolution = tile.refinementLevel >= MAX_REFINEMENT_LEVEL;
            this.ctx.imageSmoothingEnabled = isFullResolution && zoom < 1;

            // Draw from the portion of tempCanvas that has the tile data
            this.ctx.drawImage(
                tempCanvas,
                0, 0, imageWidth, imageHeight,  // source rect
                tile.screenX, tile.screenY, tile.scaledSize, tile.scaledSize  // dest rect
            );
        }

        // Draw loading indicators for tiles still refining (but only if not at level 0+)
        const pendingTiles = this.tileManager.getPendingTiles();
        if (pendingTiles.length > 0) {
            // Only show indicator for tiles with no preview at all
            this.ctx.fillStyle = COLORS.pendingTile;
            for (const { tileX, tileZ } of pendingTiles) {
                const currentLevel = this.tileCache.getCurrentRefinementLevel(
                    tileX, tileZ, mode, seed, lodLevel
                );
                // Only show loading for tiles with nothing cached
                if (currentLevel < 0) {
                    const screenX = halfWidth + (tileX - viewX) * zoom;
                    const screenY = halfHeight + (tileZ - viewZ) * zoom;
                    const scaledSize = worldTileSize * zoom;
                    this.ctx.fillRect(screenX, screenY, scaledSize, scaledSize);
                }
            }
        }
    }

    /**
     * Generate an instant preview at refinement level 0 (4x4 grid)
     * This runs synchronously on the main thread for immediate feedback
     * @private
     */
    _generateInstantPreview(tileX, tileZ, lodLevel, seed, template, mode) {
        const gridSize = REFINEMENT_LEVELS[0].gridSize;  // 4
        const sampling = REFINEMENT_LEVELS[0].sampling;  // 32

        const buffer = new Uint8ClampedArray(gridSize * gridSize * 4);
        const needsNeighbors = mode === 'elevation' || mode === 'composite';

        // Combined step: LOD step * refinement sampling
        const lodStep = 1 << lodLevel;
        const totalStep = sampling * lodStep;

        for (let py = 0; py < gridSize; py++) {
            for (let px = 0; px < gridSize; px++) {
                const wx = tileX + px * totalStep;
                const wz = tileZ + py * totalStep;

                const params = getTerrainParams(wx, wz, seed, template);

                let rgb;
                if (needsNeighbors) {
                    const leftParams = getTerrainParams(wx - totalStep, wz, seed, template);
                    const rightParams = getTerrainParams(wx + totalStep, wz, seed, template);
                    const upParams = getTerrainParams(wx, wz - totalStep, seed, template);
                    const downParams = getTerrainParams(wx, wz + totalStep, seed, template);

                    const neighbors = {
                        left: leftParams.height,
                        right: rightParams.height,
                        up: upParams.height,
                        down: downParams.height
                    };

                    rgb = getColorForMode(params, mode, neighbors);
                } else {
                    rgb = getColorForMode(params, mode);
                }

                const i = (py * gridSize + px) * 4;
                buffer[i] = rgb[0];
                buffer[i + 1] = rgb[1];
                buffer[i + 2] = rgb[2];
                buffer[i + 3] = 255;
            }
        }

        return new ImageData(buffer, gridSize, gridSize);
    }

    /**
     * Synchronous render path - blocks while generating tiles
     * Used as fallback when Web Worker is not available
     */
    _renderSync(width, height) {
        const { viewX, viewZ, zoom, seed, template, mode } = this.state;
        const halfWidth = width / 2;
        const halfHeight = height / 2;

        const lodLevel = calculateLOD(zoom);
        const worldTileSize = TILE_SIZE * (1 << lodLevel);

        // Calculate visible world bounds
        const bounds = getVisibleWorldBounds({ viewX, viewZ, zoom }, width, height);

        // Calculate tile range
        const alignToGrid = (coord) => Math.floor(coord / worldTileSize) * worldTileSize;
        const tileStartX = alignToGrid(Math.floor(bounds.minX));
        const tileEndX = alignToGrid(Math.ceil(bounds.maxX)) + worldTileSize;
        const tileStartZ = alignToGrid(Math.floor(bounds.minZ));
        const tileEndZ = alignToGrid(Math.ceil(bounds.maxZ)) + worldTileSize;

        this.ctx.imageSmoothingEnabled = zoom < 1;

        for (let tileWorldZ = tileStartZ; tileWorldZ < tileEndZ; tileWorldZ += worldTileSize) {
            for (let tileWorldX = tileStartX; tileWorldX < tileEndX; tileWorldX += worldTileSize) {
                // Get tile (from cache or render it synchronously)
                const tileImageData = this.tileCache.getTile(
                    tileWorldX,
                    tileWorldZ,
                    mode,
                    seed,
                    template,
                    lodLevel
                );

                // Calculate screen position
                const canvasX = halfWidth + (tileWorldX - viewX) * zoom;
                const canvasY = halfHeight + (tileWorldZ - viewZ) * zoom;
                const scaledSize = worldTileSize * zoom;

                // Draw tile using reusable temp canvas
                const { canvas: tempCanvas, ctx: tempCtx } = this._getTempCanvas(TILE_SIZE, TILE_SIZE);
                tempCtx.putImageData(tileImageData, 0, 0);

                this.ctx.drawImage(
                    tempCanvas,
                    0, 0, TILE_SIZE, TILE_SIZE,  // source rect
                    canvasX, canvasY, scaledSize, scaledSize  // dest rect
                );
            }
        }
    }

    /**
     * Get cache statistics
     */
    getCacheStats() {
        const stats = this.tileCache.getStats();
        const pending = this.tileManager ? this.tileManager.getPendingCount() : 0;
        const lod = calculateLOD(this.state.zoom);

        return {
            cached: stats.size,
            maxTiles: stats.maxTiles,
            pending,
            lod
        };
    }

    /**
     * Clear the tile cache
     */
    clearCache() {
        this.tileCache.invalidate();
        if (this.tileManager) {
            this.tileManager.cancelAllPending();
        }
        this.scheduleRender();
    }

    /**
     * Clean up resources
     */
    destroy() {
        if (this.renderRequestId) {
            cancelAnimationFrame(this.renderRequestId);
        }

        if (this.tileManager) {
            this.tileManager.destroy();
        }

        this.tileCache.invalidate();
    }
}
