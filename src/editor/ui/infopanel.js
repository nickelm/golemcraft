/**
 * Template Editor - InfoPanel
 *
 * Displays hover inspection data and view information in the right panel.
 */

import { EVENTS } from '../core/constants.js';

export class InfoPanel {
    /**
     * @param {EditorState} state - Editor state instance
     * @param {EventBus} eventBus - Event bus for communication
     */
    constructor(state, eventBus) {
        this.state = state;
        this.eventBus = eventBus;

        // DOM elements
        this.elements = {
            infoX: document.getElementById('info-x'),
            infoZ: document.getElementById('info-z'),
            infoZoom: document.getElementById('info-zoom'),
            infoCenter: document.getElementById('info-center'),
            infoBiome: document.getElementById('info-biome'),
            infoHeight: document.getElementById('info-height'),
            infoTemp: document.getElementById('info-temp'),
            infoHumidity: document.getElementById('info-humidity'),
            infoWater: document.getElementById('info-water')
        };

        // Bind methods
        this._onHoverUpdate = this._onHoverUpdate.bind(this);
        this._onViewportChange = this._onViewportChange.bind(this);

        // Subscribe to events
        this.eventBus.on(EVENTS.HOVER_UPDATE, this._onHoverUpdate);
        this.eventBus.on(EVENTS.VIEWPORT_CHANGE, this._onViewportChange);

        // Initial update
        this._updateViewInfo();
    }

    _onHoverUpdate({ x, z, params }) {
        this.elements.infoX.textContent = Math.round(x);
        this.elements.infoZ.textContent = Math.round(z);

        if (params) {
            this.elements.infoBiome.textContent = params.biome || '-';
            this.elements.infoHeight.textContent = params.heightNormalized?.toFixed(3) || '-';
            this.elements.infoTemp.textContent = params.temperature?.toFixed(3) || '-';
            this.elements.infoHumidity.textContent = params.humidity?.toFixed(3) || '-';
            this.elements.infoWater.textContent = params.waterType || 'none';
        } else {
            this.elements.infoBiome.textContent = '-';
            this.elements.infoHeight.textContent = '-';
            this.elements.infoTemp.textContent = '-';
            this.elements.infoHumidity.textContent = '-';
            this.elements.infoWater.textContent = '-';
        }
    }

    _onViewportChange({ viewX, viewZ, zoom }) {
        this._updateViewInfo();
    }

    _updateViewInfo() {
        this.elements.infoZoom.textContent = `${this.state.zoom.toFixed(1)}x`;
        this.elements.infoCenter.textContent = `${Math.round(this.state.viewX)}, ${Math.round(this.state.viewZ)}`;
    }

    destroy() {
        this.eventBus.off(EVENTS.HOVER_UPDATE, this._onHoverUpdate);
        this.eventBus.off(EVENTS.VIEWPORT_CHANGE, this._onViewportChange);
    }
}
