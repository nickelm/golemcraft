/**
 * Voxel Lambert Shader
 *
 * Custom Lambert shader for voxel meshes that matches the terrain splatting
 * shader's lighting calculations. This ensures consistent brightness and
 * saturation between heightfield terrain and voxel structures.
 *
 * Uses the same lighting model as terrainsplat.js:
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

varying vec3 vVertexColor;
varying vec2 vUv;
varying vec3 vNormal;
varying vec3 vViewPosition;

void main() {
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

uniform sampler2D map;

varying vec3 vVertexColor;
varying vec2 vUv;
varying vec3 vNormal;
varying vec3 vViewPosition;

void main() {
    // Sample texture
    vec4 texColor = texture2D(map, vUv);

    // Apply ambient occlusion from vertex colors
    texColor.rgb *= vVertexColor;

    // Lambert lighting (matches terrainsplat.js exactly)
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

    // Point lights (in view space)
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

            irradiance += pointLights[i].color * NdotL * distanceFalloff;
        }
    #endif

    // Clamp irradiance to prevent overbright surfaces
    irradiance = min(irradiance, vec3(1.0));

    texColor.rgb *= irradiance;

    gl_FragColor = texColor;

    #include <fog_fragment>
}
`;
