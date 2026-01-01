/**
 * Math Utilities - Interpolation and easing functions
 * 
 * Reusable mathematical helpers for smooth transitions and blending
 */

/**
 * Linear interpolation between two values
 * @param {number} a - Start value
 * @param {number} b - End value  
 * @param {number} t - Interpolation factor (0-1)
 * @returns {number} Interpolated value
 */
export function lerp(a, b, t) {
    return a + (b - a) * t;
}

/**
 * Clamp a value between min and max
 * @param {number} value - Value to clamp
 * @param {number} min - Minimum value
 * @param {number} max - Maximum value
 * @returns {number} Clamped value
 */
export function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

/**
 * Smoothstep interpolation (ease in/out)
 * @param {number} edge0 - Lower edge
 * @param {number} edge1 - Upper edge
 * @param {number} x - Value to interpolate
 * @returns {number} Smoothed value (0-1)
 */
export function smoothstep(edge0, edge1, x) {
    const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
    return t * t * (3 - 2 * t);
}

/**
 * Remap a value from one range to another
 * @param {number} value - Value to remap
 * @param {number} inMin - Input range minimum
 * @param {number} inMax - Input range maximum
 * @param {number} outMin - Output range minimum
 * @param {number} outMax - Output range maximum
 * @returns {number} Remapped value
 */
export function remap(value, inMin, inMax, outMin, outMax) {
    return outMin + (value - inMin) * (outMax - outMin) / (inMax - inMin);
}

/**
 * Ease-in quadratic
 */
export function easeInQuad(t) {
    return t * t;
}

/**
 * Ease-out quadratic
 */
export function easeOutQuad(t) {
    return t * (2 - t);
}

/**
 * Ease-in-out quadratic
 */
export function easeInOutQuad(t) {
    return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
}