/**
 * Terrain Splatting Shaders
 *
 * Provides smooth texture blending at biome transitions using per-vertex
 * tile indices and blend weights.
 *
 * Desktop: Blends up to 4 textures per vertex
 * Mobile: Blends 2 textures per vertex for performance
 *
 * Atlas configuration (must match chunkdatagenerator.js):
 * - ATLAS_SIZE: 720px
 * - CELL_SIZE: 72px (includes gutter)
 * - TILE_SIZE: 64px (actual texture)
 * - GUTTER: 4px
 * - TILES_PER_ROW: 10
 */

/**
 * Vertex Shader - shared by desktop and mobile
 *
 * Tile indices and blend weights are constant per quad (all 4 vertices same).
 * Only the UV varies (0-1 across the quad) for texture sampling.
 * This prevents tile index interpolation artifacts.
 */
export const terrainSplatVertexShader = /* glsl */ `
#include <common>
#include <color_pars_vertex>
#include <fog_pars_vertex>
#include <shadowmap_pars_vertex>

attribute vec4 aTileIndices;
attribute vec4 aBlendWeights;

varying vec4 vTileIndices;
varying vec4 vBlendWeights;
varying vec3 vVertexColor;
varying vec2 vLocalUV;
varying vec3 vNormal;

void main() {
    // Pass tile indices and weights (constant per quad, no interpolation issues)
    vTileIndices = aTileIndices;
    vBlendWeights = aBlendWeights;

    #include <color_vertex>
    vVertexColor = vColor;  // AO from vertex colors

    // Pass local UV (0-1 within quad) for texture sampling
    vLocalUV = uv;

    // Normal in view space for lighting
    vNormal = normalize(normalMatrix * normal);

    // Required for Three.js shadowmap_vertex include
    vec3 objectNormal = normal;
    vec3 transformedNormal = normalMatrix * objectNormal;

    // Model-view transform
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);

    // World position (required for shadows)
    vec4 worldPosition = modelMatrix * vec4(position, 1.0);

    gl_Position = projectionMatrix * mvPosition;

    #include <fog_vertex>
    #include <shadowmap_vertex>
}
`;

/**
 * Fragment Shader - Desktop version (4 texture blending)
 *
 * Samples 4 tiles from the atlas and blends based on weights.
 * Tile indices are CONSTANT per quad (no interpolation) - set by CPU.
 * Includes Lambert lighting for consistency with existing materials.
 */
export const terrainSplatFragmentShader = /* glsl */ `
#include <common>
#include <packing>
#include <fog_pars_fragment>
#include <bsdfs>
#include <lights_pars_begin>
#include <shadowmap_pars_fragment>
#include <shadowmask_pars_fragment>

uniform sampler2D uAtlas;

varying vec4 vTileIndices;
varying vec4 vBlendWeights;
varying vec3 vVertexColor;
varying vec2 vLocalUV;
varying vec3 vNormal;

// Atlas configuration
#define SPLAT_ATLAS_SIZE 720.0
#define SPLAT_CELL_SIZE 72.0
#define SPLAT_TILE_SIZE 64.0
#define SPLAT_GUTTER 4.0
#define SPLAT_TILES_PER_ROW 10.0

vec4 sampleTile(float tileIndex, vec2 localUV) {
    float col = mod(tileIndex, SPLAT_TILES_PER_ROW);
    float row = floor(tileIndex / SPLAT_TILES_PER_ROW);

    float uMin = (col * SPLAT_CELL_SIZE + SPLAT_GUTTER) / SPLAT_ATLAS_SIZE;
    float vMax = 1.0 - (row * SPLAT_CELL_SIZE + SPLAT_GUTTER) / SPLAT_ATLAS_SIZE;
    float tileUVSize = SPLAT_TILE_SIZE / SPLAT_ATLAS_SIZE;

    vec2 atlasUV = vec2(
        uMin + localUV.x * tileUVSize,
        vMax - localUV.y * tileUVSize
    );

    return texture2D(uAtlas, atlasUV);
}

void main() {
    // Sample all 4 tiles at this fragment's UV position
    // Tile indices are constant across quad (no interpolation artifacts)
    vec4 c0 = sampleTile(vTileIndices.x, vLocalUV);
    vec4 c1 = sampleTile(vTileIndices.y, vLocalUV);
    vec4 c2 = sampleTile(vTileIndices.z, vLocalUV);
    vec4 c3 = sampleTile(vTileIndices.w, vLocalUV);

    // Blend using weights (also constant per quad)
    vec4 blendedColor =
        c0 * vBlendWeights.x +
        c1 * vBlendWeights.y +
        c2 * vBlendWeights.z +
        c3 * vBlendWeights.w;

    // Apply ambient occlusion from vertex colors
    blendedColor.rgb *= vVertexColor;

    // Lambert lighting
    vec3 normal = normalize(vNormal);

    // Ambient light
    vec3 irradiance = ambientLightColor;

    // Directional lights
    #if NUM_DIR_LIGHTS > 0
        for (int i = 0; i < NUM_DIR_LIGHTS; i++) {
            vec3 lightDir = directionalLights[i].direction;
            float NdotL = max(dot(normal, lightDir), 0.0);

            // Apply shadow
            #ifdef USE_SHADOWMAP
                float shadow = getShadowMask();
                NdotL *= shadow;
            #endif

            irradiance += directionalLights[i].color * NdotL;
        }
    #endif

    // Hemisphere light
    #if NUM_HEMI_LIGHTS > 0
        for (int i = 0; i < NUM_HEMI_LIGHTS; i++) {
            float dotNL = dot(normal, hemisphereLights[i].direction);
            float hemiWeight = 0.5 * dotNL + 0.5;
            irradiance += mix(hemisphereLights[i].groundColor, hemisphereLights[i].skyColor, hemiWeight);
        }
    #endif

    blendedColor.rgb *= irradiance;

    gl_FragColor = blendedColor;

    #include <fog_fragment>
}
`;

/**
 * Fragment Shader - Mobile version (2 texture blending)
 *
 * Simplified version that only blends 2 textures for better mobile performance.
 * Tile indices are CONSTANT per quad (no interpolation) - set by CPU.
 * Renormalizes the top 2 weights to maintain consistent brightness.
 */
export const terrainSplatFragmentShaderMobile = /* glsl */ `
#include <common>
#include <packing>
#include <fog_pars_fragment>
#include <bsdfs>
#include <lights_pars_begin>
#include <shadowmap_pars_fragment>
#include <shadowmask_pars_fragment>

uniform sampler2D uAtlas;

varying vec4 vTileIndices;
varying vec4 vBlendWeights;
varying vec3 vVertexColor;
varying vec2 vLocalUV;
varying vec3 vNormal;

// Atlas configuration
#define SPLAT_ATLAS_SIZE 720.0
#define SPLAT_CELL_SIZE 72.0
#define SPLAT_TILE_SIZE 64.0
#define SPLAT_GUTTER 4.0
#define SPLAT_TILES_PER_ROW 10.0

vec4 sampleTile(float tileIndex, vec2 localUV) {
    float col = mod(tileIndex, SPLAT_TILES_PER_ROW);
    float row = floor(tileIndex / SPLAT_TILES_PER_ROW);

    float uMin = (col * SPLAT_CELL_SIZE + SPLAT_GUTTER) / SPLAT_ATLAS_SIZE;
    float vMax = 1.0 - (row * SPLAT_CELL_SIZE + SPLAT_GUTTER) / SPLAT_ATLAS_SIZE;
    float tileUVSize = SPLAT_TILE_SIZE / SPLAT_ATLAS_SIZE;

    vec2 atlasUV = vec2(
        uMin + localUV.x * tileUVSize,
        vMax - localUV.y * tileUVSize
    );

    return texture2D(uAtlas, atlasUV);
}

void main() {
    // Sample only 2 tiles for mobile performance
    vec4 c0 = sampleTile(vTileIndices.x, vLocalUV);
    vec4 c1 = sampleTile(vTileIndices.y, vLocalUV);

    // Renormalize weights for 2-texture blend
    float totalWeight = vBlendWeights.x + vBlendWeights.y;
    float w0 = vBlendWeights.x / max(totalWeight, 0.001);
    float w1 = vBlendWeights.y / max(totalWeight, 0.001);

    vec4 blendedColor = c0 * w0 + c1 * w1;

    // Apply ambient occlusion
    blendedColor.rgb *= vVertexColor;

    // Lambert lighting
    vec3 normal = normalize(vNormal);
    vec3 irradiance = ambientLightColor;

    #if NUM_DIR_LIGHTS > 0
        for (int i = 0; i < NUM_DIR_LIGHTS; i++) {
            vec3 lightDir = directionalLights[i].direction;
            float NdotL = max(dot(normal, lightDir), 0.0);

            #ifdef USE_SHADOWMAP
                float shadow = getShadowMask();
                NdotL *= shadow;
            #endif

            irradiance += directionalLights[i].color * NdotL;
        }
    #endif

    #if NUM_HEMI_LIGHTS > 0
        for (int i = 0; i < NUM_HEMI_LIGHTS; i++) {
            float dotNL = dot(normal, hemisphereLights[i].direction);
            float hemiWeight = 0.5 * dotNL + 0.5;
            irradiance += mix(hemisphereLights[i].groundColor, hemisphereLights[i].skyColor, hemiWeight);
        }
    #endif

    blendedColor.rgb *= irradiance;

    gl_FragColor = blendedColor;

    #include <fog_fragment>
}
`;
