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
        this.controls.enablePan = false;  // Disable right-click panning to use for hero rotation

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
        
        // Track right-click drag for hero rotation
        this.isRightDragging = false;

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
        
        // Day/night cycle system (automated)
        // Day: 0-5 minutes, Night: 5-10 minutes
        this.dayLength = 300; // 5 minutes in seconds
        this.nightLength = 300; // 5 minutes in seconds
        this.cycleLength = this.dayLength + this.nightLength; // 10 minutes total
        this.timeOfDay = 0; // 0-600 seconds (0 = midnight)
        
        // Sun and moon
        this.sun = this.createSun();
        this.moon = this.createMoon();
        
        // Exclude sun and moon from raycasting
        this.sun.traverse(obj => obj.layers.set(1)); // Layer 1 = celestial objects
        this.moon.traverse(obj => obj.layers.set(1));
        
        this.scene.add(this.sun);
        this.scene.add(this.moon);
        
        // Torch toggle
        this.torchEnabled = true;
        this.createTorchToggle();

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
    
    createSun() {
        const sunGroup = new THREE.Group();
        
        // Sun body - square sprite facing camera
        const sunSize = 40;
        const canvas = document.createElement('canvas');
        canvas.width = 128;
        canvas.height = 128;
        const ctx = canvas.getContext('2d');
        
        // Draw square sun
        ctx.fillStyle = '#FFFF00';
        ctx.fillRect(16, 16, 96, 96);
        
        // Add some detail - corona/rays
        ctx.fillStyle = '#FFDD00';
        ctx.fillRect(32, 32, 64, 64);
        
        const texture = new THREE.CanvasTexture(canvas);
        const material = new THREE.SpriteMaterial({ 
            map: texture,
            transparent: true
        });
        
        const sprite = new THREE.Sprite(material);
        sprite.scale.set(sunSize, sunSize, 1);
        sunGroup.add(sprite);
        
        // Store references
        sunGroup.userData.sprite = sprite;
        sunGroup.userData.canvas = canvas;
        sunGroup.userData.ctx = ctx;
        
        return sunGroup;
    }
    
    createMoon() {
        const moonGroup = new THREE.Group();
        
        // Moon body - square with shadow for crescent effect
        const moonSize = 35;
        const canvas = document.createElement('canvas');
        canvas.width = 128;
        canvas.height = 128;
        const ctx = canvas.getContext('2d');
        
        const texture = new THREE.CanvasTexture(canvas);
        const material = new THREE.SpriteMaterial({ 
            map: texture,
            transparent: true
        });
        
        const sprite = new THREE.Sprite(material);
        sprite.scale.set(moonSize, moonSize, 1);
        moonGroup.add(sprite);
        
        // Store references for updating moon phase
        moonGroup.userData.sprite = sprite;
        moonGroup.userData.canvas = canvas;
        moonGroup.userData.ctx = ctx;
        moonGroup.userData.texture = texture;
        
        return moonGroup;
    }
    
    createTorchToggle() {
        const btn = document.createElement('button');
        btn.id = 'torch-toggle';
        btn.style.cssText = `
            position: absolute;
            top: 60px;
            right: 10px;
            padding: 8px 12px;
            background: rgba(180, 100, 0, 0.8);
            color: white;
            border: 2px solid rgba(255, 180, 100, 0.8);
            border-radius: 4px;
            cursor: pointer;
            font-family: monospace;
            font-size: 12px;
            transition: all 0.2s;
            z-index: 1000;
        `;
        btn.textContent = '🔦 Torch ON [T]';
        
        btn.addEventListener('click', () => this.toggleTorch());
        document.body.appendChild(btn);
        this.torchButton = btn;
        
        // Keyboard shortcut
        window.addEventListener('keydown', (e) => {
            if (e.key.toLowerCase() === 't') {
                this.toggleTorch();
            }
        });
    }
    
    toggleTorch() {
        this.torchEnabled = !this.torchEnabled;
        this.updateTorchButton();
    }
    
    updateTorchButton() {
        if (!this.torchButton) return;
        
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
    
    updateSunColor(sunAngle) {
        // sunAngle: 0 = sunrise, 90 = noon, 180 = sunset
        const canvas = this.sun.userData.canvas;
        const ctx = this.sun.userData.ctx;
        
        ctx.clearRect(0, 0, 128, 128);
        
        let color1, color2;
        
        if (sunAngle < 30 || sunAngle > 150) {
            // Sunrise/sunset - orange/red
            const blend = sunAngle < 30 ? sunAngle / 30 : (180 - sunAngle) / 30;
            color1 = `rgb(255, ${Math.floor(100 + blend * 155)}, 0)`;
            color2 = `rgb(255, ${Math.floor(50 + blend * 150)}, 0)`;
        } else {
            // Daytime - yellow
            color1 = '#FFFF00';
            color2 = '#FFDD00';
        }
        
        // Draw square sun
        ctx.fillStyle = color1;
        ctx.fillRect(16, 16, 96, 96);
        
        // Inner square
        ctx.fillStyle = color2;
        ctx.fillRect(32, 32, 64, 64);
        
        this.sun.userData.sprite.material.map.needsUpdate = true;
    }
    
    updateMoonPhase(nightProgress) {
        // nightProgress: 0-1 through the night
        const canvas = this.moon.userData.canvas;
        const ctx = this.moon.userData.ctx;
        
        ctx.clearRect(0, 0, 128, 128);
        
        // Full moon at midnight (0.5), crescent at dusk/dawn (0, 1)
        const phaseOffset = Math.abs(nightProgress - 0.5) * 2; // 0 at midnight, 1 at edges
        
        // Draw full moon square
        ctx.fillStyle = '#EEEEEE';
        ctx.fillRect(16, 16, 96, 96);
        
        // Add darker inner detail
        ctx.fillStyle = '#CCCCCC';
        ctx.fillRect(32, 32, 64, 64);
        
        // Add shadow for crescent effect
        // Shadow grows from left side
        const shadowWidth = 96 * phaseOffset * 0.7; // Max 70% coverage
        ctx.fillStyle = 'rgba(10, 10, 30, 0.9)'; // Dark blue-black
        ctx.fillRect(16, 16, shadowWidth, 96);
        
        this.moon.userData.texture.needsUpdate = true;
    }
    
    updateDayNightCycle(deltaTime) {
        // Advance time
        this.timeOfDay += deltaTime;
        if (this.timeOfDay >= this.cycleLength) {
            this.timeOfDay -= this.cycleLength;
        }
        
        // Calculate cycle progress (0-1)
        const cycleProgress = this.timeOfDay / this.cycleLength;
        
        // Determine phase
        let phase, phaseProgress;
        if (this.timeOfDay < this.dayLength) {
            // Daytime: 0-600 seconds
            phase = 'day';
            phaseProgress = this.timeOfDay / this.dayLength;
        } else {
            // Nighttime: 600-1200 seconds
            phase = 'night';
            phaseProgress = (this.timeOfDay - this.dayLength) / this.nightLength;
        }
        
        // Update sun and moon positions
        // Sun: rises at 0, peaks at 0.25, sets at 0.5 (during day phase)
        // Moon: rises at 0.5, peaks at 0.75, sets at 1.0 (during night phase)
        
        const skyRadius = 400;
        const heroPos = this.hero.position;
        
        if (phase === 'day') {
            // Sun arc: 0 = east horizon, 0.5 = zenith, 1.0 = west horizon
            const sunAngle = phaseProgress * Math.PI; // 0 to PI radians
            const sunHeight = Math.sin(sunAngle); // 0 to 1 to 0
            const sunHorizontal = Math.cos(sunAngle); // 1 to -1
            
            this.sun.position.set(
                heroPos.x + sunHorizontal * skyRadius,
                heroPos.y + sunHeight * skyRadius,
                heroPos.z
            );
            this.sun.visible = true;
            
            // Update sun color based on angle
            this.updateSunColor(sunAngle * 180 / Math.PI);
            
            // Moon below horizon
            this.moon.visible = false;
        } else {
            // Night phase
            const moonAngle = phaseProgress * Math.PI;
            const moonHeight = Math.sin(moonAngle);
            const moonHorizontal = Math.cos(moonAngle);
            
            this.moon.position.set(
                heroPos.x + moonHorizontal * skyRadius,
                heroPos.y + moonHeight * skyRadius,
                heroPos.z
            );
            this.moon.visible = true;
            
            // Update moon phase
            this.updateMoonPhase(phaseProgress);
            
            // Sun below horizon
            this.sun.visible = false;
        }
        
        // Update lighting based on time
        this.updateLighting(phase, phaseProgress);
    }
    
    updateLighting(phase, phaseProgress) {
        // Smooth transitions at sunrise (day start) and sunset (day end)
        
        if (phase === 'day') {
            // During day: transition sunrise -> noon -> sunset
            let preset;
            
            if (phaseProgress < 0.1) {
                // Sunrise (first 10% of day)
                const t = phaseProgress / 0.1;
                preset = this.lerpLightingPresets('sunrise', 'day', t);
            } else if (phaseProgress > 0.9) {
                // Sunset (last 10% of day)
                const t = (phaseProgress - 0.9) / 0.1;
                preset = this.lerpLightingPresets('day', 'sunset', t);
            } else {
                // Full day
                preset = this.getLightingPreset('day');
            }
            
            this.applyLightingPreset(preset);
        } else {
            // During night: transition dusk -> night -> dawn
            let preset;
            
            if (phaseProgress < 0.1) {
                // Dusk (first 10% of night)
                const t = phaseProgress / 0.1;
                preset = this.lerpLightingPresets('sunset', 'night', t);
            } else if (phaseProgress > 0.9) {
                // Dawn (last 10% of night)
                const t = (phaseProgress - 0.9) / 0.1;
                preset = this.lerpLightingPresets('night', 'sunrise', t);
            } else {
                // Full night
                preset = this.getLightingPreset('night');
            }
            
            this.applyLightingPreset(preset);
        }
    }
    
    getLightingPreset(name) {
        const presets = {
            sunrise: {
                ambient: { color: 0xffaa66, intensity: 0.4 },
                directional: { color: 0xff8844, intensity: 0.5 },
                sky: 0xff7744,
                fog: 0xffaa88,
                torch: 2.0
            },
            day: {
                ambient: { color: 0xffffff, intensity: 0.6 },
                directional: { color: 0xffffff, intensity: 0.8 },
                sky: 0x87ceeb,
                fog: 0x87ceeb,
                torch: 0
            },
            sunset: {
                ambient: { color: 0xffa366, intensity: 0.4 },
                directional: { color: 0xff7733, intensity: 0.6 },
                sky: 0xff6b35,
                fog: 0xd4a574,
                torch: 1.0
            },
            night: {
                ambient: { color: 0x334466, intensity: 0.15 },
                directional: { color: 0x6688bb, intensity: 0.1 },
                sky: 0x0a0a1a,
                fog: 0x0a0a1a,
                torch: 6.0
            }
        };
        
        return presets[name];
    }
    
    lerpLightingPresets(preset1Name, preset2Name, t) {
        const p1 = this.getLightingPreset(preset1Name);
        const p2 = this.getLightingPreset(preset2Name);
        
        return {
            ambient: {
                color: this.lerpColor(p1.ambient.color, p2.ambient.color, t),
                intensity: p1.ambient.intensity + (p2.ambient.intensity - p1.ambient.intensity) * t
            },
            directional: {
                color: this.lerpColor(p1.directional.color, p2.directional.color, t),
                intensity: p1.directional.intensity + (p2.directional.intensity - p1.directional.intensity) * t
            },
            sky: this.lerpColor(p1.sky, p2.sky, t),
            fog: this.lerpColor(p1.fog, p2.fog, t),
            torch: p1.torch + (p2.torch - p1.torch) * t
        };
    }
    
    lerpColor(color1, color2, t) {
        const c1 = new THREE.Color(color1);
        const c2 = new THREE.Color(color2);
        return c1.lerp(c2, t).getHex();
    }
    
    applyLightingPreset(preset) {
        this.ambientLight.color.setHex(preset.ambient.color);
        this.ambientLight.intensity = preset.ambient.intensity;
        
        this.directionalLight.color.setHex(preset.directional.color);
        this.directionalLight.intensity = preset.directional.intensity;
        
        // Torch intensity based on preset and toggle state
        this.torchLight.intensity = this.torchEnabled ? preset.torch : 0;
        
        this.scene.background.setHex(preset.sky);
        this.scene.fog.color.setHex(preset.fog);
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
            if (e.button === 0) {  // Left click
                this.mouseDownPos.set(e.clientX, e.clientY);
                this.mouseDownTime = performance.now();
                this.isDragging = false;
            } else if (e.button === 2) {  // Right click
                this.isRightDragging = true;
                // Request pointer lock for infinite rotation
                this.renderer.domElement.requestPointerLock();
            }
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
            
            // Handle right-click drag for hero rotation using pointer lock
            if (this.isRightDragging && document.pointerLockElement) {
                const deltaX = e.movementX;  // Use movementX instead of position delta
                const rotationSpeed = 0.002;  // Reduced sensitivity (was 0.005)
                this.hero.rotation -= deltaX * rotationSpeed;
            }
        });

        // Only shoot on left-click (not drag)
        window.addEventListener('mouseup', (e) => {
            if (e.button === 0) {  // Left click
                // Only trigger click if not dragging
                if (!this.isDragging) {
                    this.handleClick();
                }
                this.mouseDownTime = 0;
                this.isDragging = false;
            } else if (e.button === 2) {  // Right click
                this.isRightDragging = false;
                // Exit pointer lock
                if (document.pointerLockElement) {
                    document.exitPointerLock();
                }
            }
        });
        
        // Prevent context menu on right-click
        window.addEventListener('contextmenu', (e) => {
            e.preventDefault();
        });

        window.addEventListener('resize', () => {
            this.camera.aspect = window.innerWidth / window.innerHeight;
            this.camera.updateProjectionMatrix();
            this.renderer.setSize(window.innerWidth, window.innerHeight);
        });
    }

    handleClick() {
        this.raycaster.setFromCamera(this.mouse, this.camera);
        
        // Filter out celestial objects (sun/moon on layer 1)
        const intersects = this.raycaster.intersectObjects(this.scene.children, true)
            .filter(hit => hit.object.layers.mask !== 2); // Exclude layer 1 (2^1 = 2)
        
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
            
            // Check for XP from killed mobs (only if player killed them)
            hostileMobs.forEach(mob => {
                if (mob.dead && mob.xpValue > 0 && mob.killedByPlayer && !mob.xpAwarded) {
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
                
                // Damage other mobs in explosion radius
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
        
        // Update day/night cycle
        this.updateDayNightCycle(deltaTime);
        
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