/**
 * Noise Generation Utilities
 * 
 * Reusable noise functions for procedural generation
 * Currently uses simple hash-based noise, could be extended with Perlin/Simplex
 */

/**
 * Simple pseudo-random hash function
 * @param {number} x - X coordinate
 * @param {number} z - Z coordinate
 * @param {number} seed - Random seed
 * @returns {number} Hash value (0-1)
 */
export function hash(x, z, seed = 12345) {
    let h = seed + x * 374761393 + z * 668265263;
    h = (h ^ (h >> 13)) * 1274126177;
    return ((h ^ (h >> 16)) & 0xffffffff) / 0xffffffff;
}

/**
 * Secondary hash for different noise layers
 * @param {number} x - X coordinate
 * @param {number} z - Z coordinate
 * @param {number} seed - Random seed
 * @returns {number} Hash value (0-1)
 */
export function hash2(x, z, seed = 12345) {
    let h = (seed * 7919) + x * 668265263 + z * 374761393;
    h = (h ^ (h >> 13)) * 1274126177;
    return ((h ^ (h >> 16)) & 0xffffffff) / 0xffffffff;
}

/**
 * Perlin-like noise (simplified)
 * @param {number} x - X coordinate
 * @param {number} z - Z coordinate
 * @param {function} hashFn - Hash function to use
 * @returns {number} Noise value (0-1)
 */
export function noise2D(x, z, hashFn = hash) {
    const X = Math.floor(x);
    const Z = Math.floor(z);
    
    const fx = x - X;
    const fz = z - Z;
    
    // Smooth interpolation (smoothstep)
    const u = fx * fx * (3.0 - 2.0 * fx);
    const v = fz * fz * (3.0 - 2.0 * fz);
    
    // Hash corner values
    const a = hashFn(X, Z);
    const b = hashFn(X + 1, Z);
    const c = hashFn(X, Z + 1);
    const d = hashFn(X + 1, Z + 1);
    
    // Bilinear interpolation
    return a * (1 - u) * (1 - v) +
           b * u * (1 - v) +
           c * (1 - u) * v +
           d * u * v;
}

/**
 * Octave noise for more natural variation
 * @param {number} x - X coordinate
 * @param {number} z - Z coordinate
 * @param {number} octaves - Number of octaves
 * @param {number} baseFreq - Base frequency
 * @param {function} hashFn - Hash function to use
 * @returns {number} Noise value (0-1)
 */
export function octaveNoise2D(x, z, octaves = 4, baseFreq = 0.05, hashFn = hash) {
    let total = 0;
    let frequency = baseFreq;
    let amplitude = 1;
    let maxValue = 0;
    
    for (let i = 0; i < octaves; i++) {
        total += noise2D(x * frequency, z * frequency, hashFn) * amplitude;
        maxValue += amplitude;
        amplitude *= 0.5;
        frequency *= 2;
    }
    
    return total / maxValue;
}

/**
 * Create a noise generator with a specific seed
 * @param {number} seed - Random seed
 * @returns {Object} Noise generator functions bound to seed
 */
export function createNoiseGenerator(seed) {
    return {
        hash: (x, z) => hash(x, z, seed),
        hash2: (x, z) => hash2(x, z, seed),
        noise2D: (x, z, hashFn) => noise2D(x, z, hashFn || ((x, z) => hash(x, z, seed))),
        octaveNoise2D: (x, z, octaves, baseFreq, hashFn) => 
            octaveNoise2D(x, z, octaves, baseFreq, hashFn || ((x, z) => hash(x, z, seed)))
    };
}