'use strict';

// Accept only genuine image payloads: some manga engines return a generic
// application/octet-stream content type even for valid JPEG/PNG/WebP pages.
function detectImageType(bytes) {
    if (!Buffer.isBuffer(bytes) || bytes.length < 4) return null;
    if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)
        return 'image/jpeg';
    if (bytes.length >= 8 &&
        bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])))
        return 'image/png';
    if (bytes.length >= 6 &&
        (bytes.toString('ascii', 0, 6) === 'GIF87a' ||
            bytes.toString('ascii', 0, 6) === 'GIF89a'))
        return 'image/gif';
    if (bytes.length >= 12 && bytes.toString('ascii', 0, 4) === 'RIFF' &&
        bytes.toString('ascii', 8, 12) === 'WEBP')
        return 'image/webp';
    if (bytes.length >= 16 && bytes.toString('ascii', 4, 8) === 'ftyp' &&
        ['avif', 'avis'].includes(bytes.toString('ascii', 8, 12)))
        return 'image/avif';
    return null;
}

function imageHttpError(status) {
    const code = Number(status);
    let message = 'A fonte não conseguiu entregar a imagem (HTTP ' + code + ').';
    if (code === 401 || code === 403)
        message = 'A fonte bloqueou o acesso à imagem (HTTP ' + code + '). Pode exigir login.';
    else if (code === 404 || code === 410)
        message = 'O link da imagem expirou ou não existe mais (HTTP ' + code + ').';
    else if (code === 429)
        message = 'A fonte limitou as requisições de imagens (HTTP 429). Tente novamente mais tarde.';
    const error = new Error(message);
    error.status = code;
    return error;
}
module.exports = { detectImageType, imageHttpError };
