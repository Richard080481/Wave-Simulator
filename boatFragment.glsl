#version 300 es
precision highp float;

in vec3 vNormal;
in vec3 vWorldPos;
in vec2 vUV;

uniform vec3 uColor;   // base color of the boat
uniform vec3 uLightDir; // light direction in world space
uniform sampler2D uTexture; // texture sampler
out vec4 fragColor;

void main() {
    vec3 N = normalize(vNormal);
    vec3 L = normalize(uLightDir);
    vec3 V = normalize(-vWorldPos);
    vec3 H = normalize(L + V);
    vec3 texColor = texture(uTexture, vUV).rgb;

    float diff = max(dot(N, L), 0.0);
    float spec = pow(max(dot(N, H), 0.0), 64.0);

    vec3 base = uColor * texColor;
    vec3 color = base * (0.15 + 0.85 * diff) + vec3(1.0) * spec * 0.7;

    fragColor = vec4(color, 1.0);
}