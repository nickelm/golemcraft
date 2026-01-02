import * as THREE from 'three';
import { resolveEntityCollision, AABB } from './collision.js';

/**
 * Mob Definitions
 * 
 * Passive mobs: Cannot be attacked, wander aimlessly
 * Hostile mobs: Can be killed for XP, aggro on player within range
 */

export const MOB_TYPES = {
    // Passive animals
    cow: {
        name: 'Cow',
        hostile: false,
        health: 10,
        speed: 1.5,
        biomes: ['plains'],
        spawnWeight: 30,
        xp: 0,
        color: 0x8B4513,  // Brown
        secondaryColor: 0xFFFFFF,  // White patches
        size: { width: 0.9, height: 1.0, depth: 1.4 }
    },
    pig: {
        name: 'Pig',
        hostile: false,
        health: 8,
        speed: 1.8,
        biomes: ['plains'],
        spawnWeight: 35,
        xp: 0,
        color: 0xFFB6C1,  // Pink
        secondaryColor: 0xFF9999,
        size: { width: 0.6, height: 0.6, depth: 0.9 }
    },
    chicken: {
        name: 'Chicken',
        hostile: false,
        health: 4,
        speed: 2.0,
        biomes: ['plains', 'desert'],
        spawnWeight: 40,
        xp: 0,
        color: 0xFFFFFF,  // White
        secondaryColor: 0xFF0000,  // Red comb
        size: { width: 0.3, height: 0.5, depth: 0.4 }
    },
    
    // Hostile mobs
    zombie: {
        name: 'Zombie',
        hostile: true,
        health: 25,  // 2 shots (arrows do 10-15 damage)
        speed: 2.0,
        damage: 5,
        biomes: ['plains', 'snow', 'desert'],
        spawnWeight: 30,
        xp: 10,
        color: 0x567d46,  // Green-gray
        secondaryColor: 0x4a6b3d,
        size: { width: 0.6, height: 1.8, depth: 0.4 }
    },
    skeleton: {
        name: 'Skeleton',
        hostile: true,
        health: 22,  // 2 shots
        speed: 2.5,
        damage: 4,
        ranged: true,  // Skeletons shoot arrows!
        attackRange: 15,
        biomes: ['plains', 'snow', 'mountains'],
        spawnWeight: 25,
        xp: 12,
        color: 0xE0E0E0,  // Bone white
        secondaryColor: 0x333333,  // Dark eyes
        size: { width: 0.5, height: 1.8, depth: 0.3 }
    },
    creeper: {
        name: 'Creeper',
        hostile: true,
        health: 35,  // 3 shots
        speed: 1.8,
        damage: 15,  // Explodes! (for later)
        biomes: ['plains', 'desert'],
        spawnWeight: 15,
        xp: 20,
        color: 0x00AA00,  // Green
        secondaryColor: 0x000000,  // Black face
        size: { width: 0.5, height: 1.5, depth: 0.5 }
    }
};

/**
 * Base Mob class - handles movement, AI state, physics
 */
export class Mob {
    constructor(scene, position, type) {
        this.scene = scene;
        this.type = type;
        this.config = MOB_TYPES[type];
        
        this.position = position.clone();
        this.velocity = new THREE.Vector3(0, 0, 0);
        this.rotation = Math.random() * Math.PI * 2;
        
        this.health = this.config.health;
        this.maxHealth = this.config.health;
        this.speed = this.config.speed;
        this.hostile = this.config.hostile;
        this.xpValue = this.config.xp;
        
        // Physics
        this.gravity = -35;
        this.onGround = false;
        
        // AI state
        this.state = 'wander';  // 'wander', 'chase', 'idle', 'flee'
        this.target = null;
        this.stateTimer = 0;
        this.wanderDirection = new THREE.Vector3();
        this.pickNewWanderDirection();
        
        // Detection ranges
        this.aggroRange = 11;
        this.leashRange = 25;  // Extended from 15 - mobs chase further before giving up
        
        // Attack cooldown
        this.attackCooldown = 1.0;
        this.timeSinceAttack = 0;
        this.attackRange = this.config.attackRange || 1.5;
        
        // Ranged attack (for skeletons)
        this.isRanged = this.config.ranged || false;
        this.arrowCooldown = 2.0;  // Slower than melee
        this.timeSinceArrow = 0;
        this.pendingArrows = [];  // Arrows to be spawned by game
        
        // Jump ability for getting unstuck
        this.jumpForce = 8;
        this.stuckTimer = 0;
        this.lastPosition = position.clone();
        this.stuckCheckInterval = 0.5;
        this.timeSinceStuckCheck = 0;
        
        // Inventory - resources picked up by mob
        this.inventory = {
            gold: 0,
            wood: 0,
            diamond: 0,
            iron: 0,
            coal: 0
        };
        
        // Item pickup radius
        this.pickupRadius = 1.5;
        
        // Create mesh and AABB
        this.mesh = this.createMesh();
        this.scene.add(this.mesh);
        
        const size = this.config.size;
        this.aabb = new AABB(size.width, size.height, size.depth, 0);
        
        // Death state
        this.dead = false;
        this.deathTimer = 0;
        this.killedByPlayer = false;  // Track if player gets XP
    }
    
    createMesh() {
        // Override in subclasses for specific mob models
        const size = this.config.size;
        const group = new THREE.Group();
        
        const bodyGeo = new THREE.BoxGeometry(size.width, size.height, size.depth);
        const bodyMat = new THREE.MeshLambertMaterial({ color: this.config.color });
        const body = new THREE.Mesh(bodyGeo, bodyMat);
        body.position.y = size.height / 2;
        body.castShadow = true;
        group.add(body);
        
        group.position.copy(this.position);
        return group;
    }
    
    pickNewWanderDirection() {
        const angle = Math.random() * Math.PI * 2;
        this.wanderDirection.set(
            Math.sin(angle),
            0,
            Math.cos(angle)
        );
        this.stateTimer = 2 + Math.random() * 4;  // Wander for 2-6 seconds
    }
    
    update(deltaTime, terrain, playerPosition) {
        if (this.dead) {
            this.deathTimer += deltaTime;
            
            // Spin while dying
            this.mesh.rotation.y += this.deathSpinSpeed * deltaTime;
            
            // Fall over (tilt on X axis)
            const maxTilt = Math.PI / 2;  // 90 degrees
            const tiltProgress = Math.min(1, this.deathTimer * 3);  // Fall over in ~0.33 seconds
            this.mesh.rotation.x = this.deathTiltDirection * maxTilt * tiltProgress;
            
            // Sink into ground faster after falling over
            if (tiltProgress >= 1) {
                this.mesh.position.y -= deltaTime * 2.0;  // 4x faster sink
            }
            
            // Fade out
            const fadeStart = 0.5;  // Start fading after 0.5 seconds
            if (this.deathTimer > fadeStart) {
                const fadeProgress = (this.deathTimer - fadeStart) / 0.5;  // Fade over 0.5 seconds
                this.mesh.traverse(child => {
                    if (child.material) {
                        child.material.transparent = true;
                        child.material.opacity = Math.max(0, 1 - fadeProgress);
                    }
                });
            }
            
            return this.deathTimer < 1.0;  // Remove after 1 second (faster)
        }
        
        this.timeSinceAttack += deltaTime;
        this.timeSinceArrow += deltaTime;
        this.stateTimer -= deltaTime;
        
        // Calculate distance to player
        const distanceToPlayer = this.position.distanceTo(playerPosition);
        
        // AI State machine
        this.updateAI(deltaTime, playerPosition, distanceToPlayer);
        
        // Stuck detection - if mob hasn't moved much, try jumping
        this.timeSinceStuckCheck += deltaTime;
        if (this.timeSinceStuckCheck >= this.stuckCheckInterval) {
            const distanceMoved = this.position.distanceTo(this.lastPosition);
            const isMoving = Math.abs(this.velocity.x) > 0.1 || Math.abs(this.velocity.z) > 0.1;
            
            // If trying to move but barely moving, we're stuck
            if (isMoving && distanceMoved < 0.1 && this.onGround) {
                this.stuckTimer += this.stuckCheckInterval;
                
                // Jump after being stuck for 0.5 seconds
                if (this.stuckTimer >= 0.5) {
                    this.jump();
                    this.stuckTimer = 0;
                }
            } else {
                this.stuckTimer = 0;
            }
            
            this.lastPosition.copy(this.position);
            this.timeSinceStuckCheck = 0;
        }
        
        // Apply physics
        if (!this.onGround) {
            this.velocity.y += this.gravity * deltaTime;
        }
        
        resolveEntityCollision(this, terrain, deltaTime);
        
        // Update mesh
        this.mesh.position.copy(this.position);
        this.mesh.rotation.y = this.rotation;
        
        return true;
    }
    
    /**
     * Make mob jump (for getting unstuck)
     */
    jump() {
        if (this.onGround) {
            this.velocity.y = this.jumpForce;
            this.onGround = false;
        }
    }
    
    updateAI(deltaTime, playerPosition, distanceToPlayer) {
        if (this.hostile) {
            this.updateHostileAI(deltaTime, playerPosition, distanceToPlayer);
        } else {
            this.updatePassiveAI(deltaTime, playerPosition, distanceToPlayer);
        }
    }
    
    updateHostileAI(deltaTime, playerPosition, distanceToPlayer) {
        switch (this.state) {
            case 'wander':
                // Check if player is in aggro range
                if (distanceToPlayer < this.aggroRange) {
                    this.state = 'chase';
                    this.target = playerPosition;
                    break;
                }
                
                // Continue wandering
                if (this.stateTimer <= 0) {
                    // Random chance to idle or pick new direction
                    if (Math.random() < 0.3) {
                        this.state = 'idle';
                        this.stateTimer = 1 + Math.random() * 2;
                    } else {
                        this.pickNewWanderDirection();
                    }
                } else {
                    this.moveInDirection(this.wanderDirection, 0.5);
                }
                break;
                
            case 'chase':
                // Check if player escaped
                if (distanceToPlayer > this.leashRange) {
                    this.state = 'wander';
                    this.target = null;
                    this.pickNewWanderDirection();
                    break;
                }
                
                // Ranged mobs (skeletons) - stop and shoot when in range
                if (this.isRanged && distanceToPlayer <= this.attackRange) {
                    // Stop moving and shoot
                    this.velocity.x = 0;
                    this.velocity.z = 0;
                    
                    // Face player
                    const aimDir = new THREE.Vector3()
                        .subVectors(playerPosition, this.position)
                        .normalize();
                    this.rotation = Math.atan2(aimDir.x, aimDir.z);
                    
                    // Shoot arrow if cooldown ready
                    if (this.timeSinceArrow >= this.arrowCooldown) {
                        this.shootArrow(playerPosition);
                        this.timeSinceArrow = 0;
                    }
                    break;
                }
                
                // Move toward player
                const chaseDir = new THREE.Vector3()
                    .subVectors(playerPosition, this.position)
                    .normalize();
                chaseDir.y = 0;
                this.moveInDirection(chaseDir, 1.0);
                
                // Face player
                this.rotation = Math.atan2(chaseDir.x, chaseDir.z);
                break;
                
            case 'idle':
                if (this.stateTimer <= 0) {
                    this.state = 'wander';
                    this.pickNewWanderDirection();
                }
                // Check for player even while idle
                if (distanceToPlayer < this.aggroRange) {
                    this.state = 'chase';
                    this.target = playerPosition;
                }
                break;
        }
    }
    
    /**
     * Shoot an arrow at target (for skeletons)
     */
    shootArrow(targetPosition) {
        // Arrow starts at chest height
        const startPos = this.position.clone();
        startPos.y += 1.2;
        
        // Random damage between 5-10
        const damage = 5 + Math.floor(Math.random() * 6);
        
        // Queue arrow to be created by game (we don't have scene access for Arrow)
        this.pendingArrows.push({
            start: startPos,
            target: targetPosition.clone(),
            damage: damage
        });
    }
    
    /**
     * Get and clear pending arrows (called by game to spawn them)
     */
    getPendingArrows() {
        const arrows = this.pendingArrows;
        this.pendingArrows = [];
        return arrows;
    }
    
    updatePassiveAI(deltaTime, playerPosition, distanceToPlayer) {
        switch (this.state) {
            case 'wander':
                if (this.stateTimer <= 0) {
                    if (Math.random() < 0.4) {
                        this.state = 'idle';
                        this.stateTimer = 2 + Math.random() * 3;
                    } else {
                        this.pickNewWanderDirection();
                    }
                } else {
                    this.moveInDirection(this.wanderDirection, 0.4);
                }
                break;
                
            case 'idle':
                if (this.stateTimer <= 0) {
                    this.state = 'wander';
                    this.pickNewWanderDirection();
                }
                break;
        }
    }
    
    moveInDirection(direction, speedMultiplier = 1.0) {
        const moveSpeed = this.speed * speedMultiplier;
        this.velocity.x = direction.x * moveSpeed;
        this.velocity.z = direction.z * moveSpeed;
        
        // Face movement direction
        if (direction.lengthSq() > 0.01) {
            this.rotation = Math.atan2(direction.x, direction.z);
        }
    }
    
    /**
     * Check if this mob can be damaged (hostile only)
     */
    canBeDamaged() {
        return this.hostile && !this.dead;
    }
    
    takeDamage(amount) {
        if (!this.canBeDamaged()) return false;
        
        this.health -= amount;
        
        // Store original colors if not already stored
        if (!this.originalColors) {
            this.originalColors = [];
            this.mesh.traverse(child => {
                if (child.material) {
                    this.originalColors.push({
                        mesh: child,
                        color: child.material.color.getHex()
                    });
                }
            });
        }
        
        // Flash red
        this.mesh.traverse(child => {
            if (child.material) {
                child.material.color.setHex(0xFF0000);
            }
        });
        
        // Restore original colors after 100ms
        setTimeout(() => {
            if (!this.dead) {
                this.originalColors.forEach(({ mesh, color }) => {
                    if (mesh.material) {
                        mesh.material.color.setHex(color);
                    }
                });
            }
        }, 100);
        
        // Aggro when shot - hostile mobs start chasing
        if (this.hostile && this.state !== 'chase') {
            this.state = 'chase';
        }
        
        if (this.health <= 0) {
            this.killedByPlayer = true;  // Player caused this death
            this.die();
            return true;  // Killed
        }
        return false;
    }
    
    die() {
        this.dead = true;
        this.deathTimer = 0;
        this.velocity.set(0, 0, 0);
        
        // Random spin direction
        this.deathSpinSpeed = (Math.random() > 0.5 ? 1 : -1) * (3 + Math.random() * 2);
        
        // Fall over direction (tilt forward or backward)
        this.deathTiltDirection = Math.random() > 0.5 ? 1 : -1;
    }
    
    /**
     * Check if mob can attack target at position
     */
    canAttack(targetPosition) {
        if (!this.hostile || this.dead) return false;
        if (this.timeSinceAttack < this.attackCooldown) return false;
        
        const distance = this.position.distanceTo(targetPosition);
        return distance < this.attackRange;
    }
    
    /**
     * Perform attack, returns damage dealt
     */
    attack() {
        if (this.timeSinceAttack < this.attackCooldown) return 0;
        this.timeSinceAttack = 0;
        return this.config.damage || 0;
    }
    
    /**
     * Try to pick up an item
     * Returns true if item was picked up
     */
    tryPickupItem(item) {
        if (this.dead) return false;
        
        const distance = this.position.distanceTo(item.position);
        if (distance > this.pickupRadius) return false;
        
        // Food heals the mob
        if (item.type === 'food') {
            const oldHealth = this.health;
            this.health = Math.min(this.maxHealth, this.health + item.value);
            // Food is consumed, not stored
            return true;
        }
        
        // Store resource in inventory
        if (this.inventory.hasOwnProperty(item.type)) {
            this.inventory[item.type] += item.value;
            return true;
        }
        
        return false;
    }
    
    /**
     * Get inventory contents (for dropping on death)
     */
    getInventory() {
        return { ...this.inventory };
    }
    
    /**
     * Check if mob has any items
     */
    hasItems() {
        return Object.values(this.inventory).some(v => v > 0);
    }
    
    destroy() {
        this.scene.remove(this.mesh);
        this.mesh.traverse(child => {
            if (child.geometry) child.geometry.dispose();
            if (child.material) child.material.dispose();
        });
    }
}

/**
 * Cow - Large passive mob with white patches
 */
export class Cow extends Mob {
    constructor(scene, position) {
        super(scene, position, 'cow');
    }
    
    createMesh() {
        const group = new THREE.Group();
        const mat = new THREE.MeshLambertMaterial({ color: this.config.color });
        const whiteMat = new THREE.MeshLambertMaterial({ color: this.config.secondaryColor });
        
        // Body - horizontal box
        const bodyGeo = new THREE.BoxGeometry(0.9, 0.8, 1.4);
        const body = new THREE.Mesh(bodyGeo, mat);
        body.position.set(0, 0.7, 0);
        body.castShadow = true;
        group.add(body);
        
        // White patches on body
        const patchGeo = new THREE.BoxGeometry(0.4, 0.3, 0.5);
        const patch1 = new THREE.Mesh(patchGeo, whiteMat);
        patch1.position.set(0.3, 0.8, 0.2);
        group.add(patch1);
        
        const patch2 = new THREE.Mesh(patchGeo, whiteMat);
        patch2.position.set(-0.2, 0.6, -0.3);
        group.add(patch2);
        
        // Head
        const headGeo = new THREE.BoxGeometry(0.5, 0.5, 0.4);
        const head = new THREE.Mesh(headGeo, mat);
        head.position.set(0, 0.9, 0.8);
        head.castShadow = true;
        group.add(head);
        
        // Snout (lighter)
        const snoutGeo = new THREE.BoxGeometry(0.3, 0.2, 0.15);
        const snout = new THREE.Mesh(snoutGeo, whiteMat);
        snout.position.set(0, 0.75, 1.0);
        group.add(snout);
        
        // Horns
        const hornGeo = new THREE.BoxGeometry(0.08, 0.2, 0.08);
        const hornMat = new THREE.MeshLambertMaterial({ color: 0xCCCCCC });
        const leftHorn = new THREE.Mesh(hornGeo, hornMat);
        leftHorn.position.set(-0.2, 1.2, 0.75);
        leftHorn.rotation.z = -0.3;
        group.add(leftHorn);
        
        const rightHorn = new THREE.Mesh(hornGeo, hornMat);
        rightHorn.position.set(0.2, 1.2, 0.75);
        rightHorn.rotation.z = 0.3;
        group.add(rightHorn);
        
        // Legs (4)
        const legGeo = new THREE.BoxGeometry(0.2, 0.5, 0.2);
        const legPositions = [
            [-0.3, 0.25, 0.5],
            [0.3, 0.25, 0.5],
            [-0.3, 0.25, -0.5],
            [0.3, 0.25, -0.5]
        ];
        legPositions.forEach(pos => {
            const leg = new THREE.Mesh(legGeo, mat);
            leg.position.set(...pos);
            leg.castShadow = true;
            group.add(leg);
        });
        
        // Udder (pink)
        const udderGeo = new THREE.BoxGeometry(0.25, 0.15, 0.25);
        const udderMat = new THREE.MeshLambertMaterial({ color: 0xFFB6C1 });
        const udder = new THREE.Mesh(udderGeo, udderMat);
        udder.position.set(0, 0.35, -0.3);
        group.add(udder);
        
        group.position.copy(this.position);
        return group;
    }
}

/**
 * Pig - Small pink passive mob
 */
export class Pig extends Mob {
    constructor(scene, position) {
        super(scene, position, 'pig');
    }
    
    createMesh() {
        const group = new THREE.Group();
        const mat = new THREE.MeshLambertMaterial({ color: this.config.color });
        
        // Body
        const bodyGeo = new THREE.BoxGeometry(0.6, 0.5, 0.9);
        const body = new THREE.Mesh(bodyGeo, mat);
        body.position.set(0, 0.4, 0);
        body.castShadow = true;
        group.add(body);
        
        // Head
        const headGeo = new THREE.BoxGeometry(0.45, 0.4, 0.4);
        const head = new THREE.Mesh(headGeo, mat);
        head.position.set(0, 0.5, 0.55);
        head.castShadow = true;
        group.add(head);
        
        // Snout
        const snoutGeo = new THREE.BoxGeometry(0.25, 0.2, 0.15);
        const snoutMat = new THREE.MeshLambertMaterial({ color: 0xFF9999 });
        const snout = new THREE.Mesh(snoutGeo, snoutMat);
        snout.position.set(0, 0.4, 0.8);
        group.add(snout);
        
        // Ears
        const earGeo = new THREE.BoxGeometry(0.15, 0.12, 0.08);
        const leftEar = new THREE.Mesh(earGeo, mat);
        leftEar.position.set(-0.2, 0.72, 0.5);
        leftEar.rotation.z = -0.3;
        group.add(leftEar);
        
        const rightEar = new THREE.Mesh(earGeo, mat);
        rightEar.position.set(0.2, 0.72, 0.5);
        rightEar.rotation.z = 0.3;
        group.add(rightEar);
        
        // Legs (4 short)
        const legGeo = new THREE.BoxGeometry(0.15, 0.25, 0.15);
        const legPositions = [
            [-0.2, 0.125, 0.3],
            [0.2, 0.125, 0.3],
            [-0.2, 0.125, -0.3],
            [0.2, 0.125, -0.3]
        ];
        legPositions.forEach(pos => {
            const leg = new THREE.Mesh(legGeo, mat);
            leg.position.set(...pos);
            leg.castShadow = true;
            group.add(leg);
        });
        
        // Curly tail
        const tailGeo = new THREE.BoxGeometry(0.08, 0.08, 0.15);
        const tail = new THREE.Mesh(tailGeo, mat);
        tail.position.set(0, 0.5, -0.5);
        tail.rotation.x = -0.5;
        group.add(tail);
        
        group.position.copy(this.position);
        return group;
    }
}

/**
 * Chicken - Small white passive mob with red comb
 */
export class Chicken extends Mob {
    constructor(scene, position) {
        super(scene, position, 'chicken');
    }
    
    createMesh() {
        const group = new THREE.Group();
        const mat = new THREE.MeshLambertMaterial({ color: this.config.color });
        const redMat = new THREE.MeshLambertMaterial({ color: this.config.secondaryColor });
        const orangeMat = new THREE.MeshLambertMaterial({ color: 0xFFA500 });
        
        // Body (oval-ish)
        const bodyGeo = new THREE.BoxGeometry(0.3, 0.35, 0.4);
        const body = new THREE.Mesh(bodyGeo, mat);
        body.position.set(0, 0.3, 0);
        body.castShadow = true;
        group.add(body);
        
        // Head
        const headGeo = new THREE.BoxGeometry(0.2, 0.2, 0.2);
        const head = new THREE.Mesh(headGeo, mat);
        head.position.set(0, 0.55, 0.2);
        head.castShadow = true;
        group.add(head);
        
        // Comb (red)
        const combGeo = new THREE.BoxGeometry(0.05, 0.12, 0.1);
        const comb = new THREE.Mesh(combGeo, redMat);
        comb.position.set(0, 0.7, 0.2);
        group.add(comb);
        
        // Wattle (red, under beak)
        const wattleGeo = new THREE.BoxGeometry(0.06, 0.08, 0.04);
        const wattle = new THREE.Mesh(wattleGeo, redMat);
        wattle.position.set(0, 0.45, 0.32);
        group.add(wattle);
        
        // Beak (orange)
        const beakGeo = new THREE.BoxGeometry(0.08, 0.06, 0.1);
        const beak = new THREE.Mesh(beakGeo, orangeMat);
        beak.position.set(0, 0.52, 0.35);
        group.add(beak);
        
        // Legs (2, thin)
        const legGeo = new THREE.BoxGeometry(0.04, 0.15, 0.04);
        const leftLeg = new THREE.Mesh(legGeo, orangeMat);
        leftLeg.position.set(-0.08, 0.075, 0);
        group.add(leftLeg);
        
        const rightLeg = new THREE.Mesh(legGeo, orangeMat);
        rightLeg.position.set(0.08, 0.075, 0);
        group.add(rightLeg);
        
        // Tail feathers
        const tailGeo = new THREE.BoxGeometry(0.15, 0.2, 0.1);
        const tail = new THREE.Mesh(tailGeo, mat);
        tail.position.set(0, 0.4, -0.25);
        tail.rotation.x = 0.4;
        group.add(tail);
        
        // Wings
        const wingGeo = new THREE.BoxGeometry(0.08, 0.2, 0.25);
        const leftWing = new THREE.Mesh(wingGeo, mat);
        leftWing.position.set(-0.18, 0.3, 0);
        group.add(leftWing);
        
        const rightWing = new THREE.Mesh(wingGeo, mat);
        rightWing.position.set(0.18, 0.3, 0);
        group.add(rightWing);
        
        group.position.copy(this.position);
        return group;
    }
}

/**
 * Zombie - Green humanoid hostile mob
 */
export class Zombie extends Mob {
    constructor(scene, position) {
        super(scene, position, 'zombie');
    }
    
    createMesh() {
        const group = new THREE.Group();
        const mat = new THREE.MeshLambertMaterial({ color: this.config.color });
        const darkMat = new THREE.MeshLambertMaterial({ color: this.config.secondaryColor });
        const blueMat = new THREE.MeshLambertMaterial({ color: 0x3333AA });  // Blue shirt
        
        // Head
        const headGeo = new THREE.BoxGeometry(0.5, 0.5, 0.5);
        const head = new THREE.Mesh(headGeo, mat);
        head.position.set(0, 1.55, 0);
        head.castShadow = true;
        group.add(head);
        
        // Eyes (dark, sunken)
        const eyeGeo = new THREE.BoxGeometry(0.1, 0.08, 0.05);
        const leftEye = new THREE.Mesh(eyeGeo, darkMat);
        leftEye.position.set(-0.12, 1.58, 0.26);
        group.add(leftEye);
        
        const rightEye = new THREE.Mesh(eyeGeo, darkMat);
        rightEye.position.set(0.12, 1.58, 0.26);
        group.add(rightEye);
        
        // Torso (blue shirt, torn)
        const torsoGeo = new THREE.BoxGeometry(0.5, 0.7, 0.3);
        const torso = new THREE.Mesh(torsoGeo, blueMat);
        torso.position.set(0, 1.0, 0);
        torso.castShadow = true;
        group.add(torso);
        
        // Arms (extended forward like zombie)
        const armGeo = new THREE.BoxGeometry(0.18, 0.55, 0.18);
        const leftArm = new THREE.Mesh(armGeo, mat);
        leftArm.position.set(-0.35, 1.1, 0.3);
        leftArm.rotation.x = -Math.PI / 2 + 0.3;  // Extended forward
        leftArm.castShadow = true;
        group.add(leftArm);
        
        const rightArm = new THREE.Mesh(armGeo, mat);
        rightArm.position.set(0.35, 1.1, 0.3);
        rightArm.rotation.x = -Math.PI / 2 + 0.3;
        rightArm.castShadow = true;
        group.add(rightArm);
        
        // Legs (blue pants)
        const legGeo = new THREE.BoxGeometry(0.2, 0.6, 0.2);
        const leftLeg = new THREE.Mesh(legGeo, blueMat);
        leftLeg.position.set(-0.12, 0.3, 0);
        leftLeg.castShadow = true;
        group.add(leftLeg);
        
        const rightLeg = new THREE.Mesh(legGeo, blueMat);
        rightLeg.position.set(0.12, 0.3, 0);
        rightLeg.castShadow = true;
        group.add(rightLeg);
        
        group.position.copy(this.position);
        return group;
    }
}

/**
 * Skeleton - White bony hostile mob
 */
export class Skeleton extends Mob {
    constructor(scene, position) {
        super(scene, position, 'skeleton');
    }
    
    createMesh() {
        const group = new THREE.Group();
        const boneMat = new THREE.MeshLambertMaterial({ color: this.config.color });
        const darkMat = new THREE.MeshLambertMaterial({ color: this.config.secondaryColor });
        
        // Skull
        const skullGeo = new THREE.BoxGeometry(0.45, 0.45, 0.45);
        const skull = new THREE.Mesh(skullGeo, boneMat);
        skull.position.set(0, 1.55, 0);
        skull.castShadow = true;
        group.add(skull);
        
        // Eye sockets (dark)
        const eyeGeo = new THREE.BoxGeometry(0.12, 0.12, 0.1);
        const leftEye = new THREE.Mesh(eyeGeo, darkMat);
        leftEye.position.set(-0.1, 1.58, 0.22);
        group.add(leftEye);
        
        const rightEye = new THREE.Mesh(eyeGeo, darkMat);
        rightEye.position.set(0.1, 1.58, 0.22);
        group.add(rightEye);
        
        // Nose hole
        const noseGeo = new THREE.BoxGeometry(0.08, 0.1, 0.05);
        const nose = new THREE.Mesh(noseGeo, darkMat);
        nose.position.set(0, 1.5, 0.22);
        group.add(nose);
        
        // Ribcage (several horizontal bones)
        const ribGeo = new THREE.BoxGeometry(0.4, 0.08, 0.2);
        for (let i = 0; i < 4; i++) {
            const rib = new THREE.Mesh(ribGeo, boneMat);
            rib.position.set(0, 1.15 - i * 0.12, 0);
            rib.castShadow = true;
            group.add(rib);
        }
        
        // Spine
        const spineGeo = new THREE.BoxGeometry(0.1, 0.5, 0.1);
        const spine = new THREE.Mesh(spineGeo, boneMat);
        spine.position.set(0, 0.95, 0);
        group.add(spine);
        
        // Arms (thin bones)
        const armGeo = new THREE.BoxGeometry(0.1, 0.5, 0.1);
        const leftArm = new THREE.Mesh(armGeo, boneMat);
        leftArm.position.set(-0.3, 1.05, 0);
        leftArm.rotation.z = 0.2;
        leftArm.castShadow = true;
        group.add(leftArm);
        
        const rightArm = new THREE.Mesh(armGeo, boneMat);
        rightArm.position.set(0.3, 1.05, 0);
        rightArm.rotation.z = -0.2;
        rightArm.castShadow = true;
        group.add(rightArm);
        
        // Pelvis
        const pelvisGeo = new THREE.BoxGeometry(0.35, 0.15, 0.15);
        const pelvis = new THREE.Mesh(pelvisGeo, boneMat);
        pelvis.position.set(0, 0.6, 0);
        group.add(pelvis);
        
        // Legs (thin bones)
        const legGeo = new THREE.BoxGeometry(0.1, 0.55, 0.1);
        const leftLeg = new THREE.Mesh(legGeo, boneMat);
        leftLeg.position.set(-0.1, 0.275, 0);
        leftLeg.castShadow = true;
        group.add(leftLeg);
        
        const rightLeg = new THREE.Mesh(legGeo, boneMat);
        rightLeg.position.set(0.1, 0.275, 0);
        rightLeg.castShadow = true;
        group.add(rightLeg);
        
        // Bow (held in left hand)
        const bowMat = new THREE.MeshLambertMaterial({ color: 0x8B4513 });  // Brown
        const stringMat = new THREE.MeshLambertMaterial({ color: 0xCCCCCC });
        
        // Bow body (curved shape using boxes)
        const bowGeo = new THREE.BoxGeometry(0.06, 0.6, 0.06);
        const bow = new THREE.Mesh(bowGeo, bowMat);
        bow.position.set(-0.45, 1.0, 0.2);
        bow.rotation.z = 0.3;
        group.add(bow);
        
        // Bowstring
        const stringGeo = new THREE.BoxGeometry(0.02, 0.55, 0.02);
        const bowstring = new THREE.Mesh(stringGeo, stringMat);
        bowstring.position.set(-0.42, 1.0, 0.25);
        bowstring.rotation.z = 0.3;
        group.add(bowstring);
        
        group.position.copy(this.position);
        return group;
    }
}

/**
 * Creeper - Green armless hostile mob that EXPLODES
 */
export class Creeper extends Mob {
    constructor(scene, position) {
        super(scene, position, 'creeper');
        
        // Explosion state
        this.isDetonating = false;
        this.detonationTimer = 0;
        this.detonationDuration = 3.0;  // 3 seconds to explode
        this.explosionRadius = 3 + Math.random() * 2;  // 3-5 blocks
        this.detonationRange = 2.5;  // Start detonating when this close
        
        // Visual state
        this.originalScale = 1;
        this.flashTimer = 0;
        this.isWhite = false;
    }
    
    // Override to prevent melee attacks - creepers only damage via explosion
    canAttack(targetPosition) {
        return false;
    }
    
    update(deltaTime, terrain, playerPosition) {
        if (this.dead) {
            return super.update(deltaTime, terrain, playerPosition);
        }
        
        const distanceToPlayer = this.position.distanceTo(playerPosition);
        
        // Check if should start detonating
        if (!this.isDetonating && distanceToPlayer < this.detonationRange) {
            this.startDetonation();
        }
        
        // Check if should stop detonating (player moved away)
        if (this.isDetonating && distanceToPlayer > this.detonationRange * 2) {
            this.stopDetonation();
        }
        
        // Handle detonation
        if (this.isDetonating) {
            this.detonationTimer += deltaTime;
            
            // Violent shaking
            const shakeIntensity = 0.1 + (this.detonationTimer / this.detonationDuration) * 0.2;
            this.mesh.position.x = this.position.x + (Math.random() - 0.5) * shakeIntensity;
            this.mesh.position.z = this.position.z + (Math.random() - 0.5) * shakeIntensity;
            
            // Flash white faster as timer progresses
            this.flashTimer += deltaTime;
            const flashRate = 0.3 - (this.detonationTimer / this.detonationDuration) * 0.25;  // Gets faster
            if (this.flashTimer >= flashRate) {
                this.flashTimer = 0;
                this.isWhite = !this.isWhite;
                this.setFlashColor(this.isWhite ? 0xFFFFFF : this.config.color);
            }
            
            // Swell up as about to explode
            const swellAmount = 1 + (this.detonationTimer / this.detonationDuration) * 0.3;
            this.mesh.scale.set(swellAmount, swellAmount, swellAmount);
            
            // EXPLODE!
            if (this.detonationTimer >= this.detonationDuration) {
                this.explode();
                return false;  // Remove creeper
            }
            
            // Don't move while detonating
            this.velocity.x = 0;
            this.velocity.z = 0;
            
            // Still need physics for gravity
            if (!this.onGround) {
                this.velocity.y += this.gravity * deltaTime;
            }
            resolveEntityCollision(this, terrain, deltaTime);
            
            return true;
        }
        
        // Normal behavior when not detonating
        return super.update(deltaTime, terrain, playerPosition);
    }
    
    startDetonation() {
        this.isDetonating = true;
        this.detonationTimer = 0;
        this.flashTimer = 0;
        this.state = 'idle';  // Stop chasing
    }
    
    stopDetonation() {
        this.isDetonating = false;
        this.detonationTimer = 0;
        this.mesh.scale.set(1, 1, 1);
        this.setFlashColor(this.config.color);
        this.isWhite = false;
    }
    
    setFlashColor(color) {
        this.mesh.traverse(child => {
            if (child.material && child !== this.mesh) {
                // Don't change the dark parts (eyes/mouth)
                if (child.material.color.getHex() !== this.config.secondaryColor) {
                    child.material.color.setHex(color);
                }
            }
        });
    }
    
    takeDamage(amount) {
        const result = super.takeDamage(amount);
        
        // If hit while detonating, reset timer
        if (this.isDetonating && !this.dead) {
            this.detonationTimer = 0;
            this.mesh.scale.set(1, 1, 1);
        }
        
        return result;
    }
    
    explode() {
        // Mark as dead
        this.dead = true;
        this.hasExploded = true;
        
        // Store explosion data for MobSpawner to handle
        this.explosionData = {
            position: this.position.clone(),
            radius: this.explosionRadius,
            damage: this.config.damage
        };
    }
    
    createMesh() {
        const group = new THREE.Group();
        const mat = new THREE.MeshLambertMaterial({ color: this.config.color });
        const darkMat = new THREE.MeshLambertMaterial({ color: this.config.secondaryColor });
        
        // Head (cube)
        const headGeo = new THREE.BoxGeometry(0.5, 0.5, 0.5);
        const head = new THREE.Mesh(headGeo, mat);
        head.position.set(0, 1.35, 0);
        head.castShadow = true;
        group.add(head);
        
        // Face - creeper's iconic sad/angry face
        // Eyes (dark, downward slanted)
        const eyeGeo = new THREE.BoxGeometry(0.12, 0.12, 0.05);
        const leftEye = new THREE.Mesh(eyeGeo, darkMat);
        leftEye.position.set(-0.1, 1.4, 0.26);
        group.add(leftEye);
        
        const rightEye = new THREE.Mesh(eyeGeo, darkMat);
        rightEye.position.set(0.1, 1.4, 0.26);
        group.add(rightEye);
        
        // Mouth (sad frown shape - vertical line + horizontal at bottom)
        const mouthVertGeo = new THREE.BoxGeometry(0.08, 0.2, 0.05);
        const mouthVert = new THREE.Mesh(mouthVertGeo, darkMat);
        mouthVert.position.set(0, 1.2, 0.26);
        group.add(mouthVert);
        
        const mouthHorizGeo = new THREE.BoxGeometry(0.2, 0.08, 0.05);
        const mouthHoriz = new THREE.Mesh(mouthHorizGeo, darkMat);
        mouthHoriz.position.set(0, 1.12, 0.26);
        group.add(mouthHoriz);
        
        // Body (tall, narrow)
        const bodyGeo = new THREE.BoxGeometry(0.5, 0.7, 0.35);
        const body = new THREE.Mesh(bodyGeo, mat);
        body.position.set(0, 0.75, 0);
        body.castShadow = true;
        group.add(body);
        
        // Legs (4, short - no arms!)
        const legGeo = new THREE.BoxGeometry(0.2, 0.4, 0.2);
        const legPositions = [
            [-0.12, 0.2, 0.1],
            [0.12, 0.2, 0.1],
            [-0.12, 0.2, -0.1],
            [0.12, 0.2, -0.1]
        ];
        legPositions.forEach(pos => {
            const leg = new THREE.Mesh(legGeo, mat);
            leg.position.set(...pos);
            leg.castShadow = true;
            group.add(leg);
        });
        
        group.position.copy(this.position);
        return group;
    }
}

/**
 * Explosion - Visual effect for creeper explosion
 */
export class Explosion {
    constructor(scene, position, radius) {
        this.scene = scene;
        this.position = position.clone();
        this.radius = radius;
        this.maxRadius = radius;
        this.currentRadius = 0.5;
        this.lifetime = 0;
        this.maxLifetime = 0.5;  // Half second explosion
        
        // Create expanding sphere
        this.geometry = new THREE.SphereGeometry(1, 16, 12);
        this.material = new THREE.MeshBasicMaterial({
            color: 0xFF6600,
            transparent: true,
            opacity: 1.0
        });
        
        this.mesh = new THREE.Mesh(this.geometry, this.material);
        this.mesh.position.copy(this.position);
        this.mesh.position.y += 0.5;  // Center at creeper height
        this.scene.add(this.mesh);
        
        // Inner bright core
        this.coreGeometry = new THREE.SphereGeometry(1, 12, 8);
        this.coreMaterial = new THREE.MeshBasicMaterial({
            color: 0xFFFF00,
            transparent: true,
            opacity: 1.0
        });
        this.coreMesh = new THREE.Mesh(this.coreGeometry, this.coreMaterial);
        this.coreMesh.position.copy(this.mesh.position);
        this.scene.add(this.coreMesh);
        
        this.flashTimer = 0;
        this.isOrange = true;
    }
    
    update(deltaTime) {
        this.lifetime += deltaTime;
        
        const progress = this.lifetime / this.maxLifetime;
        
        // Expand quickly then slow down
        const expandProgress = Math.pow(progress, 0.5);  // Fast start, slow end
        this.currentRadius = 0.5 + expandProgress * (this.maxRadius - 0.5);
        
        this.mesh.scale.set(this.currentRadius, this.currentRadius, this.currentRadius);
        this.coreMesh.scale.set(
            this.currentRadius * 0.6,
            this.currentRadius * 0.6,
            this.currentRadius * 0.6
        );
        
        // Flash between orange and yellow
        this.flashTimer += deltaTime;
        if (this.flashTimer > 0.05) {
            this.flashTimer = 0;
            this.isOrange = !this.isOrange;
            this.material.color.setHex(this.isOrange ? 0xFF6600 : 0xFF3300);
            this.coreMaterial.color.setHex(this.isOrange ? 0xFFFF00 : 0xFFFFFF);
        }
        
        // Fade out
        const fadeStart = 0.3;
        if (progress > fadeStart) {
            const fadeProgress = (progress - fadeStart) / (1 - fadeStart);
            this.material.opacity = 1 - fadeProgress;
            this.coreMaterial.opacity = 1 - fadeProgress;
        }
        
        // Done?
        if (this.lifetime >= this.maxLifetime) {
            this.destroy();
            return false;
        }
        
        return true;
    }
    
    destroy() {
        this.scene.remove(this.mesh);
        this.scene.remove(this.coreMesh);
        this.geometry.dispose();
        this.material.dispose();
        this.coreGeometry.dispose();
        this.coreMaterial.dispose();
    }
}

/**
 * MobSpawner - Manages mob spawning and updates
 */
export class MobSpawner {
    constructor(scene, terrain) {
        this.scene = scene;
        this.terrain = terrain;
        this.mobs = [];
        
        // Spawn settings
        this.maxMobs = 25;          // Reduced from 40
        this.spawnRadius = 45;      // Spawn within 45 blocks of player
        this.minSpawnDistance = 20; // Don't spawn too close
        this.despawnDistance = 50;  // Remove mobs more than 50 units away
        this.fadeStartDistance = 45; // Start fading at 45 units
        this.spawnInterval = 2.5;   // Slower spawn rate
        this.timeSinceSpawn = 0;
        
        // Mob classes by type
        this.mobClasses = {
            cow: Cow,
            pig: Pig,
            chicken: Chicken,
            zombie: Zombie,
            skeleton: Skeleton,
            creeper: Creeper
        };
        
        // Dropped loot from killed mobs (to be collected by game)
        this.droppedLoot = [];
        
        // Pending explosions (creepers)
        this.pendingExplosions = [];
    }
    
    update(deltaTime, playerPosition, waterLevel, itemSpawner = null) {
        // Update existing mobs and collect skeleton arrows
        const skeletonArrows = [];
        
        this.mobs = this.mobs.filter(mob => {
            // Check if mob is too far away - despawn with fade
            const distance = mob.position.distanceTo(playerPosition);
            
            if (distance > this.despawnDistance) {
                mob.destroy();
                return false;
            }
            
            // Fade out mobs approaching despawn distance
            if (distance > this.fadeStartDistance && !mob.dead) {
                const fadeProgress = (distance - this.fadeStartDistance) / (this.despawnDistance - this.fadeStartDistance);
                mob.mesh.traverse(child => {
                    if (child.material) {
                        child.material.transparent = true;
                        child.material.opacity = 1 - fadeProgress;
                    }
                });
            } else if (!mob.dead) {
                // Restore full opacity when close
                mob.mesh.traverse(child => {
                    if (child.material && child.material.opacity < 1) {
                        child.material.opacity = 1;
                    }
                });
            }
            
            // Let mobs try to pick up items
            if (itemSpawner && !mob.dead) {
                for (const item of itemSpawner.items) {
                    if (mob.tryPickupItem(item)) {
                        item.collect();
                    }
                }
            }
            
            const alive = mob.update(deltaTime, this.terrain, playerPosition);
            
            // Collect any pending arrows from skeletons
            if (mob.isRanged && !mob.dead) {
                const arrows = mob.getPendingArrows();
                skeletonArrows.push(...arrows);
            }
            
            // Check if mob just died and has loot
            if (!alive && mob.hasItems()) {
                this.droppedLoot.push({
                    position: mob.position.clone(),
                    inventory: mob.getInventory()
                });
            }
            
            // Check for creeper explosion
            if (mob.hasExploded && mob.explosionData) {
                this.pendingExplosions.push(mob.explosionData);
            }
            
            if (!alive) {
                mob.destroy();
            }
            return alive;
        });
        
        // Store skeleton arrows for game to spawn
        this.pendingSkeletonArrows = skeletonArrows;
        
        // Try to spawn new mobs - spawn multiple if below max
        this.timeSinceSpawn += deltaTime;
        if (this.timeSinceSpawn >= this.spawnInterval) {
            // Spawn up to 3 mobs per interval if we're low
            const mobsToSpawn = Math.min(3, this.maxMobs - this.mobs.length);
            for (let i = 0; i < mobsToSpawn; i++) {
                this.trySpawnMob(playerPosition, waterLevel);
            }
            this.timeSinceSpawn = 0;
        }
        
        return this.mobs;
    }
    
    /**
     * Get arrows shot by skeletons this frame
     */
    getSkeletonArrows() {
        const arrows = this.pendingSkeletonArrows || [];
        this.pendingSkeletonArrows = [];
        return arrows;
    }
    
    /**
     * Get loot dropped by killed mobs
     */
    getDroppedLoot() {
        const loot = this.droppedLoot;
        this.droppedLoot = [];
        return loot;
    }
    
    /**
     * Get pending explosions (from creepers)
     */
    getExplosions() {
        const explosions = this.pendingExplosions;
        this.pendingExplosions = [];
        return explosions;
    }
    
    trySpawnMob(playerPosition, waterLevel) {
        // Try several times to find a valid spawn position
        for (let attempt = 0; attempt < 5; attempt++) {
            const angle = Math.random() * Math.PI * 2;
            const distance = this.minSpawnDistance + Math.random() * (this.spawnRadius - this.minSpawnDistance);
            
            const x = Math.floor(playerPosition.x + Math.cos(angle) * distance);
            const z = Math.floor(playerPosition.z + Math.sin(angle) * distance);
            
            const height = this.terrain.getHeight(x, z);
            
            // Skip underwater or too high
            if (height <= waterLevel || height > 40) continue;
            
            // Get biome and pick appropriate mob
            const biome = this.terrain.getBiome(x, z);
            const mobType = this.pickMobType(biome);
            
            if (mobType) {
                const position = new THREE.Vector3(x + 0.5, height + 1, z + 0.5);
                const MobClass = this.mobClasses[mobType];
                const mob = new MobClass(this.scene, position);
                this.mobs.push(mob);
                return mob;
            }
        }
        
        return null;
    }
    
    pickMobType(biome) {
        // Filter mobs that can spawn in this biome
        const validMobs = Object.entries(MOB_TYPES)
            .filter(([type, config]) => config.biomes.includes(biome));
        
        if (validMobs.length === 0) return null;
        
        // Weighted random selection
        const totalWeight = validMobs.reduce((sum, [, config]) => sum + config.spawnWeight, 0);
        let random = Math.random() * totalWeight;
        
        for (const [type, config] of validMobs) {
            random -= config.spawnWeight;
            if (random <= 0) return type;
        }
        
        return validMobs[0][0];
    }
    
    /**
     * Get mobs that can be damaged (for arrow collision)
     */
    getHostileMobs() {
        return this.mobs.filter(mob => mob.canBeDamaged());
    }
    
    /**
     * Check if any hostile mob can attack the target (melee only)
     * Returns total damage dealt
     */
    checkAttacks(targetPosition) {
        let totalDamage = 0;
        
        for (const mob of this.mobs) {
            // Skip ranged mobs - they attack with arrows
            if (mob.isRanged) continue;
            
            if (mob.canAttack(targetPosition)) {
                totalDamage += mob.attack();
            }
        }
        
        return totalDamage;
    }
    
    clearAll() {
        this.mobs.forEach(mob => mob.destroy());
        this.mobs = [];
    }
}