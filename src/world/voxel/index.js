/**
 * Voxel module - Tools for procedural voxel structure generation
 * 
 * This module provides primitives and volume management for building
 * voxel structures in the web worker. The final blocks are blended
 * into the world and sent to the main thread for rendering/collision.
 * 
 * Layers:
 * - voxelstate.js: Semantic states for blend logic
 * - voxelshapes.js: Geometric primitives (box, sphere, cylinder, etc.)
 * - voxelvolume.js: Volume class with blend, transform, merge
 * - architecture.js: Human structures (stairs, pillars, roofs, etc.)
 */

export { VoxelState, isSolidState, isAirState } from './voxelstate.js';
export { VoxelVolume, volumeFromBlocks } from './voxelvolume.js';
export {
    // Box operations
    fillBox,
    strokeBox,
    carveBox,
    carveBoxGradient,
    
    // Sphere operations
    fillSphere,
    strokeSphere,
    carveSphere,
    carveSphereRadialBrightness,
    
    // Cylinder operations
    fillCylinder,
    strokeCylinder,
    carveCylinder,
    
    // Dome operations
    fillDome,
    strokeDome,
    
    // Line operations
    line,
    thickLine,
    
    // Plane operations
    fillPlaneXZ,
    fillPlaneXY,
    fillPlaneZY
} from './voxelshapes.js';

export {
    // Stairs
    stairs,
    spiralStairs,
    
    // Pillars and columns
    pillar,
    colonnade,
    
    // Arches and doorways
    arch,
    doorway,
    
    // Roofs
    pitchedRoof,
    flatRoof,
    
    // Walls and battlements
    battlement,
    wall
} from './architecture.js';