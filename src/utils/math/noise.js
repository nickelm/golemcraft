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
 * Ridged multifractal noise - produces sharp ridges
 * @param {number} x - X coordinate
 * @param {number} z - Z coordinate
 * @param {number} octaves - Number of octaves
 * @param {number} frequency - Starting frequency
 * @param {number} persistence - Amplitude falloff per octave (typically 0.5)
 * @param {number} lacunarity - Frequency multiplier per octave (typically 2.0)
 * @param {function} hashFn - Hash function to use
 * @returns {number} Noise value (0-1)
 */
export function ridgedNoise2D(x, z, octaves, frequency, persistence, lacunarity, hashFn = hash) {
    let total = 0;
    let amplitude = 1;
    let weight = 1;
    let maxValue = 0;

    for (let i = 0; i < octaves; i++) {
        // Sample noise at current frequency
        const noise = noise2D(x * frequency, z * frequency, hashFn);

        // Take absolute value and invert to create ridges
        // Converts [0,1] to [-1,1], takes abs, then inverts
        let ridge = 1.0 - Math.abs(noise * 2.0 - 1.0);

        // Weight by previous ridge value (creates sharper ridges where ridges exist)
        ridge *= weight;

        // Accumulate with current amplitude
        total += ridge * amplitude;
        maxValue += amplitude;

        // Update weight for next octave (clamped to max 1.0)
        weight = Math.min(ridge * 2.0, 1.0);

        // Update amplitude and frequency for next octave
        amplitude *= persistence;
        frequency *= lacunarity;
    }

    // Return normalized to [0, 1]
    return total / maxValue;
}

/**
 * Domain-warped noise: samples noise at coordinates offset by another noise field
 * Creates swirling, organic patterns by displacing sample coordinates
 * @param {number} x - X coordinate
 * @param {number} z - Z coordinate
 * @param {number} octaves - Number of noise layers for main noise
 * @param {number} frequency - Base frequency for main noise
 * @param {number} warpStrength - Displacement magnitude (20-50 typical)
 * @param {function} hashFn - Hash function to use
 * @returns {number} - Noise value (0-1)
 */
export function warpedNoise2D(x, z, octaves, frequency, warpStrength, hashFn = hash) {
    // Sample two offset noise fields for warp displacement
    // Offset by 500 to ensure different regions of noise space
    const warpX = octaveNoise2D(x + 500, z, 2, frequency * 0.5, hashFn);
    const warpZ = octaveNoise2D(x, z + 500, 2, frequency * 0.5, hashFn);

    // Displace sample coordinates
    // (warpX - 0.5) * 2 centers the warp around zero
    const newX = x + (warpX - 0.5) * 2 * warpStrength;
    const newZ = z + (warpZ - 0.5) * 2 * warpStrength;

    // Sample main noise at warped coordinates
    return octaveNoise2D(newX, newZ, octaves, frequency, hashFn);
}

/**
 * Create a noise generator with a specific seed
 * @param {number} seed - Random seed
 * @returns {Object} Noise generator functions bound to seed
 */
export function createNoiseGenerator(seed) {
    const boundHash = (x, z) => hash(x, z, seed);
    return {
        hash: (x, z) => hash(x, z, seed),
        hash2: (x, z) => hash2(x, z, seed),
        noise2D: (x, z, hashFn) => noise2D(x, z, hashFn || boundHash),
        octaveNoise2D: (x, z, octaves, baseFreq, hashFn) =>
            octaveNoise2D(x, z, octaves, baseFreq, hashFn || boundHash),
        ridgedNoise2D: (x, z, octaves, frequency, persistence, lacunarity, hashFn) =>
            ridgedNoise2D(x, z, octaves, frequency, persistence, lacunarity, hashFn || boundHash),
        warpedNoise2D: (x, z, octaves, frequency, warpStrength, hashFn) =>
            warpedNoise2D(x, z, octaves, frequency, warpStrength, hashFn || boundHash)
    };
}

// Test ridged noise - uncomment to verify ridge patterns
// Expected: values cluster near 0 and 1, with sharp transitions
/*
console.log('Ridged Noise Test:');
const testCoords = [[0, 0], [5.5, 5.5], [10, 10], [15.7, 3.2]];
testCoords.forEach(([x, z]) => {
    const value = ridgedNoise2D(x, z, 4, 0.1, 0.5, 2.0);
    console.log(`  (${x}, ${z}) => ${value.toFixed(4)}`);
});
*/