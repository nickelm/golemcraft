/**
 * Template Editor - EditorState
 *
 * Centralized reactive state management with subscription pattern.
 * Components subscribe to state changes and are notified when relevant
 * parts of the state change.
 */

import { LAYERS, DEFAULT_ZOOM, EVENTS, EDIT_STAGES } from './constants.js';
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

        // Edit mode state
        this._isEditMode = false;
        this._editStage = 1;
        this._editData = null;
        this._selectedTool = 'select';
        this._selectedPointIndex = -1;
        this._hoveredPointIndex = -1;
        this._selectedFeature = null; // { type: 'primarySpine'|'secondarySpine'|'hill'|etc, index: number }
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

    // --- Edit Mode State ---

    get isEditMode() { return this._isEditMode; }

    setEditMode(enabled) {
        if (this._isEditMode !== enabled) {
            this._isEditMode = enabled;
            if (enabled && !this._editData) {
                this._initializeEditData();
            }
            this._emit(EVENTS.EDIT_MODE_TOGGLE, { enabled });
        }
    }

    get editStage() { return this._editStage; }

    setEditStage(stage) {
        if (stage >= 1 && stage <= 4 && this._editStage !== stage) {
            this._editStage = stage;
            this._selectedTool = EDIT_STAGES[stage].defaultTool;
            this._selectedPointIndex = -1;
            this._selectedFeature = null;
            this._emit(EVENTS.EDIT_STAGE_CHANGE, { stage });
            this._emit(EVENTS.EDIT_TOOL_CHANGE, { tool: this._selectedTool });
        }
    }

    get editData() { return this._editData; }

    setEditData(data) {
        this._editData = data;
        this._emit(EVENTS.EDIT_DATA_CHANGE, { editData: data, source: 'set' });
    }

    get selectedTool() { return this._selectedTool; }

    setSelectedTool(tool) {
        if (this._selectedTool !== tool) {
            this._selectedTool = tool;
            this._emit(EVENTS.EDIT_TOOL_CHANGE, { tool });
        }
    }

    get selectedPointIndex() { return this._selectedPointIndex; }

    setSelectedPointIndex(index) {
        if (this._selectedPointIndex !== index) {
            this._selectedPointIndex = index;
            this._emit(EVENTS.EDIT_SELECTION_CHANGE, { pointIndex: index, feature: this._selectedFeature });
        }
    }

    get hoveredPointIndex() { return this._hoveredPointIndex; }

    setHoveredPointIndex(index) {
        this._hoveredPointIndex = index;
    }

    get selectedFeature() { return this._selectedFeature; }

    setSelectedFeature(feature) {
        this._selectedFeature = feature;
        this._emit(EVENTS.EDIT_SELECTION_CHANGE, { pointIndex: this._selectedPointIndex, feature });
    }

    /**
     * Initialize empty edit data structure
     * @private
     */
    _initializeEditData() {
        this._editData = {
            stage1: {
                spine: {
                    points: [],
                    elevation: 0.8,
                    width: 0.1
                },
                landExtent: { inner: 0.2, outer: 0.2 },
                bayCenter: null
            },
            stage2: {
                secondarySpines: [],
                hills: [],
                depressions: []
            },
            stage3: {
                waterSources: [],
                lakeRegions: [],
                riverDensity: 0.5,
                riverMeandering: 0.5
            },
            stage4: {
                temperatureGradient: { direction: { x: 0, z: -1 }, strength: 1.0 },
                baseHumidity: 0.5,
                excludedBiomes: []
            },
            lastModified: Date.now()
        };
    }

    /**
     * Initialize edit data from an existing template
     * @param {Object} template - Template to convert to edit data
     */
    initializeEditDataFromTemplate(template) {
        this._initializeEditData();

        // Copy primary spine if present
        if (template.spine && template.spine.points) {
            this._editData.stage1.spine = {
                points: template.spine.points.map(p => ({ x: p.x, z: p.z })),
                elevation: template.spine.elevation || 0.8,
                width: template.spine.width || 0.1
            };
        }

        // Copy land extent
        if (template.landExtent) {
            this._editData.stage1.landExtent = { ...template.landExtent };
        }

        // Copy bay center
        if (template.bayCenter) {
            this._editData.stage1.bayCenter = { ...template.bayCenter };
        }

        // Copy secondary spines
        if (template.secondarySpines) {
            this._editData.stage2.secondarySpines = template.secondarySpines.map(spine => ({
                points: spine.points.map(p => ({ x: p.x, z: p.z })),
                elevation: spine.elevation || 0.6
            }));
        }

        this._editData.lastModified = Date.now();
        this._emit(EVENTS.EDIT_DATA_CHANGE, { editData: this._editData, source: 'template' });
    }

    /**
     * Check if a stage is valid (has required data)
     * @param {number} stage - Stage number (1-4)
     * @returns {boolean}
     */
    isStageValid(stage) {
        if (!this._editData) return false;

        switch (stage) {
            case 1:
                return this._editData.stage1.spine.points.length >= 2;
            case 2:
                return this.isStageValid(1);
            case 3:
                return this.isStageValid(2);
            case 4:
                return this.isStageValid(3);
            default:
                return false;
        }
    }

    /**
     * Check if a stage can be advanced to
     * @param {number} stage - Stage number (1-4)
     * @returns {boolean}
     */
    canAdvanceToStage(stage) {
        if (stage <= 1) return true;
        return this.isStageValid(stage - 1);
    }

    /**
     * Mark edit data as modified and emit change event
     * @param {string} source - Source of the change
     */
    markEditDataModified(source = 'unknown') {
        if (this._editData) {
            this._editData.lastModified = Date.now();
            this._emit(EVENTS.EDIT_DATA_CHANGE, { editData: this._editData, source });
        }
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
            compareSeeds: [...this._compareSeeds],
            // Edit mode state
            isEditMode: this._isEditMode,
            editStage: this._editStage,
            editData: this._editData ? JSON.parse(JSON.stringify(this._editData)) : null,
            selectedTool: this._selectedTool
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

        // Edit mode state
        if (data.isEditMode !== undefined) this._isEditMode = data.isEditMode;
        if (data.editStage !== undefined) this._editStage = data.editStage;
        if (data.editData) this._editData = JSON.parse(JSON.stringify(data.editData));
        if (data.selectedTool !== undefined) this._selectedTool = data.selectedTool;

        this._worldDataDirty = true;
        this._emit(EVENTS.STATE_CHANGE, { type: 'restore', data: this.toJSON() });
    }
}
