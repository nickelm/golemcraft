/**
 * BaseToolHandler - Abstract base class for edit mode tools
 *
 * Provides common functionality for all editing tools including:
 * - Canvas event handling (mouse/touch)
 * - Coordinate conversions
 * - State access
 * - Rendering interface
 */

import { canvasToNormalized, normalizedToCanvas, canvasToWorld, worldToCanvas } from '../../utils/coordinates.js';
import { EVENTS } from '../../core/constants.js';

export class BaseToolHandler {
    /**
     * @param {HTMLCanvasElement} canvas - The main canvas element
     * @param {EditorState} state - Editor state instance
     * @param {EventBus} eventBus - Event bus for notifications
     */
    constructor(canvas, state, eventBus) {
        this.canvas = canvas;
        this.state = state;
        this.eventBus = eventBus;

        this._active = false;
        this._boundMouseDown = null;
        this._boundMouseMove = null;
        this._boundMouseUp = null;
        this._boundContextMenu = null;
    }

    /**
     * Activate this tool and start listening for events
     */
    activate() {
        if (this._active) return;
        this._active = true;

        this._boundMouseDown = this._onMouseDown.bind(this);
        this._boundMouseMove = this._onMouseMove.bind(this);
        this._boundMouseUp = this._onMouseUp.bind(this);
        this._boundContextMenu = this._onContextMenu.bind(this);

        this.canvas.addEventListener('mousedown', this._boundMouseDown);
        this.canvas.addEventListener('mousemove', this._boundMouseMove);
        this.canvas.addEventListener('mouseup', this._boundMouseUp);
        this.canvas.addEventListener('contextmenu', this._boundContextMenu);

        this.onActivate();
    }

    /**
     * Deactivate this tool and stop listening for events
     */
    deactivate() {
        if (!this._active) return;
        this._active = false;

        this.canvas.removeEventListener('mousedown', this._boundMouseDown);
        this.canvas.removeEventListener('mousemove', this._boundMouseMove);
        this.canvas.removeEventListener('mouseup', this._boundMouseUp);
        this.canvas.removeEventListener('contextmenu', this._boundContextMenu);

        this.onDeactivate();
    }

    /**
     * Check if this tool is currently active
     * @returns {boolean}
     */
    isActive() {
        return this._active;
    }

    // --- Coordinate Conversion Helpers ---

    /**
     * Get canvas dimensions accounting for device pixel ratio
     * @returns {{width: number, height: number}}
     */
    _getCanvasSize() {
        const rect = this.canvas.getBoundingClientRect();
        return { width: rect.width, height: rect.height };
    }

    /**
     * Get mouse position relative to canvas
     * @param {MouseEvent} e
     * @returns {{x: number, y: number}}
     */
    _getMousePos(e) {
        const rect = this.canvas.getBoundingClientRect();
        return {
            x: e.clientX - rect.left,
            y: e.clientY - rect.top
        };
    }

    /**
     * Convert mouse event to normalized coordinates [0,1]
     * @param {MouseEvent} e
     * @returns {{x: number, z: number}}
     */
    _mouseToNormalized(e) {
        const pos = this._getMousePos(e);
        const size = this._getCanvasSize();
        const viewState = {
            viewX: this.state.viewX,
            viewZ: this.state.viewZ,
            zoom: this.state.zoom
        };
        return canvasToNormalized(pos.x, pos.y, viewState, size.width, size.height, this.state.template);
    }

    /**
     * Convert mouse event to world coordinates
     * @param {MouseEvent} e
     * @returns {{x: number, z: number}}
     */
    _mouseToWorld(e) {
        const pos = this._getMousePos(e);
        const size = this._getCanvasSize();
        const viewState = {
            viewX: this.state.viewX,
            viewZ: this.state.viewZ,
            zoom: this.state.zoom
        };
        return canvasToWorld(pos.x, pos.y, viewState, size.width, size.height);
    }

    /**
     * Convert normalized coordinates to canvas position
     * @param {{x: number, z: number}} normalized
     * @returns {{x: number, y: number}}
     */
    _normalizedToCanvas(normalized) {
        const size = this._getCanvasSize();
        const viewState = {
            viewX: this.state.viewX,
            viewZ: this.state.viewZ,
            zoom: this.state.zoom
        };
        return normalizedToCanvas(normalized.x, normalized.z, viewState, size.width, size.height, this.state.template);
    }

    /**
     * Convert world coordinates to canvas position
     * @param {{x: number, z: number}} world
     * @returns {{x: number, y: number}}
     */
    _worldToCanvas(world) {
        const size = this._getCanvasSize();
        const viewState = {
            viewX: this.state.viewX,
            viewZ: this.state.viewZ,
            zoom: this.state.zoom
        };
        return worldToCanvas(world.x, world.z, viewState, size.width, size.height);
    }

    /**
     * Calculate distance between two normalized points
     * @param {{x: number, z: number}} p1
     * @param {{x: number, z: number}} p2
     * @returns {number}
     */
    _normalizedDistance(p1, p2) {
        const dx = p1.x - p2.x;
        const dz = p1.z - p2.z;
        return Math.sqrt(dx * dx + dz * dz);
    }

    /**
     * Calculate screen distance in pixels between two normalized points
     * @param {{x: number, z: number}} p1
     * @param {{x: number, z: number}} p2
     * @returns {number}
     */
    _screenDistance(p1, p2) {
        const s1 = this._normalizedToCanvas(p1);
        const s2 = this._normalizedToCanvas(p2);
        const dx = s1.x - s2.x;
        const dy = s1.y - s2.y;
        return Math.sqrt(dx * dx + dy * dy);
    }

    /**
     * Get the current edit data (shorthand)
     * @returns {Object}
     */
    _getEditData() {
        return this.state.editData;
    }

    /**
     * Mark edit data as modified and request render
     * @param {string} source - Source identifier for the change
     */
    _markModified(source) {
        this.state.markEditDataModified(source);
        this.eventBus.emit(EVENTS.RENDER_SCHEDULE);
    }

    /**
     * Push current state to history (call after completing an action)
     */
    _pushHistory() {
        this.eventBus.emit(EVENTS.HISTORY_PUSH);
    }

    // --- Event Handlers (internal) ---

    _onMouseDown(e) {
        if (!this._active) return;
        if (e.button === 0) {
            this.onMouseDown(e);
        } else if (e.button === 2) {
            this.onRightClick(e);
        }
    }

    _onMouseMove(e) {
        if (!this._active) return;
        this.onMouseMove(e);
    }

    _onMouseUp(e) {
        if (!this._active) return;
        this.onMouseUp(e);
    }

    _onContextMenu(e) {
        // Prevent context menu to enable right-click handling
        e.preventDefault();
    }

    // --- Override Points (subclasses implement these) ---

    /**
     * Called when tool is activated
     */
    onActivate() {}

    /**
     * Called when tool is deactivated
     */
    onDeactivate() {}

    /**
     * Handle left mouse button down
     * @param {MouseEvent} e
     */
    onMouseDown(e) {}

    /**
     * Handle mouse movement
     * @param {MouseEvent} e
     */
    onMouseMove(e) {}

    /**
     * Handle left mouse button up
     * @param {MouseEvent} e
     */
    onMouseUp(e) {}

    /**
     * Handle right mouse button click
     * @param {MouseEvent} e
     */
    onRightClick(e) {}

    /**
     * Handle keyboard input (called by ToolManager)
     * @param {KeyboardEvent} e
     * @returns {boolean} True if the key was handled
     */
    onKeyDown(e) {
        return false;
    }

    /**
     * Render tool-specific overlay graphics
     * @param {CanvasRenderingContext2D} ctx - Canvas 2D context
     * @param {number} width - Canvas width
     * @param {number} height - Canvas height
     */
    render(ctx, width, height) {}

    /**
     * Clean up resources
     */
    destroy() {
        this.deactivate();
    }
}
