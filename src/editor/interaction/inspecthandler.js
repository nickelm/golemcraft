/**
 * Template Editor - InspectHandler
 *
 * Handles hover inspection to show terrain data at cursor position.
 */

import { EVENTS } from '../core/constants.js';
import { canvasToWorld } from '../utils/coordinates.js';
import { getTerrainParams } from '../../world/terrain/worldgen.js';

export class InspectHandler {
    /**
     * @param {HTMLCanvasElement} canvas - The canvas element
     * @param {EditorState} state - Editor state instance
     * @param {EventBus} eventBus - Event bus for communication
     */
    constructor(canvas, state, eventBus) {
        this.canvas = canvas;
        this.state = state;
        this.eventBus = eventBus;

        // Throttle hover updates
        this.lastUpdateTime = 0;
        this.updateInterval = 50; // ms

        // Bind methods
        this._onMouseMove = this._onMouseMove.bind(this);
        this._onMouseLeave = this._onMouseLeave.bind(this);

        this._setupEventListeners();
    }

    _setupEventListeners() {
        this.canvas.addEventListener('mousemove', this._onMouseMove);
        this.canvas.addEventListener('mouseleave', this._onMouseLeave);
    }

    /**
     * Get canvas size in CSS pixels
     */
    _getCanvasSize() {
        const rect = this.canvas.getBoundingClientRect();
        return { width: rect.width, height: rect.height };
    }

    _onMouseMove(e) {
        // Throttle updates
        const now = performance.now();
        if (now - this.lastUpdateTime < this.updateInterval) return;
        this.lastUpdateTime = now;

        const { width, height } = this._getCanvasSize();
        const rect = this.canvas.getBoundingClientRect();
        const canvasX = e.clientX - rect.left;
        const canvasY = e.clientY - rect.top;

        // Convert to world coordinates
        const worldPos = canvasToWorld(
            canvasX,
            canvasY,
            {
                viewX: this.state.viewX,
                viewZ: this.state.viewZ,
                zoom: this.state.zoom
            },
            width,
            height
        );

        // Get terrain parameters at this position
        const params = getTerrainParams(
            worldPos.x,
            worldPos.z,
            this.state.seed,
            this.state.template
        );

        // Update state with hover data
        this.state.setHoverData(worldPos.x, worldPos.z, params);
    }

    _onMouseLeave() {
        // Clear hover data when leaving canvas
        this.state.setHoverData(0, 0, null);
    }

    /**
     * Sample terrain at a specific world position
     * @param {number} worldX - World X coordinate
     * @param {number} worldZ - World Z coordinate
     * @returns {Object} Terrain parameters
     */
    sampleAt(worldX, worldZ) {
        return getTerrainParams(
            worldX,
            worldZ,
            this.state.seed,
            this.state.template
        );
    }

    /**
     * Clean up event listeners
     */
    destroy() {
        this.canvas.removeEventListener('mousemove', this._onMouseMove);
        this.canvas.removeEventListener('mouseleave', this._onMouseLeave);
    }
}
