import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TerrainGenerator, BLOCK_TYPES, createBlockGeometry, WATER_LEVEL } from './terrain.js';
import { ObjectGenerator } from './objects.js';
import { Hero, Golem, EnemyUnit } from './entities.js';
import { FPSCounter } from './utils/fps-counter.js';

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

        this.terrain = new TerrainGenerator();
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

        // Load terrain texture
        const textureLoader = new THREE.TextureLoader();
        this.terrainTexture = textureLoader.load('/terrain3.png', () => {
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

        // Lighting
        const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
        this.scene.add(ambientLight);

        const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
        directionalLight.position.set(50, 100, 50);
        directionalLight.castShadow = true;
        directionalLight.shadow.camera.left = -50;
        directionalLight.shadow.camera.right = 50;
        directionalLight.shadow.camera.top = 50;
        directionalLight.shadow.camera.bottom = -50;
        directionalLight.shadow.mapSize.width = 1024;
        directionalLight.shadow.mapSize.height = 1024;
        this.scene.add(directionalLight);

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
            this.hero.moveForward(18 * deltaTime);
        }
        if (this.keys['s']) {
            this.hero.moveBackward(5*deltaTime);
        }
        if (this.keys[' ']) {
            this.hero.jump(14);
        }
    }

    update(deltaTime) {
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

        const heroPos = this.hero.position.clone();
        const delta = heroPos.clone().sub(this.controls.target);
        
        this.controls.target.copy(heroPos);
        this.camera.position.add(delta);
        
        this.controls.update();
        this.updateUI();
    }

    updateUI() {
        const stats = document.getElementById('stats');
        const biome = this.terrain.getBiome(
            Math.floor(this.hero.position.x),
            Math.floor(this.hero.position.z)
        );
        stats.innerHTML = `
            Hero Health: ${Math.max(0, Math.floor(this.hero.health))}/${this.hero.maxHealth}<br>
            Golems: ${this.hero.commandedGolems.filter(g => g.health > 0).length}<br>
            Enemies: ${this.enemyEntities.length}<br>
            Biome: ${biome}
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
