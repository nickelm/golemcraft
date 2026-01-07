/**
 * SpawnPointGenerator - Pure function module for deterministic spawn point generation
 *
 * This module is used by the web worker and must be pure functions with no
 * external dependencies (no Three.js, no DOM, etc.)
 *
 * Generates spawn points based on:
 * - Biome-based wilderness spawns (hash-based density per chunk)
 * - Landmark-specific spawns (temple guardians, etc.)
 *
 * All spawn points are deterministic based on world seed + position.
 */

import { BIOMES } from '../world/terrain/biomesystem.js';

// Chunk size constant (must match terrain system)
const CHUNK_SIZE = 16;

// Spawn density by biome (spawn points per chunk, approximately)
const BIOME_SPAWN_DENSITY = {
    ocean: 0,
    plains: 0.02,
    desert: 0.015,
    snow: 0.015,
    mountains: 0.01,
    jungle: 0.02
};

// Default spawn point configuration
const DEFAULT_SPAWN_CONFIG = {
    radius: 2,          // Spawn radius around point
    maxCount: 1,        // Max simultaneous entities
    respawnTime: 30     // Cooldown in seconds
};

// Landmark-specific spawn configurations
const LANDMARK_SPAWN_CONFIG = {
    mayanTemple: {
        mobTypes: ['zombie', 'skeleton'],  // Temple guardians
        radius: 3,
        maxCount: 2,
        respawnTime: 60
    },
    forestHut: {
        mobTypes: ['cow', 'pig', 'chicken'],  // Passive mobs near huts
        radius: 4,
        maxCount: 1,
        respawnTime: 45
    }
};

/**
 * Generate spawn points for a chunk
 *
 * @param {Object} terrainProvider - Provides terrain queries (getHeight, getBiome)
 * @param {number} chunkX - Chunk X coordinate
 * @param {number} chunkZ - Chunk Z coordinate
 * @param {Object} landmarkSystem - Provides landmark queries (getLandmarksForChunk)
 * @param {Function} hashFn - Hash function for deterministic randomness
 * @returns {Array} Array of spawn point objects
 */
export function generateSpawnPoints(terrainProvider, chunkX, chunkZ, landmarkSystem, hashFn) {
    const spawnPoints = [];
    const worldX = chunkX * CHUNK_SIZE;
    const worldZ = chunkZ * CHUNK_SIZE;

    // Generate biome-based wilderness spawn points
    const biomeSpawns = generateBiomeSpawnPoints(
        terrainProvider, chunkX, chunkZ, worldX, worldZ, hashFn
    );
    spawnPoints.push(...biomeSpawns);

    // Generate landmark-specific spawn points
    if (landmarkSystem) {
        const landmarkSpawns = generateLandmarkSpawnPoints(
            terrainProvider, chunkX, chunkZ, landmarkSystem, hashFn
        );
        spawnPoints.push(...landmarkSpawns);
    }

    // Assign unique IDs to each spawn point
    spawnPoints.forEach((sp, index) => {
        sp.id = `${chunkX},${chunkZ}:${index}`;
    });

    return spawnPoints;
}

/**
 * Generate biome-based wilderness spawn points
 */
function generateBiomeSpawnPoints(terrainProvider, chunkX, chunkZ, worldX, worldZ, hashFn) {
    const spawnPoints = [];

    // Sample the chunk center for biome
    const centerX = worldX + CHUNK_SIZE / 2;
    const centerZ = worldZ + CHUNK_SIZE / 2;
    const biome = terrainProvider.getBiome(centerX, centerZ);

    // Get spawn density for this biome
    const density = BIOME_SPAWN_DENSITY[biome] || 0;
    if (density === 0) return spawnPoints;

    // Use hash to determine number of spawn points (0-3 per chunk)
    const spawnSeed = hashFn(chunkX * 73856093, chunkZ * 19349663, 12345);
    const normalizedSeed = (spawnSeed % 1000) / 1000;

    // Density determines probability of each spawn point
    const maxSpawns = 3;
    let numSpawns = 0;

    for (let i = 0; i < maxSpawns; i++) {
        const checkSeed = hashFn(chunkX * 83492791, chunkZ * 29384756, i * 47382);
        const checkValue = (checkSeed % 1000) / 1000;
        if (checkValue < density * 50) {  // Scale density for reasonable spawn counts
            numSpawns++;
        }
    }

    if (numSpawns === 0) return spawnPoints;

    // Generate spawn point positions within chunk
    for (let i = 0; i < numSpawns; i++) {
        // Hash-based position within chunk
        const posHashX = hashFn(chunkX * 12345, chunkZ * 67890, i * 11111);
        const posHashZ = hashFn(chunkX * 54321, chunkZ * 98765, i * 22222);

        const localX = (posHashX % CHUNK_SIZE);
        const localZ = (posHashZ % CHUNK_SIZE);

        const x = worldX + localX;
        const z = worldZ + localZ;

        // Get terrain height
        const height = terrainProvider.getHeight(x, z);

        // Skip underwater or too high locations
        const waterLevel = 6;  // Match game's water level
        if (height <= waterLevel || height > 40) continue;

        // Get biome at this specific position
        const localBiome = terrainProvider.getBiome(x, z);
        const biomeConfig = BIOMES[localBiome];

        // Skip if no mobs for this biome
        if (!biomeConfig || !biomeConfig.mobs || biomeConfig.mobs.length === 0) continue;

        spawnPoints.push({
            x: x + 0.5,  // Center in block
            y: height + 1,  // Above ground
            z: z + 0.5,
            type: 'mob',
            subtype: 'biome',  // Use biome mob selection at spawn time
            biome: localBiome,
            radius: DEFAULT_SPAWN_CONFIG.radius,
            maxCount: DEFAULT_SPAWN_CONFIG.maxCount,
            respawnTime: DEFAULT_SPAWN_CONFIG.respawnTime,
            source: 'biome'
        });
    }

    return spawnPoints;
}

/**
 * Generate landmark-specific spawn points
 */
function generateLandmarkSpawnPoints(terrainProvider, chunkX, chunkZ, landmarkSystem, hashFn) {
    const spawnPoints = [];

    // Get landmarks affecting this chunk
    const landmarks = landmarkSystem.getLandmarksForChunk(chunkX, chunkZ);
    if (!landmarks || landmarks.length === 0) return spawnPoints;

    for (const landmark of landmarks) {
        const config = LANDMARK_SPAWN_CONFIG[landmark.type];
        if (!config) continue;

        // Get spawn points from landmark metadata
        const landmarkSpawnPositions = landmark.metadata?.mobSpawnPoints || [];

        // Also generate additional spawn points around landmarks without predefined positions
        const positions = landmarkSpawnPositions.length > 0
            ? landmarkSpawnPositions
            : generateLandmarkPositions(landmark, hashFn);

        for (let i = 0; i < positions.length; i++) {
            const pos = positions[i];

            // Get correct Y height if not provided
            const y = pos.y !== undefined
                ? pos.y + 1
                : terrainProvider.getHeight(pos.x, pos.z) + 1;

            // Pick a specific mob type for this position
            const mobHash = hashFn(
                Math.floor(pos.x) * 73856093,
                Math.floor(pos.z) * 19349663,
                i * 83847
            );
            const mobIndex = mobHash % config.mobTypes.length;
            const mobType = config.mobTypes[mobIndex];

            // Get biome for reference
            const biome = terrainProvider.getBiome(pos.x, pos.z);

            spawnPoints.push({
                x: pos.x,
                y: y,
                z: pos.z,
                type: 'mob',
                subtype: mobType,  // Specific mob type for landmarks
                biome: biome,
                radius: config.radius,
                maxCount: config.maxCount,
                respawnTime: config.respawnTime,
                source: 'landmark',
                landmarkType: landmark.type
            });
        }
    }

    return spawnPoints;
}

/**
 * Generate spawn positions around a landmark that doesn't have predefined positions
 */
function generateLandmarkPositions(landmark, hashFn) {
    const positions = [];
    const numPositions = 2;  // Generate 2 spawn points around the landmark

    const centerX = landmark.centerX;
    const centerZ = landmark.centerZ;
    const baseY = landmark.baseY;

    // Generate positions in a circle around the landmark
    const radius = 8;  // Distance from center

    for (let i = 0; i < numPositions; i++) {
        const angleHash = hashFn(
            Math.floor(centerX) * 12345,
            Math.floor(centerZ) * 67890,
            i * 33333
        );
        const angle = (angleHash % 360) * (Math.PI / 180);

        const x = centerX + Math.cos(angle) * radius;
        const z = centerZ + Math.sin(angle) * radius;

        positions.push({
            x: Math.floor(x) + 0.5,
            y: baseY,  // Will be adjusted to terrain height
            z: Math.floor(z) + 0.5
        });
    }

    return positions;
}
