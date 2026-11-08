// Runs the stock mpv Anime4K x2 shader variants in WebGL2.
const renderers = new Map();
let queue = Promise.resolve();

// Replace the stock bilinear RGB base while preserving the Anime4K residual.
const colorRefinement = `
uniform bool refineColor;

vec4 cubicWeights(float t) {
    float t2 = t * t;
    float t3 = t2 * t;
    return vec4(-0.5*t + t2 - 0.5*t3, 1.0 - 2.5*t2 + 1.5*t3,
                0.5*t + 2.0*t2 - 1.5*t3, -0.5*t2 + 0.5*t3);
}

vec3 rgbBase(vec2 uv) {
    ivec2 size = textureSize(src_MAIN, 0);
    vec2 pixel = uv * vec2(size) - 0.5;
    ivec2 origin = ivec2(floor(pixel));
    vec4 wx = cubicWeights(fract(pixel.x));
    vec4 wy = cubicWeights(fract(pixel.y));
    vec3 result = vec3(0.0);
    vec3 low = vec3(1.0), high = vec3(0.0);
    for (int y = 0; y < 4; y++) {
        for (int x = 0; x < 4; x++) {
            ivec2 coord = clamp(origin + ivec2(x - 1, y - 1), ivec2(0), size - 1);
            vec3 value = texelFetch(src_MAIN, coord, 0).rgb;
            result += value * wx[x] * wy[y];
            if (x >= 1 && x <= 2 && y >= 1 && y <= 2) {
                low = min(low, value);
                high = max(high, value);
            }
        }
    }
    return clamp(result, low, high);
}
`;

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
${final ? colorRefinement : ''}
${body}
void main() {
    pos = ${final ? 'vec2(uv.x, 1.0 - uv.y)' : 'uv'};
    ${final ? `vec3 rgb = hook().rgb;
    if (refineColor) rgb += rgbBase(pos) - MAIN_tex(pos).rgb;
    color = vec4(rgb, 1.0);` : 'color = hook();'}
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
    return { program, inputs, output, final, refineColor: final ? gl.getUniformLocation(program, 'refineColor') : null };
}

async function initialize(model) {
    const response = await fetch('anime4k-' + model + '.glsl');
    if (!response.ok) throw new Error('Shader original do Community indisponível.');
    const chunks = (await response.text()).split(/^\/\/!DESC /m).slice(1);
    if (!chunks.length) throw new Error('Shader Anime4K incompatível.');
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
    const passes = chunks.map((chunk, index) => buildPass(gl, vertex, chunk, index === chunks.length - 1));
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

function draw({ canvas, gl, passes, framebuffer }, image, w, h, refineColor) {
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
            if (pass.refineColor) gl.uniform1i(pass.refineColor, Number(refineColor));
            pass.inputs.forEach((name, i) => {
                gl.activeTexture(gl.TEXTURE0 + i);
                gl.bindTexture(gl.TEXTURE_2D, textures.get(name));
            });
            gl.drawArrays(gl.TRIANGLES, 0, 3);
        }
        if (gl.getError() !== gl.NO_ERROR) throw new Error('A GPU não conseguiu processar a página.');
    } finally {
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        for (const value of textures.values()) gl.deleteTexture(value);
    }
}

async function render(image, model, repetitions, refineColor, stillNeeded) {
    if (!stillNeeded()) return;
    if (!renderers.has(model)) {
        renderers.set(model, initialize(model).catch(error => {
            renderers.delete(model);
            throw error;
        }));
    }
    const renderer = await renderers.get(model);
    const { canvas, gl, maximum } = renderer;
    if (!stillNeeded()) return;
    if (gl.isContextLost()) {
        renderers.delete(model);
        throw new Error('A GPU interrompeu o Anime4K.');
    }
    const width = image.naturalWidth;
    const height = image.naturalHeight;
    const fits = scale => width * scale <= maximum && height * scale <= maximum &&
        width * height * scale * scale <= 16000000;
    const count = repetitions === 2 && fits(4) ? 2 : 1;
    if (!width || !height || !fits(2)) throw new Error('Página grande demais para Anime4K.');
    let input = image;
    try {
        for (let i = 0; i < count; i++) {
            if (!stillNeeded()) return;
            const scale = 2 ** i;
            draw(renderer, input, width * scale, height * scale, refineColor);
            if (i + 1 < count) input = await createImageBitmap(canvas);
        }
        const blob = await new Promise((resolve, reject) => {
            canvas.toBlob(value => {
                if (value) resolve(value);
                else reject(new Error('Falha ao exibir a página com Anime4K.'));
            });
        });
        return { blob, width: canvas.width, height: canvas.height, passes: count };
    } finally {
        if (input !== image) input.close();
        canvas.width = canvas.height = 1;
    }
}

export function upscaleImage(image, model, repetitions, refineColor, stillNeeded) {
    const job = queue.then(() => render(image, model, repetitions, refineColor, stillNeeded));
    queue = job.catch(() => {});
    return job;
}

function nativeTilePlan(width, height, side, overlap = 24) {
    const rows = [];
    for (let y = 0; y < height; y += side) {
        const row = [];
        for (let x = 0; x < width; x += side) {
            const coreWidth = Math.min(side, width - x);
            const coreHeight = Math.min(side, height - y);
            const left = Math.max(0, x - overlap);
            const top = Math.max(0, y - overlap);
            const right = Math.min(width, x + coreWidth + overlap);
            const bottom = Math.min(height, y + coreHeight + overlap);
            row.push({ x, y, coreWidth, coreHeight, left, top,
                inputWidth: right - left, inputHeight: bottom - top });
        }
        rows.push(row);
    }
    return rows;
}

function nativeWholeFits(width, height, scale) {
    return width > 0 && height > 0 && width * scale <= 16384 &&
        height * scale <= 16384 && width * height * scale * scale <= 24000000;
}

async function nativeCanvasBlob(canvas) {
    return new Promise((resolve, reject) => canvas.toBlob(blob =>
        blob ? resolve(blob) : reject(new Error('Não foi possível preparar a página.')), 'image/png'));
}

async function nativeRequest(input, model, signal) {
    signal.throwIfAborted();
    const response = await fetch('restore/' + model, {
        method: 'POST', headers: { 'Content-Type': 'image/png', 'x-reader-request': '1' },
        body: input, signal
    });
    if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.error || 'O modelo Vulkan não conseguiu processar esta página.');
    }
    return response.blob();
}

async function nativeProcessRegion(image, region, model, scale, signal) {
    const canvas = document.createElement('canvas');
    canvas.width = region.inputWidth;
    canvas.height = region.inputHeight;
    try {
        const ctx = canvas.getContext('2d', { alpha: false });
        if (!ctx) throw new Error('Não foi possível preparar o bloco de imagem.');
        ctx.drawImage(image, region.left, region.top, region.inputWidth, region.inputHeight,
            0, 0, region.inputWidth, region.inputHeight);
        const input = await nativeCanvasBlob(canvas);
        signal.throwIfAborted();
        const upscaled = await nativeRequest(input, model, signal);
        if (region.inputWidth === region.coreWidth && region.inputHeight === region.coreHeight)
            return { blob: upscaled, width: region.coreWidth * scale, height: region.coreHeight * scale };
        const bitmap = await createImageBitmap(upscaled);
        try {
            signal.throwIfAborted();
            const outputWidth = region.coreWidth * scale;
            const outputHeight = region.coreHeight * scale;
            canvas.width = outputWidth;
            canvas.height = outputHeight;
            const outputCtx = canvas.getContext('2d', { alpha: false });
            if (!outputCtx) throw new Error('Não foi possível reunir os blocos.');
            outputCtx.drawImage(bitmap, (region.x - region.left) * scale,
                (region.y - region.top) * scale, outputWidth, outputHeight,
                0, 0, outputWidth, outputHeight);
            return { blob: await nativeCanvasBlob(canvas), width: outputWidth, height: outputHeight };
        } finally {
            bitmap.close();
        }
    } finally {
        canvas.width = canvas.height = 1;
    }
}

export async function upscaleNative(image, model, scale, signal, onProgress = () => {}) {
    const { naturalWidth: width, naturalHeight: height } = image;
    if (!width || !height) throw new Error('A página ainda não foi carregada.');
    signal.throwIfAborted();
    if (nativeWholeFits(width, height, scale)) {
        try {
            const part = await nativeProcessRegion(image, {
                x: 0, y: 0, left: 0, top: 0, inputWidth: width, inputHeight: height,
                coreWidth: width, coreHeight: height
            }, model, scale, signal);
            return { ...part, scale };
        } catch (error) {
            if (signal.aborted || !/limite|resolu|mem[oó]ria|processar|processamento|tempo|sa[ií]da|entrada/i.test(error.message))
                throw error;
        }
    }
    let lastError;
    for (const side of (scale >= 4 ? [640, 384, 256] : [1024, 640, 384])) {
        const plan = nativeTilePlan(width, height, side);
        const total = plan.reduce((sum, row) => sum + row.length, 0);
        const rows = [];
        let done = 0;
        try {
            for (const row of plan) {
                const pieces = [];
                for (const region of row) {
                    signal.throwIfAborted();
                    pieces.push(await nativeProcessRegion(image, region, model, scale, signal));
                    onProgress(++done, total);
                }
                rows.push(pieces);
            }
            return { rows, width: width * scale, height: height * scale, scale, tiled: true };
        } catch (error) {
            if (signal.aborted || !/limite|resolu|mem[oó]ria|processar|processamento|tempo|sa[ií]da|entrada/i.test(error.message))
                throw error;
            lastError = error;
        }
    }
    throw lastError || new Error('Não foi possível processar esta página por blocos.');
}
