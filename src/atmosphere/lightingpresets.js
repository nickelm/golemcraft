import * as THREE from 'three';

/**
 * LightingPresets - Defines and interpolates lighting configurations for different times of day
 * 
 * Handles:
 * - Preset definitions (sunrise, day, sunset, night)
 * - Color and intensity interpolation between presets
 * - Smooth transitions during dawn/dusk
 * 
 * TUNING NOTES:
 * - Day ambient + directional should sum to ~0.9-1.0 for natural lighting
 * - Higher values cause overbright surfaces (especially snow)
 * - Shader now clamps irradiance, but keeping presets balanced is still good practice
 */

/**
 * Lighting preset definitions
 * 
 * Previous values caused overbright (ambient 0.6 + directional 0.8 = 1.4):
 * - Reduced ambient from 0.6 → 0.5
 * - Reduced directional from 0.8 → 0.5
 * - Total irradiance on lit surfaces: ~1.0 (clamped by shader)
 */
export const PRESETS = {
    sunrise: {
        ambient: { color: 0xffaa66, intensity: 0.35 },
        directional: { color: 0xff8844, intensity: 0.45 },
        sky: 0xff7744,
        fog: 0xffaa88,
        torch: 2.0
    },
    day: {
        ambient: { color: 0xffffff, intensity: 0.5 },
        directional: { color: 0xffffff, intensity: 0.5 },
        sky: 0x87ceeb,
        fog: 0x87ceeb,
        torch: 0
    },
    sunset: {
        ambient: { color: 0xffa366, intensity: 0.35 },
        directional: { color: 0xff7733, intensity: 0.5 },
        sky: 0xff6b35,
        fog: 0xd4a574,
        torch: 1.0
    },
    night: {
        ambient: { color: 0x1a1a2e, intensity: 0.08 },
        directional: { color: 0x4466aa, intensity: 0.05 },
        sky: 0x0a0a1a,
        fog: 0x0a0a1a,
        torch: 6.0
    }
};

/**
 * Get a specific preset by name
 */
export function getPreset(name) {
    return PRESETS[name];
}

/**
 * Interpolate between two color values
 */
function lerpColor(color1, color2, t) {
    const c1 = new THREE.Color(color1);
    const c2 = new THREE.Color(color2);
    return c1.lerp(c2, t).getHex();
}

/**
 * Linear interpolate between two numbers
 */
function lerp(a, b, t) {
    return a + (b - a) * t;
}

/**
 * Interpolate between two lighting presets
 * @param {string} preset1Name - Name of first preset
 * @param {string} preset2Name - Name of second preset
 * @param {number} t - Interpolation factor (0-1)
 * @returns {Object} Interpolated preset
 */
export function lerpPresets(preset1Name, preset2Name, t) {
    const p1 = PRESETS[preset1Name];
    const p2 = PRESETS[preset2Name];
    
    return {
        ambient: {
            color: lerpColor(p1.ambient.color, p2.ambient.color, t),
            intensity: lerp(p1.ambient.intensity, p2.ambient.intensity, t)
        },
        directional: {
            color: lerpColor(p1.directional.color, p2.directional.color, t),
            intensity: lerp(p1.directional.intensity, p2.directional.intensity, t)
        },
        sky: lerpColor(p1.sky, p2.sky, t),
        fog: lerpColor(p1.fog, p2.fog, t),
        torch: lerp(p1.torch, p2.torch, t)
    };
}

/**
 * Calculate which preset to use based on phase and progress
 * Handles smooth transitions at sunrise/sunset
 * @param {string} phase - 'day' or 'night'
 * @param {number} phaseProgress - Progress through phase (0-1)
 * @returns {Object} Calculated preset
 */
export function calculatePreset(phase, phaseProgress) {
    if (phase === 'day') {
        // Day transitions: sunrise -> day -> sunset
        if (phaseProgress < 0.1) {
            // Sunrise (first 10% of day)
            const t = phaseProgress / 0.1;
            return lerpPresets('sunrise', 'day', t);
        } else if (phaseProgress > 0.9) {
            // Sunset (last 10% of day)
            const t = (phaseProgress - 0.9) / 0.1;
            return lerpPresets('day', 'sunset', t);
        } else {
            // Full day
            return getPreset('day');
        }
    } else {
        // Night transitions: dusk -> night -> dawn
        if (phaseProgress < 0.1) {
            // Dusk (first 10% of night)
            const t = phaseProgress / 0.1;
            return lerpPresets('sunset', 'night', t);
        } else if (phaseProgress > 0.9) {
            // Dawn (last 10% of night)
            const t = (phaseProgress - 0.9) / 0.1;
            return lerpPresets('night', 'sunrise', t);
        } else {
            // Full night
            return getPreset('night');
        }
    }
}

/**
 * Apply a lighting preset to Three.js scene lights
 * @param {Object} preset - Preset to apply
 * @param {THREE.AmbientLight} ambientLight - Ambient light to update
 * @param {THREE.DirectionalLight} directionalLight - Directional light to update
 * @param {THREE.PointLight} torchLight - Torch point light to update
 * @param {THREE.Scene} scene - Scene to update (background, fog)
 * @param {boolean} torchEnabled - Whether torch should be active
 */
export function applyPreset(preset, ambientLight, directionalLight, torchLight, scene, torchEnabled = true) {
    // Update ambient light
    ambientLight.color.setHex(preset.ambient.color);
    ambientLight.intensity = preset.ambient.intensity;
    
    // Update directional light
    directionalLight.color.setHex(preset.directional.color);
    directionalLight.intensity = preset.directional.intensity;
    
    // Update torch (respects toggle state)
    torchLight.intensity = torchEnabled ? preset.torch : 0;
    
    // Update scene background and fog
    scene.background.setHex(preset.sky);
    scene.fog.color.setHex(preset.fog);
}