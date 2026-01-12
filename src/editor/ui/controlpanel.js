/**
 * Template Editor - ControlPanel
 *
 * Manages the left control panel with template, seed, mode, and layer controls.
 */

import { EVENTS, VISUALIZATION_MODES, MAX_COMPARE_SEEDS } from '../core/constants.js';
import {
    VERDANIA_TEMPLATE,
    SIMPLE_TEMPLATE,
    ARCHIPELAGO_TEMPLATE,
    PANGAEA_TEMPLATE
} from '../../world/terrain/templates.js';

// Template mapping
const TEMPLATES = {
    verdania: { template: VERDANIA_TEMPLATE, name: 'Verdania' },
    archipelago: { template: ARCHIPELAGO_TEMPLATE, name: 'Archipelago' },
    pangaea: { template: PANGAEA_TEMPLATE, name: 'Pangaea' },
    simple: { template: SIMPLE_TEMPLATE, name: 'Simple' }
};

export class ControlPanel {
    /**
     * @param {EditorState} state - Editor state instance
     * @param {EventBus} eventBus - Event bus for communication
     * @param {TileRenderer} tileRenderer - Tile renderer for cache control
     */
    constructor(state, eventBus, tileRenderer) {
        this.state = state;
        this.eventBus = eventBus;
        this.tileRenderer = tileRenderer;

        // DOM elements
        this.elements = {
            templateSelect: document.getElementById('template-select'),
            seedInput: document.getElementById('seed-input'),
            randomizeBtn: document.getElementById('randomize-btn'),
            compareSelect: document.getElementById('compare-select'),
            modeSelect: document.getElementById('mode-select'),
            modeDescription: document.getElementById('mode-description'),
            layerRivers: document.getElementById('layer-rivers'),
            layerZones: document.getElementById('layer-zones'),
            layerSpines: document.getElementById('layer-spines'),
            layerRoads: document.getElementById('layer-roads'),
            clearCacheBtn: document.getElementById('clear-cache-btn'),
            newTemplateBtn: document.getElementById('new-template-btn'),
            editTemplateBtn: document.getElementById('edit-template-btn')
        };

        // Bind event handlers
        this._onTemplateChange = this._onTemplateChange.bind(this);
        this._onSeedChange = this._onSeedChange.bind(this);
        this._onRandomize = this._onRandomize.bind(this);
        this._onCompareChange = this._onCompareChange.bind(this);
        this._onModeChange = this._onModeChange.bind(this);
        this._onLayerToggle = this._onLayerToggle.bind(this);
        this._onClearCache = this._onClearCache.bind(this);

        this._setupEventListeners();
        this._initializeFromState();
    }

    _setupEventListeners() {
        // Template
        this.elements.templateSelect.addEventListener('change', this._onTemplateChange);

        // Seed
        this.elements.seedInput.addEventListener('change', this._onSeedChange);
        this.elements.randomizeBtn.addEventListener('click', this._onRandomize);

        // Compare
        this.elements.compareSelect.addEventListener('change', this._onCompareChange);

        // Mode
        this.elements.modeSelect.addEventListener('change', this._onModeChange);

        // Layers
        this.elements.layerRivers.addEventListener('change', this._onLayerToggle);
        this.elements.layerZones.addEventListener('change', this._onLayerToggle);
        this.elements.layerSpines.addEventListener('change', this._onLayerToggle);
        this.elements.layerRoads.addEventListener('change', this._onLayerToggle);

        // Cache
        this.elements.clearCacheBtn.addEventListener('click', this._onClearCache);
    }

    _initializeFromState() {
        // Set template select to current template
        this.elements.templateSelect.value = this.state.templateName;

        // Set seed input
        this.elements.seedInput.value = this.state.seed;

        // Set mode select
        this.elements.modeSelect.value = this.state.mode;
        this._updateModeDescription(this.state.mode);

        // Set layer checkboxes
        this.elements.layerRivers.checked = this.state.isLayerVisible('rivers');
        this.elements.layerZones.checked = this.state.isLayerVisible('zones');
        this.elements.layerSpines.checked = this.state.isLayerVisible('spines');
        this.elements.layerRoads.checked = this.state.isLayerVisible('roads');
    }

    _onTemplateChange(e) {
        const templateKey = e.target.value;
        const templateData = TEMPLATES[templateKey];

        if (templateData) {
            this.state.setTemplate(templateData.template, templateKey);
        }
    }

    _onSeedChange(e) {
        const seed = parseInt(e.target.value, 10);
        if (!isNaN(seed)) {
            this.state.seed = seed;
        }
    }

    _onRandomize() {
        const newSeed = Math.floor(Math.random() * 1000000);
        this.elements.seedInput.value = newSeed;
        this.state.seed = newSeed;
    }

    _onCompareChange(e) {
        const value = e.target.value;

        if (value === 'off') {
            this.state.setCompareMode(false, []);
        } else {
            const count = parseInt(value, 10);
            const seeds = this._generateCompareSeeds(count);
            this.state.setCompareMode(true, seeds);
        }
    }

    _generateCompareSeeds(count) {
        const baseSeed = this.state.seed;
        const seeds = [baseSeed];

        for (let i = 1; i < count; i++) {
            seeds.push(baseSeed + i * 12345);
        }

        return seeds;
    }

    _onModeChange(e) {
        const mode = e.target.value;
        this.state.mode = mode;
        this._updateModeDescription(mode);
    }

    _updateModeDescription(mode) {
        const modeConfig = VISUALIZATION_MODES[mode];
        this.elements.modeDescription.textContent = modeConfig?.description || '';
    }

    _onLayerToggle(e) {
        const checkbox = e.target;
        const layerName = checkbox.id.replace('layer-', '');
        this.state.setLayerVisible(layerName, checkbox.checked);
    }

    _onClearCache() {
        this.tileRenderer.clearCache();
    }

    /**
     * Toggle a layer by name (for keyboard shortcuts)
     */
    toggleLayer(layerName) {
        this.state.toggleLayer(layerName);

        // Update checkbox to match state
        const checkbox = this.elements[`layer${layerName.charAt(0).toUpperCase() + layerName.slice(1)}`];
        if (checkbox) {
            checkbox.checked = this.state.isLayerVisible(layerName);
        }
    }

    destroy() {
        this.elements.templateSelect.removeEventListener('change', this._onTemplateChange);
        this.elements.seedInput.removeEventListener('change', this._onSeedChange);
        this.elements.randomizeBtn.removeEventListener('click', this._onRandomize);
        this.elements.compareSelect.removeEventListener('change', this._onCompareChange);
        this.elements.modeSelect.removeEventListener('change', this._onModeChange);
        this.elements.layerRivers.removeEventListener('change', this._onLayerToggle);
        this.elements.layerZones.removeEventListener('change', this._onLayerToggle);
        this.elements.layerSpines.removeEventListener('change', this._onLayerToggle);
        this.elements.layerRoads.removeEventListener('change', this._onLayerToggle);
        this.elements.clearCacheBtn.removeEventListener('click', this._onClearCache);
    }
}
