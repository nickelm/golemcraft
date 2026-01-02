import * as THREE from 'three';
import { getObjectDensity, canObjectSpawnInBiome } from '../terrain/biomesystem.js';

// Object definitions
export const OBJECT_TYPES = {
    tree: {
        name: 'Tree',
        biomes: ['plains'],
        density: 0.08,
        hasCollision: false,
        usesForestNoise: true
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
        density: 0,
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
        this.collisionMap = new Map();
        
        // Object rendering distance (configurable)
        this.objectRenderDistance = 128; // Only render objects within 128 blocks
        
        // Track generated objects by chunk for distance culling
        this.objectsByChunk = new Map(); // key: "chunkX,chunkZ" -> array of meshes
    }

    hash(x, z, salt = 0) {
        let h = this.seed + salt + x * 374761393 + z * 668265263;
        h = (h ^ (h >> 13)) * 1274126177;
        return ((h ^ (h >> 16)) & 0xffffffff) / 0xffffffff;
    }
    
    forestNoise(x, z) {
        const scale = 0.04;
        const X = Math.floor(x * scale);
        const Z = Math.floor(z * scale);
        const fx = (x * scale) - X;
        const fz = (z * scale) - Z;
        
        const u = fx * fx * (3 - 2 * fx);
        const v = fz * fz * (3 - 2 * fz);
        
        const salt = 99999;
        const a = this.hash(X, Z, salt);
        const b = this.hash(X + 1, Z, salt);
        const c = this.hash(X, Z + 1, salt);
        const d = this.hash(X + 1, Z + 1, salt);
        
        const noise = a * (1 - u) * (1 - v) +
                      b * u * (1 - v) +
                      c * (1 - u) * v +
                      d * u * v;
        
        return Math.pow(noise, 0.7);
    }

    shouldPlaceObject(x, z, density, salt) {
        return this.hash(x, z, salt) < density;
    }

    getVariation(x, z, salt) {
        return this.hash(x, z, salt);
    }

    hasCollision(x, z) {
        return this.collisionMap.has(`${x},${z}`);
    }

    generate(scene, width, depth, waterLevel) {
        const objects = {
            tree: [],
            snowTree: [],
            rock: [],
            boulder: [],
            grass: [],
            cactus: []
        };

        for (let x = -width / 2; x < width / 2; x++) {
            for (let z = -depth / 2; z < depth / 2; z++) {
                const height = this.terrain.getHeight(x, z);
                
                if (height < waterLevel) continue;

                const biome = this.terrain.getBiome(x, z);
                const y = height + 1;

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
                        objects[type].push({ x: x + 0.5, y: y + 0.5, z: z + 0.5, variation });
                        
                        if (config.hasCollision) {
                            this.collisionMap.set(`${x},${z}`, type);
                        }
                        placed = true;
                    }
                }
            }
        }

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
     * @param {Set} loadedChunks - Set of loaded chunk keys (optional, for validation)
     */
    generateForChunk(scene, chunkX, chunkZ, waterLevel, loadedChunks = null) {
        const CHUNK_SIZE = 16; // Must match CHUNK_SIZE from terrainchunks.js
        const chunkKey = `${chunkX},${chunkZ}`;
        
        // Only generate objects for loaded chunks (Solution B)
        if (loadedChunks && !loadedChunks.has(chunkKey)) {
            console.warn(`Skipping object generation for unloaded chunk ${chunkKey}`);
            return;
        }
        
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
        
        for (let x = startX; x < startX + CHUNK_SIZE; x++) {
            for (let z = startZ; z < startZ + CHUNK_SIZE; z++) {
                const height = this.terrain.getHeight(x, z);
                if (height < waterLevel) continue;
                
                const biome = this.terrain.getBiome(x, z);
                const y = height + 1;
                
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
        
        // Create instanced meshes and track them by chunk
        const meshes = [];
        meshes.push(...this.createTrees(scene, objects.tree, false));
        meshes.push(...this.createTrees(scene, objects.snowTree, true));
        meshes.push(...this.createRocks(scene, objects.rock, false));
        meshes.push(...this.createRocks(scene, objects.boulder, true));
        meshes.push(...this.createGrass(scene, objects.grass));
        meshes.push(...this.createCacti(scene, objects.cactus));
        
        // Store meshes for this chunk (for distance culling)
        this.objectsByChunk.set(chunkKey, meshes);
        
        return objects;
    }
    
    /**
     * Update object visibility based on distance from player (Solution C)
     * @param {THREE.Vector3} playerPosition - Current player position
     */
    updateObjectVisibility(playerPosition) {
        const distanceSquared = this.objectRenderDistance * this.objectRenderDistance;
        
        this.objectsByChunk.forEach((meshes, chunkKey) => {
            const [chunkX, chunkZ] = chunkKey.split(',').map(Number);
            const CHUNK_SIZE = 16;
            
            // Calculate chunk center position
            const chunkCenterX = (chunkX * CHUNK_SIZE) + (CHUNK_SIZE / 2);
            const chunkCenterZ = (chunkZ * CHUNK_SIZE) + (CHUNK_SIZE / 2);
            
            // Check distance from player to chunk center
            const dx = chunkCenterX - playerPosition.x;
            const dz = chunkCenterZ - playerPosition.z;
            const distSq = dx * dx + dz * dz;
            
            const shouldBeVisible = distSq <= distanceSquared;
            
            // Update visibility for all meshes in this chunk
            meshes.forEach(mesh => {
                if (mesh && mesh.visible !== shouldBeVisible) {
                    mesh.visible = shouldBeVisible;
                }
            });
        });
    }
    
    /**
     * Remove objects for an unloaded chunk
     * @param {number} chunkX - Chunk X coordinate
     * @param {number} chunkZ - Chunk Z coordinate
     */
    unloadChunk(chunkX, chunkZ) {
        const chunkKey = `${chunkX},${chunkZ}`;
        const meshes = this.objectsByChunk.get(chunkKey);
        
        if (meshes) {
            // Remove meshes from scene and dispose
            meshes.forEach(mesh => {
                if (mesh && mesh.parent) {
                    mesh.parent.remove(mesh);
                    if (mesh.geometry) mesh.geometry.dispose();
                    if (mesh.material) {
                        if (Array.isArray(mesh.material)) {
                            mesh.material.forEach(m => m.dispose());
                        } else {
                            mesh.material.dispose();
                        }
                    }
                }
            });
            
            this.objectsByChunk.delete(chunkKey);
        }
    }

    createTrees(scene, positions, isSnowy) {
        if (positions.length === 0) return [];

        const trunkColor = 0x8B4513;
        const foliageColor = isSnowy ? 0x228B22 : 0x2E8B2E;

        const trunkGeometry = new THREE.CylinderGeometry(0.15, 0.2, 1.2, 6);
        const trunkMaterial = new THREE.MeshLambertMaterial({ color: trunkColor });
        const trunkMesh = new THREE.InstancedMesh(trunkGeometry, trunkMaterial, positions.length);
        trunkMesh.castShadow = true;
        trunkMesh.receiveShadow = true;

        let foliageGeometry;
        if (isSnowy) {
            foliageGeometry = new THREE.ConeGeometry(0.7, 1.8, 6);
        } else {
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
            const sizeVar = 0.8 + pos.variation * 0.4;
            
            scale.set(sizeVar, sizeVar, sizeVar);
            const trunkY = pos.y + 0.6 * sizeVar - 1;
            matrix.compose(
                new THREE.Vector3(pos.x, trunkY, pos.z),
                quaternion,
                scale
            );
            trunkMesh.setMatrixAt(i, matrix);

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

        const meshes = [trunkMesh, foliageMesh];

        if (isSnowy && positions.length > 0) {
            const snowGeometry = new THREE.ConeGeometry(0.6, 1.4, 6);
            const snowMaterial = new THREE.MeshLambertMaterial({ color: 0xFFFFFF });
            const snowMesh = new THREE.InstancedMesh(snowGeometry, snowMaterial, positions.length);
            snowMesh.castShadow = true;
            snowMesh.receiveShadow = true;

            positions.forEach((pos, i) => {
                const sizeVar = 0.8 + pos.variation * 0.4;
                const trunkY = pos.y + 0.6 * sizeVar - 1;
                const trunkTop = trunkY + 0.6 * sizeVar;
                const foliageY = trunkTop + 0.9 * sizeVar;
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
            meshes.push(snowMesh);
        }
        
        return meshes;
    }

    createRocks(scene, positions, isLarge) {
        if (positions.length === 0) return [];

        const rockColor = isLarge ? 0x696969 : 0x808080;
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
                new THREE.Vector3(sizeVar, sizeVar * 0.7, sizeVar)
            );
            mesh.setMatrixAt(i, matrix);
        });

        mesh.instanceMatrix.needsUpdate = true;
        scene.add(mesh);
        
        return [mesh];
    }

    createGrass(scene, positions) {
        if (positions.length === 0) return [];

        const grassGeometry = new THREE.ConeGeometry(0.1, 0.4, 4);
        const grassMaterial = new THREE.MeshLambertMaterial({ color: 0x3CB371 });
        const mesh = new THREE.InstancedMesh(grassGeometry, grassMaterial, positions.length * 3);

        const matrix = new THREE.Matrix4();
        const quaternion = new THREE.Quaternion();

        let index = 0;
        positions.forEach((pos) => {
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
        
        return [mesh];
    }

    createCacti(scene, positions) {
        if (positions.length === 0) return [];

        const cactusColor = 0x2E8B2E;

        const bodyGeometry = new THREE.CylinderGeometry(0.2, 0.25, 1.5, 6);
        const material = new THREE.MeshLambertMaterial({ color: cactusColor });
        const bodyMesh = new THREE.InstancedMesh(bodyGeometry, material, positions.length);
        bodyMesh.castShadow = true;

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

        const armQuaternion = new THREE.Quaternion();
        armsWithArms.forEach((pos, i) => {
            const sizeVar = 0.8 + pos.variation * 0.4;
            
            armQuaternion.setFromEuler(new THREE.Euler(0, 0, Math.PI / 2));
            matrix.compose(
                new THREE.Vector3(pos.x - 0.35 * sizeVar, pos.y + 0.8 * sizeVar - 0.5, pos.z),
                armQuaternion,
                new THREE.Vector3(sizeVar, sizeVar, sizeVar)
            );
            armMesh.setMatrixAt(i * 2, matrix);

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
        const meshes = [bodyMesh];
        
        if (armsWithArms.length > 0) {
            scene.add(armMesh);
            meshes.push(armMesh);
        }
        
        return meshes;
    }
}