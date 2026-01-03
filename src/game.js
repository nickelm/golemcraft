import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { WorldManager, WATER_LEVEL } from './world/worldmanager.js';
import { Hero } from './entities.js';
import { FPSCounter } from './utils/ui/fps-counter.js';
import { TouchControls } from './utils/ui/touch-controls.js';
import { CameraController } from './camera.js';
import { ItemSpawner } from './items.js';
import { Arrow } from './combat.js';
import { MobSpawner, Explosion } from './mobs.js';
import { AtmosphereController } from './atmosphere/atmospherecontroller.js';
import { InputController } from './inputcontroller.js';
import { PerformanceMonitor } from './utils/ui/performance-monitor.js';
import { LoadingOverlay } from './utils/ui/loading-overlay.js';

export class Game {
    constructor(worldData = null) {
        this.worldData = worldData;
        
        this.isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
        this.scene = new THREE.Scene();
        this.camera = new THREE.PerspectiveCamera(
            60,
            window.innerWidth / window.innerHeight,
            0.1,
            this.isMobile ? 500 : 1000
        );
        
        // Enable layer 1 rendering for celestial objects (sun/moon)
        this.camera.layers.enable(1);
        
        this.renderer = new THREE.WebGLRenderer({ antialias: true });
        this.renderer.setPixelRatio(this.isMobile ? 1 : Math.min(window.devicePixelRatio, 2));
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.shadowMap.enabled = !this.isMobile;
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        document.body.appendChild(this.renderer.domElement);

        this.controls = new OrbitControls(this.camera, this.renderer.domElement);
        this.controls.enableDamping = true;
        this.controls.dampingFactor = 0.05;
        this.controls.maxPolarAngle = Math.PI / 2.5;
        this.controls.enablePan = false;

        // Use seed from world data, or generate random
        const seed = worldData?.seed ?? Math.floor(Math.random() * 100000);
        const worldId = worldData?.id ?? 'default';
        console.log('Using terrain seed:', seed, 'worldId:', worldId);
        
        this.world = null; // Will be initialized after texture loads
        this.seed = seed;
        this.worldId = worldId;
        
        this.entities = [];
        this.playerEntities = [];
        this.arrows = [];
        this.explosions = [];
        
        this.mobSpawner = null;
        this.itemSpawner = null;
        
        // Player resources
        this.resources = {
            gold: 0,
            wood: 0,
            diamond: 0,
            iron: 0,
            coal: 0
        };
        
        // Atmosphere system (handles day/night, lighting, weather, torch)
        this.atmosphere = new AtmosphereController(this.scene, this.isMobile);
        if (worldData?.gameTime) {
            this.atmosphere.setTime(worldData.gameTime);
        }
        
        // Input controller (handles keyboard, mouse, touch events)
        this.input = new InputController(this.renderer, this.camera);
        this.input.setLeftClickCallback(() => this.handleClick());
        this.input.setRightDragCallback((deltaX, deltaY) => this.handleRightDrag(deltaX, deltaY));
        
        // For compatibility with TouchControls
        this.keys = this.input.keys;
        this.raycaster = this.input.raycaster;

        // FPS Counter
        this.fpsCounter = new FPSCounter();

        // Performance Monitor (desktop only by default, toggle with P key)
        this.performanceMonitor = new PerformanceMonitor();
        this.showPerformanceMonitor = false;
        this.performanceMonitor.element.style.display = 'none';
        
        // Toggle performance monitor with P key (desktop only)
        window.addEventListener('keydown', (e) => {
            if (e.key === 'p' || e.key === 'P') {
                this.showPerformanceMonitor = !this.showPerformanceMonitor;
                this.performanceMonitor.element.style.display = 
                    this.showPerformanceMonitor ? 'block' : 'none';
            }
        });

        // Touch controls
        this.touchControls = new TouchControls(this);

        // Camera controller (initialized after hero creation)
        this.cameraController = null;

        // Loading overlay for chunk loading
        this.loadingOverlay = new LoadingOverlay();
        this.isPaused = false;        

        // Fixed timestep simulation with accumulator
        this.lastFrameTime = performance.now();
        this.fixedTimestep = 1 / 60; // Always simulate at 60 Hz (0.0167 seconds)
        this.accumulator = 0;
        this.maxAccumulator = 0.2; // Cap at 200ms (prevents spiral of death at <5 FPS)

        // Load terrain texture
        const textureLoader = new THREE.TextureLoader();
        this.terrainTexture = textureLoader.load('./terrain-atlas.png', async () => {
            await this.init();
            this.animate();
        });

        this.terrainTexture.magFilter = THREE.NearestFilter;
        this.terrainTexture.minFilter = THREE.NearestFilter;
        this.terrainTexture.generateMipmaps = false;
        
        // Window resize handler
        window.addEventListener('resize', () => {
            this.camera.aspect = window.innerWidth / window.innerHeight;
            this.camera.updateProjectionMatrix();
            this.renderer.setSize(window.innerWidth, window.innerHeight);
        });
    }

    async init() {
        this.scene.background = new THREE.Color(0x87ceeb);
        this.scene.fog = new THREE.Fog(0x87ceeb, 50, 150);

        // Show loading overlay
        this.loadingOverlay.show();

        // Get initial player position (from saved data or default)
        const savedPos = this.worldData?.heroPosition;
        const initialPosition = savedPos 
            ? { x: savedPos.x, y: savedPos.y, z: savedPos.z }
            : { x: 0, y: 10, z: 0 };

        // Create world manager (no sync load anymore)
        this.world = new WorldManager(
            this.scene,
            this.terrainTexture,
            this.seed,
            this.worldId,
            this.isMobile
        );

        // Initialize world asynchronously with progress callback
        await this.world.init(initialPosition, (loaded, total) => {
            this.loadingOverlay.setProgress(loaded, total);
        });

        // Hide loading overlay
        this.loadingOverlay.hide();

        // Set up loading state callback for runtime loading
        this.world.setLoadingCallback((isLoading) => {
            this.isPaused = isLoading;
            if (isLoading) {
                this.loadingOverlay.show();
                // Update progress during runtime loading
                const stats = this.world.chunkLoader.getStats();
                const pending = this.world.chunkLoader.getPendingCount();
                this.loadingOverlay.setProgress(stats.withMeshes, stats.withMeshes + pending);
            } else {
                this.loadingOverlay.hide();
            }
        });

        // Initialize spawners
        this.itemSpawner = new ItemSpawner(this.scene, this.world.terrain, this.camera);
        this.mobSpawner = new MobSpawner(this.scene, this.world.terrain);

        // Determine spawn position
        let spawnPos;
        let spawnRotation = 0;
        
        if (this.worldData?.heroPosition) {
            const saved = this.worldData.heroPosition;
            spawnPos = new THREE.Vector3(saved.x, saved.y, saved.z);
            spawnRotation = this.worldData.heroRotation || 0;
            console.log('Restoring hero position:', spawnPos);
        } else {
            spawnPos = this.findSpawnPoint();
            console.log('New spawn position:', spawnPos);
        }
        
        // Create hero
        this.hero = new Hero(this.scene, spawnPos.clone());
        this.hero.rotation = spawnRotation;
        
        this.entities.push(this.hero);
        this.playerEntities.push(this.hero);

        // Position camera
        this.camera.position.set(spawnPos.x, spawnPos.y + 20, spawnPos.z + 30);
        this.camera.lookAt(spawnPos);
        this.controls.target.copy(spawnPos);
        
        // Initialize camera controller
        this.cameraController = new CameraController(this.camera, this.controls, this.hero);
    }

    findSpawnPoint(startX = 0, startZ = 0) {
        for (let radius = 0; radius < 50; radius++) {
            for (let angle = 0; angle < Math.PI * 2; angle += 0.5) {
                const x = Math.floor(startX + Math.cos(angle) * radius);
                const z = Math.floor(startZ + Math.sin(angle) * radius);
                const height = this.world.getHeight(x, z);
                
                const hasObject = this.world.objectGenerator && this.world.objectGenerator.hasCollision(x, z);
                if (height > WATER_LEVEL && height < 20 && !hasObject) {
                    return new THREE.Vector3(x, height + 2, z);
                }
            }
        }
        return new THREE.Vector3(0, 15, 0);
    }

    handleClick() {
        const intersects = this.input.raycast(this.scene, true);
        
        if (intersects.length > 0) {
            const point = intersects[0].point;
            
            const arrowData = this.hero.shootArrow(point);
            if (arrowData) {
                const arrow = new Arrow(
                    this.scene,
                    arrowData.start,
                    arrowData.target,
                    arrowData.damage
                );
                this.arrows.push(arrow);
            }
        }
    }
    
    // handleRightDrag(deltaX) {
    //     const rotationSpeed = 0.002;
    //     this.hero.rotation -= deltaX * rotationSpeed;
        
    //     // In orbit mode, rotate camera around hero
    //     if (this.cameraController && this.cameraController.mode === 'orbit') {
    //         const angle = deltaX * rotationSpeed;
    //         const heroPos = this.hero.position;
            
    //         // Rotate camera position around hero
    //         const dx = this.camera.position.x - heroPos.x;
    //         const dz = this.camera.position.z - heroPos.z;
    //         const cos = Math.cos(angle);
    //         const sin = Math.sin(angle);
            
    //         this.camera.position.x = heroPos.x + (dx * cos - dz * sin);
    //         this.camera.position.z = heroPos.z + (dx * sin + dz * cos);
    //     }
    // }
    handleRightDrag(deltaX, deltaY) {
        const rotationSpeed = 0.002;
        this.hero.rotation -= deltaX * rotationSpeed;
        
        // In orbit mode, rotate camera around hero
        if (this.cameraController && this.cameraController.mode === 'orbit') {
            const angle = deltaX * rotationSpeed;
            const heroPos = this.hero.position;
            
            // Rotate camera position around hero
            const dx = this.camera.position.x - heroPos.x;
            const dz = this.camera.position.z - heroPos.z;
            const cos = Math.cos(angle);
            const sin = Math.sin(angle);
            
            this.camera.position.x = heroPos.x + (dx * cos - dz * sin);
            this.camera.position.z = heroPos.z + (dx * sin + dz * cos);
        }
        
        // Handle vertical look for first-person mode
        if (this.cameraController) {
            this.cameraController.handleLook(deltaX, deltaY);
        }
    } 

    handleInput(deltaTime) {
        if (this.input.isKeyPressed('a')) {
            this.hero.turn(1, deltaTime);
        }
        if (this.input.isKeyPressed('d')) {
            this.hero.turn(-1, deltaTime);
        }
        if (this.input.isKeyPressed('w')) {
            this.hero.moveForward(8 * deltaTime);
        }
        if (this.input.isKeyPressed('s')) {
            this.hero.moveBackward(6 * deltaTime);
        }
        if (this.input.isKeyPressed(' ')) {
            this.hero.jump(12);
        }
    }

    update(deltaTime) {
        // Update world first - it returns true if loading
        const needsLoading = this.world.update(this.hero.position);
        
        // Skip rest of update if loading
        if (needsLoading) return;

        this.touchControls.update(deltaTime);
        this.handleInput(deltaTime);
        
        // Update world (chunk loading/unloading)
        this.world.update(this.hero.position);
        
        // Update entities
        this.entities.forEach(entity => {
            entity.update(deltaTime, this.world.terrain, this.world.objectGenerator);
        });

        this.entities = this.entities.filter(e => e.health > 0);
        this.playerEntities = this.playerEntities.filter(e => e.health > 0);
        
        // Update arrows
        const hostileMobs = this.mobSpawner ? this.mobSpawner.getHostileMobs() : [];
        const allEnemyTargets = hostileMobs;
        
        this.arrows = this.arrows.filter(arrow => {
            if (arrow.isEnemyArrow) {
                const result = arrow.update(deltaTime, this.world.terrain, []);
                
                if (!arrow.hit && !arrow.stuck) {
                    const distToPlayer = arrow.position.distanceTo(this.hero.position);
                    if (distToPlayer < 1.5) {
                        this.hero.takeDamage(arrow.damage);
                        this.flashScreen('#FF0000', 0.3);
                        if (this.itemSpawner) {
                            this.itemSpawner.showFloatingNumber(
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
                return arrow.update(deltaTime, this.world.terrain, allEnemyTargets);
            }
        });
        
        // Update mob spawner
        if (this.mobSpawner) {
            this.mobSpawner.update(deltaTime, this.hero.position, WATER_LEVEL, this.itemSpawner);
            
            // Spawn skeleton arrows
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
            
            // Check melee attacks
            const mobDamage = this.mobSpawner.checkAttacks(this.hero.position);
            if (mobDamage > 0) {
                this.hero.takeDamage(mobDamage);
                this.flashScreen('#FF0000', 0.3);
                
                if (this.itemSpawner) {
                    this.itemSpawner.showFloatingNumber(
                        this.hero.position.clone(),
                        mobDamage,
                        'damage'
                    );
                }
            }
            
            // XP from killed mobs
            hostileMobs.forEach(mob => {
                if (mob.dead && mob.xpValue > 0 && mob.killedByPlayer && !mob.xpAwarded) {
                    mob.xpAwarded = true;
                    if (this.itemSpawner) {
                        this.itemSpawner.showFloatingNumber(
                            mob.position.clone(),
                            mob.xpValue,
                            'xp'
                        );
                    }
                }
            });
            
            // Collect loot
            const droppedLoot = this.mobSpawner.getDroppedLoot();
            droppedLoot.forEach(loot => {
                Object.entries(loot.inventory).forEach(([type, amount]) => {
                    if (amount > 0 && this.resources.hasOwnProperty(type)) {
                        this.resources[type] += amount;
                        
                        if (this.itemSpawner) {
                            const names = {
                                gold: 'Gold',
                                wood: 'Wood', 
                                diamond: 'Diamond',
                                iron: 'Iron',
                                coal: 'Coal'
                            };
                            this.itemSpawner.showFloatingNumber(
                                loot.position,
                                amount,
                                'resource',
                                names[type]
                            );
                        }
                    }
                });
            });
            
            // Handle explosions
            const explosions = this.mobSpawner.getExplosions();
            explosions.forEach(explosionData => {
                const explosion = new Explosion(
                    this.scene,
                    explosionData.position,
                    explosionData.radius
                );
                this.explosions.push(explosion);
                
                // Damage player
                const distToPlayer = explosionData.position.distanceTo(this.hero.position);
                if (distToPlayer < explosionData.radius) {
                    const damageFactor = 1 - (distToPlayer / explosionData.radius);
                    const damage = Math.floor(explosionData.damage * damageFactor);
                    if (damage > 0) {
                        this.hero.takeDamage(damage);
                        this.flashScreen('#FF6600', 0.5);
                        if (this.itemSpawner) {
                            this.itemSpawner.showFloatingNumber(
                                this.hero.position.clone(),
                                damage,
                                'damage'
                            );
                        }
                    }
                }
                
                // Damage other mobs
                if (this.mobSpawner) {
                    this.mobSpawner.mobs.forEach(mob => {
                        if (mob.dead) return;
                        const distToMob = explosionData.position.distanceTo(mob.position);
                        if (distToMob < explosionData.radius) {
                            const damageFactor = 1 - (distToMob / explosionData.radius);
                            const damage = Math.floor(explosionData.damage * damageFactor);
                            if (damage > 0) {
                                mob.takeDamage(damage);
                                if (this.itemSpawner) {
                                    this.itemSpawner.showFloatingNumber(
                                        mob.position.clone(),
                                        damage,
                                        'damage'
                                    );
                                }
                            }
                        }
                    });
                }
                
                // Destroy blocks
                this.createExplosionCrater(explosionData.position, explosionData.radius);
            });
        }
        
        // Update explosion effects
        this.explosions = this.explosions.filter(explosion => 
            explosion.update(deltaTime)
        );
        
        // Update item spawner
        if (this.itemSpawner) {
            this.itemSpawner.update(deltaTime, this.hero.position);
            
            const collected = this.itemSpawner.checkCollection(this.hero);
            collected.forEach(item => {
                this.collectItem(item);
            });
        }

        // Update camera
        this.cameraController.update(deltaTime);
        
        // Update atmosphere (day/night, lighting, torch)
        const { timeOfDay } = this.atmosphere.update(
            deltaTime,
            this.hero.position,
            this.hero.rotation
        );
        this.gameTime = timeOfDay;  // For saving
        
        if (!this.cameraController || this.cameraController.mode !== 'first-person') {
            this.controls.update();
        }
        // this.controls.update();
        this.updateUI();
    }

    updateUI() {
        const stats = document.getElementById('stats');
        const biome = this.world.getBiome(
            Math.floor(this.hero.position.x),
            Math.floor(this.hero.position.z)
        );
        const mobCount = this.mobSpawner ? this.mobSpawner.mobs.length : 0;
        
        stats.innerHTML = `
            Health: ${Math.max(0, Math.floor(this.hero.health))}/${this.hero.maxHealth}<br>
            Biome: ${biome}<br>
            Mobs: ${mobCount}<br>
            Gold: ${this.resources.gold}<br>
            Wood: ${this.resources.wood}<br>
            Iron: ${this.resources.iron}<br>
            Coal: ${this.resources.coal}<br>
            Diamonds: ${this.resources.diamond}<br>
        `;
    }
    
    collectItem(item) {
        const config = item.config;
        const value = item.value;
        
        if (item.type === 'food') {
            const oldHealth = this.hero.health;
            this.hero.health = Math.min(this.hero.maxHealth, this.hero.health + value);
            const healed = this.hero.health - oldHealth;
            
            if (this.itemSpawner) {
                this.itemSpawner.showFloatingNumber(
                    this.hero.position.clone(),
                    Math.floor(healed),
                    'heal',
                    config.name
                );
            }
            
            this.flashScreen('#00FF00', 0.3);
        } else {
            if (this.resources.hasOwnProperty(item.type)) {
                this.resources[item.type] += value;
                
                if (this.itemSpawner) {
                    this.itemSpawner.showFloatingNumber(
                        this.hero.position.clone(),
                        value,
                        'resource',
                        config.name
                    );
                }
                
                const flashColors = {
                    gold: '#FFD700',
                    diamond: '#00FFFF',
                    wood: '#8B4513',
                    iron: '#A0A0A0',
                    coal: '#FFFFFF'
                };
                this.flashScreen(flashColors[item.type] || '#FFD700', 0.2);
                
                this.pulseResourceUI(item.type);
            }
        }
    }
    
    flashScreen(color, opacity = 0.3) {
        const flash = document.createElement('div');
        flash.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: ${color};
            opacity: ${opacity};
            pointer-events: none;
            z-index: 9999;
            transition: opacity 0.3s;
        `;
        document.body.appendChild(flash);
        
        setTimeout(() => {
            flash.style.opacity = '0';
            setTimeout(() => flash.remove(), 300);
        }, 100);
    }
    
    pulseResourceUI(resourceType) {
        const stats = document.getElementById('stats');
        if (!stats) return;
        
        stats.classList.add('resource-pulse');
        setTimeout(() => stats.classList.remove('resource-pulse'), 500);
    }
    
    createExplosionCrater(position, radius) {
        this.world.createExplosionCrater(position, radius);
    }

    animate() {
        requestAnimationFrame(() => this.animate());
        
        const now = performance.now();
        const elapsed = (now - this.lastFrameTime) / 1000;
        this.lastFrameTime = now;
        
        // Skip simulation when loading
        if (!this.isPaused) {
            this.accumulator += elapsed;
            
            if (this.accumulator > this.maxAccumulator) {
                this.accumulator = this.maxAccumulator;
            }
            
            while (this.accumulator >= this.fixedTimestep) {
                this.update(this.fixedTimestep);
                this.accumulator -= this.fixedTimestep;
            }
        } else {
            // Still update world to process chunk loading
            if (this.world && this.hero) {
                this.world.update(this.hero.position);
                
                // Update loading progress
                const stats = this.world.chunkLoader.getStats();
                const pending = this.world.chunkLoader.getPendingCount();
                this.loadingOverlay.setProgress(stats.withMeshes, stats.withMeshes + pending);
            }
        }
        
        this.fpsCounter.update();
        
    //     // ... rest of animate
        
    //     this.renderer.render(this.scene, this.camera);
    // }
    // animate() {
    //     requestAnimationFrame(() => this.animate());
        
    //     // Calculate actual time elapsed since last frame
    //     const now = performance.now();
    //     const elapsed = (now - this.lastFrameTime) / 1000; // Convert ms to seconds
    //     this.lastFrameTime = now;
        
    //     // Add elapsed time to accumulator
    //     this.accumulator += elapsed;
        
    //     // Cap accumulator to prevent spiral of death at very low frame rates
    //     if (this.accumulator > this.maxAccumulator) {
    //         this.accumulator = this.maxAccumulator;
    //     }
        
    //     // Run fixed timestep updates until we've caught up with real time
    //     let stepsThisFrame = 0;
    //     while (this.accumulator >= this.fixedTimestep) {
    //         this.update(this.fixedTimestep); // Always 0.0167s
    //         this.accumulator -= this.fixedTimestep;
    //         // stepsThisFrame++;
    //         // this.simStepsThisSecond++;
    //         // this.simStepsTotal++;
    //     }
        
    //     this.fpsCounter.update();
        
        // Only update performance monitor if visible (saves CPU on mobile)
        if (this.showPerformanceMonitor) {
            const gameStats = {
                deltaTime: this.fixedTimestep,
                chunks: this.world ? this.world.chunkLoader.loadedChunks.size : 0,
                pendingChunks: this.world ? this.world.chunkLoader.getPendingCount() : 0,
                workerStats: this.world ? this.world.getWorkerStats() : null,
                mobs: this.mobSpawner ? this.mobSpawner.mobs.length : 0,
                entities: this.entities.length,
                arrows: this.arrows.length
            };
            this.performanceMonitor.update(this.renderer, gameStats);
        }
        
        this.renderer.render(this.scene, this.camera);
    }
}