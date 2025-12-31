import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TerrainGenerator, BLOCK_TYPES, createBlockGeometry, WATER_LEVEL } from './terrain.js';
import { ChunkedTerrain, CHUNK_SIZE } from './terrain-chunks.js';
import { ObjectGenerator } from './objects.js';
import { Hero } from './entities.js';
import { FPSCounter } from './utils/fps-counter.js';
import { TouchControls } from './utils/touch-controls.js';
import { CameraController } from './camera.js';
import { ItemSpawner } from './items.js';
import { Arrow } from './combat.js';
import { MobSpawner, Explosion } from './mobs.js';

export class Game {
    constructor(worldData = null) {
        this.worldData = worldData;
        this.gameTime = worldData?.gameTime || 0;
        
        this.isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
        this.scene = new THREE.Scene();
        this.camera = new THREE.PerspectiveCamera(
            60,
            window.innerWidth / window.innerHeight,
            0.1,
            this.isMobile ? 500 : 1000 // Half the view distance
        );
        
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

        // Use seed from world data, or generate random
        const seed = worldData?.seed ?? Math.floor(Math.random() * 100000);
        console.log('Using terrain seed:', seed);
        this.terrain = new TerrainGenerator(seed);
        this.objectGenerator = null; // Created after terrain
        this.entities = [];
        this.playerEntities = [];
        this.arrows = [];  // Active arrows in flight
        this.explosions = [];  // Active explosion effects
        
        // Mob spawner (created after terrain in init)
        this.mobSpawner = null;
        
        // Item spawner (created after camera in init)
        this.itemSpawner = null;
        
        // Player resources
        this.resources = {
            gold: 0,
            wood: 0,
            diamond: 0,
            iron: 0,
            coal: 0
        };
        
        this.keys = {};
        this.mouse = new THREE.Vector2();
        this.raycaster = new THREE.Raycaster();
        this.groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
        
        // Track mouse for click vs drag detection
        this.mouseDownPos = new THREE.Vector2();
        this.mouseDownTime = 0;
        this.isDragging = false;

        // FPS Counter
        this.fpsCounter = new FPSCounter();

        // Touch controls (for phones and tablets)
        this.touchControls = new TouchControls(this);

        // Camera controller (initialized after hero creation)
        this.cameraController = null;

        // Load terrain texture with mipmapping for better distance rendering
        const textureLoader = new THREE.TextureLoader();
        this.terrainTexture = textureLoader.load('./terrain-atlas.png', () => {
            this.init();
            this.setupEventListeners();
            this.animate();
        });
        
        // Texture filtering configuration
        this.terrainTexture.magFilter = THREE.NearestFilter;
        this.terrainTexture.minFilter = THREE.NearestFilter; // No mipmapping
        this.terrainTexture.generateMipmaps = false;
    }

    init() {
        this.scene.background = new THREE.Color(0x87ceeb);
        this.scene.fog = new THREE.Fog(0x87ceeb, 50, 150);

        // Lighting - store references for day/night cycle
        this.ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
        this.scene.add(this.ambientLight);

        this.directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
        this.directionalLight.position.set(50, 100, 50);
        this.directionalLight.castShadow = true;
        this.directionalLight.shadow.camera.left = -40;
        this.directionalLight.shadow.camera.right = 40;
        this.directionalLight.shadow.camera.top = 40;
        this.directionalLight.shadow.camera.bottom = -40;
        this.directionalLight.shadow.mapSize.width = 2048;
        this.directionalLight.shadow.mapSize.height = 2048;
        this.scene.add(this.directionalLight);
        
        // Torch (point light) - follows hero, visible at night
        this.torchLight = new THREE.PointLight(0xffd478, 0, 50, 1);
        this.torchLight.castShadow = false; // Performance: skip torch shadows
        this.scene.add(this.torchLight);
        
        // Time of day system
        this.timeOfDay = 'day';
        this.createTimeControls();

        // Generate chunked terrain (frustum culling optimization)
        this.chunkedTerrain = new ChunkedTerrain(this.scene, this.terrain, this.terrainTexture);
        this.chunkedTerrain.generate(500, 500);

        // Generate objects (trees, rocks, grass, cacti)
        this.objectGenerator = new ObjectGenerator(this.terrain);
        this.objectGenerator.generate(this.scene, 500, 500, WATER_LEVEL);
        
        // Initialize item spawner
        this.itemSpawner = new ItemSpawner(this.scene, this.terrain, this.camera);
        
        // Initialize mob spawner
        this.mobSpawner = new MobSpawner(this.scene, this.terrain);

        // Determine spawn position - use saved position or find new one
        let spawnPos;
        let spawnRotation = 0;
        
        if (this.worldData?.heroPosition) {
            // Restore saved position
            const saved = this.worldData.heroPosition;
            spawnPos = new THREE.Vector3(saved.x, saved.y, saved.z);
            spawnRotation = this.worldData.heroRotation || 0;
            console.log('Restoring hero position:', spawnPos);
        } else {
            // Find a good spawn point (above water, not too high)
            spawnPos = this.findSpawnPoint();
            console.log('New spawn position:', spawnPos);
        }
        
        // Create hero
        this.hero = new Hero(this.scene, spawnPos.clone());
        this.hero.rotation = spawnRotation;
        
        this.entities.push(this.hero);
        this.playerEntities.push(this.hero);

        // Note: Golems removed for now - will be replaced with rally system later
        // Note: EnemyUnits removed - hostile mobs now handled by MobSpawner

        // Position camera
        this.camera.position.set(spawnPos.x, spawnPos.y + 20, spawnPos.z + 30);
        this.camera.lookAt(spawnPos);
        this.controls.target.copy(spawnPos);
        
        // Initialize camera controller
        this.cameraController = new CameraController(this.camera, this.controls, this.hero);
    }
    
    createTimeControls() {
        const container = document.createElement('div');
        container.id = 'time-controls';
        container.style.cssText = `
            position: absolute;
            top: 60px;
            right: 10px;
            display: flex;
            flex-direction: column;
            gap: 5px;
            z-index: 1000;
        `;
        
        const times = [
            { id: 'day', label: '☀️ Day', shortcut: 'Y' },
            { id: 'sunset', label: '🌅 Sunset', shortcut: 'U' },
            { id: 'night', label: '🌙 Night', shortcut: 'I' }
        ];

        this.timeButtons = {};
        
        times.forEach(({ id, label, shortcut }) => {
            const btn = document.createElement('button');
            btn.textContent = `${label} [${shortcut}]`;
            btn.dataset.time = id;
            btn.style.cssText = `
                padding: 8px 12px;
                background: rgba(0, 0, 0, 0.6);
                color: white;
                border: 2px solid rgba(255, 255, 255, 0.3);
                border-radius: 4px;
                cursor: pointer;
                font-family: monospace;
                font-size: 12px;
                transition: all 0.2s;
            `;
            
            btn.addEventListener('click', () => this.setTimeOfDay(id));
            container.appendChild(btn);
            this.timeButtons[id] = btn;
        });
        
        // Torch toggle button
        this.torchEnabled = true;
        this.torchButton = document.createElement('button');
        this.torchButton.style.cssText = `
            padding: 8px 12px;
            background: rgba(0, 0, 0, 0.6);
            color: white;
            border: 2px solid rgba(255, 255, 255, 0.3);
            border-radius: 4px;
            cursor: pointer;
            font-family: monospace;
            font-size: 12px;
            transition: all 0.2s;
            margin-top: 10px;
        `;
        this.torchButton.addEventListener('click', () => this.toggleTorch());
        container.appendChild(this.torchButton);
        this.updateTorchButton();
        
        document.body.appendChild(container);
        this.updateTimeButtons();
        
        // Keyboard shortcuts
        window.addEventListener('keydown', (e) => {
            if (e.key.toLowerCase() === 'y') this.setTimeOfDay('day');
            if (e.key.toLowerCase() === 'u') this.setTimeOfDay('sunset');
            if (e.key.toLowerCase() === 'i') this.setTimeOfDay('night');
            if (e.key.toLowerCase() === 't') this.toggleTorch();
        });
    }
    
    toggleTorch() {
        this.torchEnabled = !this.torchEnabled;
        this.updateTorchButton();
        this.applyTorchState();
    }
    
    updateTorchButton() {
        if (this.torchEnabled) {
            this.torchButton.textContent = '🔦 Torch ON [T]';
            this.torchButton.style.background = 'rgba(180, 100, 0, 0.8)';
            this.torchButton.style.borderColor = 'rgba(255, 180, 100, 0.8)';
        } else {
            this.torchButton.textContent = '🔦 Torch OFF [T]';
            this.torchButton.style.background = 'rgba(0, 0, 0, 0.6)';
            this.torchButton.style.borderColor = 'rgba(255, 255, 255, 0.3)';
        }
    }
    
    applyTorchState() {
        // Get base torch intensity for current time of day
        const torchIntensities = { day: 0, sunset: 1.0, night: 6.0 };
        const baseIntensity = torchIntensities[this.timeOfDay] || 0;
        this.torchLight.intensity = this.torchEnabled ? baseIntensity : 0;
    }
    
    updateTimeButtons() {
        Object.entries(this.timeButtons).forEach(([id, btn]) => {
            if (id === this.timeOfDay) {
                btn.style.background = 'rgba(0, 100, 200, 0.8)';
                btn.style.borderColor = 'rgba(100, 180, 255, 0.8)';
            } else {
                btn.style.background = 'rgba(0, 0, 0, 0.6)';
                btn.style.borderColor = 'rgba(255, 255, 255, 0.3)';
            }
        });
    }
    
    setTimeOfDay(time) {
        this.timeOfDay = time;
        this.updateTimeButtons();
        
        // Lighting presets
        const presets = {
            day: {
                ambient: { color: 0xffffff, intensity: 0.6 },
                directional: { color: 0xffffff, intensity: 0.8 },
                sky: 0x87ceeb,
                fog: 0x87ceeb
            },
            sunset: {
                ambient: { color: 0xffa366, intensity: 0.4 },
                directional: { color: 0xff7733, intensity: 0.6 },
                sky: 0xff6b35,
                fog: 0xd4a574
            },
            night: {
                ambient: { color: 0x334466, intensity: 0.15 },
                directional: { color: 0x6688bb, intensity: 0.1 },
                sky: 0x0a0a1a,
                fog: 0x0a0a1a
            }
        };
        
        const p = presets[time];
        
        // Apply lighting
        this.ambientLight.color.setHex(p.ambient.color);
        this.ambientLight.intensity = p.ambient.intensity;
        
        this.directionalLight.color.setHex(p.directional.color);
        this.directionalLight.intensity = p.directional.intensity;
        
        // Apply torch based on toggle state
        this.applyTorchState();
        
        // Apply sky/fog
        this.scene.background.setHex(p.sky);
        this.scene.fog.color.setHex(p.fog);
    }

    findSpawnPoint(startX = 0, startZ = 0) {
        // Search for a suitable spawn point
        for (let radius = 0; radius < 50; radius++) {
            for (let angle = 0; angle < Math.PI * 2; angle += 0.5) {
                const x = Math.floor(startX + Math.cos(angle) * radius);
                const z = Math.floor(startZ + Math.sin(angle) * radius);
                const height = this.terrain.getHeight(x, z);
                
                // Good spawn: above water, not too high, no object collision
                const hasObject = this.objectGenerator && this.objectGenerator.hasCollision(x, z);
                if (height > WATER_LEVEL && height < 20 && !hasObject) {
                    return new THREE.Vector3(x, height + 2, z);
                }
            }
        }
        // Fallback
        return new THREE.Vector3(0, 15, 0);
    }

    // Note: isBlockVisible and generateTerrain moved to ChunkedTerrain class

    setupEventListeners() {
        window.addEventListener('keydown', (e) => {
            this.keys[e.key.toLowerCase()] = true;
        });

        window.addEventListener('keyup', (e) => {
            this.keys[e.key.toLowerCase()] = false;
        });

        window.addEventListener('mousemove', (e) => {
            this.mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
            this.mouse.y = -(e.clientY / window.innerHeight) * 2 + 1;
        });
        
        // Track mouse down position
        window.addEventListener('mousedown', (e) => {
            this.mouseDownPos.set(e.clientX, e.clientY);
            this.mouseDownTime = performance.now();
            this.isDragging = false;
        });
        
        // Detect drag vs click
        window.addEventListener('mousemove', (e) => {
            if (this.mouseDownTime > 0) {
                const moveDistance = Math.sqrt(
                    Math.pow(e.clientX - this.mouseDownPos.x, 2) +
                    Math.pow(e.clientY - this.mouseDownPos.y, 2)
                );
                
                // If mouse moved more than 5 pixels, it's a drag
                if (moveDistance > 5) {
                    this.isDragging = true;
                }
            }
        });

        // Only shoot on click (not drag)
        window.addEventListener('mouseup', () => {
            // Only trigger click if not dragging
            if (!this.isDragging) {
                this.handleClick();
            }
            this.mouseDownTime = 0;
            this.isDragging = false;
        });

        window.addEventListener('resize', () => {
            this.camera.aspect = window.innerWidth / window.innerHeight;
            this.camera.updateProjectionMatrix();
            this.renderer.setSize(window.innerWidth, window.innerHeight);
        });
    }

    handleClick() {
        this.raycaster.setFromCamera(this.mouse, this.camera);
        const intersects = this.raycaster.intersectObjects(this.scene.children);
        
        if (intersects.length > 0) {
            const point = intersects[0].point;
            
            // Shoot arrow at clicked location
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

    handleInput(deltaTime) {
        if (this.keys['a']) {
            this.hero.turn(1, deltaTime);
        }
        if (this.keys['d']) {
            this.hero.turn(-1, deltaTime);
        }
        if (this.keys['w']) {
            this.hero.moveForward(8 * deltaTime);
        }
        if (this.keys['s']) {
            this.hero.moveBackward(6 * deltaTime);
        }
        if (this.keys[' ']) {
            this.hero.jump(12);
        }
    }

    update(deltaTime) {
        this.touchControls.update(deltaTime);
        this.handleInput(deltaTime);
        
        // Update entities (just hero now, mobs handled by MobSpawner)
        this.entities.forEach(entity => {
            entity.update(deltaTime, this.terrain, this.objectGenerator);
        });

        this.entities = this.entities.filter(e => e.health > 0);
        this.playerEntities = this.playerEntities.filter(e => e.health > 0);
        
        // Update arrows - check collision with hostile mobs
        // Player arrows hit enemies, enemy arrows hit player
        const hostileMobs = this.mobSpawner ? this.mobSpawner.getHostileMobs() : [];
        const allEnemyTargets = hostileMobs;
        
        this.arrows = this.arrows.filter(arrow => {
            if (arrow.isEnemyArrow) {
                // Enemy arrow - check if it hits the player
                const result = arrow.update(deltaTime, this.terrain, []);
                
                // Check player collision manually
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
                // Player arrow - hits enemies
                return arrow.update(deltaTime, this.terrain, allEnemyTargets);
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
                // Mark as enemy arrow so it can hit the player
                arrow.isEnemyArrow = true;
                this.arrows.push(arrow);
            });
            
            // Check if hostile mobs attack hero (melee)
            const mobDamage = this.mobSpawner.checkAttacks(this.hero.position);
            if (mobDamage > 0) {
                this.hero.takeDamage(mobDamage);
                this.flashScreen('#FF0000', 0.3);
                
                // Show damage number
                if (this.itemSpawner) {
                    this.itemSpawner.showFloatingNumber(
                        this.hero.position.clone(),
                        mobDamage,
                        'damage'
                    );
                }
            }
            
            // Check for XP from killed mobs
            hostileMobs.forEach(mob => {
                if (mob.dead && mob.xpValue > 0 && !mob.xpAwarded) {
                    mob.xpAwarded = true;
                    // Award XP (add to resources for now, or create XP system later)
                    if (this.itemSpawner) {
                        this.itemSpawner.showFloatingNumber(
                            mob.position.clone(),
                            mob.xpValue,
                            'xp'
                        );
                    }
                }
            });
            
            // Collect loot dropped by killed mobs
            const droppedLoot = this.mobSpawner.getDroppedLoot();
            droppedLoot.forEach(loot => {
                // Add resources directly to player
                Object.entries(loot.inventory).forEach(([type, amount]) => {
                    if (amount > 0 && this.resources.hasOwnProperty(type)) {
                        this.resources[type] += amount;
                        
                        // Show floating number for each resource type
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
            
            // Handle creeper explosions
            const explosions = this.mobSpawner.getExplosions();
            explosions.forEach(explosionData => {
                // Create visual explosion effect
                const explosion = new Explosion(
                    this.scene,
                    explosionData.position,
                    explosionData.radius
                );
                this.explosions.push(explosion);
                
                // Damage player if in range
                const distToPlayer = explosionData.position.distanceTo(this.hero.position);
                if (distToPlayer < explosionData.radius) {
                    // Damage falls off with distance
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
                
                // Destroy blocks in radius
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
            
            // Check item collection for hero
            const collected = this.itemSpawner.checkCollection(this.hero);
            collected.forEach(item => {
                this.collectItem(item);
            });
        }

        // Update camera
        this.cameraController.update(deltaTime);
        
        // Move shadow light to follow hero (keeps shadows working everywhere)
        if (this.directionalLight) {
            const heroPos = this.hero.position;
            this.directionalLight.position.set(heroPos.x + 30, heroPos.y + 80, heroPos.z + 30);
            this.directionalLight.target.position.copy(heroPos);
            this.directionalLight.target.updateMatrixWorld();
        }
        
        // Torch follows hero (positioned above and slightly in front)
        if (this.torchLight) {
            const heroPos = this.hero.position;
            const heroRot = this.hero.rotation;
            this.torchLight.position.set(
                heroPos.x + Math.sin(heroRot) * 0.5,
                heroPos.y + 3,
                heroPos.z + Math.cos(heroRot) * 0.5
            );
        }
        
        this.controls.update();
        this.updateUI();
    }

    updateUI() {
        const stats = document.getElementById('stats');
        const biome = this.terrain.getBiome(
            Math.floor(this.hero.position.x),
            Math.floor(this.hero.position.z)
        );
        const cameraMode = this.cameraController ? this.cameraController.mode : 'orbit';
        const mobCount = this.mobSpawner ? this.mobSpawner.mobs.length : 0;
        
        stats.innerHTML = `
            Health: ${Math.max(0, Math.floor(this.hero.health))}/${this.hero.maxHealth}<br>
            Biome: ${biome}<br>
            Mobs: ${mobCount}<br>
            Gold: ${this.resources.gold}<br>
            Wood: ${this.resources.wood}<br>
            Iron: ${this.resources.iron}<br>
            Coal: ${this.resources.coal}<br>
            Diamonds: ${this.resources.diamond}
        `;
    }
    
    /**
     * Handle item collection
     */
    collectItem(item) {
        const config = item.config;
        const value = item.value;  // Use randomized value
        
        // Food restores health
        if (item.type === 'food') {
            const oldHealth = this.hero.health;
            this.hero.health = Math.min(this.hero.maxHealth, this.hero.health + value);
            const healed = this.hero.health - oldHealth;
            
            // Always show feedback, even if at full health
            if (this.itemSpawner) {
                this.itemSpawner.showFloatingNumber(
                    this.hero.position.clone(),
                    Math.floor(healed),
                    'heal',
                    config.name
                );
            }
            
            // Flash screen green (always, even at full health for feedback)
            this.flashScreen('#00FF00', 0.3);
        } else {
            // Add to resources
            if (this.resources.hasOwnProperty(item.type)) {
                this.resources[item.type] += value;
                
                // Show floating number with item name
                if (this.itemSpawner) {
                    this.itemSpawner.showFloatingNumber(
                        this.hero.position.clone(),
                        value,
                        'resource',
                        config.name
                    );
                }
                
                // Flash screen in item color
                const flashColors = {
                    gold: '#FFD700',
                    diamond: '#00FFFF',
                    wood: '#8B4513',
                    iron: '#A0A0A0',
                    coal: '#FFFFFF'
                };
                this.flashScreen(flashColors[item.type] || '#FFD700', 0.2);
                
                // Pulse the resource in UI
                this.pulseResourceUI(item.type);
            }
        }
    }
    
    /**
     * Flash the screen with a color (useful in first-person)
     */
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
        
        // Fade out and remove
        setTimeout(() => {
            flash.style.opacity = '0';
            setTimeout(() => flash.remove(), 300);
        }, 100);
    }
    
    /**
     * Pulse a resource counter in the UI
     */
    pulseResourceUI(resourceType) {
        // This will be visible even in first-person mode
        const stats = document.getElementById('stats');
        if (!stats) return;
        
        // Add a highlight class that pulses
        stats.classList.add('resource-pulse');
        setTimeout(() => stats.classList.remove('resource-pulse'), 500);
    }
    
    /**
     * Create explosion crater by destroying blocks
     */
    createExplosionCrater(position, radius) {
        const centerX = Math.floor(position.x);
        const centerY = Math.floor(position.y);
        const centerZ = Math.floor(position.z);
        const intRadius = Math.ceil(radius);
        
        // Destroy blocks in spherical radius
        for (let dx = -intRadius; dx <= intRadius; dx++) {
            for (let dy = -intRadius; dy <= intRadius; dy++) {
                for (let dz = -intRadius; dz <= intRadius; dz++) {
                    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
                    if (dist <= radius) {
                        const x = centerX + dx;
                        const y = centerY + dy;
                        const z = centerZ + dz;
                        
                        // Don't destroy bedrock (y <= 0) or water
                        if (y > 0) {
                            const blockType = this.terrain.getBlockType(x, y, z);
                            if (blockType && blockType !== 'water' && blockType !== 'water_full') {
                                this.terrain.destroyBlock(x, y, z);
                            }
                        }
                    }
                }
            }
        }
        
        // Regenerate affected chunks
        this.chunkedTerrain.regenerateChunksInRadius(centerX, centerZ, intRadius + 1);
    }

    animate() {
        requestAnimationFrame(() => this.animate());
        
        this.fpsCounter.update();
        
        const deltaTime = this.isMobile ? 0.032 : 0.016;
        this.update(deltaTime);
        this.renderer.render(this.scene, this.camera);
    }
}