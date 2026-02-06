import * as THREE from 'three';
import { TimeOfDay } from './timeofday.js';
import { calculatePreset, applyPreset } from './lightingpresets.js';
import { Weather } from './weather.js';
import { SkyDome } from './skydome.js';

/**
 * AtmosphereController - Orchestrates all atmospheric systems
 * 
 * Manages:
 * - Day/night cycle
 * - Lighting transitions
 * - Weather effects
 * - Torch system
 * - Future: Zone-specific atmosphere overrides
 */
export class AtmosphereController {
    constructor(scene, isMobile = false) {
        this.scene = scene;
        this.isMobile = isMobile;
        
        // Create lighting
        this.ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
        this.scene.add(this.ambientLight);
        
        this.directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
        this.directionalLight.position.set(50, 100, 50);
        this.directionalLight.castShadow = !isMobile;
        this.directionalLight.shadow.camera.left = -40;
        this.directionalLight.shadow.camera.right = 40;
        this.directionalLight.shadow.camera.top = 40;
        this.directionalLight.shadow.camera.bottom = -40;
        this.directionalLight.shadow.mapSize.width = 2048;
        this.directionalLight.shadow.mapSize.height = 2048;
        this.scene.add(this.directionalLight);
        
        // Torch (point light following hero)
        // Start with small non-zero intensity to ensure shaders are compiled with point light support
        // The actual intensity will be set by lighting presets
        // Parameters: color, intensity, distance (falloff range), decay (falloff curve)
        // Distance 10 = ~10m effective range, decay 2 = quadratic falloff (realistic)
        this.torchLight = new THREE.PointLight(0xffd478, 0.001, 10, 2);
        this.torchLight.castShadow = false;
        this.scene.add(this.torchLight);
        this.torchEnabled = false;  // Default to off
        
        // Systems
        this.timeOfDay = new TimeOfDay(scene);
        this.weather = new Weather(scene);
        this.skyDome = new SkyDome(scene);

        // Sky dome replaces scene.background — no flat color underneath
        this.scene.background = null;

        // Adaptive fog for chunk loading
        this.baseFogNear = null;   // Set during init
        this.baseFogFar = null;    // Set during init
        this.currentFogFar = null;
        this.chunkLoader = null;   // Will be set by Game

        // UI element for torch toggle
        this.torchButton = null;
        this.createTorchToggle();
    }
    
    /**
     * Update all atmosphere systems
     * @param {number} deltaTime - Time elapsed in seconds
     * @param {THREE.Vector3} heroPosition - Hero position for following lights
     * @param {number} heroRotation - Hero rotation for torch positioning
     * @param {Object} biomeData - Current biome (for future weather)
     */
    update(deltaTime, heroPosition, heroRotation, biomeData = null) {
        // Update time of day and get phase
        const { phase, phaseProgress, timeOfDay } = this.timeOfDay.update(deltaTime, heroPosition);
        
        // Calculate and apply lighting preset
        const preset = calculatePreset(phase, phaseProgress);
        applyPreset(
            preset,
            this.ambientLight,
            this.directionalLight,
            this.torchLight,
            this.scene,
            this.torchEnabled
        );
        
        // Update sky dome gradient colors and position
        this.skyDome.update(preset);
        this.skyDome.followCamera(heroPosition);

        // Update weather (stub for now)
        this.weather.update(deltaTime, biomeData);

        // Position directional light at celestial body to create realistic shadow direction
        const celestialPos = this.timeOfDay.getCelestialPosition();
        this.directionalLight.position.copy(celestialPos);
        this.directionalLight.target.position.copy(heroPosition);
        this.directionalLight.target.updateMatrixWorld();
        
        // Torch follows hero (positioned above and slightly in front)
        this.torchLight.position.set(
            heroPosition.x + Math.sin(heroRotation) * 0.5,
            heroPosition.y + 3,
            heroPosition.z + Math.cos(heroRotation) * 0.5
        );

        // Update adaptive fog based on chunk loading state
        if (this.chunkLoader) {
            const recommendedFogFar = this.chunkLoader.getRecommendedFogDistance(heroPosition);

            // Clamp to reasonable range (never below base near, never above base far)
            const minFogFar = Math.max(this.baseFogNear + 20, this.baseFogFar * 0.3);
            const maxFogFar = this.baseFogFar;
            const targetFogFar = Math.max(minFogFar, Math.min(maxFogFar, recommendedFogFar));

            // Smooth interpolation (very fast contract when loading, slow expand when ready)
            const lerpSpeed = targetFogFar < this.currentFogFar ? 0.3 : 0.03;
            this.currentFogFar += (targetFogFar - this.currentFogFar) * lerpSpeed;

            // Apply to scene fog - scale near proportionally with far
            // Keep the same near/far ratio as the base fog settings
            const fogRatio = this.baseFogNear / this.baseFogFar;
            this.scene.fog.near = this.currentFogFar * fogRatio;
            this.scene.fog.far = this.currentFogFar;
        }

        return { phase, phaseProgress, timeOfDay };
    }

    /**
     * Initialize fog adaptation system
     * @param {number} fogNear - Base fog near distance
     * @param {number} fogFar - Base fog far distance
     * @param {ChunkLoader} chunkLoader - Reference to chunk loader
     */
    initFogAdaptation(fogNear, fogFar, chunkLoader) {
        this.baseFogNear = fogNear;
        this.baseFogFar = fogFar;
        this.chunkLoader = chunkLoader;

        // Start at minimum fog distance - will expand as chunks load
        this.currentFogFar = fogNear + 20;
        this.scene.fog.far = this.currentFogFar;
    }

    /**
     * Toggle torch on/off
     */
    toggleTorch() {
        this.torchEnabled = !this.torchEnabled;
        this.updateTorchButton();
    }
    
    /**
     * Set torch state
     */
    setTorchEnabled(enabled) {
        this.torchEnabled = enabled;
        this.updateTorchButton();
    }
    
    /**
     * Create torch toggle UI button
     */
    createTorchToggle() {
        const btn = document.createElement('button');
        btn.id = 'torch-toggle';
        btn.style.cssText = `
            position: absolute;
            top: 60px;
            right: 10px;
            padding: 8px 12px;
            background: rgba(180, 100, 0, 0.8);
            color: white;
            border: 2px solid rgba(255, 180, 100, 0.8);
            border-radius: 4px;
            cursor: pointer;
            font-family: monospace;
            font-size: 12px;
            transition: all 0.2s;
            z-index: 1000;
        `;
        btn.textContent = '🔦 Torch ON [T]';
        
        btn.addEventListener('click', () => this.toggleTorch());
        document.body.appendChild(btn);
        this.torchButton = btn;
        
        // Keyboard shortcut
        window.addEventListener('keydown', (e) => {
            if (e.key.toLowerCase() === 't') {
                this.toggleTorch();
            }
        });
    }
    
    /**
     * Update torch button appearance
     */
    updateTorchButton() {
        if (!this.torchButton) return;
        
        if (this.torchEnabled) {
            this.torchButton.textContent = '🔦 Torch ON [T]';
            this.torchButton.style.background = 'rgba(180, 100, 0, 0.8)';
            this.torchButton.style.borderColor = 'rgba(255, 180, 100, 0.8)';
        } else {
            this.torchButton.textContent = '🔦 Torch OFF [T]';
            this.torchButton.style.background = 'rgba(0, 0, 0, 0.6)';
            this.torchButton.style.borderColor = 'rgba(255, 255, 255, 0.3)';
        }
    }
    
    /**
     * Set time of day (for loading saved games)
     */
    setTime(timeOfDay) {
        this.timeOfDay.setTime(timeOfDay);
    }
    
    /**
     * Get current time of day (for saving)
     */
    getTime() {
        return this.timeOfDay.getTime();
    }
    
    /**
     * Set weather (for zone-specific or scripted weather)
     */
    setWeather(type, intensity = 1.0) {
        this.weather.setWeather(type, intensity);
    }
    
    /**
     * Get current weather state
     */
    getWeather() {
        return this.weather.getWeather();
    }
    
    /**
     * Clean up resources
     */
    dispose() {
        this.scene.remove(this.ambientLight);
        this.scene.remove(this.directionalLight);
        this.scene.remove(this.torchLight);
        
        this.timeOfDay.dispose();
        this.weather.dispose();
        this.skyDome.dispose();
        
        if (this.torchButton) {
            this.torchButton.remove();
        }
    }
}