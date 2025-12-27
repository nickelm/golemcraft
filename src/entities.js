import * as THREE from 'three';
import { HeroMount } from './hero.js';
import { resolveEntityCollision, createEntityAABB, createHeroAABB } from './collision.js';

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
        this.moveSpeed = 12;
        this.turnSpeed = 3;
        
        // Remove the basic Entity mesh
        this.scene.remove(this.mesh);
        
        // Create HeroMount for visuals
        this.heroMount = new HeroMount(this.scene, position);
        this.mesh = this.heroMount.mesh;
        
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
        
        // Physics via collision module
        resolveEntityCollision(this, terrain, deltaTime);
        
        // Sync mesh position with bob animation
        // Apply groundOffset from AABB to align mesh with collision
        this.heroMount.mesh.position.copy(this.position);
        this.heroMount.mesh.position.y += this.heroMount.bobOffset + (this.aabb?.groundOffset || 0);
        this.heroMount.setRotation(this.rotation);
        
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
        
        this.heroMount.update(deltaTime, this.isMoving, this.isJumping);
        this.oldRotation = this.rotation;
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
        if (this.onGround) {
            this.velocity.y = force;
            this.onGround = false;
            this.isJumping = true;
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
        this.heroMount.destroy();
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