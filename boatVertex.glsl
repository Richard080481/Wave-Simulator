#version 300 es
precision highp float;

in vec3 position;
in vec3 normal;
in vec2 uv;

// obejct space -> world space
uniform mat4 uModel;
// world space -> view space
uniform mat4 uView;
// view space -> image space
uniform mat4 uProj;

out vec3 vNormal;
out vec3 vWorldPos;
out vec2 vUV;

void main() {
    vec4 worldPos = uModel * vec4(position, 1.0);
    vWorldPos = worldPos.xyz;
    vNormal = mat3(uModel) * normal;
    vUV = uv;
    gl_Position = uProj * uView * worldPos;
}