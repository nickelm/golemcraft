/**
 * TNTManager - Handles TNT block placement, rendering, and detonation
 *
 * Features:
 * - Place TNT blocks in the world
 * - TNT blocks have a visible mesh
 * - Detonation triggered by: player attack, nearby explosion, or timer
 * - Chain reaction: nearby TNT blocks also detonate
 * - Explosion creates heightfield holes and destroys blocks
 */

import * as THREE from 'three';

// TNT configuration
const TNT_EXPLOSION_RADIUS = 5;          // Blocks destroyed in radius
const TNT_FUSE_TIME = 3.0;               // Seconds until detonation after trigger
const TNT_CHAIN_RADIUS = 6;              // Radius to trigger chain reactions
const TNT_DAMAGE = 40;                   // Base damage at center

/**
 * TNTBlock - Single placed TNT block
 */
export class TNTBlock {
    constructor(scene, position, manager) {
        this.scene = scene;
        this.position = position.clone();
        this.manager = manager;

        // State
        this.triggered = false;
        this.fuseTime = 0;
        this.detonated = false;

        // Create mesh
        this.mesh = this.createMesh();
        this.scene.add(this.mesh);

        // Blinking state for triggered TNT
        this.blinkTime = 0;
        this.isWhite = false;
    }

    createMesh() {
        // Create a simple red box for TNT
        const geometry = new THREE.BoxGeometry(0.9, 0.9, 0.9);
        const material = new THREE.MeshLambertMaterial({
            color: 0xff0000,  // Red
            emissive: 0x330000,
            emissiveIntensity: 0.3
        });

        const mesh = new THREE.Mesh(geometry, material);
        mesh.position.set(
            this.position.x + 0.5,  // Center in block
            this.position.y + 0.45,
            this.position.z + 0.5
        );
        mesh.castShadow = true;
        mesh.receiveShadow = true;

        return mesh;
    }

    /**
     * Trigger the TNT fuse
     */
    trigger() {
        if (this.triggered || this.detonated) return;
        this.triggered = true;
        this.fuseTime = TNT_FUSE_TIME;
    }

    /**
     * Immediately detonate the TNT
     */
    detonate() {
        if (this.detonated) return;
        this.detonated = true;

        // Notify manager to handle explosion
        this.manager.handleDetonation(this);

        // Remove mesh
        this.destroy();
    }

    /**
     * Update TNT block
     * @param {number} deltaTime - Time since last frame
     * @returns {boolean} True if still active
     */
    update(deltaTime) {
        if (this.detonated) return false;

        if (this.triggered) {
            this.fuseTime -= deltaTime;

            // Blink effect when triggered
            this.blinkTime += deltaTime;
            const blinkRate = Math.max(0.1, this.fuseTime / TNT_FUSE_TIME * 0.5);
            if (this.blinkTime >= blinkRate) {
                this.blinkTime = 0;
                this.isWhite = !this.isWhite;
                this.mesh.material.color.setHex(this.isWhite ? 0xffffff : 0xff0000);
                this.mesh.material.emissive.setHex(this.isWhite ? 0x333333 : 0x330000);
            }

            if (this.fuseTime <= 0) {
                this.detonate();
                return false;
            }
        }

        return true;
    }

    /**
     * Check if a position is close enough to trigger this TNT
     * @param {THREE.Vector3} attackPosition - Position of attack
     * @param {number} radius - Attack radius
     * @returns {boolean} True if hit
     */
    isHitBy(attackPosition, radius = 1.5) {
        const dist = this.position.distanceTo(attackPosition);
        return dist < radius;
    }

    /**
     * Clean up mesh
     */
    destroy() {
        if (this.mesh) {
            this.scene.remove(this.mesh);
            if (this.mesh.geometry) this.mesh.geometry.dispose();
            if (this.mesh.material) this.mesh.material.dispose();
            this.mesh = null;
        }
    }
}

/**
 * TNTManager - Manages all TNT blocks in the world
 */
export class TNTManager {
    /**
     * @param {THREE.Scene} scene - Scene for TNT meshes
     * @param {Function} onExplosion - Callback when TNT explodes (position, radius)
     */
    constructor(scene, onExplosion = null) {
        this.scene = scene;
        this.onExplosion = onExplosion;

        // Active TNT blocks (keyed by "x,y,z")
        this.tntBlocks = new Map();

        // Pending detonations (for chain reactions)
        this.pendingChainDetonations = [];
    }

    /**
     * Place a TNT block at position
     * @param {THREE.Vector3} position - World position (will be floored)
     * @returns {TNTBlock|null} The placed TNT or null if already exists
     */
    placeTNT(position) {
        const x = Math.floor(position.x);
        const y = Math.floor(position.y);
        const z = Math.floor(position.z);
        const key = `${x},${y},${z}`;

        // Don't place if already exists
        if (this.tntBlocks.has(key)) {
            return null;
        }

        const tnt = new TNTBlock(
            this.scene,
            new THREE.Vector3(x, y, z),
            this
        );

        this.tntBlocks.set(key, tnt);
        return tnt;
    }

    /**
     * Remove TNT at position (without detonating)
     * @param {number} x - World X
     * @param {number} y - World Y
     * @param {number} z - World Z
     */
    removeTNT(x, y, z) {
        const key = `${Math.floor(x)},${Math.floor(y)},${Math.floor(z)}`;
        const tnt = this.tntBlocks.get(key);
        if (tnt) {
            tnt.destroy();
            this.tntBlocks.delete(key);
        }
    }

    /**
     * Handle TNT detonation - create explosion and trigger chain reactions
     * @param {TNTBlock} tnt - The detonating TNT block
     */
    handleDetonation(tnt) {
        const position = tnt.position.clone();
        position.x += 0.5;  // Center of block
        position.y += 0.5;
        position.z += 0.5;

        // Remove from map
        const key = `${Math.floor(tnt.position.x)},${Math.floor(tnt.position.y)},${Math.floor(tnt.position.z)}`;
        this.tntBlocks.delete(key);

        // Create explosion via callback
        if (this.onExplosion) {
            this.onExplosion(position, TNT_EXPLOSION_RADIUS, TNT_DAMAGE);
        }

        // Trigger chain reactions - find nearby TNT blocks
        for (const [otherKey, otherTnt] of this.tntBlocks) {
            if (otherTnt.detonated) continue;

            const dist = position.distanceTo(otherTnt.position);
            if (dist <= TNT_CHAIN_RADIUS) {
                // Trigger with slight delay based on distance
                otherTnt.trigger();
            }
        }
    }

    /**
     * Check if attack hits any TNT blocks
     * @param {THREE.Vector3} attackPosition - Position of attack
     * @param {number} radius - Attack radius
     * @returns {boolean} True if any TNT was triggered
     */
    checkAttackHit(attackPosition, radius = 1.5) {
        let hitAny = false;

        for (const [key, tnt] of this.tntBlocks) {
            if (tnt.isHitBy(attackPosition, radius)) {
                tnt.trigger();
                hitAny = true;
            }
        }

        return hitAny;
    }

    /**
     * Trigger all TNT blocks near an explosion
     * @param {THREE.Vector3} explosionPosition - Center of explosion
     * @param {number} explosionRadius - Radius of explosion
     */
    triggerNearExplosion(explosionPosition, explosionRadius) {
        for (const [key, tnt] of this.tntBlocks) {
            if (tnt.detonated || tnt.triggered) continue;

            const dist = explosionPosition.distanceTo(tnt.position);
            if (dist <= explosionRadius + 1) {  // Slight buffer
                tnt.trigger();
            }
        }
    }

    /**
     * Update all TNT blocks
     * @param {number} deltaTime - Time since last frame
     */
    update(deltaTime) {
        // Update all TNT blocks
        for (const [key, tnt] of this.tntBlocks) {
            if (!tnt.update(deltaTime)) {
                // TNT detonated, remove from map (already handled in handleDetonation)
            }
        }

        // Clean up detonated TNT from map
        for (const [key, tnt] of this.tntBlocks) {
            if (tnt.detonated) {
                this.tntBlocks.delete(key);
            }
        }
    }

    /**
     * Get TNT block at position
     * @param {number} x - World X
     * @param {number} y - World Y
     * @param {number} z - World Z
     * @returns {TNTBlock|null}
     */
    getTNTAt(x, y, z) {
        const key = `${Math.floor(x)},${Math.floor(y)},${Math.floor(z)}`;
        return this.tntBlocks.get(key) || null;
    }

    /**
     * Check if there's TNT at position
     * @param {number} x - World X
     * @param {number} y - World Y
     * @param {number} z - World Z
     * @returns {boolean}
     */
    hasTNTAt(x, y, z) {
        return this.getTNTAt(x, y, z) !== null;
    }

    /**
     * Get count of active TNT blocks
     * @returns {number}
     */
    getCount() {
        return this.tntBlocks.size;
    }

    /**
     * Clear all TNT blocks
     */
    clearAll() {
        for (const [key, tnt] of this.tntBlocks) {
            tnt.destroy();
        }
        this.tntBlocks.clear();
    }

    /**
     * Dispose of resources
     */
    dispose() {
        this.clearAll();
    }
}
