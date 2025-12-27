/**
 * voxel-aabb-sweep - ES Module version
 * 
 * Sweep an AABB along a vector and find where it collides with voxels.
 * Original by Andy Hall (fenomas), MIT license.
 * https://github.com/fenomas/voxel-aabb-sweep
 */

// Reused array instances for performance
const tr_arr = [];
const ldi_arr = [];
const tri_arr = [];
const step_arr = [];
const tDelta_arr = [];
const tNext_arr = [];
const vec_arr = [];
const normed_arr = [];
const base_arr = [];
const max_arr = [];
const left_arr = [];
const result_arr = [];

// Core implementation
function sweep_impl(getVoxel, callback, vec, base, max, epsilon) {
    const tr = tr_arr;
    const ldi = ldi_arr;
    const tri = tri_arr;
    const step = step_arr;
    const tDelta = tDelta_arr;
    const tNext = tNext_arr;
    const normed = normed_arr;

    const floor = Math.floor;
    let cumulative_t = 0.0;
    let t = 0.0;
    let max_t = 0.0;
    let axis = 0;
    let i = 0;

    // Init for the current sweep vector and take first step
    initSweep();
    if (max_t === 0) return 0;

    axis = stepForward();

    // Loop along raycast vector
    while (t <= max_t) {
        // Sweeps over leading face of AABB
        if (checkCollision(axis)) {
            // Calls the callback and decides whether to continue
            const done = handleCollision();
            if (done) return cumulative_t;
        }
        axis = stepForward();
    }

    // Reached the end of the vector unobstructed
    cumulative_t += max_t;
    for (i = 0; i < 3; i++) {
        base[i] += vec[i];
        max[i] += vec[i];
    }
    return cumulative_t;

    function initSweep() {
        t = 0.0;
        max_t = Math.sqrt(vec[0] * vec[0] + vec[1] * vec[1] + vec[2] * vec[2]);
        if (max_t === 0) return;
        for (let i = 0; i < 3; i++) {
            const dir = (vec[i] >= 0);
            step[i] = dir ? 1 : -1;
            const lead = dir ? max[i] : base[i];
            tr[i] = dir ? base[i] : max[i];
            ldi[i] = leadEdgeToInt(lead, step[i]);
            tri[i] = trailEdgeToInt(tr[i], step[i]);
            normed[i] = vec[i] / max_t;
            tDelta[i] = Math.abs(1 / normed[i]);
            const dist = dir ? (ldi[i] + 1 - lead) : (lead - ldi[i]);
            tNext[i] = (tDelta[i] < Infinity) ? tDelta[i] * dist : Infinity;
        }
    }

    function checkCollision(i_axis) {
        const stepx = step[0];
        const x0 = (i_axis === 0) ? ldi[0] : tri[0];
        const x1 = ldi[0] + stepx;

        const stepy = step[1];
        const y0 = (i_axis === 1) ? ldi[1] : tri[1];
        const y1 = ldi[1] + stepy;

        const stepz = step[2];
        const z0 = (i_axis === 2) ? ldi[2] : tri[2];
        const z1 = ldi[2] + stepz;

        for (let x = x0; x !== x1; x += stepx) {
            for (let y = y0; y !== y1; y += stepy) {
                for (let z = z0; z !== z1; z += stepz) {
                    if (getVoxel(x, y, z)) return true;
                }
            }
        }
        return false;
    }

    function handleCollision() {
        cumulative_t += t;
        const dir = step[axis];

        const done = t / max_t;
        const left = left_arr;
        for (i = 0; i < 3; i++) {
            const dv = vec[i] * done;
            base[i] += dv;
            max[i] += dv;
            left[i] = vec[i] - dv;
        }

        // Set leading edge exactly to voxel boundary
        if (dir > 0) {
            max[axis] = Math.round(max[axis]);
        } else {
            base[axis] = Math.round(base[axis]);
        }

        // Call back to let client update the "left to go" vector
        const res = callback(cumulative_t, axis, dir, left);

        if (res) return true;

        // Init for new sweep along vec
        for (i = 0; i < 3; i++) vec[i] = left[i];
        initSweep();
        if (max_t === 0) return true;

        return false;
    }

    function stepForward() {
        const axis = (tNext[0] < tNext[1]) ?
            ((tNext[0] < tNext[2]) ? 0 : 2) :
            ((tNext[1] < tNext[2]) ? 1 : 2);
        const dt = tNext[axis] - t;
        t = tNext[axis];
        ldi[axis] += step[axis];
        tNext[axis] += tDelta[axis];
        for (i = 0; i < 3; i++) {
            tr[i] += dt * normed[i];
            tri[i] = trailEdgeToInt(tr[i], step[i]);
        }
        return axis;
    }

    function leadEdgeToInt(coord, step) {
        return floor(coord - step * epsilon);
    }

    function trailEdgeToInt(coord, step) {
        return floor(coord + step * epsilon);
    }
}

/**
 * Sweep an AABB along a vector, detecting voxel collisions
 * 
 * @param {Function} getVoxel - (x,y,z) => boolean, returns true if voxel is solid
 * @param {Object} box - AABB with base[], max[], and translate(vec) method
 * @param {Array} dir - Movement vector [x, y, z]
 * @param {Function} callback - Called on collision: (dist, axis, dir, vec) => boolean
 * @param {boolean} noTranslate - If true, don't move the box
 * @param {number} epsilon - Rounding tolerance (default 1e-10)
 * @returns {number} Total distance moved
 */
export default function sweep(getVoxel, box, dir, callback, noTranslate, epsilon) {
    const vec = vec_arr;
    const base = base_arr;
    const max = max_arr;
    const result = result_arr;

    // Init parameter arrays
    for (let i = 0; i < 3; i++) {
        vec[i] = +dir[i];
        max[i] = +box.max[i];
        base[i] = +box.base[i];
    }

    if (!epsilon) epsilon = 1e-10;

    // Run sweep
    const dist = sweep_impl(getVoxel, callback, vec, base, max, epsilon);

    // Translate box
    if (!noTranslate) {
        for (let i = 0; i < 3; i++) {
            result[i] = (dir[i] > 0) ? max[i] - box.max[i] : base[i] - box.base[i];
        }
        box.translate(result);
    }

    return dist;
}