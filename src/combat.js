import * as THREE from 'three';

/**
 * Arrow - Projectile fired by archer hero
 */
export class Arrow {
    constructor(scene, startPosition, targetPosition, damage = 10) {
        this.scene = scene;
        this.startPosition = startPosition.clone();
        this.targetPosition = targetPosition.clone();
        this.damage = damage;
        this.speed = 25;  // Slower for more satisfying feel
        
        // Calculate direction
        this.direction = new THREE.Vector3()
            .subVectors(targetPosition, startPosition)
            .normalize();
        
        this.position = startPosition.clone();
        this.distanceTraveled = 0;
        this.maxDistance = 100;  // Despawn after 100 units
        this.hit = false;
        this.stuck = false;
        this.stuckTime = 0;
        this.stuckDuration = 1.5;  // Degrade after 1.5 seconds
        
        this.mesh = this.createMesh();
        this.scene.add(this.mesh);
        
        // Trail particles
        this.particles = this.createTrailParticles();
        this.scene.add(this.particles);
        this.particleTime = 0;
    }
    
    createMesh() {
        const group = new THREE.Group();
        
        // Arrow tip - pyramid pointing forward (+Z direction)
        const tipGeo = new THREE.ConeGeometry(0.15, 0.4, 4);
        // Rotate so tip points along +Z (cone default points up, so rotate -90Â° around X)
        tipGeo.rotateX(Math.PI / 2);
        const tipMat = new THREE.MeshLambertMaterial({ color: 0x606060 });  // Gray metal
        const tip = new THREE.Mesh(tipGeo, tipMat);
        // Position at front of arrow - cone base is at center, tip extends forward
        tip.position.set(0, 0, 0.8);  // Front of arrow
        group.add(tip);
        
        // Arrow shaft - box along Z axis
        const shaftGeo = new THREE.BoxGeometry(0.08, 0.08, 0.8);
        const shaftMat = new THREE.MeshLambertMaterial({ color: 0x8B4513 });  // Brown wood
        const shaft = new THREE.Mesh(shaftGeo, shaftMat);
        shaft.position.set(0, 0, 0.2);  // Centered, slightly forward
        group.add(shaft);
        
        // Fletching - cross-shaped fins at back
        const fletchGeo = new THREE.BoxGeometry(0.02, 0.25, 0.15);
        const fletchMat = new THREE.MeshLambertMaterial({ color: 0xCC0000 });  // Red
        
        // Horizontal fletching (along X axis)
        const fletch1 = new THREE.Mesh(fletchGeo, fletchMat);
        fletch1.position.set(0, 0, -0.1);  // At back of arrow
        fletch1.rotation.z = Math.PI / 2;  // Rotate to be horizontal
        group.add(fletch1);
        
        // Vertical fletching (along Y axis) - rotated 90Â° from first
        const fletch2 = new THREE.Mesh(fletchGeo, fletchMat);
        fletch2.position.set(0, 0, -0.1);  // Same position, different rotation
        // Already vertical by default
        group.add(fletch2);
        
        group.position.copy(this.position);
        group.castShadow = true;
        
        // Orient to point in direction of flight (tip forward)
        this.updateOrientation(group);
        
        return group;
    }
    
    /**
     * Update mesh orientation to point in flight direction
     */
    updateOrientation(mesh) {
        // Create quaternion that rotates from +Z to direction vector
        const forward = new THREE.Vector3(0, 0, 1);
        const quaternion = new THREE.Quaternion();
        quaternion.setFromUnitVectors(forward, this.direction);
        mesh.quaternion.copy(quaternion);
    }
    
    /**
     * Create simple particle trail
     */
    createTrailParticles() {
        // Simple points geometry for trail
        const particleCount = 10;
        const geometry = new THREE.BufferGeometry();
        const positions = new Float32Array(particleCount * 3);
        
        // Initialize all particles at arrow position
        for (let i = 0; i < particleCount; i++) {
            positions[i * 3] = this.position.x;
            positions[i * 3 + 1] = this.position.y;
            positions[i * 3 + 2] = this.position.z;
        }
        
        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        
        const material = new THREE.PointsMaterial({
            color: 0xFFFFFF,
            size: 0.15,
            transparent: true,
            opacity: 0.6,
            blending: THREE.AdditiveBlending
        });
        
        const particles = new THREE.Points(geometry, material);
        return particles;
    }
    
    /**
     * Update arrow position and check collisions
     * Returns false when arrow should be removed
     */
    update(deltaTime, terrain, entities) {
        // If stuck, count down and fade out
        if (this.stuck) {
            this.stuckTime += deltaTime;
            
            // Fade out arrow
            const fadeProgress = this.stuckTime / this.stuckDuration;
            const opacity = 1 - fadeProgress;
            
            this.mesh.traverse((child) => {
                if (child.material) {
                    child.material.transparent = true;
                    child.material.opacity = opacity;
                }
            });
            
            // Remove after duration
            if (this.stuckTime >= this.stuckDuration) {
                this.destroy();
                return false;
            }
            
            return true;
        }
        
        if (this.hit) return false;
        
        // Move arrow
        const movement = this.direction.clone().multiplyScalar(this.speed * deltaTime);
        this.position.add(movement);
        this.mesh.position.copy(this.position);
        this.distanceTraveled += movement.length();
        
        // Update trail particles - shift positions back
        if (this.particles) {
            this.particleTime += deltaTime;
            const positions = this.particles.geometry.attributes.position.array;
            
            // Shift particles back along trail
            for (let i = positions.length - 3; i >= 3; i -= 3) {
                positions[i] = positions[i - 3];
                positions[i + 1] = positions[i - 2];
                positions[i + 2] = positions[i - 1];
            }
            
            // First particle follows arrow
            positions[0] = this.position.x;
            positions[1] = this.position.y;
            positions[2] = this.position.z;
            
            this.particles.geometry.attributes.position.needsUpdate = true;
            
            // Fade out trail over time
            this.particles.material.opacity = 0.6 * Math.max(0, 1 - this.particleTime);
        }
        
        // Check terrain collision - stick in terrain!
        // Check slightly ahead of arrow position for voxel collision
        const checkDistance = 0.4;
        const checkPos = this.position.clone().add(
            this.direction.clone().multiplyScalar(checkDistance)
        );
        
        const blockX = Math.floor(checkPos.x);
        const blockY = Math.floor(checkPos.y);
        const blockZ = Math.floor(checkPos.z);
        
        // Check voxel collision first (check ahead)
        let hitTerrain = terrain.getBlockType(blockX, blockY, blockZ) !== null;
        
        // Check heightfield collision at ACTUAL position (not ahead)
        // This prevents false hits on steep terrain where "ahead" is over higher ground
        if (!hitTerrain && terrain.getInterpolatedHeight) {
            const groundY = terrain.getInterpolatedHeight(this.position.x, this.position.z);
            if (groundY !== null && this.position.y <= groundY + 0.2) {
                hitTerrain = true;
                // Snap arrow to ground surface
                this.position.y = groundY + 0.15;
            }
        }
        
        if (hitTerrain) {
            this.mesh.position.copy(this.position);
            
            this.stuck = true;
            this.stuckTime = 0;
            
            // Remove particle trail immediately
            if (this.particles) {
                this.scene.remove(this.particles);
                this.particles = null;
            }
            
            return true;  // Keep arrow visible, it's stuck
        }
        
        // Check entity collision - disappear on hit
        for (const entity of entities) {
            if (entity.health <= 0) continue;
            
            const distance = this.position.distanceTo(entity.position);
            if (distance < 1.5) {  // Hit radius
                // Hit entity - damage and remove arrow immediately
                entity.takeDamage(this.damage);
                this.hit = true;
                this.destroy();
                return false;
            }
        }
        
        // Despawn if traveled too far
        if (this.distanceTraveled > this.maxDistance) {
            this.destroy();
            return false;
        }
        
        return true;
    }
    
    destroy() {
        this.scene.remove(this.mesh);
        if (this.particles) this.scene.remove(this.particles);
        
        this.mesh.traverse((child) => {
            if (child.geometry) child.geometry.dispose();
            if (child.material) child.material.dispose();
        });
        
        if (this.particles && this.particles.geometry) this.particles.geometry.dispose();
        if (this.particles && this.particles.material) this.particles.material.dispose();
    }
}

/**
 * Bow - Visual weapon for archer hero
 */
export class Bow {
    // Position offsets for different mount states
    static MOUNTED_POSITION = { x: 0.5, y: 2.0, z: 0 };      // Rider's arm height on mount
    static ON_FOOT_POSITION = { x: 0.35, y: 1.2, z: 0 };     // Standing hero's arm height

    constructor(scene, heroMesh) {
        this.scene = scene;
        this.heroMesh = heroMesh;
        this.mesh = this.createMesh();

        // Attack animation
        this.drawAmount = 0;  // 0 to 1, bow draw progress
        this.isDrawing = false;

        // Attach bow to hero (as child so it follows)
        this.heroMesh.add(this.mesh);
    }

    /**
     * Attach bow to a new mesh, used when switching between mounted/dismounted states
     * @param {THREE.Object3D} newMesh - The mesh to attach to
     * @param {boolean} mounted - Whether the hero is mounted (affects position)
     */
    attachTo(newMesh, mounted = true) {
        // Remove from current parent
        if (this.mesh.parent) {
            this.mesh.parent.remove(this.mesh);
        }

        // Add to new parent
        newMesh.add(this.mesh);
        this.heroMesh = newMesh;

        // Set position based on mount state
        const pos = mounted ? Bow.MOUNTED_POSITION : Bow.ON_FOOT_POSITION;
        this.mesh.position.set(pos.x, pos.y, pos.z);
    }
    
    createMesh() {
        const group = new THREE.Group();
        
        // Bow grip - vertical center piece (what you hold)
        const gripGeo = new THREE.BoxGeometry(0.08, 0.8, 0.08);
        const bowMat = new THREE.MeshLambertMaterial({ color: 0x654321 });  // Dark brown
        const grip = new THREE.Mesh(gripGeo, bowMat);
        group.add(grip);
        
        // Upper limb - curves backward (positive Z)
        const limbGeo = new THREE.BoxGeometry(0.06, 0.5, 0.06);
        const upperLimb = new THREE.Mesh(limbGeo, bowMat);
        upperLimb.position.set(0, 0.5, -0.15);  // Back and up
        upperLimb.rotation.x = -Math.PI / 5;  // Angle backward
        group.add(upperLimb);
        
        // Lower limb - curves backward (positive Z)
        const lowerLimb = new THREE.Mesh(limbGeo, bowMat);
        lowerLimb.position.set(0, -0.5, -0.15);  // Back and down
        lowerLimb.rotation.x = Math.PI / 5;  // Angle backward
        group.add(lowerLimb);
        
        // Bowstring - connects limb tips, in front of grip
        const stringGeo = new THREE.BoxGeometry(0.02, 1.25, 0.02);
        const stringMat = new THREE.MeshLambertMaterial({ color: 0xEEEEEE });  // Light gray
        const bowstring = new THREE.Mesh(stringGeo, stringMat);
        this.startStringZ = -0.25;
        bowstring.position.set(0, 0, this.startStringZ );  // In front of grip
        group.add(bowstring);
        
        // Store reference to bowstring for animation
        group.userData.bowstring = bowstring;
        
        // Position bow at hero's side, pointing forward
        // Use mounted position since hero starts mounted
        const pos = Bow.MOUNTED_POSITION;
        group.position.set(pos.x, pos.y, pos.z);
        group.rotation.z = -Math.PI / 4;  // Angled 45Â° to the right        
        
        group.castShadow = true;
        
        return group;
    }
    
    /**
     * Trigger bow draw animation
     */
    startDraw() {
        this.isDrawing = true;
        this.drawAmount = 0;
    }
    
    /**
     * Release arrow (reset bow)
     */
    release() {
        this.isDrawing = false;
        this.drawAmount = 0;
    }
    
    /**
     * Update bow animation
     */
    update(deltaTime) {
        // Draw animation
        if (this.isDrawing && this.drawAmount < 1) {
            this.drawAmount = Math.min(1, this.drawAmount + deltaTime * 5);
        } else if (!this.isDrawing && this.drawAmount > 0) {
            this.drawAmount = Math.max(0, this.drawAmount - deltaTime * 10);
        }
        
        // Animate bowstring pull (pulls backward toward grip)
        const bowstring = this.mesh.userData.bowstring;
        if (bowstring) {
            bowstring.position.z = this.startStringZ - this.drawAmount * 0.25;  // Pull back
        }
    }
    
    destroy() {
        if (this.mesh.parent) {
            this.mesh.parent.remove(this.mesh);
        }
        this.mesh.traverse((child) => {
            if (child.geometry) child.geometry.dispose();
            if (child.material) child.material.dispose();
        });
    }
}