/**
 * Template Editor - TileRenderer (Offscreen Canvas Version)
 *
 * Pre-renders terrain to a 1024x1024 offscreen canvas with progressive refinement.
 * Pan/zoom just transforms that image - no terrain sampling during navigation.
 */

import {
    COLORS, EVENTS, MIN_ZOOM, MAX_ZOOM,
    OFFSCREEN_SIZE, PROBE_GRID_SIZE, PROBE_BOUNDS,
    DEEP_OCEAN_THRESHOLD, CONTINENT_MARGIN, CHUNK_BUDGET_MS,
    OFFSCREEN_REFINEMENT_LEVELS
} from '../core/constants.js';
import { getTerrainParams } from '../../world/terrain/worldgen.js';
import { getColorForMode } from '../../tools/mapvisualizer/colors.js';

// How often to update display during rendering (ms)
const DISPLAY_UPDATE_INTERVAL = 50;

export class TileRenderer {
    /**
     * @param {HTMLCanvasElement} canvas - The main display canvas
     * @param {EditorState} state - Editor state instance
     * @param {EventBus} eventBus - Event bus for communication
     */
    constructor(canvas, state, eventBus) {
        this.displayCanvas = canvas;
        this.displayCtx = canvas.getContext('2d');
        this.state = state;
        this.eventBus = eventBus;

        // Offscreen canvas for pre-rendered terrain
        this.offscreen = new OffscreenCanvas(OFFSCREEN_SIZE, OFFSCREEN_SIZE);
        this.offscreenCtx = this.offscreen.getContext('2d');
        this.imageData = this.offscreenCtx.createImageData(OFFSCREEN_SIZE, OFFSCREEN_SIZE);

        // Render state
        this.renderBounds = null;       // World bounds being rendered { minX, maxX, minZ, maxZ }
        this.currentLevel = -1;         // Current completed refinement level
        this.renderAborted = false;     // Flag to abort in-progress render
        this.renderInProgress = false;  // Prevent concurrent renders
        this.renderVersion = 0;         // Incremented on each config change
        this.lastDisplayUpdate = 0;     // Last time display was updated during render

        // Display scheduling
        this.displayPending = false;
        this.displayRequestId = null;

        // Bind methods
        this._onStateChange = this._onStateChange.bind(this);
        this._scheduleDisplay = this._scheduleDisplay.bind(this);

        // Subscribe to state changes
        this.state.subscribe(this._onStateChange);

        // Defer initial render to next frame to ensure canvas is sized
        requestAnimationFrame(() => this._startFullRender());
    }

    /**
     * Handle state changes
     */
    _onStateChange({ type, data }) {
        switch (type) {
            case EVENTS.VIEWPORT_CHANGE:
                // Just redraw the offscreen to display - no terrain sampling
                this._scheduleDisplay();
                break;

            case EVENTS.SEED_CHANGE:
            case EVENTS.TEMPLATE_CHANGE:
            case EVENTS.MODE_CHANGE:
                // Config changed - need full re-render
                this._startFullRender();
                break;

            case EVENTS.LAYER_TOGGLE:
                // Overlays are rendered separately, just schedule display
                this._scheduleDisplay();
                break;
        }
    }

    /**
     * Start a full render from scratch
     */
    async _startFullRender() {
        // Abort any in-progress render
        this.renderAborted = true;
        this.renderVersion++;
        const thisVersion = this.renderVersion;

        // Wait a frame to ensure any in-progress chunk stops
        await new Promise(resolve => requestAnimationFrame(resolve));

        // Reset state
        this.renderAborted = false;
        this.currentLevel = -1;

        // Clear offscreen canvas and imageData
        this.offscreenCtx.fillStyle = COLORS.background;
        this.offscreenCtx.fillRect(0, 0, OFFSCREEN_SIZE, OFFSCREEN_SIZE);

        // Clear imageData buffer
        const data = this.imageData.data;
        for (let i = 0; i < data.length; i += 4) {
            data[i] = 26;     // R (matches background #1a1a2e)
            data[i + 1] = 26; // G
            data[i + 2] = 46; // B
            data[i + 3] = 255;
        }

        // Probe bounds to find continent extent
        console.time('Bounds probing');
        this.renderBounds = this._probeBounds();
        console.timeEnd('Bounds probing');
        console.log('Render bounds:', this.renderBounds);

        this.eventBus.emit(EVENTS.RENDER_BOUNDS_CHANGE, { bounds: this.renderBounds });

        // Calculate and set initial view to fit continent
        const initialView = this._calculateInitialView();
        console.log('Initial view:', initialView);
        this.state.setViewport(initialView.viewX, initialView.viewZ, initialView.zoom);

        // Start progressive rendering
        this.renderInProgress = true;
        await this._progressiveRender(thisVersion);
        this.renderInProgress = false;
    }

    /**
     * Probe world bounds to find continent extent
     * Samples a grid and finds bounding box of all land and shallow ocean
     * Uses elevation as the definitive source - land is height > 0, shallow ocean is nearby
     */
    _probeBounds() {
        const { seed, template } = this.state;
        const probeRange = PROBE_BOUNDS.max - PROBE_BOUNDS.min;
        const probeStep = probeRange / PROBE_GRID_SIZE;

        // Threshold for including in bounds:
        // - Land: continentalness >= 0.12 (above sea level)
        // - Shallow ocean: continentalness >= 0.05 (visible shallow water)
        const INCLUDE_THRESHOLD = 0.05;

        let minX = Infinity, maxX = -Infinity;
        let minZ = Infinity, maxZ = -Infinity;
        let foundLand = false;

        for (let gz = 0; gz < PROBE_GRID_SIZE; gz++) {
            for (let gx = 0; gx < PROBE_GRID_SIZE; gx++) {
                const worldX = PROBE_BOUNDS.min + gx * probeStep;
                const worldZ = PROBE_BOUNDS.min + gz * probeStep;

                // Get terrain params to check elevation/continentalness
                const params = getTerrainParams(worldX, worldZ, seed, template);

                // Include land (height > 0) and shallow ocean (continental >= threshold)
                const isLandOrShallow = params.height > 0 || params.effectiveContinental >= INCLUDE_THRESHOLD;

                if (isLandOrShallow) {
                    foundLand = true;
                    minX = Math.min(minX, worldX);
                    maxX = Math.max(maxX, worldX);
                    minZ = Math.min(minZ, worldZ);
                    maxZ = Math.max(maxZ, worldZ);
                }
            }
        }

        if (!foundLand) {
            // Fallback to template bounds
            const bounds = template.worldBounds || { min: -2000, max: 2000 };
            return {
                minX: bounds.min,
                maxX: bounds.max,
                minZ: bounds.min,
                maxZ: bounds.max
            };
        }

        // Add margin for ocean buffer around land
        return {
            minX: minX - CONTINENT_MARGIN,
            maxX: maxX + CONTINENT_MARGIN,
            minZ: minZ - CONTINENT_MARGIN,
            maxZ: maxZ + CONTINENT_MARGIN
        };
    }

    /**
     * Calculate initial view to fit entire continent
     */
    _calculateInitialView() {
        const { width, height } = this._getCanvasSize();

        if (!this.renderBounds) {
            return { viewX: 0, viewZ: 0, zoom: 0.5 };
        }

        // If canvas not sized yet, use a default
        if (width <= 0 || height <= 0) {
            const viewX = (this.renderBounds.minX + this.renderBounds.maxX) / 2;
            const viewZ = (this.renderBounds.minZ + this.renderBounds.maxZ) / 2;
            return { viewX, viewZ, zoom: 0.5 };
        }

        const worldWidth = this.renderBounds.maxX - this.renderBounds.minX;
        const worldHeight = this.renderBounds.maxZ - this.renderBounds.minZ;

        // Center of continent
        const viewX = (this.renderBounds.minX + this.renderBounds.maxX) / 2;
        const viewZ = (this.renderBounds.minZ + this.renderBounds.maxZ) / 2;

        // Zoom to fit with 5% margin
        // zoom = screen pixels per world unit
        // To fit worldWidth in width pixels: zoom = width / worldWidth
        const zoomX = (width * 0.95) / worldWidth;
        const zoomZ = (height * 0.95) / worldHeight;
        const zoom = Math.min(zoomX, zoomZ);  // Use smaller to ensure both dimensions fit

        console.log(`Initial view calc: canvas=${width}x${height}, world=${worldWidth}x${worldHeight}, zoom=${zoom}`);

        // Clamp to reasonable range but allow very low zoom for large worlds
        return { viewX, viewZ, zoom: Math.max(0.001, Math.min(MAX_ZOOM, zoom)) };
    }

    /**
     * Progressive render through all refinement levels
     */
    async _progressiveRender(version) {
        for (let levelIdx = 0; levelIdx < OFFSCREEN_REFINEMENT_LEVELS.length; levelIdx++) {
            // Check for abort
            if (this.renderAborted || this.renderVersion !== version) {
                console.log(`Render aborted at level ${levelIdx}`);
                return;
            }

            console.time(`Render level ${levelIdx}`);
            await this._renderLevel(levelIdx, version);
            console.timeEnd(`Render level ${levelIdx}`);

            if (this.renderAborted || this.renderVersion !== version) return;

            this.currentLevel = levelIdx;

            // Emit progress event
            const progress = (levelIdx + 1) / OFFSCREEN_REFINEMENT_LEVELS.length;
            this.eventBus.emit(EVENTS.REFINEMENT_PROGRESS, {
                level: levelIdx,
                total: OFFSCREEN_REFINEMENT_LEVELS.length,
                progress
            });

            // Final display update after level completes
            this._updateDisplayFromImageData();
        }

        console.log('Progressive render complete');
    }

    /**
     * Update the offscreen canvas from imageData and render to display
     */
    _updateDisplayFromImageData() {
        this.offscreenCtx.putImageData(this.imageData, 0, 0);
        this._renderToDisplay();
    }

    /**
     * Render a single refinement level using chunked processing
     * Renders from center outward for viewport priority
     */
    async _renderLevel(levelIdx, version) {
        const { pixelStep, gridSize } = OFFSCREEN_REFINEMENT_LEVELS[levelIdx];
        const { seed, template, mode } = this.state;
        const data = this.imageData.data;

        const worldRangeX = this.renderBounds.maxX - this.renderBounds.minX;
        const worldRangeZ = this.renderBounds.maxZ - this.renderBounds.minZ;

        const needsNeighbors = mode === 'elevation' || mode === 'composite';

        // Calculate world units per offscreen pixel
        const worldPerPixelX = worldRangeX / OFFSCREEN_SIZE;
        const worldPerPixelZ = worldRangeZ / OFFSCREEN_SIZE;

        // Build list of pixels to render, sorted by distance from center
        const pixels = this._buildRenderOrder(levelIdx, gridSize, pixelStep);
        const totalPixels = pixels.length;
        let processedPixels = 0;

        this.lastDisplayUpdate = performance.now();

        return new Promise((resolve) => {
            const processChunk = () => {
                // Check for abort
                if (this.renderAborted || this.renderVersion !== version) {
                    resolve();
                    return;
                }

                const startTime = performance.now();

                while (processedPixels < totalPixels) {
                    // Check time budget
                    if (performance.now() - startTime > CHUNK_BUDGET_MS) {
                        // Update display periodically during rendering
                        if (performance.now() - this.lastDisplayUpdate > DISPLAY_UPDATE_INTERVAL) {
                            this._updateDisplayFromImageData();
                            this.lastDisplayUpdate = performance.now();
                        }
                        requestAnimationFrame(processChunk);
                        return;
                    }

                    const { px, pz } = pixels[processedPixels];
                    processedPixels++;

                    // Calculate world position
                    const worldX = this.renderBounds.minX + px * worldPerPixelX;
                    const worldZ = this.renderBounds.minZ + pz * worldPerPixelZ;

                    // Sample terrain
                    const params = getTerrainParams(worldX, worldZ, seed, template);

                    let rgb;
                    if (needsNeighbors) {
                        // Sample neighbors for hillshade - use world step based on pixel step
                        const neighborDistX = pixelStep * worldPerPixelX;
                        const neighborDistZ = pixelStep * worldPerPixelZ;
                        const leftParams = getTerrainParams(worldX - neighborDistX, worldZ, seed, template);
                        const rightParams = getTerrainParams(worldX + neighborDistX, worldZ, seed, template);
                        const upParams = getTerrainParams(worldX, worldZ - neighborDistZ, seed, template);
                        const downParams = getTerrainParams(worldX, worldZ + neighborDistZ, seed, template);

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

                    // Fill pixel block
                    this._fillPixelBlock(data, px, pz, pixelStep, rgb);
                }

                // Level complete
                resolve();
            };

            requestAnimationFrame(processChunk);
        });
    }

    /**
     * Build render order: viewport center first, then expand outward
     * Skip pixels already rendered at coarser levels
     */
    _buildRenderOrder(levelIdx, gridSize, pixelStep) {
        const pixels = [];

        // Get current viewport center in offscreen pixel coordinates
        const { viewX, viewZ } = this.state;
        const worldRangeX = this.renderBounds.maxX - this.renderBounds.minX;
        const worldRangeZ = this.renderBounds.maxZ - this.renderBounds.minZ;

        // Convert viewport world position to offscreen pixel position
        const viewportPixelX = ((viewX - this.renderBounds.minX) / worldRangeX) * OFFSCREEN_SIZE;
        const viewportPixelZ = ((viewZ - this.renderBounds.minZ) / worldRangeZ) * OFFSCREEN_SIZE;

        for (let gz = 0; gz < gridSize; gz++) {
            for (let gx = 0; gx < gridSize; gx++) {
                const px = gx * pixelStep;
                const pz = gz * pixelStep;

                // Skip pixels that were already rendered at a coarser level
                if (levelIdx > 0) {
                    const prevStep = OFFSCREEN_REFINEMENT_LEVELS[levelIdx - 1].pixelStep;
                    if (px % prevStep === 0 && pz % prevStep === 0) {
                        continue;
                    }
                }

                // Calculate distance from viewport center for sorting
                const dx = px - viewportPixelX;
                const dz = pz - viewportPixelZ;
                const dist = dx * dx + dz * dz;

                pixels.push({ px, pz, dist });
            }
        }

        // Sort by distance from viewport center (closest first)
        pixels.sort((a, b) => a.dist - b.dist);

        return pixels;
    }

    /**
     * Fill a block of pixels with a color
     */
    _fillPixelBlock(data, startX, startZ, blockSize, rgb) {
        const endX = Math.min(startX + blockSize, OFFSCREEN_SIZE);
        const endZ = Math.min(startZ + blockSize, OFFSCREEN_SIZE);

        for (let z = startZ; z < endZ; z++) {
            for (let x = startX; x < endX; x++) {
                const idx = (z * OFFSCREEN_SIZE + x) * 4;
                data[idx] = rgb[0];
                data[idx + 1] = rgb[1];
                data[idx + 2] = rgb[2];
                data[idx + 3] = 255;
            }
        }
    }

    /**
     * Schedule a display update on next animation frame
     */
    _scheduleDisplay() {
        if (this.displayPending) return;

        this.displayPending = true;
        this.displayRequestId = requestAnimationFrame(() => {
            this.displayPending = false;
            this._renderToDisplay();
        });
    }

    /**
     * Render offscreen canvas to display canvas with current viewport transform
     */
    _renderToDisplay() {
        const { width, height } = this._getCanvasSize();
        const { viewX, viewZ, zoom } = this.state;

        // Clear display
        this.displayCtx.fillStyle = COLORS.background;
        this.displayCtx.fillRect(0, 0, width, height);

        if (!this.renderBounds) return;

        // Calculate transform
        // zoom = screen pixels per world unit
        // We need to convert world coordinates to screen coordinates
        const worldRangeX = this.renderBounds.maxX - this.renderBounds.minX;
        const worldRangeZ = this.renderBounds.maxZ - this.renderBounds.minZ;

        // The offscreen canvas represents worldRange in OFFSCREEN_SIZE pixels
        // To display, we need: worldRange * zoom screen pixels
        const drawWidth = worldRangeX * zoom;
        const drawHeight = worldRangeZ * zoom;

        // The center of the display should show world position (viewX, viewZ)
        // Calculate where the top-left of the offscreen canvas should be drawn
        // viewX is at screen center (width/2), so bounds.minX should be at:
        const drawX = width / 2 - (viewX - this.renderBounds.minX) * zoom;
        const drawY = height / 2 - (viewZ - this.renderBounds.minZ) * zoom;

        // Debug: log draw parameters occasionally
        if (Math.random() < 0.01) {
            console.log(`Display: canvas=${width}x${height}, zoom=${zoom.toFixed(4)}, drawSize=${drawWidth.toFixed(0)}x${drawHeight.toFixed(0)}, drawPos=${drawX.toFixed(0)},${drawY.toFixed(0)}`);
        }

        // Use pixel art style when zoomed in, smooth when zoomed out
        this.displayCtx.imageSmoothingEnabled = zoom < 2;

        this.displayCtx.drawImage(
            this.offscreen,
            drawX, drawY,
            drawWidth, drawHeight
        );

        // Emit render complete event (overlays listen to this)
        this.eventBus.emit(EVENTS.RENDER_REQUEST, { width, height, ctx: this.displayCtx });
    }

    /**
     * Resize canvas to match container
     */
    resize() {
        const container = this.displayCanvas.parentElement;
        const rect = container.getBoundingClientRect();

        const dpr = window.devicePixelRatio || 1;
        this.displayCanvas.width = rect.width * dpr;
        this.displayCanvas.height = rect.height * dpr;
        this.displayCanvas.style.width = `${rect.width}px`;
        this.displayCanvas.style.height = `${rect.height}px`;

        this.displayCtx.scale(dpr, dpr);

        this._scheduleDisplay();
    }

    /**
     * Get canvas dimensions (CSS pixels, not device pixels)
     */
    _getCanvasSize() {
        const dpr = window.devicePixelRatio || 1;
        return {
            width: this.displayCanvas.width / dpr,
            height: this.displayCanvas.height / dpr
        };
    }

    /**
     * Get render statistics (for status display)
     */
    getRenderStats() {
        return {
            level: this.currentLevel,
            totalLevels: OFFSCREEN_REFINEMENT_LEVELS.length,
            renderInProgress: this.renderInProgress,
            bounds: this.renderBounds
        };
    }

    /**
     * Get the current render bounds
     */
    getRenderBounds() {
        return this.renderBounds;
    }

    /**
     * Clean up resources
     */
    destroy() {
        this.renderAborted = true;

        if (this.displayRequestId) {
            cancelAnimationFrame(this.displayRequestId);
        }
    }
}
