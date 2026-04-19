/**
 * Quality metrics for evaluating lossy compression.
 * Includes PSNR, SSIM, and bit-rate comparison.
 */
var Metrics = (function () {
  /**
   * Computes compression metrics from original and compressed sizes.
   * @param {number} originalSize - Original file size in bytes.
   * @param {number} compressedSize - Compressed file size in bytes.
   * @returns {object} Object with ratio and savingsPercent.
   */
  function computeCompressionMetrics(originalSize, compressedSize) {
    var ratio = originalSize / compressedSize;
    var savingsPercent = ((originalSize - compressedSize) / originalSize) * 100;
    return {
      ratio: ratio.toFixed(2),
      savingsPercent: savingsPercent.toFixed(1)
    };
  }

  /**
   * Computes Peak Signal-to-Noise Ratio between two pixel arrays.
   * Both arrays should be Uint8Array of RGBA pixel data (same dimensions).
   * @param {Uint8Array} original - Original image pixel data (RGBA).
   * @param {Uint8Array} compressed - Compressed image pixel data (RGBA).
   * @returns {number} PSNR value in dB. Returns Infinity if images are identical.
   */
  function computePSNR(original, compressed) {
    var pixelCount = original.length / 4;
    var mse = 0;
    var sampleCount = 0;

    for (var i = 0; i < original.length; i += 4) {
      /* Compare R, G, B channels, skip alpha */
      for (var channel = 0; channel < 3; channel++) {
        var diff = original[i + channel] - compressed[i + channel];
        mse += diff * diff;
        sampleCount++;
      }
    }

    mse = mse / sampleCount;
    if (mse === 0) return Infinity;
    return 10 * Math.log10((255 * 255) / mse);
  }

  /**
   * Computes global-mean Structural Similarity Index (SSIM) between two images.
   * Uses the entire image as a single window for simplicity.
   * @param {Uint8Array} original - Original image pixel data (RGBA).
   * @param {Uint8Array} compressed - Compressed image pixel data (RGBA).
   * @returns {number} SSIM value between 0 and 1.
   */
  function computeSSIM(original, compressed) {
    var C1 = (0.01 * 255) * (0.01 * 255);
    var C2 = (0.03 * 255) * (0.03 * 255);

    /* Convert to grayscale luminance for SSIM */
    var length = original.length / 4;
    var origLum = new Float32Array(length);
    var compLum = new Float32Array(length);

    for (var i = 0; i < length; i++) {
      var idx = i * 4;
      origLum[i] = 0.299 * original[idx] + 0.587 * original[idx + 1] + 0.114 * original[idx + 2];
      compLum[i] = 0.299 * compressed[idx] + 0.587 * compressed[idx + 1] + 0.114 * compressed[idx + 2];
    }

    /* Compute means */
    var muX = 0, muY = 0;
    for (var i = 0; i < length; i++) {
      muX += origLum[i];
      muY += compLum[i];
    }
    muX /= length;
    muY /= length;

    /* Compute variances and covariance */
    var sigmaX2 = 0, sigmaY2 = 0, sigmaXY = 0;
    for (var i = 0; i < length; i++) {
      var dx = origLum[i] - muX;
      var dy = compLum[i] - muY;
      sigmaX2 += dx * dx;
      sigmaY2 += dy * dy;
      sigmaXY += dx * dy;
    }
    sigmaX2 /= length;
    sigmaY2 /= length;
    sigmaXY /= length;

    /* SSIM formula */
    var numerator = (2 * muX * muY + C1) * (2 * sigmaXY + C2);
    var denominator = (muX * muX + muY * muY + C1) * (sigmaX2 + sigmaY2 + C2);

    return numerator / denominator;
  }

  /**
   * Formats a bit-rate comparison between original and compressed audio/video.
   * @param {number} originalSize - Original file size in bytes.
   * @param {number} compressedSize - Compressed file size in bytes.
   * @param {number} duration - Duration in seconds.
   * @returns {object} Object with originalBitrate and compressedBitrate in kbps.
   */
  function computeBitRateComparison(originalSize, compressedSize, duration) {
    var originalBitrate = (originalSize * 8) / duration / 1000;
    var compressedBitrate = (compressedSize * 8) / duration / 1000;
    return {
      originalBitrate: originalBitrate.toFixed(0),
      compressedBitrate: compressedBitrate.toFixed(0)
    };
  }

  return {
    computeCompressionMetrics: computeCompressionMetrics,
    computePSNR: computePSNR,
    computeSSIM: computeSSIM,
    computeBitRateComparison: computeBitRateComparison
  };
})();
