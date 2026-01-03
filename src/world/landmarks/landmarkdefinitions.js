/**
 * Landmark Definitions - Procedural generation functions for each landmark type
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
        biomes: ['jungle', 'plains', 'mountains'],  // plains for testing
        rarity: 0.5,  // High for testing
        minHeight: 8,
        maxHeight: 25,
        baseSize: 17,
        tiers: 4,
        tierHeight: 3,
        chamberSize: 5,
        stairWidth: 3,
        blockType: 'mayan_stone',
        stairBlockType: 'stone',  // Different texture for steep stairs
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
 * Generate a Mayan stepped pyramid with interior chamber and single entrance
 * 
 * Structure:
 * - 4-tier stepped pyramid (solid, no external stairs)
 * - Single entrance on one side (random direction) leading to chamber
 * - Steep stairs (2-block steps) on other three sides, using stone texture
 * - Central chamber with altar and corner pillars
 * - Solid roof
 * 
 * @returns {Object} Landmark data
 */
function generateMayanTemple(config, centerX, baseY, centerZ, hashFn, gridX, gridZ, entranceDirection = '+Z') {
    const blocks = new Map();
    const chambers = [];
    
    const { baseSize, tiers, tierHeight, chamberSize, blockType, stairBlockType } = config;
    
    // Calculate tier dimensions
    const tierShrink = Math.floor((baseSize - 5) / tiers);
    const halfBase = Math.floor(baseSize / 2);
    
    // Chamber position (centered, starting at ground level)
    const chamberY = baseY;
    const halfChamber = Math.floor(chamberSize / 2);
    const chamberHeight = chamberSize + 2; // Chamber height including ceiling clearance
    
    const chamber = {
        minX: centerX - halfChamber,
        maxX: centerX + halfChamber + 1,
        minY: chamberY,
        maxY: chamberY + chamberHeight,
        minZ: centerZ - halfChamber,
        maxZ: centerZ + halfChamber + 1
    };
    chambers.push(chamber);
    
    // Entrance tunnel parameters - tall enough for mounted hero
    const entranceWidth = 3;
    const entranceHeight = 5;  // Increased from 3/4 to 5 for mounted hero
    const halfEntrance = Math.floor(entranceWidth / 2);
    
    // Get entrance direction vector
    const dir = DIRECTION_VECTORS[entranceDirection];
    
    // Calculate entrance tunnel bounds based on direction
    const entrance = calculateEntranceBounds(
        centerX, centerZ, chamberY, halfChamber, halfBase,
        halfEntrance, entranceHeight, dir
    );
    
    // Generate each tier (solid stepped pyramid)
    for (let tier = 0; tier < tiers; tier++) {
        const tierWidth = baseSize - tier * tierShrink;
        const halfWidth = Math.floor(tierWidth / 2);
        const tierBaseY = baseY + tier * tierHeight;
        
        // Generate solid blocks for this tier
        for (let dy = 0; dy < tierHeight; dy++) {
            const y = tierBaseY + dy;
            
            for (let dx = -halfWidth; dx <= halfWidth; dx++) {
                for (let dz = -halfWidth; dz <= halfWidth; dz++) {
                    const x = centerX + dx;
                    const z = centerZ + dz;
                    
                    // Skip if inside chamber
                    if (isInsideVolume(x, y, z, chamber)) {
                        continue;
                    }
                    
                    // Skip if inside entrance tunnel
                    if (isInsideVolume(x, y, z, entrance)) {
                        continue;
                    }
                    
                    blocks.set(`${x},${y},${z}`, blockType);
                }
            }
        }
    }
    
    // Top platform (solid roof)
    const topY = baseY + tiers * tierHeight;
    const topWidth = baseSize - tiers * tierShrink;
    const halfTop = Math.floor(topWidth / 2);
    
    for (let dx = -halfTop; dx <= halfTop; dx++) {
        for (let dz = -halfTop; dz <= halfTop; dz++) {
            const x = centerX + dx;
            const z = centerZ + dz;
            blocks.set(`${x},${topY},${z}`, blockType);
        }
    }
    
    // Generate steep stairs on non-entrance sides (using stone texture)
    generateSteepStairs(blocks, centerX, centerZ, baseY, baseSize, tiers, tierHeight, tierShrink, stairBlockType || 'stone', entranceDirection);
    
    // Shrine platform in center of chamber (altar)
    const shrineX = centerX;
    const shrineZ = centerZ;
    
    // Small 3x3 raised platform
    for (let dx = -1; dx <= 1; dx++) {
        for (let dz = -1; dz <= 1; dz++) {
            blocks.set(`${shrineX + dx},${chamberY},${shrineZ + dz}`, blockType);
        }
    }
    // Center pillar (altar itself)
    blocks.set(`${shrineX},${chamberY + 1},${shrineZ}`, blockType);
    
    // Corner pillars inside chamber
    const pillarInset = halfChamber - 1;
    const pillarPositions = [
        [centerX - pillarInset, centerZ - pillarInset],
        [centerX + pillarInset, centerZ - pillarInset],
        [centerX - pillarInset, centerZ + pillarInset],
        [centerX + pillarInset, centerZ + pillarInset]
    ];
    
    for (const [px, pz] of pillarPositions) {
        // Skip pillars that would block entrance
        if (wouldBlockEntrance(px, pz, centerX, centerZ, halfEntrance, dir)) {
            continue;
        }
        
        for (let py = chamberY; py < chamberY + chamberHeight - 1; py++) {
            blocks.set(`${px},${py},${pz}`, blockType);
        }
    }
    
    // Entrance frame (decorative archway at tunnel exit) - uses stone like stairs
    generateEntranceFrame(blocks, centerX, centerZ, chamberY, halfBase, halfEntrance, entranceHeight, stairBlockType || 'stone', dir);
    
    console.log(`Mayan temple at (${centerX}, ${baseY}, ${centerZ}): ${blocks.size} blocks, entrance: ${entranceDirection}`);
    
    // Calculate overall bounds (with margin for entrance and stairs)
    const bounds = calculateBounds(centerX, centerZ, baseY, topY, halfBase, dir);
    
    // Mob spawn points around the temple base
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

/**
 * Calculate entrance tunnel bounds based on direction
 */
function calculateEntranceBounds(centerX, centerZ, chamberY, halfChamber, halfBase, halfEntrance, entranceHeight, dir) {
    if (dir.dx !== 0) {
        // East (+X) or West (-X) entrance
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
        // South (+Z) or North (-Z) entrance
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

/**
 * Check if a pillar position would block the entrance
 */
function wouldBlockEntrance(px, pz, centerX, centerZ, halfEntrance, dir) {
    if (dir.dx > 0 && px > centerX && Math.abs(pz - centerZ) <= halfEntrance) return true;
    if (dir.dx < 0 && px < centerX && Math.abs(pz - centerZ) <= halfEntrance) return true;
    if (dir.dz > 0 && pz > centerZ && Math.abs(px - centerX) <= halfEntrance) return true;
    if (dir.dz < 0 && pz < centerZ && Math.abs(px - centerX) <= halfEntrance) return true;
    return false;
}

/**
 * Generate decorative entrance frame/archway
 */
function generateEntranceFrame(blocks, centerX, centerZ, chamberY, halfBase, halfEntrance, entranceHeight, blockType, dir) {
    // Position at pyramid edge in entrance direction
    const offset = halfBase + 1;
    
    if (dir.dz !== 0) {
        // North/South entrance
        const entranceZ = centerZ + dir.dz * offset;
        
        for (let dx = -halfEntrance - 1; dx <= halfEntrance + 1; dx++) {
            const x = centerX + dx;
            // Side pillars
            if (Math.abs(dx) === halfEntrance + 1) {
                for (let dy = 0; dy < entranceHeight + 1; dy++) {
                    blocks.set(`${x},${chamberY + dy},${entranceZ}`, blockType);
                }
            }
            // Top lintel
            blocks.set(`${x},${chamberY + entranceHeight},${entranceZ}`, blockType);
        }
    } else {
        // East/West entrance
        const entranceX = centerX + dir.dx * offset;
        
        for (let dz = -halfEntrance - 1; dz <= halfEntrance + 1; dz++) {
            const z = centerZ + dz;
            // Side pillars
            if (Math.abs(dz) === halfEntrance + 1) {
                for (let dy = 0; dy < entranceHeight + 1; dy++) {
                    blocks.set(`${entranceX},${chamberY + dy},${z}`, blockType);
                }
            }
            // Top lintel
            blocks.set(`${entranceX},${chamberY + entranceHeight},${z}`, blockType);
        }
    }
}

/**
 * Generate steep stairs (2-block steps) on non-entrance sides
 * Stairs protrude OUTSIDE the pyramid footprint
 */
function generateSteepStairs(blocks, centerX, centerZ, baseY, baseSize, tiers, tierHeight, tierShrink, stairBlockType, entranceDirection) {
    const stairWidth = 3;
    const halfStair = Math.floor(stairWidth / 2);
    const halfBase = Math.floor(baseSize / 2);
    const totalHeight = tiers * tierHeight;
    
    // All four cardinal directions
    const allDirections = [
        { name: '+X', dx: 1, dz: 0 },
        { name: '-X', dx: -1, dz: 0 },
        { name: '+Z', dx: 0, dz: 1 },
        { name: '-Z', dx: 0, dz: -1 }
    ];
    
    // Generate stairs on non-entrance sides
    for (const stairDir of allDirections) {
        if (stairDir.name === entranceDirection) {
            continue;  // Skip entrance side - it has the tunnel
        }
        
        // Stairs protrude 1-2 blocks outside the pyramid base
        // Each step: 1 block horizontal, 2 blocks vertical rise
        // Stairs go from ground level up to near the top
        
        const numSteps = Math.ceil(totalHeight / 2);  // 2-block rise per step
        
        for (let step = 0; step < numSteps; step++) {
            const stepY = baseY + step * 2;  // Each step rises 2 blocks
            
            // Stairs stick out from pyramid edge
            // Step 0 is at halfBase + 1 (just outside base)
            // Higher steps are closer to pyramid (step inward as you climb)
            const distFromCenter = halfBase + 1 - step;
            
            // Stop if we've gone past the top tier edge
            const topHalfSize = Math.floor((baseSize - tiers * tierShrink) / 2);
            if (distFromCenter < topHalfSize) {
                break;
            }
            
            // Place stair blocks across the width
            for (let w = -halfStair; w <= halfStair; w++) {
                let x, z;
                
                if (stairDir.dx !== 0) {
                    // East-West stairs
                    x = centerX + stairDir.dx * distFromCenter;
                    z = centerZ + w;
                } else {
                    // North-South stairs
                    x = centerX + w;
                    z = centerZ + stairDir.dz * distFromCenter;
                }
                
                // Place two blocks vertically for the steep step
                blocks.set(`${x},${stepY},${z}`, stairBlockType);
                if (stepY + 1 < baseY + totalHeight) {
                    blocks.set(`${x},${stepY + 1},${z}`, stairBlockType);
                }
            }
        }
        
        // Add landing/approach at ground level extending further outward
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

/**
 * Calculate overall bounds with margin for entrance and stairs
 */
function calculateBounds(centerX, centerZ, baseY, topY, halfBase, dir) {
    // Base bounds include stair protrusions on all sides
    const stairProtrusion = 3;
    const bounds = {
        minX: centerX - halfBase - stairProtrusion,
        maxX: centerX + halfBase + stairProtrusion,
        minY: baseY,
        maxY: topY + 1,
        minZ: centerZ - halfBase - stairProtrusion,
        maxZ: centerZ + halfBase + stairProtrusion
    };
    
    return bounds;
}

/**
 * Check if a position is inside a volume
 */
function isInsideVolume(x, y, z, volume) {
    return x >= volume.minX && x < volume.maxX &&
           y >= volume.minY && y < volume.maxY &&
           z >= volume.minZ && z < volume.maxZ;
}

/**
 * Generate a landmark structure by type
 * Main entry point called by LandmarkSystem
 * 
 * @param {string} type - Landmark type name
 * @param {Object} config - Landmark configuration
 * @param {number} centerX - World X center
 * @param {number} baseY - Base Y (terrain height)
 * @param {number} centerZ - World Z center
 * @param {function} hashFn - Hash function for deterministic randomness
 * @param {number} gridX - Grid cell X (for variation)
 * @param {number} gridZ - Grid cell Z (for variation)
 * @param {string} entranceDirection - Cardinal direction for entrance (+X, -X, +Z, -Z)
 * @returns {Object} Generated landmark data
 */
export function generateLandmarkStructure(type, config, centerX, baseY, centerZ, hashFn, gridX, gridZ, entranceDirection) {
    if (!config || !config.generator) {
        console.error(`Unknown landmark type: ${type}`);
        return null;
    }
    return config.generator(config, centerX, baseY, centerZ, hashFn, gridX, gridZ, entranceDirection);
}