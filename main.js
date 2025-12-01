const canvas = document.getElementById('canvas');
const gl = canvas.getContext('webgl2');
gl.getExtension('EXT_frag_depth');

// Prevent the context menu so right-click can be used for dragging
canvas.addEventListener('contextmenu', e => e.preventDefault());

let resolutionScale = 1.0;

canvas.width = Math.max(1, Math.floor(window.innerWidth * resolutionScale));
canvas.height = Math.max(1, Math.floor(window.innerHeight * resolutionScale));
gl.viewport(0, 0, canvas.width, canvas.height);

// Setup uniforms
const uniforms = {
    waterDepth: 1.0,
    camHeight: 1.5,
    rayIter: 12,
    normIter: 36,
    sunRotationSpeed: 1.0,
    starDensity: 0.03,
    boatRotationSpeed: 5.0
};

const camera = {
    eye:    [0, 4, -15],
    center: [0, 1, 0],
    up:     [0, 1, 0],
};

let boatProgram = null;
let boatVAO = null;
let boatIndexCount = 0;
let boatModel = mat4Identity();
let boatView = mat4Identity();
let boatProj = mat4Identity();
let pitchAngle = 0;
let pitchVelocity = 0;
let rollAngle = 0;
let rollVelocity = 0;
const pitchDamping = 1.8;
const rollDamping  = 1.8;
const pitchStiffness = 2.2;
const rollStiffness  = 2.2;

// Update display values
document.getElementById('waterDepth').addEventListener('input', e => {
    uniforms.waterDepth = parseFloat(e.target.value);
    document.getElementById('depthVal').textContent = uniforms.waterDepth.toFixed(1);
});
document.getElementById('camHeight').addEventListener('input', e => {
    // move camera eye Y to the slider value and keep center's relative offset
    const oldEyeY = camera.eye[1];
    uniforms.camHeight = parseFloat(e.target.value);
    document.getElementById('heightVal').textContent = uniforms.camHeight.toFixed(1);
    const delta = uniforms.camHeight - oldEyeY;
    camera.eye[1] = uniforms.camHeight;
    camera.center[1] += delta;
});
document.getElementById('sunRotationSpeed').addEventListener('input', e => {
    uniforms.sunRotationSpeed = parseFloat(e.target.value);
    document.getElementById('sunSpeedVal').textContent = uniforms.sunRotationSpeed.toFixed(1);
});
document.getElementById('boatRotationSpeed').addEventListener('input', e => {
    uniforms.boatRotationSpeed = parseFloat(e.target.value);
    document.getElementById('boatSpeedVal').textContent = uniforms.boatRotationSpeed.toFixed(1);
});
document.getElementById('starDensity').addEventListener('input', e => {
    uniforms.starDensity = parseFloat(e.target.value);
    document.getElementById('starDensityVal').textContent = uniforms.starDensity.toFixed(3);
});

// Resolution scale slider (multiplier): 0.25 = 25%, 1.0 = 100%
const resSlider = document.getElementById('resolutionScale');
const resLabel = document.getElementById('resolutionVal');
if (resSlider) {
    resSlider.addEventListener('input', e => {
        resolutionScale = parseFloat(e.target.value);
        // Show percentage
        resLabel.textContent = Math.round(resolutionScale * 100) + '%';
        // Resize drawing buffer
        canvas.width = Math.max(1, Math.floor(window.innerWidth * resolutionScale));
        canvas.height = Math.max(1, Math.floor(window.innerHeight * resolutionScale));
        gl.viewport(0, 0, canvas.width, canvas.height);
        // update boat projection aspect
        boatProj = mat4Perspective(Math.PI/4, canvas.width / canvas.height, 0.1, 500.0);
    });
    // initialize label
    resLabel.textContent = Math.round(resolutionScale * 100) + '%';
}

// Close/open controls buttons
const controlsEl = document.getElementById('controls');
const controlsCloseBtn = document.getElementById('controlsClose');
const controlsOpenBtn = document.getElementById('controlsOpen');

// Initialize reopen (gear) button visibility to match the current panel state.
if (controlsEl && controlsOpenBtn) {
    // If the controls panel is currently not closed, hide the reopen button.
    controlsOpenBtn.hidden = !controlsEl.classList.contains('closed');
}
if (controlsCloseBtn && controlsEl && controlsOpenBtn) {
    controlsCloseBtn.addEventListener('click', (e) => {
        e.preventDefault();
        controlsEl.classList.add('closed');
        // show open button
        controlsOpenBtn.hidden = false;
        controlsOpenBtn.setAttribute('aria-expanded', 'false');
    });

    controlsOpenBtn.addEventListener('click', (e) => {
        e.preventDefault();
        controlsEl.classList.remove('closed');
        controlsOpenBtn.hidden = true;
        controlsOpenBtn.setAttribute('aria-expanded', 'true');
    });

    // Allow Escape to close the controls if focused anywhere
    window.addEventListener('keydown', (e) => {
        // Prevent browser tab/window shortcuts (Ctrl/Cmd+W) from closing the page
        // and treat the key as forward movement inside the app when appropriate.
        const ae = document.activeElement;
        const isTypingNow = (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.isContentEditable));
        if ((e.ctrlKey || e.metaKey) && (e.code === 'KeyW' || e.key === 'w' || e.key === 'W')) {
            // Block default close-tab behavior in the browser.
            e.preventDefault();
            e.stopPropagation();
            if (!isTypingNow) moveKeys.w = true;
            return;
        }
        if (e.key === 'Escape' && !controlsEl.classList.contains('closed')) {
            controlsEl.classList.add('closed');
            controlsOpenBtn.hidden = false;
        }
    });
}

function normalize(v) {
    const len = Math.hypot(v[0], v[1], v[2]);
    return len > 0 ? [v[0] / len, v[1] / len, v[2] / len] : [0, 0, 0];
}

// sun motion, just fake it, going up and down vertically
function getSunDirection(time) {
    const t = time * 0.5 * uniforms.sunRotationSpeed;
    const r = 2.0;
    const cx = 0.0;
    const cy = 0.0;

    const x = cx + r * Math.cos(t);
    const y = cy + r * Math.sin(t);
    const z = 3.0;

    // Camera is at (0,0,0) looking towards +Z
    // return normalize(vec3(0, 0, 1));
    return normalize([x, y, z]);
}

function compileShader(type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        console.error(gl.getShaderInfoLog(shader));
    }
    return shader;
}

function mat4Inverse(m) {
    const out = new Float32Array(16);
    const a = m;

    const b00 = a[0] * a[5] - a[1] * a[4];
    const b01 = a[0] * a[6] - a[2] * a[4];
    const b02 = a[0] * a[7] - a[3] * a[4];
    const b03 = a[1] * a[6] - a[2] * a[5];
    const b04 = a[1] * a[7] - a[3] * a[5];
    const b05 = a[2] * a[7] - a[3] * a[6];
    const b06 = a[8] * a[13] - a[9] * a[12];
    const b07 = a[8] * a[14] - a[10] * a[12];
    const b08 = a[8] * a[15] - a[11] * a[12];
    const b09 = a[9] * a[14] - a[10] * a[13];
    const b10 = a[9] * a[15] - a[11] * a[13];
    const b11 = a[10] * a[15] - a[11] * a[14];

    let det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
    det = 1.0 / det;

    out[0] = ( a[5] * b11 - a[6] * b10 + a[7] * b09) * det;
    out[1] = (-a[1] * b11 + a[2] * b10 - a[3] * b09) * det;
    out[2] = ( a[13] * b05 - a[14] * b04 + a[15] * b03) * det;
    out[3] = (-a[9] * b05 + a[10] * b04 - a[11] * b03) * det;
    out[4] = (-a[4] * b11 + a[6] * b08 - a[7] * b07) * det;
    out[5] = ( a[0] * b11 - a[2] * b08 + a[3] * b07) * det;
    out[6] = (-a[12] * b05 + a[14] * b02 - a[15] * b01) * det;
    out[7] = ( a[8] * b05 - a[10] * b02 + a[11] * b01) * det;
    out[8] = ( a[4] * b10 - a[5] * b08 + a[7] * b06) * det;
    out[9] = (-a[0] * b10 + a[1] * b08 - a[3] * b06) * det;
    out[10] = ( a[12] * b04 - a[13] * b02 + a[15] * b00) * det;
    out[11] = (-a[8] * b04 + a[9] * b02 - a[11] * b00) * det;
    out[12] = (-a[4] * b09 + a[5] * b07 - a[6] * b06) * det;
    out[13] = ( a[0] * b09 - a[1] * b07 + a[2] * b06) * det;
    out[14] = (-a[12] * b03 + a[13] * b01 - a[14] * b00) * det;
    out[15] = ( a[8] * b03 - a[9] * b01 + a[10] * b00) * det;

    return out;
}

function mat4Identity() {
    return new Float32Array([
        1,0,0,0,
        0,1,0,0,
        0,0,1,0,
        0,0,0,1
    ]);
}

function mat4Multiply(a, b) {
    const out = new Float32Array(16);
    for (let r = 0; r < 4; r++) {
        for (let c = 0; c < 4; c++) {
            out[r*4 + c] =
                a[r*4 + 0]*b[0*4 + c] +
                a[r*4 + 1]*b[1*4 + c] +
                a[r*4 + 2]*b[2*4 + c] +
                a[r*4 + 3]*b[3*4 + c];
        }
    }
    return out;
}

function mat4Perspective(fovy, aspect, near, far) {
    const f = 1.0 / Math.tan(fovy / 2);
    const nf = 1 / (near - far);
    return new Float32Array([
        f / aspect, 0, 0, 0,
        0, f, 0, 0,
        0, 0, (far + near) * nf, -1,
        0, 0, (2 * far * near) * nf, 0
    ]);
}

function mat4LookAt(eye, center, up) {
    const [ex, ey, ez] = eye;
    const [cx, cy, cz] = center;
    const [ux, uy, uz] = up;

    let zx = ex - cx;
    let zy = ey - cy;
    let zz = ez - cz;
    let zl = Math.hypot(zx, zy, zz);
    zx /= zl; zy /= zl; zz /= zl;

    let xx = uy*zz - uz*zy;
    let xy = uz*zx - ux*zz;
    let xz = ux*zy - uy*zx;
    let xl = Math.hypot(xx, xy, xz);
    xx /= xl; xy /= xl; xz /= xl;

    let yx = zy*xz - zz*xy;
    let yy = zz*xx - zx*xz;
    let yz = zx*xy - zy*xx;

    const out = new Float32Array(16);
    out[0] = xx; out[1] = yx; out[2] = zx; out[3] = 0;
    out[4] = xy; out[5] = yy; out[6] = zy; out[7] = 0;
    out[8] = xz; out[9] = yz; out[10] = zz; out[11] = 0;
    out[12] = -(xx*ex + xy*ey + xz*ez);
    out[13] = -(yx*ex + yy*ey + yz*ez);
    out[14] = -(zx*ex + zy*ey + zz*ez);
    out[15] = 1;
    return out;
}

function parseOBJ(text) {
    const positions = [];
    const normals = [];
    const uvs = [];
    const finalPositions = [];
    const finalNormals = [];
    const finalUVs = [];
    const indices = [];

    const lines = text.split('\n');
    const vertexMap = new Map();
    let indexCounter = 0;

    function getVertexIndex(vStr) {
        let [vIdxStr, vtIdxStr, nIdxStr] = vStr.split('/');
        const vIdx = parseInt(vIdxStr, 10);
        const vtIdx = vtIdxStr ? parseInt(vtIdxStr, 10) : null;
        const nIdx = nIdxStr ? parseInt(nIdxStr, 10) : null;

        const key = vStr;
        if (vertexMap.has(key)) return vertexMap.get(key);

        const px = positions[(vIdx - 1)*3 + 0];
        const py = positions[(vIdx - 1)*3 + 1];
        const pz = positions[(vIdx - 1)*3 + 2];

        let u = 0, v = 0;
        if (vtIdx != null) {
            u = uvs[(vtIdx - 1)*2 + 0];
            v = uvs[(vtIdx - 1)*2 + 1];
        }

        let nx = 0, ny = 0, nz = 1;
        if (nIdx != null) {
            nx = normals[(nIdx - 1)*3 + 0];
            ny = normals[(nIdx - 1)*3 + 1];
            nz = normals[(nIdx - 1)*3 + 2];
        }

        finalPositions.push(px, py, pz);
        finalUVs.push(u, v);
        finalNormals.push(nx, ny, nz);

        vertexMap.set(key, indexCounter);
        return indexCounter++;
    }

    for (let line of lines) {
        line = line.trim();
        if (line.startsWith('#') || line.length === 0) continue;
        const parts = line.split(/\s+/);

        if (parts[0] === 'v') {
            positions.push(parseFloat(parts[1]), parseFloat(parts[2]), parseFloat(parts[3]));
        }
        else if (parts[0] === 'vt') {
            uvs.push(parseFloat(parts[1]), 1.0 - parseFloat(parts[2]));
        }
        else if (parts[0] === 'vn') {
            normals.push(parseFloat(parts[1]), parseFloat(parts[2]), parseFloat(parts[3]));
        }
        else if (parts[0] === 'f') {
            const i0 = getVertexIndex(parts[1]);
            const i1 = getVertexIndex(parts[2]);
            const i2 = getVertexIndex(parts[3]);
            indices.push(i0, i1, i2);
            if (parts.length === 5) {
                const i3 = getVertexIndex(parts[4]);
                indices.push(i0, i2, i3);
            }
        }
    }

    return {
        positions: new Float32Array(finalPositions),
        normals: new Float32Array(finalNormals),
        uvs: new Float32Array(finalUVs),
        indices: new Uint16Array(indices)
    };
}

function loadTexture(url) {
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);

    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

    const img = new Image();
    img.onload = () => {
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
        gl.generateMipmap(gl.TEXTURE_2D);
    };
    img.src = url;

    return tex;
}

// Calculate SDF wave height
// single wave
function getwave(position, direction, frequency, timeshift) {
    let x = (direction[0]*position[0] + direction[1]*position[1]) * frequency + timeshift;
    let wave = Math.exp(Math.sin(x) - 1.0);
    let dx = wave * Math.cos(x);
    return [wave, -dx];
}

function getWavesHeight(position, time, ITER) {
    let wavePhaseShift = Math.hypot(position[0], position[1]) * 0.1;
    let iter = 0.0;
    let frequency = 1.0;
    let timeMultiplier = 2.0;
    let weight = 1.0;
    let sumValues = 0.0;
    let sumWeights = 0.0;
    for (let i = 0; i < ITER; i++) {
        let p = [Math.sin(iter), Math.cos(iter)];
        let res = getwave(position, p, frequency, time * timeMultiplier + wavePhaseShift);

        position[0] += p[0] * res[1] * weight * 0.38;
        position[1] += p[1] * res[1] * weight * 0.38;

        sumValues += res[0] * weight;
        sumWeights += weight;

        weight = weight * 0.8;
        frequency *= 1.18;
        timeMultiplier *= 1.07;
        iter += 1232.399963;
    }
    return sumValues / sumWeights;
}

// Load shader files
// If the page is opened via file://, fetch will fail in most browsers.
if (location.protocol === 'file:') {
    console.warn('Warning: page loaded using file://. Fetching shader files usually fails when opened directly from the filesystem. Run a local server (e.g. `python -m http.server`) and open via http://localhost:8000');
}

Promise.all([
    fetch('vertex.glsl').then(r => { if (!r.ok) throw new Error('Failed to fetch vertex.glsl: ' + r.status + ' ' + r.statusText); return r.text(); }),
    fetch('fragment.glsl').then(r => { if (!r.ok) throw new Error('Failed to fetch fragment.glsl: ' + r.status + ' ' + r.statusText); return r.text(); }),
    fetch('boatVertex.glsl').then(r => { if (!r.ok) throw new Error('Failed to fetch boatVertex.glsl: ' + r.status + ' ' + r.statusText); return r.text(); }),
    fetch('boatFragment.glsl').then(r => { if (!r.ok) throw new Error('Failed to fetch boatFragment.glsl: ' + r.status + ' ' + r.statusText); return r.text(); }),
    fetch('boat.obj').then(r => { if (!r.ok) throw new Error('Failed to fetch boat.obj: ' + r.status + ' ' + r.statusText); return r.text(); })
]).then(([vertexSrc, fragmentSrc, boatVertSrc, boatFragSrc, boatObjText]) => {
    const vertShader = compileShader(gl.VERTEX_SHADER, vertexSrc);
    const fragShader = compileShader(gl.FRAGMENT_SHADER, fragmentSrc);

    const program = gl.createProgram();
    gl.attachShader(program, vertShader);
    gl.attachShader(program, fragShader);
    gl.linkProgram(program);
    gl.useProgram(program);
    const locView = gl.getUniformLocation(program, 'uView');
    const locProj = gl.getUniformLocation(program, 'uProj');
    gl.uniformMatrix4fv(locView, false, boatView);
    gl.uniformMatrix4fv(locProj, false, boatProj);

    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);

    const vertices = [-1, -1, 1, -1, -1, 1, 1, 1];
    const vbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vertices), gl.STATIC_DRAW);

    const posLoc = gl.getAttribLocation(program, 'position');
    gl.enableVertexAttribArray(posLoc);
    gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 8, 0);

    // boat shader
    const boatVertShader = compileShader(gl.VERTEX_SHADER, boatVertSrc);
    const boatFragShader = compileShader(gl.FRAGMENT_SHADER, boatFragSrc);

    boatProgram = gl.createProgram();
    gl.attachShader(boatProgram, boatVertShader);
    gl.attachShader(boatProgram, boatFragShader);
    gl.linkProgram(boatProgram); 

    // parse boat model
    const boatMesh = parseOBJ(boatObjText);

    // create boat VAO/VBO/IBO
    boatVAO = gl.createVertexArray();
    gl.bindVertexArray(boatVAO);

    const boatVBO = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, boatVBO);
    const vertexCount = boatMesh.positions.length / 3;
    const boatVertexData = new Float32Array(vertexCount * 8);

    for (let i = 0; i < vertexCount; i++) {
        boatVertexData[i*8 + 0] = boatMesh.positions[i*3 + 0];
        boatVertexData[i*8 + 1] = boatMesh.positions[i*3 + 1];
        boatVertexData[i*8 + 2] = boatMesh.positions[i*3 + 2];

        boatVertexData[i*8 + 3] = boatMesh.normals[i*3 + 0];
        boatVertexData[i*8 + 4] = boatMesh.normals[i*3 + 1];
        boatVertexData[i*8 + 5] = boatMesh.normals[i*3 + 2];

        boatVertexData[i*8 + 6] = boatMesh.uvs[i*2 + 0];
        boatVertexData[i*8 + 7] = boatMesh.uvs[i*2 + 1];
    }
    gl.bufferData(gl.ARRAY_BUFFER, boatVertexData, gl.STATIC_DRAW);

    const boatEBO = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, boatEBO);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, boatMesh.indices, gl.STATIC_DRAW);
    boatIndexCount = boatMesh.indices.length;

    // setup attributes
    const boatPosLoc = gl.getAttribLocation(boatProgram, 'position');
    const boatNormalLoc = gl.getAttribLocation(boatProgram, 'normal');
    const boatUVLoc = gl.getAttribLocation(boatProgram, 'uv');
    const stride = 8 * 4; // 6 floats * 4 bytes
    gl.enableVertexAttribArray(boatPosLoc);
    gl.vertexAttribPointer(boatPosLoc, 3, gl.FLOAT, false, stride, 0);
    gl.enableVertexAttribArray(boatNormalLoc);
    gl.vertexAttribPointer(boatNormalLoc, 3, gl.FLOAT, false, stride, 3*4);
    gl.enableVertexAttribArray(boatUVLoc);
    gl.vertexAttribPointer(boatUVLoc, 2, gl.FLOAT, false, stride, 6*4);

    gl.bindVertexArray(null);

    // get uniform locations
    gl.useProgram(boatProgram);
    const boatTexture = loadTexture('boat_diffuse_v1.jpg');
    const boat_uTexture = gl.getUniformLocation(boatProgram, 'uTexture');

    // simple camera setup
    boatView = mat4LookAt(camera.eye, camera.center, camera.up);
    boatProj = mat4Perspective(Math.PI/4, canvas.width/canvas.height, 0.1, 500.0);
    boatModel = mat4Identity();

    // mouse state
    let mouseX = 0, mouseY = 0;       // last moved mouse, used for shader iMouse
    let lastMouseX = 0, lastMouseY = 0;
    let isMouseDown = false;

    // keyboard (WASD) movement state
    const moveKeys = { w: false, a: false, s: false, d: false };
    const moveSpeed = 3.5; // horizontal units per second
    const verticalSpeed = 2.25; // vertical units per second (Space / Ctrl)
    let moveUp = false, moveDown = false;

    // camera orientation in spherical coords (radians)
    // yaw: rotation around Y axis (left/right), pitch: up/down
    let yaw = 0.0;
    let pitch = 0.0;
    const lookSensitivity = 0.003; // adjust to taste

    // initialize yaw/pitch from camera eye->center vector (safe default)
    (function initYawPitch() {
        const fx = camera.center[0] - camera.eye[0];
        const fy = camera.center[1] - camera.eye[1];
        const fz = camera.center[2] - camera.eye[2];
        const r = Math.hypot(fx, fy, fz) || 1.0;
        const nx = fx / r, ny = fy / r, nz = fz / r;
        yaw = Math.atan2(nx, nz);
        pitch = Math.asin(Math.max(-1, Math.min(1, ny)));
    })();

    // Start dragging only when the right mouse button (button === 2) is pressed.
    window.addEventListener('mousedown', (e) => {
        // allow starting drag even when paused so the user can change view
        if (e.button === 2) {
            isMouseDown = true;
            lastMouseX = e.clientX;
            lastMouseY = e.clientY;
            // prevent the browser from doing other things
            e.preventDefault();
        }
    });

    // Stop dragging on any mouse up (covers right button release)
    window.addEventListener('mouseup', () => {
        isMouseDown = false;
    });

    // On mouse move, update camera yaw/pitch while right button is held and also
    // update mouseX/mouseY which is passed through to the shader (iMouse)
    window.addEventListener('mousemove', e => {
        mouseX = e.clientX;
        mouseY = e.clientY;

        // update camera orientation while dragging even when paused

        if (isMouseDown) {
            const dx = e.clientX - lastMouseX;
            const dy = e.clientY - lastMouseY;
            lastMouseX = e.clientX;
            lastMouseY = e.clientY;

            // update yaw/pitch using mouse movement
            yaw -= dx * lookSensitivity;
            pitch -= dy * lookSensitivity;

            // clamp pitch to avoid flipping (slightly less than +/- 90 degrees)
            const maxPitch = Math.PI / 2 - 0.01;
            if (pitch > maxPitch) pitch = maxPitch;
            if (pitch < -maxPitch) pitch = -maxPitch;

            // compute new forward vector from spherical coords
            const fx = Math.sin(yaw) * Math.cos(pitch);
            const fy = Math.sin(pitch);
            const fz = Math.cos(yaw) * Math.cos(pitch);

            // camera center is eye + forward
            camera.center[0] = camera.eye[0] + fx;
            camera.center[1] = camera.eye[1] + fy;
            camera.center[2] = camera.eye[2] + fz;
            // If we're paused the animation loop isn't running — render a single
            // frame so the change is visible immediately (the time remains frozen)
            if (isPaused) {
                // draw one frame using the current frozen time
                animate();
            }
        }
    });

    // animation timing / pause handling
    const startTime = Date.now();
    let pausedDuration = 0; // accumulated time while paused (ms)
    let isPaused = false;
    let pauseStart = 0; // timestamp when pause began (ms)
    let timeAtPause = 0.0; // frozen time in seconds used while paused
    const pauseOverlay = document.getElementById('pauseOverlay');
    // last frame timestamp used to compute smooth camera movement (ms)
    let lastFrameTimeMs = Date.now();

    function applyMovement(dt) {
        // dt in seconds
        if (!moveKeys.w && !moveKeys.a && !moveKeys.s && !moveKeys.d && !moveUp && !moveDown) return false;

        // forward is camera center - eye, flattened on Y
        const fx = camera.center[0] - camera.eye[0];
        const fz = camera.center[2] - camera.eye[2];
        let forwardLen = Math.hypot(fx, fz) || 1.0;
        const forwardX = fx / forwardLen;
        const forwardZ = fz / forwardLen;

        // right vector in XZ plane
        const rightX = forwardZ;
        const rightZ = -forwardX;

        let moveX = 0, moveZ = 0;
        if (moveKeys.w) { moveX += forwardX; moveZ += forwardZ; }
        if (moveKeys.s) { moveX -= forwardX; moveZ -= forwardZ; }
        if (moveKeys.a) { moveX += rightX; moveZ += rightZ; }
        if (moveKeys.d) { moveX -= rightX; moveZ -= rightZ; }

        // normalize (so diagonal isn't faster)
        const ml = Math.hypot(moveX, moveZ) || 0.0;
        let moved = false;
        if (ml > 0) {
            moveX = (moveX / ml) * moveSpeed * dt;
            moveZ = (moveZ / ml) * moveSpeed * dt;

            camera.eye[0] += moveX; camera.eye[2] += moveZ;
            camera.center[0] += moveX; camera.center[2] += moveZ;
            moved = true;
        }
        // vertical movement (Space = up, Ctrl = down)
        let dy = 0;
        if (moveUp) dy += verticalSpeed * dt;
        if (moveDown) dy -= verticalSpeed * dt;
        if (dy !== 0) {
            camera.eye[1] += dy;
            camera.center[1] += dy;
            moved = true;
        }
        return moved;
    }
    function animate() {
        // If paused, use the frozen time captured when pause occurred so
        // the world (ships, waves, etc.) stay still. When not paused compute
        // the normal elapsed time while accounting for any paused duration.
        const nowMs = Date.now();
        // compute dt for movement using wall-clock time (independent of simulation 'time')
        let dt = (nowMs - lastFrameTimeMs) * 0.001;
        // clamp to avoid huge jumps after long pauses
        if (dt > 0.2) dt = 0.2;
        lastFrameTimeMs = nowMs;

        const time = isPaused ? timeAtPause : (Date.now() - startTime - pausedDuration) * 0.001;

        // if we applied movement and are paused we want to render a single frame
        // reflecting the camera update; if animate is called while paused dt will be
        // used as a small movement step (see key handlers below).
        const moved = applyMovement(isPaused ? 1/60 : dt);
        const sliderValue = uniforms.boatRotationSpeed;
        const t = sliderValue / 10.0;
        const minSpeed = 0.01;
        const maxSpeed = 1.0;
        const shipSpeed = minSpeed + t * (maxSpeed - minSpeed);
        const shipRadius = 6.0;
        const shipX = Math.cos(time * shipSpeed) * shipRadius;
        const shipZ = Math.sin(time * shipSpeed) * shipRadius;
        const shipRot = time * shipSpeed;
        const wavesdfH = getWavesHeight([shipX, shipZ], time, uniforms.normIter);
        const watersdfY = wavesdfH * uniforms.waterDepth - uniforms.waterDepth;
        const invView = mat4Inverse(boatView);
        const invProj = mat4Inverse(boatProj);
        const sunDir = getSunDirection(time);
        // camera.eye[1] is controlled by the camHeight slider initially and by keyboard
        // vertical movement (Space / Ctrl). Do not override it here.
        boatView = mat4LookAt(camera.eye, camera.center, camera.up);

        gl.viewport(0, 0, canvas.width, canvas.height);
        gl.clearColor(0.0, 0.0, 0.0, 1.0);
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
        // boat model distance from center to bottom
        const scale = 1.5 / 100.0;
        const shipModelX = Math.cos(time * shipSpeed - Math.PI/2) * shipRadius;
        const shipModelZ = Math.sin(time * shipSpeed - Math.PI/2) * shipRadius;
        const yOffset = 25.895000457763672;
        const waveH = getWavesHeight([shipModelX, shipModelZ], time, uniforms.normIter);
        const waterY = waveH * uniforms.waterDepth - uniforms.waterDepth - yOffset * scale * 0.5;
        gl.uniform3f(gl.getUniformLocation(program, 'MODEL_BOAT_POSITION'), shipModelX, waterY, shipModelZ);

        if (boatProgram && boatVAO) {
            gl.enable(gl.DEPTH_TEST);
            gl.useProgram(boatProgram);
            gl.bindVertexArray(boatVAO);
            gl.activeTexture(gl.TEXTURE0);
            gl.bindTexture(gl.TEXTURE_2D, boatTexture);
            gl.uniform1i(boat_uTexture, 0);
            // world translation model
            const worldTranslate = new Float32Array([
                scale,0,0,0,
                0,scale,0,0,
                0,0,scale,0,
                shipModelX, waterY, shipModelZ, 1
            ]);
            // ship rotate
            const shipModelRot = -(time * shipSpeed + Math.PI);
            //calculate pitch and roll
            const delta = 0.3;
            const frontH = getWavesHeight([shipModelX + Math.cos(shipModelRot)*delta,shipModelZ + Math.sin(shipModelRot)*delta], time, uniforms.normIter);
            const backH  = getWavesHeight([shipModelX - Math.cos(shipModelRot)*delta,shipModelZ - Math.sin(shipModelRot)*delta], time, uniforms.normIter);
            const leftH  = getWavesHeight([shipModelX - Math.sin(shipModelRot)*delta,shipModelZ + Math.cos(shipModelRot)*delta],time, uniforms.normIter);
            const rightH = getWavesHeight([shipModelX + Math.sin(shipModelRot)*delta,shipModelZ - Math.cos(shipModelRot)*delta], time, uniforms.normIter);
            const pitchForce = (frontH - backH) * pitchStiffness;;
            const rollForce  = (leftH - rightH) * rollStiffness;
            const boat_dt = 0.16;
            const pitchRestoring = 2.5;
            const rollRestoring  = 2.5;
            pitchVelocity += (pitchForce - pitchAngle * pitchRestoring - pitchVelocity * pitchDamping) * boat_dt;
            rollVelocity  += (rollForce  - rollAngle  * rollRestoring  - rollVelocity  * rollDamping)  * boat_dt;
            pitchAngle += pitchVelocity * boat_dt;
            rollAngle  += rollVelocity  * boat_dt;
            const pitch = pitchAngle;
            const roll  = rollAngle;
            const rot = new Float32Array([
                Math.cos(shipModelRot), 0.0, -Math.sin(shipModelRot),0,
                0.0, 1.0, 0.0, 0,
                Math.sin(shipModelRot), 0.0, Math.cos(shipModelRot), 0,
                0, 0, 0, 1
            ]);
            const rotX = new Float32Array([
                1.0, 0.0, 0.0, 0,
                0.0, Math.cos(pitch), -Math.sin(pitch), 0,
                0.0, Math.sin(pitch), Math.cos(pitch), 0,
                0, 0, 0, 1
            ]);
            const rotZ = new Float32Array([
                Math.cos(roll), -Math.sin(roll), 0.0, 0,
                Math.sin(roll), Math.cos(roll), 0.0, 0,
                0.0, 0.0, 1.0, 0,
                0, 0, 0, 1
            ]);
            boatModel = mat4Multiply(rotZ,mat4Multiply(rotX,mat4Multiply(rot, worldTranslate)));

            // set uniforms
            gl.uniformMatrix4fv(gl.getUniformLocation(boatProgram, 'uModel'), false, boatModel);
            gl.uniformMatrix4fv(gl.getUniformLocation(boatProgram, 'uView'),  false, boatView);
            gl.uniformMatrix4fv(gl.getUniformLocation(boatProgram, 'uProj'),  false, boatProj);
            gl.uniform3f(gl.getUniformLocation(boatProgram, 'uLightDir'), sunDir[0], -sunDir[2], sunDir[1]);
            gl.uniform3f(gl.getUniformLocation(boatProgram, "uCameraPos"),camera.eye[0], camera.eye[1], camera.eye[2]);
            gl.uniform3f(gl.getUniformLocation(boatProgram, 'shipModelPos'), shipModelX, -shipModelZ, waterY);

            gl.drawElements(gl.TRIANGLES, boatIndexCount, gl.UNSIGNED_SHORT, 0);
            gl.bindVertexArray(null);
        }

        gl.enable(gl.DEPTH_TEST);
        gl.depthMask(false);
        gl.useProgram(program); // SDF shader

        gl.uniformMatrix4fv(gl.getUniformLocation(program, "uInvView"), false, invView);
        gl.uniformMatrix4fv(gl.getUniformLocation(program, "uInvProj"), false, invProj);
        gl.uniform3f(gl.getUniformLocation(program, "camPos"),camera.eye[0], camera.eye[1], camera.eye[2]);
        gl.uniform3f(gl.getUniformLocation(program, "camTarget"),camera.center[0], camera.center[1], camera.center[2]);
        gl.uniform2f(gl.getUniformLocation(program, 'iResolution'), canvas.width, canvas.height);
        gl.uniform1f(gl.getUniformLocation(program, 'iTime'), time);
        gl.uniform2f(gl.getUniformLocation(program, 'iMouse'), mouseX, mouseY);
        gl.uniform1f(gl.getUniformLocation(program, 'WATER_DEPTH'), uniforms.waterDepth);
        gl.uniform1f(gl.getUniformLocation(program, 'CAMERA_HEIGHT'), uniforms.camHeight);
        gl.uniform1i(gl.getUniformLocation(program, 'ITERATIONS_RAYMARCH'), uniforms.rayIter);
        gl.uniform1i(gl.getUniformLocation(program, 'ITERATIONS_NORMAL'), uniforms.normIter);
        gl.uniform3f(gl.getUniformLocation(program, 'SUN_DIR'), sunDir[0],sunDir[1], sunDir[2]);
        gl.uniform1f(gl.getUniformLocation(program, 'STAR_DENSITY'), uniforms.starDensity);
        gl.uniform1f(gl.getUniformLocation(program, 'BOAT_SPEED'), shipSpeed);

        // Calculate ship position moving in circle
        gl.uniform3f(gl.getUniformLocation(program, 'shipPos'), shipX, watersdfY, shipZ);
        gl.uniform1f(gl.getUniformLocation(program, 'shipRadius'), 2.0);
        // Calculate SDF ship pitch and roll
        const delta = 0.3;
        const frontH = getWavesHeight([shipX + Math.cos(shipRot)*delta,shipZ + Math.sin(shipRot)*delta], time, uniforms.normIter);
        const backH  = getWavesHeight([shipX - Math.cos(shipRot)*delta,shipZ - Math.sin(shipRot)*delta], time, uniforms.normIter);
        const leftH  = getWavesHeight([shipX - Math.sin(shipRot)*delta,shipZ + Math.cos(shipRot)*delta],time, uniforms.normIter);
        const rightH = getWavesHeight([shipX + Math.sin(shipRot)*delta,shipZ - Math.cos(shipRot)*delta], time, uniforms.normIter);
        const pitchForce = (frontH - backH) * pitchStiffness;;
        const rollForce  = (leftH - rightH) * rollStiffness;
        const boat_dt = 0.16;
        const pitchRestoring = 2.5;
        const rollRestoring  = 2.5;
        pitchVelocity += (pitchForce - pitchAngle * pitchRestoring - pitchVelocity * pitchDamping) * boat_dt;
        rollVelocity  += (rollForce  - rollAngle  * rollRestoring  - rollVelocity  * rollDamping)  * boat_dt;
        pitchAngle += pitchVelocity * boat_dt;
        rollAngle  += rollVelocity  * boat_dt;
        const pitch = pitchAngle;
        const roll  = rollAngle;
        gl.uniform1f(gl.getUniformLocation(program, 'shipRotation'), shipRot);
        gl.uniform1f(gl.getUniformLocation(program, 'shipPitch'), pitch);
        gl.uniform1f(gl.getUniformLocation(program, 'shipRoll'), roll);

        gl.uniformMatrix4fv(locView, false, boatView);
        gl.uniformMatrix4fv(locProj, false, boatProj);

        gl.bindVertexArray(vao);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        gl.bindVertexArray(null);
        gl.depthMask(true);

        // Continue animating only if not paused. When paused we intentionally stop
        // scheduling further frames so the scene remains frozen.
        if (!isPaused) {
            requestAnimationFrame(animate);
        }
    }

    // start the main loop
    animate();

    // Spacebar toggles pause/resume and WASD movement handling.
    // Don't toggle while typing / interacting with inputs.
    let pausedMoveInterval = null;
    window.addEventListener('keydown', (e) => {
        // only toggle on Space (code) and avoid toggling while user is interacting with input elements
        // handle WASD keys first
        const isTyping = (document.activeElement && (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'TEXTAREA' || document.activeElement.isContentEditable));
        if (!isTyping) {
            if (e.code === 'KeyW' || e.key === 'w' || e.key === 'W') { moveKeys.w = true; e.preventDefault(); }
            if (e.code === 'KeyA' || e.key === 'a' || e.key === 'A') { moveKeys.a = true; e.preventDefault(); }
            if (e.code === 'KeyS' || e.key === 's' || e.key === 'S') { moveKeys.s = true; e.preventDefault(); }
            if (e.code === 'KeyD' || e.key === 'd' || e.key === 'D') { moveKeys.d = true; e.preventDefault(); }
            // vertical movement keys
            if (e.code === 'Space' || e.key === ' ') { moveUp = true; e.preventDefault(); }
            if (e.code === 'ControlLeft' || e.code === 'ControlRight' || e.key === 'Control') { moveDown = true; e.preventDefault(); }

            // if paused and user started moving keys, render repeatedly while keys are held
            if (isPaused && (moveKeys.w || moveKeys.a || moveKeys.s || moveKeys.d || moveUp || moveDown) && pausedMoveInterval == null) {
                pausedMoveInterval = setInterval(() => {
                    // apply small step and render
                    applyMovement(1/60);
                    animate();
                }, 1000/60);
            }
        }

        if (e.code === 'KeyP') {
            const ae = document.activeElement;
            const activeTag = ae ? ae.tagName : '';
            // we already handled input typing above - protect space too
            const typingHere = (activeTag === 'INPUT' || activeTag === 'TEXTAREA' || (ae && ae.isContentEditable));
            if (typingHere) return; // ignore when focused on form inputs

            e.preventDefault();
            if (!isPaused) {
                // pause: record when it started, and capture current frozen time
                isPaused = true;
                pauseStart = Date.now();
                // timeAtPause is measured in seconds and used while paused
                timeAtPause = (pauseStart - startTime - pausedDuration) * 0.001;
                // keep isMouseDown state so dragging remains possible while paused
                if (pauseOverlay) pauseOverlay.hidden = false;
            } else {
                // resume
                isPaused = false;
                pausedDuration += (Date.now() - pauseStart);
                pauseStart = 0;
                if (pauseOverlay) pauseOverlay.hidden = true;
                // restart the animation loop
                // sync last mouse references so there is no sudden jump when resuming
                lastMouseX = mouseX;
                lastMouseY = mouseY;
                // clear paused movement interval if any (the main loop will handle movement)
                if (pausedMoveInterval) { clearInterval(pausedMoveInterval); pausedMoveInterval = null; }
                // reset frame timer to avoid a big dt on resume
                lastFrameTimeMs = Date.now();
                requestAnimationFrame(animate);
            }
        }
    });

    // Keyup to end WASD movement
    window.addEventListener('keyup', (e) => {
        if (e.code === 'KeyW' || e.key === 'w' || e.key === 'W') moveKeys.w = false;
        if (e.code === 'KeyA' || e.key === 'a' || e.key === 'A') moveKeys.a = false;
        if (e.code === 'KeyS' || e.key === 's' || e.key === 'S') moveKeys.s = false;
        if (e.code === 'KeyD' || e.key === 'd' || e.key === 'D') moveKeys.d = false;
        if (e.code === 'Space' || e.key === ' ') moveUp = false;
        if (e.code === 'ControlLeft' || e.code === 'ControlRight' || e.key === 'Control') moveDown = false;

        // If no movement keys are down and we were doing paused movement, stop interval.
        if (pausedMoveInterval && !(moveKeys.w || moveKeys.a || moveKeys.s || moveKeys.d || moveUp || moveDown)) {
            clearInterval(pausedMoveInterval);
            pausedMoveInterval = null;
        }
    });
}).catch(err => {
    console.error('Failed to load shaders or models:', err);
    // Add an extra hint for the common file:// case
    if (location.protocol === 'file:') {
        console.error('Hint: You are opening the page directly from the filesystem (file://). Start a local HTTP server and open via http:// to allow fetch() to load external shader files.');
    }
});

window.addEventListener('resize', () => {
    // Respect resolutionScale when resizing
    canvas.width = Math.max(1, Math.floor(window.innerWidth * resolutionScale));
    canvas.height = Math.max(1, Math.floor(window.innerHeight * resolutionScale));
    gl.viewport(0, 0, canvas.width, canvas.height);
    // update boat projection aspect
    boatProj = mat4Perspective(Math.PI/4, canvas.width / canvas.height, 0.1, 500.0);
});