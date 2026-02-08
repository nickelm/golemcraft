/**
 * ElevationEnvelope - Pure functions for continental elevation structure
 *
 * Modulates terrain height using polar coordinates (r, θ) from island center.
 * Two-parameter system:
 *   baseElevation(r, θ) — raises the terrain floor (blocks)
 *   amplitudeScale(r, θ) — multiplies noise amplitude [0, 2]
 *
 * Terrain types enabled:
 *   Plateau:          high baseElevation + low amplitude → elevated flat terrain
 *   Mountain range:   medium baseElevation + high amplitude → dramatic peaks
 *   Coastal lowlands: low baseElevation + low amplitude → gentle near sea level
 *
 * All functions are pure and deterministic from seed.
 */

import { hash } from './terraincore.js';

const MAX_HEIGHT = 63;

// ============================================================================
// TEMPLATE PRESETS
// ============================================================================

/**
 * Verdania: Gentle rolling terrain with a southern mountain spine.
 * Temperate starting continent — welcoming, not too challenging.
 */
const TEMPLATE_VERDANIA = {
    controlPoints: [
        { r: 0.00, baseElev: 0.12, amplitude: 0.50 },
        { r: 0.25, baseElev: 0.08, amplitude: 0.70 },
        { r: 0.50, baseElev: 0.05, amplitude: 0.60 },
        { r: 0.75, baseElev: 0.02, amplitude: 0.40 },
        { r: 1.00, baseElev: 0.00, amplitude: 0.15 },
    ],
    angularLobes: [
        { frequency: 2, amplitude: 0.08 },
        { frequency: 3, amplitude: 0.04 },
    ],
    spineWidth: 0.5,
    spineStrength: 0.6,
};

/**
 * Grausland: Rugged Nordic terrain with steep valleys and multiple ridges.
 * Cold starting continent — dramatic topography throughout.
 */
const TEMPLATE_GRAUSLAND = {
    controlPoints: [
        { r: 0.00, baseElev: 0.20, amplitude: 0.90 },
        { r: 0.20, baseElev: 0.15, amplitude: 1.00 },
        { r: 0.45, baseElev: 0.10, amplitude: 0.80 },
        { r: 0.70, baseElev: 0.06, amplitude: 0.50 },
        { r: 1.00, baseElev: 0.00, amplitude: 0.20 },
    ],
    angularLobes: [
        { frequency: 1, amplitude: 0.12 },
        { frequency: 2, amplitude: 0.10 },
        { frequency: 3, amplitude: 0.08 },
        { frequency: 5, amplitude: 0.04 },
    ],
    spineWidth: 0.0,
    spineStrength: 0.0,
};

/**
 * Petermark: Flat coastal plains with isolated mesa-like elevated sectors.
 * Arid/Mediterranean starting continent — mostly flat, dramatic mesas.
 */
const TEMPLATE_PETERMARK = {
    controlPoints: [
        { r: 0.00, baseElev: 0.04, amplitude: 0.25 },
        { r: 0.25, baseElev: 0.03, amplitude: 0.20 },
        { r: 0.50, baseElev: 0.02, amplitude: 0.20 },
        { r: 0.75, baseElev: 0.01, amplitude: 0.15 },
        { r: 1.00, baseElev: 0.00, amplitude: 0.10 },
    ],
    angularLobes: [
        { frequency: 2, amplitude: 0.25 },
        { frequency: 3, amplitude: 0.15 },
    ],
    spineWidth: 0.0,
    spineStrength: 0.0,
};

const TEMPLATES = {
    verdania: TEMPLATE_VERDANIA,
    grausland: TEMPLATE_GRAUSLAND,
    petermark: TEMPLATE_PETERMARK,
};

// ============================================================================
// ENVELOPE GENERATION
// ============================================================================

/**
 * Generate elevation envelope parameters for a continent.
 * Deterministic from seed — same inputs always produce same envelope.
 *
 * @param {number} seed - Envelope seed (derived from world seed)
 * @param {number} baseRadius - Island radius in blocks
 * @param {string} template - Template name ('verdania', 'grausland', 'petermark', 'default')
 * @param {number} startAngle - Starting position angle in radians (for spine direction)
 * @returns {Object} EnvelopeParams
 */
export function generateEnvelopeParams(seed, baseRadius, template = 'default', startAngle = 0) {
    const preset = TEMPLATES[template];

    if (preset) {
        return generateFromTemplate(seed, baseRadius, preset, template, startAngle);
    }

    // Default: fully seed-derived parameters (for continent 1+)
    return generateFromSeed(seed, baseRadius, startAngle);
}

/**
 * Generate envelope from a named template with seed-derived variation.
 */
function generateFromTemplate(seed, baseRadius, preset, templateName, startAngle) {
    // Add seed-derived phase to each angular lobe
    const angularLobes = preset.angularLobes.map((lobe, i) => ({
        frequency: lobe.frequency,
        amplitude: lobe.amplitude,
        phase: hash(i, 0, seed + 100) * Math.PI * 2,
    }));

    // Spine angle: opposite side from start position ("south" relative to player start)
    let spineAngle = null;
    if (preset.spineStrength > 0) {
        spineAngle = startAngle + Math.PI;
    }

    // Add slight seed variation to control points (±10% of each value)
    const controlPoints = preset.controlPoints.map((cp, i) => {
        const baseVar = (hash(i, 1, seed + 200) - 0.5) * 0.2;
        const ampVar = (hash(i, 2, seed + 300) - 0.5) * 0.2;
        return {
            r: cp.r,
            baseElev: Math.max(0, cp.baseElev * (1 + baseVar)),
            amplitude: Math.max(0.05, cp.amplitude * (1 + ampVar)),
        };
    });

    return {
        baseRadius,
        controlPoints,
        angularLobes,
        spineAngle,
        spineWidth: preset.spineWidth,
        spineStrength: preset.spineStrength,
    };
}

/**
 * Generate fully seed-derived envelope (for continent 1+ with no template).
 * Creates natural variety across different continents.
 */
function generateFromSeed(seed, baseRadius, startAngle) {
    // Generate 5 control points with seed-derived values
    // General shape: higher interior, lower coast
    const controlPoints = [];
    const numPoints = 5;
    for (let i = 0; i < numPoints; i++) {
        const r = i / (numPoints - 1);
        // Base elevation: dome-like falloff with seed variation
        const domeFalloff = 1.0 - r;
        const baseElev = domeFalloff * (0.05 + hash(i, 10, seed + 500) * 0.20);
        // Amplitude: moderate with seed variation, tapers toward coast
        const amplitude = (0.3 + hash(i, 11, seed + 600) * 0.5) * (0.3 + 0.7 * domeFalloff);

        controlPoints.push({
            r,
            baseElev: Math.max(0, baseElev),
            amplitude: Math.max(0.05, amplitude),
        });
    }

    // Generate 3-4 angular lobes
    const lobeCount = 3 + (hash(0, 20, seed + 700) > 0.5 ? 1 : 0);
    const angularLobes = [];
    for (let i = 0; i < lobeCount; i++) {
        angularLobes.push({
            frequency: i + 1,
            amplitude: 0.05 + hash(i, 21, seed + 800) * 0.12,
            phase: hash(i, 22, seed + 900) * Math.PI * 2,
        });
    }

    // 40% chance of a spine
    const hasSpine = hash(0, 30, seed + 1000) > 0.6;
    const spineAngle = hasSpine ? startAngle + Math.PI + (hash(0, 31, seed + 1100) - 0.5) * 1.0 : null;
    const spineStrength = hasSpine ? 0.3 + hash(0, 32, seed + 1200) * 0.4 : 0.0;
    const spineWidth = 0.3 + hash(0, 33, seed + 1300) * 0.4;

    return {
        baseRadius,
        controlPoints,
        angularLobes,
        spineAngle,
        spineWidth,
        spineStrength,
    };
}

// ============================================================================
// ENVELOPE EVALUATION
// ============================================================================

/**
 * Evaluate the elevation envelope at a world position.
 * Returns baseElevation (blocks) and amplitudeScale (multiplier).
 *
 * @param {number} x - World X coordinate
 * @param {number} z - World Z coordinate
 * @param {Object} params - EnvelopeParams from generateEnvelopeParams()
 * @returns {{ baseElevation: number, amplitudeScale: number }}
 */
export function evaluateEnvelope(x, z, params) {
    const r = Math.sqrt(x * x + z * z);
    const rNorm = Math.min(r / params.baseRadius, 1.2);
    const theta = Math.atan2(z, x);

    // Radial interpolation
    const { baseElev, amplitude } = interpolateControlPoints(rNorm, params.controlPoints);

    // Angular modulation
    const angMod = computeAngularModulation(
        theta,
        params.angularLobes,
        params.spineAngle,
        params.spineWidth,
        params.spineStrength
    );

    // Combine: envelope base in blocks, amplitude as multiplier
    const baseElevation = Math.max(0, Math.min(40, baseElev * angMod * MAX_HEIGHT));
    const amplitudeScale = Math.max(0.05, Math.min(2.0, amplitude * angMod));

    return { baseElevation, amplitudeScale };
}

// ============================================================================
// CONTROL POINT INTERPOLATION
// ============================================================================

/**
 * Interpolate control points at a normalized radial distance.
 * Uses smoothstep for smooth transitions without overshooting.
 *
 * @param {number} rNorm - Normalized radius [0, 1+]
 * @param {Array} points - Control points sorted by r, each { r, baseElev, amplitude }
 * @returns {{ baseElev: number, amplitude: number }}
 */
export function interpolateControlPoints(rNorm, points) {
    // Clamp beyond last control point
    if (rNorm <= points[0].r) {
        return { baseElev: points[0].baseElev, amplitude: points[0].amplitude };
    }
    const last = points[points.length - 1];
    if (rNorm >= last.r) {
        return { baseElev: last.baseElev, amplitude: last.amplitude };
    }

    // Find bracketing pair
    for (let i = 0; i < points.length - 1; i++) {
        if (rNorm >= points[i].r && rNorm < points[i + 1].r) {
            const t = (rNorm - points[i].r) / (points[i + 1].r - points[i].r);
            // Smoothstep for natural transition
            const s = t * t * (3 - 2 * t);
            return {
                baseElev: points[i].baseElev + (points[i + 1].baseElev - points[i].baseElev) * s,
                amplitude: points[i].amplitude + (points[i + 1].amplitude - points[i].amplitude) * s,
            };
        }
    }

    // Fallback (shouldn't reach here)
    return { baseElev: last.baseElev, amplitude: last.amplitude };
}

// ============================================================================
// ANGULAR MODULATION
// ============================================================================

/**
 * Compute angular modulation factor at an angle.
 * Sums harmonic lobes and optional directional spine.
 *
 * @param {number} theta - Angle in radians
 * @param {Array} lobes - Angular lobes, each { frequency, amplitude, phase }
 * @param {number|null} spineAngle - Spine direction in radians (null = no spine)
 * @param {number} spineWidth - Angular width of spine in radians
 * @param {number} spineStrength - Spine strength multiplier
 * @returns {number} Modulation factor (typically 0.5 to 1.8)
 */
export function computeAngularModulation(theta, lobes, spineAngle, spineWidth, spineStrength) {
    let mod = 1.0;

    // Sum harmonic lobes
    for (const lobe of lobes) {
        mod += lobe.amplitude * Math.sin(theta * lobe.frequency + lobe.phase);
    }

    // Optional directional spine (Gaussian peak in angular space)
    if (spineStrength > 0 && spineAngle !== null) {
        const angDist = angleDifference(theta, spineAngle);
        const gaussian = Math.exp(-(angDist * angDist) / (2 * spineWidth * spineWidth));
        mod += spineStrength * gaussian;
    }

    return Math.max(0.1, Math.min(2.0, mod));
}

/**
 * Compute shortest angular difference, wrapping around [-PI, PI].
 * @param {number} a - First angle in radians
 * @param {number} b - Second angle in radians
 * @returns {number} Signed angular difference
 */
function angleDifference(a, b) {
    let diff = a - b;
    while (diff > Math.PI) diff -= 2 * Math.PI;
    while (diff < -Math.PI) diff += 2 * Math.PI;
    return diff;
}
