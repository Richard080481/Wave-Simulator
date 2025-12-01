#version 300 es
precision highp float;

in vec3 vNormal;
in vec3 vWorldPos;
in vec2 vUV;

uniform vec3 uLightDir; // light direction in world space
uniform sampler2D uTexture; // texture sampler
uniform vec3 uCameraPos; // camera position in world space
uniform vec3 shipModelPos;
out vec4 fragColor;

// Get sun color for given direction
float getSun(vec3 dir, vec3 L)
{
    return pow(max(0.0, dot(dir, L)), 720.0) * 210.0;
}

// Some very barebones but fast atmosphere approximation
vec3 extra_cheap_atmosphere(vec3 raydir, vec3 sundir)
{
    float special_trick = 1.0 / (raydir.y * 1.0 + 0.1);
    float special_trick2 = 1.0 / (sundir.y * 11.0 + 1.0);
    float raysundt = pow(abs(dot(sundir, raydir)), 2.0);
    float sundt = pow(max(0.0, dot(sundir, raydir)), 8.0);
    float mymie = sundt * special_trick * 0.2;
    vec3 suncolor = mix(vec3(1.0), max(vec3(0.0), vec3(1.0) - vec3(5.5, 13.0, 22.4) / 22.4), special_trick2);
    vec3 bluesky = vec3(5.5, 13.0, 22.4) / 22.4 * suncolor;
    vec3 bluesky2 = max(vec3(0.0), bluesky - vec3(5.5, 13.0, 22.4) * 0.002 * (special_trick + -6.0 * sundir.y * sundir.y));
    bluesky2 *= special_trick * (0.24 + raysundt * 0.24);
    return bluesky2 * (1.0 + 1.0 * pow(1.0 - raydir.y, 3.0));
}

// Get atmosphere color for given direction
vec3 getAtmosphere(vec3 dir, vec3 L)
{
    return extra_cheap_atmosphere(dir, L) * 0.5;
}

void main() {
    vec3 N = normalize(vNormal);
    vec3 L = normalize(uLightDir);
    vec3 V = normalize(uCameraPos - vWorldPos);
    vec3 H = normalize(L + V);
    vec3 R = reflect(-V, N);
    vec3 texColor = texture(uTexture, vUV).rgb;

    // diffuse
    float diff = max(dot(N, L), 0.0);
    // specular
    float spec = pow(max(dot(N, H), 0.0), 64.0);
    // env
    vec3 env = getAtmosphere(R, L) + vec3(1.0) * getSun(R, L);

    vec3 color = texColor * diff + vec3(1.0) * spec * 0.5 + env * 0.05;

    fragColor = vec4(color, 1.0);
}