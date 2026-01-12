/**
 * Template Editor - StatusBar
 *
 * Displays render progress and bounds information.
 */

import { EVENTS } from '../core/constants.js';

export class StatusBar {
    /**
     * @param {EditorState} state - Editor state instance
     * @param {EventBus} eventBus - Event bus for communication
     * @param {TileRenderer} tileRenderer - Tile renderer for render stats
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

        // Bind methods
        this._onRefinementProgress = this._onRefinementProgress.bind(this);
        this._onBoundsChange = this._onBoundsChange.bind(this);
        this._update = this._update.bind(this);

        // Subscribe to events
        this.eventBus.on(EVENTS.REFINEMENT_PROGRESS, this._onRefinementProgress);
        this.eventBus.on(EVENTS.RENDER_BOUNDS_CHANGE, this._onBoundsChange);

        // Initial update
        this._update();
    }

    _onRefinementProgress({ level, total, progress }) {
        const percent = Math.round(progress * 100);
        if (level < total - 1) {
            this.elements.lod.textContent = `Rendering: ${percent}%`;
        } else {
            this.elements.lod.textContent = `Ready`;
        }
    }

    _onBoundsChange({ bounds }) {
        if (bounds) {
            const width = Math.round(bounds.maxX - bounds.minX);
            const height = Math.round(bounds.maxZ - bounds.minZ);
            this.elements.cache.textContent = `${width}x${height} blocks`;
        }
    }

    _update() {
        const stats = this.tileRenderer.getRenderStats();

        if (stats.renderInProgress) {
            const percent = Math.round(((stats.level + 1) / stats.totalLevels) * 100);
            this.elements.lod.textContent = `Rendering: ${percent}%`;
        } else if (stats.level >= 0) {
            this.elements.lod.textContent = `Ready`;
        } else {
            this.elements.lod.textContent = `Starting...`;
        }

        if (stats.bounds) {
            const width = Math.round(stats.bounds.maxX - stats.bounds.minX);
            const height = Math.round(stats.bounds.maxZ - stats.bounds.minZ);
            this.elements.cache.textContent = `${width}x${height} blocks`;
        } else {
            this.elements.cache.textContent = `Probing...`;
        }

        this.elements.pending.textContent = ``;
    }

    destroy() {
        this.eventBus.off(EVENTS.REFINEMENT_PROGRESS, this._onRefinementProgress);
        this.eventBus.off(EVENTS.RENDER_BOUNDS_CHANGE, this._onBoundsChange);
    }
}
