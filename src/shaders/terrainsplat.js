/**
 * Terrain Splatting Shaders
 *
 * Single unified shader for smooth texture blending at biome transitions.
 * Uses per-vertex tile indices and blend weights with a sampler2DArray.
 *
 * Blends up to 4 textures per vertex with Lambert lighting.
 * No normal mapping, no PBR, no desktop/mobile split.
 */

/**
 * Vertex Shader
 *
 * Tile indices and blend weights are constant per quad (all 4 vertices same).
 * Tints vary per vertex for smooth biome transitions.
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
attribute vec3 aBlendTint0;
attribute vec3 aBlendTint1;
attribute vec3 aBlendTint2;
attribute vec3 aBlendTint3;

varying vec4 vTileIndices;
varying vec4 vBlendWeights;
varying vec3 vBlendTint0;
varying vec3 vBlendTint1;
varying vec3 vBlendTint2;
varying vec3 vBlendTint3;
varying vec3 vVertexColor;
varying vec2 vLocalUV;
varying vec3 vNormal;
varying vec3 vViewPosition;

void main() {
    // Pass tile indices and weights (constant per quad, no interpolation issues)
    vTileIndices = aTileIndices;
    vBlendWeights = aBlendWeights;

    // Pass tints (interpolated per vertex for smooth transitions)
    vBlendTint0 = aBlendTint0;
    vBlendTint1 = aBlendTint1;
    vBlendTint2 = aBlendTint2;
    vBlendTint3 = aBlendTint3;

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
 * Fragment Shader — unified 4-texture blending with Lambert lighting
 *
 * Samples 4 textures from the array and blends based on weights.
 * Tile indices are CONSTANT per quad (no interpolation) - set by CPU.
 * Per-vertex tints provide per-biome color variation.
 *
 * LIGHTING: Clamps total irradiance to prevent overbright surfaces.
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

uniform sampler2DArray uDiffuseArray;
uniform float uTileScale;

varying vec4 vTileIndices;
varying vec4 vBlendWeights;
varying vec3 vBlendTint0;
varying vec3 vBlendTint1;
varying vec3 vBlendTint2;
varying vec3 vBlendTint3;
varying vec3 vVertexColor;
varying vec2 vLocalUV;
varying vec3 vNormal;
varying vec3 vViewPosition;

// Sample and tint a diffuse layer
vec4 sampleDiffuseLayer(float layerIndex, vec2 uv, vec3 tint) {
    vec4 color = texture(uDiffuseArray, vec3(uv * uTileScale, layerIndex));
    color.rgb *= tint;
    return color;
}

void main() {
    // Sample all 4 diffuse layers with per-vertex tints
    vec4 c0 = sampleDiffuseLayer(vTileIndices.x, vLocalUV, vBlendTint0);
    vec4 c1 = sampleDiffuseLayer(vTileIndices.y, vLocalUV, vBlendTint1);
    vec4 c2 = sampleDiffuseLayer(vTileIndices.z, vLocalUV, vBlendTint2);
    vec4 c3 = sampleDiffuseLayer(vTileIndices.w, vLocalUV, vBlendTint3);

    // Blend diffuse colors
    vec4 blendedColor =
        c0 * vBlendWeights.x +
        c1 * vBlendWeights.y +
        c2 * vBlendWeights.z +
        c3 * vBlendWeights.w;

    // Lambert lighting with geometric normals
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
