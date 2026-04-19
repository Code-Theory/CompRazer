/**
 * Text file compressor using GZIP via fflate library.
 * Handles .txt and .csv files with lossless compression.
 */
var TextCompressor = (function () {
  /**
   * Compresses text file data using GZIP at maximum compression level.
   * @param {Uint8Array} data - Raw file bytes.
   * @returns {Uint8Array} GZIP-compressed bytes.
   */
  function compress(data) {
    return fflate.gzipSync(data, { level: 9 });
  }

  /**
   * Decompresses GZIP-compressed data back to original bytes.
   * @param {Uint8Array} compressedData - GZIP-compressed bytes.
   * @returns {Uint8Array} Decompressed original bytes.
   */
  function decompress(compressedData) {
    return fflate.gunzipSync(compressedData);
  }

  /**
   * Returns the file extension for the compressed output.
   * @param {string} originalName - Original filename.
   * @returns {string} Compressed filename with .gz appended.
   */
  function getCompressedFilename(originalName) {
    return originalName + ".gz";
  }

  /**
   * Returns the file extension for the decompressed output.
   * @param {string} compressedName - Compressed filename.
   * @returns {string} Decompressed filename with .gz removed.
   */
  function getDecompressedFilename(compressedName) {
    if (compressedName.endsWith(".gz")) {
      return compressedName.slice(0, -3);
    }
    return "decompressed_" + compressedName;
  }

  return {
    compress: compress,
    decompress: decompress,
    getCompressedFilename: getCompressedFilename,
    getDecompressedFilename: getDecompressedFilename
  };
})();
