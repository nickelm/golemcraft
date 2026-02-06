/**
 * Terrain Visualizer - 2D color map of noise layers
 *
 * Visualizes terrain generation using shared terraincore.js functions.
 * Matches what the game generates in terrainworker.js.
 */

import { getTerrainParams, hash } from './world/terrain/terraincore.js';
import { getNominalRadius, computeStartPosition } from './world/terrain/continentshape.js';
import { deriveContinentSeed } from './worldgen/seeds.js';
import { TileCache } from './tools/mapvisualizer/tilecache.js';
import { TerrainCache } from './visualizer/terraincache.js';
import { TileManager } from './visualizer/tilemanager.js';

// Zoom limits
const MIN_ZOOM = 0.1;
const MAX_ZOOM = 4.0;

// Mode descriptions for UI
const MODE_DESCRIPTIONS = {
    temperature: 'Climate zones (blue = cold, white = temperate, red = hot)',
    humidity: 'Precipitation (yellow = arid, green = moderate, cyan = humid)',
    biome: 'Biome distribution (colored regions show biome types)',
    elevation: 'Terrain elevation with hillshade (blue = ocean, green = lowland, brown = highland, gray = mountain, white = peak)',
    composite: 'In-game map view (biome colors + hillshade + rivers)'
};

// Map mode names to getTerrainParams property names
const MODE_PARAM_MAP = {
    temperature: 'temperature',
    humidity: 'humidity',
    biome: 'biome',
    elevation: 'heightNormalized',  // Use normalized [0, 1] for display
    composite: 'biome'  // Shows biome in value display
};

class TerrainVisualizer {
    constructor(canvas, seed = 12345) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d', { willReadFrequently: true });

        // View state
        this.seed = seed;
        this.continentIndex = 0;
        this.baseRadius = 2000;  // Same as game.js continent config
        this.viewX = 0;
        this.viewZ = 0;
        this.zoom = 2.0;  // Pixels per world block
        this.mode = 'composite';

        // Derive continental seeds and center on start position
        this._updateDerivedSeeds();
        this._centerOnStartPosition();

        // Tile cache for improved pan/zoom performance
        // At zoom=0.3 on 1920x1080, we can have ~400+ visible tiles
        // Use larger cache to avoid thrashing
        this.tileCache = new TileCache(128, 512);
        this.tileCache.setCoastlineParams(this.shapeSeed, this.baseRadius);

        // Persistent terrain cache (IndexedDB)
        this.terrainCache = new TerrainCache();
        this.terrainCacheReady = false;

        // Async tile manager (Web Worker)
        this.tileManager = null;
        this.tileManagerReady = false;
        this.renderPending = false;
        this.useAsyncRendering = true;  // Can be toggled for fallback

        // Mouse tracking for value display
        this.mouseWorldX = 0;
        this.mouseWorldZ = 0;
        this.mouseValue = null;

        // Touch state for pan and pinch zoom
        this.touchState = {
            isPanning: false,
            isPinching: false,
            startX: 0,
            startZ: 0,
            startViewX: 0,
            startViewZ: 0,
            initialPinchDistance: 0,
            initialZoom: 0,
            pinchCenterX: 0,
            pinchCenterZ: 0
        };

        // Mouse pan state
        this.isMousePanning = false;
        this.mousePanStartX = 0;
        this.mousePanStartY = 0;
        this.mousePanStartViewX = 0;
        this.mousePanStartViewZ = 0;

        // Set canvas to full window size
        this.resizeCanvas();
        window.addEventListener('resize', () => {
            this.resizeCanvas();
            this.render();
        });

        // Setup event listeners
        this.setupEventListeners();

        // Initialize tile manager asynchronously
        this.initTerrainCache();
        this.initTileManager();
    }

    /**
     * Initialize the async tile manager (Web Worker)
     */
    async initTileManager() {
        try {
            this.tileManager = new TileManager(
                this.tileCache,
                () => this.onTileReady()  // Callback when tile arrives
            );

            const success = await this.tileManager.initWorker(this._getEffectiveSeed());
            if (success) {
                this.tileManager.setMode(this.mode);
                this.tileManager.setCoastlineParams(this.shapeSeed, this.baseRadius);
                this._updateTileFilter();
                this.tileManagerReady = true;
                this.useAsyncRendering = true;
                console.log('TileManager initialized with Web Worker');
                // Re-render with async now that worker is ready
                this.scheduleRender();
            } else {
                console.warn('TileManager: Worker failed to initialize, using synchronous fallback');
                this.useAsyncRendering = false;
            }
        } catch (error) {
            console.warn('Failed to initialize TileManager:', error);
            this.useAsyncRendering = false;
        }
    }

    /**
     * Called when a tile is ready from the worker
     */
    onTileReady() {
        // If we were in sync mode but worker is now ready, switch to async
        if (!this.useAsyncRendering && this.tileManager && this.tileManager.isWorkerAvailable()) {
            console.log('TileManager: Worker became ready, switching to async rendering');
            this.useAsyncRendering = true;
            this.tileManagerReady = true;
        }
        this.scheduleRender();
    }

    /**
     * Schedule a render on next animation frame (for async tile loading)
     */
    scheduleRender() {
        if (!this.renderPending) {
            this.renderPending = true;
            requestAnimationFrame(() => {
                this.renderPending = false;
                this.render();
            });
        }
    }

    /**
     * Initialize the persistent terrain cache (IndexedDB)
     */
    async initTerrainCache() {
        try {
            const success = await this.terrainCache.init();
            if (success) {
                this.terrainCache.setCacheVersion(this._getEffectiveSeed());
                this.tileCache.setTerrainCache(this.terrainCache);
                this.terrainCacheReady = true;
                console.log('TerrainCache initialized and connected to TileCache');

                // Log initial cache stats
                const stats = await this.terrainCache.getCacheStats();
                console.log(`TerrainCache stats: ${stats.entryCount} entries, ~${(stats.approximateSize / 1024).toFixed(1)} KB`);
            }
        } catch (error) {
            console.warn('Failed to initialize TerrainCache:', error);
        }
    }

    /**
     * Clear the persistent terrain cache
     */
    async clearTerrainCache() {
        if (this.terrainCache) {
            await this.terrainCache.invalidateAll();
            this.tileCache.invalidate();
            this.render();
            console.log('TerrainCache cleared');
        }
    }

    /**
     * Get terrain cache statistics
     * @returns {Promise<{entryCount: number, approximateSize: number}>}
     */
    async getTerrainCacheStats() {
        if (this.terrainCache) {
            return await this.terrainCache.getCacheStats();
        }
        return { entryCount: 0, approximateSize: 0 };
    }

    resizeCanvas() {
        this.canvas.width = window.innerWidth;
        this.canvas.height = window.innerHeight;
    }

    setupEventListeners() {
        // Keyboard controls
        window.addEventListener('keydown', (e) => {
            const panAmount = 10; // World blocks per keypress

            switch(e.key) {
                case 'ArrowUp':
                    this.pan(0, -panAmount);
                    e.preventDefault();
                    break;
                case 'ArrowDown':
                    this.pan(0, panAmount);
                    e.preventDefault();
                    break;
                case 'ArrowLeft':
                    this.pan(-panAmount, 0);
                    e.preventDefault();
                    break;
                case 'ArrowRight':
                    this.pan(panAmount, 0);
                    e.preventDefault();
                    break;
                case '+':
                case '=':
                    this.setZoom(Math.min(MAX_ZOOM, this.zoom * 1.2));
                    e.preventDefault();
                    break;
                case '-':
                case '_':
                    this.setZoom(Math.max(MIN_ZOOM, this.zoom / 1.2));
                    e.preventDefault();
                    break;
                case '1':
                    this.setMode('temperature');
                    break;
                case '2':
                    this.setMode('humidity');
                    break;
                case '3':
                    this.setMode('biome');
                    break;
                case '4':
                    this.setMode('elevation');
                    break;
                case '5':
                    this.setMode('composite');
                    break;
            }
        });

        // Mouse wheel zoom toward cursor
        this.canvas.addEventListener('wheel', (e) => {
            e.preventDefault();

            const rect = this.canvas.getBoundingClientRect();
            const canvasCenterX = this.canvas.width / 2;
            const canvasCenterY = this.canvas.height / 2;
            const offsetX = (e.clientX - rect.left) - canvasCenterX;
            const offsetY = (e.clientY - rect.top) - canvasCenterY;

            // World position under cursor before zoom
            const worldX = this.viewX + offsetX / this.zoom;
            const worldZ = this.viewZ + offsetY / this.zoom;

            // Adjust zoom
            const factor = e.deltaY > 0 ? 0.9 : 1.1;
            const newZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, this.zoom * factor));

            if (newZoom !== this.zoom) {
                this.zoom = newZoom;

                // Keep cursor over same world point
                this.viewX = worldX - offsetX / this.zoom;
                this.viewZ = worldZ - offsetY / this.zoom;

                this.updateInfoDisplay();
                this.scheduleRender();
            }
        }, { passive: false });

        // Mouse pan: left-drag
        this.canvas.addEventListener('mousedown', (e) => {
            if (e.button !== 0) return; // Left button only
            e.preventDefault();
            this.isMousePanning = true;
            this.mousePanStartX = e.clientX;
            this.mousePanStartY = e.clientY;
            this.mousePanStartViewX = this.viewX;
            this.mousePanStartViewZ = this.viewZ;
            this.canvas.classList.add('panning');
        });

        // Mouse move: coordinate display + pan handling
        this.canvas.addEventListener('mousemove', (e) => {
            const rect = this.canvas.getBoundingClientRect();
            const canvasX = e.clientX - rect.left;
            const canvasY = e.clientY - rect.top;
            const halfWidth = this.canvas.width / 2;
            const halfHeight = this.canvas.height / 2;

            // Update world coordinates
            this.mouseWorldX = this.viewX + (canvasX - halfWidth) / this.zoom;
            this.mouseWorldZ = this.viewZ + (canvasY - halfHeight) / this.zoom;

            // Handle panning
            if (this.isMousePanning) {
                const dx = e.clientX - this.mousePanStartX;
                const dy = e.clientY - this.mousePanStartY;
                this.viewX = this.mousePanStartViewX - dx / this.zoom;
                this.viewZ = this.mousePanStartViewZ - dy / this.zoom;

                // Update world coords after view change
                this.mouseWorldX = this.viewX + (canvasX - halfWidth) / this.zoom;
                this.mouseWorldZ = this.viewZ + (canvasY - halfHeight) / this.zoom;

                this.scheduleRender();
            }

            // Sample the value at mouse position
            const params = getTerrainParams(this.mouseWorldX, this.mouseWorldZ, this._getEffectiveSeed());
            const paramName = MODE_PARAM_MAP[this.mode];
            this.mouseValue = params[paramName];

            this.updateInfoDisplay();
        });

        this.canvas.addEventListener('mouseup', (e) => {
            if (e.button !== 0) return;
            this.isMousePanning = false;
            this.canvas.classList.remove('panning');
        });

        this.canvas.addEventListener('mouseleave', () => {
            this.isMousePanning = false;
            this.canvas.classList.remove('panning');
        });

        // Touch event listeners for pan and pinch zoom
        this.setupTouchListeners();
    }

    /**
     * Set up touch event listeners for pan and pinch zoom
     */
    setupTouchListeners() {
        // Touch start - initialize pan or pinch
        this.canvas.addEventListener('touchstart', (e) => {
            e.preventDefault();

            if (e.touches.length === 1) {
                // Single touch - start pan
                const touch = e.touches[0];
                const rect = this.canvas.getBoundingClientRect();

                this.touchState.isPanning = true;
                this.touchState.isPinching = false;
                this.touchState.startX = touch.clientX - rect.left;
                this.touchState.startZ = touch.clientY - rect.top;
                this.touchState.startViewX = this.viewX;
                this.touchState.startViewZ = this.viewZ;

                // Update coords display for touch position
                this.updateTouchCoords(touch.clientX - rect.left, touch.clientY - rect.top);
            } else if (e.touches.length === 2) {
                // Two touches - start pinch zoom
                this.touchState.isPanning = false;
                this.touchState.isPinching = true;

                const touch1 = e.touches[0];
                const touch2 = e.touches[1];
                const rect = this.canvas.getBoundingClientRect();

                // Calculate initial pinch distance
                const dx = touch2.clientX - touch1.clientX;
                const dy = touch2.clientY - touch1.clientY;
                this.touchState.initialPinchDistance = Math.sqrt(dx * dx + dy * dy);
                this.touchState.initialZoom = this.zoom;

                // Calculate pinch center in canvas coordinates
                const centerX = (touch1.clientX + touch2.clientX) / 2 - rect.left;
                const centerY = (touch1.clientY + touch2.clientY) / 2 - rect.top;

                // Store pinch center in world coordinates for zoom-toward-center
                const halfWidth = this.canvas.width / 2;
                const halfHeight = this.canvas.height / 2;
                this.touchState.pinchCenterX = centerX;
                this.touchState.pinchCenterZ = centerY;
                this.touchState.startViewX = this.viewX;
                this.touchState.startViewZ = this.viewZ;

                // Clear value display during pinch
                this.mouseValue = null;
                this.updateInfoDisplay();
            }
        }, { passive: false });

        // Touch move - pan or pinch zoom
        this.canvas.addEventListener('touchmove', (e) => {
            e.preventDefault();

            if (e.touches.length === 1 && this.touchState.isPanning) {
                // Single touch pan
                const touch = e.touches[0];
                const rect = this.canvas.getBoundingClientRect();
                const currentX = touch.clientX - rect.left;
                const currentY = touch.clientY - rect.top;

                // Calculate delta in canvas pixels
                const deltaX = currentX - this.touchState.startX;
                const deltaY = currentY - this.touchState.startZ;

                // Convert to world units (inverted - drag right moves view left)
                this.viewX = this.touchState.startViewX - deltaX / this.zoom;
                this.viewZ = this.touchState.startViewZ - deltaY / this.zoom;

                // Update coords display for current touch position
                this.updateTouchCoords(currentX, currentY);

                this.render();
            } else if (e.touches.length === 2 && this.touchState.isPinching) {
                // Pinch zoom
                const touch1 = e.touches[0];
                const touch2 = e.touches[1];
                const rect = this.canvas.getBoundingClientRect();

                // Calculate current pinch distance
                const dx = touch2.clientX - touch1.clientX;
                const dy = touch2.clientY - touch1.clientY;
                const currentDistance = Math.sqrt(dx * dx + dy * dy);

                // Calculate scale factor
                const scale = currentDistance / this.touchState.initialPinchDistance;
                const newZoom = Math.max(0.01, Math.min(10, this.touchState.initialZoom * scale));

                // Calculate pinch center in current canvas coords
                const centerX = (touch1.clientX + touch2.clientX) / 2 - rect.left;
                const centerY = (touch1.clientY + touch2.clientY) / 2 - rect.top;

                // Zoom toward pinch center
                const halfWidth = this.canvas.width / 2;
                const halfHeight = this.canvas.height / 2;

                // World position under pinch center before zoom
                const worldCenterX = this.touchState.startViewX + (this.touchState.pinchCenterX - halfWidth) / this.touchState.initialZoom;
                const worldCenterZ = this.touchState.startViewZ + (this.touchState.pinchCenterZ - halfHeight) / this.touchState.initialZoom;

                // Adjust view to keep world position under pinch center
                this.viewX = worldCenterX - (centerX - halfWidth) / newZoom;
                this.viewZ = worldCenterZ - (centerY - halfHeight) / newZoom;
                this.zoom = newZoom;

                this.render();
                this.updateInfoDisplay();
            }
        }, { passive: false });

        // Touch end - stop pan or pinch
        this.canvas.addEventListener('touchend', (e) => {
            if (e.touches.length === 0) {
                // All touches released
                this.touchState.isPanning = false;
                this.touchState.isPinching = false;
            } else if (e.touches.length === 1 && this.touchState.isPinching) {
                // Switched from pinch to pan
                const touch = e.touches[0];
                const rect = this.canvas.getBoundingClientRect();

                this.touchState.isPanning = true;
                this.touchState.isPinching = false;
                this.touchState.startX = touch.clientX - rect.left;
                this.touchState.startZ = touch.clientY - rect.top;
                this.touchState.startViewX = this.viewX;
                this.touchState.startViewZ = this.viewZ;
            }
        });

        // Touch cancel - reset state
        this.canvas.addEventListener('touchcancel', () => {
            this.touchState.isPanning = false;
            this.touchState.isPinching = false;
        });
    }

    /**
     * Update coordinates display for touch position
     * @param {number} canvasX - X position in canvas pixels
     * @param {number} canvasY - Y position in canvas pixels
     */
    updateTouchCoords(canvasX, canvasY) {
        const halfWidth = this.canvas.width / 2;
        const halfHeight = this.canvas.height / 2;

        this.mouseWorldX = this.viewX + (canvasX - halfWidth) / this.zoom;
        this.mouseWorldZ = this.viewZ + (canvasY - halfHeight) / this.zoom;

        // Sample the value at touch position
        const params = getTerrainParams(this.mouseWorldX, this.mouseWorldZ, this._getEffectiveSeed());
        const paramName = MODE_PARAM_MAP[this.mode];
        this.mouseValue = params[paramName];

        this.updateInfoDisplay();
    }

    pan(dx, dz) {
        this.viewX += dx;
        this.viewZ += dz;
        this.render();
        this.updateInfoDisplay();
    }

    setZoom(newZoom) {
        // Clamp zoom between 0.01x and 10x (allow very zoomed out views)
        this.zoom = Math.max(0.01, Math.min(10, newZoom));
        this.render();
        this.updateInfoDisplay();
    }

    /**
     * Calculate appropriate LOD level based on zoom
     * LOD 0 = 1:1 (zoom >= 1), LOD 1 = 1:2 (zoom >= 0.5), LOD 2 = 1:4 (zoom >= 0.25), etc.
     * @returns {number} LOD level (0, 1, 2, ...)
     */
    calculateLOD() {
        if (this.zoom >= 1) return 0;
        // LOD = floor(-log2(zoom)), but capped at reasonable maximum
        const lod = Math.floor(-Math.log2(this.zoom));
        return Math.min(lod, 6); // Cap at LOD 6 (1:64 sampling)
    }

    setMode(newMode) {
        this.mode = newMode;
        this.tileCache.invalidate();

        // Update tile manager mode
        if (this.tileManager) {
            this.tileManager.setMode(newMode);
        }

        this.render();

        // Update UI
        document.getElementById('mode-select').value = newMode;
        document.getElementById('mode-description').textContent = MODE_DESCRIPTIONS[newMode];
    }

    setSeed(newSeed) {
        this.seed = newSeed;
        this._updateDerivedSeeds();
        this._centerOnStartPosition();

        const effectiveSeed = this._getEffectiveSeed();

        // Update terrain cache version so old entries become orphaned
        if (this.terrainCacheReady) {
            this.terrainCache.setCacheVersion(effectiveSeed);
        }

        // Update tile manager configuration
        if (this.tileManager) {
            this.tileManager.updateConfig(effectiveSeed, this.mode);
        }

        this._updateTileFilter();
        this.tileCache.invalidate();
        this.render();
    }

    setContinentIndex(index) {
        this.continentIndex = Math.max(0, index);
        this._updateDerivedSeeds();
        this._centerOnStartPosition();

        const effectiveSeed = this._getEffectiveSeed();

        if (this.terrainCacheReady) {
            this.terrainCache.setCacheVersion(effectiveSeed);
        }

        if (this.tileManager) {
            this.tileManager.updateConfig(effectiveSeed, this.mode);
        }

        this._updateTileFilter();
        this.tileCache.invalidate();
        this.render();
    }

    _getEffectiveSeed() {
        return this.continentIndex === 0
            ? this.seed
            : deriveContinentSeed(this.seed, this.continentIndex);
    }

    _updateDerivedSeeds() {
        const effectiveSeed = this._getEffectiveSeed();
        this.shapeSeed = Math.floor(hash(0, 0, effectiveSeed + 111111) * 0x7FFFFFFF);
        this.startSeed = Math.floor(hash(0, 0, effectiveSeed + 333333) * 0x7FFFFFFF);
        this.startPosition = computeStartPosition(this.startSeed, this.shapeSeed, this.baseRadius);
    }

    _centerOnStartPosition() {
        this.viewX = this.startPosition.x;
        this.viewZ = this.startPosition.z;
    }

    /**
     * Check if a tile overlaps the island coastline (should be rendered).
     * Uses the tile's closest corner to island center vs nominal radius.
     * @param {number} tileX - Tile world X origin
     * @param {number} tileZ - Tile world Z origin
     * @param {number} worldTileSize - Tile size in world blocks
     * @returns {boolean} True if tile is inside or near coastline
     */
    _isTileInsideCoastline(tileX, tileZ, worldTileSize) {
        // Find the closest point on the tile to the island center (0, 0)
        const closestX = Math.max(tileX, Math.min(0, tileX + worldTileSize));
        const closestZ = Math.max(tileZ, Math.min(0, tileZ + worldTileSize));
        const distToCenter = Math.sqrt(closestX * closestX + closestZ * closestZ);

        // Use angle from tile center for radius lookup
        const tileCenterX = tileX + worldTileSize / 2;
        const tileCenterZ = tileZ + worldTileSize / 2;
        const angle = Math.atan2(tileCenterZ, tileCenterX);
        const nominalRadius = getNominalRadius(angle, this.shapeSeed, this.baseRadius);

        // Include a margin equal to tile diagonal so we don't clip corners
        const margin = worldTileSize * 1.5;
        return distToCenter < nominalRadius + margin;
    }

    /**
     * Update the tile filter on the TileManager based on current coastline
     */
    _updateTileFilter() {
        // Update coastline params on TileCache (for sync rendering)
        this.tileCache.setCoastlineParams(this.shapeSeed, this.baseRadius);

        if (this.tileManager) {
            // Update tile filter (skip entire tiles far outside coastline)
            this.tileManager.setTileFilter((tileX, tileZ, worldTileSize) => {
                return this._isTileInsideCoastline(tileX, tileZ, worldTileSize);
            });
            // Update coastline params (for per-pixel ocean check in worker)
            this.tileManager.setCoastlineParams(this.shapeSeed, this.baseRadius);
        }
    }

    updateInfoDisplay() {
        document.getElementById('pos-display').textContent =
            `${Math.round(this.viewX)}, ${Math.round(this.viewZ)}`;
        document.getElementById('zoom-display').textContent =
            this.zoom.toFixed(1);

        if (this.mouseValue !== null) {
            if (typeof this.mouseValue === 'string') {
                document.getElementById('value-display').textContent = this.mouseValue;
            } else {
                document.getElementById('value-display').textContent =
                    this.mouseValue.toFixed(3);
            }
        }
    }

    render() {
        const startTime = performance.now();

        const width = this.canvas.width;
        const height = this.canvas.height;
        const tileSize = this.tileCache.tileSize;

        // Clear canvas with dark background
        this.ctx.fillStyle = '#1a1a2e';
        this.ctx.fillRect(0, 0, width, height);

        // Use async rendering if available, otherwise fall back to synchronous
        if (this.useAsyncRendering && this.tileManagerReady) {
            this._renderAsync(startTime, width, height, tileSize);
        } else {
            this._renderSync(startTime, width, height, tileSize);
        }
    }

    /**
     * Async render path - uses Web Worker for tile generation
     * Non-blocking: only draws tiles that are already cached
     * @private
     */
    _renderAsync(startTime, width, height, tileSize) {
        // Update tile manager with current viewport
        this.tileManager.updateViewport(
            this.viewX,
            this.viewZ,
            this.zoom,
            width,
            height
        );

        // Get tiles that are ready (from memory cache)
        const visibleTiles = this.tileManager.getVisibleTiles();
        let tilesDrawn = 0;

        // Draw cached tiles (supports progressive refinement with varying image sizes)
        for (const tile of visibleTiles) {
            // Get actual image dimensions (may be smaller than tileSize for progressive previews)
            const imageWidth = tile.imageData.width;
            const imageHeight = tile.imageData.height;

            const tempCanvas = new OffscreenCanvas(imageWidth, imageHeight);
            const tempCtx = tempCanvas.getContext('2d');
            tempCtx.putImageData(tile.imageData, 0, 0);

            // Use blocky upscaling for low-resolution previews (pixel art style)
            // Use smooth interpolation only for full resolution tiles when zoomed out
            const isFullResolution = imageWidth >= tileSize;
            this.ctx.imageSmoothingEnabled = isFullResolution && this.zoom < 1;

            this.ctx.drawImage(
                tempCanvas,
                tile.screenX,
                tile.screenY,
                tile.scaledSize,
                tile.scaledSize
            );
            tilesDrawn++;
        }

        // Draw loading indicators for pending tiles
        const pendingTiles = this.tileManager.getPendingTiles();
        if (pendingTiles.length > 0) {
            const lodLevel = this.calculateLOD();
            const worldTileSize = this.tileCache.getWorldTileSize(lodLevel);
            const halfWidth = width / 2;
            const halfHeight = height / 2;

            this.ctx.fillStyle = 'rgba(100, 100, 150, 0.3)';
            for (const { tileX, tileZ } of pendingTiles) {
                const screenX = halfWidth + (tileX - this.viewX) * this.zoom;
                const screenY = halfHeight + (tileZ - this.viewZ) * this.zoom;
                const scaledSize = worldTileSize * this.zoom;

                this.ctx.fillRect(screenX, screenY, scaledSize, scaledSize);
            }
        }

        const endTime = performance.now();
        const renderTime = endTime - startTime;

        // Draw coastline overlay and spawn marker on top of tiles
        this._drawCoastline(width, height);
        this._drawSpawnMarker(width, height);

        // Log render performance only occasionally when tiles are still loading
        const pendingCount = this.tileManager.getPendingCount();
        if (pendingCount > 0 && Math.random() < 0.1) {  // Log ~10% of the time
            const stats = this.tileCache.getStats();
            console.log(`Async render: ${renderTime.toFixed(1)}ms (${tilesDrawn} drawn, ${pendingCount} pending, ${stats.size}/${stats.maxTiles} cached)`);
        }
    }

    /**
     * Synchronous render path - blocks while generating tiles
     * Used as fallback when Web Worker is not available
     * @private
     */
    _renderSync(startTime, width, height, tileSize) {
        const halfWidth = width / 2;
        const halfHeight = height / 2;

        // Calculate LOD level based on zoom
        const lodLevel = this.calculateLOD();
        const worldTileSize = this.tileCache.getWorldTileSize(lodLevel);

        // Calculate visible world bounds
        const worldLeft = this.viewX - halfWidth / this.zoom;
        const worldRight = this.viewX + halfWidth / this.zoom;
        const worldTop = this.viewZ - halfHeight / this.zoom;
        const worldBottom = this.viewZ + halfHeight / this.zoom;

        // Calculate which tiles are needed (aligned to tile grid at current LOD)
        const tileStartX = this.tileCache.alignToGrid(Math.floor(worldLeft), lodLevel);
        const tileEndX = this.tileCache.alignToGrid(Math.ceil(worldRight), lodLevel) + worldTileSize;
        const tileStartZ = this.tileCache.alignToGrid(Math.floor(worldTop), lodLevel);
        const tileEndZ = this.tileCache.alignToGrid(Math.ceil(worldBottom), lodLevel) + worldTileSize;

        let tilesRendered = 0;
        let tilesCached = 0;

        const effectiveSeed = this._getEffectiveSeed();

        // Render each visible tile
        for (let tileWorldZ = tileStartZ; tileWorldZ < tileEndZ; tileWorldZ += worldTileSize) {
            for (let tileWorldX = tileStartX; tileWorldX < tileEndX; tileWorldX += worldTileSize) {
                // Skip tiles outside the coastline
                if (!this._isTileInsideCoastline(tileWorldX, tileWorldZ, worldTileSize)) {
                    continue;
                }

                // Check if tile was already cached
                const wasCached = this.tileCache.hasTile(tileWorldX, tileWorldZ, this.mode, effectiveSeed, lodLevel);

                // Get tile (from cache or render it)
                const tileImageData = this.tileCache.getTile(
                    tileWorldX,
                    tileWorldZ,
                    this.mode,
                    effectiveSeed,
                    lodLevel
                );

                if (wasCached) {
                    tilesCached++;
                } else {
                    tilesRendered++;
                }

                // Calculate canvas position for this tile
                const canvasX = halfWidth + (tileWorldX - this.viewX) * this.zoom;
                const canvasY = halfHeight + (tileWorldZ - this.viewZ) * this.zoom;
                const scaledSize = worldTileSize * this.zoom;

                // Draw tile to canvas
                const tempCanvas = new OffscreenCanvas(tileSize, tileSize);
                const tempCtx = tempCanvas.getContext('2d');
                tempCtx.putImageData(tileImageData, 0, 0);

                // Enable smoothing when zoomed out
                this.ctx.imageSmoothingEnabled = this.zoom < 1;
                this.ctx.drawImage(tempCanvas, canvasX, canvasY, scaledSize, scaledSize);
            }
        }

        // Draw coastline overlay and spawn marker on top of tiles
        this._drawCoastline(width, height);
        this._drawSpawnMarker(width, height);

        const endTime = performance.now();
        const renderTime = endTime - startTime;

        // Log render performance
        const stats = this.tileCache.getStats();
        console.log(`Sync render: ${renderTime.toFixed(1)}ms (${tilesRendered} new, ${tilesCached} cached, ${stats.size}/${stats.maxTiles} in cache, LOD ${lodLevel})`);
    }

    /**
     * Draw coastline overlay (ocean fill + yellow coastline stroke + island center marker)
     * Same rendering as MapOverlay._drawCoastline()
     * @private
     */
    _drawCoastline(width, height) {
        const halfWidth = width / 2;
        const halfHeight = height / 2;
        const numPoints = 180;

        // Ocean fill outside the island using evenodd fill rule
        this.ctx.beginPath();

        // Outer rectangle (clockwise) - covers entire canvas
        this.ctx.moveTo(0, 0);
        this.ctx.lineTo(width, 0);
        this.ctx.lineTo(width, height);
        this.ctx.lineTo(0, height);
        this.ctx.closePath();

        // Island coastline (counter-clockwise for evenodd fill)
        let firstPoint = true;
        for (let i = numPoints; i >= 0; i--) {
            const angle = (i / numPoints) * Math.PI * 2;
            const radius = getNominalRadius(angle, this.shapeSeed, this.baseRadius);

            const worldX = Math.cos(angle) * radius;
            const worldZ = Math.sin(angle) * radius;

            const screenX = halfWidth + (worldX - this.viewX) * this.zoom;
            const screenY = halfHeight + (worldZ - this.viewZ) * this.zoom;

            if (firstPoint) {
                this.ctx.moveTo(screenX, screenY);
                firstPoint = false;
            } else {
                this.ctx.lineTo(screenX, screenY);
            }
        }
        this.ctx.closePath();

        this.ctx.fillStyle = 'rgba(30, 60, 100, 0.95)';
        this.ctx.fill('evenodd');

        // Coastline stroke
        this.ctx.beginPath();
        firstPoint = true;
        for (let i = 0; i <= numPoints; i++) {
            const angle = (i / numPoints) * Math.PI * 2;
            const radius = getNominalRadius(angle, this.shapeSeed, this.baseRadius);

            const worldX = Math.cos(angle) * radius;
            const worldZ = Math.sin(angle) * radius;

            const screenX = halfWidth + (worldX - this.viewX) * this.zoom;
            const screenY = halfHeight + (worldZ - this.viewZ) * this.zoom;

            if (firstPoint) {
                this.ctx.moveTo(screenX, screenY);
                firstPoint = false;
            } else {
                this.ctx.lineTo(screenX, screenY);
            }
        }
        this.ctx.closePath();
        this.ctx.strokeStyle = 'rgba(0, 0, 0, 0.8)';
        this.ctx.lineWidth = 2;
        this.ctx.stroke();

        // Island center marker (origin)
        const centerScreenX = halfWidth + (0 - this.viewX) * this.zoom;
        const centerScreenY = halfHeight + (0 - this.viewZ) * this.zoom;

        if (centerScreenX >= -20 && centerScreenX <= width + 20 &&
            centerScreenY >= -20 && centerScreenY <= height + 20) {
            this.ctx.beginPath();
            this.ctx.arc(centerScreenX, centerScreenY, 5, 0, Math.PI * 2);
            this.ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
            this.ctx.fill();
            this.ctx.strokeStyle = 'rgba(0, 0, 0, 0.8)';
            this.ctx.lineWidth = 1;
            this.ctx.stroke();
        }
    }

    /**
     * Draw spawn point marker at the computed start position
     * @private
     */
    _drawSpawnMarker(width, height) {
        const halfWidth = width / 2;
        const halfHeight = height / 2;

        const screenX = halfWidth + (this.startPosition.x - this.viewX) * this.zoom;
        const screenY = halfHeight + (this.startPosition.z - this.viewZ) * this.zoom;

        if (screenX < -20 || screenX > width + 20 || screenY < -20 || screenY > height + 20) {
            return;
        }

        // Red dot with white border (same as player marker in mapoverlay)
        this.ctx.beginPath();
        this.ctx.arc(screenX, screenY, 8, 0, Math.PI * 2);
        this.ctx.fillStyle = '#FF4444';
        this.ctx.fill();
        this.ctx.strokeStyle = '#FFFFFF';
        this.ctx.lineWidth = 2;
        this.ctx.stroke();
    }
}

// Initialize visualizer on page load
window.addEventListener('DOMContentLoaded', () => {
    const canvas = document.getElementById('terrain-canvas');
    const seedInput = document.getElementById('seed-input');
    const modeSelect = document.getElementById('mode-select');
    const continentInput = document.getElementById('continent-input');

    // Create visualizer with default seed
    const visualizer = new TerrainVisualizer(canvas, parseInt(seedInput.value));

    // Initial render
    visualizer.render();
    visualizer.updateInfoDisplay();

    // Wire up UI controls
    seedInput.addEventListener('change', (e) => {
        const newSeed = parseInt(e.target.value) || 12345;
        visualizer.setSeed(newSeed);
    });

    continentInput.addEventListener('change', (e) => {
        const index = parseInt(e.target.value) || 0;
        visualizer.setContinentIndex(Math.max(0, index));
    });

    modeSelect.addEventListener('change', (e) => {
        visualizer.setMode(e.target.value);
    });

    // Clear cache button
    const clearCacheBtn = document.getElementById('clear-cache-btn');
    const cacheStatsEl = document.getElementById('cache-stats');

    clearCacheBtn.addEventListener('click', async () => {
        await visualizer.clearTerrainCache();
        updateCacheStats();
    });

    // Update cache stats display
    async function updateCacheStats() {
        const stats = await visualizer.getTerrainCacheStats();
        if (stats.entryCount === 0) {
            cacheStatsEl.textContent = 'Empty';
        } else {
            const sizeKB = (stats.approximateSize / 1024).toFixed(1);
            cacheStatsEl.textContent = `${stats.entryCount} entries, ~${sizeKB} KB`;
        }
    }

    // Update stats periodically
    setInterval(updateCacheStats, 5000);
    updateCacheStats();

    // Control panel collapse/expand toggle
    const controlsPanel = document.getElementById('controls');
    const controlsToggle = document.getElementById('controls-toggle');
    controlsToggle.addEventListener('click', () => {
        controlsPanel.classList.toggle('collapsed');
        controlsToggle.textContent = controlsPanel.classList.contains('collapsed') ? '+' : '−';
    });

    // Make visualizer globally accessible for debugging
    window.visualizer = visualizer;

    console.log('Terrain Visualizer initialized');
    console.log('Controls: Arrow keys = pan, +/- = zoom, 1-6 = switch mode');
});
