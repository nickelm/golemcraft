import * as THREE from 'three';
import { hash, hash2, noise2D, octaveNoise2D } from '../../utils/math/noise.js';
import { getBiomeConfig, BIOMES } from './biomesystem.js';

// Water level constant
export const WATER_LEVEL = 6;

// Terrain generation using simplex-like noise
export class TerrainGenerator {
    constructor(seed = 12345) {
        this.seed = seed;
        // Cache for performance
        this.heightCache = new Map();
        this.biomeCache = new Map();
        // Track destroyed blocks (from explosions, etc.)
        this.destroyedBlocks = new Set();
        
        // Landmark system (set externally after construction)
        this.landmarkSystem = null;
    }
    
    /**
     * Set the landmark system for hollow volumes and block overrides
     * @param {LandmarkSystem} landmarkSystem
     */
    setLandmarkSystem(landmarkSystem) {
        this.landmarkSystem = landmarkSystem;
    }
    
    /**
     * Mark a block as destroyed
     */
    destroyBlock(x, y, z) {
        this.destroyedBlocks.add(`${x},${y},${z}`);
    }
    
    /**
     * Check if a block has been destroyed
     */
    isBlockDestroyed(x, y, z) {
        return this.destroyedBlocks.has(`${x},${y},${z}`);
    }

    // Get biome at position using low-frequency noise
    getBiome(x, z) {
        const key = `${x},${z}`;
        if (this.biomeCache.has(key)) {
            return this.biomeCache.get(key);
        }

        // Low frequency noise for biome regions
        // Note: with this hash-based noise, values cluster around 0.1-0.45
        const biomeNoise = octaveNoise2D(x, z, 4, 0.05, hash);
        // Secondary noise for variation (temperature)
        const tempNoise = octaveNoise2D(x, z, 4, 0.06, hash2);
        // Third noise for humidity (jungle detection)
        const humidityNoise = octaveNoise2D(x, z, 3, 0.04, (x, z) => hash(x, z, 77777));
        
        // Remap noise from ~[0.08, 0.45] to [0, 1]
        const remappedNoise = Math.max(0, Math.min(1, (biomeNoise - 0.08) / 0.37));
        const remappedTemp = Math.max(0, Math.min(1, (tempNoise - 0.08) / 0.37));
        const remappedHumidity = Math.max(0, Math.min(1, (humidityNoise - 0.08) / 0.37));
        
        let biome;
        if (remappedNoise < 0.15) {
            biome = 'ocean';
        } else if (remappedNoise < 0.35) {
            // Coastal/transitional - plains, desert, or jungle
            if (remappedHumidity > 0.65 && remappedTemp > 0.4) {
                biome = 'jungle';
            } else if (remappedTemp > 0.5) {
                biome = 'desert';
            } else {
                biome = 'plains';
            }
        } else if (remappedNoise < 0.70) {
            // Inland - plains, desert, snow, or jungle
            if (remappedHumidity > 0.7 && remappedTemp > 0.45) {
                biome = 'jungle';
            } else if (remappedTemp > 0.55) {
                biome = 'desert';
            } else if (remappedTemp < 0.35) {
                biome = 'snow';
            } else {
                biome = 'plains';
            }
        } else if (remappedNoise < 0.85) {
            // Highland - mountains with some snowy mountains
            biome = remappedTemp < 0.3 ? 'snow' : 'mountains';
        } else {
            biome = 'mountains';
        }

        this.biomeCache.set(key, biome);
        return biome;
    }

    // Check if position is a river
    isRiver(x, z) {
        // River noise - creates winding paths
        const riverNoise = octaveNoise2D(x, z, 3, 0.02, hash2);
        // Rivers form in narrow bands
        return Math.abs(riverNoise - 0.5) < 0.03;
    }

    // Check if position is a lake
    isLake(x, z) {
        // Lake noise - creates circular depressions
        const lakeNoise = octaveNoise2D(x, z, 2, 0.04, hash2);
        return lakeNoise < 0.2;
    }

    /**
     * Get interpolated height at any world position (for smooth entity movement)
     * Uses bilinear interpolation between the four surrounding block heights
     */
    getInterpolatedHeight(x, z) {
        // Get the four surrounding integer coordinates
        const x0 = Math.floor(x);
        const z0 = Math.floor(z);
        const x1 = x0 + 1;
        const z1 = z0 + 1;
        
        // Fractional position within the cell
        const fx = x - x0;
        const fz = z - z0;
        
        // Get heights at the four corners
        const h00 = this.getHeight(x0, z0);
        const h10 = this.getHeight(x1, z0);
        const h01 = this.getHeight(x0, z1);
        const h11 = this.getHeight(x1, z1);
        
        // Bilinear interpolation
        const h0 = h00 * (1 - fx) + h10 * fx;  // Interpolate along x at z0
        const h1 = h01 * (1 - fx) + h11 * fx;  // Interpolate along x at z1
        const height = h0 * (1 - fz) + h1 * fz; // Interpolate along z
        
        return height;
    }

    // Generate height at position
    getHeight(x, z) {
        const key = `${x},${z}`;
        if (this.heightCache.has(key)) {
            return this.heightCache.get(key);
        }

        const biome = this.getBiome(x, z);
        const biomeData = getBiomeConfig(biome);
        
        // Base terrain noise
        const terrainNoise = octaveNoise2D(x, z, 5, 0.03);
        
        // Calculate height based on biome
        let height = biomeData.baseHeight + terrainNoise * biomeData.heightScale;
        
        // Add mountain peaks in mountain biome
        if (biome === 'mountains') {
            const peakNoise = octaveNoise2D(x, z, 3, 0.06);
            if (peakNoise > 0.5) {
                height += (peakNoise - 0.5) * 30; // Taller, sharper peaks
            }
        }
        
        // Jungle has more varied terrain with hills
        if (biome === 'jungle') {
            const jungleHillNoise = octaveNoise2D(x, z, 4, 0.08);
            height += jungleHillNoise * 4;
        }
        
        // Carve rivers (not in ocean or desert)
        if (biome !== 'ocean' && biome !== 'desert' && this.isRiver(x, z)) {
            height = Math.min(height, WATER_LEVEL - 1);
        }
        
        // Carve lakes in plains and snow biomes
        if ((biome === 'plains' || biome === 'snow') && this.isLake(x, z)) {
            height = Math.min(height, WATER_LEVEL - 2);
        }

        // Smooth biome transitions
        height = this.smoothBiomeTransition(x, z, height);
        
        const finalHeight = Math.floor(Math.max(1, height));
        this.heightCache.set(key, finalHeight);
        return finalHeight;
    }

    // Smooth transitions between biomes
    smoothBiomeTransition(x, z, height) {
        const radius = 3;
        let totalHeight = height;
        let count = 1;
        
        // Sample nearby points for smoothing
        for (let dx = -radius; dx <= radius; dx += radius) {
            for (let dz = -radius; dz <= radius; dz += radius) {
                if (dx === 0 && dz === 0) continue;
                
                const neighborBiome = this.getBiome(x + dx, z + dz);
                const neighborData = BIOMES[neighborBiome];
                const neighborNoise = octaveNoise2D(x + dx, z + dz, 5, 0.03);
                const neighborHeight = neighborData.baseHeight + neighborNoise * neighborData.heightScale;
                
                totalHeight += neighborHeight;
                count++;
            }
        }
        
        return totalHeight / count;
    }

    // Determine block type based on height, position, and biome
    getBlockType(x, y, z) {
        // Check if block was destroyed
        if (this.isBlockDestroyed(x, y, z)) {
            return null;
        }
        
        // Check landmark block overrides FIRST (pyramid stones, etc.)
        // These take priority over everything including chambers
        if (this.landmarkSystem) {
            const landmarkBlock = this.landmarkSystem.getLandmarkBlockType(x, y, z);
            if (landmarkBlock) {
                return landmarkBlock;
            }
        }
        
        // Check landmark hollow volumes (chambers) - returns null for air inside
        // Only checked AFTER confirming no landmark block exists here
        // TEMPORARILY DISABLED - testing pyramid structure
        // if (this.landmarkSystem && this.landmarkSystem.isInsideChamber(x, y, z)) {
        //     return null;
        // }
        
        const height = this.getHeight(x, z);
        const biome = this.getBiome(x, z);
        const biomeData = getBiomeConfig(biome);
        
        // Air above terrain
        if (y > height && y > WATER_LEVEL) return null;
        
        // Water blocks
        if (y > height && y <= WATER_LEVEL) {
            // Ice on top of water in snow biome
            if (biome === 'snow' && y === WATER_LEVEL) {
                return 'ice';
            }
            // Surface water (top level) - uses surface geometry (top face only)
            if (y === WATER_LEVEL) {
                return 'water';
            }
            // Deeper water or waterfall - full cube
            return 'water_full';
        }
        
        // Surface block
        if (y === height) {
            // Underwater surface
            if (height < WATER_LEVEL) {
                return biomeData.underwater || 'sand';
            }
            
            // Beach sand near water level
            if (height <= WATER_LEVEL + 2 && biome !== 'desert' && biome !== 'snow') {
                return 'sand';
            }
            
            // Mountain peaks get snow
            if (biome === 'mountains' && height > 22) {
                return 'snow';
            }
            
            return biomeData.surface;
        }
        
        // Subsurface (1-3 blocks below surface)
        if (y >= height - 3) {
            // Beach sand extends down
            if (height <= WATER_LEVEL + 2 && biome !== 'snow') {
                return 'sand';
            }
            return biomeData.subsurface || 'dirt';
        }
        
        // Deep underground
        return 'stone';
    }
}

// Block type definitions with tileset coordinates
// Atlas is 720x720 pixels (10x10 grid of 72x72 cells, each with 64x64 tile + 4px gutter)
export const BLOCK_TYPES = {
    grass: { 
        name: 'Grass',
        tile: [0, 0]
    },
    dirt: { 
        name: 'Dirt',
        tile: [3, 0]
    },
    stone: { 
        name: 'Stone',
        tile: [1, 0]
    },
    snow: { 
        name: 'Snow',
        tile: [2, 0]
    },
    sand: { 
        name: 'Sand',
        tile: [5, 0]
    },
    water: { 
        name: 'Water Surface',
        tile: [4, 0],
        geometry: 'surface',  // top face only, pushed down
        transparent: true
    },
    water_full: {
        name: 'Water Full',
        tile: [4, 0],
        geometry: 'cube',
        transparent: true
    },
    ice: {
        name: 'Ice',
        tile: [6, 0]
    },
    mayan_stone: {
        name: 'Temple Sandstone',
        tile: [7, 0]  // Use stone texture until custom texture is added at [7,0]
    },
    cave_stone: {
        name: 'Cave Stone',
        tile: [1, 0]  // Placeholder: uses stone texture
    },
    cave_floor: {
        name: 'Cave Floor',
        tile: [3, 0]  // Placeholder: uses dirt texture
    }
};

// Blocks that count as transparent for visibility culling
export const TRANSPARENT_BLOCKS = ['water', 'water_full'];

// Get UV coordinates for a block type
function getBlockUVs(blockType) {
    const cellSize = 72;
    const tileSize = 64;
    const gutter = 4;
    const textureSize = 720;
    
    const [col, row] = BLOCK_TYPES[blockType].tile;
    
    return {
        uMin: (col * cellSize + gutter) / textureSize,
        uMax: (col * cellSize + gutter + tileSize) / textureSize,
        vMax: 1 - (row * cellSize + gutter) / textureSize,
        vMin: 1 - (row * cellSize + gutter + tileSize) / textureSize
    };
}

// Create a top-face-only geometry for water surface (pushed down slightly)
function createSurfaceGeometry(blockType) {
    // PlaneGeometry facing up, pushed down 0.2 units from top of block
    const geometry = new THREE.PlaneGeometry(1, 1);
    geometry.rotateX(-Math.PI / 2);  // Face upward
    geometry.translate(0, 0.3, 0);    // Push down from y=0.5 to y=0.3
    
    const uvs = geometry.attributes.uv.array;
    const { uMin, uMax, vMin, vMax } = getBlockUVs(blockType);
    
    // PlaneGeometry has 4 vertices
    uvs[0] = uMin;  uvs[1] = vMax;   // top-left
    uvs[2] = uMax;  uvs[3] = vMax;   // top-right
    uvs[4] = uMin;  uvs[5] = vMin;   // bottom-left
    uvs[6] = uMax;  uvs[7] = vMin;   // bottom-right
    
    geometry.attributes.uv.needsUpdate = true;
    return geometry;
}

// Create standard cube geometry with UV mapping
function createCubeGeometry(blockType) {
    const geometry = new THREE.BoxGeometry(1, 1, 1);
    const uvs = geometry.attributes.uv.array;
    const { uMin, uMax, vMin, vMax } = getBlockUVs(blockType);
    
    function setFaceUVs(faceIndex) {
        const offset = faceIndex * 4 * 2;
        uvs[offset + 0] = uMax;  uvs[offset + 1] = vMax;
        uvs[offset + 2] = uMin;  uvs[offset + 3] = vMax;
        uvs[offset + 4] = uMax;  uvs[offset + 5] = vMin;
        uvs[offset + 6] = uMin;  uvs[offset + 7] = vMin;
    }
    
    for (let i = 0; i < 6; i++) {
        setFaceUVs(i);
    }
    
    geometry.attributes.uv.needsUpdate = true;
    return geometry;
}

// Helper to create UV-mapped geometry for a specific block type
export function createBlockGeometry(blockType) {
    const blockDef = BLOCK_TYPES[blockType];
    
    if (blockDef.geometry === 'surface') {
        return createSurfaceGeometry(blockType);
    }
    
    return createCubeGeometry(blockType);
}