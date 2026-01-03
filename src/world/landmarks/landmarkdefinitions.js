/**
 * Landmark Definitions - Procedural generation functions for each landmark type
 * 
 * This module is used by the web worker and must be pure functions with no
 * external dependencies (no Three.js, no DOM, etc.)
 * 
 * Each landmark type has:
 * - Configuration (size, materials, spawn rules)
 * - Generator function (creates blocks, chambers, metadata)
 */

/**
 * Landmark type configurations
 */
export const LANDMARK_TYPES = {
    mayanTemple: {
        name: 'Mayan Temple',
        biomes: ['jungle', 'plains', 'mountains'],
        rarity: 0.5,
        minHeight: 8,
        maxHeight: 25,
        baseSize: 17,
        tiers: 4,
        tierHeight: 3,
        chamberSize: 5,
        stairWidth: 3,
        blockType: 'mayan_stone',
        stairBlockType: 'stone',
        generator: generateMayanTemple
    }
};

/**
 * Get a landmark definition by type
 */
export function getLandmarkDefinition(type) {
    return LANDMARK_TYPES[type];
}

/**
 * Get all landmark types that can spawn in a biome
 */
export function getLandmarkTypesForBiome(biome) {
    return Object.entries(LANDMARK_TYPES)
        .filter(([_, config]) => config.biomes.includes(biome))
        .map(([type, _]) => type);
}

/**
 * Direction vectors for cardinal directions
 */
const DIRECTION_VECTORS = {
    '+X': { dx: 1, dz: 0 },
    '-X': { dx: -1, dz: 0 },
    '+Z': { dx: 0, dz: 1 },
    '-Z': { dx: 0, dz: -1 }
};

/**
 * Generate a landmark structure
 */
export function generateLandmarkStructure(typeName, config, centerX, baseY, centerZ, hashFn, gridX, gridZ, entranceDirection) {
    if (config.generator) {
        return config.generator(config, centerX, baseY, centerZ, hashFn, gridX, gridZ, entranceDirection);
    }
    return null;
}

/**
 * Generate a Mayan stepped pyramid with interior chamber and single entrance
 */
function generateMayanTemple(config, centerX, baseY, centerZ, hashFn, gridX, gridZ, entranceDirection = '+Z') {
    const blocks = new Map();
    const chambers = [];
    
    const { baseSize, tiers, tierHeight, chamberSize, blockType, stairBlockType } = config;
    const tierShrink = 2;
    const halfBase = Math.floor(baseSize / 2);
    const halfChamber = Math.floor(chamberSize / 2);
    
    const dir = DIRECTION_VECTORS[entranceDirection];
    const topY = baseY + tiers * tierHeight;
    const chamberY = baseY + 1;
    const chamberHeight = tierHeight * 2;
    const entranceHeight = 3;
    const halfEntrance = 1;
    
    // Generate solid tiers
    for (let tier = 0; tier < tiers; tier++) {
        const tierY = baseY + tier * tierHeight;
        const shrink = tier * tierShrink;
        const halfSize = halfBase - Math.floor(shrink / 2);
        
        for (let y = tierY; y < tierY + tierHeight; y++) {
            for (let x = centerX - halfSize; x <= centerX + halfSize; x++) {
                for (let z = centerZ - halfSize; z <= centerZ + halfSize; z++) {
                    blocks.set(`${x},${y},${z}`, blockType);
                }
            }
        }
    }
    
    // Carve interior chamber
    for (let y = chamberY; y < chamberY + chamberHeight; y++) {
        for (let x = centerX - halfChamber; x <= centerX + halfChamber; x++) {
            for (let z = centerZ - halfChamber; z <= centerZ + halfChamber; z++) {
                blocks.delete(`${x},${y},${z}`);
            }
        }
    }
    
    // Add chamber to list
    chambers.push({
        minX: centerX - halfChamber,
        maxX: centerX + halfChamber + 1,
        minY: chamberY,
        maxY: chamberY + chamberHeight,
        minZ: centerZ - halfChamber,
        maxZ: centerZ + halfChamber + 1
    });
    
    // Carve entrance tunnel
    const entranceBounds = calculateEntranceBounds(
        centerX, centerZ, chamberY, halfChamber, halfBase, halfEntrance, entranceHeight, dir
    );
    
    for (let y = entranceBounds.minY; y < entranceBounds.maxY; y++) {
        for (let x = entranceBounds.minX; x < entranceBounds.maxX; x++) {
            for (let z = entranceBounds.minZ; z < entranceBounds.maxZ; z++) {
                blocks.delete(`${x},${y},${z}`);
            }
        }
    }
    
    // Add entrance tunnel to chambers
    chambers.push(entranceBounds);
    
    // Shrine altar in center
    const shrineX = centerX;
    const shrineZ = centerZ;
    blocks.set(`${shrineX},${chamberY},${shrineZ}`, blockType);
    blocks.set(`${shrineX},${chamberY + 1},${shrineZ}`, blockType);
    
    // Corner pillars (skip if blocking entrance)
    const pillarInset = halfChamber - 1;
    const pillarPositions = [
        [centerX - pillarInset, centerZ - pillarInset],
        [centerX + pillarInset, centerZ - pillarInset],
        [centerX - pillarInset, centerZ + pillarInset],
        [centerX + pillarInset, centerZ + pillarInset]
    ];
    
    for (const [px, pz] of pillarPositions) {
        if (wouldBlockEntrance(px, pz, centerX, centerZ, halfEntrance, dir)) {
            continue;
        }
        
        for (let py = chamberY; py < chamberY + chamberHeight - 1; py++) {
            blocks.set(`${px},${py},${pz}`, blockType);
        }
    }
    
    // Entrance frame
    generateEntranceFrame(blocks, centerX, centerZ, chamberY, halfBase, halfEntrance, entranceHeight, stairBlockType || 'stone', dir);
    
    // Steep stairs on non-entrance sides
    generateSteepStairs(blocks, centerX, centerZ, baseY, baseSize, tiers, tierHeight, tierShrink, stairBlockType, entranceDirection);
    
    // Calculate bounds
    const bounds = calculateBounds(centerX, centerZ, baseY, topY, halfBase, dir);
    
    // Mob spawn points
    const spawnOffset = halfBase + 5;
    const mobSpawnPoints = [
        { x: centerX + spawnOffset, y: baseY, z: centerZ },
        { x: centerX - spawnOffset, y: baseY, z: centerZ },
        { x: centerX, y: baseY, z: centerZ + spawnOffset },
        { x: centerX, y: baseY, z: centerZ - spawnOffset }
    ];
    
    return {
        type: 'mayanTemple',
        centerX,
        centerZ,
        baseY,
        blocks,
        chambers,
        bounds,
        metadata: {
            shrinePosition: { x: shrineX, y: chamberY + 2, z: shrineZ },
            mobSpawnPoints,
            topY,
            entranceDirection
        }
    };
}

function calculateEntranceBounds(centerX, centerZ, chamberY, halfChamber, halfBase, halfEntrance, entranceHeight, dir) {
    if (dir.dx !== 0) {
        const startX = dir.dx > 0 ? centerX + halfChamber : centerX - halfBase - 1;
        const endX = dir.dx > 0 ? centerX + halfBase + 2 : centerX - halfChamber + 1;
        return {
            minX: Math.min(startX, endX),
            maxX: Math.max(startX, endX),
            minY: chamberY,
            maxY: chamberY + entranceHeight,
            minZ: centerZ - halfEntrance,
            maxZ: centerZ + halfEntrance + 1
        };
    } else {
        const startZ = dir.dz > 0 ? centerZ + halfChamber : centerZ - halfBase - 1;
        const endZ = dir.dz > 0 ? centerZ + halfBase + 2 : centerZ - halfChamber + 1;
        return {
            minX: centerX - halfEntrance,
            maxX: centerX + halfEntrance + 1,
            minY: chamberY,
            maxY: chamberY + entranceHeight,
            minZ: Math.min(startZ, endZ),
            maxZ: Math.max(startZ, endZ)
        };
    }
}

function wouldBlockEntrance(px, pz, centerX, centerZ, halfEntrance, dir) {
    if (dir.dx > 0 && px > centerX && Math.abs(pz - centerZ) <= halfEntrance) return true;
    if (dir.dx < 0 && px < centerX && Math.abs(pz - centerZ) <= halfEntrance) return true;
    if (dir.dz > 0 && pz > centerZ && Math.abs(px - centerX) <= halfEntrance) return true;
    if (dir.dz < 0 && pz < centerZ && Math.abs(px - centerX) <= halfEntrance) return true;
    return false;
}

function generateEntranceFrame(blocks, centerX, centerZ, chamberY, halfBase, halfEntrance, entranceHeight, blockType, dir) {
    const offset = halfBase + 1;
    
    if (dir.dz !== 0) {
        const entranceZ = centerZ + dir.dz * offset;
        
        for (let dx = -halfEntrance - 1; dx <= halfEntrance + 1; dx++) {
            const x = centerX + dx;
            if (Math.abs(dx) === halfEntrance + 1) {
                for (let dy = 0; dy < entranceHeight + 1; dy++) {
                    blocks.set(`${x},${chamberY + dy},${entranceZ}`, blockType);
                }
            }
            blocks.set(`${x},${chamberY + entranceHeight},${entranceZ}`, blockType);
        }
    } else {
        const entranceX = centerX + dir.dx * offset;
        
        for (let dz = -halfEntrance - 1; dz <= halfEntrance + 1; dz++) {
            const z = centerZ + dz;
            if (Math.abs(dz) === halfEntrance + 1) {
                for (let dy = 0; dy < entranceHeight + 1; dy++) {
                    blocks.set(`${entranceX},${chamberY + dy},${z}`, blockType);
                }
            }
            blocks.set(`${entranceX},${chamberY + entranceHeight},${z}`, blockType);
        }
    }
}

function generateSteepStairs(blocks, centerX, centerZ, baseY, baseSize, tiers, tierHeight, tierShrink, stairBlockType, entranceDirection) {
    const stairWidth = 3;
    const halfStair = Math.floor(stairWidth / 2);
    const halfBase = Math.floor(baseSize / 2);
    const totalHeight = tiers * tierHeight;
    
    const allDirections = [
        { name: '+X', dx: 1, dz: 0 },
        { name: '-X', dx: -1, dz: 0 },
        { name: '+Z', dx: 0, dz: 1 },
        { name: '-Z', dx: 0, dz: -1 }
    ];
    
    for (const stairDir of allDirections) {
        if (stairDir.name === entranceDirection) {
            continue;
        }
        
        const numSteps = Math.ceil(totalHeight / 2);
        
        for (let step = 0; step < numSteps; step++) {
            const stepY = baseY + step * 2;
            const distFromCenter = halfBase + 1 - step;
            const topHalfSize = Math.floor((baseSize - tiers * tierShrink) / 2);
            
            if (distFromCenter < topHalfSize) {
                break;
            }
            
            for (let w = -halfStair; w <= halfStair; w++) {
                let x, z;
                
                if (stairDir.dx !== 0) {
                    x = centerX + stairDir.dx * distFromCenter;
                    z = centerZ + w;
                } else {
                    x = centerX + w;
                    z = centerZ + stairDir.dz * distFromCenter;
                }
                
                blocks.set(`${x},${stepY},${z}`, stairBlockType);
                if (stepY + 1 < baseY + totalHeight) {
                    blocks.set(`${x},${stepY + 1},${z}`, stairBlockType);
                }
            }
        }
        
        // Ground-level landing
        for (let ext = 2; ext <= 3; ext++) {
            for (let w = -halfStair; w <= halfStair; w++) {
                let x, z;
                
                if (stairDir.dx !== 0) {
                    x = centerX + stairDir.dx * (halfBase + ext);
                    z = centerZ + w;
                } else {
                    x = centerX + w;
                    z = centerZ + stairDir.dz * (halfBase + ext);
                }
                
                blocks.set(`${x},${baseY},${z}`, stairBlockType);
            }
        }
    }
}

function calculateBounds(centerX, centerZ, baseY, topY, halfBase, dir) {
    const stairExtension = 3;
    return {
        minX: centerX - halfBase - stairExtension,
        maxX: centerX + halfBase + stairExtension,
        minY: baseY,
        maxY: topY,
        minZ: centerZ - halfBase - stairExtension,
        maxZ: centerZ + halfBase + stairExtension
    };
}