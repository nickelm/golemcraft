import * as THREE from 'three';
import { HeroMount, HeroOnFoot } from './hero.js';
import { resolveEntityCollision, createEntityAABB, createHeroAABB, createHeroOnFootAABB } from './collision.js';
import { Bow, Sword } from './combat.js';

/**
 * Base Entity class
 * 
 * All game entities (hero, golems, enemies) inherit from this.
 * Physics and collision are delegated to the collision module.
 */
export class Entity {
    constructor(scene, position, color, size = 1) {
        this.scene = scene;
        this.position = position.clone();
        this.velocity = new THREE.Vector3(0, 0, 0);
        this.color = color;
        this.size = size;
        this.health = 100;
        this.maxHealth = 100;
        this.team = 'neutral';
        this.onGround = false;
        this.gravity = -35;
        
        this.mesh = this.createMesh();
        this.scene.add(this.mesh);
        
        // AABB for collision (created lazily by collision module)
        this.aabb = null;
    }

    createMesh() {
        const geometry = new THREE.BoxGeometry(this.size, this.size * 1.5, this.size);
        const material = new THREE.MeshLambertMaterial({ 
            color: this.color,
            flatShading: true 
        });
        const mesh = new THREE.Mesh(geometry, material);
        mesh.position.copy(this.position);
        mesh.castShadow = true;
        mesh.entity = this;
        return mesh;
    }

    update(deltaTime, terrain, objectGenerator = null) {
        resolveEntityCollision(this, terrain, deltaTime);
    }

    moveTo(target, speed = 5) {
        const direction = new THREE.Vector3()
            .subVectors(target, this.position)
            .normalize();
        direction.y = 0;
        this.velocity.x = direction.x * speed;
        this.velocity.z = direction.z * speed;
    }
    
    jump(force = 8) {
        if (this.onGround) {
            this.velocity.y = force;
            this.onGround = false;
        }
    }

    takeDamage(amount) {
        this.health -= amount;
        if (this.health <= 0) {
            this.die();
        }
    }

    die() {
        this.scene.remove(this.mesh);
    }
}

/**
 * Hero Entity - Player-controlled character riding a mount
 */
export class Hero extends Entity {
    constructor(scene, position) {
        super(scene, position, 0x0066cc, 1.2);
        this.team = 'player';
        this.commandedGolems = [];
        this.rotation = 0;

        // Movement speeds (mounted vs on foot)
        this.mountedMoveSpeed = 12;
        this.onFootMoveSpeed = 5.5;
        this.moveSpeed = this.mountedMoveSpeed;
        this.turnSpeed = 3;

        // Mounting state
        this.mounted = true;
        this.isMounting = false;
        this.mountingProgress = 0;
        this.mountingDuration = 1.0; // 1 second to mount
        this.mountProgressBar = null;

        // Remove the basic Entity mesh
        this.scene.remove(this.mesh);

        // Create HeroMount for visuals (starts mounted)
        this.heroMount = new HeroMount(this.scene, position);
        this.heroOnFoot = null; // Created when dismounting
        this.mesh = this.heroMount.mesh;
        this.activeVisual = this.heroMount; // Reference to current visual

        // Add weapons
        this.bow = new Bow(this.scene, this.mesh);
        this.sword = new Sword(this.scene, this.mesh, true);
        this.sword.hide(); // Start with bow visible

        // Active weapon state
        this.activeWeapon = 'bow'; // 'bow' or 'sword'

        // Shooting mechanics (bow)
        this.attackCooldown = 0.25;  // 0.25 seconds between shots (fast!)
        this.timeSinceLastShot = 0;
        this.arrowDamage = 15;

        // Melee mechanics (sword)
        this.meleeRange = 2.5;      // 2.5 blocks
        this.meleeDamage = 25;      // Higher damage than bow
        this.meleeArc = Math.PI / 2; // 90° frontal cone
        this.swingCooldown = 0.4;   // 0.4 seconds between swings
        this.timeSinceLastSwing = 0;

        // Custom AABB for mounted hero - matches mesh dimensions
        this.aabb = createHeroAABB();

        // Animation state
        this.isMoving = false;
        this.isJumping = false;
        this.oldRotation = 0;

        // Debug visualization (disabled by default)
        this.debugAABB = null;
        // this.createDebugAABB();  // Uncomment for debugging
    }
    
    update(deltaTime, terrain, objectGenerator = null) {
        const oldPos = this.position.clone();
        const oldRot = this.oldRotation;

        // Update attack cooldowns
        this.timeSinceLastShot += deltaTime;
        this.timeSinceLastSwing += deltaTime;

        // Handle mounting progress
        if (this.isMounting) {
            this.mountingProgress += deltaTime / this.mountingDuration;
            this.updateMountProgressBar();

            if (this.mountingProgress >= 1) {
                // Mounting complete
                this.completeMounting();
            }

            // During mounting, don't process physics/movement
            // But still update visual position
            this.activeVisual.mesh.position.copy(this.position);
            this.activeVisual.mesh.position.y += this.activeVisual.bobOffset + (this.aabb?.groundOffset || 0);
            this.activeVisual.setRotation(this.rotation);
            this.activeVisual.update(deltaTime, false, false);
            return;
        }

        // Physics via collision module
        resolveEntityCollision(this, terrain, deltaTime);

        // Sync mesh position with bob animation
        // Apply groundOffset from AABB to align mesh with collision
        this.activeVisual.mesh.position.copy(this.position);
        this.activeVisual.mesh.position.y += this.activeVisual.bobOffset + (this.aabb?.groundOffset || 0);
        this.activeVisual.setRotation(this.rotation);

        // Update weapon animations
        if (this.bow) {
            this.bow.update(deltaTime);
        }
        if (this.sword) {
            this.sword.update(deltaTime);
        }

        // Update debug AABB visualization
        if (this.debugAABB && this.aabb) {
            this.debugAABB.position.set(
                this.position.x,
                this.position.y + this.aabb.height / 2 + (this.aabb.groundOffset || 0),
                this.position.z
            );
        }

        // Animation state
        const moved = this.position.distanceTo(oldPos) > 0.01;
        const turned = Math.abs(this.rotation - oldRot) > 0.01;
        this.isMoving = moved || turned || this.velocity.length() > 0.1;
        this.isJumping = !this.onGround;

        this.activeVisual.update(deltaTime, this.isMoving, this.isJumping);
        this.oldRotation = this.rotation;
    }
    
    /**
     * Shoot arrow at target position
     * Returns the arrow if shot, null if on cooldown
     */
    shootArrow(targetPosition) {
        if (this.timeSinceLastShot < this.attackCooldown) {
            return null;  // Still on cooldown
        }
        
        // Reset cooldown
        this.timeSinceLastShot = 0;
        
        // Trigger bow draw animation
        if (this.bow) {
            this.bow.startDraw();
            setTimeout(() => this.bow.release(), 100);  // Quick draw and release
        }
        
        // Arrow starts from hero position, slightly elevated and forward
        const arrowStart = this.position.clone();
        arrowStart.y += 2.0;  // Chest height
        
        // Arrow aims at target with slight upward offset (0.5 above ground)
        const arrowTarget = targetPosition.clone();
        arrowTarget.y += 0.5;
        
        // Create arrow (will be added to game's arrow array by caller)
        return { start: arrowStart, target: arrowTarget, damage: this.arrowDamage };
    }
    
    /**
     * Check if can shoot (not on cooldown)
     */
    canShoot() {
        return this.timeSinceLastShot >= this.attackCooldown;
    }

    /**
     * Switch between bow and sword
     */
    switchWeapon() {
        if (this.activeWeapon === 'bow') {
            this.activeWeapon = 'sword';
            if (this.bow) this.bow.mesh.visible = false;
            if (this.sword) this.sword.show();
        } else {
            this.activeWeapon = 'bow';
            if (this.sword) this.sword.hide();
            if (this.bow) this.bow.mesh.visible = true;
        }
    }

    /**
     * Check if can perform melee attack (not on cooldown)
     */
    canMeleeAttack() {
        return this.timeSinceLastSwing >= this.swingCooldown;
    }

    /**
     * Perform melee attack on mobs within range and arc
     * @param {Array} mobs - Array of mob entities to check
     * @returns {Array} Array of mobs that were hit
     */
    meleeAttack(mobs) {
        if (!this.canMeleeAttack()) {
            return [];
        }

        // Reset cooldown
        this.timeSinceLastSwing = 0;

        // Trigger sword swing animation
        if (this.sword) {
            this.sword.swing();
        }

        // Calculate hero forward direction
        const heroForward = new THREE.Vector3(
            Math.sin(this.rotation),
            0,
            Math.cos(this.rotation)
        ).normalize();

        const hitMobs = [];

        for (const mob of mobs) {
            if (mob.dead || mob.health <= 0) continue;

            // Vector from hero to mob
            const toMob = new THREE.Vector3()
                .subVectors(mob.position, this.position);
            toMob.y = 0; // Only consider horizontal distance
            const distance = toMob.length();

            // Check if within melee range
            if (distance > this.meleeRange) continue;

            // Check if within frontal arc
            toMob.normalize();
            const dot = heroForward.dot(toMob);
            const angle = Math.acos(Math.max(-1, Math.min(1, dot)));

            // meleeArc is full arc width, so half-angle comparison
            if (angle <= this.meleeArc / 2) {
                // Hit! Apply damage
                mob.takeDamage(this.meleeDamage);
                hitMobs.push(mob);
            }
        }

        return hitMobs;
    }

    /**
     * Create a wireframe box showing the collision AABB
     */
    createDebugAABB() {
        if (this.debugAABB) return;
        
        const geometry = new THREE.BoxGeometry(
            this.aabb.width,
            this.aabb.height,
            this.aabb.depth
        );
        const material = new THREE.MeshBasicMaterial({
            color: 0x00ff00,
            wireframe: true,
            transparent: true,
            opacity: 0.8
        });
        this.debugAABB = new THREE.Mesh(geometry, material);
        this.debugAABB.position.set(
            this.position.x,
            this.position.y + this.aabb.height / 2,
            this.position.z
        );
        this.scene.add(this.debugAABB);
    }
    
    /**
     * Remove debug AABB visualization
     */
    removeDebugAABB() {
        if (this.debugAABB) {
            this.scene.remove(this.debugAABB);
            this.debugAABB = null;
        }
    }
    
    turn(direction, deltaTime) {
        this.rotation += direction * this.turnSpeed * deltaTime;
    }
    
    moveForward(deltaTime) {
        const direction = new THREE.Vector3(
            Math.sin(this.rotation),
            0,
            Math.cos(this.rotation)
        );
        this.velocity.x += direction.x * this.moveSpeed * deltaTime;
        this.velocity.z += direction.z * this.moveSpeed * deltaTime;
    }
    
    moveBackward(deltaTime) {
        const direction = new THREE.Vector3(
            Math.sin(this.rotation),
            0,
            Math.cos(this.rotation)
        );
        this.velocity.x -= direction.x * this.moveSpeed * 0.6 * deltaTime;
        this.velocity.z -= direction.z * this.moveSpeed * 0.6 * deltaTime;
    }
    
    jump(force = 12) {
        if (this.onGround && !this.isMounting) {
            this.velocity.y = force;
            this.onGround = false;
            this.isJumping = true;
        }
    }

    /**
     * Check if hero can move (not in mounting animation)
     */
    canMove() {
        return !this.isMounting;
    }

    /**
     * Get eye height based on mount state
     * Used by camera controller for first-person view
     */
    getEyeHeight() {
        return this.mounted ? 2.3 : 1.6;
    }

    /**
     * Dismount from the horse - instant
     */
    dismount() {
        if (!this.mounted || this.isMounting) return;

        // Create HeroOnFoot if not exists
        if (!this.heroOnFoot) {
            this.heroOnFoot = new HeroOnFoot(this.scene, this.position);
        }

        // Hide mount mesh
        this.heroMount.mesh.visible = false;

        // Show on-foot mesh and sync position/rotation
        this.heroOnFoot.mesh.visible = true;
        this.heroOnFoot.mesh.position.copy(this.position);
        this.heroOnFoot.setRotation(this.rotation);

        // Swap active visual
        this.activeVisual = this.heroOnFoot;
        this.mesh = this.heroOnFoot.mesh;

        // Re-attach weapons to on-foot mesh
        if (this.bow) {
            this.bow.attachTo(this.heroOnFoot.mesh, false);
        }
        if (this.sword) {
            this.sword.attachTo(this.heroOnFoot.mesh, false);
        }

        // Switch AABB to taller, narrower on-foot version
        this.aabb = createHeroOnFootAABB();

        // Switch to slower movement speed
        this.moveSpeed = this.onFootMoveSpeed;

        // Update mounted state
        this.mounted = false;
    }

    /**
     * Begin mounting the horse - starts progress bar
     */
    mount() {
        if (this.mounted || this.isMounting) return;

        // Start mounting process
        this.isMounting = true;
        this.mountingProgress = 0;

        // Create progress bar UI
        this.createMountProgressBar();
    }

    /**
     * Complete the mounting process
     */
    completeMounting() {
        this.isMounting = false;
        this.mountingProgress = 0;
        this.removeMountProgressBar();

        // Hide on-foot mesh
        if (this.heroOnFoot) {
            this.heroOnFoot.mesh.visible = false;
        }

        // Show mount mesh
        this.heroMount.mesh.visible = true;
        this.heroMount.mesh.position.copy(this.position);
        this.heroMount.setRotation(this.rotation);

        // Swap active visual
        this.activeVisual = this.heroMount;
        this.mesh = this.heroMount.mesh;

        // Re-attach weapons to mount mesh
        if (this.bow) {
            this.bow.attachTo(this.heroMount.mesh, true);
        }
        if (this.sword) {
            this.sword.attachTo(this.heroMount.mesh, true);
        }

        // Switch AABB to mounted version
        this.aabb = createHeroAABB();

        // Switch to faster movement speed
        this.moveSpeed = this.mountedMoveSpeed;

        // Update mounted state
        this.mounted = true;
    }

    /**
     * Cancel mounting (if interrupted)
     */
    cancelMounting() {
        if (!this.isMounting) return;

        this.isMounting = false;
        this.mountingProgress = 0;
        this.removeMountProgressBar();
    }

    /**
     * Create the mounting progress bar UI
     */
    createMountProgressBar() {
        if (this.mountProgressBar) return;

        // Create container
        const container = document.createElement('div');
        container.style.cssText = `
            position: fixed;
            bottom: 120px;
            left: 50%;
            transform: translateX(-50%);
            width: 200px;
            padding: 8px;
            background: rgba(0, 0, 0, 0.7);
            border-radius: 8px;
            text-align: center;
            z-index: 1000;
        `;

        // Label
        const label = document.createElement('div');
        label.style.cssText = `
            color: white;
            font-size: 14px;
            margin-bottom: 6px;
            font-family: sans-serif;
        `;
        label.textContent = 'Mounting...';
        container.appendChild(label);

        // Progress bar background
        const barBg = document.createElement('div');
        barBg.style.cssText = `
            width: 100%;
            height: 12px;
            background: #333;
            border-radius: 6px;
            overflow: hidden;
        `;
        container.appendChild(barBg);

        // Progress bar fill
        const barFill = document.createElement('div');
        barFill.style.cssText = `
            width: 0%;
            height: 100%;
            background: linear-gradient(90deg, #4ade80, #22c55e);
            transition: width 0.1s ease-out;
        `;
        barBg.appendChild(barFill);

        document.body.appendChild(container);

        this.mountProgressBar = {
            container,
            fill: barFill
        };
    }

    /**
     * Update the mounting progress bar
     */
    updateMountProgressBar() {
        if (!this.mountProgressBar) return;

        const percent = Math.min(100, this.mountingProgress * 100);
        this.mountProgressBar.fill.style.width = `${percent}%`;
    }

    /**
     * Remove the mounting progress bar
     */
    removeMountProgressBar() {
        if (!this.mountProgressBar) return;

        this.mountProgressBar.container.remove();
        this.mountProgressBar = null;
    }

    /**
     * Toggle mount/dismount state
     */
    toggleMount() {
        if (this.isMounting) {
            this.cancelMounting();
        } else if (this.mounted) {
            this.dismount();
        } else {
            this.mount();
        }
    }

    commandGolems(target) {
        this.commandedGolems.forEach(golem => {
            golem.moveTo(target, 3);
        });
    }

    addGolem(golem) {
        this.commandedGolems.push(golem);
        golem.team = 'player';
    }
    
    die() {
        this.removeDebugAABB();
        this.removeMountProgressBar();
        this.heroMount.destroy();
        if (this.heroOnFoot) this.heroOnFoot.destroy();
        if (this.bow) this.bow.destroy();
        if (this.sword) this.sword.destroy();
    }
}

/**
 * Golem Entity - Player-controlled minion
 */
export class Golem extends Entity {
    constructor(scene, position) {
        super(scene, position, 0xcc6600, 1.5);
        this.team = 'player';
        this.attackRange = 2;
        this.attackDamage = 10;
        this.attackCooldown = 1.0;
        this.timeSinceAttack = 0;
    }

    update(deltaTime, terrain, objectGenerator = null) {
        super.update(deltaTime, terrain, objectGenerator);
        this.timeSinceAttack += deltaTime;
    }

    attack(target) {
        if (this.timeSinceAttack >= this.attackCooldown) {
            const distance = this.position.distanceTo(target.position);
            if (distance <= this.attackRange) {
                target.takeDamage(this.attackDamage);
                this.timeSinceAttack = 0;
                return true;
            }
        }
        return false;
    }
}

/**
 * Enemy Entity - AI-controlled hostile unit
 */
export class EnemyUnit extends Entity {
    constructor(scene, position) {
        super(scene, position, 0xcc0000, 1.2);
        this.team = 'enemy';
        this.attackRange = 2;
        this.attackDamage = 8;
        this.attackCooldown = 1.2;
        this.timeSinceAttack = 0;
        this.targetEntity = null;
    }

    update(deltaTime, terrain, playerEntities, objectGenerator = null) {
        super.update(deltaTime, terrain, objectGenerator);
        this.timeSinceAttack += deltaTime;

        if (!this.targetEntity || this.targetEntity.health <= 0) {
            this.targetEntity = this.findNearestTarget(playerEntities);
        }

        if (this.targetEntity) {
            const distance = this.position.distanceTo(this.targetEntity.position);
            
            if (distance > this.attackRange) {
                this.moveTo(this.targetEntity.position, 2);
            } else {
                this.velocity.set(0, this.velocity.y, 0);
                if (this.timeSinceAttack >= this.attackCooldown) {
                    this.targetEntity.takeDamage(this.attackDamage);
                    this.timeSinceAttack = 0;
                }
            }
        }
    }

    findNearestTarget(entities) {
        let nearest = null;
        let minDistance = Infinity;

        entities.forEach(entity => {
            if (entity.health > 0) {
                const distance = this.position.distanceTo(entity.position);
                if (distance < minDistance) {
                    minDistance = distance;
                    nearest = entity;
                }
            }
        });

        return nearest;
    }
}