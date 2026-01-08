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
    carveBoxGradient,
    carveSphereRadialBrightness,
    fillSphere,
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
        rarity: 0.15,            // Rare landmark
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
    },

    forestHut: {
        name: 'Forest Hut',
        biomes: ['plains'],
        rarity: 0.25,              // Moderately common small structure
        minHeight: 8,
        maxHeight: 20,
        baseSize: 5,               // 5x5 footprint
        maxHeightVariance: 3,      // Max 3 block height diff across footprint
        maxSlopeMagnitude: 0.3,    // Max slope gradient for placement
        wallBlockType: 'stone',    // Placeholder for wood planks
        roofBlockType: 'mayan_stone', // Placeholder for thatch/shingles
        foundationBlockType: 'stone', // Cobblestone-style fill
        generator: generateForestHut
    },

    rockyOutcrop: {
        name: 'Rocky Outcrop',
        biomes: ['plains', 'mountains', 'desert', 'snow', 'jungle'],
        rarity: 1.0,               // DEBUG: Always spawn for testing
        minHeight: 1,              // DEBUG: Allow at any height
        maxHeight: 100,
        baseSize: 10,              // Max footprint size for spacing
        generator: generateRockyOutcrop
    }
    // missionCave: DISABLED - needs VoxelFrame API for proper terrain-relative placement
    // See summary in conversation for proposed API design
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
    
    // Carve hollow interior (1-block thick walls) - slightly darker than outside
    const hutBrightness = 0.6;  // Shaded but not dark
    carveBox(
        volume,
        centerX - hutHalfSize + 1, hutY, centerZ - hutHalfSize + 1,
        centerX + hutHalfSize, hutY + hutHeight - 1, centerZ + hutHalfSize,
        hutBrightness
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

        // Carve door opening (bright - open to outside)
        for (let dy = 0; dy < hutDoorHeight; dy++) {
            for (let dw = -hutDoorWidth; dw <= hutDoorWidth; dw++) {
                const x = d.dx !== 0 ? centerX + d.dx * doorDist : centerX + dw;
                const z = d.dz !== 0 ? centerZ + d.dz * doorDist : centerZ + dw;
                volume.carve(x, hutY + dy, z, 1.0);  // Doorways are bright
            }
        }
    }

    // =========================================================================
    // STEP 2: Carve interior chamber (forced air - always hollow, very dark)
    // =========================================================================
    const chamberBrightness = 0.1;  // Very dark interior
    carveBox(
        volume,
        centerX - halfChamber, chamberY, centerZ - halfChamber,
        centerX + halfChamber + 1, chamberY + chamberHeight, centerZ + halfChamber + 1,
        chamberBrightness
    );

    // =========================================================================
    // STEP 3: Carve entrance tunnel with gradient brightness (light→dark)
    // =========================================================================
    const tunnelLength = halfBase - halfChamber + 2;
    const entranceBrightness = 1.0;  // Bright at entrance

    // Calculate tunnel bounds based on entrance direction
    let tunnelMinX, tunnelMaxX, tunnelMinZ, tunnelMaxZ;
    const tunnelWidth = halfEntrance * 2 + 1;

    if (dir.dx !== 0) {
        // Tunnel runs along X axis
        if (dir.dx > 0) {
            tunnelMinX = centerX + halfChamber;
            tunnelMaxX = centerX + halfChamber + tunnelLength;
        } else {
            tunnelMinX = centerX - halfChamber - tunnelLength + 1;
            tunnelMaxX = centerX - halfChamber + 1;
        }
        tunnelMinZ = centerZ - halfEntrance;
        tunnelMaxZ = centerZ + halfEntrance + 1;

        // Gradient along X: entrance (far from center) to chamber (near center)
        if (dir.dx > 0) {
            // +X direction: entrance at maxX, chamber at minX
            carveBoxGradient(volume,
                tunnelMinX, chamberY, tunnelMinZ,
                tunnelMaxX, chamberY + entranceHeight, tunnelMaxZ,
                'x', chamberBrightness, entranceBrightness  // dark→bright as X increases
            );
        } else {
            // -X direction: entrance at minX, chamber at maxX
            carveBoxGradient(volume,
                tunnelMinX, chamberY, tunnelMinZ,
                tunnelMaxX, chamberY + entranceHeight, tunnelMaxZ,
                'x', entranceBrightness, chamberBrightness  // bright→dark as X increases
            );
        }
    } else {
        // Tunnel runs along Z axis
        if (dir.dz > 0) {
            tunnelMinZ = centerZ + halfChamber;
            tunnelMaxZ = centerZ + halfChamber + tunnelLength;
        } else {
            tunnelMinZ = centerZ - halfChamber - tunnelLength + 1;
            tunnelMaxZ = centerZ - halfChamber + 1;
        }
        tunnelMinX = centerX - halfEntrance;
        tunnelMaxX = centerX + halfEntrance + 1;

        // Gradient along Z: entrance (far from center) to chamber (near center)
        if (dir.dz > 0) {
            // +Z direction: entrance at maxZ, chamber at minZ
            carveBoxGradient(volume,
                tunnelMinX, chamberY, tunnelMinZ,
                tunnelMaxX, chamberY + entranceHeight, tunnelMaxZ,
                'z', chamberBrightness, entranceBrightness  // dark→bright as Z increases
            );
        } else {
            // -Z direction: entrance at minZ, chamber at maxZ
            carveBoxGradient(volume,
                tunnelMinX, chamberY, tunnelMinZ,
                tunnelMaxX, chamberY + entranceHeight, tunnelMaxZ,
                'z', entranceBrightness, chamberBrightness  // bright→dark as Z increases
            );
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
    // STEP 8: Blend volume into final blocks map (and capture brightness)
    // =========================================================================
    const blocks = new Map();
    const brightnessOverrides = volume.blendIntoWorld(blocks, 0, 0, 0, null);

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

    // Clearing zone for object suppression (trees, rocks, etc.)
    // Includes the temple bounds plus a margin
    const clearingMargin = 2;
    const clearings = [
        {
            type: 'rect',
            centerX,
            centerZ,
            width: (bounds.maxX - bounds.minX) + clearingMargin * 2,
            depth: (bounds.maxZ - bounds.minZ) + clearingMargin * 2,
            rotation: 0
        }
    ];

    return {
        type: 'mayanTemple',
        centerX,
        centerZ,
        baseY,
        blocks,
        brightnessOverrides,
        bounds,
        clearings,
        metadata: {
            shrinePosition: { x: centerX, y: chamberY + 2, z: centerZ },
            mobSpawnPoints,
            topY,
            entranceDirection
        }
    };
}

/**
 * Generate a Forest Hut - small wooden structure on flat terrain
 *
 * Structure:
 * - 5×5 footprint with foundation, floor, walls, and peaked roof
 * - Foundation fills Y=-2 to Y=-1 under structure
 * - Floor at Y=0 (5×5 solid)
 * - Walls Y=1 to Y=3 (hollow box with doorway)
 * - Roof Y=4 to Y=6 (stepped peak: 7×7, 7×3, 7×1)
 * - Door faces downslope direction
 *
 * Uses HeightfieldModifier for terrain flattening and ClearingRegistry for tree suppression.
 */
function generateForestHut(config, centerX, baseY, centerZ, hashFn, gridX, gridZ, entranceDirection = '+Z') {
    const volume = new VoxelVolume();

    const {
        wallBlockType,
        roofBlockType,
        foundationBlockType
    } = config;

    const dir = DIRECTION_VECTORS[entranceDirection];

    // Structure dimensions
    const halfFootprint = 2;        // 5×5 = ±2 from center
    const foundationDepth = 2;      // Y=-2 to Y=-1
    const wallHeight = 3;           // Y=1 to Y=3
    const doorHeight = 2;           // 2 blocks tall
    const interiorBrightness = 0.4; // Darker inside

    // =========================================================================
    // STEP 1: Foundation (Y = baseY - 2 to baseY - 1)
    // Fill 5×5 area with foundation blocks to ensure solid base
    // =========================================================================
    fillBox(
        volume,
        centerX - halfFootprint, baseY - foundationDepth, centerZ - halfFootprint,
        centerX + halfFootprint + 1, baseY, centerZ + halfFootprint + 1,
        foundationBlockType, VoxelState.SOLID
    );

    // =========================================================================
    // STEP 2: Floor (Y = baseY)
    // Solid 5×5 floor layer
    // =========================================================================
    fillBox(
        volume,
        centerX - halfFootprint, baseY, centerZ - halfFootprint,
        centerX + halfFootprint + 1, baseY + 1, centerZ + halfFootprint + 1,
        wallBlockType, VoxelState.SOLID
    );

    // =========================================================================
    // STEP 3: Walls (Y = baseY + 1 to baseY + wallHeight)
    // Solid 5×5 box, then carve interior for hollow structure
    // =========================================================================
    const wallBaseY = baseY + 1;

    // Solid walls
    fillBox(
        volume,
        centerX - halfFootprint, wallBaseY, centerZ - halfFootprint,
        centerX + halfFootprint + 1, wallBaseY + wallHeight, centerZ + halfFootprint + 1,
        wallBlockType, VoxelState.SOLID
    );

    // Carve interior (3×3 hollow space) - leaving 1-block thick walls
    carveBox(
        volume,
        centerX - halfFootprint + 1, wallBaseY, centerZ - halfFootprint + 1,
        centerX + halfFootprint, wallBaseY + wallHeight, centerZ + halfFootprint,
        interiorBrightness
    );

    // =========================================================================
    // STEP 4: Doorway (1 wide × 2 tall opening facing entrance direction)
    // =========================================================================
    if (Math.abs(dir.dx) > 0) {
        // Door on X face (east/west)
        const doorX = centerX + dir.dx * halfFootprint;
        for (let dy = 0; dy < doorHeight; dy++) {
            volume.carve(doorX, wallBaseY + dy, centerZ, 1.0);  // Bright doorway
        }
    } else {
        // Door on Z face (north/south)
        const doorZ = centerZ + dir.dz * halfFootprint;
        for (let dy = 0; dy < doorHeight; dy++) {
            volume.carve(centerX, wallBaseY + dy, doorZ, 1.0);  // Bright doorway
        }
    }

    // =========================================================================
    // STEP 5: Roof (Y = baseY + 4 to baseY + 6)
    // Stepped peak: 7×7 base overhang, 7×3 middle, 7×1 ridge
    // Ridge runs perpendicular to door direction
    // =========================================================================
    const roofBaseY = baseY + 1 + wallHeight;  // Y = 4
    const roofOverhang = 3;  // Extends 3 blocks from center (7×7 total)

    // Bottom tier: 7×7 overhang
    fillBox(
        volume,
        centerX - roofOverhang, roofBaseY, centerZ - roofOverhang,
        centerX + roofOverhang + 1, roofBaseY + 1, centerZ + roofOverhang + 1,
        roofBlockType, VoxelState.SOLID
    );

    // Middle tier and ridge depend on door direction
    // Ridge runs perpendicular to entrance (parallel to side walls)
    if (Math.abs(dir.dz) > 0) {
        // Door on Z face → ridge runs along X axis
        // Middle tier: 7×3 (narrow along Z)
        fillBox(
            volume,
            centerX - roofOverhang, roofBaseY + 1, centerZ - 1,
            centerX + roofOverhang + 1, roofBaseY + 2, centerZ + 2,
            roofBlockType, VoxelState.SOLID
        );
        // Top ridge: 7×1
        fillBox(
            volume,
            centerX - roofOverhang, roofBaseY + 2, centerZ,
            centerX + roofOverhang + 1, roofBaseY + 3, centerZ + 1,
            roofBlockType, VoxelState.SOLID
        );
    } else {
        // Door on X face → ridge runs along Z axis
        // Middle tier: 3×7 (narrow along X)
        fillBox(
            volume,
            centerX - 1, roofBaseY + 1, centerZ - roofOverhang,
            centerX + 2, roofBaseY + 2, centerZ + roofOverhang + 1,
            roofBlockType, VoxelState.SOLID
        );
        // Top ridge: 1×7
        fillBox(
            volume,
            centerX, roofBaseY + 2, centerZ - roofOverhang,
            centerX + 1, roofBaseY + 3, centerZ + roofOverhang + 1,
            roofBlockType, VoxelState.SOLID
        );
    }

    // =========================================================================
    // STEP 6: Blend volume into blocks map
    // =========================================================================
    const blocks = new Map();
    const brightnessOverrides = volume.blendIntoWorld(blocks, 0, 0, 0, null);

    // =========================================================================
    // STEP 7: Calculate bounds (includes roof overhang)
    // =========================================================================
    const bounds = {
        minX: centerX - roofOverhang,
        maxX: centerX + roofOverhang + 1,
        minY: baseY - foundationDepth,
        maxY: roofBaseY + 3,
        minZ: centerZ - roofOverhang,
        maxZ: centerZ + roofOverhang + 1
    };

    // =========================================================================
    // STEP 8: Define clearings for tree suppression (9×9 area)
    // =========================================================================
    const doorRotation = Math.atan2(dir.dz, dir.dx);
    const clearings = [
        {
            type: 'rect',
            centerX,
            centerZ,
            width: 9,
            depth: 9,
            rotation: doorRotation
        }
    ];

    // =========================================================================
    // STEP 9: Define heightfield modifications for terrain flattening
    // =========================================================================
    const heightfieldModifications = [
        {
            type: 'flatten',
            centerX,
            centerZ,
            width: 5,
            depth: 5,
            targetY: baseY
        },
        {
            type: 'blend',
            centerX,
            centerZ,
            innerRadius: 2.5,
            outerRadius: 4.5,
            targetY: baseY
        }
    ];

    // =========================================================================
    // STEP 10: Return landmark data
    // =========================================================================
    return {
        type: 'forestHut',
        centerX,
        centerZ,
        baseY,
        blocks,
        brightnessOverrides,
        bounds,
        clearings,
        heightfieldModifications,
        metadata: {
            doorPosition: {
                x: Math.abs(dir.dx) > 0 ? centerX + dir.dx * halfFootprint : centerX,
                y: wallBaseY,
                z: Math.abs(dir.dz) > 0 ? centerZ + dir.dz * halfFootprint : centerZ
            },
            interiorCenter: {
                x: centerX,
                y: wallBaseY + 1,
                z: centerZ
            },
            entranceDirection
        }
    };
}

/**
 * Generate a Rocky Outcrop - natural rock formation protruding from terrain
 *
 * Structure:
 * - 1-3 overlapping spheres creating organic boulder shapes
 * - Primary sphere centered at terrain level
 * - Secondary/tertiary spheres offset to create irregular shape
 * - Heightfield holes where spheres intersect terrain
 *
 * Size classes:
 * - Small (50%): 1 sphere, radius 2-3
 * - Medium (35%): 2 spheres, radius 2-4
 * - Large (15%): 3 spheres, radius 3-5
 */
function generateRockyOutcrop(config, centerX, baseY, centerZ, hashFn, gridX, gridZ) {
    console.log(`[ROCKY OUTCROP] Generating at (${centerX}, ${baseY}, ${centerZ}) grid (${gridX}, ${gridZ})`);
    const volume = new VoxelVolume();

    // Determine size class using seeded random
    const sizeRoll = hashFn(gridX, gridZ, 11111);

    let numSpheres;
    let minRadius, maxRadius;
    let sizeClass;

    // DEBUG: Always generate large outcrops for visibility testing
    if (sizeRoll < 0.50) {
        // Small: 50% chance, 1 sphere
        numSpheres = 1;
        minRadius = 4;  // DEBUG: Increased from 2
        maxRadius = 5;  // DEBUG: Increased from 3
        sizeClass = 'small';
    } else if (sizeRoll < 0.85) {
        // Medium: 35% chance, 2 spheres
        numSpheres = 2;
        minRadius = 4;  // DEBUG: Increased from 2
        maxRadius = 6;  // DEBUG: Increased from 4
        sizeClass = 'medium';
    } else {
        // Large: 15% chance, 3 spheres
        numSpheres = 3;
        minRadius = 5;  // DEBUG: Increased from 3
        maxRadius = 7;  // DEBUG: Increased from 5
        sizeClass = 'large';
    }

    // Select block type based on biome (passed implicitly via landmark system context)
    // DEBUG: Use TNT (red) for visibility testing instead of stone
    const blockType = 'tnt';  // DEBUG: Changed from 'stone' for visibility

    // Generate sphere placements
    const spheres = [];

    // Primary sphere - centered at terrain, slightly embedded
    const primaryRadius = minRadius + hashFn(gridX, gridZ, 22222) * (maxRadius - minRadius);
    const primarySphere = {
        cx: centerX,
        cy: baseY - 1,  // Embedded 1 block into terrain
        cz: centerZ,
        radius: Math.round(primaryRadius)
    };
    spheres.push(primarySphere);

    // Secondary sphere (for medium and large)
    if (numSpheres >= 2) {
        const angle2 = hashFn(gridX, gridZ, 33333) * Math.PI * 2;
        const dist2 = hashFn(gridX, gridZ, 44444) * primaryRadius * 0.8;
        const secondaryRadius = primaryRadius * (0.7 + hashFn(gridX, gridZ, 55555) * 0.3);
        const yOffset2 = (hashFn(gridX, gridZ, 66666) - 0.5) * 2;  // -1 to +1

        spheres.push({
            cx: Math.round(centerX + Math.cos(angle2) * dist2),
            cy: Math.round(baseY - 1 + yOffset2),
            cz: Math.round(centerZ + Math.sin(angle2) * dist2),
            radius: Math.round(secondaryRadius)
        });
    }

    // Tertiary sphere (for large only)
    if (numSpheres >= 3) {
        const angle3 = hashFn(gridX, gridZ, 77777) * Math.PI * 2;
        const dist3 = hashFn(gridX, gridZ, 88888) * primaryRadius * 0.7;
        const tertiaryRadius = primaryRadius * (0.6 + hashFn(gridX, gridZ, 99999) * 0.3);
        const yOffset3 = (hashFn(gridX, gridZ, 12121) - 0.5) * 2;

        spheres.push({
            cx: Math.round(centerX + Math.cos(angle3) * dist3),
            cy: Math.round(baseY - 1 + yOffset3),
            cz: Math.round(centerZ + Math.sin(angle3) * dist3),
            radius: Math.round(tertiaryRadius)
        });
    }

    // Verify VoxelVolume is detected correctly
    console.log(`[ROCKY OUTCROP] volume.set.length=${volume.set?.length}, typeof set=${typeof volume.set}`);

    // Generate voxels for each sphere
    for (const sphere of spheres) {
        console.log(`[ROCKY OUTCROP] fillSphere at (${sphere.cx}, ${sphere.cy}, ${sphere.cz}) radius=${sphere.radius}`);
        fillSphere(
            volume,
            sphere.cx,
            sphere.cy,
            sphere.cz,
            sphere.radius,
            blockType,
            VoxelState.SOLID
        );
        console.log(`[ROCKY OUTCROP] Volume now has ${volume.size} voxels`);
    }

    // Blend volume into blocks map
    const blocks = new Map();
    const brightnessOverrides = volume.blendIntoWorld(blocks, 0, 0, 0, null);
    console.log(`[ROCKY OUTCROP] After blendIntoWorld: blocks.size=${blocks.size}`);

    // Calculate bounds (AABB containing all spheres plus padding)
    let minX = Infinity, maxX = -Infinity;
    let minY = Infinity, maxY = -Infinity;
    let minZ = Infinity, maxZ = -Infinity;

    for (const sphere of spheres) {
        minX = Math.min(minX, sphere.cx - sphere.radius - 1);
        maxX = Math.max(maxX, sphere.cx + sphere.radius + 1);
        minY = Math.min(minY, sphere.cy - sphere.radius - 1);
        maxY = Math.max(maxY, sphere.cy + sphere.radius + 1);
        minZ = Math.min(minZ, sphere.cz - sphere.radius - 1);
        maxZ = Math.max(maxZ, sphere.cz + sphere.radius + 1);
    }

    const bounds = { minX, maxX, minY, maxY, minZ, maxZ };

    // Compute heightfield holes - positions where spheres exist at or below terrain level
    // These are stored as a Set of "x,z" strings for fast lookup
    const heightfieldHoles = new Set();

    for (let x = minX; x <= maxX; x++) {
        for (let z = minZ; z <= maxZ; z++) {
            // Check if any sphere has a voxel at this (x,z) at or below terrain height
            for (const sphere of spheres) {
                // Check multiple y levels from terrain down
                for (let y = baseY; y >= baseY - sphere.radius - 1; y--) {
                    const dx = x - sphere.cx;
                    const dy = y - sphere.cy;
                    const dz = z - sphere.cz;
                    const distSq = dx * dx + dy * dy + dz * dz;

                    if (distSq <= sphere.radius * sphere.radius) {
                        heightfieldHoles.add(`${x},${z}`);
                        break;  // Found a hole at this x,z, no need to check more y levels
                    }
                }
                // Break outer loop if we found a hole
                if (heightfieldHoles.has(`${x},${z}`)) break;
            }
        }
    }

    // Clearing zone to suppress trees/rocks nearby
    const clearings = [
        {
            type: 'rect',
            centerX,
            centerZ,
            width: (maxX - minX) + 4,
            depth: (maxZ - minZ) + 4,
            rotation: 0
        }
    ];

    console.log(`[ROCKY OUTCROP] Generated: ${sizeClass}, ${spheres.length} spheres, ${blocks.size} blocks, ${heightfieldHoles.size} holes`);
    console.log(`[ROCKY OUTCROP] Bounds: (${bounds.minX},${bounds.minY},${bounds.minZ}) to (${bounds.maxX},${bounds.maxY},${bounds.maxZ})`);

    return {
        type: 'rockyOutcrop',
        centerX,
        centerZ,
        baseY,
        blocks,
        brightnessOverrides,
        bounds,
        heightfieldHoles,  // Set of "x,z" strings
        clearings,
        metadata: {
            sizeClass,
            spheres,  // Array of sphere data for debug visualization
            holeCount: heightfieldHoles.size
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

/**
 * Generate a Mission Cave carved into a cliff face
 *
 * DISABLED: This function needs a VoxelFrame API for proper terrain-relative
 * coordinate transforms. See conversation summary for proposed API design.
 *
 * Structure:
 * - Arched entrance in cliff face (3 wide × 4 tall)
 * - Rectangular entrance tunnel (4 blocks deep)
 * - Spherical main chamber (radius 5, floor flattened)
 * - Stalactites (ceiling) and stalagmites (floor) - simple columns
 * - Metadata for game objects (altar, treasure, lights, spawn points)
 *
 * @param {object} config - Landmark configuration
 * @param {number} centerX - World X at cliff face
 * @param {number} baseY - Height at entrance
 * @param {number} centerZ - World Z at cliff face
 * @param {function} hashFn - Deterministic random function
 * @param {number} gridX - Grid cell X
 * @param {number} gridZ - Grid cell Z
 * @param {object} cliffDirection - { dx, dz, slope, baseHeight } from cliff detection
 */
// eslint-disable-next-line no-unused-vars
function generateMissionCave(config, centerX, _baseY, centerZ, hashFn, gridX, gridZ, cliffDirection) {
    const volume = new VoxelVolume();

    const {
        entranceWidth,
        entranceHeight,
        tunnelDepth,
        chamberRadius,
        floorDropBlocks,
        blockType,
        floorBlockType
    } = config;

    // cliffDirection: { dx, dz, slope, baseHeight } from site selection
    // Entrance faces downslope (outward from cliff), cave goes INTO the cliff
    const dx = cliffDirection.dx;
    const dz = cliffDirection.dz;

    // Calculate rotation angle for oriented bounds
    const rotation = Math.atan2(dz, dx);

    // baseY is the height at cliff TOP, baseHeight is the height at cliff BOTTOM (downslope)
    // Position entrance near the bottom of the cliff, slightly above the lower terrain
    const cliffBottomY = Math.floor(cliffDirection.baseHeight);

    // Entrance should be at the lower part of cliff face, a few blocks up from bottom
    const entranceY = cliffBottomY + 2;  // Slightly above the base for visual appeal

    // Entrance position: move outward from cliff center toward downslope direction
    // This positions the entrance where terrain is lower (visible from outside)
    const entranceOffsetDist = 4;  // How far toward downslope to place entrance
    const entranceX = centerX + dx * entranceOffsetDist;
    const entranceZ = centerZ + dz * entranceOffsetDist;

    // Chamber center: tunnel depth + chamber radius INTO the cliff (opposite of entrance direction)
    const chamberDist = tunnelDepth + chamberRadius;
    const chamberX = Math.floor(entranceX - dx * chamberDist);
    const chamberZ = Math.floor(entranceZ - dz * chamberDist);
    const chamberFloorY = entranceY - floorDropBlocks;  // Floor dropped below entrance
    const chamberCenterY = chamberFloorY + chamberRadius;  // Sphere center elevated

    // Brightness values for cave atmosphere
    const entranceBrightness = 1.0;      // Bright at entrance
    const chamberCenterBrightness = 0.15; // Very dark in chamber center
    const chamberEdgeBrightness = 0.25;   // Slightly brighter at edges
    const tunnelStartBrightness = 0.8;    // Transition zone start
    const tunnelEndBrightness = 0.3;      // Transition zone end (near chamber)

    const halfEntrance = Math.floor(entranceWidth / 2);

    // =========================================================================
    // STEP 1: Carve spherical chamber interior with radial brightness
    // The cave carves into existing terrain - no need to add rock shell
    // =========================================================================
    carveSphereRadialBrightness(
        volume,
        chamberX, chamberCenterY, chamberZ,
        chamberRadius,
        chamberCenterBrightness,  // Dark in center
        chamberEdgeBrightness     // Slightly brighter at edges
    );

    // Note: No need to fill floor - natural terrain below the carved sphere provides the floor

    // =========================================================================
    // STEP 2: Build entrance frame with sheer cliff face
    // Creates a solid wall that extends outward and upward, with opening carved in
    // =========================================================================
    const frameThickness = 2;   // How thick the side walls are
    const frameOutward = 5;     // How far the frame extends outward from entrance
    const frameHeight = entranceHeight + 4;  // Frame is taller than entrance
    const cliffWallWidth = halfEntrance + frameThickness + 2;  // Total width of cliff face

    // Build a sheer cliff wall that the cave emerges from
    // This ensures the entrance is always visible against solid rock
    if (Math.abs(dx) > Math.abs(dz)) {
        // Frame extends along X axis (entrance faces +X or -X)
        const frameStartX = dx > 0 ? entranceX : entranceX - frameOutward;
        const frameEndX = dx > 0 ? entranceX + frameOutward : entranceX;
        const cliffFaceX = dx > 0 ? entranceX : entranceX;  // Position of sheer cliff wall

        // Build full sheer cliff face wall (solid block that entrance cuts through)
        fillBox(
            volume,
            cliffFaceX - (dx > 0 ? 1 : 0), entranceY - 2, entranceZ - cliffWallWidth,
            cliffFaceX + (dx > 0 ? 0 : 1), entranceY + frameHeight, entranceZ + cliffWallWidth + 1,
            blockType, VoxelState.SOLID
        );

        // Left wall of frame (extends outward)
        fillBox(
            volume,
            frameStartX, entranceY - 1, entranceZ - halfEntrance - frameThickness,
            frameEndX + 1, entranceY + frameHeight, entranceZ - halfEntrance,
            blockType, VoxelState.SOLID
        );
        // Right wall of frame (extends outward)
        fillBox(
            volume,
            frameStartX, entranceY - 1, entranceZ + halfEntrance + 1,
            frameEndX + 1, entranceY + frameHeight, entranceZ + halfEntrance + frameThickness + 1,
            blockType, VoxelState.SOLID
        );
        // Top of frame (lintel extending outward)
        fillBox(
            volume,
            frameStartX, entranceY + entranceHeight, entranceZ - halfEntrance - frameThickness,
            frameEndX + 1, entranceY + frameHeight, entranceZ + halfEntrance + frameThickness + 1,
            blockType, VoxelState.SOLID
        );
        // Floor of frame (extends outward to create landing)
        fillBox(
            volume,
            frameStartX, entranceY - 2, entranceZ - halfEntrance - frameThickness,
            frameEndX + 1, entranceY, entranceZ + halfEntrance + frameThickness + 1,
            blockType, VoxelState.SOLID
        );
    } else {
        // Frame extends along Z axis (entrance faces +Z or -Z)
        const frameStartZ = dz > 0 ? entranceZ : entranceZ - frameOutward;
        const frameEndZ = dz > 0 ? entranceZ + frameOutward : entranceZ;
        const cliffFaceZ = dz > 0 ? entranceZ : entranceZ;  // Position of sheer cliff wall

        // Build full sheer cliff face wall (solid block that entrance cuts through)
        fillBox(
            volume,
            entranceX - cliffWallWidth, entranceY - 2, cliffFaceZ - (dz > 0 ? 1 : 0),
            entranceX + cliffWallWidth + 1, entranceY + frameHeight, cliffFaceZ + (dz > 0 ? 0 : 1),
            blockType, VoxelState.SOLID
        );

        // Left wall of frame (extends outward)
        fillBox(
            volume,
            entranceX - halfEntrance - frameThickness, entranceY - 1, frameStartZ,
            entranceX - halfEntrance, entranceY + frameHeight, frameEndZ + 1,
            blockType, VoxelState.SOLID
        );
        // Right wall of frame (extends outward)
        fillBox(
            volume,
            entranceX + halfEntrance + 1, entranceY - 1, frameStartZ,
            entranceX + halfEntrance + frameThickness + 1, entranceY + frameHeight, frameEndZ + 1,
            blockType, VoxelState.SOLID
        );
        // Top of frame (lintel extending outward)
        fillBox(
            volume,
            entranceX - halfEntrance - frameThickness, entranceY + entranceHeight, frameStartZ,
            entranceX + halfEntrance + frameThickness + 1, entranceY + frameHeight, frameEndZ + 1,
            blockType, VoxelState.SOLID
        );
        // Floor of frame (extends outward to create landing)
        fillBox(
            volume,
            entranceX - halfEntrance - frameThickness, entranceY - 2, frameStartZ,
            entranceX + halfEntrance + frameThickness + 1, entranceY, frameEndZ + 1,
            blockType, VoxelState.SOLID
        );
    }

    // =========================================================================
    // STEP 3: Carve entrance tunnel through the frame and into cliff
    // =========================================================================
    if (Math.abs(dx) > Math.abs(dz)) {
        // Tunnel runs along X axis
        const tunnelMinX = dx > 0 ? entranceX - tunnelDepth : entranceX - frameOutward;
        const tunnelMaxX = dx > 0 ? entranceX + frameOutward + 1 : entranceX + tunnelDepth + 1;

        carveBoxGradient(
            volume,
            tunnelMinX, entranceY, entranceZ - halfEntrance,
            tunnelMaxX, entranceY + entranceHeight, entranceZ + halfEntrance + 1,
            'x',
            dx > 0 ? tunnelEndBrightness : entranceBrightness,
            dx > 0 ? entranceBrightness : tunnelEndBrightness
        );
    } else {
        // Tunnel runs along Z axis
        const tunnelMinZ = dz > 0 ? entranceZ - tunnelDepth : entranceZ - frameOutward;
        const tunnelMaxZ = dz > 0 ? entranceZ + frameOutward + 1 : entranceZ + tunnelDepth + 1;

        carveBoxGradient(
            volume,
            entranceX - halfEntrance, entranceY, tunnelMinZ,
            entranceX + halfEntrance + 1, entranceY + entranceHeight, tunnelMaxZ,
            'z',
            dz > 0 ? tunnelEndBrightness : entranceBrightness,
            dz > 0 ? entranceBrightness : tunnelEndBrightness
        );
    }

    // =========================================================================
    // STEP 4: Add stalactites (ceiling) - simple columns
    // =========================================================================
    const numStalactites = 5 + Math.floor(hashFn(gridX, gridZ, 111) * 4);  // 5-8

    for (let i = 0; i < numStalactites; i++) {
        const angle = hashFn(gridX + i, gridZ, 333) * Math.PI * 2;
        const dist = 1 + hashFn(gridX, gridZ + i, 444) * (chamberRadius - 2);
        const sx = Math.floor(chamberX + Math.cos(angle) * dist);
        const sz = Math.floor(chamberZ + Math.sin(angle) * dist);

        // Skip if too close to entrance path
        const toEntranceX = entranceX - sx;
        const toEntranceZ = entranceZ - sz;
        const dotProduct = toEntranceX * (-dx) + toEntranceZ * (-dz);
        if (dotProduct > 0 && Math.abs(toEntranceX * dz - toEntranceZ * dx) < 2) {
            continue;  // Skip - would block entrance path
        }

        const ceilingY = chamberFloorY + chamberRadius * 2 - 1;
        const length = 1 + Math.floor(hashFn(gridX + i, gridZ + i, 555) * 3);  // 1-4 blocks

        // Simple stalactite: vertical pillar from ceiling downward
        pillar(volume, sx, ceilingY - length + 1, sz, length, blockType, {
            state: VoxelState.SOLID
        });
    }

    // =========================================================================
    // STEP 5: Add stalagmites (floor) - simple columns
    // =========================================================================
    const numStalagmites = 3 + Math.floor(hashFn(gridX, gridZ, 222) * 3);  // 3-5

    for (let i = 0; i < numStalagmites; i++) {
        const angle = hashFn(gridX + i, gridZ, 666) * Math.PI * 2;
        const dist = 1.5 + hashFn(gridX, gridZ + i, 777) * (chamberRadius - 3);
        const sx = Math.floor(chamberX + Math.cos(angle) * dist);
        const sz = Math.floor(chamberZ + Math.sin(angle) * dist);

        // Skip if too close to entrance path or altar area
        const toEntranceX = entranceX - sx;
        const toEntranceZ = entranceZ - sz;
        const dotProduct = toEntranceX * (-dx) + toEntranceZ * (-dz);
        if (dotProduct > 0 && Math.abs(toEntranceX * dz - toEntranceZ * dx) < 2) {
            continue;  // Skip - would block entrance path
        }

        // Skip if too close to altar (back of chamber)
        const altarX = chamberX - dx * (chamberRadius - 2);
        const altarZ = chamberZ - dz * (chamberRadius - 2);
        if (Math.abs(sx - altarX) < 2 && Math.abs(sz - altarZ) < 2) {
            continue;
        }

        const length = 1 + Math.floor(hashFn(gridX + i, gridZ + i, 888) * 2);  // 1-3 blocks

        // Simple stalagmite: vertical pillar from floor upward
        pillar(volume, sx, chamberFloorY, sz, length, blockType, {
            state: VoxelState.SOLID
        });
    }

    // =========================================================================
    // STEP 6: Blend volume into blocks map
    // =========================================================================
    const blocks = new Map();
    const brightnessOverrides = volume.blendIntoWorld(blocks, 0, 0, 0, null);

    // =========================================================================
    // STEP 7: Calculate bounds
    // =========================================================================
    // Full bounds for spatial indexing (includes entire cave for block queries)
    const padding = 3;
    const bounds = {
        minX: Math.min(entranceX - halfEntrance, chamberX - chamberRadius) - padding,
        maxX: Math.max(entranceX + halfEntrance, chamberX + chamberRadius) + padding,
        minY: chamberFloorY - 2,
        maxY: chamberCenterY + chamberRadius + 2,
        minZ: Math.min(entranceZ - halfEntrance, chamberZ - chamberRadius) - padding,
        maxZ: Math.max(entranceZ + halfEntrance, chamberZ + chamberRadius) + padding
    };

    // Voxel bounds - covers the entrance frame and cliff face that extend OUT
    // Must encompass the entire frame structure including sheer wall, walls, lintel, floor
    // Everything underground (chamber, tunnel interior) is under smooth heightfield
    const voxelBounds = {
        minX: entranceX - cliffWallWidth - 1,
        maxX: entranceX + cliffWallWidth + 2,
        minY: entranceY - 3,
        maxY: entranceY + frameHeight + 2,
        minZ: entranceZ - cliffWallWidth - 1,
        maxZ: entranceZ + cliffWallWidth + 2
    };
    // Extend voxel bounds OUTWARD from cliff to cover the protruding frame
    // frameOutward determines how far the frame extends from entrance
    const outwardExtent = frameOutward + 2;  // Match frame extent plus padding
    if (Math.abs(dx) > Math.abs(dz)) {
        if (dx > 0) {
            // Entrance faces +X (downslope), extend outward in +X
            voxelBounds.maxX = entranceX + outwardExtent;
        } else {
            // Entrance faces -X (downslope), extend outward in -X
            voxelBounds.minX = entranceX - outwardExtent;
        }
    } else {
        if (dz > 0) {
            // Entrance faces +Z (downslope), extend outward in +Z
            voxelBounds.maxZ = entranceZ + outwardExtent;
        } else {
            // Entrance faces -Z (downslope), extend outward in -Z
            voxelBounds.minZ = entranceZ - outwardExtent;
        }
    }

    // =========================================================================
    // STEP 8: Build metadata with spawn positions
    // =========================================================================
    // Altar at back of chamber (opposite entrance direction)
    const altarX = chamberX - dx * (chamberRadius - 2);
    const altarZ = chamberZ - dz * (chamberRadius - 2);

    // Treasure chest to the side (perpendicular to entrance)
    const chestX = chamberX + dz * (chamberRadius - 2);
    const chestZ = chamberZ - dx * (chamberRadius - 2);

    // Crystal positions on walls
    const crystalPositions = [
        { x: chamberX + chamberRadius - 1, y: chamberFloorY + 2, z: chamberZ },
        { x: chamberX - chamberRadius + 1, y: chamberFloorY + 2, z: chamberZ },
        { x: chamberX, y: chamberFloorY + 2, z: chamberZ + chamberRadius - 1 }
    ];

    // Torch positions at entrance frame
    const torchPositions = [];
    if (Math.abs(dx) > Math.abs(dz)) {
        torchPositions.push({ x: entranceX, y: entranceY + 2, z: entranceZ - halfEntrance - 1 });
        torchPositions.push({ x: entranceX, y: entranceY + 2, z: entranceZ + halfEntrance + 1 });
    } else {
        torchPositions.push({ x: entranceX - halfEntrance - 1, y: entranceY + 2, z: entranceZ });
        torchPositions.push({ x: entranceX + halfEntrance + 1, y: entranceY + 2, z: entranceZ });
    }

    const metadata = {
        altarPosition: { x: altarX, y: chamberFloorY, z: altarZ },
        treasureChestPosition: { x: chestX, y: chamberFloorY, z: chestZ },
        crystalPositions,
        torchPositions,
        guardianSpawnPoint: { x: chamberX, y: chamberFloorY, z: chamberZ },
        entranceDirection: { dx, dz },
        chamberCenter: { x: chamberX, y: chamberFloorY, z: chamberZ }
    };

    return {
        type: 'missionCave',
        centerX: entranceX,
        centerZ: entranceZ,
        baseY: entranceY,
        blocks,
        brightnessOverrides,
        voxelBounds,         // Only entrance uses voxel rendering
        bounds,              // Full AABB for spatial indexing (block queries)
        metadata
    };
}