import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TerrainGenerator, BLOCK_TYPES, createBlockGeometry, WATER_LEVEL } from './terrain.js';
import { ObjectGenerator } from './objects.js';
import { Hero, Golem, EnemyUnit } from './entities.js';
import { FPSCounter } from './utils/fps-counter.js';
import { TouchControls } from './utils/touch-controls.js';
import { CameraController } from './camera.js';

export class Game {
    constructor() {
        this.scene = new THREE.Scene();
        this.camera = new THREE.PerspectiveCamera(
            60,
            window.innerWidth / window.innerHeight,
            0.1,
            1000
        );
        
        this.renderer = new THREE.WebGLRenderer({ antialias: true });
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        document.body.appendChild(this.renderer.domElement);

        this.controls = new OrbitControls(this.camera, this.renderer.domElement);
        this.controls.enableDamping = true;
        this.controls.dampingFactor = 0.05;
        this.controls.maxPolarAngle = Math.PI / 2.5;

        this.terrain = new TerrainGenerator(Math.random() * 10000);
        this.objectGenerator = null; // Created after terrain
        this.entities = [];
        this.playerEntities = [];
        this.enemyEntities = [];
        
        this.keys = {};
        this.mouse = new THREE.Vector2();
        this.raycaster = new THREE.Raycaster();
        this.groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

        // FPS Counter
        this.fpsCounter = new FPSCounter();

        // Touch controls (for phones and tablets)
        this.touchControls = new TouchControls(this);

        // Camera controller (initialized after hero creation)
        this.cameraController = null;

        // Load terrain texture
        const textureLoader = new THREE.TextureLoader();
        this.terrainTexture = textureLoader.load('./terrain3.png', () => {
            this.init();
            this.setupEventListeners();
            this.animate();
        });
        
        this.terrainTexture.magFilter = THREE.NearestFilter;
        this.terrainTexture.minFilter = THREE.NearestFilter;
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
        this.torchLight = new THREE.PointLight(0xff9944, 0, 60, 1.2);
        this.torchLight.castShadow = false; // Performance: skip torch shadows
        this.scene.add(this.torchLight);
        
        // Time of day system
        this.timeOfDay = 'day';
        this.createTimeControls();

        // Generate terrain
        this.generateTerrain(500, 500);

        // Generate objects (trees, rocks, grass, cacti)
        this.objectGenerator = new ObjectGenerator(this.terrain);
        this.objectGenerator.generate(this.scene, 500, 500, WATER_LEVEL);

        // Find a good spawn point (above water, not too high)
        const spawnPos = this.findSpawnPoint();
        
        // Create hero
        this.hero = new Hero(this.scene, spawnPos.clone());
        
        this.entities.push(this.hero);
        this.playerEntities.push(this.hero);

        // Create golems near hero
        for (let i = 0; i < 3; i++) {
            const golemPos = spawnPos.clone();
            golemPos.x += -3 + i * 3;
            golemPos.z -= 3;
            const golem = new Golem(this.scene, golemPos);
            this.hero.addGolem(golem);
            this.entities.push(golem);
            this.playerEntities.push(golem);
        }

        // Create enemies in a different area
        const enemySpawn = this.findSpawnPoint(20, 20);
        for (let i = 0; i < 4; i++) {
            const enemyPos = enemySpawn.clone();
            enemyPos.x += (Math.random() - 0.5) * 10;
            enemyPos.z += (Math.random() - 0.5) * 10;
            const enemy = new EnemyUnit(this.scene, enemyPos);
            this.entities.push(enemy);
            this.enemyEntities.push(enemy);
        }

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
        const torchIntensities = { day: 0, sunset: 0.5, night: 4.0 };
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

    // Check if a block is visible (has at least one exposed face)
    isBlockVisible(x, y, z) {
        // Check all 6 neighbors - if any is air/null, this block is visible
        
        // Above
        if (this.terrain.getBlockType(x, y + 1, z) === null) return true;
        
        // Below
        if (this.terrain.getBlockType(x, y - 1, z) === null) return true;
        
        // Four horizontal directions
        if (this.terrain.getBlockType(x + 1, y, z) === null) return true;
        if (this.terrain.getBlockType(x - 1, y, z) === null) return true;
        if (this.terrain.getBlockType(x, y, z + 1) === null) return true;
        if (this.terrain.getBlockType(x, y, z - 1) === null) return true;
        
        // Completely surrounded - not visible
        return false;
    }

    generateTerrain(width, depth) {
        const blockCounts = {};
        const blockPositions = {};
        
        Object.keys(BLOCK_TYPES).forEach(type => {
            blockCounts[type] = 0;
            blockPositions[type] = [];
        });
        
        console.log('Generating terrain with surface-only optimization...');
        const startTime = performance.now();
        
        // First pass: count and store positions (only visible blocks)
        let totalBlocks = 0;
        let visibleBlocks = 0;
        
        for (let x = -width/2; x < width/2; x++) {
            for (let z = -depth/2; z < depth/2; z++) {
                const terrainHeight = this.terrain.getHeight(x, z);
                const maxY = Math.max(terrainHeight, WATER_LEVEL);
                
                for (let y = 0; y <= maxY; y++) {
                    const blockType = this.terrain.getBlockType(x, y, z);
                    if (blockType) {
                        totalBlocks++;
                        if (this.isBlockVisible(x, y, z)) {
                            blockPositions[blockType].push({ x, y, z });
                            blockCounts[blockType]++;
                            visibleBlocks++;
                        }
                    }
                }
            }
        }
        
        const genTime = performance.now() - startTime;
        console.log(`Terrain generation: ${genTime.toFixed(1)}ms`);
        console.log(`Total blocks: ${totalBlocks}, Visible blocks: ${visibleBlocks} (${(visibleBlocks/totalBlocks*100).toFixed(1)}% reduction)`);
        
        // Create instanced meshes for each block type
        Object.keys(BLOCK_TYPES).forEach(blockType => {
            const count = blockCounts[blockType];
            if (count === 0) return;
            
            const geometry = createBlockGeometry(blockType);
            
            // Special material for water (transparent)
            let material;
            if (blockType === 'water') {
                material = new THREE.MeshLambertMaterial({
                    map: this.terrainTexture,
                    transparent: true,
                    opacity: 0.7,
                    side: THREE.DoubleSide
                });
            } else if (blockType === 'ice') {
                material = new THREE.MeshLambertMaterial({
                    map: this.terrainTexture,
                    transparent: true,
                    opacity: 0.85
                });
            } else {
                material = new THREE.MeshLambertMaterial({
                    map: this.terrainTexture,
                    flatShading: false
                });
            }
            
            const instancedMesh = new THREE.InstancedMesh(geometry, material, count);
            instancedMesh.receiveShadow = true;
            
            const matrix = new THREE.Matrix4();
            const positions = blockPositions[blockType];
            
            for (let i = 0; i < count; i++) {
                const pos = positions[i];
                matrix.setPosition(pos.x, pos.y, pos.z);
                instancedMesh.setMatrixAt(i, matrix);
            }
            
            instancedMesh.instanceMatrix.needsUpdate = true;
            this.scene.add(instancedMesh);
        });
        
        console.log('Block counts:', blockCounts);
    }

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

        window.addEventListener('click', () => {
            this.handleClick();
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
            this.hero.commandGolems(point);
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
            this.hero.moveForward(12 * deltaTime);
        }
        if (this.keys['s']) {
            this.hero.moveBackward(6 * deltaTime);
        }
        if (this.keys[' ']) {
            this.hero.jump(10);
        }
    }

    update(deltaTime) {
        this.touchControls.update(deltaTime);
        this.handleInput(deltaTime);
        
        this.entities.forEach(entity => {
            if (entity instanceof EnemyUnit) {
                entity.update(deltaTime, this.terrain, this.playerEntities, this.objectGenerator);
            } else {
                entity.update(deltaTime, this.terrain, this.objectGenerator);
            }
        });

        this.entities = this.entities.filter(e => e.health > 0);
        this.playerEntities = this.playerEntities.filter(e => e.health > 0);
        this.enemyEntities = this.enemyEntities.filter(e => e.health > 0);

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
        stats.innerHTML = `
            Hero Health: ${Math.max(0, Math.floor(this.hero.health))}/${this.hero.maxHealth}<br>
            Golems: ${this.hero.commandedGolems.filter(g => g.health > 0).length}<br>
            Enemies: ${this.enemyEntities.length}<br>
            Biome: ${biome}<br>
            Camera: ${cameraMode}
        `;
    }

    animate() {
        requestAnimationFrame(() => this.animate());
        
        this.fpsCounter.update();
        
        const deltaTime = 0.016;
        this.update(deltaTime);
        this.renderer.render(this.scene, this.camera);
    }
}