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
    jungleTree: {
        name: 'Jungle Tree',
        biomes: ['jungle'],
        density: 0.12,
        hasCollision: false,
        usesForestNoise: true
    },
    rock: {
        name: 'Rock',
        biomes: ['plains', 'mountains', 'snow', 'jungle'],
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
    constructor(terrain, seed = 54321, landmarkSystem = null) {
        this.terrain = terrain;
        this.seed = seed;
        this.landmarkSystem = landmarkSystem;
        this.collisionMap = new Map();
        
        // Object rendering distance (configurable)
        this.objectRenderDistance = 128;
        
        // Track generated objects by chunk for distance culling
        this.objectsByChunk = new Map();
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
    
    /**
     * Get ground height for object placement
     * Uses interpolated height for smooth terrain placement
     */
    getObjectPlacementHeight(x, z) {
        // Use interpolated height if available (for smooth terrain)
        if (this.terrain.getInterpolatedHeight) {
            return this.terrain.getInterpolatedHeight(x, z);
        }
        // Fall back to integer height + 1 for voxel terrain
        return this.terrain.getHeight(x, z) + 1;
    }

    generate(scene, width, depth, waterLevel) {
        const objects = {
            tree: [],
            snowTree: [],
            jungleTree: [],
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
                
                // Get interpolated height for smooth placement
                const placeX = x + 0.5;
                const placeZ = z + 0.5;
                const y = this.getObjectPlacementHeight(placeX, placeZ);

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
                        objects[type].push({ x: placeX, y: y, z: placeZ, variation });
                        
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
        this.createJungleTrees(scene, objects.jungleTree);
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
     */
    generateForChunk(scene, chunkX, chunkZ, waterLevel, loadedChunks = null) {
        const CHUNK_SIZE = 16;
        const chunkKey = `${chunkX},${chunkZ}`;
        
        if (loadedChunks && !loadedChunks.has(chunkKey)) {
            console.warn(`Skipping object generation for unloaded chunk ${chunkKey}`);
            return;
        }
        
        const objects = {
            tree: [],
            snowTree: [],
            jungleTree: [],
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
                
                // Skip if inside a landmark's footprint
                if (this.landmarkSystem && this.landmarkSystem.isInsideLandmark(x, z)) {
                    continue;
                }
                
                const biome = this.terrain.getBiome(x, z);
                
                // Get interpolated height for smooth placement
                const placeX = x + 0.5;
                const placeZ = z + 0.5;
                const y = this.getObjectPlacementHeight(placeX, placeZ);
                
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
                        objects[type].push({ x: placeX, y: y, z: placeZ, variation });
                        
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
        meshes.push(...this.createJungleTrees(scene, objects.jungleTree));
        meshes.push(...this.createRocks(scene, objects.rock, false));
        meshes.push(...this.createRocks(scene, objects.boulder, true));
        meshes.push(...this.createGrass(scene, objects.grass));
        meshes.push(...this.createCacti(scene, objects.cactus));
        
        // Store meshes for this chunk (for distance culling)
        this.objectsByChunk.set(chunkKey, meshes);
        
        return objects;
    }
    
    /**
     * Update object visibility based on distance from player
     */
    updateObjectVisibility(playerPosition) {
        const distanceSquared = this.objectRenderDistance * this.objectRenderDistance;
        
        this.objectsByChunk.forEach((meshes, chunkKey) => {
            const [chunkX, chunkZ] = chunkKey.split(',').map(Number);
            const CHUNK_SIZE = 16;
            
            const chunkCenterX = (chunkX * CHUNK_SIZE) + (CHUNK_SIZE / 2);
            const chunkCenterZ = (chunkZ * CHUNK_SIZE) + (CHUNK_SIZE / 2);
            
            const dx = chunkCenterX - playerPosition.x;
            const dz = chunkCenterZ - playerPosition.z;
            const distSq = dx * dx + dz * dz;
            
            const shouldBeVisible = distSq <= distanceSquared;
            
            meshes.forEach(mesh => {
                if (mesh && mesh.visible !== shouldBeVisible) {
                    mesh.visible = shouldBeVisible;
                }
            });
        });
    }
    
    /**
     * Remove objects for an unloaded chunk
     */
    unloadChunk(chunkX, chunkZ) {
        const chunkKey = `${chunkX},${chunkZ}`;
        const meshes = this.objectsByChunk.get(chunkKey);
        
        if (meshes) {
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

        // Trunk geometry
        const trunkGeo = new THREE.CylinderGeometry(0.15, 0.2, 1.2, 6);
        const trunkMat = new THREE.MeshLambertMaterial({ color: trunkColor });
        const trunkMesh = new THREE.InstancedMesh(trunkGeo, trunkMat, positions.length);
        trunkMesh.castShadow = true;
        trunkMesh.receiveShadow = true;

        // Foliage - cone for snowy (fir trees), sphere for regular
        let foliageGeo;
        if (isSnowy) {
            foliageGeo = new THREE.ConeGeometry(0.7, 1.8, 6);
        } else {
            foliageGeo = new THREE.SphereGeometry(0.8, 6, 4);
        }
        const foliageMat = new THREE.MeshLambertMaterial({ color: foliageColor });
        const foliageMesh = new THREE.InstancedMesh(foliageGeo, foliageMat, positions.length);
        foliageMesh.castShadow = true;
        foliageMesh.receiveShadow = true;

        const matrix = new THREE.Matrix4();
        const quaternion = new THREE.Quaternion();
        const scale = new THREE.Vector3();

        positions.forEach((pos, i) => {
            const sizeVar = 0.8 + pos.variation * 0.4;
            
            scale.set(sizeVar, sizeVar, sizeVar);
            const trunkY = pos.y + 0.6 * sizeVar;
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

        // Snow caps for fir trees
        if (isSnowy && positions.length > 0) {
            const snowGeometry = new THREE.ConeGeometry(0.6, 1.4, 6);
            const snowMaterial = new THREE.MeshLambertMaterial({ color: 0xFFFFFF });
            const snowMesh = new THREE.InstancedMesh(snowGeometry, snowMaterial, positions.length);
            snowMesh.castShadow = true;
            snowMesh.receiveShadow = true;

            positions.forEach((pos, i) => {
                const sizeVar = 0.8 + pos.variation * 0.4;
                const trunkY = pos.y + 0.6 * sizeVar;
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

    createJungleTrees(scene, positions) {
        if (positions.length === 0) return [];

        const trunkColor = 0x5D4037;
        const foliageColor = 0x1B5E20;

        // Tall trunk
        const trunkGeo = new THREE.CylinderGeometry(0.25, 0.35, 5, 8);
        const trunkMat = new THREE.MeshLambertMaterial({ color: trunkColor });
        const trunkMesh = new THREE.InstancedMesh(trunkGeo, trunkMat, positions.length);
        trunkMesh.castShadow = true;

        // Large canopy
        const foliageGeo = new THREE.SphereGeometry(2.0, 10, 8);
        const foliageMat = new THREE.MeshLambertMaterial({ color: foliageColor });
        const foliageMesh = new THREE.InstancedMesh(foliageGeo, foliageMat, positions.length);
        foliageMesh.castShadow = true;
        foliageMesh.receiveShadow = true;

        const matrix = new THREE.Matrix4();
        const quaternion = new THREE.Quaternion();

        positions.forEach((pos, i) => {
            const sizeVar = 0.8 + pos.variation * 0.4;
            
            // Trunk - base at ground level
            const trunkY = pos.y + 2.5 * sizeVar;
            matrix.compose(
                new THREE.Vector3(pos.x, trunkY, pos.z),
                quaternion,
                new THREE.Vector3(sizeVar, sizeVar, sizeVar)
            );
            trunkMesh.setMatrixAt(i, matrix);

            // Canopy
            const foliageY = trunkY + 3.0 * sizeVar;
            matrix.compose(
                new THREE.Vector3(pos.x, foliageY, pos.z),
                quaternion,
                new THREE.Vector3(sizeVar, sizeVar * 0.7, sizeVar)
            );
            foliageMesh.setMatrixAt(i, matrix);
        });

        trunkMesh.instanceMatrix.needsUpdate = true;
        foliageMesh.instanceMatrix.needsUpdate = true;

        scene.add(trunkMesh);
        scene.add(foliageMesh);

        return [trunkMesh, foliageMesh];
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

            // Rock sits on ground - slight embed
            const yOffset = isLarge ? 0.3 * sizeVar : 0.15 * sizeVar;
            matrix.compose(
                new THREE.Vector3(pos.x, pos.y + yOffset, pos.z),
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
                    new THREE.Vector3(pos.x + offsetX, pos.y + 0.15 * sizeVar, pos.z + offsetZ),
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
            
            // Body - base at ground level
            matrix.compose(
                new THREE.Vector3(pos.x, pos.y + 0.75 * sizeVar, pos.z),
                quaternion,
                new THREE.Vector3(sizeVar, sizeVar, sizeVar)
            );
            bodyMesh.setMatrixAt(i, matrix);
        });

        // Arms for some cacti
        let armIndex = 0;
        armsWithArms.forEach((pos) => {
            const sizeVar = 0.8 + pos.variation * 0.4;
            const armY = pos.y + 0.8 * sizeVar;
            
            // Left arm
            const leftQ = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, Math.PI / 3));
            matrix.compose(
                new THREE.Vector3(pos.x - 0.3 * sizeVar, armY, pos.z),
                leftQ,
                new THREE.Vector3(sizeVar, sizeVar, sizeVar)
            );
            armMesh.setMatrixAt(armIndex++, matrix);

            // Right arm
            const rightQ = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, -Math.PI / 3));
            matrix.compose(
                new THREE.Vector3(pos.x + 0.3 * sizeVar, armY, pos.z),
                rightQ,
                new THREE.Vector3(sizeVar, sizeVar, sizeVar)
            );
            armMesh.setMatrixAt(armIndex++, matrix);
        });

        bodyMesh.instanceMatrix.needsUpdate = true;
        armMesh.instanceMatrix.needsUpdate = true;

        scene.add(bodyMesh);
        scene.add(armMesh);

        return [bodyMesh, armMesh];
    }
}