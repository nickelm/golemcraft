/**
 * Template Editor - PanHandler
 *
 * Handles mouse drag and touch pan interactions for the canvas.
 */

import { EVENTS } from '../core/constants.js';

export class PanHandler {
    /**
     * @param {HTMLCanvasElement} canvas - The canvas element
     * @param {EditorState} state - Editor state instance
     * @param {EventBus} eventBus - Event bus for communication
     */
    constructor(canvas, state, eventBus) {
        this.canvas = canvas;
        this.state = state;
        this.eventBus = eventBus;

        // Mouse pan state
        this.isMousePanning = false;
        this.mousePanStartX = 0;
        this.mousePanStartY = 0;
        this.mousePanStartViewX = 0;
        this.mousePanStartViewZ = 0;

        // Touch pan state
        this.touchState = {
            isPanning: false,
            startX: 0,
            startZ: 0,
            startViewX: 0,
            startViewZ: 0
        };

        // Bind methods
        this._onMouseDown = this._onMouseDown.bind(this);
        this._onMouseMove = this._onMouseMove.bind(this);
        this._onMouseUp = this._onMouseUp.bind(this);
        this._onTouchStart = this._onTouchStart.bind(this);
        this._onTouchMove = this._onTouchMove.bind(this);
        this._onTouchEnd = this._onTouchEnd.bind(this);

        this._setupEventListeners();
    }

    _setupEventListeners() {
        // Mouse events
        this.canvas.addEventListener('mousedown', this._onMouseDown);
        window.addEventListener('mousemove', this._onMouseMove);
        window.addEventListener('mouseup', this._onMouseUp);

        // Touch events
        this.canvas.addEventListener('touchstart', this._onTouchStart, { passive: false });
        this.canvas.addEventListener('touchmove', this._onTouchMove, { passive: false });
        this.canvas.addEventListener('touchend', this._onTouchEnd);
        this.canvas.addEventListener('touchcancel', this._onTouchEnd);
    }

    // --- Mouse Pan ---

    _onMouseDown(e) {
        // Only pan on left mouse button
        if (e.button !== 0) return;

        this.isMousePanning = true;
        this.mousePanStartX = e.clientX;
        this.mousePanStartY = e.clientY;
        this.mousePanStartViewX = this.state.viewX;
        this.mousePanStartViewZ = this.state.viewZ;

        this.canvas.classList.add('panning');
    }

    _onMouseMove(e) {
        if (!this.isMousePanning) return;

        const dx = e.clientX - this.mousePanStartX;
        const dy = e.clientY - this.mousePanStartY;

        // Convert screen delta to world delta (inverse of zoom)
        const worldDx = dx / this.state.zoom;
        const worldDz = dy / this.state.zoom;

        // Update viewport (subtract because dragging right should move view left)
        this.state.setViewport(
            this.mousePanStartViewX - worldDx,
            this.mousePanStartViewZ - worldDz,
            this.state.zoom
        );
    }

    _onMouseUp(e) {
        if (!this.isMousePanning) return;

        this.isMousePanning = false;
        this.canvas.classList.remove('panning');
    }

    // --- Touch Pan ---

    _onTouchStart(e) {
        // Only handle single-touch pan (multi-touch is for zoom)
        if (e.touches.length !== 1) {
            this.touchState.isPanning = false;
            return;
        }

        e.preventDefault();

        const touch = e.touches[0];
        this.touchState.isPanning = true;
        this.touchState.startX = touch.clientX;
        this.touchState.startZ = touch.clientY;
        this.touchState.startViewX = this.state.viewX;
        this.touchState.startViewZ = this.state.viewZ;

        this.canvas.classList.add('panning');
    }

    _onTouchMove(e) {
        if (!this.touchState.isPanning || e.touches.length !== 1) return;

        e.preventDefault();

        const touch = e.touches[0];
        const dx = touch.clientX - this.touchState.startX;
        const dy = touch.clientY - this.touchState.startZ;

        // Convert screen delta to world delta
        const worldDx = dx / this.state.zoom;
        const worldDz = dy / this.state.zoom;

        this.state.setViewport(
            this.touchState.startViewX - worldDx,
            this.touchState.startViewZ - worldDz,
            this.state.zoom
        );
    }

    _onTouchEnd(e) {
        this.touchState.isPanning = false;
        this.canvas.classList.remove('panning');
    }

    /**
     * Pan the view by a delta in screen pixels
     * Used for keyboard navigation
     */
    panByPixels(dx, dy) {
        const worldDx = dx / this.state.zoom;
        const worldDz = dy / this.state.zoom;

        this.state.setViewport(
            this.state.viewX + worldDx,
            this.state.viewZ + worldDz,
            this.state.zoom
        );
    }

    /**
     * Center the view on a world position
     */
    centerOn(worldX, worldZ) {
        this.state.setViewport(worldX, worldZ, this.state.zoom);
    }

    /**
     * Clean up event listeners
     */
    destroy() {
        this.canvas.removeEventListener('mousedown', this._onMouseDown);
        window.removeEventListener('mousemove', this._onMouseMove);
        window.removeEventListener('mouseup', this._onMouseUp);
        this.canvas.removeEventListener('touchstart', this._onTouchStart);
        this.canvas.removeEventListener('touchmove', this._onTouchMove);
        this.canvas.removeEventListener('touchend', this._onTouchEnd);
        this.canvas.removeEventListener('touchcancel', this._onTouchEnd);
    }
}
