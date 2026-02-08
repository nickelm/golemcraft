/**
 * Texture Registry
 *
 * Central registry mapping texture names to integer layer indices (0-8)
 * and providing file path manifests for diffuse textures.
 *
 * Pure functions only - worker-thread compatible.
 * No Three.js or DOM dependencies.
 */

// Texture name → layer index mapping (0-8)
// This ordering is deterministic and matches the texture array layers
export const TEXTURE_LAYERS = {
    grass: 0,
    forest_floor: 1,
    dirt: 2,
    sand: 3,
    rock: 4,
    snow: 5,
    ice: 6,
    gravel: 7,
    water: 8
};

// Diffuse texture paths (128×128 painterly PNGs)
// Array index corresponds to layer index
// Paths are relative to public/ directory
export const DIFFUSE_PATHS = [
    'textures/terrain/grass.png',         // Layer 0
    'textures/terrain/forest_floor.png',  // Layer 1
    'textures/terrain/dirt.png',          // Layer 2
    'textures/terrain/sand.png',          // Layer 3
    'textures/terrain/rock.png',          // Layer 4
    'textures/terrain/snow.png',          // Layer 5
    'textures/terrain/ice.png',           // Layer 6
    'textures/terrain/gravel.png',        // Layer 7
    'textures/terrain/water.png'          // Layer 8
];

/**
 * Get the layer index for a texture name
 * @param {string} textureName - Name of the texture (e.g., 'grass', 'rock')
 * @returns {number} Layer index (0-8), or -1 if not found
 */
export function getTextureLayer(textureName) {
    return TEXTURE_LAYERS[textureName] ?? -1;
}

/**
 * Get all texture names in layer order
 * @returns {string[]} Array of texture names ordered by layer index
 */
export function getTextureNames() {
    return Object.keys(TEXTURE_LAYERS).sort((a, b) => TEXTURE_LAYERS[a] - TEXTURE_LAYERS[b]);
}

/**
 * Validate that all paths and indices are correctly configured
 * @returns {boolean} True if registry is valid
 */
export function validateRegistry() {
    const layerCount = Object.keys(TEXTURE_LAYERS).length;
    return layerCount === DIFFUSE_PATHS.length &&
           layerCount === 9;
}

// Default tint colors for each texture layer (RGB in linear space, 0-1 range)
// These provide subtle artistic control over terrain appearance
export const DEFAULT_TINT_COLORS = [
    [1.0, 1.0, 1.0],      // Layer 0: grass (neutral white)
    [1.0, 1.0, 1.0],      // Layer 1: forest_floor (neutral white)
    [0.95, 0.9, 0.85],    // Layer 2: dirt (slight warm brown tint)
    [1.0, 0.98, 0.92],    // Layer 3: sand (slight warm yellow tint)
    [0.92, 0.92, 0.95],   // Layer 4: rock (slight cool grey tint)
    [1.0, 1.0, 1.0],      // Layer 5: snow (neutral white, already bright)
    [0.9, 0.95, 1.0],     // Layer 6: ice (slight cool blue tint)
    [0.95, 0.95, 0.92],   // Layer 7: gravel (slight warm grey tint)
    [1.0, 1.0, 1.0]       // Layer 8: water (neutral white)
];

/**
 * Get default tint color for a texture layer
 * @param {number} layerIndex - Texture array layer index (0-8)
 * @returns {Array<number>} RGB color [r, g, b] in linear space (0-1)
 */
export function getDefaultTintColor(layerIndex) {
    return DEFAULT_TINT_COLORS[layerIndex] ?? [1.0, 1.0, 1.0];
}
