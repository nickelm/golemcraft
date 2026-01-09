/**
 * Terrain Visualizer - 2D color map of noise layers
 *
 * Imports worldgen.js to visualize terrain parameters in real-time.
 * Single source of truth - no duplicated generation logic.
 */

import { getTerrainParams } from './world/terrain/worldgen.js';
import { getColorForMode } from './tools/mapvisualizer/colors.js';

// Mode descriptions for UI
const MODE_DESCRIPTIONS = {
    continental: 'Land/ocean distribution (blue = ocean, green = plains, brown = hills, white = peaks)',
    temperature: 'Climate zones (blue = cold, white = temperate, red = hot)',
    humidity: 'Precipitation (yellow = arid, green = moderate, cyan = humid)',
    erosion: 'Valley detail (dark gray = valleys, light gray = peaks)',
    ridgeness: 'Mountain ridges (black = valleys, brown = slopes, white = ridges)'
};

// Map mode names to getTerrainParams property names
const MODE_PARAM_MAP = {
    continental: 'continental',
    temperature: 'temperature',
    humidity: 'humidity',
    erosion: 'erosion',
    ridgeness: 'ridgeness'
};

class TerrainVisualizer {
    constructor(canvas, seed = 12345) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d', { willReadFrequently: true });

        // View state
        this.seed = seed;
        this.viewX = 0;
        this.viewZ = 0;
        this.zoom = 2.0;  // Pixels per world block
        this.mode = 'continental';

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
            const params = getTerrainParams(this.mouseWorldX, this.mouseWorldZ, this.seed);
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
        this.render();

        // Update UI
        document.getElementById('mode-select').value = newMode;
        document.getElementById('mode-description').textContent = MODE_DESCRIPTIONS[newMode];
    }

    setSeed(newSeed) {
        this.seed = newSeed;
        this.render();
    }

    updateInfoDisplay() {
        document.getElementById('pos-display').textContent =
            `${Math.round(this.viewX)}, ${Math.round(this.viewZ)}`;
        document.getElementById('zoom-display').textContent =
            this.zoom.toFixed(1);

        if (this.mouseValue !== null) {
            document.getElementById('value-display').textContent =
                this.mouseValue.toFixed(3);
        }
    }

    render() {
        const startTime = performance.now();

        const width = this.canvas.width;
        const height = this.canvas.height;
        const halfWidth = width / 2;
        const halfHeight = height / 2;

        // Create image data for efficient pixel manipulation
        const imageData = this.ctx.createImageData(width, height);
        const data = imageData.data;

        // Render each pixel
        for (let py = 0; py < height; py++) {
            for (let px = 0; px < width; px++) {
                // Convert canvas pixel to world coordinates
                const worldX = this.viewX + (px - halfWidth) / this.zoom;
                const worldZ = this.viewZ + (py - halfHeight) / this.zoom;

                // Sample terrain parameters
                const params = getTerrainParams(worldX, worldZ, this.seed);

                // Get color for this mode
                const rgb = getColorForMode(params, this.mode);

                // Set pixel in image data (RGBA format)
                const index = (py * width + px) * 4;
                data[index] = rgb[0];     // R
                data[index + 1] = rgb[1]; // G
                data[index + 2] = rgb[2]; // B
                data[index + 3] = 255;    // A
            }
        }

        // Draw the entire image at once
        this.ctx.putImageData(imageData, 0, 0);

        const endTime = performance.now();
        const renderTime = endTime - startTime;

        // Log render performance
        console.log(`Rendered ${width}x${height} in ${renderTime.toFixed(1)}ms (${(renderTime / (width * height) * 1000000).toFixed(2)}ns/pixel)`);
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

    // Make visualizer globally accessible for debugging
    window.visualizer = visualizer;

    console.log('Terrain Visualizer initialized');
    console.log('Controls: Arrow keys = pan, +/- = zoom, 1-5 = switch mode');
});
