/**
 * ToolManager - Manages edit mode tools
 *
 * Handles tool switching, keyboard shortcuts, and rendering delegation.
 * Acts as the central coordinator for all editing tools.
 */

import { EVENTS, EDIT_STAGES } from '../../core/constants.js';

export class ToolManager {
    /**
     * @param {HTMLCanvasElement} canvas - The main canvas element
     * @param {EditorState} state - Editor state instance
     * @param {EventBus} eventBus - Event bus for notifications
     */
    constructor(canvas, state, eventBus) {
        this.canvas = canvas;
        this.state = state;
        this.eventBus = eventBus;

        /** @type {Map<string, BaseToolHandler>} */
        this.tools = new Map();

        /** @type {BaseToolHandler|null} */
        this.activeTool = null;

        this._boundKeyDown = this._onKeyDown.bind(this);

        this._setupEventListeners();
    }

    /**
     * Register a tool handler
     * @param {string} toolId - Tool identifier
     * @param {BaseToolHandler} handler - Tool handler instance
     */
    registerTool(toolId, handler) {
        this.tools.set(toolId, handler);
    }

    /**
     * Get a tool handler by ID
     * @param {string} toolId
     * @returns {BaseToolHandler|undefined}
     */
    getTool(toolId) {
        return this.tools.get(toolId);
    }

    /**
     * Set the active tool
     * @param {string|null} toolId - Tool identifier, or null to deselect
     * @returns {boolean} True if tool was activated/deactivated successfully
     */
    setTool(toolId) {
        // Handle deselection (null)
        if (toolId === null) {
            if (this.activeTool) {
                this.activeTool.deactivate();
                this.activeTool = null;
            }
            this.state.setSelectedTool(null);
            console.log('ToolManager: Tool deselected (pan mode)');
            return true;
        }

        // Validate tool exists
        const tool = this.tools.get(toolId);
        if (!tool) {
            console.warn(`ToolManager: Unknown tool '${toolId}'`);
            return false;
        }

        // Validate tool is available for current stage
        const stage = this.state.editStage;
        const stageConfig = EDIT_STAGES[stage];
        if (!stageConfig.tools.includes(toolId)) {
            console.warn(`ToolManager: Tool '${toolId}' not available in stage ${stage}`);
            return false;
        }

        // Deactivate current tool
        if (this.activeTool) {
            this.activeTool.deactivate();
        }

        // Activate new tool
        this.activeTool = tool;
        this.activeTool.activate();

        // Update state
        this.state.setSelectedTool(toolId);

        console.log(`ToolManager: Switched to tool '${toolId}'`);
        return true;
    }

    /**
     * Get the current active tool ID
     * @returns {string|null}
     */
    getActiveToolId() {
        for (const [id, tool] of this.tools) {
            if (tool === this.activeTool) {
                return id;
            }
        }
        return null;
    }

    /**
     * Get available tools for current stage
     * @returns {string[]} Array of tool IDs
     */
    getAvailableTools() {
        const stage = this.state.editStage;
        const stageConfig = EDIT_STAGES[stage];
        return stageConfig ? stageConfig.tools : [];
    }

    /**
     * Enable keyboard handling
     */
    enableKeyboard() {
        window.addEventListener('keydown', this._boundKeyDown);
    }

    /**
     * Disable keyboard handling
     */
    disableKeyboard() {
        window.removeEventListener('keydown', this._boundKeyDown);
    }

    _setupEventListeners() {
        // Listen for tool change events from state
        this.eventBus.on(EVENTS.EDIT_TOOL_CHANGE, ({ tool }) => {
            // Handle null (deselect) or tool switch
            if (this.getActiveToolId() !== tool) {
                this.setTool(tool);
            }
        });

        // When stage changes, switch to default tool for that stage
        this.eventBus.on(EVENTS.EDIT_STAGE_CHANGE, ({ stage }) => {
            const stageConfig = EDIT_STAGES[stage];
            if (stageConfig) {
                this.setTool(stageConfig.defaultTool);
            }
        });

        // When edit mode is enabled/disabled
        this.eventBus.on(EVENTS.EDIT_MODE_TOGGLE, ({ enabled }) => {
            if (enabled) {
                this.enableKeyboard();
                // Activate default tool for current stage
                const stageConfig = EDIT_STAGES[this.state.editStage];
                if (stageConfig) {
                    this.setTool(stageConfig.defaultTool);
                }
            } else {
                this.disableKeyboard();
                if (this.activeTool) {
                    this.activeTool.deactivate();
                    this.activeTool = null;
                }
            }
        });
    }

    _onKeyDown(e) {
        // Ignore if typing in an input
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA') {
            return;
        }

        // Global shortcuts (undo/redo)
        if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
            if (e.shiftKey) {
                this.eventBus.emit(EVENTS.HISTORY_REDO);
            } else {
                this.eventBus.emit(EVENTS.HISTORY_UNDO);
            }
            e.preventDefault();
            return;
        }

        if ((e.ctrlKey || e.metaKey) && e.key === 'y') {
            this.eventBus.emit(EVENTS.HISTORY_REDO);
            e.preventDefault();
            return;
        }

        // Escape to deselect
        if (e.key === 'Escape') {
            this.state.setSelectedPointIndex(-1);
            this.state.setSelectedFeature(null);
            this.eventBus.emit(EVENTS.RENDER_SCHEDULE);
            e.preventDefault();
            return;
        }

        // Tool shortcuts (number keys)
        const availableTools = this.getAvailableTools();
        const numKey = parseInt(e.key);
        if (!isNaN(numKey) && numKey >= 1 && numKey <= availableTools.length) {
            this.setTool(availableTools[numKey - 1]);
            e.preventDefault();
            return;
        }

        // Pass to active tool
        if (this.activeTool && this.activeTool.onKeyDown(e)) {
            e.preventDefault();
        }
    }

    /**
     * Render active tool overlay
     * @param {CanvasRenderingContext2D} ctx
     * @param {number} width
     * @param {number} height
     */
    render(ctx, width, height) {
        if (this.activeTool) {
            this.activeTool.render(ctx, width, height);
        }
    }

    /**
     * Clean up all tools and resources
     */
    destroy() {
        this.disableKeyboard();

        for (const tool of this.tools.values()) {
            tool.destroy();
        }

        this.tools.clear();
        this.activeTool = null;
    }
}
