import * as THREE from 'three';

// Biome definitions
export const BIOMES = {
    ocean: { name: 'Ocean', baseHeight: 3, heightScale: 2, surface: 'sand', underwater: 'sand' },
    plains: { name: 'Plains', baseHeight: 8, heightScale: 6, surface: 'grass', subsurface: 'dirt' },
    desert: { name: 'Desert', baseHeight: 7, heightScale: 4, surface: 'sand', subsurface: 'sand' },
    snow: { name: 'Snowy Plains', baseHeight: 9, heightScale: 5, surface: 'snow', subsurface: 'dirt' },
    mountains: { name: 'Mountains', baseHeight: 18, heightScale: 20, surface: 'stone', subsurface: 'stone' }
};

// Water level constant
export const WATER_LEVEL = 6;

// Terrain generation using simplex-like noise
export class TerrainGenerator {
    constructor(seed = 12345) {
        this.seed = seed;
        // Cache for performance
        this.heightCache = new Map();
        this.biomeCache = new Map();
    }

    // Simple pseudo-random hash function
    hash(x, z) {
        let h = this.seed + x * 374761393 + z * 668265263;
        h = (h ^ (h >> 13)) * 1274126177;
        return (h ^ (h >> 16)) & 0xffffffff;
    }

    // Secondary hash for different noise layers
    hash2(x, z) {
        let h = (this.seed * 7919) + x * 668265263 + z * 374761393;
        h = (h ^ (h >> 13)) * 1274126177;
        return (h ^ (h >> 16)) & 0xffffffff;
    }

    // Perlin-like noise (simplified)
    noise(x, z, hashFn = 'hash') {
        const X = Math.floor(x);
        const Z = Math.floor(z);
        
        const fx = x - X;
        const fz = z - Z;
        
        // Smooth interpolation (smoothstep)
        const u = fx * fx * (3.0 - 2.0 * fx);
        const v = fz * fz * (3.0 - 2.0 * fz);
        
        // Hash corner values
        const hashFunc = hashFn === 'hash2' ? this.hash2.bind(this) : this.hash.bind(this);
        const a = hashFunc(X, Z) / 0xffffffff;
        const b = hashFunc(X + 1, Z) / 0xffffffff;
        const c = hashFunc(X, Z + 1) / 0xffffffff;
        const d = hashFunc(X + 1, Z + 1) / 0xffffffff;
        
        // Bilinear interpolation
        return a * (1 - u) * (1 - v) +
               b * u * (1 - v) +
               c * (1 - u) * v +
               d * u * v;
    }

    // Octave noise for more natural terrain
    octaveNoise(x, z, octaves = 4, baseFreq = 0.05, hashFn = 'hash') {
        let total = 0;
        let frequency = baseFreq;
        let amplitude = 1;
        let maxValue = 0;
        
        for (let i = 0; i < octaves; i++) {
            total += this.noise(x * frequency, z * frequency, hashFn) * amplitude;
            maxValue += amplitude;
            amplitude *= 0.5;
            frequency *= 2;
        }
        
        return total / maxValue;
    }

    // Get biome at position using low-frequency noise
    getBiome(x, z) {
        const key = `${x},${z}`;
        if (this.biomeCache.has(key)) {
            return this.biomeCache.get(key);
        }

        // Low frequency noise for biome regions
        // Note: with this hash-based noise, values cluster around 0.1-0.45
        const biomeNoise = this.octaveNoise(x, z, 4, 0.05, 'hash');
        // Secondary noise for variation
        const tempNoise = this.octaveNoise(x, z, 4, 0.06, 'hash2');
        
        // Remap noise from ~[0.08, 0.45] to [0, 1]
        const remappedNoise = Math.max(0, Math.min(1, (biomeNoise - 0.08) / 0.37));
        const remappedTemp = Math.max(0, Math.min(1, (tempNoise - 0.08) / 0.37));
        
        let biome;
        if (remappedNoise < 0.15) {
            biome = 'ocean';
        } else if (remappedNoise < 0.35) {
            // Coastal/transitional - plains or desert based on temperature
            biome = remappedTemp > 0.5 ? 'desert' : 'plains';
        } else if (remappedNoise < 0.70) {
            // Inland - plains, desert, or snow based on temperature
            if (remappedTemp > 0.55) {
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
        const riverNoise = this.octaveNoise(x, z, 3, 0.02, 'hash2');
        // Rivers form in narrow bands
        return Math.abs(riverNoise - 0.5) < 0.03;
    }

    // Check if position is a lake
    isLake(x, z) {
        // Lake noise - creates circular depressions
        const lakeNoise = this.octaveNoise(x, z, 2, 0.04, 'hash2');
        return lakeNoise < 0.2;
    }

    // Generate height at position
    getHeight(x, z) {
        const key = `${x},${z}`;
        if (this.heightCache.has(key)) {
            return this.heightCache.get(key);
        }

        const biome = this.getBiome(x, z);
        const biomeData = BIOMES[biome];
        
        // Base terrain noise
        const terrainNoise = this.octaveNoise(x, z, 5, 0.03);
        
        // Calculate height based on biome
        let height = biomeData.baseHeight + terrainNoise * biomeData.heightScale;
        
        // Add mountain peaks in mountain biome
        if (biome === 'mountains') {
            const peakNoise = this.octaveNoise(x, z, 3, 0.06);
            if (peakNoise > 0.5) {
                height += (peakNoise - 0.5) * 30; // Taller, sharper peaks
            }
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
                const neighborNoise = this.octaveNoise(x + dx, z + dz, 5, 0.03);
                const neighborHeight = neighborData.baseHeight + neighborNoise * neighborData.heightScale;
                
                totalHeight += neighborHeight;
                count++;
            }
        }
        
        return totalHeight / count;
    }

    // Determine block type based on height, position, and biome
    getBlockType(x, y, z) {
        const height = this.getHeight(x, z);
        const biome = this.getBiome(x, z);
        const biomeData = BIOMES[biome];
        
        // Air above terrain
        if (y > height && y > WATER_LEVEL) return null;
        
        // Water blocks
        if (y > height && y <= WATER_LEVEL) {
            // Ice on top of water in snow biome
            if (biome === 'snow' && y === WATER_LEVEL) {
                return 'ice';
            }
            return 'water';
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
export const BLOCK_TYPES = {
    grass: { 
        name: 'Grass',
        tile: [5, 0]
    },
    dirt: { 
        name: 'Dirt',
        tile: [9, 7]
    },
    stone: { 
        name: 'Stone',
        tile: [4, 3]
    },
    snow: { 
        name: 'Snow',
        tile: [5, 2]
    },
    sand: { 
        name: 'Sand',
        tile: [4, 7]
    },
    water: { 
        name: 'Water',
        tile: [9, 1]
    },
    ice: {
        name: 'Ice',
        tile: [6, 2]
    }
};

// Helper to create UV-mapped box geometry for a specific block type
export function createBlockGeometry(blockType) {
    const geometry = new THREE.BoxGeometry(1, 1, 1);
    const uvs = geometry.attributes.uv.array;
    
    const textureWidth = 10 * 77;
    const textureHeight = 8 * 77;
    const tileSize = 74;
    const border = 3;
    const tileTotalSize = 77;
    
    const [col, row] = BLOCK_TYPES[blockType].tile;
    
    const uMin = (col * tileTotalSize + border) / textureWidth;
    const uMax = (col * tileTotalSize + border + tileSize) / textureWidth;
    const vMin = 1 - ((row + 1) * tileTotalSize) / textureHeight;
    const vMax = 1 - (row * tileTotalSize + border) / textureHeight;
    
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