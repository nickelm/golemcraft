import * as THREE from 'three';
import { WorldManager, WATER_LEVEL } from './world/worldmanager.js';
import { Hero } from './entities.js';
import { FPSCounter } from './utils/ui/fps-counter.js';
import { TouchControls } from './utils/ui/touch-controls.js';
import { CameraController } from './camera.js';
import { ItemSpawner } from './items.js';
import { MobSpawner } from './mobs.js';
import { SpawnPointManager } from './world/spawnpointmanager.js';
import { AtmosphereController } from './atmosphere/atmospherecontroller.js';
import { InputController } from './inputcontroller.js';
import { DroppedTorch } from './droppedtorch.js';
import { PerformanceMonitor } from './utils/ui/performance-monitor.js';
import { LoadingOverlay } from './utils/ui/loading-overlay.js';
import { TerrainLoadingIndicator } from './utils/ui/terrain-loading-indicator.js';
import { flashScreen, pulseResourceUI } from './utils/ui/feedback.js';
import { settingsManager } from './settings.js';
import { CombatManager } from './combat/combatmanager.js';
import { TNTManager } from './world/tntmanager.js';
import { MapOverlay } from './ui/mapoverlay.js';

export class Game {
    constructor(worldData = null) {
        this.worldData = worldData;

        // Get resolved settings (auto values resolved to detected tier)
        this.textureBlending = settingsManager.get('textureBlending');
        this.drawDistance = settingsManager.get('drawDistance');
        this.showFpsSetting = settingsManager.get('showFps');
        this.showPerformanceSetting = settingsManager.get('showPerformance');
        this.showLoadingIndicatorSetting = settingsManager.get('showLoadingIndicator');

        // Legacy isMobile - used for some rendering options
        this.isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);

        // Camera far plane based on draw distance setting
        const cameraFar = {
            far: 1000,
            medium: 500,
            near: 300
        }[this.drawDistance] || 500;

        this.scene = new THREE.Scene();
        this.camera = new THREE.PerspectiveCamera(
            60,
            window.innerWidth / window.innerHeight,
            0.1,
            cameraFar
        );
        
        // Enable layer 1 rendering for celestial objects (sun/moon)
        this.camera.layers.enable(1);
        
        this.renderer = new THREE.WebGLRenderer({ antialias: true });
        this.renderer.setPixelRatio(this.isMobile ? 1 : Math.min(window.devicePixelRatio, 2));
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.shadowMap.enabled = !this.isMobile;
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        document.body.appendChild(this.renderer.domElement);

        // Use seed from world data, or generate random
        const seed = worldData?.seed ?? Math.floor(Math.random() * 100000);
        const worldId = worldData?.id ?? 'default';
        console.log('Using terrain seed:', seed, 'worldId:', worldId);

        this.world = null; // Will be initialized after texture loads
        this.seed = seed;
        this.worldId = worldId;

        // Continental mode: bounded island instead of infinite terrain
        this.continentConfig = {
            enabled: true,
            baseRadius: 2000  // ~4km diameter island
        };
        
        this.entities = [];
        this.playerEntities = [];
        this.torches = [];

        this.mobSpawner = null;
        this.itemSpawner = null;
        this.combatManager = null;
        this.tntManager = null;

        // Player resources
        this.resources = {
            gold: 0,
            wood: 0,
            diamond: 0,
            iron: 0,
            coal: 0,
            tnt: 0
        };
        
        // Atmosphere system (handles day/night, lighting, weather, torch)
        this.atmosphere = new AtmosphereController(this.scene, this.isMobile);
        if (worldData?.gameTime) {
            this.atmosphere.setTime(worldData.gameTime);
        }
        
        // Input controller (handles keyboard, mouse, touch events)
        this.input = new InputController(this.renderer, this.camera);
        this.input.setLeftClickCallback(() => this.handleClick());
        // Left-drag: Camera orbit (follow mode)
        this.input.setLeftDragCallback((deltaX, deltaY) => this.handleLeftDrag(deltaX, deltaY));
        this.input.setLeftDragStartCallback(() => this.handleLeftDragStart());
        this.input.setLeftDragEndCallback(() => this.handleLeftDragEnd());
        // Right-drag: Hero rotation (both modes)
        this.input.setRightDragCallback((deltaX, deltaY) => this.handleRightDrag(deltaX, deltaY));
        this.input.setRightDragStartCallback(() => this.handleRightDragStart());
        this.input.setRightDragEndCallback(() => this.handleRightDragEnd());
        this.input.setScrollWheelCallback((delta) => this.handleScrollWheel(delta));
        
        // For compatibility with TouchControls
        this.keys = this.input.keys;
        this.raycaster = this.input.raycaster;

        // FPS Counter (visibility controlled by settings)
        this.fpsCounter = new FPSCounter();
        this.fpsCounter.element.style.display = this.showFpsSetting ? 'block' : 'none';

        // Performance Monitor (visibility controlled by settings, toggle with P key)
        this.performanceMonitor = new PerformanceMonitor();
        this.showPerformanceMonitor = this.showPerformanceSetting;
        this.performanceMonitor.element.style.display = this.showPerformanceMonitor ? 'block' : 'none';

        // Debug flags
        this.debugNormals = false;
        this.normalMappingEnabled = true;

        // Toggle performance monitor with P key
        window.addEventListener('keydown', (e) => {
            if (e.key === 'p' || e.key === 'P') {
                this.showPerformanceMonitor = !this.showPerformanceMonitor;
                this.performanceMonitor.element.style.display =
                    this.showPerformanceMonitor ? 'block' : 'none';
                // Update setting
                settingsManager.set('showPerformance', this.showPerformanceMonitor);
            }
            // Toggle normal map debug with N key
            if (e.key === 'n' || e.key === 'N') {
                this.debugNormals = !this.debugNormals;
                this.world?.chunkedTerrain?.setDebugNormals(this.debugNormals);
                console.log('🔍 Normal map debug:', this.debugNormals ? 'ON' : 'OFF');
            }
            // Toggle normal mapping with M key
            if (e.key === 'm' || e.key === 'M') {
                this.normalMappingEnabled = !this.normalMappingEnabled;
                this.world?.chunkedTerrain?.setNormalMappingEnabled(this.normalMappingEnabled);
                console.log('🗺️ Normal mapping:', this.normalMappingEnabled ? 'ON' : 'OFF');
            }
            // Toggle landmark debug with F3 key
            if (e.key === 'F3') {
                e.preventDefault();  // Prevent browser's default F3 behavior (search)
                this.toggleLandmarkDebug();
            }
            // Prevent default Tab behavior (focus switching)
            if (e.key === 'Tab') {
                e.preventDefault();
            }
        });

        // Landmark debug renderer (lazy-loaded on first F3 press)
        this.landmarkDebug = null;

        // Touch controls
        this.touchControls = new TouchControls(this);

        // Camera controller (initialized after hero creation)
        this.cameraController = null;

        // Loading overlay for chunk loading (blocking, for initial load)
        this.loadingOverlay = new LoadingOverlay();
        
        // Terrain streaming indicator (non-blocking, corner display)
        this.terrainIndicator = new TerrainLoadingIndicator();
        
        this.isPaused = false;        

        // Fixed timestep simulation with accumulator
        this.lastFrameTime = performance.now();
        this.fixedTimestep = 1 / 60; // Always simulate at 60 Hz (0.0167 seconds)
        this.accumulator = 0;
        this.maxAccumulator = 0.2; // Cap at 200ms (prevents spiral of death at <5 FPS)

        // Load terrain atlas (legacy, for mobile/low-power shaders)
        const textureLoader = new THREE.TextureLoader();
        this.terrainTexture = textureLoader.load('./terrain-atlas.png');
        this.terrainTexture.magFilter = THREE.NearestFilter;
        this.terrainTexture.minFilter = THREE.NearestFilter;
        this.terrainTexture.generateMipmaps = false;

        // Load texture arrays for desktop shader
        this.diffuseArray = null;
        this.normalArray = null;
        this.textureArraysReady = false;

        this._loadTextureArrays().then(async () => {
            await this.init();
            this.animate();
        });

        // Window resize handler
        window.addEventListener('resize', () => {
            this.camera.aspect = window.innerWidth / window.innerHeight;
            this.camera.updateProjectionMatrix();
            this.renderer.setSize(window.innerWidth, window.innerHeight);
            if (this.mapOverlay?.isOpen) {
                this.mapOverlay.resizeCanvas();
                this.mapOverlay.render();
            }
        });
    }

    async init() {
        this.scene.background = new THREE.Color(0x87ceeb);

        // Fog distance based on draw distance setting
        const fogDistances = {
            far: { near: 100, far: 300 },
            medium: { near: 50, far: 150 },
            near: { near: 30, far: 100 }
        };
        const fog = fogDistances[this.drawDistance] || fogDistances.medium;
        this.scene.fog = new THREE.Fog(0x87ceeb, fog.near, fog.far);

        // Show loading overlay
        this.loadingOverlay.show();

        // Get initial player position (from saved data or default)
        const savedPos = this.worldData?.heroPosition;
        const initialPosition = savedPos 
            ? { x: savedPos.x, y: savedPos.y, z: savedPos.z }
            : { x: 0, y: 10, z: 0 };

        // Create world manager with graphics settings
        this.world = new WorldManager(
            this.scene,
            this.terrainTexture,
            this.seed,
            this.worldId,
            {
                textureBlending: this.textureBlending,
                drawDistance: this.drawDistance,
                // Pass texture arrays for desktop shader
                diffuseArray: this.diffuseArray,
                normalArray: this.normalArray,
                useTextureArrays: this.textureArraysReady,
                // Continental mode config
                continent: this.continentConfig
            }
        );

        // Initialize world asynchronously with progress callback
        // waitForSafeTerrain passes (loaded, total) where total = max(pending+loaded, minSafeChunks)
        await this.world.init(initialPosition, (loaded, total) => {
            this.loadingOverlay.setProgress(loaded, total);
        });

        // Hide loading overlay
        this.loadingOverlay.hide();

        // Map overlay (Tab key to toggle)
        this.mapOverlay = new MapOverlay(this.seed, this.continentConfig);

        // Initialize adaptive fog system
        this.atmosphere.initFogAdaptation(
            this.scene.fog.near,
            this.scene.fog.far,
            this.world.chunkLoader
        );

        // Set up loading state callback for runtime loading
        this.world.setLoadingCallback((isLoading) => {
            this.isPaused = isLoading;
            if (isLoading) {
                this.loadingOverlay.show();
                this.terrainIndicator.forceHide();  // Hide subtle indicator when blocking
                
                // Count how many of the buffer chunks are loaded
                // We need the full buffer to unpause, so show progress toward that
                const bufferChunksLoaded = this.countBufferChunksLoaded();
                const bufferChunksTotal = this.getBufferChunksTotal();
                this.loadingOverlay.setProgress(bufferChunksLoaded, bufferChunksTotal);
            } else {
                this.loadingOverlay.hide();
            }
        });

        // Initialize spawn point manager and connect to worker
        this.spawnPointManager = new SpawnPointManager();
        this.world.chunkLoader.workerManager.setSpawnPointManager(this.spawnPointManager);

        // Initialize spawners
        // Pass WorldManager (this.world) instead of TerrainGenerator (this.world.terrain)
        // so they use block cache heights for correct placement
        this.itemSpawner = new ItemSpawner(this.scene, this.world, this.camera);
        this.mobSpawner = new MobSpawner(this.scene, this.world, this.spawnPointManager);

        // Determine spawn position
        let spawnPos;
        let spawnRotation = 0;

        if (this.worldData?.heroPosition) {
            // Restore saved position
            const saved = this.worldData.heroPosition;
            spawnPos = new THREE.Vector3(saved.x, saved.y, saved.z);
            spawnRotation = this.worldData.heroRotation || 0;
            console.log('Restoring hero position:', spawnPos);
        } else {
            // Check for continental start position from worker
            const workerStart = this.world.chunkLoader.workerManager?.startPosition;
            if (workerStart) {
                // Use continental spawn position (on the coast)
                const height = this.world.getHeight(workerStart.x, workerStart.z);
                const safeHeight = Math.max(height + 2, WATER_LEVEL + 2);
                spawnPos = new THREE.Vector3(workerStart.x, safeHeight, workerStart.z);
                // Face inland (opposite of start angle)
                spawnRotation = workerStart.angle + Math.PI;
                console.log('Continental spawn position:', spawnPos, 'facing inland');
            } else {
                // Fallback to default spawn search
                spawnPos = this.findSpawnPoint();
                console.log('New spawn position:', spawnPos);
            }
        }
        
        // Create hero
        this.hero = new Hero(this.scene, spawnPos.clone());
        this.hero.rotation = spawnRotation;
        
        this.entities.push(this.hero);
        this.playerEntities.push(this.hero);

        // Position camera
        this.camera.position.set(spawnPos.x, spawnPos.y + 20, spawnPos.z + 30);
        this.camera.lookAt(spawnPos);

        // Initialize camera controller with terrain provider for collision
        this.cameraController = new CameraController(this.camera, this.hero, this.world);

        // Initialize combat manager
        this.combatManager = new CombatManager(
            this.scene,
            this.hero,
            this.mobSpawner,
            this.world
        );

        // Wire combat callbacks
        this.combatManager.onHeroDamage = (amount, source) => {
            const color = source === 'explosion' ? '#FF6600' : '#FF0000';
            const opacity = source === 'explosion' ? 0.5 : 0.3;
            flashScreen(color, opacity);
        };

        this.combatManager.onFloatingNumber = (position, value, type, label) => {
            if (this.itemSpawner) {
                this.itemSpawner.showFloatingNumber(position, value, type, label);
            }
        };

        this.combatManager.onLootCollected = (type, amount, position) => {
            if (this.resources.hasOwnProperty(type)) {
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
                        position,
                        amount,
                        'resource',
                        names[type]
                    );
                }
            }
        };

        this.combatManager.onCraterRequested = (position, radius) => {
            this.createExplosionCrater(position, radius);
            // Trigger nearby TNT blocks when explosions happen
            if (this.tntManager) {
                this.tntManager.triggerNearExplosion(position, radius);
            }
        };

        // Initialize TNT manager with explosion callback
        this.tntManager = new TNTManager(this.scene, (position, radius, damage) => {
            // Create crater
            this.createExplosionCrater(position, radius);

            // Create visual explosion (reuse Explosion class)
            import('./mobs.js').then(({ Explosion }) => {
                const explosion = new Explosion(this.scene, position, radius);
                // Add to combat manager's explosions array for update
                if (this.combatManager) {
                    this.combatManager.explosions.push(explosion);
                }
            });

            // Apply damage to hero
            const distToPlayer = position.distanceTo(this.hero.position);
            if (distToPlayer < radius) {
                const damageFactor = 1 - (distToPlayer / radius);
                const actualDamage = Math.floor(damage * damageFactor);
                if (actualDamage > 0) {
                    this.hero.takeDamage(actualDamage);
                    flashScreen('#FF6600', 0.5);
                    if (this.itemSpawner) {
                        this.itemSpawner.showFloatingNumber(
                            this.hero.position.clone(),
                            actualDamage,
                            'damage'
                        );
                    }
                }
            }

            // Apply damage to mobs
            if (this.mobSpawner) {
                this.mobSpawner.mobs.forEach(mob => {
                    if (mob.dead) return;
                    const distToMob = position.distanceTo(mob.position);
                    if (distToMob < radius) {
                        const damageFactor = 1 - (distToMob / radius);
                        const actualDamage = Math.floor(damage * damageFactor);
                        if (actualDamage > 0) {
                            mob.takeDamage(actualDamage);
                            if (this.itemSpawner) {
                                this.itemSpawner.showFloatingNumber(
                                    mob.position.clone(),
                                    actualDamage,
                                    'damage'
                                );
                            }
                        }
                    }
                });
            }

            // Trigger chain reactions - nearby TNT
            this.tntManager.triggerNearExplosion(position, radius);
        });
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
        // Route based on active weapon
        if (this.hero.activeWeapon === 'sword') {
            this.handleMeleeAttack();
        } else {
            this.handleRangedAttack();
        }
    }

    handleRangedAttack() {
        const intersects = this.input.raycast(this.scene, true);

        if (intersects.length > 0) {
            const point = intersects[0].point;

            const arrowData = this.hero.shootArrow(point);
            if (arrowData && this.combatManager) {
                this.combatManager.spawnPlayerArrow(
                    arrowData.start,
                    arrowData.target,
                    arrowData.damage
                );
            }
        }
    }

    handleMeleeAttack() {
        // Get all hostile mobs for melee targeting
        const hostileMobs = this.mobSpawner ? this.mobSpawner.getHostileMobs() : [];

        // Perform melee attack and get hit mobs
        const hitMobs = this.hero.meleeAttack(hostileMobs);

        // Show floating damage numbers for each hit
        if (this.itemSpawner) {
            hitMobs.forEach(mob => {
                this.itemSpawner.showFloatingNumber(
                    mob.position.clone(),
                    this.hero.meleeDamage,
                    'damage'
                );
            });
        }

        // Check if melee attack hit any TNT blocks
        if (this.tntManager) {
            // Calculate attack position in front of player
            const attackDir = new THREE.Vector3(
                Math.sin(this.hero.rotation),
                0,
                Math.cos(this.hero.rotation)
            );
            const attackPos = this.hero.position.clone()
                .add(attackDir.multiplyScalar(1.5));
            attackPos.y += 0.5;

            this.tntManager.checkAttackHit(attackPos, 2.0);
        }
    }
    
    /**
     * Left-drag: Camera orbit in follow mode only
     */
    handleLeftDrag(deltaX, deltaY) {
        if (this.cameraController && this.cameraController.mode === 'follow') {
            this.cameraController.handleLook(deltaX, deltaY);
        }
    }

    /**
     * Called when left-drag starts (for orbit tracking in follow mode)
     */
    handleLeftDragStart() {
        if (this.cameraController && this.cameraController.mode === 'follow') {
            this.cameraController.startOrbit();
        }
    }

    /**
     * Called when left-drag ends
     */
    handleLeftDragEnd() {
        if (this.cameraController && this.cameraController.mode === 'follow') {
            this.cameraController.stopOrbit();
        }
    }

    /**
     * Right-drag: Change hero orientation (and camera pitch in both modes)
     */
    handleRightDrag(deltaX, deltaY) {
        if (this.cameraController) {
            if (this.cameraController.mode === 'first-person') {
                // First-person: control camera yaw + pitch
                this.cameraController.handleLook(deltaX, deltaY);
            } else {
                // Follow mode: rotate hero (yaw) + camera pitch
                const sensitivity = 0.003;
                this.hero.rotation -= deltaX * sensitivity;
                // Also adjust camera pitch (polar angle) with vertical movement
                this.cameraController.handleLook(0, deltaY);
            }
        }
    }

    /**
     * Called when right-drag starts
     */
    handleRightDragStart() {
        // No special action needed
    }

    /**
     * Called when right-drag ends
     */
    handleRightDragEnd() {
        // No special action needed
    }

    /**
     * Handle scroll wheel for camera distance
     */
    handleScrollWheel(delta) {
        if (this.cameraController) {
            this.cameraController.handleScroll(delta);
        }
    }

    dropTorch() {
        // Remove oldest torch if at limit
        if (this.torches.length >= 8) {
            const oldest = this.torches.shift();
            oldest.destroy();
        }

        // Spawn torch at hero position
        const torch = new DroppedTorch(this.scene, this.hero.position.clone());
        this.torches.push(torch);
    }

    /**
     * Place TNT block in front of the player
     */
    placeTNT() {
        // Check if player has TNT
        if (this.resources.tnt <= 0) {
            return false;
        }

        // Calculate placement position (2-3 blocks in front of player)
        const direction = new THREE.Vector3(
            Math.sin(this.hero.rotation),
            0,
            Math.cos(this.hero.rotation)
        );

        const placeDistance = 2.5;
        const placePos = this.hero.position.clone()
            .add(direction.multiplyScalar(placeDistance));

        // Get ground height at placement position
        const groundY = this.world.getInterpolatedHeight(placePos.x, placePos.z);

        // Don't place at bedrock (y <= 0)
        if (groundY <= 0) {
            return false;
        }

        // Don't place underwater
        if (groundY < WATER_LEVEL) {
            return false;
        }

        // Set Y to ground level
        placePos.y = groundY;

        // Place TNT
        if (this.tntManager) {
            const tnt = this.tntManager.placeTNT(placePos);
            if (tnt) {
                this.resources.tnt--;

                // Show feedback
                if (this.itemSpawner) {
                    this.itemSpawner.showFloatingNumber(
                        placePos.clone(),
                        1,
                        'resource',
                        'TNT Placed'
                    );
                }
                return true;
            }
        }

        return false;
    }

    async toggleLandmarkDebug() {
        if (!this.landmarkDebug) {
            // Lazy load the debug renderer
            const { LandmarkDebugRenderer } = await import('./debug/landmark-debug.js');
            this.landmarkDebug = new LandmarkDebugRenderer(this.scene);
        }
        const enabled = this.landmarkDebug.toggle();
        console.log('Landmark debug:', enabled ? 'ON' : 'OFF');
    }

    updateLandmarkDebug() {
        if (!this.landmarkDebug || !this.landmarkDebug.enabled) return;

        // Lazy load terrain probe
        if (!this._terrainProbe) {
            import('./world/terrain-probe.js').then(({ createMainThreadTerrainProbe }) => {
                const blockCache = this.world.chunkLoader.workerManager.blockCache;
                this._terrainProbe = createMainThreadTerrainProbe(blockCache);
            });
            return;
        }

        const probe = this._terrainProbe;
        const px = this.hero.position.x;
        const pz = this.hero.position.z;

        this.landmarkDebug.beginFrame();

        // Draw terrain normal at player position
        this.landmarkDebug.drawTerrainNormal(probe, px, pz);

        // Draw gradient (slope direction)
        this.landmarkDebug.drawGradient(probe, px, pz);

        // Draw coordinate frame at terrain surface
        const height = probe.sampleHeight(px, pz);
        this.landmarkDebug.drawCoordinateFrame(px, height, pz, 2);

        // Draw nearby landmarks
        const landmarkRegistry = this.world.chunkLoader?.workerManager?.landmarkRegistry;
        const landmarks = this.landmarkDebug.drawLandmarks(landmarkRegistry, px, pz, 5);

        // Check if player is inside a landmark
        const insideLandmark = landmarkRegistry ? landmarkRegistry.isInsideLandmark(px, pz) : false;

        // Draw TNT blocks
        const tntCount = this.landmarkDebug.drawTNTBlocks(this.tntManager);

        // Update info overlay
        const gradient = probe.sampleGradient(px, pz);
        const normal = probe.sampleNormal(px, pz);
        const biome = this.world.getBiome(Math.floor(px), Math.floor(pz));

        this.landmarkDebug.updateOverlay({
            position: { x: px, z: pz },
            playerPos: { x: px, z: pz },
            height: height,
            gradient: gradient,
            normal: normal,
            biome: biome,
            landmarks: landmarks || [],
            insideLandmark: insideLandmark,
            tntCount: tntCount,
            tntInventory: this.resources.tnt
        });
    }

    handleInput(deltaTime) {
        if (this.hero.canMove()) {
            // WASD: Camera-relative movement (works in both follow and first-person modes)
            const forward = this.input.isKeyPressed('w');
            const backward = this.input.isKeyPressed('s');
            const left = this.input.isKeyPressed('a');
            const right = this.input.isKeyPressed('d');

            if (forward || backward || left || right) {
                const cameraYaw = this.hero.rotation;

                if (forward || left || right) {
                    let moveX = 0, moveZ = 0;

                    if (forward) {
                        moveX += Math.sin(cameraYaw);
                        moveZ += Math.cos(cameraYaw);
                    }
                    if (left) {
                        moveX += Math.sin(cameraYaw + Math.PI / 2);
                        moveZ += Math.cos(cameraYaw + Math.PI / 2);
                    }
                    if (right) {
                        moveX += Math.sin(cameraYaw - Math.PI / 2);
                        moveZ += Math.cos(cameraYaw - Math.PI / 2);
                    }

                    const len = Math.sqrt(moveX * moveX + moveZ * moveZ);
                    if (len > 0) {
                        moveX /= len;
                        moveZ /= len;
                        const speed = forward ? 8 : 7;
                        this.hero.moveInWorldDirection(moveX, moveZ, speed * deltaTime);
                    }
                } else if (backward) {
                    this.hero.moveBackwardCameraRelative(cameraYaw, 6 * deltaTime);
                }
            }

            if (this.input.isKeyPressed(' ')) {
                this.hero.jump(12);
            }
        }
        // Toggle map overlay with Tab key
        if (this.input.isKeyJustPressed('tab')) {
            this.mapOverlay.toggle(this.hero.position.x, this.hero.position.z);
            return;
        }
        // Mount/dismount toggle with M key
        if (this.input.isKeyJustPressed('m')) {
            this.hero.toggleMount();
        }
        // Weapon switch with Q key
        if (this.input.isKeyJustPressed('q')) {
            this.hero.switchWeapon();
        }
        // Debug: Press 'b' to dump block column at player position
        if (this.input.isKeyPressed('b') && !this._debugCooldown) {
            this._debugCooldown = true;
            const px = Math.floor(this.hero.position.x);
            const pz = Math.floor(this.hero.position.z);
            console.log(`Player at Y=${this.hero.position.y.toFixed(2)}`);
            this.world.debugBlockColumn(px, pz);
            setTimeout(() => this._debugCooldown = false, 500);
        }
        // Drop torch with G key (single press)
        if (this.input.isKeyJustPressed('g')) {
            this.dropTorch();
        }
        // Place TNT with T key (single press)
        if (this.input.isKeyJustPressed('t')) {
            this.placeTNT();
        }
    }

    update(deltaTime) {
        // Update world first - it returns true if loading
        const needsLoading = this.world.update(this.hero.position);
        
        // Skip rest of update if loading
        if (needsLoading) return;

        // If map overlay is open, route input to it and skip game input
        if (this.mapOverlay?.isOpen) {
            this.handleInput(deltaTime); // Still process Tab key to close map
            this.mapOverlay.handleInput(this.input, deltaTime);
            this.mapOverlay.render();
            return;
        }

        this.touchControls.update(deltaTime);
        this.handleInput(deltaTime);

        // Update entities
        this.entities.forEach(entity => {
            // entity.update(deltaTime, this.world.terrain, this.world.objectGenerator);
            entity.update(deltaTime, this.world, this.world.objectGenerator);
        });

        this.entities = this.entities.filter(e => e.health > 0);
        this.playerEntities = this.playerEntities.filter(e => e.health > 0);

        // Update spawn point manager cooldowns
        if (this.spawnPointManager) {
            this.spawnPointManager.update(deltaTime);
        }

        // Update mob spawner
        if (this.mobSpawner) {
            this.mobSpawner.update(deltaTime, this.hero.position, WATER_LEVEL, this.itemSpawner);
        }

        // Check if any arrows hit TNT blocks BEFORE combat updates
        // (TNT sits on ground, so we need to check before arrows get stuck in terrain)
        if (this.combatManager && this.tntManager) {
            for (const arrow of this.combatManager.arrows) {
                if (!arrow.hit && !arrow.stuck) {
                    const hit = this.tntManager.checkAttackHit(arrow.position, 1.5);
                    if (hit) {
                        arrow.hit = true;
                        arrow.destroy();
                    }
                }
            }
            // Remove arrows that hit TNT
            this.combatManager.arrows = this.combatManager.arrows.filter(a => !a.hit);
        }

        // Update combat system (arrows, explosions, damage, loot)
        if (this.combatManager) {
            this.combatManager.update(deltaTime);
        }

        // Update TNT blocks (fuse timers, detonations)
        if (this.tntManager) {
            this.tntManager.update(deltaTime);
        }

        // Update item spawner
        if (this.itemSpawner) {
            this.itemSpawner.update(deltaTime, this.hero.position);

            const collected = this.itemSpawner.checkCollection(this.hero);
            collected.forEach(item => {
                this.collectItem(item);
            });
        }

        // Update dropped torches
        this.torches.forEach(torch => torch.update(deltaTime));

        // Update camera
        this.cameraController.update(deltaTime);
        
        // Update atmosphere (day/night, lighting, torch)
        const { timeOfDay } = this.atmosphere.update(
            deltaTime,
            this.hero.position,
            this.hero.rotation
        );
        this.gameTime = timeOfDay;  // For saving
        
        // OrbitControls is disabled - CameraController manages all camera state
        this.updateUI();

        // Update landmark debug visualization if enabled
        this.updateLandmarkDebug();

        // Clear single-press key state at end of frame
        this.input.clearJustPressed();
    }

    updateUI() {
        const stats = document.getElementById('stats');
        const biome = this.world.getBiome(
            Math.floor(this.hero.position.x),
            Math.floor(this.hero.position.z)
        );
        const mobCount = this.mobSpawner ? this.mobSpawner.mobs.length : 0;
        
        const tntCount = this.tntManager ? this.tntManager.getCount() : 0;
        stats.innerHTML = `
            Health: ${Math.max(0, Math.floor(this.hero.health))}/${this.hero.maxHealth}<br>
            Biome: ${biome}<br>
            Mobs: ${mobCount}<br>
            Gold: ${this.resources.gold}<br>
            Wood: ${this.resources.wood}<br>
            Iron: ${this.resources.iron}<br>
            Coal: ${this.resources.coal}<br>
            Diamonds: ${this.resources.diamond}<br>
            TNT: ${this.resources.tnt} (${tntCount} placed)<br>
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
            
            flashScreen('#00FF00', 0.3);
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
                    coal: '#FFFFFF',
                    tnt: '#FF0000'
                };
                flashScreen(flashColors[item.type] || '#FFD700', 0.2);

                pulseResourceUI(item.type);
            }
        }
    }

    createExplosionCrater(position, radius) {
        this.world.createExplosionCrater(position, radius);
    }

    /**
     * Count how many of the required buffer chunks around the player are loaded
     * Uses resumeBufferDistance (larger radius) since that's the unpause target
     * @returns {number} Number of buffer chunks that have meshes
     */
    countBufferChunksLoaded() {
        if (!this.world || !this.hero) return 0;
        
        const CHUNK_SIZE = 16;
        const playerChunkX = Math.floor(this.hero.position.x / CHUNK_SIZE);
        const playerChunkZ = Math.floor(this.hero.position.z / CHUNK_SIZE);
        const bufferDistance = this.world.chunkLoader.resumeBufferDistance;
        
        let count = 0;
        for (let dx = -bufferDistance; dx <= bufferDistance; dx++) {
            for (let dz = -bufferDistance; dz <= bufferDistance; dz++) {
                const key = `${playerChunkX + dx},${playerChunkZ + dz}`;
                if (this.world.chunkLoader.chunksWithMeshes.has(key)) {
                    count++;
                }
            }
        }
        return count;
    }

    /**
     * Get the total buffer chunks needed to unpause
     * @returns {number} Total chunks in buffer radius
     */
    getBufferChunksTotal() {
        if (!this.world) return 81; // Default 9x9
        const bufferDistance = this.world.chunkLoader.resumeBufferDistance;
        return (bufferDistance * 2 + 1) ** 2;
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
            
            // Update terrain streaming indicator (non-blocking, if enabled in settings)
            if (this.world && this.terrainIndicator && this.showLoadingIndicatorSetting) {
                const pending = this.world.chunkLoader.getPendingCount();
                const loaded = this.world.chunkLoader.chunksWithMeshes.size;
                const total = this.world.chunkLoader.getRequiredChunkCount();
                this.terrainIndicator.update(pending, loaded, total);
            }
        } else {
            // Still update world to process chunk loading
            if (this.world && this.hero) {
                this.world.update(this.hero.position);
                
                // Update loading progress toward buffer target
                const bufferChunksLoaded = this.countBufferChunksLoaded();
                const bufferChunksTotal = this.getBufferChunksTotal();
                this.loadingOverlay.setProgress(bufferChunksLoaded, bufferChunksTotal);
            }
        }
        
        this.fpsCounter.update();
        
        // Only update performance monitor if visible (saves CPU on mobile)
        if (this.showPerformanceMonitor) {
            const gameStats = {
                deltaTime: this.fixedTimestep,
                chunks: this.world ? this.world.chunkLoader.loadedChunks.size : 0,
                pendingChunks: this.world ? this.world.chunkLoader.getPendingCount() : 0,
                workerStats: this.world ? this.world.getWorkerStats() : null,
                mobs: this.mobSpawner ? this.mobSpawner.mobs.length : 0,
                entities: this.entities.length,
                arrows: this.combatManager ? this.combatManager.getArrowCount() : 0
            };
            this.performanceMonitor.update(this.renderer, gameStats);
        }
        
        this.renderer.render(this.scene, this.camera);
    }

    /**
     * Load texture arrays for desktop shader (diffuse + normal maps)
     * @private
     */
    async _loadTextureArrays() {
        try {
            const { TextureArrayLoader } = await import('./loaders/texturearrayloader.js');
            const { DIFFUSE_PATHS, NORMAL_PATHS } = await import('./world/terrain/textureregistry.js');

            console.log('Loading texture arrays for desktop shader...');

            const arrayLoader = new TextureArrayLoader();

            // Load both arrays in parallel
            [this.diffuseArray, this.normalArray] = await Promise.all([
                arrayLoader.loadDiffuseArray(DIFFUSE_PATHS, (progress) => {
                    console.log(`Diffuse textures: ${progress.loaded}/${progress.total}`);
                }),
                arrayLoader.loadNormalArray(NORMAL_PATHS, (progress) => {
                    console.log(`Normal maps: ${progress.loaded}/${progress.total}`);
                })
            ]);

            this.textureArraysReady = true;
            console.log('✅ Texture arrays loaded successfully');
        } catch (error) {
            console.error('❌ Failed to load texture arrays:', error);
            console.error('⚠️ Falling back to atlas shader');
            this.textureArraysReady = false;
        }
    }
}