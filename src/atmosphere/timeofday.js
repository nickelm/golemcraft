import * as THREE from 'three';

/**
 * TimeOfDay - Manages the day/night cycle progression and celestial body positioning
 * 
 * Handles:
 * - Time progression through day/night cycles
 * - Sun and moon positioning in the sky
 * - Sun color changes (sunrise/noon/sunset)
 * - Moon phase changes throughout the night
 */
export class TimeOfDay {
    constructor(scene) {
        this.scene = scene;
        
        // Cycle timing (in seconds)
        this.dayLength = 300;    // 5 minutes
        this.nightLength = 300;  // 5 minutes
        this.cycleLength = this.dayLength + this.nightLength; // 10 minutes total
        this.timeOfDay = 0;      // 0-600 seconds (0 = midnight)
        
        // Celestial bodies
        this.sun = this.createSun();
        this.moon = this.createMoon();
        
        // Exclude from raycasting (layer 1 = celestial objects)
        this.sun.traverse(obj => obj.layers.set(1));
        this.moon.traverse(obj => obj.layers.set(1));
        
        this.scene.add(this.sun);
        this.scene.add(this.moon);
    }
    
    createSun() {
        const sunGroup = new THREE.Group();
        
        // Sun sprite - square facing camera
        const sunSize = 40;
        const canvas = document.createElement('canvas');
        canvas.width = 128;
        canvas.height = 128;
        const ctx = canvas.getContext('2d');
        
        // Draw square sun
        ctx.fillStyle = '#FFFF00';
        ctx.fillRect(16, 16, 96, 96);
        ctx.fillStyle = '#FFDD00';
        ctx.fillRect(32, 32, 64, 64);
        
        const texture = new THREE.CanvasTexture(canvas);
        const material = new THREE.SpriteMaterial({ 
            map: texture,
            transparent: true
        });
        
        const sprite = new THREE.Sprite(material);
        sprite.scale.set(sunSize, sunSize, 1);
        sunGroup.add(sprite);
        
        // Store references for updates
        sunGroup.userData.sprite = sprite;
        sunGroup.userData.canvas = canvas;
        sunGroup.userData.ctx = ctx;
        
        return sunGroup;
    }
    
    createMoon() {
        const moonGroup = new THREE.Group();
        
        // Moon sprite - square with shadow for crescent
        const moonSize = 35;
        const canvas = document.createElement('canvas');
        canvas.width = 128;
        canvas.height = 128;
        const ctx = canvas.getContext('2d');
        
        const texture = new THREE.CanvasTexture(canvas);
        const material = new THREE.SpriteMaterial({ 
            map: texture,
            transparent: true
        });
        
        const sprite = new THREE.Sprite(material);
        sprite.scale.set(moonSize, moonSize, 1);
        moonGroup.add(sprite);
        
        // Store references for moon phase updates
        moonGroup.userData.sprite = sprite;
        moonGroup.userData.canvas = canvas;
        moonGroup.userData.ctx = ctx;
        moonGroup.userData.texture = texture;
        
        return moonGroup;
    }
    
    /**
     * Update time progression and celestial positions
     * @param {number} deltaTime - Time elapsed in seconds
     * @param {THREE.Vector3} referencePosition - Position to orbit around (usually hero)
     */
    update(deltaTime, referencePosition) {
        // Advance time
        this.timeOfDay += deltaTime;
        if (this.timeOfDay >= this.cycleLength) {
            this.timeOfDay -= this.cycleLength;
        }
        
        // Calculate phase
        const { phase, phaseProgress } = this.getCurrentPhase();
        
        // Update celestial positions
        this.updateCelestialBodies(phase, phaseProgress, referencePosition);
        
        return { phase, phaseProgress, timeOfDay: this.timeOfDay };
    }
    
    /**
     * Get current phase (day/night) and progress through it
     */
    getCurrentPhase() {
        if (this.timeOfDay < this.dayLength) {
            return {
                phase: 'day',
                phaseProgress: this.timeOfDay / this.dayLength
            };
        } else {
            return {
                phase: 'night',
                phaseProgress: (this.timeOfDay - this.dayLength) / this.nightLength
            };
        }
    }
    
    /**
     * Update sun and moon positions in sky
     */
    updateCelestialBodies(phase, phaseProgress, referencePosition) {
        const skyRadius = 400;
        
        if (phase === 'day') {
            // Sun arc: rises at east, peaks at zenith, sets at west
            const sunAngle = phaseProgress * Math.PI; // 0 to PI radians
            const sunHeight = Math.sin(sunAngle);     // 0 to 1 to 0
            const sunHorizontal = Math.cos(sunAngle); // 1 to -1
            
            this.sun.position.set(
                referencePosition.x + sunHorizontal * skyRadius,
                referencePosition.y + sunHeight * skyRadius,
                referencePosition.z
            );
            this.sun.visible = true;
            
            // Update sun color
            this.updateSunColor(sunAngle * 180 / Math.PI);
            
            // Hide moon during day
            this.moon.visible = false;
        } else {
            // Night phase - moon rises and sets
            const moonAngle = phaseProgress * Math.PI;
            const moonHeight = Math.sin(moonAngle);
            const moonHorizontal = Math.cos(moonAngle);
            
            this.moon.position.set(
                referencePosition.x + moonHorizontal * skyRadius,
                referencePosition.y + moonHeight * skyRadius,
                referencePosition.z
            );
            this.moon.visible = true;
            
            // Update moon phase
            this.updateMoonPhase(phaseProgress);
            
            // Hide sun at night
            this.sun.visible = false;
        }
    }
    
    /**
     * Update sun color based on angle (sunrise/noon/sunset)
     */
    updateSunColor(sunAngleDegrees) {
        const canvas = this.sun.userData.canvas;
        const ctx = this.sun.userData.ctx;
        
        ctx.clearRect(0, 0, 128, 128);
        
        let color1, color2;
        
        if (sunAngleDegrees < 30 || sunAngleDegrees > 150) {
            // Sunrise/sunset - orange/red
            const blend = sunAngleDegrees < 30 
                ? sunAngleDegrees / 30 
                : (180 - sunAngleDegrees) / 30;
            color1 = `rgb(255, ${Math.floor(100 + blend * 155)}, 0)`;
            color2 = `rgb(255, ${Math.floor(50 + blend * 150)}, 0)`;
        } else {
            // Daytime - yellow
            color1 = '#FFFF00';
            color2 = '#FFDD00';
        }
        
        // Draw square sun
        ctx.fillStyle = color1;
        ctx.fillRect(16, 16, 96, 96);
        ctx.fillStyle = color2;
        ctx.fillRect(32, 32, 64, 64);
        
        this.sun.userData.sprite.material.map.needsUpdate = true;
    }
    
    /**
     * Update moon phase (crescent to full and back)
     */
    updateMoonPhase(nightProgress) {
        const canvas = this.moon.userData.canvas;
        const ctx = this.moon.userData.ctx;
        
        ctx.clearRect(0, 0, 128, 128);
        
        // Full moon at midnight (0.5), crescent at dusk/dawn (0, 1)
        const phaseOffset = Math.abs(nightProgress - 0.5) * 2;
        
        // Draw full moon square
        ctx.fillStyle = '#EEEEEE';
        ctx.fillRect(16, 16, 96, 96);
        ctx.fillStyle = '#CCCCCC';
        ctx.fillRect(32, 32, 64, 64);
        
        // Add shadow for crescent effect
        const shadowWidth = 96 * phaseOffset * 0.7;
        ctx.fillStyle = 'rgba(10, 10, 30, 0.9)';
        ctx.fillRect(16, 16, shadowWidth, 96);
        
        this.moon.userData.texture.needsUpdate = true;
    }
    
    /**
     * Set time of day (for loading saved games)
     */
    setTime(timeOfDay) {
        this.timeOfDay = timeOfDay % this.cycleLength;
    }
    
    /**
     * Get current time of day (for saving)
     */
    getTime() {
        return this.timeOfDay;
    }
    
    /**
     * Clean up resources
     */
    dispose() {
        this.scene.remove(this.sun);
        this.scene.remove(this.moon);
        
        // Dispose sun resources
        if (this.sun.userData.sprite) {
            this.sun.userData.sprite.material.map.dispose();
            this.sun.userData.sprite.material.dispose();
        }
        
        // Dispose moon resources
        if (this.moon.userData.sprite) {
            this.moon.userData.sprite.material.map.dispose();
            this.moon.userData.sprite.material.dispose();
        }
    }
}