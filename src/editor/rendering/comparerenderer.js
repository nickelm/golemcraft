/**
 * Template Editor - CompareRenderer
 *
 * Renders multiple seeds side-by-side for comparison.
 * Creates separate canvases for each seed in a grid layout.
 */

import { TILE_SIZE, MAX_CACHED_TILES, COLORS, EVENTS } from '../core/constants.js';
import { calculateLOD, worldToCanvas, getVisibleWorldBounds } from '../utils/coordinates.js';
import { TileCache } from '../../tools/mapvisualizer/tilecache.js';
import { TileManager } from '../../visualizer/tilemanager.js';
import { WorldGenerator } from '../../world/worldgenerator.js';
import { buildRiverIndex, buildSpineIndex } from '../../world/terrain/worldgen.js';
import { getZoneLevelColor } from '../../tools/mapvisualizer/colors.js';

export class CompareRenderer {
    /**
     * @param {HTMLElement} container - Container element for compare canvases
     * @param {EditorState} state - Editor state instance
     * @param {EventBus} eventBus - Event bus for communication
     */
    constructor(container, state, eventBus) {
        this.container = container;
        this.state = state;
        this.eventBus = eventBus;

        // Canvases and contexts for each seed
        this.cells = []; // Array of { canvas, ctx, seed, tileCache, tileManager, worldData }

        // Shared render scheduling
        this.renderPending = false;
        this.renderRequestId = null;

        // Bind methods
        this._onStateChange = this._onStateChange.bind(this);
        this._onTileReady = this._onTileReady.bind(this);

        // Subscribe to state changes
        this.state.subscribe(this._onStateChange);
    }

    _onStateChange({ type, data }) {
        switch (type) {
            case EVENTS.COMPARE_TOGGLE:
                this._handleCompareToggle(data);
                break;

            case EVENTS.VIEWPORT_CHANGE:
                if (this.state.compareMode) {
                    this.scheduleRender();
                }
                break;

            case EVENTS.TEMPLATE_CHANGE:
            case EVENTS.MODE_CHANGE:
            case EVENTS.LAYER_TOGGLE:
                if (this.state.compareMode) {
                    this._rebuildAllCells();
                    this.scheduleRender();
                }
                break;
        }
    }

    _handleCompareToggle({ enabled, seeds }) {
        if (enabled) {
            this._setupCompareCells(seeds);
            this.container.classList.add('active');
            this.container.classList.remove('grid-2', 'grid-4');
            this.container.classList.add(seeds.length <= 2 ? 'grid-2' : 'grid-4');

            // Hide main canvas
            document.getElementById('terrain-canvas').style.display = 'none';

            this.scheduleRender();
        } else {
            this._cleanupCells();
            this.container.classList.remove('active');

            // Show main canvas
            document.getElementById('terrain-canvas').style.display = 'block';
        }
    }

    _setupCompareCells(seeds) {
        this._cleanupCells();

        for (const seed of seeds) {
            const cell = this._createCell(seed);
            this.cells.push(cell);
            this.container.appendChild(cell.element);
        }
    }

    _createCell(seed) {
        // Create cell container
        const element = document.createElement('div');
        element.className = 'compare-cell';

        // Create canvas
        const canvas = document.createElement('canvas');
        element.appendChild(canvas);

        // Create label
        const label = document.createElement('div');
        label.className = 'compare-label';
        label.textContent = `Seed: ${seed}`;
        element.appendChild(label);

        // Create context
        const ctx = canvas.getContext('2d', { willReadFrequently: true });

        // Create tile cache
        const tileCache = new TileCache(TILE_SIZE, MAX_CACHED_TILES / this.state.compareSeeds.length);

        // Create tile manager
        const tileManager = new TileManager(tileCache, () => this._onTileReady());

        // Generate world data for this seed
        const worldData = this._generateWorldData(seed);

        // Initialize tile manager
        tileManager.initWorker(seed, this.state.template).then(success => {
            if (success) {
                tileManager.setMode(this.state.mode);
                this.scheduleRender();
            }
        });

        return {
            element,
            canvas,
            ctx,
            seed,
            tileCache,
            tileManager,
            worldData
        };
    }

    _generateWorldData(seed) {
        const generator = new WorldGenerator(seed, this.state.template);
        const worldData = generator.generate();

        // Build indices for this seed (note: this affects global state in worldgen.js)
        // In a real implementation, we'd need per-seed indices
        // For now, overlays will use the main seed's data

        return worldData;
    }

    _rebuildAllCells() {
        for (const cell of this.cells) {
            cell.tileCache.invalidate();
            cell.tileManager?.updateConfig(cell.seed, this.state.template, this.state.mode);
        }
    }

    _cleanupCells() {
        for (const cell of this.cells) {
            cell.tileManager?.destroy();
            cell.tileCache?.invalidate();
            cell.element?.remove();
        }
        this.cells = [];
    }

    _onTileReady() {
        this.scheduleRender();
    }

    scheduleRender() {
        if (this.renderPending || !this.state.compareMode) return;

        this.renderPending = true;
        this.renderRequestId = requestAnimationFrame(() => {
            this.renderPending = false;
            this.render();
        });
    }

    resize() {
        for (const cell of this.cells) {
            const rect = cell.element.getBoundingClientRect();
            const dpr = window.devicePixelRatio || 1;

            cell.canvas.width = rect.width * dpr;
            cell.canvas.height = rect.height * dpr;
            cell.canvas.style.width = `${rect.width}px`;
            cell.canvas.style.height = `${rect.height}px`;

            cell.ctx.scale(dpr, dpr);
        }

        this.scheduleRender();
    }

    render() {
        if (!this.state.compareMode || this.cells.length === 0) return;

        // Ensure canvases are sized correctly
        this.resize();

        for (const cell of this.cells) {
            this._renderCell(cell);
        }
    }

    _renderCell(cell) {
        const { canvas, ctx, tileCache, tileManager, seed, worldData } = cell;

        const dpr = window.devicePixelRatio || 1;
        const width = canvas.width / dpr;
        const height = canvas.height / dpr;

        // Clear canvas
        ctx.fillStyle = COLORS.background;
        ctx.fillRect(0, 0, width, height);

        // Render tiles
        const { viewX, viewZ, zoom, mode, template } = this.state;

        if (tileManager.isWorkerAvailable()) {
            // Async render path
            tileManager.updateViewport(viewX, viewZ, zoom, width, height);

            const visibleTiles = tileManager.getVisibleTiles();
            ctx.imageSmoothingEnabled = zoom < 1;

            for (const tile of visibleTiles) {
                const tempCanvas = new OffscreenCanvas(TILE_SIZE, TILE_SIZE);
                const tempCtx = tempCanvas.getContext('2d');
                tempCtx.putImageData(tile.imageData, 0, 0);

                ctx.drawImage(
                    tempCanvas,
                    tile.screenX,
                    tile.screenY,
                    tile.scaledSize,
                    tile.scaledSize
                );
            }

            // Draw pending indicators
            const pendingTiles = tileManager.getPendingTiles();
            if (pendingTiles.length > 0) {
                const lodLevel = calculateLOD(zoom);
                const worldTileSize = TILE_SIZE * (1 << lodLevel);
                const halfWidth = width / 2;
                const halfHeight = height / 2;

                ctx.fillStyle = COLORS.pendingTile;
                for (const { tileX, tileZ } of pendingTiles) {
                    const screenX = halfWidth + (tileX - viewX) * zoom;
                    const screenY = halfHeight + (tileZ - viewZ) * zoom;
                    const scaledSize = worldTileSize * zoom;

                    ctx.fillRect(screenX, screenY, scaledSize, scaledSize);
                }
            }
        }

        // Render overlays if enabled
        // Note: Compare mode uses its own worldData per seed
        this._renderOverlays(ctx, width, height, worldData);
    }

    _renderOverlays(ctx, width, height, worldData) {
        if (!worldData) return;

        const { viewX, viewZ, zoom } = this.state;
        const halfWidth = width / 2;
        const halfHeight = height / 2;

        // Rivers
        if (this.state.isLayerVisible('rivers') && worldData.rivers) {
            for (const river of worldData.rivers) {
                const path = river.path;
                if (path.length < 2) continue;

                ctx.beginPath();
                for (let i = 0; i < path.length; i++) {
                    const p = path[i];
                    const screenX = halfWidth + (p.x - viewX) * zoom;
                    const screenY = halfHeight + (p.z - viewZ) * zoom;

                    if (i === 0) {
                        ctx.moveTo(screenX, screenY);
                    } else {
                        ctx.lineTo(screenX, screenY);
                    }
                }

                const avgWidth = (river.getWidthAt(0) + river.getWidthAt(path.length - 1)) / 2;
                ctx.strokeStyle = COLORS.river;
                ctx.lineWidth = Math.max(1, avgWidth * zoom);
                ctx.lineCap = 'round';
                ctx.lineJoin = 'round';
                ctx.stroke();
            }
        }

        // Zones
        if (this.state.isLayerVisible('zones') && worldData.zones) {
            for (const [key, zone] of worldData.zones) {
                const screenX = halfWidth + (zone.center.x - viewX) * zoom;
                const screenY = halfHeight + (zone.center.z - viewZ) * zoom;
                const screenRadius = zone.radius * zoom;

                if (screenX + screenRadius < 0 || screenX - screenRadius > width) continue;
                if (screenY + screenRadius < 0 || screenY - screenRadius > height) continue;

                const color = getZoneLevelColor(zone.levels);

                ctx.beginPath();
                ctx.arc(screenX, screenY, screenRadius, 0, Math.PI * 2);
                ctx.fillStyle = color + '33';
                ctx.fill();
                ctx.strokeStyle = color + 'AA';
                ctx.lineWidth = 2;
                ctx.stroke();
            }
        }
    }

    destroy() {
        if (this.renderRequestId) {
            cancelAnimationFrame(this.renderRequestId);
        }

        this._cleanupCells();
    }
}
