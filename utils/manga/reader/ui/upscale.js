// Runs the stock mpv Anime4K x2 small shader with the same five passes in WebGL2.
let renderer;
let queue = Promise.resolve();

function compile(gl, kind, source) {
    const shader = gl.createShader(kind);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        console.warn(gl.getShaderInfoLog(shader));
        gl.deleteShader(shader);
        throw new Error('Não foi possível compilar o Anime4K.');
    }
    return shader;
}

function buildPass(gl, vertex, chunk, final) {
    const inputs = Array.from(chunk.matchAll(/^\/\/!BIND (\w+)\s*$/gm), m => m[1]);
    const output = chunk.match(/^\/\/!SAVE (\w+)\s*$/m)?.[1];
    if (!inputs.length || !output || final !== (output === 'MAIN'))
        throw new Error('Shader Anime4K incompatível.');

    const aliases = inputs.map(name => `
uniform sampler2D src_${name};
#define ${name}_pos pos
#define ${name}_size vec2(textureSize(src_${name}, 0))
#define ${name}_pt (1.0 / ${name}_size)
#define ${name}_tex(p) texture(src_${name}, (p))
#define ${name}_texOff(p) ${name}_tex(pos + (p) * ${name}_pt)
`).join('\n');
    const body = chunk.split('\n').slice(1).join('\n');
    const fragment = compile(gl, gl.FRAGMENT_SHADER, `#version 300 es
precision highp float;
in vec2 uv;
out vec4 color;
vec2 pos;
${aliases}
${body}
void main() {
    pos = ${final ? 'vec2(uv.x, 1.0 - uv.y)' : 'uv'};
    color = ${final ? 'vec4(hook().rgb, 1.0)' : 'hook()'};
}`);
    const program = gl.createProgram();
    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.linkProgram(program);
    gl.deleteShader(fragment);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        console.warn(gl.getProgramInfoLog(program));
        gl.deleteProgram(program);
        throw new Error('Não foi possível ativar o Anime4K.');
    }
    gl.useProgram(program);
    inputs.forEach((name, i) => gl.uniform1i(gl.getUniformLocation(program, 'src_' + name), i));
    return { program, inputs, output, final };
}

async function initialize() {
    const response = await fetch('anime4k.glsl');
    if (!response.ok) throw new Error('Shader original do Community indisponível.');
    const chunks = (await response.text()).split(/^\/\/!DESC /m).slice(1);
    if (chunks.length !== 5) throw new Error('Shader Anime4K incompatível.');
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2', { alpha: false, antialias: false, depth: false });
    if (!gl || !gl.getExtension('EXT_color_buffer_float'))
        throw new Error('Anime4K requer WebGL 2 com buffers de ponto flutuante.');
    const vertex = compile(gl, gl.VERTEX_SHADER, `#version 300 es
out vec2 uv;
void main() {
    uv = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
    gl_Position = vec4(uv * 2.0 - 1.0, 0.0, 1.0);
}`);
    const passes = chunks.map((chunk, index) => buildPass(gl, vertex, chunk, index === 4));
    gl.deleteShader(vertex);
    return { canvas, gl, passes, framebuffer: gl.createFramebuffer(),
        maximum: gl.getParameter(gl.MAX_TEXTURE_SIZE) };
}

function texture(gl, smooth) {
    const value = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, value);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, smooth ? gl.LINEAR : gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, smooth ? gl.LINEAR : gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return value;
}

async function render(image, stillNeeded) {
    if (!stillNeeded()) return;
    renderer ??= initialize().catch(error => { renderer = undefined; throw error; });
    const { canvas, gl, passes, framebuffer, maximum } = await renderer;
    if (!stillNeeded()) return;
    if (gl.isContextLost()) {
        renderer = undefined;
        throw new Error('A GPU interrompeu o Anime4K.');
    }
    const w = image.naturalWidth;
    const h = image.naturalHeight;
    if (!w || !h || w * 2 > maximum || h * 2 > maximum || w * h * 4 > 16000000)
        throw new Error('Página grande demais para Anime4K 2×.');
    canvas.width = w * 2;
    canvas.height = h * 2;
    const textures = new Map();
    try {
        textures.set('MAIN', texture(gl, true));
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, image);
        for (const pass of passes) {
            gl.bindFramebuffer(gl.FRAMEBUFFER, pass.final ? null : framebuffer);
            if (!pass.final) {
                const target = texture(gl, false);
                textures.set(pass.output, target);
                gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.HALF_FLOAT, null);
                gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, target, 0);
                if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE)
                    throw new Error('A GPU não conseguiu criar o buffer do Anime4K.');
            }
            gl.viewport(0, 0, pass.final ? w * 2 : w, pass.final ? h * 2 : h);
            gl.useProgram(pass.program);
            pass.inputs.forEach((name, i) => {
                gl.activeTexture(gl.TEXTURE0 + i);
                gl.bindTexture(gl.TEXTURE_2D, textures.get(name));
            });
            gl.drawArrays(gl.TRIANGLES, 0, 3);
        }
        if (gl.getError() !== gl.NO_ERROR) throw new Error('A GPU não conseguiu processar a página.');
        return await new Promise((resolve, reject) => {
            canvas.toBlob(blob => {
                if (blob) resolve(blob);
                else reject(new Error('Falha ao exibir a página com Anime4K.'));
            });
        });
    } finally {
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        for (const value of textures.values()) gl.deleteTexture(value);
    }
}

export function upscaleImage(image, stillNeeded) {
    const job = queue.then(() => render(image, stillNeeded));
    queue = job.catch(() => {});
    return job;
}
