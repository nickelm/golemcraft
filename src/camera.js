import * as THREE from 'three';

/**
 * CameraController - Manages camera modes for the game
 * 
 * Modes:
 * - 'orbit': Free orbit around hero (default, current behavior)
 * - 'follow': Third-person camera locked behind hero
 * - 'first-person': View from hero's head with mouse look (yaw + pitch)
 */
export class CameraController {
    constructor(camera, controls, hero) {
        this.camera = camera;
        this.controls = controls;
        this.hero = hero;
        
        this.mode = 'orbit';
        
        // Follow mode settings
        this.followDistance = 15;
        this.followHeight = 8;
        this.followLerpSpeed = 5;
        
        // First-person settings
        this.firstPersonHeight = 2.3; // Eye level on mounted hero
        this.firstPersonPitch = 0;    // Vertical look angle (radians)
        this.maxPitch = Math.PI / 2 - 0.1;  // ~80 degrees up
        this.minPitch = -Math.PI / 2 + 0.1; // ~80 degrees down
        
        // Store original orbit settings
        this.originalMinDistance = controls.minDistance;
        this.originalMaxDistance = controls.maxDistance;
        
        // Create UI
        this.createUI();
    }
    
    createUI() {
        const container = document.createElement('div');
        container.id = 'camera-controls';
        container.style.cssText = `
            position: absolute;
            top: 10px;
            left: 50%;
            transform: translateX(-50%);
            display: flex;
            flex-direction: row;
            gap: 5px;
            z-index: 1000;
        `;
        
        const modes = [
            { id: 'orbit', label: 'Orbit', shortcut: '1' },
            { id: 'follow', label: 'Follow', shortcut: '2' },
            { id: 'first-person', label: 'First Person', shortcut: '3' }
        ];
        
        this.buttons = {};
        
        modes.forEach(({ id, label, shortcut }) => {
            const btn = document.createElement('button');
            btn.textContent = `${label} [${shortcut}]`;
            btn.dataset.mode = id;
            btn.style.cssText = `
                padding: 8px 12px;
                background: rgba(0, 0, 0, 0.6);
                color: white;
                border: 2px solid rgba(255, 255, 255, 0.3);
                border-radius: 4px;
                cursor: pointer;
                font-family: monospace;
                font-size: 12px;
                text-align: center;
                transition: all 0.2s;
                white-space: nowrap;
            `;
            
            btn.addEventListener('click', () => this.setMode(id));
            btn.addEventListener('mouseenter', () => {
                if (this.mode !== id) {
                    btn.style.background = 'rgba(50, 50, 50, 0.8)';
                }
            });
            btn.addEventListener('mouseleave', () => {
                if (this.mode !== id) {
                    btn.style.background = 'rgba(0, 0, 0, 0.6)';
                }
            });
            
            container.appendChild(btn);
            this.buttons[id] = btn;
        });
        
        document.body.appendChild(container);
        this.container = container;
        
        // Set initial active state
        this.updateButtonStates();
        
        // Keyboard shortcuts
        window.addEventListener('keydown', (e) => {
            if (e.key === '1') this.setMode('orbit');
            if (e.key === '2') this.setMode('follow');
            if (e.key === '3') this.setMode('first-person');
        });
    }
    
    updateButtonStates() {
        Object.entries(this.buttons).forEach(([id, btn]) => {
            if (id === this.mode) {
                btn.style.background = 'rgba(0, 100, 200, 0.8)';
                btn.style.borderColor = 'rgba(100, 180, 255, 0.8)';
            } else {
                btn.style.background = 'rgba(0, 0, 0, 0.6)';
                btn.style.borderColor = 'rgba(255, 255, 255, 0.3)';
            }
        });
    }
    
    setMode(mode) {
        if (this.mode === mode) return;
        
        const oldMode = this.mode;
        this.mode = mode;
        
        // Toggle hero head visibility for first-person
        if (this.hero.heroMount) {
            this.hero.heroMount.setHeadVisible(mode !== 'first-person');
        }
        
        // Reset pitch when entering first-person
        if (mode === 'first-person') {
            this.firstPersonPitch = 0;
        }
        
        // Configure controls based on mode
        switch (mode) {
            case 'orbit':
                this.controls.enabled = true;
                this.controls.minDistance = 5;
                this.controls.maxDistance = 50;
                this.controls.maxPolarAngle = Math.PI / 2.5;
                
                // Restore reasonable orbit position
                if (oldMode === 'first-person') {
                    const heroPos = this.hero.position.clone();
                    this.camera.position.set(
                        heroPos.x,
                        heroPos.y + 20,
                        heroPos.z + 30
                    );
                    this.controls.target.copy(heroPos);
                }
                break;
                
            case 'follow':
                this.controls.enabled = true;
                this.controls.minDistance = 8;
                this.controls.maxDistance = 25;
                this.controls.maxPolarAngle = Math.PI / 2.2;
                break;
                
            case 'first-person':
                // DISABLE OrbitControls entirely - we manage camera directly
                this.controls.enabled = false;
                break;
        }
        
        this.updateButtonStates();
    }
    
    /**
     * Handle mouse drag for look rotation (called from game.js handleRightDrag)
     * @param {number} deltaX - Horizontal mouse movement
     * @param {number} deltaY - Vertical mouse movement
     */
    handleLook(deltaX, deltaY) {
        if (this.mode === 'first-person') {
            // Update pitch (vertical look) with clamping
            const pitchSpeed = 0.002;
            this.firstPersonPitch -= deltaY * pitchSpeed;
            this.firstPersonPitch = Math.max(this.minPitch, Math.min(this.maxPitch, this.firstPersonPitch));
        }
    }
    
    /**
     * Update camera position - call each frame
     * @param {number} deltaTime 
     */
    update(deltaTime) {
        const heroPos = this.hero.position.clone();
        
        switch (this.mode) {
            case 'orbit':
                // Current behavior: orbit target follows hero
                this.updateOrbitMode(heroPos);
                break;
                
            case 'follow':
                this.updateFollowMode(heroPos, deltaTime);
                break;
                
            case 'first-person':
                this.updateFirstPersonMode(heroPos);
                break;
        }
    }
    
    updateOrbitMode(heroPos) {
        // Move camera with hero (current game behavior)
        const delta = heroPos.clone().sub(this.controls.target);
        this.controls.target.copy(heroPos);
        this.camera.position.add(delta);
    }
    
    updateFollowMode(heroPos, deltaTime) {
        // Calculate ideal camera position behind hero
        const heroRotation = this.hero.rotation;
        
        const idealOffset = new THREE.Vector3(
            -Math.sin(heroRotation) * this.followDistance,
            this.followHeight,
            -Math.cos(heroRotation) * this.followDistance
        );
        
        const idealPosition = heroPos.clone().add(idealOffset);
        
        // Smoothly interpolate camera position
        const lerpFactor = 1 - Math.exp(-this.followLerpSpeed * deltaTime);
        this.camera.position.lerp(idealPosition, lerpFactor);
        
        // Look at hero
        this.controls.target.copy(heroPos);
        this.controls.target.y += 1.5; // Look at upper body
    }
    
    updateFirstPersonMode(heroPos) {
        // Position camera at hero's eye level
        const eyePos = heroPos.clone();
        eyePos.y += this.firstPersonHeight;
        
        // Set camera position at eye level
        this.camera.position.copy(eyePos);
        
        // Calculate look direction from hero yaw and camera pitch
        const yaw = this.hero.rotation;
        const pitch = this.firstPersonPitch;
        
        // Spherical to Cartesian conversion
        const lookDir = new THREE.Vector3(
            Math.sin(yaw) * Math.cos(pitch),
            Math.sin(pitch),
            Math.cos(yaw) * Math.cos(pitch)
        );
        
        // Point camera in that direction
        const target = eyePos.clone().add(lookDir);
        this.camera.lookAt(target);
    }
    
    destroy() {
        if (this.container) {
            this.container.remove();
        }
    }
}