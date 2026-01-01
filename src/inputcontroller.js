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
        
        // Mouse state
        this.mouse = new THREE.Vector2();
        this.mouseDownPos = new THREE.Vector2();
        this.mouseDownTime = 0;
        this.isDragging = false;
        this.isRightDragging = false;
        
        // Raycasting
        this.raycaster = new THREE.Raycaster();
        
        // Callbacks
        this.onLeftClick = null;     // Called on left-click (not drag)
        this.onRightDrag = null;     // Called during right-drag with deltaX
        
        this.setupEventListeners();
    }
    
    /**
     * Set up all DOM event listeners
     */
    setupEventListeners() {
        // Keyboard
        window.addEventListener('keydown', (e) => {
            this.keys[e.key.toLowerCase()] = true;
        });
        
        window.addEventListener('keyup', (e) => {
            this.keys[e.key.toLowerCase()] = false;
        });
        
        // Mouse movement
        window.addEventListener('mousemove', (e) => {
            this.mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
            this.mouse.y = -(e.clientY / window.innerHeight) * 2 + 1;
            
            // Track drag distance
            if (this.mouseDownTime > 0) {
                const moveDistance = Math.sqrt(
                    Math.pow(e.clientX - this.mouseDownPos.x, 2) +
                    Math.pow(e.clientY - this.mouseDownPos.y, 2)
                );
                
                // If mouse moved more than 5 pixels, it's a drag
                if (moveDistance > 5) {
                    this.isDragging = true;
                }
            }
            
            // Handle right-click drag for rotation using pointer lock
            if (this.isRightDragging && document.pointerLockElement) {
                const deltaX = e.movementX;
                if (this.onRightDrag) {
                    this.onRightDrag(deltaX);
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
            }
        });
        
        // Mouse up
        window.addEventListener('mouseup', (e) => {
            if (e.button === 0) {  // Left click
                // Only trigger click if not dragging
                if (!this.isDragging && this.onLeftClick) {
                    this.onLeftClick(this.mouse);
                }
                this.mouseDownTime = 0;
                this.isDragging = false;
            } else if (e.button === 2) {  // Right click
                this.isRightDragging = false;
                // Exit pointer lock
                if (document.pointerLockElement) {
                    document.exitPointerLock();
                }
            }
        });
        
        // Prevent context menu on right-click
        window.addEventListener('contextmenu', (e) => {
            e.preventDefault();
        });
    }
    
    /**
     * Check if a key is pressed
     */
    isKeyPressed(key) {
        return this.keys[key.toLowerCase()] || false;
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
     * Set callback for right-drag rotation
     * @param {Function} callback - Called with (deltaX)
     */
    setRightDragCallback(callback) {
        this.onRightDrag = callback;
    }
    
    /**
     * Clean up event listeners
     */
    dispose() {
        // Note: In a real cleanup, we'd need to store bound functions to remove them
        // For now, listeners persist (which is fine for a single game instance)
    }
}