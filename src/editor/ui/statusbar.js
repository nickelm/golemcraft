/**
 * Template Editor - StatusBar
 *
 * Displays cache statistics, pending tiles, and LOD information.
 */

import { EVENTS } from '../core/constants.js';
import { calculateLOD } from '../utils/coordinates.js';

export class StatusBar {
    /**
     * @param {EditorState} state - Editor state instance
     * @param {EventBus} eventBus - Event bus for communication
     * @param {TileRenderer} tileRenderer - Tile renderer for cache stats
     */
    constructor(state, eventBus, tileRenderer) {
        this.state = state;
        this.eventBus = eventBus;
        this.tileRenderer = tileRenderer;

        // DOM elements
        this.elements = {
            cache: document.getElementById('status-cache'),
            pending: document.getElementById('status-pending'),
            lod: document.getElementById('status-lod')
        };

        // Update interval
        this.updateInterval = null;

        // Bind methods
        this._update = this._update.bind(this);

        // Start periodic updates
        this._startUpdates();
    }

    _startUpdates() {
        // Update every 250ms for smooth stats display
        this.updateInterval = setInterval(this._update, 250);
        this._update(); // Initial update
    }

    _update() {
        const stats = this.tileRenderer.getCacheStats();

        this.elements.cache.textContent = `Cache: ${stats.cached}/${stats.maxTiles} tiles`;
        this.elements.pending.textContent = `Pending: ${stats.pending}`;
        this.elements.lod.textContent = `LOD: ${stats.lod}`;
    }

    destroy() {
        if (this.updateInterval) {
            clearInterval(this.updateInterval);
        }
    }
}
