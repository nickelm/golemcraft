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
        this.body = this.mesh.userData.body;
        this.tail = this.mesh.userData.tail;
        this.neckGroup = this.mesh.userData.neckGroup;
    }
    
    createMesh() {
        const group = new THREE.Group();
        
        // Vertical offset - the model is built with legs ending at y=0
        // but we position pivot at ground level
        const yOffset = 0;
        
        // === MOUNT (Horse) ===
        // Body - box along Z axis (facing forward)
        const bodyGeo = new THREE.BoxGeometry(0.6, 0.8, 1.4);
        const bodyMat = new THREE.MeshLambertMaterial({ color: 0x8B4513 });
        const body = new THREE.Mesh(bodyGeo, bodyMat);
        body.position.set(0, 1.0 + yOffset, 0);
        body.castShadow = true;
        body.receiveShadow = true;
        group.add(body);
        
        // Store reference on group for animation
        group.userData.body = body;
        
        // Neck+Head group for animation (bobs forward/back while walking)
        const neckGroup = new THREE.Group();
        neckGroup.position.set(0, 1.0 + yOffset, 0.7); // Pivot point at base of neck
        group.add(neckGroup);
        group.userData.neckGroup = neckGroup;
        
        // Neck - angled forward (positions relative to neckGroup)
        const neckGeo = new THREE.BoxGeometry(0.25, 0.6, 0.25);
        const neck = new THREE.Mesh(neckGeo, bodyMat);
        neck.rotation.x = Math.PI / 3; // Angled forward
        neck.position.set(0, 0.2, 0.1);
        neck.castShadow = true;
        neckGroup.add(neck);
        
        // Head - longer and thinner for horse-like appearance
        const headGeo = new THREE.BoxGeometry(0.22, 0.3, 0.65);
        const horseHead = new THREE.Mesh(headGeo, bodyMat);
        horseHead.position.set(0, 0.35, 0.55);
        horseHead.rotation.x = Math.PI / 8; // Angled down slightly
        horseHead.castShadow = true;
        neckGroup.add(horseHead);

        // Ears - small pyramids pointing up, positioned on top of head
        const earGeo = new THREE.ConeGeometry(0.06, 0.18, 4);
        const leftEar = new THREE.Mesh(earGeo, bodyMat);
        leftEar.position.set(0.08, 0.7, 0.35);
        leftEar.castShadow = true;
        neckGroup.add(leftEar);
        
        const rightEar = new THREE.Mesh(earGeo, bodyMat);
        rightEar.position.set(-0.08, 0.7, 0.35);
        rightEar.castShadow = true;
        neckGroup.add(rightEar);
        
        // Legs (4 boxes) - store for animation
        // Legs are 1.0 tall, attached at body bottom (y=0.6), extending to y=0
        const legGeo = new THREE.BoxGeometry(0.2, 0.6, 0.2);
        // Shift geometry down so rotation pivot is at top
        legGeo.translate(0, -0.3, 0);
        
        const legMat = new THREE.MeshLambertMaterial({ color: 0x8B4513 }); // Same as body
        const legPositions = [
            { pos: [-0.2, 0.6 + yOffset, 0.45], name: 'frontLeft', isFront: true },
            { pos: [0.2, 0.6 + yOffset, 0.45], name: 'frontRight', isFront: true },
            { pos: [-0.2, 0.6 + yOffset, -0.45], name: 'backLeft', isFront: false },
            { pos: [0.2, 0.6 + yOffset, -0.45], name: 'backRight', isFront: false }
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

        // Tail - attached to back of body (body extends to z=-0.7)
        const tailGeo = new THREE.BoxGeometry(0.1, 0.6, 0.1);

        // Translate so pivot is at base (top attachment point)
        tailGeo.translate(0, -0.3, 0);
        const tail = new THREE.Mesh(tailGeo, bodyMat);
        tail.position.set(0, 1.2 + yOffset, -0.7); // Attach at back of body
        tail.rotation.x = Math.PI / 4; // Angle down/back
        tail.castShadow = true;
        group.add(tail);
        
        // Store reference on group for animation
        group.userData.tail = tail;
        
        // === RIDER (Hero) ===
        // Saddle - on top of body
        const saddleGeo = new THREE.BoxGeometry(0.6, 0.12, 0.5);
        const saddleMat = new THREE.MeshLambertMaterial({ color: 0x654321 }); // Darker brown
        const saddle = new THREE.Mesh(saddleGeo, saddleMat);
        saddle.position.set(0, 1.46 + yOffset, 0);
        saddle.castShadow = true;
        group.add(saddle);

        // Torso - sitting on saddle (saddle top at ~1.52, torso is 0.6 tall, center at 1.52 + 0.3 = 1.82)
        const torsoGeo = new THREE.BoxGeometry(0.4, 0.6, 0.35);
        const heroMat = new THREE.MeshLambertMaterial({ color: 0x0066cc });
        const torso = new THREE.Mesh(torsoGeo, heroMat);
        torso.position.set(0, 1.82 + yOffset, 0);
        torso.castShadow = true;
        group.add(torso);
        
        // Head
        const heroHeadGeo = new THREE.BoxGeometry(0.4, 0.4, 0.4);
        const heroHead = new THREE.Mesh(heroHeadGeo, heroMat);
        heroHead.position.set(0, 2.32 + yOffset, 0);
        heroHead.castShadow = true;
        group.add(heroHead);

        // Helmet/Visor
        const visorGeo = new THREE.BoxGeometry(0.3, 0.08, 0.25);
        const visorMat = new THREE.MeshLambertMaterial({ color: 0x003366 });
        const visor = new THREE.Mesh(visorGeo, visorMat);
        visor.position.set(0, 2.32 + yOffset, 0.12);
        group.add(visor);
        
        // Store references for first-person visibility toggle
        group.userData.heroHead = heroHead;
        group.userData.visor = visor;
        
        
        // Note: Arms removed - weapon (bow) will be added by Hero class
        
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
            
            // Neck/head bobs forward and back while walking (like a real horse)
            if (this.neckGroup) {
                const neckBob = Math.sin(this.animationTime * 8) * 0.15;
                this.neckGroup.rotation.x = neckBob;
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
            
            // Neck returns to rest
            if (this.neckGroup) {
                this.neckGroup.rotation.x *= 0.9;
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
     * Set visibility of hero's head (for first-person mode)
     * @param {boolean} visible - Whether head should be visible
     */
    setHeadVisible(visible) {
        const heroHead = this.mesh.userData.heroHead;
        const visor = this.mesh.userData.visor;
        if (heroHead) heroHead.visible = visible;
        if (visor) visor.visible = visible;
    }
    
    /**
     * Remove from scene
     */
    destroy() {
        this.scene.remove(this.mesh);
    }
}

/**
 * HeroOnFoot - A hero character walking on foot (dismounted)
 *
 * This class creates a standing hero mesh with animations for:
 * - Walking (leg stride, arm swing)
 * - Idle (breathing animation)
 * - Jumping (legs apart)
 *
 * Usage:
 *   const heroOnFoot = new HeroOnFoot(scene, position);
 *
 *   // In update loop:
 *   heroOnFoot.update(deltaTime, isMoving, isJumping);
 *
 *   // To rotate:
 *   heroOnFoot.setRotation(angle);
 *
 *   // To move:
 *   heroOnFoot.mesh.position.set(x, y, z);
 */
export class HeroOnFoot {
    constructor(scene, position = new THREE.Vector3(0, 0, 0)) {
        this.scene = scene;
        this.animationTime = 0;
        this.bobOffset = 0; // Store bob separately from position

        // Create the hero mesh
        this.mesh = this.createMesh();
        this.mesh.position.copy(position);

        // Add to scene
        this.scene.add(this.mesh);

        // Store references to animated parts (stored in mesh.userData during creation)
        this.legs = this.mesh.userData.legs;
        this.arms = this.mesh.userData.arms;
        this.torso = this.mesh.userData.torso;
    }

    createMesh() {
        const group = new THREE.Group();

        // Hero material - blue armor
        const heroMat = new THREE.MeshLambertMaterial({ color: 0x0066cc });
        const darkMat = new THREE.MeshLambertMaterial({ color: 0x003366 });

        // === LEGS ===
        // Legs are 0.8 tall, attached at hip (y=0.8), extending to y=0
        const legGeo = new THREE.BoxGeometry(0.15, 0.8, 0.15);
        // Shift geometry down so rotation pivot is at top (hip)
        legGeo.translate(0, -0.4, 0);

        const legs = [];
        const legPositions = [
            { pos: [-0.1, 0.8, 0], name: 'left' },
            { pos: [0.1, 0.8, 0], name: 'right' }
        ];

        legPositions.forEach(({ pos, name }, index) => {
            const leg = new THREE.Mesh(legGeo, heroMat);
            leg.position.set(...pos);
            leg.castShadow = true;
            leg.userData.name = name;
            leg.userData.index = index;
            legs.push(leg);
            group.add(leg);
        });

        group.userData.legs = legs;

        // === TORSO ===
        // Torso sits above legs (legs end at y=0.8, torso is 0.6 tall, center at 1.4)
        const torsoGeo = new THREE.BoxGeometry(0.4, 0.6, 0.25);
        const torso = new THREE.Mesh(torsoGeo, heroMat);
        torso.position.set(0, 1.4, 0);
        torso.castShadow = true;
        group.add(torso);
        group.userData.torso = torso;

        // === ARMS ===
        // Arms attached at shoulder height (y=1.6), 0.6 tall
        const armGeo = new THREE.BoxGeometry(0.12, 0.6, 0.12);
        // Shift geometry down so rotation pivot is at top (shoulder)
        armGeo.translate(0, -0.3, 0);

        const arms = [];
        const armPositions = [
            { pos: [-0.26, 1.6, 0], name: 'left' },
            { pos: [0.26, 1.6, 0], name: 'right' }
        ];

        armPositions.forEach(({ pos, name }, index) => {
            const arm = new THREE.Mesh(armGeo, heroMat);
            arm.position.set(...pos);
            arm.castShadow = true;
            arm.userData.name = name;
            arm.userData.index = index;
            arms.push(arm);
            group.add(arm);
        });

        group.userData.arms = arms;

        // === HEAD ===
        const headGeo = new THREE.BoxGeometry(0.3, 0.3, 0.3);
        const heroHead = new THREE.Mesh(headGeo, heroMat);
        heroHead.position.set(0, 1.9, 0);
        heroHead.castShadow = true;
        group.add(heroHead);
        group.userData.heroHead = heroHead;

        // Helmet/Visor
        const visorGeo = new THREE.BoxGeometry(0.22, 0.06, 0.18);
        const visor = new THREE.Mesh(visorGeo, darkMat);
        visor.position.set(0, 1.9, 0.1);
        group.add(visor);
        group.userData.visor = visor;

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
            // JUMP ANIMATION - legs apart, arms up
            if (this.legs) {
                this.legs[0].rotation.x = 0.3;  // Left leg forward
                this.legs[1].rotation.x = -0.3; // Right leg back
            }

            if (this.arms) {
                this.arms[0].rotation.x = -0.5; // Left arm up
                this.arms[1].rotation.x = -0.5; // Right arm up
            }

        } else if (isMoving) {
            // WALKING ANIMATION - bipedal walk cycle with opposing arm/leg swing

            // Leg stride animation (opposite phase)
            // Left leg positive phase, right leg negative (opposition)
            if (this.legs) {
                const legAngle = Math.sin(this.animationTime * 6) * 0.6;
                this.legs[0].rotation.x = legAngle;   // Left leg
                this.legs[1].rotation.x = -legAngle;  // Right leg (opposite)
            }

            // Arm swing (opposite to legs for natural walk)
            // Left arm swings with right leg, right arm with left leg
            if (this.arms) {
                const armAngle = Math.sin(this.animationTime * 6) * 0.4;
                this.arms[0].rotation.x = -armAngle;  // Left arm (opposite to left leg)
                this.arms[1].rotation.x = armAngle;   // Right arm (opposite to right leg)
            }

            // Slight torso bob (double frequency for up-down per step)
            this.bobOffset = Math.sin(this.animationTime * 12) * 0.03;

        } else {
            // IDLE ANIMATION

            // Return limbs to rest position
            if (this.legs) {
                this.legs.forEach(leg => {
                    leg.rotation.x *= 0.9;
                });
            }

            if (this.arms) {
                this.arms.forEach(arm => {
                    arm.rotation.x *= 0.9;
                });
            }

            // Reset bob offset
            this.bobOffset *= 0.9;

            // Breathing animation - subtle torso expansion
            if (this.torso) {
                const breathe = Math.sin(this.animationTime * 2) * 0.04 + 1.0;
                this.torso.scale.set(breathe, 1.0, breathe);
            }
        }
    }

    /**
     * Set the rotation (facing direction) of the hero
     * @param {number} rotationY - Rotation around Y axis in radians
     */
    setRotation(rotationY) {
        this.mesh.rotation.y = rotationY;
    }

    /**
     * Set visibility of hero's head (for first-person mode)
     * @param {boolean} visible - Whether head should be visible
     */
    setHeadVisible(visible) {
        const heroHead = this.mesh.userData.heroHead;
        const visor = this.mesh.userData.visor;
        if (heroHead) heroHead.visible = visible;
        if (visor) visor.visible = visible;
    }

    /**
     * Remove from scene
     */
    destroy() {
        this.scene.remove(this.mesh);
    }
}