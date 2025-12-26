import * as THREE from 'three';

/**
 * HeroMount - A hero character riding a mount (horse)
 * 
 * This class creates a combined hero+mount mesh with animations for:
 * - Walking (leg gallop, body bob, arm swing, tail sway)
 * - Idle (breathing animation)
 * - Jumping (legs stretch forward/back)
 * 
 * Usage:
 *   const heroMount = new HeroMount(scene, position);
 *   
 *   // In update loop:
 *   heroMount.update(deltaTime, isMoving, isJumping);
 *   
 *   // To rotate:
 *   heroMount.setRotation(angle);
 *   
 *   // To move:
 *   heroMount.mesh.position.set(x, y, z);
 */
export class HeroMount {
    constructor(scene, position = new THREE.Vector3(0, 0, 0)) {
        this.scene = scene;
        this.animationTime = 0;
        this.bobOffset = 0; // Store bob separately from position
        
        // Create the combined mesh
        this.mesh = this.createMesh();
        this.mesh.position.copy(position);
        
        // Add to scene
        this.scene.add(this.mesh);
        
        // Store references to animated parts (stored in mesh.userData during creation)
        this.legs = this.mesh.userData.legs;
        this.leftArm = this.mesh.userData.leftArm;
        this.rightArm = this.mesh.userData.rightArm;
        this.body = this.mesh.userData.body;
        this.tail = this.mesh.userData.tail;
    }
    
    createMesh() {
        const group = new THREE.Group();
        
        // === MOUNT (Horse) ===
        // Body - box along Z axis (facing forward)
        const bodyGeo = new THREE.BoxGeometry(0.8, 0.8, 1.4);
        const bodyMat = new THREE.MeshLambertMaterial({ color: 0x8B4513 });
        const body = new THREE.Mesh(bodyGeo, bodyMat);
        body.position.set(0, 1.2, 0);
        body.castShadow = true;
        group.add(body);
        
        // Store reference on group for animation
        group.userData.body = body;
        
        // Neck - angled forward
        const neckGeo = new THREE.BoxGeometry(0.3, 0.6, 0.3);
        const neck = new THREE.Mesh(neckGeo, bodyMat);
        neck.rotation.x = Math.PI / 3; // Angled forward
        neck.position.set(0, 1.4, 0.8);
        neck.castShadow = true;
        group.add(neck);
        
        // Head - boxy shape angled downward
        const headGeo = new THREE.BoxGeometry(0.3, 0.4, 0.5);
        const head = new THREE.Mesh(headGeo, bodyMat);
        head.position.set(0, 1.6, 1.15);
        head.rotation.x = Math.PI / 6; // Angled down slightly
        head.castShadow = true;
        group.add(head);

        // Ears
        const earGeo = new THREE.TetrahedronGeometry(0.15);
        const leftEar = new THREE.Mesh(earGeo, bodyMat);
        leftEar.position.set(0.08, 1.95, 1.1);
        leftEar.castShadow = true;
        group.add(leftEar);
        
        const rightEar = new THREE.Mesh(earGeo, bodyMat);
        rightEar.position.set(-0.08, 1.95, 1.1);
        rightEar.castShadow = true;
        group.add(rightEar);
        
        // Legs (4 boxes) - store for animation
        const legGeo = new THREE.BoxGeometry(0.2, 1.2, 0.2);
        // Shift geometry down so rotation pivot is at top
        legGeo.translate(0, -0.6, 0);
        
        const legMat = new THREE.MeshLambertMaterial({ color: 0x8B4513 }); // Same as body
        const legPositions = [
            { pos: [-0.3, 1.2, 0.5], name: 'frontLeft', isFront: true },
            { pos: [0.3, 1.2, 0.5], name: 'frontRight', isFront: true },
            { pos: [-0.3, 1.2, -0.5], name: 'backLeft', isFront: false },
            { pos: [0.3, 1.2, -0.5], name: 'backRight', isFront: false }
        ];
        
        const legs = [];
        legPositions.forEach(({ pos, name, isFront }) => {
            const leg = new THREE.Mesh(legGeo, legMat);
            leg.position.set(...pos);
            leg.castShadow = true;
            leg.userData.name = name;
            leg.userData.isFront = isFront;
            legs.push(leg);
            group.add(leg);
        });
        
        // Store reference on group for animation
        group.userData.legs = legs;

        // Tail
        const tailGeo = new THREE.BoxGeometry(0.1, 0.8, 0.1);
        // Translate so pivot is at base (top attachment point)
        tailGeo.translate(0, -0.4, 0);
        const tail = new THREE.Mesh(tailGeo, bodyMat);
        tail.position.set(0, 1.3, -0.8);
        tail.rotation.x = Math.PI / 6;
        tail.castShadow = true;
        group.add(tail);
        
        // Store reference on group for animation
        group.userData.tail = tail;
        
        // === RIDER (Hero) ===
        // Saddle
        const saddleGeo = new THREE.BoxGeometry(0.6, 0.15, 0.7);
        const saddleMat = new THREE.MeshLambertMaterial({ color: 0x654321 }); // Darker brown
        const saddle = new THREE.Mesh(saddleGeo, saddleMat);
        saddle.position.set(0, 1.6, 0);
        saddle.castShadow = true;
        group.add(saddle);

        // Torso
        const torsoGeo = new THREE.BoxGeometry(0.5, 0.7, 0.5);
        const heroMat = new THREE.MeshLambertMaterial({ color: 0x0066cc });
        const torso = new THREE.Mesh(torsoGeo, heroMat);
        torso.position.set(0, 2.1, 0);
        torso.castShadow = true;
        group.add(torso);
        
        // Head
        const heroHeadGeo = new THREE.BoxGeometry(0.5, 0.5, 0.5);
        const heroHead = new THREE.Mesh(heroHeadGeo, heroMat);
        heroHead.position.set(0, 2.65, 0);
        heroHead.castShadow = true;
        group.add(heroHead);

        // Helmet/Visor
        const visorGeo = new THREE.BoxGeometry(0.35, 0.08, 0.32);
        const visorMat = new THREE.MeshLambertMaterial({ color: 0x003366 });
        const visor = new THREE.Mesh(visorGeo, visorMat);
        visor.position.set(0, 2.65, 0.14);
        group.add(visor);
        
        // Arms (2 boxes) - hanging down naturally
        const armGeo = new THREE.BoxGeometry(0.15, 0.6, 0.15);
        // Translate so pivot is at top (shoulder)
        armGeo.translate(0, -0.3, 0);
        
        const leftArm = new THREE.Mesh(armGeo, heroMat);
        leftArm.position.set(-0.4, 2.45, 0); // At shoulder height
        leftArm.rotation.z = -0.1; // Slight outward angle (negative for left)
        leftArm.castShadow = true;
        group.add(leftArm);
        
        const rightArm = new THREE.Mesh(armGeo, heroMat);
        rightArm.position.set(0.4, 2.45, 0); // At shoulder height
        rightArm.rotation.z = 0.1; // Slight outward angle (positive for right)
        rightArm.castShadow = true;
        group.add(rightArm);
        
        // Store references on group for animation
        group.userData.leftArm = leftArm;
        group.userData.rightArm = rightArm;
        
        return group;
    }
    
    /**
     * Update animation state
     * @param {number} deltaTime - Time since last frame in seconds
     * @param {boolean} isMoving - Whether the hero is moving
     * @param {boolean} isJumping - Whether the hero is jumping
     */
    update(deltaTime, isMoving = false, isJumping = false) {
        this.animationTime += deltaTime;
        
        if (isJumping) {
            // JUMP ANIMATION - legs stretch forward and backward
            if (this.legs) {
                this.legs.forEach((leg) => {
                    if (leg.userData.isFront) {
                        leg.rotation.x = -0.8; // Front legs forward
                    } else {
                        leg.rotation.x = 0.8; // Back legs backward
                    }
                });
            }
            
            // Arms out during jump
            if (this.leftArm && this.rightArm) {
                this.leftArm.rotation.x = -0.3;
                this.rightArm.rotation.x = -0.3;
            }
            
            // No tail swing during jump
            if (this.tail) {
                this.tail.rotation.z = 0;
            }
            
        } else if (isMoving) {
            // WALKING ANIMATION
            
            // Galloping legs animation
            if (this.legs) {
                this.legs.forEach((leg, index) => {
                    const offset = index * Math.PI / 2;
                    const swing = Math.sin(this.animationTime * 8 + offset) * 0.5;
                    leg.rotation.x = swing;
                });
            }

            // Body bob up and down during walk - store as offset
            this.bobOffset = Math.sin(this.animationTime * 8) * 0.05;

            // Arms swing back and forth (forward/backward, not side to side)
            if (this.leftArm && this.rightArm) {
                const armSwing = Math.sin(this.animationTime * 4) * 0.3;
                this.leftArm.rotation.x = armSwing;
                this.rightArm.rotation.x = -armSwing; // Opposite direction
            }
            
            // Tail swings side to side
            if (this.tail) {
                const tailSwing = Math.sin(this.animationTime * 6) * 0.3;
                this.tail.rotation.z = tailSwing;
            }
            
        } else {
            // IDLE ANIMATION
            
            // Legs return to rest position
            if (this.legs) {
                this.legs.forEach((leg) => {
                    leg.rotation.x *= 0.9;
                });
            }
            
            // Reset body bob offset
            this.bobOffset *= 0.9;
            
            // Arms return to rest
            if (this.leftArm && this.rightArm) {
                this.leftArm.rotation.x *= 0.9;
                this.rightArm.rotation.x *= 0.9;
            }
            
            // Tail returns to rest
            if (this.tail) {
                this.tail.rotation.z *= 0.9;
            }
            
            // Breathing animation - visible body expansion
            if (this.body) {
                const breathe = Math.sin(this.animationTime * 2) * 0.06 + 1.0; // 1.0 to 1.06 scale
                this.body.scale.set(breathe, 1.0, breathe); // Expand width, not height
            }
        }
    }
    
    /**
     * Set the rotation (facing direction) of the hero+mount
     * @param {number} rotationY - Rotation around Y axis in radians
     */
    setRotation(rotationY) {
        this.mesh.rotation.y = rotationY;
    }
    
    /**
     * Remove from scene
     */
    destroy() {
        this.scene.remove(this.mesh);
    }
}