/**
 * Image compressor handling PNG (lossless via UPNG.js) and JPG (lossy via jpeg-js).
 */
var ImageCompressor = (function () {
  /**
   * Compresses a PNG image by decoding and re-encoding with optimized settings.
   * @param {Uint8Array} data - Raw PNG file bytes.
   * @returns {object} Object with compressedData (Uint8Array) and pixelData for verification.
   */
  function compressPNG(data) {
    var img = UPNG.decode(data.buffer);
    var rgba = UPNG.toRGBA8(img);
    var reEncoded = UPNG.encode(rgba, img.width, img.height, 0);
    return {
      compressedData: new Uint8Array(reEncoded),
      width: img.width,
      height: img.height,
      originalPixels: new Uint8Array(rgba[0])
    };
  }

  /**
   * Decompresses a PNG file (PNG is self-contained, returns pixel data for verification).
   * @param {Uint8Array} data - PNG file bytes.
   * @returns {object} Object with decompressedData and pixelData.
   */
  function decompressPNG(data) {
    var img = UPNG.decode(data.buffer);
    var rgba = UPNG.toRGBA8(img);
    return {
      decompressedData: data,
      width: img.width,
      height: img.height,
      pixels: new Uint8Array(rgba[0])
    };
  }

  /**
   * Compresses a JPEG image by decoding to pixels and re-encoding at lower quality.
   * @param {Uint8Array} data - Raw JPEG file bytes.
   * @param {number} quality - JPEG quality (1-100). Default: 50.
   * @returns {object} Object with compressedData, originalPixels, width, height.
   */
  function compressJPG(data, quality) {
    quality = quality || 50;
    var jpegJs = window["jpeg-js"] || {};
    var decoded = jpegJs.decode(data, { useTArray: true, formatAsRGBA: true });
    var encoded = jpegJs.encode({
      data: decoded.data,
      width: decoded.width,
      height: decoded.height
    }, quality);
    return {
      compressedData: new Uint8Array(encoded.data),
      width: decoded.width,
      height: decoded.height,
      originalPixels: decoded.data
    };
  }

  /**
   * Decodes a JPEG file to pixel data for quality comparison.
   * @param {Uint8Array} data - JPEG file bytes.
   * @returns {object} Object with pixels, width, height.
   */
  function decompressJPG(data) {
    var jpegJs = window["jpeg-js"] || {};
    var decoded = jpegJs.decode(data, { useTArray: true, formatAsRGBA: true });
    return {
      decompressedData: data,
      width: decoded.width,
      height: decoded.height,
      pixels: decoded.data
    };
  }

  /**
   * Returns the compressed filename for an image.
   * @param {string} originalName - Original filename.
   * @param {string} extension - File extension (.png or .jpg).
   * @returns {string} Compressed filename.
   */
  function getCompressedFilename(originalName, extension) {
    var baseName = originalName.substring(0, originalName.lastIndexOf("."));
    return baseName + "_compressed" + extension;
  }

  return {
    compressPNG: compressPNG,
    decompressPNG: decompressPNG,
    compressJPG: compressJPG,
    decompressJPG: decompressJPG,
    getCompressedFilename: getCompressedFilename
  };
})();
