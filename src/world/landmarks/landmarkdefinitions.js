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
 * Generate a Mayan stepped pyramid with interior chamber and single entrance
 * 
 * Structure:
 * - 4-tier stepped pyramid (solid, no external stairs)
 * - Single entrance on south side leading to chamber
 * - Central chamber with altar and corner pillars
 * - Solid roof
 * 
 * @returns {Object} Landmark data
 */
function generateMayanTemple(config, centerX, baseY, centerZ, hashFn, gridX, gridZ) {
    const blocks = new Map();
    const chambers = [];
    
    const { baseSize, tiers, tierHeight, chamberSize, blockType } = config;
    
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
    
    // Entrance tunnel (south side, +Z direction, at ground level)
    // Tunnel is 3 blocks wide, 3 blocks tall, extends from chamber to pyramid edge
    const entranceWidth = 3;
    const entranceHeight = 3;
    const halfEntrance = Math.floor(entranceWidth / 2);
    
    const entrance = {
        minX: centerX - halfEntrance,
        maxX: centerX + halfEntrance + 1,
        minY: chamberY,
        maxY: chamberY + entranceHeight,
        minZ: centerZ + halfChamber,  // Starts at chamber edge
        maxZ: centerZ + halfBase + 2   // Extends past pyramid base
    };
    
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
        // Skip pillars that would block entrance (south side, +Z)
        if (pz > centerZ && Math.abs(px - centerX) <= halfEntrance) {
            continue;
        }
        
        for (let py = chamberY; py < chamberY + chamberHeight - 1; py++) {
            blocks.set(`${px},${py},${pz}`, blockType);
        }
    }
    
    // Entrance frame (decorative archway at tunnel exit)
    const entranceZ = centerZ + halfBase + 1;
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
    
    console.log(centerX);
    console.log(`Mayan temple at (${centerX}, ${baseY}, ${centerZ}): ${blocks.size} blocks generated`);
    
    // Calculate overall bounds
    const bounds = {
        minX: centerX - halfBase - 1,
        maxX: centerX + halfBase + 1,
        minY: baseY,
        maxY: topY + 1,
        minZ: centerZ - halfBase - 1,
        maxZ: centerZ + halfBase + 2  // Extra for entrance
    };
    
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
            entranceDirection: '+Z'
        }
    };
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
 * @param {number} centerX - World X center
 * @param {number} baseY - Base Y (terrain height)
 * @param {number} centerZ - World Z center
 * @param {function} hashFn - Hash function for deterministic randomness
 * @param {number} gridX - Grid cell X (for variation)
 * @param {number} gridZ - Grid cell Z (for variation)
 * @returns {Object} Generated landmark data
 */
export function generateLandmarkStructure(type, config, centerX, baseY, centerZ, hashFn, gridX, gridZ) {
    // const config = LANDMARK_TYPES[type];
    if (!config || !config.generator) {
        console.error(`Unknown landmark type: ${type}`);
        return null;
    }
    return config.generator(config, centerX, baseY, centerZ, hashFn, gridX, gridZ);
}