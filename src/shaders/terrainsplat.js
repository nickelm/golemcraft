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
varying vec3 vViewPosition;

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
    vViewPosition = mvPosition.xyz;

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
 *
 * LIGHTING FIX: Clamps total irradiance to prevent overbright surfaces.
 * Without clamping, ambient (0.6) + directional (0.8) = 1.4, which
 * causes blown-out highlights, especially on bright textures like snow.
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
varying vec3 vViewPosition;

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

    // Lambert lighting
    vec3 normal = normalize(vNormal);

    // Vertex color represents AO and interior darkness (0.0-1.0)
    // This affects ambient/environmental light, but NOT point lights (torches)
    float aoFactor = vVertexColor.r;

    // Ambient light (affected by AO/interior darkness)
    vec3 ambientIrradiance = ambientLightColor * aoFactor;

    // Directional lights (affected by AO/interior darkness - they represent sky light)
    #if NUM_DIR_LIGHTS > 0
        for (int i = 0; i < NUM_DIR_LIGHTS; i++) {
            vec3 lightDir = directionalLights[i].direction;
            float NdotL = max(dot(normal, lightDir), 0.0);

            // Apply shadow
            #ifdef USE_SHADOWMAP
                float shadow = getShadowMask();
                NdotL *= shadow;
            #endif

            ambientIrradiance += directionalLights[i].color * NdotL * aoFactor;
        }
    #endif

    // Hemisphere light (affected by AO/interior darkness - represents sky)
    #if NUM_HEMI_LIGHTS > 0
        for (int i = 0; i < NUM_HEMI_LIGHTS; i++) {
            float dotNL = dot(normal, hemisphereLights[i].direction);
            float hemiWeight = 0.5 * dotNL + 0.5;
            ambientIrradiance += mix(hemisphereLights[i].groundColor, hemisphereLights[i].skyColor, hemiWeight) * aoFactor;
        }
    #endif

    // Point lights (NOT affected by AO - torches illuminate dark spaces)
    vec3 pointIrradiance = vec3(0.0);
    #if NUM_POINT_LIGHTS > 0
        for (int i = 0; i < NUM_POINT_LIGHTS; i++) {
            vec3 lightVec = pointLights[i].position - vViewPosition;
            float distance = length(lightVec);
            vec3 lightDir = normalize(lightVec);

            float NdotL = max(dot(normal, lightDir), 0.0);

            // Distance attenuation
            float decay = pointLights[i].decay;
            float distanceFalloff = 1.0;
            if (pointLights[i].distance > 0.0) {
                distanceFalloff = pow(saturate(-distance / pointLights[i].distance + 1.0), decay);
            }

            // Add ambient fill light (25% of point light reaches all surfaces regardless of normal)
            // This simulates light bouncing in enclosed spaces
            float ambientFill = 0.25;
            float directional = NdotL * (1.0 - ambientFill);
            pointIrradiance += pointLights[i].color * (directional + ambientFill) * distanceFalloff;
        }
    #endif

    // Combine: ambient (darkened by AO) + point lights (full brightness)
    vec3 irradiance = ambientIrradiance + pointIrradiance;

    // Clamp irradiance to prevent overbright surfaces
    irradiance = min(irradiance, vec3(1.0));

    blendedColor.rgb *= irradiance;

    gl_FragColor = blendedColor;

    #include <fog_fragment>
}
`;

/**
 * Vertex Shader - Low-power version (single tile per quad)
 *
 * Simplified version for low-power devices that receives a single
 * pre-selected tile index instead of 4 tile indices with blend weights.
 * Tile selection happens during mesh generation using dithering.
 */
export const terrainSplatVertexShaderLowPower = /* glsl */ `
#include <common>
#include <color_pars_vertex>
#include <fog_pars_vertex>

attribute float aSelectedTile;

varying float vSelectedTile;
varying vec3 vVertexColor;
varying vec2 vLocalUV;
varying vec3 vNormal;
varying vec3 vViewPosition;

void main() {
    // Pass single tile index (constant per quad)
    vSelectedTile = aSelectedTile;

    #include <color_vertex>
    vVertexColor = vColor;  // AO from vertex colors

    // Pass local UV (0-1 within quad) for texture sampling
    vLocalUV = uv;

    // Normal in view space for lighting
    vNormal = normalize(normalMatrix * normal);

    // Model-view transform
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    vViewPosition = mvPosition.xyz;

    gl_Position = projectionMatrix * mvPosition;

    #include <fog_vertex>
}
`;

/**
 * Fragment Shader - Low-power version (single texture, no blending)
 *
 * Maximum performance version that only samples ONE texture per fragment.
 * The tile is pre-selected during mesh generation using weighted dithering,
 * creating a stippled/8-bit transition effect at biome boundaries.
 */
export const terrainSplatFragmentShaderLowPower = /* glsl */ `
#include <common>
#include <packing>
#include <fog_pars_fragment>
#include <bsdfs>
#include <lights_pars_begin>

uniform sampler2D uAtlas;

varying float vSelectedTile;
varying vec3 vVertexColor;
varying vec2 vLocalUV;
varying vec3 vNormal;
varying vec3 vViewPosition;

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
    // SINGLE texture lookup - maximum performance
    vec4 color = sampleTile(vSelectedTile, vLocalUV);

    // Lambert lighting
    vec3 normal = normalize(vNormal);

    // Vertex color represents AO and interior darkness (0.0-1.0)
    // This affects ambient/environmental light, but NOT point lights (torches)
    float aoFactor = vVertexColor.r;

    // Ambient light (affected by AO/interior darkness)
    vec3 ambientIrradiance = ambientLightColor * aoFactor;

    // Directional lights (affected by AO/interior darkness)
    #if NUM_DIR_LIGHTS > 0
        for (int i = 0; i < NUM_DIR_LIGHTS; i++) {
            vec3 lightDir = directionalLights[i].direction;
            float NdotL = max(dot(normal, lightDir), 0.0);
            ambientIrradiance += directionalLights[i].color * NdotL * aoFactor;
        }
    #endif

    // Hemisphere light (affected by AO/interior darkness)
    #if NUM_HEMI_LIGHTS > 0
        for (int i = 0; i < NUM_HEMI_LIGHTS; i++) {
            float dotNL = dot(normal, hemisphereLights[i].direction);
            float hemiWeight = 0.5 * dotNL + 0.5;
            ambientIrradiance += mix(hemisphereLights[i].groundColor, hemisphereLights[i].skyColor, hemiWeight) * aoFactor;
        }
    #endif

    // Point lights (NOT affected by AO - torches illuminate dark spaces)
    vec3 pointIrradiance = vec3(0.0);
    #if NUM_POINT_LIGHTS > 0
        for (int i = 0; i < NUM_POINT_LIGHTS; i++) {
            vec3 lightVec = pointLights[i].position - vViewPosition;
            float distance = length(lightVec);
            vec3 lightDir = normalize(lightVec);

            float NdotL = max(dot(normal, lightDir), 0.0);

            // Distance attenuation
            float decay = pointLights[i].decay;
            float distanceFalloff = 1.0;
            if (pointLights[i].distance > 0.0) {
                distanceFalloff = pow(saturate(-distance / pointLights[i].distance + 1.0), decay);
            }

            // Add ambient fill light (25% of point light reaches all surfaces regardless of normal)
            // This simulates light bouncing in enclosed spaces
            float ambientFill = 0.25;
            float directional = NdotL * (1.0 - ambientFill);
            pointIrradiance += pointLights[i].color * (directional + ambientFill) * distanceFalloff;
        }
    #endif

    // Combine: ambient (darkened by AO) + point lights (full brightness)
    vec3 irradiance = ambientIrradiance + pointIrradiance;

    // Clamp irradiance to prevent overbright surfaces
    irradiance = min(irradiance, vec3(1.0));

    color.rgb *= irradiance;

    gl_FragColor = color;

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
varying vec3 vViewPosition;

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

    // Lambert lighting
    vec3 normal = normalize(vNormal);

    // Vertex color represents AO and interior darkness (0.0-1.0)
    // This affects ambient/environmental light, but NOT point lights (torches)
    float aoFactor = vVertexColor.r;

    // Ambient light (affected by AO/interior darkness)
    vec3 ambientIrradiance = ambientLightColor * aoFactor;

    #if NUM_DIR_LIGHTS > 0
        for (int i = 0; i < NUM_DIR_LIGHTS; i++) {
            vec3 lightDir = directionalLights[i].direction;
            float NdotL = max(dot(normal, lightDir), 0.0);

            #ifdef USE_SHADOWMAP
                float shadow = getShadowMask();
                NdotL *= shadow;
            #endif

            ambientIrradiance += directionalLights[i].color * NdotL * aoFactor;
        }
    #endif

    #if NUM_HEMI_LIGHTS > 0
        for (int i = 0; i < NUM_HEMI_LIGHTS; i++) {
            float dotNL = dot(normal, hemisphereLights[i].direction);
            float hemiWeight = 0.5 * dotNL + 0.5;
            ambientIrradiance += mix(hemisphereLights[i].groundColor, hemisphereLights[i].skyColor, hemiWeight) * aoFactor;
        }
    #endif

    // Point lights (NOT affected by AO - torches illuminate dark spaces)
    vec3 pointIrradiance = vec3(0.0);
    #if NUM_POINT_LIGHTS > 0
        for (int i = 0; i < NUM_POINT_LIGHTS; i++) {
            vec3 lightVec = pointLights[i].position - vViewPosition;
            float distance = length(lightVec);
            vec3 lightDir = normalize(lightVec);

            float NdotL = max(dot(normal, lightDir), 0.0);

            // Distance attenuation
            float decay = pointLights[i].decay;
            float distanceFalloff = 1.0;
            if (pointLights[i].distance > 0.0) {
                distanceFalloff = pow(saturate(-distance / pointLights[i].distance + 1.0), decay);
            }

            // Add ambient fill light (25% of point light reaches all surfaces regardless of normal)
            // This simulates light bouncing in enclosed spaces
            float ambientFill = 0.25;
            float directional = NdotL * (1.0 - ambientFill);
            pointIrradiance += pointLights[i].color * (directional + ambientFill) * distanceFalloff;
        }
    #endif

    // Combine: ambient (darkened by AO) + point lights (full brightness)
    vec3 irradiance = ambientIrradiance + pointIrradiance;

    // Clamp irradiance to prevent overbright surfaces
    irradiance = min(irradiance, vec3(1.0));

    blendedColor.rgb *= irradiance;

    gl_FragColor = blendedColor;

    #include <fog_fragment>
}
`;

/**
 * Fragment Shader - Mobile Texture Array version (2 texture blending, no normals)
 *
 * Simplified mobile version using texture arrays instead of atlas:
 * - Diffuse array: 1024×1024×8 sRGB textures
 * - Per-layer tint colors for artistic control
 * - 2-layer blending for mobile performance (vs 4 on desktop)
 * - NO normal mapping (geometric normals only)
 * - Lambert lighting matching mobile atlas shader
 *
 * Blends 2 layers per fragment based on vertex weights.
 * Tile indices are CONSTANT per quad (no interpolation artifacts).
 */
export const terrainSplatFragmentShaderMobileTextureArray = /* glsl */ `
#include <common>
#include <packing>
#include <fog_pars_fragment>
#include <bsdfs>
#include <lights_pars_begin>
#include <shadowmap_pars_fragment>
#include <shadowmask_pars_fragment>

uniform sampler2DArray uDiffuseArray;
uniform vec3 uTintColors[8];
uniform float uTileScale;

varying vec4 vTileIndices;
varying vec4 vBlendWeights;
varying vec3 vVertexColor;
varying vec2 vLocalUV;
varying vec3 vNormal;
varying vec3 vViewPosition;

// Helper: Sample and tint a diffuse layer
vec4 sampleDiffuseLayer(float layerIndex, vec2 uv) {
    vec4 color = texture(uDiffuseArray, vec3(uv * uTileScale, layerIndex));
    int idx = int(layerIndex);
    if (idx >= 0 && idx < 8) {
        color.rgb *= uTintColors[idx];
    }
    return color;
}

void main() {
    // Sample only 2 layers for mobile performance
    vec4 c0 = sampleDiffuseLayer(vTileIndices.x, vLocalUV);
    vec4 c1 = sampleDiffuseLayer(vTileIndices.y, vLocalUV);

    // Renormalize weights for 2-texture blend
    float totalWeight = vBlendWeights.x + vBlendWeights.y;
    float w0 = vBlendWeights.x / max(totalWeight, 0.001);
    float w1 = vBlendWeights.y / max(totalWeight, 0.001);

    vec4 blendedColor = c0 * w0 + c1 * w1;

    // Use geometric normal (no normal mapping for mobile performance)
    vec3 normal = normalize(vNormal);

    // Vertex color represents AO and interior darkness (0.0-1.0)
    // This affects ambient/environmental light, but NOT point lights (torches)
    float aoFactor = vVertexColor.r;

    // Ambient light (affected by AO/interior darkness)
    vec3 ambientIrradiance = ambientLightColor * aoFactor;

    // Directional lights (affected by AO/interior darkness - they represent sky light)
    #if NUM_DIR_LIGHTS > 0
        for (int i = 0; i < NUM_DIR_LIGHTS; i++) {
            vec3 lightDir = directionalLights[i].direction;
            float NdotL = max(dot(normal, lightDir), 0.0);

            // Apply shadow
            #ifdef USE_SHADOWMAP
                float shadow = getShadowMask();
                NdotL *= shadow;
            #endif

            ambientIrradiance += directionalLights[i].color * NdotL * aoFactor;
        }
    #endif

    // Hemisphere light (affected by AO/interior darkness - represents sky)
    #if NUM_HEMI_LIGHTS > 0
        for (int i = 0; i < NUM_HEMI_LIGHTS; i++) {
            float dotNL = dot(normal, hemisphereLights[i].direction);
            float hemiWeight = 0.5 * dotNL + 0.5;
            ambientIrradiance += mix(hemisphereLights[i].groundColor, hemisphereLights[i].skyColor, hemiWeight) * aoFactor;
        }
    #endif

    // Point lights (NOT affected by AO - torches illuminate dark spaces)
    vec3 pointIrradiance = vec3(0.0);
    #if NUM_POINT_LIGHTS > 0
        for (int i = 0; i < NUM_POINT_LIGHTS; i++) {
            vec3 lightVec = pointLights[i].position - vViewPosition;
            float distance = length(lightVec);
            vec3 lightDir = normalize(lightVec);

            float NdotL = max(dot(normal, lightDir), 0.0);

            // Distance attenuation
            float decay = pointLights[i].decay;
            float distanceFalloff = 1.0;
            if (pointLights[i].distance > 0.0) {
                distanceFalloff = pow(saturate(-distance / pointLights[i].distance + 1.0), decay);
            }

            // Add ambient fill light (25% of point light reaches all surfaces regardless of normal)
            // This simulates light bouncing in enclosed spaces
            float ambientFill = 0.25;
            float directional = NdotL * (1.0 - ambientFill);
            pointIrradiance += pointLights[i].color * (directional + ambientFill) * distanceFalloff;
        }
    #endif

    // Combine: ambient (darkened by AO) + point lights (full brightness)
    vec3 irradiance = ambientIrradiance + pointIrradiance;

    // Clamp irradiance to prevent overbright surfaces
    irradiance = min(irradiance, vec3(1.0));

    blendedColor.rgb *= irradiance;

    gl_FragColor = blendedColor;

    #include <fog_fragment>
}
`;

/**
 * Fragment Shader - Desktop Texture Array version (PBR textures with normal mapping)
 *
 * Uses texture arrays instead of atlas sampling for higher quality:
 * - Diffuse array: 1024×1024×8 sRGB textures
 * - Normal array: 512×512×8 linear normal maps
 * - Per-layer tint colors for artistic control
 * - Normal mapping with view-space transformation
 *
 * Blends 4 layers per fragment based on vertex weights.
 * Tile indices are CONSTANT per quad (no interpolation artifacts).
 */
export const terrainSplatFragmentShaderTextureArray = /* glsl */ `
#include <common>
#include <packing>
#include <fog_pars_fragment>
#include <bsdfs>
#include <lights_pars_begin>
#include <shadowmap_pars_fragment>
#include <shadowmask_pars_fragment>

uniform sampler2DArray uDiffuseArray;
uniform sampler2DArray uNormalArray;
uniform vec3 uTintColors[8];
uniform float uTileScale;
uniform bool uDebugNormals;
uniform bool uEnableNormalMapping;

varying vec4 vTileIndices;
varying vec4 vBlendWeights;
varying vec3 vVertexColor;
varying vec2 vLocalUV;
varying vec3 vNormal;
varying vec3 vViewPosition;

// Helper: Sample and tint a diffuse layer
vec4 sampleDiffuseLayer(float layerIndex, vec2 uv) {
    vec4 color = texture(uDiffuseArray, vec3(uv * uTileScale, layerIndex));
    int idx = int(layerIndex);
    if (idx >= 0 && idx < 8) {
        color.rgb *= uTintColors[idx];
    }
    return color;
}

// Helper: Sample a normal map layer and convert from tangent to view space
// Uses screen-space derivatives to construct TBN matrix (no tangent attributes needed)
vec3 sampleNormalLayer(float layerIndex, vec2 uv) {
    // Sample normal map from texture array
    vec3 normalMap = texture(uNormalArray, vec3(uv * uTileScale, layerIndex)).rgb;

    // Convert from [0,1] to [-1,1] range
    normalMap = (normalMap * 2.0 - 1.0) * 1.5;

    // Construct TBN matrix from screen-space derivatives
    vec3 N = normalize(vNormal);

    // Get position and UV derivatives
    vec3 dp1 = dFdx(vViewPosition);
    vec3 dp2 = dFdy(vViewPosition);
    vec2 duv1 = dFdx(uv * uTileScale);
    vec2 duv2 = dFdy(uv * uTileScale);

    // Solve the tangent-bitangent system
    vec3 dp2perp = cross(dp2, N);
    vec3 dp1perp = cross(N, dp1);
    vec3 T = dp2perp * duv1.x + dp1perp * duv2.x;
    vec3 B = dp2perp * duv1.y + dp1perp * duv2.y;

    // Normalize with consistent scale
    float invmax = inversesqrt(max(dot(T, T), dot(B, B)));
    mat3 TBN = mat3(T * invmax, B * invmax, N);

    // Transform normal from tangent space to view space
    return normalize(TBN * normalMap);
}

void main() {
    // DEBUG MODE: Visualize raw normal map RGB
    if (uDebugNormals) {
        vec3 debugNormal = texture(uNormalArray, vec3(vLocalUV * uTileScale, vTileIndices.x)).rgb;
        gl_FragColor = vec4(debugNormal, 1.0);
        #include <fog_fragment>
        return;
    }

    // Sample all 4 diffuse layers
    vec4 c0 = sampleDiffuseLayer(vTileIndices.x, vLocalUV);
    vec4 c1 = sampleDiffuseLayer(vTileIndices.y, vLocalUV);
    vec4 c2 = sampleDiffuseLayer(vTileIndices.z, vLocalUV);
    vec4 c3 = sampleDiffuseLayer(vTileIndices.w, vLocalUV);

    // Blend diffuse colors
    vec4 blendedColor =
        c0 * vBlendWeights.x +
        c1 * vBlendWeights.y +
        c2 * vBlendWeights.z +
        c3 * vBlendWeights.w;

    // Sample and blend normal maps (if enabled)
    vec3 normal;
    if (uEnableNormalMapping) {
        vec3 n0 = sampleNormalLayer(vTileIndices.x, vLocalUV);
        vec3 n1 = sampleNormalLayer(vTileIndices.y, vLocalUV);
        vec3 n2 = sampleNormalLayer(vTileIndices.z, vLocalUV);
        vec3 n3 = sampleNormalLayer(vTileIndices.w, vLocalUV);

        // Blend normals
        vec3 blendedNormal =
            n0 * vBlendWeights.x +
            n1 * vBlendWeights.y +
            n2 * vBlendWeights.z +
            n3 * vBlendWeights.w;

        normal = normalize(blendedNormal);
    } else {
        // Use geometric normal only
        normal = normalize(vNormal);
    }

    // Vertex color represents AO and interior darkness (0.0-1.0)
    // This affects ambient/environmental light, but NOT point lights (torches)
    float aoFactor = vVertexColor.r;

    // Ambient light (affected by AO/interior darkness)
    vec3 ambientIrradiance = ambientLightColor * aoFactor;

    // Directional lights (affected by AO/interior darkness - they represent sky light)
    #if NUM_DIR_LIGHTS > 0
        for (int i = 0; i < NUM_DIR_LIGHTS; i++) {
            vec3 lightDir = directionalLights[i].direction;
            float NdotL = max(dot(normal, lightDir), 0.0);

            // Apply shadow
            #ifdef USE_SHADOWMAP
                float shadow = getShadowMask();
                NdotL *= shadow;
            #endif

            ambientIrradiance += directionalLights[i].color * NdotL * aoFactor;
        }
    #endif

    // Hemisphere light (affected by AO/interior darkness - represents sky)
    #if NUM_HEMI_LIGHTS > 0
        for (int i = 0; i < NUM_HEMI_LIGHTS; i++) {
            float dotNL = dot(normal, hemisphereLights[i].direction);
            float hemiWeight = 0.5 * dotNL + 0.5;
            ambientIrradiance += mix(hemisphereLights[i].groundColor, hemisphereLights[i].skyColor, hemiWeight) * aoFactor;
        }
    #endif

    // Point lights (NOT affected by AO - torches illuminate dark spaces)
    vec3 pointIrradiance = vec3(0.0);
    #if NUM_POINT_LIGHTS > 0
        for (int i = 0; i < NUM_POINT_LIGHTS; i++) {
            vec3 lightVec = pointLights[i].position - vViewPosition;
            float distance = length(lightVec);
            vec3 lightDir = normalize(lightVec);

            float NdotL = max(dot(normal, lightDir), 0.0);

            // Distance attenuation
            float decay = pointLights[i].decay;
            float distanceFalloff = 1.0;
            if (pointLights[i].distance > 0.0) {
                distanceFalloff = pow(saturate(-distance / pointLights[i].distance + 1.0), decay);
            }

            // Add ambient fill light (25% of point light reaches all surfaces regardless of normal)
            // This simulates light bouncing in enclosed spaces
            float ambientFill = 0.25;
            float directional = NdotL * (1.0 - ambientFill);
            pointIrradiance += pointLights[i].color * (directional + ambientFill) * distanceFalloff;
        }
    #endif

    // Combine: ambient (darkened by AO) + point lights (full brightness)
    vec3 irradiance = ambientIrradiance + pointIrradiance;

    // Clamp irradiance to prevent overbright surfaces
    irradiance = min(irradiance, vec3(1.0));

    blendedColor.rgb *= irradiance;

    gl_FragColor = blendedColor;

    #include <fog_fragment>
}
`;