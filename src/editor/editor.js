/**
 * Template Editor - Main Application
 *
 * Bootstraps and orchestrates all editor components.
 * Entry point for the Template Editor application.
 */

import { EventBus } from './core/events.js';
import { EditorState } from './core/state.js';
import { EVENTS } from './core/constants.js';

import { TileRenderer } from './rendering/tilerenderer.js';
import { OverlayRenderer } from './rendering/overlayrenderer.js';
import { CompareRenderer } from './rendering/comparerenderer.js';

import { PanHandler } from './interaction/panhandler.js';
import { ZoomHandler } from './interaction/zoomhandler.js';
import { InspectHandler } from './interaction/inspecthandler.js';

import { ControlPanel } from './ui/controlpanel.js';
import { InfoPanel } from './ui/infopanel.js';
import { StatusBar } from './ui/statusbar.js';

import { EditModeController } from './editmode/editmodecontroller.js';

import { buildRiverIndex, buildSpineIndex } from '../world/terrain/worldgen.js';

class EditorApp {
    constructor() {
        // Core systems
        this.eventBus = new EventBus();
        this.state = new EditorState(this.eventBus);

        // Canvas
        this.canvas = document.getElementById('terrain-canvas');

        // Rendering
        this.tileRenderer = null;
        this.overlayRenderer = null;
        this.compareRenderer = null;

        // Interaction
        this.panHandler = null;
        this.zoomHandler = null;
        this.inspectHandler = null;

        // UI
        this.controlPanel = null;
        this.infoPanel = null;
        this.statusBar = null;

        // Edit mode
        this.editModeController = null;

        // Bind methods
        this._onResize = this._onResize.bind(this);
        this._onKeyDown = this._onKeyDown.bind(this);
        this._onStateChange = this._onStateChange.bind(this);

        // Initialize
        this._init();
    }

    async _init() {
        console.log('Template Editor initializing...');

        // Setup canvas
        this._setupCanvas();

        // Build feature indices for terrain generation
        this._buildFeatureIndices();

        // Create renderers
        this.tileRenderer = new TileRenderer(this.canvas, this.state, this.eventBus);
        this.overlayRenderer = new OverlayRenderer(this.state, this.eventBus);
        this.compareRenderer = new CompareRenderer(
            document.getElementById('compare-container'),
            this.state,
            this.eventBus
        );

        // Create interaction handlers
        this.panHandler = new PanHandler(this.canvas, this.state, this.eventBus);
        this.zoomHandler = new ZoomHandler(this.canvas, this.state, this.eventBus);
        this.inspectHandler = new InspectHandler(this.canvas, this.state, this.eventBus);

        // Create UI components
        this.controlPanel = new ControlPanel(this.state, this.eventBus, this.tileRenderer);
        this.infoPanel = new InfoPanel(this.state, this.eventBus);
        this.statusBar = new StatusBar(this.state, this.eventBus, this.tileRenderer);

        // Create edit mode controller
        const controlPanelElement = document.getElementById('control-panel');
        this.editModeController = new EditModeController(
            this.canvas,
            controlPanelElement,
            this.state,
            this.eventBus
        );

        // Setup global event listeners
        window.addEventListener('resize', this._onResize);
        window.addEventListener('keydown', this._onKeyDown);

        // Subscribe to state changes for feature index rebuilding
        this.state.subscribe(this._onStateChange);

        // Initial render
        this.tileRenderer.resize();

        console.log('Template Editor ready');

        // Expose for debugging
        window.editor = this;
    }

    _setupCanvas() {
        // Initial resize
        const container = this.canvas.parentElement;
        const rect = container.getBoundingClientRect();

        const dpr = window.devicePixelRatio || 1;
        this.canvas.width = rect.width * dpr;
        this.canvas.height = rect.height * dpr;
        this.canvas.style.width = `${rect.width}px`;
        this.canvas.style.height = `${rect.height}px`;
    }

    _buildFeatureIndices() {
        const worldData = this.state.worldData;

        if (worldData.spines && worldData.spines.length > 0) {
            buildSpineIndex(worldData.spines);
            console.log(`Built spine index: ${worldData.spines.length} spines`);
        }

        if (worldData.rivers && worldData.rivers.length > 0) {
            buildRiverIndex(worldData.rivers);
            console.log(`Built river index: ${worldData.rivers.length} rivers`);
        }
    }

    _onStateChange({ type, data }) {
        // Rebuild feature indices when seed/template changes
        if (type === EVENTS.SEED_CHANGE || type === EVENTS.TEMPLATE_CHANGE) {
            // Force worldData regeneration and rebuild indices
            this.state.invalidateWorldData();
            this._buildFeatureIndices();
        }
    }

    _onResize() {
        if (this.tileRenderer) {
            this.tileRenderer.resize();
        }
        if (this.compareRenderer && this.state.compareMode) {
            this.compareRenderer.resize();
        }
    }

    _onKeyDown(e) {
        // Ignore if typing in an input
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;

        // In edit mode, let the tool manager handle most keys
        // Only allow navigation keys to pass through
        if (this.state.isEditMode) {
            const allowedInEditMode = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', '+', '=', '-', '_', 'Home'];
            if (!allowedInEditMode.includes(e.key)) {
                return;
            }
        }

        switch (e.key) {
            // Layer toggles
            case 'r':
            case 'R':
                this.controlPanel.toggleLayer('rivers');
                break;
            case 'z':
            case 'Z':
                this.controlPanel.toggleLayer('zones');
                break;
            case 's':
            case 'S':
                this.controlPanel.toggleLayer('spines');
                break;

            // Pan with arrow keys
            case 'ArrowLeft':
                this.panHandler.panByPixels(-100, 0);
                e.preventDefault();
                break;
            case 'ArrowRight':
                this.panHandler.panByPixels(100, 0);
                e.preventDefault();
                break;
            case 'ArrowUp':
                this.panHandler.panByPixels(0, -100);
                e.preventDefault();
                break;
            case 'ArrowDown':
                this.panHandler.panByPixels(0, 100);
                e.preventDefault();
                break;

            // Zoom with +/-
            case '+':
            case '=':
                this.zoomHandler.zoomIn();
                e.preventDefault();
                break;
            case '-':
            case '_':
                this.zoomHandler.zoomOut();
                e.preventDefault();
                break;

            // Mode shortcuts (1-8)
            case '1':
                this.state.mode = 'composite';
                document.getElementById('mode-select').value = 'composite';
                break;
            case '2':
                this.state.mode = 'elevation';
                document.getElementById('mode-select').value = 'elevation';
                break;
            case '3':
                this.state.mode = 'continental';
                document.getElementById('mode-select').value = 'continental';
                break;
            case '4':
                this.state.mode = 'temperature';
                document.getElementById('mode-select').value = 'temperature';
                break;
            case '5':
                this.state.mode = 'humidity';
                document.getElementById('mode-select').value = 'humidity';
                break;
            case '6':
                this.state.mode = 'erosion';
                document.getElementById('mode-select').value = 'erosion';
                break;
            case '7':
                this.state.mode = 'ridgeness';
                document.getElementById('mode-select').value = 'ridgeness';
                break;
            case '8':
                this.state.mode = 'biome';
                document.getElementById('mode-select').value = 'biome';
                break;

            // Reset view to center
            case 'Home':
                this.panHandler.centerOn(0, 0);
                this.zoomHandler.setZoom(1.0);
                e.preventDefault();
                break;
        }
    }

    /**
     * Clean up all resources
     */
    destroy() {
        window.removeEventListener('resize', this._onResize);
        window.removeEventListener('keydown', this._onKeyDown);

        this.editModeController?.destroy();

        this.controlPanel?.destroy();
        this.infoPanel?.destroy();
        this.statusBar?.destroy();

        this.panHandler?.destroy();
        this.zoomHandler?.destroy();
        this.inspectHandler?.destroy();

        this.tileRenderer?.destroy();
        this.overlayRenderer?.destroy();
        this.compareRenderer?.destroy();

        this.eventBus.clear();
    }
}

// Initialize editor when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => new EditorApp());
} else {
    new EditorApp();
}
