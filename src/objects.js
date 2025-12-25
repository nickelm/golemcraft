import * as THREE from 'three';

// Object definitions
export const OBJECT_TYPES = {
    tree: {
        name: 'Tree',
        biomes: ['plains'],
        density: 0.03,
        hasCollision: true
    },
    snowTree: {
        name: 'Snow Tree',
        biomes: ['snow'],
        density: 0.025,
        hasCollision: true
    },
    rock: {
        name: 'Rock',
        biomes: ['plains', 'mountains', 'snow'],
        density: 0.015,
        hasCollision: true
    },
    boulder: {
        name: 'Boulder',
        biomes: ['mountains'],
        density: 0.02,
        hasCollision: true
    },
    grass: {
        name: 'Grass',
        biomes: ['plains'],
        density: 0.08,
        hasCollision: false
    },
    cactus: {
        name: 'Cactus',
        biomes: ['desert'],
        density: 0.02,
        hasCollision: true
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
                    if (this.shouldPlaceObject(x, z, config.density, salt)) {
                        const variation = this.getVariation(x, z, salt + 1);
                        objects[type].push({ x, y, z, variation });
                        
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

    createTrees(scene, positions, isSnowy) {
        if (positions.length === 0) return;

        // Tree consists of: trunk (cylinder) + foliage (cone or sphere)
        const trunkColor = 0x8B4513; // Brown
        const foliageColor = isSnowy ? 0x228B22 : 0x2E8B2E; // Dark green, slightly different shades

        // Create trunk instances
        const trunkGeometry = new THREE.CylinderGeometry(0.15, 0.2, 1.2, 6);
        const trunkMaterial = new THREE.MeshLambertMaterial({ color: trunkColor });
        const trunkMesh = new THREE.InstancedMesh(trunkGeometry, trunkMaterial, positions.length);
        trunkMesh.castShadow = true;

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

        const matrix = new THREE.Matrix4();
        const rotation = new THREE.Euler();
        const quaternion = new THREE.Quaternion();
        const scale = new THREE.Vector3();

        positions.forEach((pos, i) => {
            const sizeVar = 0.8 + pos.variation * 0.4; // 0.8 to 1.2 size
            
            // Trunk
            scale.set(sizeVar, sizeVar, sizeVar);
            matrix.compose(
                new THREE.Vector3(pos.x, pos.y + 0.6 * sizeVar, pos.z),
                quaternion,
                scale
            );
            trunkMesh.setMatrixAt(i, matrix);

            // Foliage (on top of trunk)
            const foliageY = isSnowy ? pos.y + 1.5 * sizeVar : pos.y + 1.8 * sizeVar;
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

        // Add snow caps to snowy trees
        if (isSnowy && positions.length > 0) {
            const snowGeometry = new THREE.ConeGeometry(0.5, 0.6, 6);
            const snowMaterial = new THREE.MeshLambertMaterial({ color: 0xFFFFFF });
            const snowMesh = new THREE.InstancedMesh(snowGeometry, snowMaterial, positions.length);

            positions.forEach((pos, i) => {
                const sizeVar = 0.8 + pos.variation * 0.4;
                matrix.compose(
                    new THREE.Vector3(pos.x, pos.y + 2.2 * sizeVar, pos.z),
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