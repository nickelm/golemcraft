import * as THREE from 'three';
import { TimeOfDay } from './TimeOfDay.js';
import { calculatePreset, applyPreset } from './LightingPresets.js';
import { Weather } from './Weather.js';

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
        this.torchLight = new THREE.PointLight(0xffd478, 0, 50, 1);
        this.torchLight.castShadow = false;
        this.scene.add(this.torchLight);
        this.torchEnabled = true;
        
        // Systems
        this.timeOfDay = new TimeOfDay(scene);
        this.weather = new Weather(scene);
        
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
        
        // Update weather (stub for now)
        this.weather.update(deltaTime, biomeData);
        
        // Move directional light to follow hero
        this.directionalLight.position.set(
            heroPosition.x + 30,
            heroPosition.y + 80,
            heroPosition.z + 30
        );
        this.directionalLight.target.position.copy(heroPosition);
        this.directionalLight.target.updateMatrixWorld();
        
        // Torch follows hero (positioned above and slightly in front)
        this.torchLight.position.set(
            heroPosition.x + Math.sin(heroRotation) * 0.5,
            heroPosition.y + 3,
            heroPosition.z + Math.cos(heroRotation) * 0.5
        );
        
        return { phase, phaseProgress, timeOfDay };
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
        
        if (this.torchButton) {
            this.torchButton.remove();
        }
    }
}