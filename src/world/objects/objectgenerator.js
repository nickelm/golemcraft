import * as THREE from 'three';
import { getObjectDensity, canObjectSpawnInBiome } from '../terrain/biomesystem.js';

// Object definitions
export const OBJECT_TYPES = {
    tree: {
        name: 'Tree',
        biomes: ['plains'],
        density: 0.08,  // Higher base density, modulated by forest noise
        hasCollision: false,
        usesForestNoise: true  // Trees cluster into forests
    },
    snowTree: {
        name: 'Snow Tree',
        biomes: ['snow'],
        density: 0.06,
        hasCollision: false,
        usesForestNoise: true
    },
    rock: {
        name: 'Rock',
        biomes: ['plains', 'mountains', 'snow'],
        density: 0.015,
        hasCollision: false
    },
    boulder: {
        name: 'Boulder',
        biomes: ['mountains'],
        density: 0.02,
        hasCollision: false
    },
    grass: {
        name: 'Grass',
        biomes: ['plains'],
        density: 0,  // Disabled - too many triangles for little visual gain
        hasCollision: false
    },
    cactus: {
        name: 'Cactus',
        biomes: ['desert'],
        density: 0.02,
        hasCollision: false
    }
};

// Generate objects for the terrain
export class ObjectGenerator {
    constructor(terrain, seed = 54321) {
        this.terrain = terrain;
        this.seed = seed;
        this.collisionMap = new Map(); // Track which cells have solid objects
    }

    // Hash for object placement
    hash(x, z, salt = 0) {
        let h = this.seed + salt + x * 374761393 + z * 668265263;
        h = (h ^ (h >> 13)) * 1274126177;
        return ((h ^ (h >> 16)) & 0xffffffff) / 0xffffffff;
    }
    
    // Smooth noise for forest clustering (creates patches of forest vs open plains)
    forestNoise(x, z) {
        // Low frequency noise creates large forest patches
        const scale = 0.04;  // Larger = smaller patches
        const X = Math.floor(x * scale);
        const Z = Math.floor(z * scale);
        const fx = (x * scale) - X;
        const fz = (z * scale) - Z;
        
        // Smoothstep interpolation
        const u = fx * fx * (3 - 2 * fx);
        const v = fz * fz * (3 - 2 * fz);
        
        // Hash corners with forest-specific salt
        const salt = 99999;
        const a = this.hash(X, Z, salt);
        const b = this.hash(X + 1, Z, salt);
        const c = this.hash(X, Z + 1, salt);
        const d = this.hash(X + 1, Z + 1, salt);
        
        // Bilinear interpolation
        const noise = a * (1 - u) * (1 - v) +
                      b * u * (1 - v) +
                      c * (1 - u) * v +
                      d * u * v;
        
        // Sharpen the transition: values below 0.45 become sparse, above become dense
        // This creates distinct forest patches with clear meadows between
        return Math.pow(noise, 0.7);  // Slightly boost forest coverage
    }

    // Check if position should have an object
    shouldPlaceObject(x, z, density, salt) {
        return this.hash(x, z, salt) < density;
    }

    // Get variation value for size/rotation
    getVariation(x, z, salt) {
        return this.hash(x, z, salt);
    }

    // Check if cell has collision
    hasCollision(x, z) {
        return this.collisionMap.has(`${x},${z}`);
    }

    // Generate all objects and return meshes
    generate(scene, width, depth, waterLevel) {
        const objects = {
            tree: [],
            snowTree: [],
            rock: [],
            boulder: [],
            grass: [],
            cactus: []
        };

        // First pass: determine object positions
        for (let x = -width / 2; x < width / 2; x++) {
            for (let z = -depth / 2; z < depth / 2; z++) {
                const height = this.terrain.getHeight(x, z);
                
                // Skip underwater positions
                if (height < waterLevel) continue;

                const biome = this.terrain.getBiome(x, z);
                const y = height + 1; // Place on top of terrain

                // Check each object type
                let placed = false;
                for (const [type, config] of Object.entries(OBJECT_TYPES)) {
                    if (placed) break;
                    if (!config.biomes.includes(biome)) continue;
                    
                    const salt = type.charCodeAt(0) * 1000;
                    
                    // Apply forest noise to tree density - creates clustered forests
                    let effectiveDensity = config.density;
                    if (config.usesForestNoise) {
                        const forestValue = this.forestNoise(x, z);
                        // In forest areas (high noise): full density
                        // In meadow areas (low noise): very sparse (5% of normal)
                        effectiveDensity = config.density * (0.05 + 0.95 * forestValue);
                    }
                    
                    if (this.shouldPlaceObject(x, z, effectiveDensity, salt)) {
                        const variation = this.getVariation(x, z, salt + 1);
                        // Add 0.5 offset to center objects on blocks (terrain uses 0-1 geometry)
                        objects[type].push({ x: x + 0.5, y: y + 0.5, z: z + 0.5, variation });
                        
                        if (config.hasCollision) {
                            this.collisionMap.set(`${x},${z}`, type);
                        }
                        placed = true; // Only one object per cell
                    }
                }
            }
        }

        // Second pass: create instanced meshes
        this.createTrees(scene, objects.tree, false);
        this.createTrees(scene, objects.snowTree, true);
        this.createRocks(scene, objects.rock, false);
        this.createRocks(scene, objects.boulder, true);
        this.createGrass(scene, objects.grass);
        this.createCacti(scene, objects.cactus);

        const total = Object.values(objects).reduce((sum, arr) => sum + arr.length, 0);
        console.log(`Generated ${total} objects:`, 
            Object.entries(objects).map(([k, v]) => `${k}: ${v.length}`).join(', '));
    }
    
    /**
     * Generate objects for a specific chunk (for infinite terrain)
     * @param {THREE.Scene} scene - Scene to add objects to
     * @param {number} chunkX - Chunk X coordinate
     * @param {number} chunkZ - Chunk Z coordinate
     * @param {number} waterLevel - Water level to skip underwater positions
     */
    generateForChunk(scene, chunkX, chunkZ, waterLevel) {
        const CHUNK_SIZE = 32; // Must match CHUNK_SIZE from terrainchunks.js
        
        const objects = {
            tree: [],
            snowTree: [],
            rock: [],
            boulder: [],
            grass: [],
            cactus: []
        };
        
        const startX = chunkX * CHUNK_SIZE;
        const startZ = chunkZ * CHUNK_SIZE;
        
        // Generate objects within this chunk
        for (let x = startX; x < startX + CHUNK_SIZE; x++) {
            for (let z = startZ; z < startZ + CHUNK_SIZE; z++) {
                const height = this.terrain.getHeight(x, z);
                if (height < waterLevel) continue;
                
                const biome = this.terrain.getBiome(x, z);
                const y = height + 1;
                
                // Check each object type
                let placed = false;
                for (const [type, config] of Object.entries(OBJECT_TYPES)) {
                    if (placed) break;
                    if (!config.biomes.includes(biome)) continue;
                    
                    const salt = type.charCodeAt(0) * 1000;
                    let effectiveDensity = config.density;
                    
                    if (config.usesForestNoise) {
                        const forestValue = this.forestNoise(x, z);
                        effectiveDensity = config.density * (0.05 + 0.95 * forestValue);
                    }
                    
                    if (this.shouldPlaceObject(x, z, effectiveDensity, salt)) {
                        const variation = this.getVariation(x, z, salt + 1);
                        objects[type].push({ 
                            x: x + 0.5, y: y + 0.5, z: z + 0.5, variation 
                        });
                        
                        if (config.hasCollision) {
                            this.collisionMap.set(`${x},${z}`, type);
                        }
                        placed = true;
                    }
                }
            }
        }
        
        // Create instanced meshes for this chunk
        this.createTrees(scene, objects.tree, false);
        this.createTrees(scene, objects.snowTree, true);
        this.createRocks(scene, objects.rock, false);
        this.createRocks(scene, objects.boulder, true);
        this.createGrass(scene, objects.grass);
        this.createCacti(scene, objects.cactus);
        
        return objects;
    }

    createTrees(scene, positions, isSnowy) {
        if (positions.length === 0) return;

        // Tree consists of: trunk (cylinder) + foliage (cone or sphere)
        const trunkColor = 0x8B4513; // Brown
        const foliageColor = isSnowy ? 0x228B22 : 0x2E8B2E; // Dark green, slightly different shades

        // Create trunk instances - trunk is 1.2 tall
        const trunkGeometry = new THREE.CylinderGeometry(0.15, 0.2, 1.2, 6);
        const trunkMaterial = new THREE.MeshLambertMaterial({ color: trunkColor });
        const trunkMesh = new THREE.InstancedMesh(trunkGeometry, trunkMaterial, positions.length);
        trunkMesh.castShadow = true;
        trunkMesh.receiveShadow = true;

        // Create foliage instances (cone for regular, sphere-ish for snowy)
        let foliageGeometry;
        if (isSnowy) {
            // Snowy trees: layered cones (simplified as single cone)
            foliageGeometry = new THREE.ConeGeometry(0.7, 1.8, 6);
        } else {
            // Regular trees: rounder foliage
            foliageGeometry = new THREE.SphereGeometry(0.8, 6, 4);
        }
        const foliageMaterial = new THREE.MeshLambertMaterial({ color: foliageColor });
        const foliageMesh = new THREE.InstancedMesh(foliageGeometry, foliageMaterial, positions.length);
        foliageMesh.castShadow = true;
        foliageMesh.receiveShadow = true;

        const matrix = new THREE.Matrix4();
        const rotation = new THREE.Euler();
        const quaternion = new THREE.Quaternion();
        const scale = new THREE.Vector3();

        positions.forEach((pos, i) => {
            const sizeVar = 0.8 + pos.variation * 0.4; // 0.8 to 1.2 size
            
            // Trunk - cylinder is 1.2 tall, center it so bottom touches ground
            // pos.y is already at height + 1 (top of terrain block)
            // Trunk center should be at pos.y + (0.6 * sizeVar) - 0.5 to sit on block
            scale.set(sizeVar, sizeVar, sizeVar);
            const trunkY = pos.y + 0.6 * sizeVar - 1;
            matrix.compose(
                new THREE.Vector3(pos.x, trunkY, pos.z),
                quaternion,
                scale
            );
            trunkMesh.setMatrixAt(i, matrix);

            // Foliage (on top of trunk)
            // Trunk top is at trunkY + 0.6 * sizeVar
            const trunkTop = trunkY + 0.6 * sizeVar;
            const foliageY = isSnowy ? trunkTop + 0.9 * sizeVar : trunkTop + 0.4 * sizeVar;
            matrix.compose(
                new THREE.Vector3(pos.x, foliageY, pos.z),
                quaternion,
                scale
            );
            foliageMesh.setMatrixAt(i, matrix);
        });

        trunkMesh.instanceMatrix.needsUpdate = true;
        foliageMesh.instanceMatrix.needsUpdate = true;

        scene.add(trunkMesh);
        scene.add(foliageMesh);

        // Add snow layer to snowy trees - covers most of the green cone
        if (isSnowy && positions.length > 0) {
            // Snow is a slightly smaller cone that covers the top 2/3 of the tree
            const snowGeometry = new THREE.ConeGeometry(0.6, 1.4, 6);
            const snowMaterial = new THREE.MeshLambertMaterial({ color: 0xFFFFFF });
            const snowMesh = new THREE.InstancedMesh(snowGeometry, snowMaterial, positions.length);
            snowMesh.castShadow = true;
            snowMesh.receiveShadow = true;

            positions.forEach((pos, i) => {
                const sizeVar = 0.8 + pos.variation * 0.4;
                // Match the foliage calculation from above
                const trunkY = pos.y + 0.6 * sizeVar - 1;
                const trunkTop = trunkY + 0.6 * sizeVar;
                const foliageY = trunkTop + 0.9 * sizeVar;
                // Snow sits slightly higher than foliage center
                const snowY = foliageY + 0.2 * sizeVar;
                matrix.compose(
                    new THREE.Vector3(pos.x, snowY, pos.z),
                    quaternion,
                    new THREE.Vector3(sizeVar, sizeVar, sizeVar)
                );
                snowMesh.setMatrixAt(i, matrix);
            });

            snowMesh.instanceMatrix.needsUpdate = true;
            scene.add(snowMesh);
        }
    }

    createRocks(scene, positions, isLarge) {
        if (positions.length === 0) return;

        const rockColor = isLarge ? 0x696969 : 0x808080; // Darker for boulders
        const geometry = isLarge 
            ? new THREE.DodecahedronGeometry(0.6, 0)
            : new THREE.DodecahedronGeometry(0.35, 0);
        
        const material = new THREE.MeshLambertMaterial({ color: rockColor });
        const mesh = new THREE.InstancedMesh(geometry, material, positions.length);
        mesh.castShadow = true;
        mesh.receiveShadow = true;

        const matrix = new THREE.Matrix4();
        const quaternion = new THREE.Quaternion();
        const euler = new THREE.Euler();

        positions.forEach((pos, i) => {
            const sizeVar = 0.7 + pos.variation * 0.6;
            
            // Random rotation for variety
            euler.set(
                pos.variation * Math.PI,
                pos.variation * Math.PI * 2,
                pos.variation * Math.PI * 0.5
            );
            quaternion.setFromEuler(euler);

            const yOffset = isLarge ? 0.4 * sizeVar : 0.2 * sizeVar;
            matrix.compose(
                new THREE.Vector3(pos.x, pos.y + yOffset - 0.5, pos.z),
                quaternion,
                new THREE.Vector3(sizeVar, sizeVar * 0.7, sizeVar) // Slightly flattened
            );
            mesh.setMatrixAt(i, matrix);
        });

        mesh.instanceMatrix.needsUpdate = true;
        scene.add(mesh);
    }

    createGrass(scene, positions) {
        if (positions.length === 0) return;

        // Grass as small triangular spikes
        const grassGeometry = new THREE.ConeGeometry(0.1, 0.4, 4);
        const grassMaterial = new THREE.MeshLambertMaterial({ color: 0x3CB371 }); // Medium sea green
        const mesh = new THREE.InstancedMesh(grassGeometry, grassMaterial, positions.length * 3); // 3 blades per position

        const matrix = new THREE.Matrix4();
        const quaternion = new THREE.Quaternion();

        let index = 0;
        positions.forEach((pos) => {
            // Place 3 grass blades per cell with slight offsets
            for (let i = 0; i < 3; i++) {
                const offsetX = (this.hash(pos.x, pos.z, i * 100) - 0.5) * 0.6;
                const offsetZ = (this.hash(pos.x, pos.z, i * 100 + 50) - 0.5) * 0.6;
                const sizeVar = 0.6 + this.hash(pos.x, pos.z, i * 100 + 25) * 0.8;
                const rotY = this.hash(pos.x, pos.z, i * 100 + 75) * Math.PI * 2;

                quaternion.setFromEuler(new THREE.Euler(0, rotY, 0));
                matrix.compose(
                    new THREE.Vector3(pos.x + offsetX, pos.y + 0.15 * sizeVar - 0.5, pos.z + offsetZ),
                    quaternion,
                    new THREE.Vector3(sizeVar, sizeVar, sizeVar)
                );
                mesh.setMatrixAt(index++, matrix);
            }
        });

        mesh.instanceMatrix.needsUpdate = true;
        scene.add(mesh);
    }

    createCacti(scene, positions) {
        if (positions.length === 0) return;

        const cactusColor = 0x2E8B2E; // Forest green

        // Main body
        const bodyGeometry = new THREE.CylinderGeometry(0.2, 0.25, 1.5, 6);
        const material = new THREE.MeshLambertMaterial({ color: cactusColor });
        const bodyMesh = new THREE.InstancedMesh(bodyGeometry, material, positions.length);
        bodyMesh.castShadow = true;

        // Arms (smaller cylinders) - not all cacti have arms
        const armGeometry = new THREE.CylinderGeometry(0.1, 0.12, 0.5, 5);
        const armsWithArms = positions.filter(p => p.variation > 0.4);
        const armMesh = new THREE.InstancedMesh(armGeometry, material, armsWithArms.length * 2);
        armMesh.castShadow = true;

        const matrix = new THREE.Matrix4();
        const quaternion = new THREE.Quaternion();

        positions.forEach((pos, i) => {
            const sizeVar = 0.8 + pos.variation * 0.4;
            
            matrix.compose(
                new THREE.Vector3(pos.x, pos.y + 0.75 * sizeVar - 0.5, pos.z),
                quaternion,
                new THREE.Vector3(sizeVar, sizeVar, sizeVar)
            );
            bodyMesh.setMatrixAt(i, matrix);
        });

        // Add arms to some cacti
        const armQuaternion = new THREE.Quaternion();
        armsWithArms.forEach((pos, i) => {
            const sizeVar = 0.8 + pos.variation * 0.4;
            
            // Left arm
            armQuaternion.setFromEuler(new THREE.Euler(0, 0, Math.PI / 2));
            matrix.compose(
                new THREE.Vector3(pos.x - 0.35 * sizeVar, pos.y + 0.8 * sizeVar - 0.5, pos.z),
                armQuaternion,
                new THREE.Vector3(sizeVar, sizeVar, sizeVar)
            );
            armMesh.setMatrixAt(i * 2, matrix);

            // Right arm (higher)
            matrix.compose(
                new THREE.Vector3(pos.x + 0.35 * sizeVar, pos.y + 1.0 * sizeVar - 0.5, pos.z),
                armQuaternion,
                new THREE.Vector3(sizeVar, sizeVar, sizeVar)
            );
            armMesh.setMatrixAt(i * 2 + 1, matrix);
        });

        bodyMesh.instanceMatrix.needsUpdate = true;
        armMesh.instanceMatrix.needsUpdate = true;

        scene.add(bodyMesh);
        if (armsWithArms.length > 0) {
            scene.add(armMesh);
        }
    }
}