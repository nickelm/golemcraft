import { Arrow } from '../combat.js';
import { Explosion } from '../mobs.js';

/**
 * CombatManager - Orchestrates combat mechanics
 *
 * Owns the lifecycle of projectiles, explosions, damage routing, and combat feedback.
 * Decouples combat mechanics from the main game loop.
 */
export class CombatManager {
    /**
     * @param {THREE.Scene} scene - For adding/removing arrow and explosion meshes
     * @param {Hero} hero - Target for enemy attacks, source position for player arrows
     * @param {MobSpawner} mobSpawner - Source of hostile mobs, skeleton arrows, explosions, loot
     * @param {TerrainDataProvider} terrain - Passed to arrow updates for stuck detection
     */
    constructor(scene, hero, mobSpawner, terrain) {
        this.scene = scene;
        this.hero = hero;
        this.mobSpawner = mobSpawner;
        this.terrain = terrain;

        // Projectile and effect collections
        this.arrows = [];
        this.explosions = [];

        // Callbacks (injected after construction)
        this.onHeroDamage = null;      // (amount, source) => void
        this.onHeroHeal = null;        // (amount) => void
        this.onXPGained = null;        // (amount, position) => void
        this.onLootCollected = null;   // (type, amount, position) => void
        this.onCraterRequested = null; // (position, radius) => void
        this.onFloatingNumber = null;  // (position, value, type, label?) => void
    }

    /**
     * Main update - call once per frame from game.js
     * @param {number} deltaTime - Time since last frame in seconds
     */
    update(deltaTime) {
        // 1. Spawn skeleton arrows from mobSpawner
        this.spawnSkeletonArrows();

        // 2. Spawn explosions from mobSpawner (creepers)
        this.spawnExplosions();

        // 3. Update all arrows - check hits against mobs (player arrows) or hero (enemy arrows)
        this.updateArrows(deltaTime);

        // 4. Update all explosions - apply radius damage to hero and mobs
        this.updateExplosions(deltaTime);

        // 5. Check melee attacks via mobSpawner
        this.checkMeleeAttacks();

        // 6. Process XP for newly dead mobs with killedByPlayer flag
        this.processXP();

        // 7. Collect loot from mobSpawner.getDroppedLoot()
        this.collectLoot();
    }

    /**
     * Spawn a player arrow (called by game.js when hero shoots)
     * @param {THREE.Vector3} start - Arrow start position
     * @param {THREE.Vector3} target - Arrow target position
     * @param {number} damage - Damage on hit
     */
    spawnPlayerArrow(start, target, damage) {
        const arrow = new Arrow(this.scene, start, target, damage);
        this.arrows.push(arrow);
    }

    /**
     * Get current arrow count (for debug/stats display)
     * @returns {number}
     */
    getArrowCount() {
        return this.arrows.length;
    }

    /**
     * Get current explosion count (for debug/stats display)
     * @returns {number}
     */
    getExplosionCount() {
        return this.explosions.length;
    }

    /**
     * Spawn skeleton arrows from mobSpawner
     */
    spawnSkeletonArrows() {
        if (!this.mobSpawner) return;

        const skeletonArrows = this.mobSpawner.getSkeletonArrows();
        skeletonArrows.forEach(arrowData => {
            const arrow = new Arrow(
                this.scene,
                arrowData.start,
                arrowData.target,
                arrowData.damage
            );
            arrow.isEnemyArrow = true;
            this.arrows.push(arrow);
        });
    }

    /**
     * Spawn explosions from mobSpawner (creeper explosions)
     */
    spawnExplosions() {
        if (!this.mobSpawner) return;

        const explosionDataList = this.mobSpawner.getExplosions();
        explosionDataList.forEach(explosionData => {
            const explosion = new Explosion(
                this.scene,
                explosionData.position,
                explosionData.radius
            );
            this.explosions.push(explosion);

            // Apply explosion damage to hero
            this.applyExplosionDamageToHero(explosionData);

            // Apply explosion damage to other mobs
            this.applyExplosionDamageToMobs(explosionData);

            // Request crater creation
            if (this.onCraterRequested) {
                this.onCraterRequested(explosionData.position, explosionData.radius);
            }
        });
    }

    /**
     * Apply explosion damage to hero based on distance
     * @param {Object} explosionData - { position, radius, damage }
     */
    applyExplosionDamageToHero(explosionData) {
        const distToPlayer = explosionData.position.distanceTo(this.hero.position);
        if (distToPlayer < explosionData.radius) {
            const damageFactor = 1 - (distToPlayer / explosionData.radius);
            const damage = Math.floor(explosionData.damage * damageFactor);
            if (damage > 0) {
                this.hero.takeDamage(damage);

                if (this.onHeroDamage) {
                    this.onHeroDamage(damage, 'explosion');
                }

                if (this.onFloatingNumber) {
                    this.onFloatingNumber(
                        this.hero.position.clone(),
                        damage,
                        'damage'
                    );
                }
            }
        }
    }

    /**
     * Apply explosion damage to nearby mobs
     * @param {Object} explosionData - { position, radius, damage }
     */
    applyExplosionDamageToMobs(explosionData) {
        if (!this.mobSpawner) return;

        this.mobSpawner.mobs.forEach(mob => {
            if (mob.dead) return;

            const distToMob = explosionData.position.distanceTo(mob.position);
            if (distToMob < explosionData.radius) {
                const damageFactor = 1 - (distToMob / explosionData.radius);
                const damage = Math.floor(explosionData.damage * damageFactor);
                if (damage > 0) {
                    mob.takeDamage(damage);

                    if (this.onFloatingNumber) {
                        this.onFloatingNumber(
                            mob.position.clone(),
                            damage,
                            'damage'
                        );
                    }
                }
            }
        });
    }

    /**
     * Update all arrows - check hits against mobs or hero
     * @param {number} deltaTime
     */
    updateArrows(deltaTime) {
        const hostileMobs = this.mobSpawner ? this.mobSpawner.getHostileMobs() : [];

        this.arrows = this.arrows.filter(arrow => {
            if (arrow.isEnemyArrow) {
                // Enemy arrows target the hero
                const result = arrow.update(deltaTime, this.terrain, []);

                if (!arrow.hit && !arrow.stuck) {
                    const distToPlayer = arrow.position.distanceTo(this.hero.position);
                    if (distToPlayer < 1.5) {
                        this.hero.takeDamage(arrow.damage);

                        if (this.onHeroDamage) {
                            this.onHeroDamage(arrow.damage, 'arrow');
                        }

                        if (this.onFloatingNumber) {
                            this.onFloatingNumber(
                                this.hero.position.clone(),
                                arrow.damage,
                                'damage'
                            );
                        }

                        arrow.hit = true;
                        arrow.destroy();
                        return false;
                    }
                }
                return result;
            } else {
                // Player arrows target hostile mobs
                return arrow.update(deltaTime, this.terrain, hostileMobs);
            }
        });
    }

    /**
     * Update explosion effects
     * @param {number} deltaTime
     */
    updateExplosions(deltaTime) {
        this.explosions = this.explosions.filter(explosion =>
            explosion.update(deltaTime)
        );
    }

    /**
     * Check melee attacks from hostile mobs
     */
    checkMeleeAttacks() {
        if (!this.mobSpawner) return;

        const mobDamage = this.mobSpawner.checkAttacks(this.hero.position);
        if (mobDamage > 0) {
            this.hero.takeDamage(mobDamage);

            if (this.onHeroDamage) {
                this.onHeroDamage(mobDamage, 'melee');
            }

            if (this.onFloatingNumber) {
                this.onFloatingNumber(
                    this.hero.position.clone(),
                    mobDamage,
                    'damage'
                );
            }
        }
    }

    /**
     * Process XP for newly dead mobs killed by player
     */
    processXP() {
        if (!this.mobSpawner) return;

        const hostileMobs = this.mobSpawner.getHostileMobs();
        hostileMobs.forEach(mob => {
            if (mob.dead && mob.xpValue > 0 && mob.killedByPlayer && !mob.xpAwarded) {
                mob.xpAwarded = true;

                if (this.onXPGained) {
                    this.onXPGained(mob.xpValue, mob.position.clone());
                }

                if (this.onFloatingNumber) {
                    this.onFloatingNumber(
                        mob.position.clone(),
                        mob.xpValue,
                        'xp'
                    );
                }
            }
        });
    }

    /**
     * Collect loot from killed mobs
     */
    collectLoot() {
        if (!this.mobSpawner) return;

        const droppedLoot = this.mobSpawner.getDroppedLoot();
        droppedLoot.forEach(loot => {
            Object.entries(loot.inventory).forEach(([type, amount]) => {
                if (amount > 0) {
                    if (this.onLootCollected) {
                        this.onLootCollected(type, amount, loot.position);
                    }
                }
            });
        });
    }
}
