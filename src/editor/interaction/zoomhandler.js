/**
 * Template Editor - ZoomHandler
 *
 * Handles mouse wheel and touch pinch zoom interactions for the canvas.
 * Zooms toward the cursor/pinch center position.
 */

import { MIN_ZOOM, MAX_ZOOM, EVENTS } from '../core/constants.js';
import { canvasToWorld } from '../utils/coordinates.js';

export class ZoomHandler {
    /**
     * @param {HTMLCanvasElement} canvas - The canvas element
     * @param {EditorState} state - Editor state instance
     * @param {EventBus} eventBus - Event bus for communication
     */
    constructor(canvas, state, eventBus) {
        this.canvas = canvas;
        this.state = state;
        this.eventBus = eventBus;

        // Pinch zoom state
        this.pinchState = {
            isPinching: false,
            initialDistance: 0,
            initialZoom: 0,
            centerX: 0,
            centerZ: 0
        };

        // Bind methods
        this._onWheel = this._onWheel.bind(this);
        this._onTouchStart = this._onTouchStart.bind(this);
        this._onTouchMove = this._onTouchMove.bind(this);
        this._onTouchEnd = this._onTouchEnd.bind(this);

        this._setupEventListeners();
    }

    _setupEventListeners() {
        // Mouse wheel
        this.canvas.addEventListener('wheel', this._onWheel, { passive: false });

        // Touch events for pinch zoom
        this.canvas.addEventListener('touchstart', this._onTouchStart, { passive: false });
        this.canvas.addEventListener('touchmove', this._onTouchMove, { passive: false });
        this.canvas.addEventListener('touchend', this._onTouchEnd);
        this.canvas.addEventListener('touchcancel', this._onTouchEnd);
    }

    /**
     * Get canvas size in CSS pixels
     */
    _getCanvasSize() {
        const rect = this.canvas.getBoundingClientRect();
        return { width: rect.width, height: rect.height };
    }

    // --- Mouse Wheel Zoom ---

    _onWheel(e) {
        e.preventDefault();

        const { width, height } = this._getCanvasSize();
        const rect = this.canvas.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;

        // Calculate zoom factor (smaller delta = finer control)
        const zoomDelta = e.deltaY > 0 ? 0.9 : 1.1;
        const newZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, this.state.zoom * zoomDelta));

        if (newZoom === this.state.zoom) return;

        // Zoom toward mouse position
        this._zoomToward(mouseX, mouseY, width, height, newZoom);
    }

    // --- Pinch Zoom ---

    _onTouchStart(e) {
        if (e.touches.length !== 2) {
            this.pinchState.isPinching = false;
            return;
        }

        e.preventDefault();

        const touch1 = e.touches[0];
        const touch2 = e.touches[1];

        this.pinchState.isPinching = true;
        this.pinchState.initialDistance = this._getTouchDistance(touch1, touch2);
        this.pinchState.initialZoom = this.state.zoom;

        // Calculate pinch center in canvas coordinates
        const rect = this.canvas.getBoundingClientRect();
        this.pinchState.centerX = ((touch1.clientX + touch2.clientX) / 2) - rect.left;
        this.pinchState.centerZ = ((touch1.clientY + touch2.clientY) / 2) - rect.top;
    }

    _onTouchMove(e) {
        if (!this.pinchState.isPinching || e.touches.length !== 2) return;

        e.preventDefault();

        const touch1 = e.touches[0];
        const touch2 = e.touches[1];

        const currentDistance = this._getTouchDistance(touch1, touch2);
        const scale = currentDistance / this.pinchState.initialDistance;
        const newZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, this.pinchState.initialZoom * scale));

        if (newZoom === this.state.zoom) return;

        const { width, height } = this._getCanvasSize();
        this._zoomToward(
            this.pinchState.centerX,
            this.pinchState.centerZ,
            width,
            height,
            newZoom
        );
    }

    _onTouchEnd(e) {
        if (e.touches.length < 2) {
            this.pinchState.isPinching = false;
        }
    }

    _getTouchDistance(touch1, touch2) {
        const dx = touch2.clientX - touch1.clientX;
        const dy = touch2.clientY - touch1.clientY;
        return Math.sqrt(dx * dx + dy * dy);
    }

    // --- Zoom Toward Point ---

    /**
     * Zoom toward a specific screen position
     * This keeps the world position under the cursor/pinch center stationary
     */
    _zoomToward(screenX, screenY, canvasWidth, canvasHeight, newZoom) {
        const { viewX, viewZ, zoom } = this.state;

        // Get world position under cursor before zoom
        const worldPos = canvasToWorld(
            screenX,
            screenY,
            { viewX, viewZ, zoom },
            canvasWidth,
            canvasHeight
        );

        // After changing zoom, what screen position would this world point be at?
        // We want to adjust viewX/viewZ so it stays at the same screen position

        // Screen position relative to canvas center
        const halfWidth = canvasWidth / 2;
        const halfHeight = canvasHeight / 2;
        const relScreenX = screenX - halfWidth;
        const relScreenY = screenY - halfHeight;

        // New view center to keep world point at same screen position
        const newViewX = worldPos.x - relScreenX / newZoom;
        const newViewZ = worldPos.z - relScreenY / newZoom;

        this.state.setViewport(newViewX, newViewZ, newZoom);
    }

    /**
     * Zoom in by a factor
     * Used for keyboard controls
     */
    zoomIn(factor = 1.2) {
        const { width, height } = this._getCanvasSize();
        const newZoom = Math.min(MAX_ZOOM, this.state.zoom * factor);
        // Zoom toward center
        this._zoomToward(width / 2, height / 2, width, height, newZoom);
    }

    /**
     * Zoom out by a factor
     * Used for keyboard controls
     */
    zoomOut(factor = 1.2) {
        const { width, height } = this._getCanvasSize();
        const newZoom = Math.max(MIN_ZOOM, this.state.zoom / factor);
        // Zoom toward center
        this._zoomToward(width / 2, height / 2, width, height, newZoom);
    }

    /**
     * Set zoom to a specific level
     */
    setZoom(zoom) {
        const { width, height } = this._getCanvasSize();
        const newZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom));
        this._zoomToward(width / 2, height / 2, width, height, newZoom);
    }

    /**
     * Clean up event listeners
     */
    destroy() {
        this.canvas.removeEventListener('wheel', this._onWheel);
        this.canvas.removeEventListener('touchstart', this._onTouchStart);
        this.canvas.removeEventListener('touchmove', this._onTouchMove);
        this.canvas.removeEventListener('touchend', this._onTouchEnd);
        this.canvas.removeEventListener('touchcancel', this._onTouchEnd);
    }
}
