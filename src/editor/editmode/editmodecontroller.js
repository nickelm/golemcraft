/**
 * EditModeController - Main orchestrator for Edit Mode
 *
 * Coordinates all edit mode components:
 * - Tool management
 * - History (undo/redo)
 * - Persistence (auto-save)
 * - Preview pipeline
 * - UI panels
 */

import { EVENTS, EDIT_STAGES } from '../core/constants.js';

import { HistoryManager } from './historymanager.js';
import { PersistenceManager } from './persistencemanager.js';
import { PreviewPipeline } from './previewpipeline.js';

import { ToolManager } from './handlers/toolmanager.js';
import { SpineDrawingHandler } from './handlers/spinedrawinghandler.js';
import { PointDragHandler } from './handlers/pointdraghandler.js';

import { StagePanel } from './ui/stagepanel.js';
import { PropertyEditor } from './ui/propertyeditor.js';

export class EditModeController {
    /**
     * @param {HTMLCanvasElement} canvas - The main canvas element
     * @param {HTMLElement} controlPanelContainer - Container for edit mode UI
     * @param {EditorState} state - Editor state instance
     * @param {EventBus} eventBus - Event bus for notifications
     */
    constructor(canvas, controlPanelContainer, state, eventBus) {
        this.canvas = canvas;
        this.controlPanelContainer = controlPanelContainer;
        this.state = state;
        this.eventBus = eventBus;

        // Sub-components (created on-demand)
        this.historyManager = null;
        this.persistenceManager = null;
        this.previewPipeline = null;
        this.toolManager = null;
        this.stagePanel = null;
        this.propertyEditor = null;

        // Edit mode toggle button
        this.toggleButton = null;

        this._setupEditModeToggle();
        this._setupEventListeners();
    }

    /**
     * Create the edit mode toggle button in the control panel
     * @private
     */
    _setupEditModeToggle() {
        // Create container for the toggle
        const toggleContainer = document.createElement('div');
        toggleContainer.className = 'edit-mode-toggle-container';
        toggleContainer.style.cssText = `
            margin-bottom: 16px;
            padding-bottom: 16px;
            border-bottom: 1px solid #333;
        `;

        this.toggleButton = document.createElement('button');
        this.toggleButton.className = 'edit-mode-toggle-btn';
        this.toggleButton.textContent = 'Enter Edit Mode';
        this.toggleButton.style.cssText = `
            width: 100%;
            padding: 10px 16px;
            background: linear-gradient(135deg, #4a9eff 0%, #357ae8 100%);
            border: none;
            border-radius: 6px;
            color: white;
            font-size: 13px;
            font-weight: 500;
            cursor: pointer;
            transition: all 0.2s ease;
        `;

        this.toggleButton.addEventListener('click', () => {
            this._handleToggleClick();
        });

        toggleContainer.appendChild(this.toggleButton);

        // Insert at the top of the control panel
        if (this.controlPanelContainer.firstChild) {
            this.controlPanelContainer.insertBefore(toggleContainer, this.controlPanelContainer.firstChild);
        } else {
            this.controlPanelContainer.appendChild(toggleContainer);
        }
    }

    /**
     * Handle edit mode toggle button click
     * @private
     */
    _handleToggleClick() {
        if (this.state.isEditMode) {
            this._exitEditMode();
        } else {
            this._enterEditMode();
        }
    }

    /**
     * Enter edit mode
     * @private
     */
    _enterEditMode() {
        // Check for saved session
        if (!this.persistenceManager) {
            this.persistenceManager = new PersistenceManager(this.state, this.eventBus);
        }

        if (this.persistenceManager.hasSavedSession()) {
            // Offer to restore or start fresh
            const info = this.persistenceManager.getSavedSessionInfo();
            const dateStr = new Date(info.timestamp).toLocaleString();

            const restore = confirm(
                `Found a saved editing session from ${dateStr}.\n\n` +
                `Click OK to restore it, or Cancel to start fresh.`
            );

            if (restore) {
                this.persistenceManager.restore();
            } else {
                this.persistenceManager.clear();
                this._initializeNewSession();
            }
        } else {
            this._initializeNewSession();
        }

        // Enable edit mode
        this.state.setEditMode(true);

        // Initialize components
        this._initializeComponents();

        // Enable spine layer by default in edit mode
        if (!this.state.layers.spines) {
            this.state.setLayerVisible('spines', true);
        }

        // Change cursor to crosshair for drawing
        this.canvas.style.cursor = 'crosshair';

        // Update UI
        this._updateToggleButton(true);
    }

    /**
     * Initialize a new editing session
     * @private
     */
    _initializeNewSession() {
        const currentTemplate = this.state.template;
        const templateName = this.state.templateName;

        // Check if editing an existing template
        if (currentTemplate && currentTemplate.spine && templateName !== 'custom') {
            const editExisting = confirm(
                `You're viewing the "${templateName}" template.\n\n` +
                `Click OK to edit a copy of it, or Cancel to start with a blank canvas.`
            );

            if (editExisting) {
                this.state.initializeEditDataFromTemplate(currentTemplate);
            }
            // If Cancel, state will initialize empty edit data when setEditMode is called
        }
    }

    /**
     * Initialize edit mode components
     * @private
     */
    _initializeComponents() {
        // History manager
        if (!this.historyManager) {
            this.historyManager = new HistoryManager(this.state, this.eventBus);
        }
        this.historyManager.initialize();

        // Preview pipeline
        if (!this.previewPipeline) {
            this.previewPipeline = new PreviewPipeline(this.state, this.eventBus);
        }

        // Tool manager
        if (!this.toolManager) {
            this.toolManager = new ToolManager(this.canvas, this.state, this.eventBus);
            this._registerTools();
        }

        // UI components
        if (!this.stagePanel) {
            this.stagePanel = new StagePanel(this.controlPanelContainer, this.state, this.eventBus);
        }
        this.stagePanel.setVisible(true);

        if (!this.propertyEditor) {
            this.propertyEditor = new PropertyEditor(this.controlPanelContainer, this.state, this.eventBus);
        }
        this.propertyEditor.setVisible(true);

        // Force initial regeneration
        this.previewPipeline.regenerateNow();
    }

    /**
     * Register all tools with the tool manager
     * @private
     */
    _registerTools() {
        // Stage 1 tools
        this.toolManager.registerTool('draw', new SpineDrawingHandler(this.canvas, this.state, this.eventBus));
        this.toolManager.registerTool('select', new PointDragHandler(this.canvas, this.state, this.eventBus));

        // 'delete' uses the same handler as select (delete key removes selected point)
        // We reuse the select handler but could create a dedicated DeleteHandler if needed
        this.toolManager.registerTool('delete', new PointDragHandler(this.canvas, this.state, this.eventBus));

        // Stage 2 tools (reuse spine drawing for secondary spines)
        this.toolManager.registerTool('spine', new SpineDrawingHandler(this.canvas, this.state, this.eventBus));
        // hill and depression would need BrushPaintHandler (not yet implemented)
        this.toolManager.registerTool('hill', new PointDragHandler(this.canvas, this.state, this.eventBus));
        this.toolManager.registerTool('depression', new PointDragHandler(this.canvas, this.state, this.eventBus));

        // Stage 3 tools (would need ClickPlaceHandler - not yet implemented)
        this.toolManager.registerTool('source', new PointDragHandler(this.canvas, this.state, this.eventBus));
        this.toolManager.registerTool('lake', new PointDragHandler(this.canvas, this.state, this.eventBus));

        // Stage 4 tools (would need GradientVectorHandler - not yet implemented)
        this.toolManager.registerTool('gradient', new PointDragHandler(this.canvas, this.state, this.eventBus));
    }

    /**
     * Exit edit mode
     * @private
     */
    _exitEditMode() {
        // Save before exiting
        if (this.persistenceManager) {
            this.persistenceManager.saveNow();
        }

        // Disable edit mode
        this.state.setEditMode(false);

        // Hide UI
        if (this.stagePanel) {
            this.stagePanel.setVisible(false);
        }
        if (this.propertyEditor) {
            this.propertyEditor.setVisible(false);
        }

        // Reset cursor
        this.canvas.style.cursor = 'grab';

        // Update UI
        this._updateToggleButton(false);

        // Request render to clear edit overlays
        this.eventBus.emit(EVENTS.RENDER_SCHEDULE);
    }

    /**
     * Update the toggle button appearance
     * @private
     */
    _updateToggleButton(isEditMode) {
        if (!this.toggleButton) return;

        if (isEditMode) {
            this.toggleButton.textContent = 'Exit Edit Mode';
            this.toggleButton.style.background = 'linear-gradient(135deg, #ff6b4a 0%, #e85d3f 100%)';
        } else {
            this.toggleButton.textContent = 'Enter Edit Mode';
            this.toggleButton.style.background = 'linear-gradient(135deg, #4a9eff 0%, #357ae8 100%)';
        }
    }

    /**
     * Setup event listeners
     * @private
     */
    _setupEventListeners() {
        // Handle edit mode toggle from state
        this.eventBus.on(EVENTS.EDIT_MODE_TOGGLE, ({ enabled }) => {
            this._updateToggleButton(enabled);

            if (!enabled && this.stagePanel) {
                this.stagePanel.setVisible(false);
            }
            if (!enabled && this.propertyEditor) {
                this.propertyEditor.setVisible(false);
            }
        });

        // Hook into render pipeline to draw edit mode overlays
        this.eventBus.on(EVENTS.RENDER_REQUEST, ({ width, height, ctx }) => {
            this.render(ctx, width, height);
        });
    }

    /**
     * Render edit mode overlays
     * @param {CanvasRenderingContext2D} ctx
     * @param {number} width
     * @param {number} height
     */
    render(ctx, width, height) {
        if (!this.state.isEditMode) return;

        // Render tool-specific overlay
        if (this.toolManager) {
            this.toolManager.render(ctx, width, height);
        }
    }

    /**
     * Check if edit mode is active
     * @returns {boolean}
     */
    isActive() {
        return this.state.isEditMode;
    }

    /**
     * Clean up all resources
     */
    destroy() {
        if (this.historyManager) {
            this.historyManager.destroy();
            this.historyManager = null;
        }

        if (this.persistenceManager) {
            this.persistenceManager.destroy();
            this.persistenceManager = null;
        }

        if (this.previewPipeline) {
            this.previewPipeline.destroy();
            this.previewPipeline = null;
        }

        if (this.toolManager) {
            this.toolManager.destroy();
            this.toolManager = null;
        }

        if (this.stagePanel) {
            this.stagePanel.destroy();
            this.stagePanel = null;
        }

        if (this.propertyEditor) {
            this.propertyEditor.destroy();
            this.propertyEditor = null;
        }

        if (this.toggleButton && this.toggleButton.parentNode) {
            this.toggleButton.parentNode.removeChild(this.toggleButton.parentNode);
        }
    }
}
