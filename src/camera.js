import * as THREE from 'three';

/**
 * CameraController - Manages camera modes for the game
 *
 * Modes:
 * - 'follow': Third-person camera behind hero (default)
 *   - Right-drag temporarily orbits camera around hero
 *   - On release, azimuth lerps back to 0 (behind hero)
 *   - Movement while dragging is relative to camera facing
 * - 'first-person': View from hero's eye level with mouselook
 *   - Hides entire hero mesh
 *   - Yaw + pitch controlled via drag
 *
 * OrbitControls is completely disabled - this controller owns all camera state.
 */
export class CameraController {
    constructor(camera, controls, hero, terrainProvider = null) {
        this.camera = camera;
        this.controls = controls;
        this.hero = hero;
        this.terrainProvider = terrainProvider;

        // Completely disable OrbitControls - we manage all camera state
        this.controls.enabled = false;

        this.mode = 'follow';

        // Spherical camera state (relative to hero)
        this.distance = 15;           // Distance from hero
        this.azimuth = 0;             // Horizontal angle (0 = behind hero)
        this.polar = Math.PI / 7;     // Vertical angle (~25 degrees)

        // Follow mode settings
        this.minDistance = 5;
        this.maxDistance = 40;
        this.minPolar = 0.1;          // Minimum polar angle (nearly horizontal)
        this.maxPolar = Math.PI / 2.5; // Maximum polar angle (~72 degrees)

        // Temporary orbit state (for right-drag in follow mode)
        this.isOrbiting = false;
        this.targetAzimuth = 0;       // Lerp target when not orbiting
        this.azimuthLerpSpeed = 3;    // How fast azimuth returns to 0

        // First-person settings
        this.firstPersonPitch = 0;
        this.firstPersonYaw = 0;      // Independent yaw in first-person
        this.maxPitch = Math.PI * 0.44;  // ~80 degrees
        this.minPitch = -Math.PI * 0.44;

        // Camera collision settings
        this.collisionEnabled = true;
        this.collisionMargin = 0.5;   // Distance to keep from terrain
        this.collisionSamples = 8;    // Number of samples along ray

        // Smooth camera positioning
        this.currentCameraPos = new THREE.Vector3();
        this.positionLerpSpeed = 8;

        // Scroll wheel callback (set by game)
        this.onScrollWheel = null;

        // Create UI
        this.createUI();
    }

    /**
     * Set terrain provider for collision detection
     */
    setTerrainProvider(terrainProvider) {
        this.terrainProvider = terrainProvider;
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
            { id: 'follow', label: 'Follow', shortcut: '1' },
            { id: 'first-person', label: 'First Person', shortcut: '2' }
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
            if (e.key === '1') this.setMode('follow');
            if (e.key === '2') this.setMode('first-person');
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

        // Handle hero visibility
        if (mode === 'first-person') {
            // Hide ENTIRE hero mesh in first-person
            this.setHeroVisible(false);

            // Initialize first-person yaw from hero rotation
            this.firstPersonYaw = this.hero.rotation;
            this.firstPersonPitch = 0;
        } else {
            // Show hero in follow mode
            this.setHeroVisible(true);

            // Reset azimuth when switching to follow mode
            this.azimuth = 0;
            this.targetAzimuth = 0;

            // If coming from first-person, sync hero rotation to camera yaw
            if (oldMode === 'first-person') {
                this.hero.rotation = this.firstPersonYaw;
            }
        }

        this.updateButtonStates();
    }

    /**
     * Set visibility of entire hero mesh (not just head)
     */
    setHeroVisible(visible) {
        // Handle mounted hero
        if (this.hero.heroMount && this.hero.heroMount.mesh) {
            this.hero.heroMount.mesh.visible = visible;
        }
        // Handle on-foot hero
        if (this.hero.heroOnFoot && this.hero.heroOnFoot.mesh) {
            this.hero.heroOnFoot.mesh.visible = visible;
        }
    }

    /**
     * Start orbiting (called when right-drag starts in follow mode)
     */
    startOrbit() {
        if (this.mode === 'follow') {
            this.isOrbiting = true;
        }
    }

    /**
     * Stop orbiting (called when right-drag ends)
     * Azimuth will lerp back to 0
     */
    stopOrbit() {
        this.isOrbiting = false;
        this.targetAzimuth = 0;
    }

    /**
     * Handle mouse/touch drag for camera rotation
     * @param {number} deltaX - Horizontal movement
     * @param {number} deltaY - Vertical movement
     */
    handleLook(deltaX, deltaY) {
        const sensitivity = 0.003;

        if (this.mode === 'follow') {
            // In follow mode, drag orbits camera around hero
            this.azimuth += deltaX * sensitivity;
            this.polar += deltaY * sensitivity;

            // Clamp polar angle
            this.polar = Math.max(this.minPolar, Math.min(this.maxPolar, this.polar));
        } else if (this.mode === 'first-person') {
            // In first-person, drag controls yaw and pitch
            this.firstPersonYaw -= deltaX * sensitivity;
            this.firstPersonPitch -= deltaY * sensitivity;

            // Clamp pitch
            this.firstPersonPitch = Math.max(this.minPitch, Math.min(this.maxPitch, this.firstPersonPitch));
        }
    }

    /**
     * Handle scroll wheel for distance adjustment
     * @param {number} delta - Scroll delta (positive = zoom out)
     */
    handleScroll(delta) {
        if (this.mode === 'follow') {
            this.distance += delta * 0.01;
            this.distance = Math.max(this.minDistance, Math.min(this.maxDistance, this.distance));
        }
    }

    /**
     * Get the camera's facing direction (for movement relative to camera)
     * @returns {THREE.Vector3} Normalized direction vector on XZ plane
     */
    getCameraFacingDirection() {
        if (this.mode === 'first-person') {
            // In first-person, use the yaw angle
            return new THREE.Vector3(
                Math.sin(this.firstPersonYaw),
                0,
                Math.cos(this.firstPersonYaw)
            );
        } else {
            // In follow mode, combine hero rotation with azimuth offset
            const angle = this.hero.rotation + this.azimuth;
            return new THREE.Vector3(
                Math.sin(angle),
                0,
                Math.cos(angle)
            );
        }
    }

    /**
     * Check if camera is currently orbiting (for movement behavior)
     */
    isCurrentlyOrbiting() {
        return this.mode === 'follow' && this.isOrbiting;
    }

    /**
     * Update camera position - call each frame
     * @param {number} deltaTime
     */
    update(deltaTime) {
        if (this.mode === 'follow') {
            this.updateFollowMode(deltaTime);
        } else if (this.mode === 'first-person') {
            this.updateFirstPersonMode(deltaTime);
        }
    }

    updateFollowMode(deltaTime) {
        const heroPos = this.hero.position.clone();

        // Lerp azimuth back to 0 when not orbiting
        if (!this.isOrbiting) {
            const lerpFactor = 1 - Math.exp(-this.azimuthLerpSpeed * deltaTime);
            this.azimuth = THREE.MathUtils.lerp(this.azimuth, this.targetAzimuth, lerpFactor);

            // Snap to 0 when close enough
            if (Math.abs(this.azimuth - this.targetAzimuth) < 0.01) {
                this.azimuth = this.targetAzimuth;
            }
        }

        // Adjust height based on mount state
        const heightOffset = this.hero.mounted ? 1.5 : 1.0;
        const targetY = heroPos.y + heightOffset;

        // Calculate camera position using spherical coordinates
        // azimuth is relative to hero facing (0 = behind hero)
        const cameraAngle = this.hero.rotation + this.azimuth + Math.PI; // +PI to be behind

        const idealPosition = new THREE.Vector3(
            heroPos.x + Math.sin(cameraAngle) * this.distance * Math.cos(this.polar),
            targetY + this.distance * Math.sin(this.polar),
            heroPos.z + Math.cos(cameraAngle) * this.distance * Math.cos(this.polar)
        );

        // Apply camera collision
        const collisionAdjustedPosition = this.applyCollision(heroPos, idealPosition);

        // Smooth camera position
        const posLerpFactor = 1 - Math.exp(-this.positionLerpSpeed * deltaTime);
        this.camera.position.lerp(collisionAdjustedPosition, posLerpFactor);

        // Look at hero
        const lookTarget = heroPos.clone();
        lookTarget.y += heightOffset;
        this.camera.lookAt(lookTarget);
    }

    updateFirstPersonMode(deltaTime) {
        // Position camera at hero's eye level
        const heroPos = this.hero.position.clone();
        const eyeHeight = this.hero.getEyeHeight();

        this.camera.position.set(heroPos.x, heroPos.y + eyeHeight, heroPos.z);

        // Calculate look direction from yaw and pitch
        const lookDir = new THREE.Vector3(
            Math.sin(this.firstPersonYaw) * Math.cos(this.firstPersonPitch),
            Math.sin(this.firstPersonPitch),
            Math.cos(this.firstPersonYaw) * Math.cos(this.firstPersonPitch)
        );

        // Set camera rotation
        const target = this.camera.position.clone().add(lookDir);
        this.camera.lookAt(target);

        // Sync hero rotation to first-person yaw so movement is correct
        this.hero.rotation = this.firstPersonYaw;
    }

    /**
     * Apply camera collision to prevent clipping through terrain
     * @param {THREE.Vector3} heroPos - Hero position
     * @param {THREE.Vector3} idealPos - Ideal camera position
     * @returns {THREE.Vector3} Adjusted camera position
     */
    applyCollision(heroPos, idealPos) {
        if (!this.collisionEnabled || !this.terrainProvider) {
            return idealPos;
        }

        // Cast ray from hero toward ideal camera position
        const direction = idealPos.clone().sub(heroPos);
        const totalDistance = direction.length();
        direction.normalize();

        // Sample terrain along the ray
        const sampleInterval = totalDistance / this.collisionSamples;
        let hitDistance = totalDistance;

        for (let i = 1; i <= this.collisionSamples; i++) {
            const sampleDistance = i * sampleInterval;
            const samplePos = heroPos.clone().add(direction.clone().multiplyScalar(sampleDistance));

            // Check terrain height at this position
            const terrainHeight = this.terrainProvider.getGroundHeight(
                Math.floor(samplePos.x),
                Math.floor(samplePos.z)
            );

            // Check if camera would be below terrain
            if (samplePos.y < terrainHeight + this.collisionMargin) {
                hitDistance = Math.max(this.minDistance, sampleDistance - this.collisionMargin);
                break;
            }

            // Check for solid voxels if applicable
            if (this.terrainProvider.isSolid) {
                const blockX = Math.floor(samplePos.x);
                const blockY = Math.floor(samplePos.y);
                const blockZ = Math.floor(samplePos.z);

                if (this.terrainProvider.isSolid(blockX, blockY, blockZ)) {
                    hitDistance = Math.max(this.minDistance, sampleDistance - this.collisionMargin);
                    break;
                }
            }
        }

        // Return adjusted position
        if (hitDistance < totalDistance) {
            return heroPos.clone().add(direction.multiplyScalar(hitDistance));
        }

        return idealPos;
    }

    destroy() {
        if (this.container) {
            this.container.remove();
        }
    }
}
