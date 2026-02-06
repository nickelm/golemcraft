import * as THREE from 'three';

/**
 * SkyDome - Gradient sky rendering via an inverted sphere
 *
 * Renders a vertical color gradient from horizon to zenith.
 * Colors update each frame from the lighting preset system.
 * Follows the camera so the sky is always centered on the viewer.
 */
export class SkyDome {
    constructor(scene) {
        this.scene = scene;

        const geometry = new THREE.SphereGeometry(900, 32, 16);

        this.material = new THREE.ShaderMaterial({
            uniforms: {
                uZenithColor: { value: new THREE.Color(0x87ceeb) },
                uHorizonColor: { value: new THREE.Color(0xaaddff) }
            },
            vertexShader: /* glsl */`
                varying vec3 vDirection;
                void main() {
                    vDirection = normalize(position);
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                }
            `,
            fragmentShader: /* glsl */`
                uniform vec3 uZenithColor;
                uniform vec3 uHorizonColor;

                varying vec3 vDirection;

                void main() {
                    vec3 dir = normalize(vDirection);

                    // Vertical gradient: horizon (y=0) to zenith (y=1)
                    // Exponent 1.5 spreads the gradient across ~60° of sky
                    // Below horizon (y<0): clamp to horizon color
                    float t = pow(max(0.0, dir.y), 1.5);
                    vec3 color = mix(uHorizonColor, uZenithColor, t);

                    gl_FragColor = vec4(color, 1.0);
                }
            `,
            side: THREE.BackSide,
            depthWrite: false,
            depthTest: false,
            fog: false
        });

        this.mesh = new THREE.Mesh(geometry, this.material);
        this.mesh.renderOrder = -1000;
        this.mesh.frustumCulled = false;
        this.mesh.layers.set(1);

        scene.add(this.mesh);
    }

    /**
     * Update sky colors from lighting preset
     * @param {Object} preset - From calculatePreset(), has .sky and .fog hex colors
     */
    update(preset) {
        this.material.uniforms.uZenithColor.value.setHex(preset.sky);
        this.material.uniforms.uHorizonColor.value.setHex(preset.fog);
    }

    /**
     * Keep sky dome centered on camera so it's always surrounding the viewer
     * @param {THREE.Vector3} cameraPosition
     */
    followCamera(cameraPosition) {
        this.mesh.position.copy(cameraPosition);
    }

    dispose() {
        this.scene.remove(this.mesh);
        this.mesh.geometry.dispose();
        this.material.dispose();
    }
}
