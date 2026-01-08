/**
 * Texture Registry
 *
 * Central registry mapping texture names to integer layer indices (0-7)
 * and providing file path manifests for diffuse and normal maps.
 *
 * Pure functions only - worker-thread compatible.
 * No Three.js or DOM dependencies.
 */

// Texture name → layer index mapping (0-7)
// This ordering is deterministic and matches future texture array layers
export const TEXTURE_LAYERS = {
    grass: 0,
    forest_floor: 1,
    dirt: 2,
    sand: 3,
    rock: 4,
    snow: 5,
    ice: 6,
    pebbles: 7
};

// Diffuse texture paths (1024×1024 resolution)
// Array index corresponds to layer index
// Paths are relative to public/ directory
export const DIFFUSE_PATHS = [
    'textures/terrain/diffuse/grass_diff_1k.jpg',         // Layer 0
    'textures/terrain/diffuse/forest_floor_diff_1k.jpg',  // Layer 1
    'textures/terrain/diffuse/dirt_diff_1k.jpg',          // Layer 2
    'textures/terrain/diffuse/sand_diff_1k.jpg',          // Layer 3
    'textures/terrain/diffuse/rock_diff_1k.jpg',          // Layer 4
    'textures/terrain/diffuse/snow_diff_1k.jpg',          // Layer 5
    'textures/terrain/diffuse/ice_diff_1k.jpg',           // Layer 6
    'textures/terrain/diffuse/pebbles_diff_1k.jpg'        // Layer 7
];

// Normal map paths (512×512 resolution, downscaled from 1K)
// Array index corresponds to layer index
// Paths are relative to public/ directory
export const NORMAL_PATHS = [
    'textures/terrain/normal/grass_nor_512.jpg',          // Layer 0
    'textures/terrain/normal/forest_floor_nor_512.jpg',   // Layer 1
    'textures/terrain/normal/dirt_nor_512.jpg',           // Layer 2
    'textures/terrain/normal/sand_nor_512.jpg',           // Layer 3
    'textures/terrain/normal/rock_nor_512.jpg',           // Layer 4
    'textures/terrain/normal/snow_nor_512.jpg',           // Layer 5
    'textures/terrain/normal/ice_nor_512.jpg',            // Layer 6
    'textures/terrain/normal/pebbles_nor_512.jpg'         // Layer 7
];

/**
 * Get the layer index for a texture name
 * @param {string} textureName - Name of the texture (e.g., 'grass', 'rock')
 * @returns {number} Layer index (0-7), or -1 if not found
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
           layerCount === NORMAL_PATHS.length &&
           layerCount === 8;
}
