import * as THREE from 'three';

/**
 * InputController - Manages all input from keyboard, mouse, and touch
 * 
 * Handles:
 * - Keyboard state tracking
 * - Mouse position and click detection
 * - Click vs drag discrimination
 * - Right-click rotation with pointer lock
 * - Raycasting for world interaction
 */
export class InputController {
    constructor(renderer, camera) {
        this.renderer = renderer;
        this.camera = camera;
        
        // Keyboard state
        this.keys = {};
        this.keysJustPressed = {};  // Keys pressed this frame (cleared each frame)
        
        // Mouse state
        this.mouse = new THREE.Vector2();
        this.mouseDownPos = new THREE.Vector2();
        this.mouseDownTime = 0;
        this.isDragging = false;
        this.isRightDragging = false;
        
        // Raycasting
        this.raycaster = new THREE.Raycaster();
        
        // Callbacks
        this.onLeftClick = null;       // Called on left-click (not drag)
        this.onLeftDrag = null;        // Called during left-drag with (deltaX, deltaY)
        this.onLeftDragStart = null;   // Called when left-drag starts
        this.onLeftDragEnd = null;     // Called when left-drag ends
        this.onRightDrag = null;       // Called during right-drag with (deltaX, deltaY)
        this.onRightDragStart = null;  // Called when right-drag starts
        this.onRightDragEnd = null;    // Called when right-drag ends
        this.onScrollWheel = null;     // Called on scroll wheel with (delta)

        // Left-drag state
        this.isLeftDragging = false;

        this.setupEventListeners();
    }
    
    /**
     * Set up all DOM event listeners
     */
    setupEventListeners() {
        // Keyboard
        window.addEventListener('keydown', (e) => {
            const key = e.key.toLowerCase();
            if (!this.keys[key]) {
                this.keysJustPressed[key] = true;  // Only set if wasn't already pressed
            }
            this.keys[key] = true;
        });
        
        window.addEventListener('keyup', (e) => {
            this.keys[e.key.toLowerCase()] = false;
        });
        
        // Mouse movement
        window.addEventListener('mousemove', (e) => {
            this.mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
            this.mouse.y = -(e.clientY / window.innerHeight) * 2 + 1;
            
            // Track drag distance for left-click
            if (this.mouseDownTime > 0) {
                const moveDistance = Math.sqrt(
                    Math.pow(e.clientX - this.mouseDownPos.x, 2) +
                    Math.pow(e.clientY - this.mouseDownPos.y, 2)
                );

                // If mouse moved more than 5 pixels, it's a drag
                if (moveDistance > 5) {
                    this.isDragging = true;
                    // Start left-drag if not already started
                    if (!this.isLeftDragging) {
                        this.isLeftDragging = true;
                        this.renderer.domElement.requestPointerLock();
                        if (this.onLeftDragStart) {
                            this.onLeftDragStart();
                        }
                    }
                }
            }

            // Handle left-drag for camera orbit using pointer lock
            if (this.isLeftDragging && document.pointerLockElement) {
                const deltaX = e.movementX;
                const deltaY = e.movementY;
                if (this.onLeftDrag) {
                    this.onLeftDrag(deltaX, deltaY);
                }
            }

            // Handle right-click drag for rotation using pointer lock
            if (this.isRightDragging && document.pointerLockElement) {
                const deltaX = e.movementX;
                const deltaY = e.movementY;
                if (this.onRightDrag) {
                    this.onRightDrag(deltaX, deltaY);
                }
            }
        });
        
        // Mouse down
        window.addEventListener('mousedown', (e) => {
            if (e.button === 0) {  // Left click
                this.mouseDownPos.set(e.clientX, e.clientY);
                this.mouseDownTime = performance.now();
                this.isDragging = false;
            } else if (e.button === 2) {  // Right click
                this.isRightDragging = true;
                // Request pointer lock for infinite rotation
                this.renderer.domElement.requestPointerLock();
                // Notify callback that drag started
                if (this.onRightDragStart) {
                    this.onRightDragStart();
                }
            }
        });
        
        // Mouse up
        window.addEventListener('mouseup', (e) => {
            if (e.button === 0) {  // Left click
                // Only trigger click if not dragging
                if (!this.isDragging && this.onLeftClick) {
                    this.onLeftClick(this.mouse);
                }
                // End left-drag if active
                if (this.isLeftDragging) {
                    this.isLeftDragging = false;
                    if (document.pointerLockElement) {
                        document.exitPointerLock();
                    }
                    if (this.onLeftDragEnd) {
                        this.onLeftDragEnd();
                    }
                }
                this.mouseDownTime = 0;
                this.isDragging = false;
            } else if (e.button === 2) {  // Right click
                this.isRightDragging = false;
                // Exit pointer lock
                if (document.pointerLockElement) {
                    document.exitPointerLock();
                }
                // Notify callback that drag ended
                if (this.onRightDragEnd) {
                    this.onRightDragEnd();
                }
            }
        });

        // Scroll wheel for camera distance
        window.addEventListener('wheel', (e) => {
            if (this.onScrollWheel) {
                this.onScrollWheel(e.deltaY);
            }
        }, { passive: true });
        
        // Prevent context menu on right-click
        window.addEventListener('contextmenu', (e) => {
            e.preventDefault();
        });
    }
    
    /**
     * Check if a key is currently held down
     */
    isKeyPressed(key) {
        return this.keys[key.toLowerCase()] || false;
    }

    /**
     * Check if a key was just pressed this frame (single trigger)
     * Call clearJustPressed() at the end of each frame
     */
    isKeyJustPressed(key) {
        return this.keysJustPressed[key.toLowerCase()] || false;
    }

    /**
     * Clear the "just pressed" state - call at end of update
     */
    clearJustPressed() {
        this.keysJustPressed = {};
    }
    
    /**
     * Get current mouse position in normalized device coordinates
     */
    getMousePosition() {
        return this.mouse.clone();
    }
    
    /**
     * Raycast from camera through mouse position
     * @param {THREE.Scene} scene - Scene to raycast against
     * @param {boolean} excludeCelestial - Whether to exclude celestial objects (layer 1)
     * @returns {Array} Array of intersections
     */
    raycast(scene, excludeCelestial = true) {
        this.raycaster.setFromCamera(this.mouse, this.camera);
        
        const intersects = this.raycaster.intersectObjects(scene.children, true);
        
        if (excludeCelestial) {
            // Filter out celestial objects (sun/moon on layer 1)
            return intersects.filter(hit => hit.object.layers.mask !== 2);
        }
        
        return intersects;
    }
    
    /**
     * Set callback for left-click events (not drag)
     * @param {Function} callback - Called with (mousePosition)
     */
    setLeftClickCallback(callback) {
        this.onLeftClick = callback;
    }
    
    /**
     * Set callback for left-drag (camera orbit in follow mode)
     * @param {Function} callback - Called with (deltaX, deltaY)
     */
    setLeftDragCallback(callback) {
        this.onLeftDrag = callback;
    }

    /**
     * Set callback for left-drag start
     * @param {Function} callback - Called when left-drag starts
     */
    setLeftDragStartCallback(callback) {
        this.onLeftDragStart = callback;
    }

    /**
     * Set callback for left-drag end
     * @param {Function} callback - Called when left-drag ends
     */
    setLeftDragEndCallback(callback) {
        this.onLeftDragEnd = callback;
    }

    /**
     * Set callback for right-drag rotation
     * @param {Function} callback - Called with (deltaX, deltaY)
     */
    setRightDragCallback(callback) {
        this.onRightDrag = callback;
    }

    /**
     * Set callback for right-drag start
     * @param {Function} callback - Called when right-drag starts
     */
    setRightDragStartCallback(callback) {
        this.onRightDragStart = callback;
    }

    /**
     * Set callback for right-drag end
     * @param {Function} callback - Called when right-drag ends
     */
    setRightDragEndCallback(callback) {
        this.onRightDragEnd = callback;
    }

    /**
     * Set callback for scroll wheel
     * @param {Function} callback - Called with (delta)
     */
    setScrollWheelCallback(callback) {
        this.onScrollWheel = callback;
    }

    /**
     * Clean up event listeners
     */
    dispose() {
        // Note: In a real cleanup, we'd need to store bound functions to remove them
        // For now, listeners persist (which is fine for a single game instance)
    }
}