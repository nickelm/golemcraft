/**
 * Voxel Lambert Shader
 *
 * Custom Lambert shader for voxel meshes that matches the terrain splatting
 * shader's lighting calculations. This ensures consistent brightness and
 * saturation between heightfield terrain and voxel structures.
 *
 * Uses a sampler2DArray with per-vertex tile index for texture selection.
 *
 * Lighting model (same as terrainsplat.js):
 * - Ambient light
 * - Directional lights with shadows
 * - Hemisphere lights
 * - Point lights with distance attenuation
 */

export const voxelLambertVertexShader = /* glsl */ `
#include <common>
#include <color_pars_vertex>
#include <fog_pars_vertex>
#include <shadowmap_pars_vertex>

attribute float aSelectedTile;

varying float vSelectedTile;
varying vec3 vVertexColor;
varying vec2 vUv;
varying vec3 vNormal;
varying vec3 vViewPosition;

void main() {
    vSelectedTile = aSelectedTile;

    #include <color_vertex>
    vVertexColor = vColor;  // AO from vertex colors

    vUv = uv;

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

export const voxelLambertFragmentShader = /* glsl */ `
#include <common>
#include <packing>
#include <fog_pars_fragment>
#include <bsdfs>
#include <lights_pars_begin>
#include <shadowmap_pars_fragment>
#include <shadowmask_pars_fragment>

uniform sampler2DArray uDiffuseArray;
uniform float uTileScale;

varying float vSelectedTile;
varying vec3 vVertexColor;
varying vec2 vUv;
varying vec3 vNormal;
varying vec3 vViewPosition;

void main() {
    // Sample texture from array using per-vertex tile index
    vec4 texColor = texture(uDiffuseArray, vec3(vUv * uTileScale, vSelectedTile));

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

    texColor.rgb *= irradiance;

    gl_FragColor = texColor;

    #include <fog_fragment>
}
`;
