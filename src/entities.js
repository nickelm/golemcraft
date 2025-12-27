import * as THREE from 'three';
import { HeroMount } from './hero.js';

// Base entity class
export class Entity {
    constructor(scene, position, color, size = 1) {
        this.scene = scene;
        this.position = position;
        this.velocity = new THREE.Vector3(0, 0, 0);
        this.color = color;
        this.size = size;
        this.health = 100;
        this.maxHealth = 100;
        this.team = 'neutral';
        this.onGround = false;
        this.gravity = -35; // m/s^2 - snappy, responsive feel
        
        this.mesh = this.createMesh();
        this.scene.add(this.mesh);
        
        // Ground offset - distance from position.y to bottom of entity
        // Default uses size-based calculation, can be overridden
        this.groundOffset = this.size * 0.75;
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
        mesh.entity = this; // Back reference
        return mesh;
    }

    update(deltaTime, terrain, objectGenerator = null) {
        // Apply gravity
        if (!this.onGround) {
            this.velocity.y += this.gravity * deltaTime;
        }
        
        // Store old position for collision resolution
        const oldX = this.position.x;
        const oldZ = this.position.z;
        
        // Apply velocity
        this.position.add(this.velocity.clone().multiplyScalar(deltaTime));
        
        // Terrain height blocking - prevent walking UP 2+ blocks (but allow jumping over)
        // Handle X and Z axes independently
        if (terrain) {
            const margin = 0.01;
            const oldCellX = Math.floor(oldX);
            const oldCellZ = Math.floor(oldZ);
            
            // Check X axis - are we crossing or about to cross a cell boundary?
            // Moving positive: check if we've reached or passed the next integer
            // Moving negative: check if we've gone below the current cell's floor
            if (this.velocity.x > 0) {
                const boundary = oldCellX + 1.0; // Right edge of current cell
                if (this.position.x >= boundary) {
                    const currentHeight = terrain.getHeight(oldCellX + 1, oldCellZ);
                    const nextCellX = Math.floor(this.position.x);
                    const nextHeight = terrain.getHeight(nextCellX + 1, oldCellZ);
                    const heightDiff = nextHeight - currentHeight;
                    const canClear = this.position.y >= currentHeight + heightDiff - 0.5;
                    
                    if (heightDiff >= 2 && !canClear) {
                        this.position.x = boundary - margin;
                        this.velocity.x = 0;
                    }
                }
            } else if (this.velocity.x < 0) {
                const boundary = oldCellX; // Left edge of current cell
                if (this.position.x < boundary) {
                    const currentHeight = terrain.getHeight(oldCellX, oldCellZ);
                    const nextCellX = Math.floor(this.position.x);
                    const nextHeight = terrain.getHeight(nextCellX, oldCellZ);
                    const heightDiff = nextHeight - currentHeight;
                    const canClear = this.position.y >= currentHeight + heightDiff - 0.5;
                    
                    if (heightDiff >= 2 && !canClear) {
                        this.position.x = boundary + margin;
                        this.velocity.x = 0;
                    }
                }
            }
            
            // Check Z axis - use potentially updated X position
            const nowCellX = Math.floor(this.position.x);
            
            if (this.velocity.z > 0) {
                const boundary = oldCellZ + 1;
                if (this.position.z >= boundary) {
                    const nextCellZ = Math.floor(this.position.z);
                    const baseHeight = terrain.getHeight(nowCellX, oldCellZ + 1);
                    const nextHeight = terrain.getHeight(nowCellX, nextCellZ + 1);
                    const heightDiff = nextHeight - baseHeight;
                    const canClear = this.position.y >= baseHeight + heightDiff - 0.5;
                    
                    if (heightDiff >= 2 && !canClear) {
                        this.position.z = boundary - margin;
                        this.velocity.z = 0;
                    }
                }
            } else if (this.velocity.z < 0) {
                const boundary = oldCellZ;
                if (this.position.z < boundary) {
                    const nextCellZ = Math.floor(this.position.z);
                    const baseHeight = terrain.getHeight(nowCellX, oldCellZ);
                    const nextHeight = terrain.getHeight(nowCellX, nextCellZ);
                    const heightDiff = nextHeight - baseHeight;
                    const canClear = this.position.y >= baseHeight + heightDiff - 0.5;
                    
                    if (heightDiff >= 2 && !canClear) {
                        this.position.z = boundary + margin;
                        this.velocity.z = 0;
                    }
                }
            }
        }
        
        // Object collision (trees, rocks, cacti)
        if (objectGenerator) {
            const cellX = Math.floor(this.position.x);
            const cellZ = Math.floor(this.position.z);
            
            if (objectGenerator.hasCollision(cellX, cellZ)) {
                // Push back to old position
                this.position.x = oldX;
                this.position.z = oldZ;
                this.velocity.x = 0;
                this.velocity.z = 0;
            }
        }
        
        // Ground collision - use interpolation for smooth slopes, block height for cliffs
        if (terrain) {
            const interpolatedHeight = terrain.getInterpolatedHeight 
                ? terrain.getInterpolatedHeight(this.position.x, this.position.z)
                : terrain.getHeight(Math.floor(this.position.x), Math.floor(this.position.z));
            
            const blockHeight = terrain.getHeight(Math.floor(this.position.x), Math.floor(this.position.z));
            
            // Check if we're on steep terrain (cliff face)
            // Sample surrounding blocks to detect steep changes
            const x = Math.floor(this.position.x);
            const z = Math.floor(this.position.z);
            let maxHeightDiff = 0;
            for (let dx = -1; dx <= 1; dx++) {
                for (let dz = -1; dz <= 1; dz++) {
                    if (dx === 0 && dz === 0) continue;
                    const neighborHeight = terrain.getHeight(x + dx, z + dz);
                    maxHeightDiff = Math.max(maxHeightDiff, Math.abs(neighborHeight - blockHeight));
                }
            }
            
            // Use block height on cliffs (2+ block difference), interpolated on gentle slopes
            const effectiveHeight = maxHeightDiff >= 2 ? blockHeight : interpolatedHeight;
            
            const minY = effectiveHeight + this.groundOffset + 0.5;
            
            if (this.position.y <= minY) {
                this.position.y = minY;
                this.velocity.y = 0;
                this.onGround = true;
            } else {
                this.onGround = false;
            }
        }
        
        this.mesh.position.copy(this.position);
        
        // Horizontal damping only
        this.velocity.x *= 0.9;
        this.velocity.z *= 0.9;
    }

    moveTo(target, speed = 5) {
        const direction = new THREE.Vector3()
            .subVectors(target, this.position)
            .normalize();
        direction.y = 0; // Don't move vertically
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

// Hero riding a mount - now using HeroMount visual
export class Hero extends Entity {
    constructor(scene, position) {
        // Don't create visual mesh in Entity - we'll use HeroMount instead
        super(scene, position, 0x0066cc, 1.2);
        this.team = 'player';
        this.commandedGolems = [];
        this.rotation = 0; // Facing angle in radians
        this.moveSpeed = 12; // Faster than other units
        this.turnSpeed = 3; // Radians per second
        
        // Mount mesh has legs reaching y=0, so no extra ground offset needed
        this.groundOffset = 0;
        
        // Remove the basic Entity mesh
        this.scene.remove(this.mesh);
        
        // Create HeroMount for visuals
        this.heroMount = new HeroMount(this.scene, position);
        this.mesh = this.heroMount.mesh; // Use HeroMount's mesh as our entity mesh
        
        // Track movement state for animation
        this.isMoving = false;
        this.isJumping = false;
        this.oldRotation = 0; // Track rotation for turn animation
    }
    
    update(deltaTime, terrain, objectGenerator = null) {
        // Store old position and rotation for movement detection
        const oldPos = this.position.clone();
        const oldRot = this.oldRotation;
        
        // Update physics from Entity base class
        super.update(deltaTime, terrain, objectGenerator);
        
        // Sync HeroMount mesh position with entity position (including bob offset)
        this.heroMount.mesh.position.copy(this.position);
        this.heroMount.mesh.position.y += this.heroMount.bobOffset;
        
        // Update mesh rotation to face direction
        this.heroMount.setRotation(this.rotation);
        
        // Detect if we actually moved or turned (for animation)
        const moved = this.position.distanceTo(oldPos) > 0.01;
        const turned = Math.abs(this.rotation - oldRot) > 0.01;
        this.isMoving = moved || turned || this.velocity.length() > 0.1;
        
        // Show jump animation whenever airborne (jumping or falling)
        this.isJumping = !this.onGround;
        
        // Update HeroMount animation
        this.heroMount.update(deltaTime, this.isMoving, this.isJumping);
        
        // Store rotation for next frame
        this.oldRotation = this.rotation;
    }
    
    turn(direction, deltaTime) {
        // direction: -1 for left, 1 for right
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
        this.velocity.x -= direction.x * this.moveSpeed * 0.6 * deltaTime; // Slower backward
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
        // Command all golems to move to target
        this.commandedGolems.forEach(golem => {
            golem.moveTo(target, 3);
        });
    }

    addGolem(golem) {
        this.commandedGolems.push(golem);
        golem.team = 'player';
    }
    
    die() {
        this.heroMount.destroy();
        // Don't call super.die() since we already removed the mesh
    }
}

// Golem unit
export class Golem extends Entity {
    constructor(scene, position) {
        super(scene, position, 0xcc6600, 1.5);
        this.team = 'player';
        this.attackRange = 2;
        this.attackDamage = 10;
        this.attackCooldown = 1.0; // seconds
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

// Enemy AI unit
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

        // Simple AI: find nearest player entity and move toward it
        if (!this.targetEntity || this.targetEntity.health <= 0) {
            this.targetEntity = this.findNearestTarget(playerEntities);
        }

        if (this.targetEntity) {
            const distance = this.position.distanceTo(this.targetEntity.position);
            
            if (distance > this.attackRange) {
                // Move toward target
                this.moveTo(this.targetEntity.position, 2);
            } else {
                // Attack
                this.velocity.set(0, 0, 0);
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