/**
 * MapOverlay - Full-screen 2D map overlay for in-game terrain visualization
 *
 * Toggled with Tab key. Shows biome colors + hillshading + rivers + ocean.
 * Reuses the visualizer's TileManager/TileCache/tilegenerator worker for
 * async tile rendering with progressive refinement.
 */

import { TileCache } from '../tools/mapvisualizer/tilecache.js';
import { TileManager } from '../visualizer/tilemanager.js';
import { getNominalRadius, CONTINENT_SHAPE_CONFIG } from '../world/terrain/continentshape.js';
import { hash } from '../world/terrain/terraincore.js';

const TILE_SIZE = 128;
const MAX_TILES = 512;
const MIN_ZOOM = 0.2;
const MAX_ZOOM = 4.0;
const DEFAULT_ZOOM = 1.0;
const PAN_SPEED = 300;       // World blocks per second at zoom 1.0
const ZOOM_FACTOR = 1.15;

export class MapOverlay {
    constructor(seed, continentConfig = null) {
        this.seed = seed;
        this.isOpen = false;

        // Continental mode config
        this.continentConfig = continentConfig;
        if (continentConfig?.enabled) {
            // Derive continental seeds (same as in ContinentState)
            this.shapeSeed = Math.floor(hash(0, 0, seed + 111111) * 0x7FFFFFFF);
            this.climateSeed = Math.floor(hash(0, 0, seed + 555555) * 0x7FFFFFFF);
            this.baseRadius = continentConfig.baseRadius || 2000;
            this.template = continentConfig.template || 'default';
        }

        // View state
        this.viewX = 0;
        this.viewZ = 0;
        this.zoom = DEFAULT_ZOOM;

        // Player position
        this.playerWorldX = 0;
        this.playerWorldZ = 0;

        // Rendering mode
        this.mode = 'composite';

        // Create canvas overlay
        this.canvas = document.createElement('canvas');
        this.canvas.id = 'map-overlay-canvas';
        Object.assign(this.canvas.style, {
            position: 'fixed',
            top: '0', left: '0',
            width: '100%', height: '100%',
            zIndex: '5000',
            display: 'none',
            cursor: 'crosshair',
            imageRendering: 'pixelated',
            background: '#1a1a2e'
        });
        document.body.appendChild(this.canvas);
        this.ctx = this.canvas.getContext('2d', { willReadFrequently: false });

        // Create HUD
        this.hud = document.createElement('div');
        this.hud.id = 'map-overlay-hud';
        Object.assign(this.hud.style, {
            position: 'fixed',
            bottom: '20px', left: '50%',
            transform: 'translateX(-50%)',
            zIndex: '5001',
            display: 'none',
            background: 'rgba(0, 0, 0, 0.7)',
            color: 'white',
            fontFamily: 'monospace',
            fontSize: '14px',
            padding: '8px 16px',
            borderRadius: '4px',
            textAlign: 'center',
            pointerEvents: 'none'
        });
        document.body.appendChild(this.hud);

        // Tile cache and manager
        this.tileCache = new TileCache(TILE_SIZE, MAX_TILES);
        if (continentConfig?.enabled) {
            this.tileCache.setCoastlineParams(this.shapeSeed, this.baseRadius, this.template);
        }
        this.tileManager = null;
        this.tileManagerReady = false;
        this.renderPending = false;

        // Fog of war state
        this.visitedCells = new Set();    // Set<string> of "cellX,cellZ"
        this.fogOfWarEnabled = true;

        // Mouse pan state
        this.isPanning = false;
        this.panStartX = 0;
        this.panStartY = 0;
        this.panStartViewX = 0;
        this.panStartViewZ = 0;

        // Bound event handlers (for attach/detach)
        this._boundOnWheel = this._onWheel.bind(this);
        this._boundOnMouseDown = this._onMouseDown.bind(this);
        this._boundOnMouseMove = this._onMouseMove.bind(this);
        this._boundOnMouseUp = this._onMouseUp.bind(this);
        this._boundOnMouseLeave = this._onMouseLeave.bind(this);

        // Touch state
        this.touchState = {
            isPanning: false,
            isPinching: false,
            startX: 0, startZ: 0,
            startViewX: 0, startViewZ: 0,
            initialPinchDistance: 0, initialZoom: 0,
            pinchCenterX: 0, pinchCenterZ: 0
        };
        this._boundOnTouchStart = this._onTouchStart.bind(this);
        this._boundOnTouchMove = this._onTouchMove.bind(this);
        this._boundOnTouchEnd = this._onTouchEnd.bind(this);
        this._boundOnTouchCancel = this._onTouchCancel.bind(this);

        // Initialize worker asynchronously
        this._initWorker();
    }

    async _initWorker() {
        try {
            this.tileManager = new TileManager(
                this.tileCache,
                () => this._onTileReady()
            );
            const success = await this.tileManager.initWorker(this.seed);
            if (success) {
                this.tileManager.setMode(this.mode);
                if (this.continentConfig?.enabled) {
                    this.tileManager.setCoastlineParams(this.shapeSeed, this.baseRadius, this.template, this.climateSeed);
                }
                this.tileManagerReady = true;
            }
        } catch (error) {
            console.warn('MapOverlay: Worker init failed:', error);
        }
    }

    _onTileReady() {
        if (this.isOpen) {
            this._scheduleRender();
        }
    }

    _scheduleRender() {
        if (!this.renderPending) {
            this.renderPending = true;
            requestAnimationFrame(() => {
                this.renderPending = false;
                if (this.isOpen) this.render();
            });
        }
    }

    // --- Public API ---

    open(playerX, playerZ) {
        this.isOpen = true;
        this.playerWorldX = playerX;
        this.playerWorldZ = playerZ;
        this.viewX = playerX;
        this.viewZ = playerZ;

        this.resizeCanvas();
        this.canvas.style.display = 'block';
        this.hud.style.display = 'block';

        this._attachEventListeners();
        this.render();
    }

    close() {
        this.isOpen = false;
        this.canvas.style.display = 'none';
        this.hud.style.display = 'none';
        this.isPanning = false;
        this.touchState.isPanning = false;
        this.touchState.isPinching = false;

        this._detachEventListeners();
    }

    toggle(playerX, playerZ) {
        if (this.isOpen) {
            this.close();
        } else {
            this.open(playerX, playerZ);
        }
    }

    resizeCanvas() {
        this.canvas.width = window.innerWidth;
        this.canvas.height = window.innerHeight;
    }

    /**
     * Handle keyboard input (WASD pan, C center) - called from game loop
     */
    handleInput(input, deltaTime) {
        const panSpeed = PAN_SPEED / this.zoom * deltaTime;
        let needsRender = false;

        if (input.isKeyPressed('w') || input.isKeyPressed('arrowup')) {
            this.viewZ -= panSpeed;
            needsRender = true;
        }
        if (input.isKeyPressed('s') || input.isKeyPressed('arrowdown')) {
            this.viewZ += panSpeed;
            needsRender = true;
        }
        if (input.isKeyPressed('a') || input.isKeyPressed('arrowleft')) {
            this.viewX -= panSpeed;
            needsRender = true;
        }
        if (input.isKeyPressed('d') || input.isKeyPressed('arrowright')) {
            this.viewX += panSpeed;
            needsRender = true;
        }

        if (input.isKeyJustPressed('c')) {
            this.viewX = this.playerWorldX;
            this.viewZ = this.playerWorldZ;
            needsRender = true;
        }

        if (needsRender) {
            this.render();
        }
    }

    render() {
        const width = this.canvas.width;
        const height = this.canvas.height;

        // Clear
        this.ctx.fillStyle = '#1a1a2e';
        this.ctx.fillRect(0, 0, width, height);

        if (this.tileManagerReady) {
            this._renderTiles(width, height);
        }

        // Draw continental coastline overlay
        if (this.continentConfig?.enabled) {
            this._drawCoastline(width, height);
        }

        this._drawPlayerMarker(width, height);
        this._updateHUD();
    }

    // --- Coastline Overlay ---

    _drawCoastline(width, height) {
        const halfWidth = width / 2;
        const halfHeight = height / 2;
        const numPoints = 180;  // Sample every 2 degrees

        // First, draw ocean fill OUTSIDE the island using evenodd fill rule
        // Create a path: outer rectangle (clockwise) + island (counter-clockwise)
        this.ctx.beginPath();

        // Outer rectangle (clockwise) - covers entire canvas
        this.ctx.moveTo(0, 0);
        this.ctx.lineTo(width, 0);
        this.ctx.lineTo(width, height);
        this.ctx.lineTo(0, height);
        this.ctx.closePath();

        // Island coastline (counter-clockwise for evenodd fill)
        // Draw in REVERSE order to make it counter-clockwise
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

        // Fill ocean outside the island
        this.ctx.fillStyle = 'rgba(30, 60, 100, 0.95)';  // Deep blue ocean
        this.ctx.fill('evenodd');

        // Now draw the coastline stroke
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
        this.ctx.strokeStyle = 'rgba(0, 0, 0, 0.8)';  // Dark coastline
        this.ctx.lineWidth = 2;
        this.ctx.stroke();

        // Draw island center marker (origin)
        const centerScreenX = halfWidth + (0 - this.viewX) * this.zoom;
        const centerScreenY = halfHeight + (0 - this.viewZ) * this.zoom;

        // Only draw if on screen
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

    destroy() {
        this.close();
        if (this.tileManager) {
            this.tileManager.destroy();
        }
        this.canvas.remove();
        this.hud.remove();
    }

    // --- Fog of War ---

    /**
     * Mark cells around the player as visited.
     * Called every frame from game loop (even when map is closed).
     */
    markVisited(playerWorldX, playerWorldZ) {
        const cellX = Math.floor(playerWorldX / TILE_SIZE);
        const cellZ = Math.floor(playerWorldZ / TILE_SIZE);
        const radius = 3;

        for (let dx = -radius; dx <= radius; dx++) {
            for (let dz = -radius; dz <= radius; dz++) {
                this.visitedCells.add(`${cellX + dx},${cellZ + dz}`);
            }
        }
    }

    /**
     * Check if a tile has any visited cells overlapping it.
     * @param {number} tileX - Tile world X origin
     * @param {number} tileZ - Tile world Z origin
     * @param {number} worldTileSize - Size of tile in world blocks
     * @returns {boolean} True if any overlapping cell is visited
     */
    isTileVisible(tileX, tileZ, worldTileSize) {
        if (!this.fogOfWarEnabled) return true;

        // Compute which 128-block cells this tile overlaps
        const cellStartX = Math.floor(tileX / TILE_SIZE);
        const cellStartZ = Math.floor(tileZ / TILE_SIZE);
        const cellEndX = Math.floor((tileX + worldTileSize - 1) / TILE_SIZE);
        const cellEndZ = Math.floor((tileZ + worldTileSize - 1) / TILE_SIZE);

        for (let cx = cellStartX; cx <= cellEndX; cx++) {
            for (let cz = cellStartZ; cz <= cellEndZ; cz++) {
                if (this.visitedCells.has(`${cx},${cz}`)) {
                    return true;
                }
            }
        }
        return false;
    }

    /**
     * Get visited cells as array for serialization.
     * @returns {Array<string>}
     */
    getVisitedCellsArray() {
        return Array.from(this.visitedCells);
    }

    /**
     * Load visited cells from saved data.
     * @param {Array<string>} cellsArray
     */
    loadVisitedCells(cellsArray) {
        this.visitedCells = new Set(cellsArray || []);
    }

    /**
     * Toggle fog of war on/off (debug).
     */
    toggleFogOfWar() {
        this.fogOfWarEnabled = !this.fogOfWarEnabled;
        if (this.isOpen) {
            this.render();
        }
    }

    // --- Tile Rendering ---

    _renderTiles(width, height) {
        this.tileManager.updateViewport(
            this.viewX, this.viewZ,
            this.zoom,
            width, height
        );

        const lodLevel = this._calculateLOD();
        const worldTileSize = this.tileCache.getWorldTileSize(lodLevel);
        const visibleTiles = this.tileManager.getVisibleTiles();

        for (const tile of visibleTiles) {
            const imageWidth = tile.imageData.width;
            const imageHeight = tile.imageData.height;

            const tempCanvas = new OffscreenCanvas(imageWidth, imageHeight);
            const tempCtx = tempCanvas.getContext('2d');
            tempCtx.putImageData(tile.imageData, 0, 0);

            const isFullResolution = imageWidth >= TILE_SIZE;
            this.ctx.imageSmoothingEnabled = isFullResolution && this.zoom < 1;

            this.ctx.drawImage(
                tempCanvas,
                tile.screenX, tile.screenY,
                tile.scaledSize, tile.scaledSize
            );

            // Fog of war: darken unvisited tiles
            if (this.fogOfWarEnabled && !this.isTileVisible(tile.tileX, tile.tileZ, worldTileSize)) {
                this.ctx.fillStyle = 'rgba(20, 20, 40, 0.92)';
                this.ctx.fillRect(tile.screenX, tile.screenY, tile.scaledSize, tile.scaledSize);
            }
        }

        // Loading placeholders for pending tiles
        const pendingTiles = this.tileManager.getPendingTiles();
        if (pendingTiles.length > 0) {
            const halfWidth = width / 2;
            const halfHeight = height / 2;

            this.ctx.fillStyle = 'rgba(100, 100, 150, 0.3)';
            for (const { tileX, tileZ } of pendingTiles) {
                // Skip pending placeholders for fog-hidden tiles
                if (this.fogOfWarEnabled && !this.isTileVisible(tileX, tileZ, worldTileSize)) {
                    continue;
                }
                const screenX = halfWidth + (tileX - this.viewX) * this.zoom;
                const screenY = halfHeight + (tileZ - this.viewZ) * this.zoom;
                const scaledSize = worldTileSize * this.zoom;
                this.ctx.fillRect(screenX, screenY, scaledSize, scaledSize);
            }
        }
    }

    _calculateLOD() {
        if (this.zoom >= 1) return 0;
        const lod = Math.floor(-Math.log2(this.zoom));
        return Math.min(lod, 6);
    }

    // --- Player Marker ---

    _drawPlayerMarker(width, height) {
        const halfWidth = width / 2;
        const halfHeight = height / 2;

        const screenX = halfWidth + (this.playerWorldX - this.viewX) * this.zoom;
        const screenY = halfHeight + (this.playerWorldZ - this.viewZ) * this.zoom;

        // Only draw if on screen
        if (screenX < -20 || screenX > width + 20 || screenY < -20 || screenY > height + 20) {
            return;
        }

        // Red dot with white border
        this.ctx.beginPath();
        this.ctx.arc(screenX, screenY, 8, 0, Math.PI * 2);
        this.ctx.fillStyle = '#FF4444';
        this.ctx.fill();
        this.ctx.strokeStyle = '#FFFFFF';
        this.ctx.lineWidth = 2;
        this.ctx.stroke();

        // Inner dot
        this.ctx.beginPath();
        this.ctx.arc(screenX, screenY, 3, 0, Math.PI * 2);
        this.ctx.fillStyle = '#FFFFFF';
        this.ctx.fill();
    }

    // --- HUD ---

    _updateHUD() {
        this.hud.textContent =
            `Map  |  WASD: Pan  |  Scroll: Zoom  |  C: Center  |  Tab: Close` +
            `\nPosition: ${Math.round(this.viewX)}, ${Math.round(this.viewZ)}  |  Zoom: ${this.zoom.toFixed(1)}x`;
    }

    // --- Mouse Event Handlers ---

    _attachEventListeners() {
        this.canvas.addEventListener('wheel', this._boundOnWheel, { passive: false });
        this.canvas.addEventListener('mousedown', this._boundOnMouseDown);
        this.canvas.addEventListener('mousemove', this._boundOnMouseMove);
        this.canvas.addEventListener('mouseup', this._boundOnMouseUp);
        this.canvas.addEventListener('mouseleave', this._boundOnMouseLeave);
        this.canvas.addEventListener('touchstart', this._boundOnTouchStart, { passive: false });
        this.canvas.addEventListener('touchmove', this._boundOnTouchMove, { passive: false });
        this.canvas.addEventListener('touchend', this._boundOnTouchEnd);
        this.canvas.addEventListener('touchcancel', this._boundOnTouchCancel);
    }

    _detachEventListeners() {
        this.canvas.removeEventListener('wheel', this._boundOnWheel);
        this.canvas.removeEventListener('mousedown', this._boundOnMouseDown);
        this.canvas.removeEventListener('mousemove', this._boundOnMouseMove);
        this.canvas.removeEventListener('mouseup', this._boundOnMouseUp);
        this.canvas.removeEventListener('mouseleave', this._boundOnMouseLeave);
        this.canvas.removeEventListener('touchstart', this._boundOnTouchStart);
        this.canvas.removeEventListener('touchmove', this._boundOnTouchMove);
        this.canvas.removeEventListener('touchend', this._boundOnTouchEnd);
        this.canvas.removeEventListener('touchcancel', this._boundOnTouchCancel);
    }

    _onWheel(e) {
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
        const factor = e.deltaY > 0 ? 1 / ZOOM_FACTOR : ZOOM_FACTOR;
        const newZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, this.zoom * factor));

        if (newZoom !== this.zoom) {
            this.zoom = newZoom;

            // Keep cursor over same world point
            this.viewX = worldX - offsetX / this.zoom;
            this.viewZ = worldZ - offsetY / this.zoom;

            this.render();
        }
    }

    _onMouseDown(e) {
        if (e.button !== 0) return;
        e.preventDefault();
        this.isPanning = true;
        this.panStartX = e.clientX;
        this.panStartY = e.clientY;
        this.panStartViewX = this.viewX;
        this.panStartViewZ = this.viewZ;
        this.canvas.style.cursor = 'grabbing';
    }

    _onMouseMove(e) {
        if (!this.isPanning) return;
        const dx = e.clientX - this.panStartX;
        const dy = e.clientY - this.panStartY;
        this.viewX = this.panStartViewX - dx / this.zoom;
        this.viewZ = this.panStartViewZ - dy / this.zoom;
        this.render();
    }

    _onMouseUp(e) {
        if (e.button !== 0) return;
        this.isPanning = false;
        this.canvas.style.cursor = 'crosshair';
    }

    _onMouseLeave() {
        this.isPanning = false;
        this.canvas.style.cursor = 'crosshair';
    }

    // --- Touch Event Handlers ---

    _onTouchStart(e) {
        e.preventDefault();
        const rect = this.canvas.getBoundingClientRect();

        if (e.touches.length === 1) {
            const touch = e.touches[0];
            this.touchState.isPanning = true;
            this.touchState.isPinching = false;
            this.touchState.startX = touch.clientX - rect.left;
            this.touchState.startZ = touch.clientY - rect.top;
            this.touchState.startViewX = this.viewX;
            this.touchState.startViewZ = this.viewZ;
        } else if (e.touches.length === 2) {
            this.touchState.isPanning = false;
            this.touchState.isPinching = true;

            const t1 = e.touches[0];
            const t2 = e.touches[1];
            const dx = t2.clientX - t1.clientX;
            const dy = t2.clientY - t1.clientY;
            this.touchState.initialPinchDistance = Math.sqrt(dx * dx + dy * dy);
            this.touchState.initialZoom = this.zoom;
            this.touchState.pinchCenterX = (t1.clientX + t2.clientX) / 2 - rect.left;
            this.touchState.pinchCenterZ = (t1.clientY + t2.clientY) / 2 - rect.top;
            this.touchState.startViewX = this.viewX;
            this.touchState.startViewZ = this.viewZ;
        }
    }

    _onTouchMove(e) {
        e.preventDefault();

        if (e.touches.length === 1 && this.touchState.isPanning) {
            const touch = e.touches[0];
            const rect = this.canvas.getBoundingClientRect();
            const currentX = touch.clientX - rect.left;
            const currentY = touch.clientY - rect.top;
            const deltaX = currentX - this.touchState.startX;
            const deltaY = currentY - this.touchState.startZ;
            this.viewX = this.touchState.startViewX - deltaX / this.zoom;
            this.viewZ = this.touchState.startViewZ - deltaY / this.zoom;
            this.render();
        } else if (e.touches.length === 2 && this.touchState.isPinching) {
            const t1 = e.touches[0];
            const t2 = e.touches[1];
            const rect = this.canvas.getBoundingClientRect();

            const dx = t2.clientX - t1.clientX;
            const dy = t2.clientY - t1.clientY;
            const currentDistance = Math.sqrt(dx * dx + dy * dy);
            const scale = currentDistance / this.touchState.initialPinchDistance;
            const newZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, this.touchState.initialZoom * scale));

            const centerX = (t1.clientX + t2.clientX) / 2 - rect.left;
            const centerY = (t1.clientY + t2.clientY) / 2 - rect.top;
            const halfWidth = this.canvas.width / 2;
            const halfHeight = this.canvas.height / 2;

            const worldCenterX = this.touchState.startViewX +
                (this.touchState.pinchCenterX - halfWidth) / this.touchState.initialZoom;
            const worldCenterZ = this.touchState.startViewZ +
                (this.touchState.pinchCenterZ - halfHeight) / this.touchState.initialZoom;

            this.viewX = worldCenterX - (centerX - halfWidth) / newZoom;
            this.viewZ = worldCenterZ - (centerY - halfHeight) / newZoom;
            this.zoom = newZoom;

            this.render();
        }
    }

    _onTouchEnd(e) {
        if (e.touches.length === 0) {
            this.touchState.isPanning = false;
            this.touchState.isPinching = false;
        } else if (e.touches.length === 1 && this.touchState.isPinching) {
            const touch = e.touches[0];
            const rect = this.canvas.getBoundingClientRect();
            this.touchState.isPanning = true;
            this.touchState.isPinching = false;
            this.touchState.startX = touch.clientX - rect.left;
            this.touchState.startZ = touch.clientY - rect.top;
            this.touchState.startViewX = this.viewX;
            this.touchState.startViewZ = this.viewZ;
        }
    }

    _onTouchCancel() {
        this.touchState.isPanning = false;
        this.touchState.isPinching = false;
    }
}
