/**
 * Landmark Definitions - Procedural generation functions for each landmark type
 * 
 * This module is used by the web worker and must be pure functions with no
 * external dependencies (no Three.js, no DOM, etc.)
 * 
 * Uses the voxel primitives library for clean, composable structure generation.
 * 
 * The worker generates voxel data which is transferred to the main thread.
 * Collision is determined by the voxels themselves - no separate tracking needed.
 */

import { 
    VoxelVolume, 
    VoxelState,
    fillBox, 
    carveBox,
    stairs,
    pillar
} from '../voxel/index.js';

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
 * 
 * Structure:
 * - 4-tier stepped pyramid
 * - Hollow interior chamber with shrine altar
 * - Corner pillars inside chamber
 * - Single entrance with decorative frame
 * - Steep stairs on three non-entrance sides
 */
function generateMayanTemple(config, centerX, baseY, centerZ, hashFn, gridX, gridZ, entranceDirection = '+Z') {
    const volume = new VoxelVolume();
    
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
    const stairWidth = config.stairWidth || 3;
    
    // =========================================================================
    // STEP 1: Generate solid stepped pyramid tiers
    // =========================================================================
    for (let tier = 0; tier < tiers; tier++) {
        const tierY = baseY + tier * tierHeight;
        const shrink = tier * tierShrink;
        const halfSize = halfBase - Math.floor(shrink / 2);
        
        fillBox(
            volume,
            centerX - halfSize, tierY, centerZ - halfSize,
            centerX + halfSize + 1, tierY + tierHeight, centerZ + halfSize + 1,
            blockType, VoxelState.SOLID
        );
    }
    
    // =========================================================================
    // STEP 1b: Add temple hut on top of pyramid
    // =========================================================================
    // Calculate top tier size (1 block inset from top tier edge)
    const topTierHalfSize = halfBase - Math.floor((tiers - 1) * tierShrink / 2);
    const hutInset = 1;
    const hutHalfSize = topTierHalfSize - hutInset;
    const hutHeight = 3;
    const hutY = topY;  // Sits on top of pyramid
    const hutDoorWidth = 1;  // 1-block wide doorways
    
    // Solid hut walls (using stairBlockType for contrast)
    fillBox(
        volume,
        centerX - hutHalfSize, hutY, centerZ - hutHalfSize,
        centerX + hutHalfSize + 1, hutY + hutHeight, centerZ + hutHalfSize + 1,
        stairBlockType, VoxelState.SOLID
    );
    
    // Carve hollow interior (1-block thick walls)
    carveBox(
        volume,
        centerX - hutHalfSize + 1, hutY, centerZ - hutHalfSize + 1,
        centerX + hutHalfSize, hutY + hutHeight - 1, centerZ + hutHalfSize
    );
    
    // Carve doorways on three sides (not the entrance side of pyramid)
    const hutDoorHeight = 2;
    const allDirs = ['+X', '-X', '+Z', '-Z'];
    
    for (const doorDir of allDirs) {
        if (doorDir === entranceDirection) {
            continue;  // No door on entrance side (that's where you came up the stairs)
        }
        
        const d = DIRECTION_VECTORS[doorDir];
        const doorDist = hutHalfSize;  // Door is in the wall
        
        // Carve door opening
        for (let dy = 0; dy < hutDoorHeight; dy++) {
            for (let dw = -hutDoorWidth; dw <= hutDoorWidth; dw++) {
                const x = d.dx !== 0 ? centerX + d.dx * doorDist : centerX + dw;
                const z = d.dz !== 0 ? centerZ + d.dz * doorDist : centerZ + dw;
                volume.carve(x, hutY + dy, z);
            }
        }
    }
    
    // =========================================================================
    // STEP 2: Carve interior chamber (forced air - always hollow)
    // =========================================================================
    carveBox(
        volume,
        centerX - halfChamber, chamberY, centerZ - halfChamber,
        centerX + halfChamber + 1, chamberY + chamberHeight, centerZ + halfChamber + 1
    );
    
    // =========================================================================
    // STEP 3: Carve entrance tunnel
    // =========================================================================
    const tunnelLength = halfBase - halfChamber + 2;
    
    for (let i = 0; i < tunnelLength; i++) {
        const tx = dir.dx !== 0 ? centerX + dir.dx * (halfChamber + i) : centerX;
        const tz = dir.dz !== 0 ? centerZ + dir.dz * (halfChamber + i) : centerZ;
        
        for (let dy = 0; dy < entranceHeight; dy++) {
            for (let dw = -halfEntrance; dw <= halfEntrance; dw++) {
                const x = dir.dx !== 0 ? tx : tx + dw;
                const z = dir.dz !== 0 ? tz : tz + dw;
                volume.carve(x, chamberY + dy, z);
            }
        }
    }
    
    // =========================================================================
    // STEP 4: Add shrine altar in center of chamber
    // =========================================================================
    // Base platform (3x3)
    fillBox(
        volume,
        centerX - 1, chamberY, centerZ - 1,
        centerX + 2, chamberY + 1, centerZ + 2,
        blockType, VoxelState.SOLID
    );
    
    // Altar pillar on top
    pillar(volume, centerX, chamberY + 1, centerZ, 2, blockType, {
        state: VoxelState.SOLID
    });
    
    // =========================================================================
    // STEP 5: Add corner pillars inside chamber
    // =========================================================================
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
        
        pillar(volume, px, chamberY, pz, chamberHeight, blockType, {
            state: VoxelState.SOLID
        });
    }
    
    // =========================================================================
    // STEP 6: Add entrance tunnel with walls and ceiling
    // =========================================================================
    // The tunnel runs from chamber edge to pyramid exterior
    // We add walls on either side and a ceiling, framing the carved opening
    
    const tunnelStart = halfChamber + 1;  // Just outside chamber
    const tunnelEnd = halfBase + 1;       // Just outside pyramid
    
    if (dir.dz !== 0) {
        // North/South entrance - tunnel along Z axis
        for (let i = tunnelStart; i <= tunnelEnd; i++) {
            const tz = centerZ + dir.dz * i;
            
            // Left wall
            for (let dy = 0; dy < entranceHeight; dy++) {
                volume.set(centerX - halfEntrance - 1, chamberY + dy, tz, stairBlockType, VoxelState.SOLID);
            }
            
            // Right wall
            for (let dy = 0; dy < entranceHeight; dy++) {
                volume.set(centerX + halfEntrance + 1, chamberY + dy, tz, stairBlockType, VoxelState.SOLID);
            }
            
            // Ceiling
            for (let dx = -halfEntrance - 1; dx <= halfEntrance + 1; dx++) {
                volume.set(centerX + dx, chamberY + entranceHeight, tz, stairBlockType, VoxelState.SOLID);
            }
        }
    } else {
        // East/West entrance - tunnel along X axis
        for (let i = tunnelStart; i <= tunnelEnd; i++) {
            const tx = centerX + dir.dx * i;
            
            // Left wall (relative to tunnel direction)
            for (let dy = 0; dy < entranceHeight; dy++) {
                volume.set(tx, chamberY + dy, centerZ - halfEntrance - 1, stairBlockType, VoxelState.SOLID);
            }
            
            // Right wall
            for (let dy = 0; dy < entranceHeight; dy++) {
                volume.set(tx, chamberY + dy, centerZ + halfEntrance + 1, stairBlockType, VoxelState.SOLID);
            }
            
            // Ceiling
            for (let dz = -halfEntrance - 1; dz <= halfEntrance + 1; dz++) {
                volume.set(tx, chamberY + entranceHeight, centerZ + dz, stairBlockType, VoxelState.SOLID);
            }
        }
    }
    
    // =========================================================================
    // STEP 7: Add steep stairs on non-entrance sides
    // =========================================================================
    const topHalfSize = halfBase - Math.floor((tiers - 1) * tierShrink / 2);
    const totalHeight = tiers * tierHeight;
    const numSteps = Math.ceil(totalHeight / 2);
    const halfStair = Math.floor(stairWidth / 2);
    
    const allDirections = ['+X', '-X', '+Z', '-Z'];
    
    for (const stairDirName of allDirections) {
        if (stairDirName === entranceDirection) {
            continue;  // Skip entrance side
        }
        
        const stairDir = DIRECTION_VECTORS[stairDirName];
        
        // Stairs start at top tier edge + 1, descend outward
        const topStairDist = topHalfSize + 1;
        const startX = centerX + stairDir.dx * topStairDist;
        const startZ = centerZ + stairDir.dz * topStairDist;
        const startY = baseY + totalHeight - 2;
        
        // Use stairs primitive - descending outward from pyramid
        stairs(volume, startX, startY, startZ, stairDirName, numSteps, stairWidth, stairBlockType, {
            rise: -2,      // Descend 2 blocks per step (negative = going down)
            run: 1,        // Move 1 block outward per step
            fill: true,    // Fill underneath for support
            thickness: 2,  // 2-block tall steps for steep stairs
            state: VoxelState.SOLID
        });
        
        // Ground-level landing extends beyond stairs
        const landingStart = topStairDist + numSteps;
        
        for (let ext = 0; ext <= 3; ext++) {
            for (let w = -halfStair; w <= halfStair; w++) {
                const lx = stairDir.dx !== 0 ? centerX + stairDir.dx * (landingStart + ext) : centerX + w;
                const lz = stairDir.dz !== 0 ? centerZ + stairDir.dz * (landingStart + ext) : centerZ + w;
                volume.set(lx, baseY, lz, stairBlockType, VoxelState.SOLID);
            }
        }
    }
    
    // =========================================================================
    // STEP 8: Blend volume into final blocks map
    // =========================================================================
    const blocks = new Map();
    volume.blendIntoWorld(blocks, 0, 0, 0, null);
    
    // =========================================================================
    // Calculate bounds for spatial indexing (chunk queries only)
    // =========================================================================
    const stairExtension = numSteps + 4;
    const bounds = {
        minX: centerX - halfBase - stairExtension,
        maxX: centerX + halfBase + stairExtension,
        minY: baseY,
        maxY: topY + hutHeight,
        minZ: centerZ - halfBase - stairExtension,
        maxZ: centerZ + halfBase + stairExtension
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
        bounds,
        metadata: {
            shrinePosition: { x: centerX, y: chamberY + 2, z: centerZ },
            mobSpawnPoints,
            topY,
            entranceDirection
        }
    };
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