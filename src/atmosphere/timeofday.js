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
        this.timeOfDay = 0;      // 0-600 seconds (0 = dawn)
        
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

        // Sun sphere - 3D geometry with unlit material
        // fog: false ensures sun stays visible against sky at any distance
        const geometry = new THREE.SphereGeometry(20, 16, 16);
        const material = new THREE.MeshBasicMaterial({ color: 0xFFDD44, fog: false });
        const sunMesh = new THREE.Mesh(geometry, material);
        sunGroup.add(sunMesh);

        // Glow sprite - additive blending for halo effect
        // Renders behind sun using renderOrder (no Z offset needed)
        const glowSprite = this.createGlowSprite(0xFFDD44, 120, true);
        glowSprite.renderOrder = -1;
        sunGroup.add(glowSprite);

        // Store references for color updates
        sunGroup.userData.mesh = sunMesh;
        sunGroup.userData.geometry = geometry;
        sunGroup.userData.material = material;
        sunGroup.userData.glowSprite = glowSprite;

        return sunGroup;
    }
    
    /**
     * Create a glow sprite with radial gradient for halo effect
     * @param {number} color - Hex color for the glow
     * @param {number} size - Size of the sprite
     * @param {boolean} hollowCenter - If true, center is transparent (for sun)
     * @returns {THREE.Sprite} Glow sprite with additive blending
     */
    createGlowSprite(color, size, hollowCenter = false) {
        const canvas = document.createElement('canvas');
        canvas.width = 128;
        canvas.height = 128;
        const ctx = canvas.getContext('2d');

        // Create radial gradient
        const gradient = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
        const c = new THREE.Color(color);
        const rgb = `${Math.floor(c.r * 255)}, ${Math.floor(c.g * 255)}, ${Math.floor(c.b * 255)}`;

        if (hollowCenter) {
            // Hollow center for sun - glow only on outer ring
            gradient.addColorStop(0, 'rgba(0, 0, 0, 0)');
            gradient.addColorStop(0.15, 'rgba(0, 0, 0, 0)');
            gradient.addColorStop(0.3, `rgba(${rgb}, 0.5)`);
            gradient.addColorStop(0.5, `rgba(${rgb}, 0.3)`);
            gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
        } else {
            // Solid center for moon
            gradient.addColorStop(0, `rgba(${rgb}, 0.6)`);
            gradient.addColorStop(0.3, `rgba(${rgb}, 0.3)`);
            gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
        }

        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, 128, 128);

        const texture = new THREE.CanvasTexture(canvas);
        const material = new THREE.SpriteMaterial({
            map: texture,
            transparent: true,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            fog: false
        });

        const sprite = new THREE.Sprite(material);
        sprite.scale.set(size, size, 1);

        // Store for disposal
        sprite.userData.texture = texture;
        sprite.userData.canvas = canvas;

        return sprite;
    }

    createMoon() {
        const moonGroup = new THREE.Group();

        // Glow sprite - additive blending for moonlight halo
        // Larger and brighter than before for visible cold glow
        const glowSprite = this.createGlowSprite(0xCCCCDD, 100);
        moonGroup.add(glowSprite);

        // Main moon sphere - pale white/grey
        // fog: false ensures moon stays visible against night sky
        const moonGeometry = new THREE.SphereGeometry(18, 16, 16);
        const moonMaterial = new THREE.MeshBasicMaterial({ color: 0xDDDDDD, fog: false });
        const moonMesh = new THREE.Mesh(moonGeometry, moonMaterial);
        moonGroup.add(moonMesh);

        // Shadow sphere for crescent effect - dark, slightly larger
        const shadowGeometry = new THREE.SphereGeometry(19, 16, 16);
        const shadowMaterial = new THREE.MeshBasicMaterial({ color: 0x0A0A1E, fog: false });
        const shadowMesh = new THREE.Mesh(shadowGeometry, shadowMaterial);
        moonGroup.add(shadowMesh);

        // Store references for phase updates
        moonGroup.userData.moonMesh = moonMesh;
        moonGroup.userData.moonGeometry = moonGeometry;
        moonGroup.userData.moonMaterial = moonMaterial;
        moonGroup.userData.shadowMesh = shadowMesh;
        moonGroup.userData.shadowGeometry = shadowGeometry;
        moonGroup.userData.shadowMaterial = shadowMaterial;
        moonGroup.userData.glowSprite = glowSprite;

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
     * Get the current active celestial body position (sun during day, moon at night)
     * @returns {THREE.Vector3} Position of the active celestial body
     */
    getCelestialPosition() {
        const { phase } = this.getCurrentPhase();
        if (phase === 'day') {
            return this.sun.position.clone();
        } else {
            return this.moon.position.clone();
        }
    }

    /**
     * Update sun color based on angle (sunrise/noon/sunset)
     */
    updateSunColor(sunAngleDegrees) {
        const material = this.sun.userData.material;
        const glowSprite = this.sun.userData.glowSprite;

        if (sunAngleDegrees < 30 || sunAngleDegrees > 150) {
            // Sunrise/sunset - orange/red
            const blend = sunAngleDegrees < 30
                ? sunAngleDegrees / 30
                : (180 - sunAngleDegrees) / 30;
            const r = 1.0;
            const g = (100 + blend * 155) / 255;
            const b = 0;
            material.color.setRGB(r, g, b);
            // Update glow to match
            if (glowSprite) {
                glowSprite.material.color.setRGB(r, g, b);
            }
        } else {
            // Daytime - bright yellow
            material.color.setHex(0xFFDD44);
            if (glowSprite) {
                glowSprite.material.color.setHex(0xFFDD44);
            }
        }
    }
    
    /**
     * Update moon phase (crescent to full and back)
     */
    updateMoonPhase(nightProgress) {
        const shadowMesh = this.moon.userData.shadowMesh;
        const shadowMaterial = this.moon.userData.shadowMaterial;
        const moonMaterial = this.moon.userData.moonMaterial;
        const glowSprite = this.moon.userData.glowSprite;

        // Full moon at midnight (0.5), crescent at dusk/dawn (0, 1)
        const phaseOffset = Math.abs(nightProgress - 0.5) * 2;

        // Offset shadow sphere to create crescent effect
        // At full moon (phaseOffset = 0): shadow behind moon (not visible)
        // At crescent (phaseOffset = 1): shadow offset to side, occluding moon
        const maxOffset = 25; // Maximum X offset for shadow sphere
        shadowMesh.position.x = -maxOffset * phaseOffset;
        shadowMesh.position.z = phaseOffset < 0.1 ? -5 : 0; // Push behind at full moon

        // Color transition: match lighting presets (10% dusk, 80% night, 10% dawn)
        // colorBlend: 0 = dusk/dawn colors, 1 = night colors
        let colorBlend;
        if (nightProgress < 0.1) {
            // Dusk transition (first 10% of night)
            colorBlend = nightProgress / 0.1;
        } else if (nightProgress > 0.9) {
            // Dawn transition (last 10% of night)
            colorBlend = (1 - nightProgress) / 0.1;
        } else {
            // Full night
            colorBlend = 1;
        }

        // Blend moon color from warm tint (dusk/dawn) to pale white (night)
        const duskMoon = new THREE.Color(0xDDAAAA); // Warm pinkish
        const nightMoon = new THREE.Color(0xEEEEEE); // Pale white
        moonMaterial.color.copy(duskMoon).lerp(nightMoon, colorBlend);

        // Blend shadow color from reddish-orange (dusk/dawn) to dark blue (night)
        const duskShadow = new THREE.Color(0x8B3A1A); // Dark orange-red
        const nightShadow = new THREE.Color(0x0A0A1E); // Dark blue
        shadowMaterial.color.copy(duskShadow).lerp(nightShadow, colorBlend);

        // Blend glow color from warm (dusk/dawn) to cool white (night)
        if (glowSprite) {
            const duskGlow = new THREE.Color(0xAA8866); // Warm glow
            const nightGlow = new THREE.Color(0xCCCCDD); // Cool white glow
            glowSprite.material.color.copy(duskGlow).lerp(nightGlow, colorBlend);
        }
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
     * Dispose a glow sprite and its resources
     */
    disposeGlowSprite(sprite) {
        if (sprite) {
            if (sprite.userData.texture) {
                sprite.userData.texture.dispose();
            }
            if (sprite.material) {
                sprite.material.dispose();
            }
        }
    }

    /**
     * Clean up resources
     */
    dispose() {
        this.scene.remove(this.sun);
        this.scene.remove(this.moon);

        // Dispose sun resources
        if (this.sun.userData.geometry) {
            this.sun.userData.geometry.dispose();
        }
        if (this.sun.userData.material) {
            this.sun.userData.material.dispose();
        }
        this.disposeGlowSprite(this.sun.userData.glowSprite);

        // Dispose moon resources
        if (this.moon.userData.moonGeometry) {
            this.moon.userData.moonGeometry.dispose();
        }
        if (this.moon.userData.moonMaterial) {
            this.moon.userData.moonMaterial.dispose();
        }
        this.disposeGlowSprite(this.moon.userData.glowSprite);
        if (this.moon.userData.shadowGeometry) {
            this.moon.userData.shadowGeometry.dispose();
        }
        if (this.moon.userData.shadowMaterial) {
            this.moon.userData.shadowMaterial.dispose();
        }
    }
}