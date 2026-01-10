/**
 * Terrain Visualizer - 2D color map of noise layers
 *
 * Imports worldgen.js to visualize terrain parameters in real-time.
 * Single source of truth - no duplicated generation logic.
 */

import { getTerrainParams } from './world/terrain/worldgen.js';
import { DEFAULT_TEMPLATE, VERDANIA_TEMPLATE } from './world/terrain/templates.js';
import { getColorForMode } from './tools/mapvisualizer/colors.js';
import { TileCache } from './tools/mapvisualizer/tilecache.js';

// Mode descriptions for UI
const MODE_DESCRIPTIONS = {
    continental: 'Land/ocean distribution (blue = ocean, green = plains, brown = hills, white = peaks)',
    temperature: 'Climate zones (blue = cold, white = temperate, red = hot)',
    humidity: 'Precipitation (yellow = arid, green = moderate, cyan = humid)',
    erosion: 'Valley detail (dark gray = valleys, light gray = peaks)',
    ridgeness: 'Mountain ridges (black = valleys, brown = slopes, white = ridges)',
    biome: 'Biome distribution (colored regions show biome types)',
    elevation: 'Terrain elevation with hillshade (blue = ocean, green = lowland, brown = highland, gray = mountain, white = peak)',
    composite: 'In-game map view (biome colors + hillshade + contours)'
};

// Map mode names to getTerrainParams property names
const MODE_PARAM_MAP = {
    continental: 'continental',
    temperature: 'temperature',
    humidity: 'humidity',
    erosion: 'erosion',
    ridgeness: 'ridgeness',
    biome: 'biome',
    elevation: 'height',
    composite: 'biome'  // Shows biome in value display
};

class TerrainVisualizer {
    constructor(canvas, seed = 12345) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d', { willReadFrequently: true });

        // View state
        this.seed = seed;
        this.viewX = 0;
        this.viewZ = 0;
        this.zoom = 0.3;  // Pixels per world block
        this.mode = 'continental';
        this.currentTemplate = DEFAULT_TEMPLATE;
        this.currentTemplateName = 'Default';

        // Tile cache for improved pan/zoom performance
        this.tileCache = new TileCache(128, 64);

        // Mouse tracking for value display
        this.mouseWorldX = 0;
        this.mouseWorldZ = 0;
        this.mouseValue = null;

        // Set canvas to full window size
        this.resizeCanvas();
        window.addEventListener('resize', () => {
            this.resizeCanvas();
            this.render();
        });

        // Setup event listeners
        this.setupEventListeners();
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
                    this.setZoom(this.zoom * 1.2);
                    e.preventDefault();
                    break;
                case '-':
                case '_':
                    this.setZoom(this.zoom / 1.2);
                    e.preventDefault();
                    break;
                case '1':
                    this.setMode('continental');
                    break;
                case '2':
                    this.setMode('temperature');
                    break;
                case '3':
                    this.setMode('humidity');
                    break;
                case '4':
                    this.setMode('erosion');
                    break;
                case '5':
                    this.setMode('ridgeness');
                    break;
                case '6':
                    this.setMode('biome');
                    break;
                case '7':
                    this.setMode('elevation');
                    break;
                case '8':
                    this.setMode('composite');
                    break;
                case 'd':
                case 'D':
                    this.setTemplate('default');
                    console.log('Switched to DEFAULT template');
                    break;
                case 'v':
                case 'V':
                    this.setTemplate('verdania');
                    console.log('Switched to VERDANIA template');
                    break;
            }
        });

        // Mouse wheel zoom
        this.canvas.addEventListener('wheel', (e) => {
            e.preventDefault();
            const zoomFactor = e.deltaY < 0 ? 1.1 : 0.9;
            this.setZoom(this.zoom * zoomFactor);
        });

        // Mouse move for value display
        this.canvas.addEventListener('mousemove', (e) => {
            const rect = this.canvas.getBoundingClientRect();
            const canvasX = e.clientX - rect.left;
            const canvasY = e.clientY - rect.top;

            const halfWidth = this.canvas.width / 2;
            const halfHeight = this.canvas.height / 2;

            this.mouseWorldX = this.viewX + (canvasX - halfWidth) / this.zoom;
            this.mouseWorldZ = this.viewZ + (canvasY - halfHeight) / this.zoom;

            // Sample the value at mouse position
            const params = getTerrainParams(this.mouseWorldX, this.mouseWorldZ, this.seed, this.currentTemplate);
            const paramName = MODE_PARAM_MAP[this.mode];
            this.mouseValue = params[paramName];

            this.updateInfoDisplay();
        });
    }

    pan(dx, dz) {
        this.viewX += dx;
        this.viewZ += dz;
        this.render();
        this.updateInfoDisplay();
    }

    setZoom(newZoom) {
        // Clamp zoom between 0.1x and 10x
        this.zoom = Math.max(0.1, Math.min(10, newZoom));
        this.render();
        this.updateInfoDisplay();
    }

    setMode(newMode) {
        this.mode = newMode;
        this.tileCache.invalidate();
        this.render();

        // Update UI
        document.getElementById('mode-select').value = newMode;
        document.getElementById('mode-description').textContent = MODE_DESCRIPTIONS[newMode];
    }

    setSeed(newSeed) {
        this.seed = newSeed;
        this.tileCache.invalidate();
        this.render();
    }

    setTemplate(templateOrName) {
        if (typeof templateOrName === 'string') {
            this.currentTemplate = templateOrName === 'verdania' ? VERDANIA_TEMPLATE : DEFAULT_TEMPLATE;
            this.currentTemplateName = templateOrName === 'verdania' ? 'Verdania' : 'Default';
        } else {
            this.currentTemplate = templateOrName;
            this.currentTemplateName = templateOrName === VERDANIA_TEMPLATE ? 'Verdania' : 'Default';
        }
        this.tileCache.invalidate();
        this.updateInfoDisplay();
        this.render();
    }

    updateInfoDisplay() {
        document.getElementById('pos-display').textContent =
            `${Math.round(this.viewX)}, ${Math.round(this.viewZ)}`;
        document.getElementById('zoom-display').textContent =
            this.zoom.toFixed(1);
        document.getElementById('template-display').textContent =
            this.currentTemplateName;

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
        const halfWidth = width / 2;
        const halfHeight = height / 2;
        const tileSize = this.tileCache.tileSize;

        // Clear canvas
        this.ctx.fillStyle = '#000';
        this.ctx.fillRect(0, 0, width, height);

        // Calculate visible world bounds
        const worldLeft = this.viewX - halfWidth / this.zoom;
        const worldRight = this.viewX + halfWidth / this.zoom;
        const worldTop = this.viewZ - halfHeight / this.zoom;
        const worldBottom = this.viewZ + halfHeight / this.zoom;

        // Calculate which tiles are needed (aligned to tile grid)
        const tileStartX = this.tileCache.alignToGrid(Math.floor(worldLeft));
        const tileEndX = this.tileCache.alignToGrid(Math.ceil(worldRight)) + tileSize;
        const tileStartZ = this.tileCache.alignToGrid(Math.floor(worldTop));
        const tileEndZ = this.tileCache.alignToGrid(Math.ceil(worldBottom)) + tileSize;

        let tilesRendered = 0;
        let tilesCached = 0;

        // Render each visible tile
        for (let tileWorldZ = tileStartZ; tileWorldZ < tileEndZ; tileWorldZ += tileSize) {
            for (let tileWorldX = tileStartX; tileWorldX < tileEndX; tileWorldX += tileSize) {
                // Check if tile was already cached
                const key = `${tileWorldX},${tileWorldZ},${this.mode},${this.seed}`;
                const wasCached = this.tileCache.cache.has(key);

                // Get tile (from cache or render it)
                const tileImageData = this.tileCache.getTile(
                    tileWorldX,
                    tileWorldZ,
                    this.mode,
                    this.seed,
                    this.currentTemplate
                );

                if (wasCached) {
                    tilesCached++;
                } else {
                    tilesRendered++;
                }

                // Calculate canvas position for this tile
                const canvasX = halfWidth + (tileWorldX - this.viewX) * this.zoom;
                const canvasY = halfHeight + (tileWorldZ - this.viewZ) * this.zoom;
                const scaledSize = tileSize * this.zoom;

                // Draw tile to canvas using createImageBitmap for scaling
                // For now, use putImageData + drawImage approach
                const tempCanvas = new OffscreenCanvas(tileSize, tileSize);
                const tempCtx = tempCanvas.getContext('2d');
                tempCtx.putImageData(tileImageData, 0, 0);

                // Draw scaled tile to main canvas
                this.ctx.imageSmoothingEnabled = this.zoom < 1; // Smooth when zoomed out
                this.ctx.drawImage(tempCanvas, canvasX, canvasY, scaledSize, scaledSize);
            }
        }

        const endTime = performance.now();
        const renderTime = endTime - startTime;

        // Log render performance
        const stats = this.tileCache.getStats();
        console.log(`Rendered in ${renderTime.toFixed(1)}ms (${tilesRendered} new, ${tilesCached} cached, ${stats.size}/${stats.maxTiles} in cache)`);
    }
}

// Initialize visualizer on page load
window.addEventListener('DOMContentLoaded', () => {
    const canvas = document.getElementById('terrain-canvas');
    const seedInput = document.getElementById('seed-input');
    const modeSelect = document.getElementById('mode-select');

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

    modeSelect.addEventListener('change', (e) => {
        visualizer.setMode(e.target.value);
    });

    // Template selection
    const templateSelect = document.getElementById('template-select');
    templateSelect.addEventListener('change', (e) => {
        visualizer.setTemplate(e.target.value);
    });

    // Make visualizer globally accessible for debugging
    window.visualizer = visualizer;

    console.log('Terrain Visualizer initialized');
    console.log('Controls: Arrow keys = pan, +/- = zoom, 1-8 = switch mode, D/V = switch template');
});
