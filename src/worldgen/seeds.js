/**
 * Seed Utilities Module
 *
 * Provides deterministic seed derivation for procedural world generation.
 * Same inputs will always produce identical outputs across sessions and clients.
 *
 * All functions are pure and worker-compatible (no global state).
 */

// ============================================================================
// CONSTANTS
// ============================================================================

/**
 * Standard generation stage names for consistent seed derivation.
 * Use these constants instead of raw strings to prevent typos.
 */
export const GENERATION_STAGES = {
    SHAPE: 'shape',           // Continent outline and coastlines
    HYDRO: 'hydro',           // Rivers, lakes, watersheds
    CLIMATE: 'climate',       // Temperature, humidity zones
    ZONES: 'zones',           // Biome and region assignment
    ROADS: 'roads',           // Path and road network
    NAMES: 'names',           // Place name generation
    LANDMARKS: 'landmarks',   // Points of interest
    SETTLEMENTS: 'settlements', // Towns, villages
    SPAWNS: 'spawns'          // Creature spawn points
};

// ============================================================================
// SEED DERIVATION
// ============================================================================

/**
 * General-purpose seed derivation with string salt.
 * Uses djb2 hash algorithm for the salt string.
 *
 * @param {number} seed - Parent seed
 * @param {string} salt - String identifier (e.g., 'continentalness', 'temperature')
 * @returns {number} Derived seed (32-bit unsigned integer)
 */
export function deriveSeed(seed, salt) {
    // djb2 hash for salt string
    let saltHash = 5381;
    for (let i = 0; i < salt.length; i++) {
        saltHash = ((saltHash << 5) + saltHash) + salt.charCodeAt(i);
        saltHash = saltHash & 0xffffffff; // Keep as 32-bit
    }

    // Mix seed and salt hash using multiplicative hashing
    let h = seed ^ saltHash;
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return (h ^ (h >>> 16)) >>> 0;
}

/**
 * Derive a sub-seed from world seed and continent ID.
 * Each continent gets a unique, independent seed.
 *
 * @param {number} worldSeed - Global world seed
 * @param {number} continentId - Continent identifier (integer)
 * @returns {number} Derived continent seed (32-bit unsigned integer)
 */
export function deriveContinentSeed(worldSeed, continentId) {
    // Use golden ratio prime for good distribution
    let h = worldSeed ^ (continentId * 2654435761);
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return (h ^ (h >>> 16)) >>> 0;
}

/**
 * Derive stage-specific seed from parent seed and stage name.
 * Convenience wrapper around deriveSeed for standard stages.
 *
 * @param {number} parentSeed - World seed or continent seed
 * @param {string} stageName - Stage identifier (use GENERATION_STAGES constants)
 * @returns {number} Derived stage seed (32-bit unsigned integer)
 */
export function deriveStageSeed(parentSeed, stageName) {
    return deriveSeed(parentSeed, stageName);
}

/**
 * Derive a seed from multiple components (hierarchical derivation).
 * Useful for: world -> continent -> region -> feature
 *
 * @param {number} baseSeed - Starting seed
 * @param {...(string|number)} components - Chain of identifiers
 * @returns {number} Final derived seed
 *
 * @example
 * const featureSeed = deriveChainedSeed(worldSeed, 'continent', 3, 'region', 7, 'shape');
 */
export function deriveChainedSeed(baseSeed, ...components) {
    let seed = baseSeed >>> 0;
    for (const component of components) {
        if (typeof component === 'string') {
            seed = deriveSeed(seed, component);
        } else {
            // Numeric component - use multiplicative mixing
            seed = deriveContinentSeed(seed, component);
        }
    }
    return seed;
}

// ============================================================================
// SEEDED RANDOM NUMBER GENERATOR
// ============================================================================

/**
 * Create a seeded pseudo-random number generator.
 * Uses mulberry32 algorithm - fast, small, good statistical properties.
 *
 * @param {number} seed - Initial seed
 * @returns {function} Function that returns [0, 1) on each call
 *
 * @example
 * const rng = createRNG(12345);
 * console.log(rng()); // 0.38233...
 * console.log(rng()); // 0.74103...
 */
export function createRNG(seed) {
    let state = seed >>> 0;

    return function() {
        state = (state + 0x6D2B79F5) | 0;
        let t = Math.imul(state ^ (state >>> 15), 1 | state);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/**
 * Get a single random value without creating RNG instance.
 * Useful when you need just one value at a specific index.
 *
 * @param {number} seed - Seed value
 * @param {number} index - Sequence index (for multiple values from same seed)
 * @returns {number} Value in [0, 1)
 *
 * @example
 * const v0 = randomFromSeed(12345, 0); // First value
 * const v5 = randomFromSeed(12345, 5); // Sixth value
 */
export function randomFromSeed(seed, index = 0) {
    // Derive a unique seed for this index
    let h = seed ^ (index * 2654435761);
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/**
 * Get a random integer in range [min, max] (inclusive).
 *
 * @param {number} seed - Seed value
 * @param {number} index - Sequence index
 * @param {number} min - Minimum value (inclusive)
 * @param {number} max - Maximum value (inclusive)
 * @returns {number} Random integer in [min, max]
 */
export function randomIntFromSeed(seed, index, min, max) {
    const range = max - min + 1;
    return min + Math.floor(randomFromSeed(seed, index) * range);
}

// ============================================================================
// ARRAY UTILITIES
// ============================================================================

/**
 * Deterministic array shuffle using Fisher-Yates algorithm.
 * Returns a new array - original is not mutated.
 *
 * @param {Array} array - Array to shuffle
 * @param {number} seed - Seed for deterministic shuffle
 * @returns {Array} New shuffled array
 *
 * @example
 * const items = ['a', 'b', 'c', 'd'];
 * const shuffled = seededShuffle(items, 12345);
 * // items unchanged, shuffled is new array
 */
export function seededShuffle(array, seed) {
    const result = [...array];
    const rng = createRNG(seed);

    // Fisher-Yates shuffle
    for (let i = result.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [result[i], result[j]] = [result[j], result[i]];
    }

    return result;
}

/**
 * Select N items from array deterministically without replacement.
 * Returns items in selection order (not original order).
 *
 * @param {Array} array - Source array
 * @param {number} count - Number of items to select
 * @param {number} seed - Seed for selection
 * @returns {Array} Selected items
 *
 * @example
 * const items = ['a', 'b', 'c', 'd', 'e'];
 * const selected = seededSelect(items, 2, 12345);
 * // Returns 2 deterministically chosen items
 */
export function seededSelect(array, count, seed) {
    if (count >= array.length) {
        return seededShuffle(array, seed);
    }

    // Partial Fisher-Yates for efficiency when selecting few items
    const result = [...array];
    const rng = createRNG(seed);
    const selected = [];

    for (let i = 0; i < count; i++) {
        const remaining = result.length - i;
        const j = i + Math.floor(rng() * remaining);
        [result[i], result[j]] = [result[j], result[i]];
        selected.push(result[i]);
    }

    return selected;
}

/**
 * Weighted random selection from options.
 * Higher weight = higher probability of selection.
 *
 * @param {Array<{value: any, weight: number}>} options - Weighted options
 * @param {number} seed - Seed for selection
 * @returns {any} Selected value
 *
 * @example
 * const options = [
 *   { value: 'common', weight: 70 },
 *   { value: 'rare', weight: 25 },
 *   { value: 'legendary', weight: 5 }
 * ];
 * const result = seededWeightedSelect(options, 12345);
 */
export function seededWeightedSelect(options, seed) {
    if (options.length === 0) {
        return undefined;
    }

    const totalWeight = options.reduce((sum, opt) => sum + opt.weight, 0);
    const threshold = randomFromSeed(seed, 0) * totalWeight;

    let cumulative = 0;
    for (const option of options) {
        cumulative += option.weight;
        if (threshold < cumulative) {
            return option.value;
        }
    }

    // Fallback to last option (handles floating point edge cases)
    return options[options.length - 1].value;
}

/**
 * Select N items from weighted options without replacement.
 *
 * @param {Array<{value: any, weight: number}>} options - Weighted options
 * @param {number} count - Number of items to select
 * @param {number} seed - Seed for selection
 * @returns {Array} Selected values
 */
export function seededWeightedSelectMultiple(options, count, seed) {
    if (count >= options.length) {
        return seededShuffle(options.map(o => o.value), seed);
    }

    const remaining = [...options];
    const selected = [];

    for (let i = 0; i < count && remaining.length > 0; i++) {
        const totalWeight = remaining.reduce((sum, opt) => sum + opt.weight, 0);
        const threshold = randomFromSeed(seed, i) * totalWeight;

        let cumulative = 0;
        for (let j = 0; j < remaining.length; j++) {
            cumulative += remaining[j].weight;
            if (threshold < cumulative) {
                selected.push(remaining[j].value);
                remaining.splice(j, 1);
                break;
            }
        }
    }

    return selected;
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Generate a deterministic boolean with given probability.
 *
 * @param {number} seed - Seed value
 * @param {number} index - Sequence index
 * @param {number} probability - Probability of true [0, 1]
 * @returns {boolean} Deterministic boolean
 */
export function seededBoolean(seed, index, probability = 0.5) {
    return randomFromSeed(seed, index) < probability;
}

/**
 * Generate a deterministic float in range [min, max).
 *
 * @param {number} seed - Seed value
 * @param {number} index - Sequence index
 * @param {number} min - Minimum value (inclusive)
 * @param {number} max - Maximum value (exclusive)
 * @returns {number} Random float in [min, max)
 */
export function seededFloat(seed, index, min, max) {
    return min + randomFromSeed(seed, index) * (max - min);
}

/**
 * Generate a deterministic value from normal distribution.
 * Uses Box-Muller transform.
 *
 * @param {number} seed - Seed value
 * @param {number} index - Sequence index (uses index and index+1)
 * @param {number} mean - Mean of distribution
 * @param {number} stdDev - Standard deviation
 * @returns {number} Random value from normal distribution
 */
export function seededNormal(seed, index, mean = 0, stdDev = 1) {
    const u1 = randomFromSeed(seed, index);
    const u2 = randomFromSeed(seed, index + 1);

    // Box-Muller transform
    const z0 = Math.sqrt(-2 * Math.log(u1 || 0.0001)) * Math.cos(2 * Math.PI * u2);
    return mean + z0 * stdDev;
}
