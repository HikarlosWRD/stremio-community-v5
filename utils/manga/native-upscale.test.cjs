const assert = require('node:assert/strict');
const test = require('node:test');
const { models, validateImage } = require('./reader/native-upscale');

function header(width, height) {
    const image = Buffer.from('89504e470d0a1a0a0000000d494844520000000000000000', 'hex');
    image.writeUInt32BE(width, 16);
    image.writeUInt32BE(height, 20);
    return image;
}

test('native models accept the original benchmark page at their fixed scales', () => {
    assert.deepEqual(validateImage(header(690, 1491), models.realcugan.scale), { width: 690, height: 1491 });
    assert.deepEqual(validateImage(header(690, 1491), models.realesrgan.scale), { width: 690, height: 1491 });
    assert.equal(models.realcugan.scale, 2);
    assert.equal(models.realesrgan.scale, 4);
});

test('native input rejects invalid PNG headers and oversized decoded results', () => {
    assert.throws(() => validateImage(Buffer.from('fake PNG'), 4), /PNG/);
    assert.throws(() => validateImage(header(0, 100), 2), /limite/);
    assert.throws(() => validateImage(header(1000, 3000), 4), /limite/);
});
