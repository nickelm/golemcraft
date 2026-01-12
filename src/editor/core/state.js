/**
 * Template Editor - EditorState
 *
 * Centralized reactive state management with subscription pattern.
 * Components subscribe to state changes and are notified when relevant
 * parts of the state change.
 */

import { LAYERS, DEFAULT_ZOOM, EVENTS } from './constants.js';
import { VERDANIA_TEMPLATE } from '../../world/terrain/templates.js';
import { WorldGenerator } from '../../world/worldgenerator.js';

export class EditorState {
    /**
     * @param {EventBus} eventBus - EventBus instance for state change notifications
     */
    constructor(eventBus) {
        this._eventBus = eventBus;
        this._subscribers = new Set();

        // View state
        this._viewX = 0;
        this._viewZ = 0;
        this._zoom = DEFAULT_ZOOM;

        // Generation state
        this._seed = 12345;
        this._template = VERDANIA_TEMPLATE;
        this._templateName = 'verdania';

        // Layer visibility (initialized from defaults)
        this._layers = {};
        for (const [key, config] of Object.entries(LAYERS)) {
            this._layers[key] = config.defaultVisible;
        }

        // Visualization mode
        this._mode = 'composite';

        // Compare mode
        this._compareMode = false;
        this._compareSeeds = [];

        // Hover inspection
        this._hoverPosition = { x: 0, z: 0 };
        this._hoverParams = null;

        // World data (lazy-loaded via WorldGenerator)
        this._worldData = null;
        this._worldDataDirty = true;
    }

    // --- View State ---

    get viewX() { return this._viewX; }
    get viewZ() { return this._viewZ; }
    get zoom() { return this._zoom; }

    setViewport(viewX, viewZ, zoom) {
        const changed = this._viewX !== viewX || this._viewZ !== viewZ || this._zoom !== zoom;
        this._viewX = viewX;
        this._viewZ = viewZ;
        this._zoom = zoom;
        if (changed) {
            this._emit(EVENTS.VIEWPORT_CHANGE, { viewX, viewZ, zoom });
        }
    }

    // --- Generation State ---

    get seed() { return this._seed; }
    set seed(value) {
        if (this._seed !== value) {
            this._seed = value;
            this._worldDataDirty = true;
            this._emit(EVENTS.SEED_CHANGE, { seed: value });
        }
    }

    get template() { return this._template; }
    get templateName() { return this._templateName; }

    setTemplate(template, templateName) {
        if (this._template !== template) {
            this._template = template;
            this._templateName = templateName;
            this._worldDataDirty = true;
            this._emit(EVENTS.TEMPLATE_CHANGE, { template, templateName });
        }
    }

    // --- Layer Visibility ---

    get layers() { return { ...this._layers }; }

    isLayerVisible(layer) {
        return this._layers[layer] ?? false;
    }

    setLayerVisible(layer, visible) {
        if (this._layers[layer] !== visible) {
            this._layers[layer] = visible;
            this._emit(EVENTS.LAYER_TOGGLE, { layer, visible });
        }
    }

    toggleLayer(layer) {
        this.setLayerVisible(layer, !this._layers[layer]);
    }

    // --- Visualization Mode ---

    get mode() { return this._mode; }
    set mode(value) {
        if (this._mode !== value) {
            this._mode = value;
            this._emit(EVENTS.MODE_CHANGE, { mode: value });
        }
    }

    // --- Compare Mode ---

    get compareMode() { return this._compareMode; }
    get compareSeeds() { return [...this._compareSeeds]; }

    setCompareMode(enabled, seeds = []) {
        const changed = this._compareMode !== enabled ||
            JSON.stringify(this._compareSeeds) !== JSON.stringify(seeds);
        if (changed) {
            this._compareMode = enabled;
            this._compareSeeds = [...seeds];
            this._emit(EVENTS.COMPARE_TOGGLE, { enabled, seeds });
        }
    }

    // --- Hover Inspection ---

    get hoverPosition() { return { ...this._hoverPosition }; }
    get hoverParams() { return this._hoverParams; }

    setHoverData(x, z, params) {
        this._hoverPosition = { x, z };
        this._hoverParams = params;
        this._emit(EVENTS.HOVER_UPDATE, { x, z, params });
    }

    // --- World Data ---

    get worldData() {
        if (this._worldDataDirty) {
            this._regenerateWorldData();
        }
        return this._worldData;
    }

    /**
     * Force regeneration of world data (zones, rivers, spines)
     */
    invalidateWorldData() {
        this._worldDataDirty = true;
    }

    /**
     * Regenerate world data using WorldGenerator
     * @private
     */
    _regenerateWorldData() {
        const generator = new WorldGenerator(this._seed, this._template);
        this._worldData = generator.generate();
        this._worldDataDirty = false;

        console.log(`EditorState: WorldData regenerated - ${this._worldData.zones.size} zones, ${this._worldData.rivers?.length || 0} rivers, ${this._worldData.spines?.length || 0} spines`);
    }

    // --- Subscription System ---

    /**
     * Subscribe to all state changes
     * @param {Function} callback - Called with { type, data } on any state change
     * @returns {Function} Unsubscribe function
     */
    subscribe(callback) {
        this._subscribers.add(callback);
        return () => this._subscribers.delete(callback);
    }

    /**
     * Emit state change to subscribers
     * @private
     */
    _emit(type, data) {
        // Notify direct subscribers
        for (const callback of this._subscribers) {
            try {
                callback({ type, data });
            } catch (error) {
                console.error('EditorState: Error in subscriber:', error);
            }
        }

        // Also emit through EventBus for component communication
        if (this._eventBus) {
            this._eventBus.emit(type, data);
            this._eventBus.emit(EVENTS.STATE_CHANGE, { type, data });
        }
    }

    // --- Serialization ---

    /**
     * Export state to a plain object (for persistence or debugging)
     * @returns {Object}
     */
    toJSON() {
        return {
            viewX: this._viewX,
            viewZ: this._viewZ,
            zoom: this._zoom,
            seed: this._seed,
            templateName: this._templateName,
            layers: { ...this._layers },
            mode: this._mode,
            compareMode: this._compareMode,
            compareSeeds: [...this._compareSeeds]
        };
    }

    /**
     * Import state from a plain object
     * @param {Object} data - State data
     */
    fromJSON(data) {
        if (data.viewX !== undefined) this._viewX = data.viewX;
        if (data.viewZ !== undefined) this._viewZ = data.viewZ;
        if (data.zoom !== undefined) this._zoom = data.zoom;
        if (data.seed !== undefined) this._seed = data.seed;
        if (data.templateName !== undefined) this._templateName = data.templateName;
        if (data.layers) this._layers = { ...this._layers, ...data.layers };
        if (data.mode !== undefined) this._mode = data.mode;
        if (data.compareMode !== undefined) this._compareMode = data.compareMode;
        if (data.compareSeeds) this._compareSeeds = [...data.compareSeeds];

        this._worldDataDirty = true;
        this._emit(EVENTS.STATE_CHANGE, { type: 'restore', data: this.toJSON() });
    }
}
