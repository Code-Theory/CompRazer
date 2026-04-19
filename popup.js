/**
 * Main popup UI controller for compRazor.
 * Handles file selection, compression dispatch, metrics display,
 * decompression, and rebuild verification.
 */
(function () {
  /* --- State --- */
  var currentFile = null;
  var currentExtension = "";
  var currentTypeInfo = null;
  var originalBytes = null;
  var originalHash = null;
  var compressedBytes = null;
  var compressedFilename = "";
  var residualBytes = null;
  var residualFilename = "";
  var originalPixels = null;
  var imageWidth = 0;
  var imageHeight = 0;
  var audioDuration = 0;
  var audioOriginalBitrate = 0;
  var audioCompressedBitrate = 0;
  var videoFallback = false;

  /* --- DOM Elements --- */
  var fileInput = document.getElementById("fileInput");
  var fileInfo = document.getElementById("fileInfo");
  var fileName = document.getElementById("fileName");
  var fileSize = document.getElementById("fileSize");
  var fileType = document.getElementById("fileType");
  var detectedType = document.getElementById("detectedType");
  var algorithm = document.getElementById("algorithm");
  var compressBtn = document.getElementById("compressBtn");
  var progressBar = document.getElementById("progressBar");
  var progressFill = document.getElementById("progressFill");
  var resultsSection = document.getElementById("resultsSection");
  var originalSizeEl = document.getElementById("originalSize");
  var compressedSizeEl = document.getElementById("compressedSize");
  var compressionRatioEl = document.getElementById("compressionRatio");
  var spaceSavingsEl = document.getElementById("spaceSavings");
  var downloadCompressedBtn = document.getElementById("downloadCompressed");
  var downloadResidualBtn = document.getElementById("downloadResidual");
  var rebuildSection = document.getElementById("rebuildSection");
  var decompressInput = document.getElementById("decompressInput");
  var verificationResult = document.getElementById("verificationResult");
  var downloadDecompressedBtn = document.getElementById("downloadDecompressed");
  var errorMessage = document.getElementById("errorMessage");

  /* --- Event Listeners --- */

  fileInput.addEventListener("change", handleFileSelect);
  compressBtn.addEventListener("click", handleCompress);
  downloadCompressedBtn.addEventListener("click", handleDownloadCompressed);
  downloadResidualBtn.addEventListener("click", handleDownloadResidual);
  decompressInput.addEventListener("change", handleDecompress);
  downloadDecompressedBtn.addEventListener("click", handleDownloadDecompressed);

  /**
   * Handles file selection from the file input.
   * Reads the file, detects type, and shows file info.
   */
  function handleFileSelect() {
    hideError();
    resetResults();

    var file = fileInput.files[0];
    if (!file) return;

    var ext = FileUtils.getExtension(file.name);
    var typeInfo = FileUtils.getFileTypeInfo(ext);

    if (!typeInfo) {
      showError("Unsupported file type. Please upload .txt, .csv, .png, .jpg, .mp3, .wav, or .mp4");
      return;
    }

    if (file.size > 50 * 1024 * 1024) {
      showError("File too large. Maximum supported size is 50 MB.");
      return;
    }

    currentFile = file;
    currentExtension = ext;
    currentTypeInfo = typeInfo;

    fileName.textContent = file.name;
    fileSize.textContent = FileUtils.formatSize(file.size);
    fileInfo.classList.remove("hidden");

    detectedType.textContent = typeInfo.category + " (" + ext + ")";
    algorithm.textContent = typeInfo.algorithm;
    fileType.classList.remove("hidden");

    compressBtn.classList.remove("hidden");
    compressBtn.disabled = false;
  }

  /**
   * Dispatches compression to the appropriate compressor based on file type.
   * Shows progress, computes metrics, and displays results.
   */
  async function handleCompress() {
    if (!currentFile) return;

    compressBtn.disabled = true;
    showProgress();
    hideError();

    try {
      var buffer = await FileUtils.readFileAsArrayBuffer(currentFile);
      originalBytes = new Uint8Array(buffer);

      /* Compute original hash for verification on both lossless and lossy paths */
      originalHash = await HashUtils.computeSHA256(buffer);

      var result;

      switch (currentExtension) {
        case ".txt":
        case ".csv":
          result = handleTextCompression(originalBytes);
          break;
        case ".png":
          result = handlePNGCompression(originalBytes);
          break;
        case ".jpg":
        case ".jpeg":
          result = handleJPGCompression(originalBytes);
          break;
        case ".wav":
          result = handleWAVCompression(originalBytes);
          break;
        case ".mp3":
          result = await handleMP3Compression(originalBytes);
          break;
        case ".mp4":
          result = await handleMP4Compression(originalBytes);
          break;
        default:
          throw new Error("Unsupported file type.");
      }

      compressedBytes = result.compressedData;
      compressedFilename = result.filename;
      residualBytes = null;
      residualFilename = "";

      /* For lossy types, also build a residual sidecar that enables
         reconstruction of the original. WAV uses a PCM-diff residual
         (smaller); other formats fall back to gzipped-original. */
      if (currentTypeInfo.type === "lossy") {
        var residualResult = await Residual.make(
          originalBytes,
          currentExtension,
          compressedBytes
        );
        residualBytes = residualResult.bytes;
        residualFilename = stripExtension(currentFile.name) + currentExtension + ".residual";
      }

      /* Display metrics. For lossy, show lossy size and total-with-residual. */
      var totalCompressed = compressedBytes.length + (residualBytes ? residualBytes.length : 0);
      var metrics = Metrics.computeCompressionMetrics(
        originalBytes.length,
        totalCompressed
      );

      originalSizeEl.textContent = FileUtils.formatSize(originalBytes.length);
      if (residualBytes) {
        compressedSizeEl.textContent =
          FileUtils.formatSize(compressedBytes.length) +
          " + " + FileUtils.formatSize(residualBytes.length) + " residual";
      } else {
        compressedSizeEl.textContent = FileUtils.formatSize(compressedBytes.length);
      }
      compressionRatioEl.textContent = metrics.ratio + " : 1";
      spaceSavingsEl.textContent = metrics.savingsPercent + "%";

      if (residualBytes) {
        downloadResidualBtn.classList.remove("hidden");
      } else {
        downloadResidualBtn.classList.add("hidden");
      }

      hideProgress();
      resultsSection.classList.remove("hidden");
      rebuildSection.classList.remove("hidden");

    } catch (err) {
      hideProgress();
      showError("Compression failed. " + (err.message || "The file may be corrupted or unsupported."));
      compressBtn.disabled = false;
    }
  }

  /**
   * Compresses a text file using GZIP.
   * @param {Uint8Array} data - File bytes.
   * @returns {object} Object with compressedData and filename.
   */
  function handleTextCompression(data) {
    var compressed = TextCompressor.compress(data);
    return {
      compressedData: compressed,
      filename: TextCompressor.getCompressedFilename(currentFile.name)
    };
  }

  /**
   * Compresses a PNG image losslessly.
   * @param {Uint8Array} data - File bytes.
   * @returns {object} Object with compressedData and filename.
   */
  function handlePNGCompression(data) {
    var result = ImageCompressor.compressPNG(data);
    originalPixels = result.originalPixels;
    imageWidth = result.width;
    imageHeight = result.height;
    return {
      compressedData: result.compressedData,
      filename: ImageCompressor.getCompressedFilename(currentFile.name, ".png")
    };
  }

  /**
   * Compresses a JPEG image with lossy re-encoding.
   * @param {Uint8Array} data - File bytes.
   * @returns {object} Object with compressedData and filename.
   */
  function handleJPGCompression(data) {
    var result = ImageCompressor.compressJPG(data, 50);
    originalPixels = result.originalPixels;
    imageWidth = result.width;
    imageHeight = result.height;
    return {
      compressedData: result.compressedData,
      filename: ImageCompressor.getCompressedFilename(currentFile.name, ".jpg")
    };
  }

  /**
   * Compresses a WAV file to MP3.
   * @param {Uint8Array} data - File bytes.
   * @returns {object} Object with compressedData and filename.
   */
  function handleWAVCompression(data) {
    var result = AudioCompressor.compressWAV(data, 128);
    audioDuration = result.duration;
    audioOriginalBitrate = result.originalBitrate;
    audioCompressedBitrate = result.compressedBitrate;
    return {
      compressedData: result.compressedData,
      filename: AudioCompressor.getCompressedFilename(currentFile.name, ".wav")
    };
  }

  /**
   * Re-encodes an MP3 at lower bitrate.
   * @param {Uint8Array} data - File bytes.
   * @returns {Promise<object>} Object with compressedData and filename.
   */
  async function handleMP3Compression(data) {
    var result = await AudioCompressor.compressMP3(data, 96);
    audioDuration = result.duration;
    audioOriginalBitrate = result.originalBitrate;
    audioCompressedBitrate = result.compressedBitrate;
    return {
      compressedData: result.compressedData,
      filename: AudioCompressor.getCompressedFilename(currentFile.name, ".mp3")
    };
  }

  /**
   * Compresses an MP4 video to WebM.
   * @param {Uint8Array} data - File bytes.
   * @returns {Promise<object>} Object with compressedData and filename.
   */
  async function handleMP4Compression(data) {
    var result = await VideoCompressor.compressMP4(data, 500000);
    videoFallback = result.fallback;
    audioDuration = result.duration;
    audioOriginalBitrate = result.originalBitrate;
    audioCompressedBitrate = result.compressedBitrate;
    return {
      compressedData: result.compressedData,
      filename: VideoCompressor.getCompressedFilename(currentFile.name, result.fallback)
    };
  }

  /**
   * Strips the final extension from a filename (e.g. "a.b.jpg" -> "a.b").
   */
  function stripExtension(name) {
    var dot = name.lastIndexOf(".");
    return dot === -1 ? name : name.substring(0, dot);
  }

  /**
   * Downloads the compressed file.
   */
  function handleDownloadCompressed() {
    if (!compressedBytes) return;
    var mimeType = "application/octet-stream";
    if (compressedFilename.endsWith(".gz")) mimeType = "application/gzip";
    else if (compressedFilename.endsWith(".png")) mimeType = "image/png";
    else if (compressedFilename.endsWith(".jpg")) mimeType = "image/jpeg";
    else if (compressedFilename.endsWith(".mp3")) mimeType = "audio/mpeg";
    else if (compressedFilename.endsWith(".webm")) mimeType = "video/webm";

    var blob = new Blob([compressedBytes], { type: mimeType });
    FileUtils.downloadBlob(blob, compressedFilename);
  }

  /**
   * Downloads the residual sidecar file.
   */
  function handleDownloadResidual() {
    if (!residualBytes) return;
    var blob = new Blob([residualBytes], { type: "application/octet-stream" });
    FileUtils.downloadBlob(blob, residualFilename);
  }

  /**
   * Handles decompression and rebuild verification.
   * For lossless: compares SHA-256 hashes.
   * For lossy: computes PSNR/SSIM or bit-rate comparison.
   */
  async function handleDecompress() {
    var files = decompressInput.files;
    if (!files || files.length === 0) return;

    hideError();

    try {
      /* Read every selected file and split into a residual (if any) and the
         remaining lossy/compressed companion. Order-independent. */
      var residual = null;
      var companion = null;
      for (var i = 0; i < files.length; i++) {
        var buf = await FileUtils.readFileAsArrayBuffer(files[i]);
        var bytes = new Uint8Array(buf);
        if (Residual.isResidual(bytes)) {
          residual = { bytes: bytes, name: files[i].name };
        } else {
          companion = { bytes: bytes, name: files[i].name };
        }
      }

      if (residual) {
        var rebuilt = await Residual.reconstruct(
          residual.bytes,
          companion ? companion.bytes : null
        );
        var rebuiltHash = await HashUtils.computeSHA256(rebuilt.original);

        if (originalHash) {
          var verified = HashUtils.compareHashes(originalHash, rebuiltHash);
          showVerification(
            verified ? "success" : "warning",
            "SHA-256 " + (verified ? "Match: Original reconstructed" : "Mismatch: reconstruction differs") +
            "\nOriginal: " + originalHash.substring(0, 16) + "..." +
            "\nRebuilt:  " + rebuiltHash.substring(0, 16) + "..."
          );
        } else {
          showVerification(
            "info",
            "Original reconstructed from residual\nSHA-256: " + rebuiltHash.substring(0, 16) + "..."
          );
        }

        var stemSource = companion ? companion.name : residual.name.replace(/\.residual$/, "");
        var stem = stemSource.replace(/\.[^.]+$/, "");
        window._decompressedBlob = new Blob([rebuilt.original]);
        window._decompressedFilename = "reconstructed_" + stem + rebuilt.extension;
        downloadDecompressedBtn.classList.remove("hidden");
        return;
      }

      /* No residual was provided: fall back to legacy per-type handling. */
      var file = files[0];
      var uploadedBytes = companion ? companion.bytes : new Uint8Array(await FileUtils.readFileAsArrayBuffer(file));

      if (currentTypeInfo.type === "lossless") {
        /* Lossless: decompress and compare hashes */
        var decompressedBytes;
        if (currentExtension === ".txt" || currentExtension === ".csv") {
          decompressedBytes = TextCompressor.decompress(uploadedBytes);
        } else if (currentExtension === ".png") {
          /* PNG is already a valid image, decode pixels for comparison */
          var pngResult = ImageCompressor.decompressPNG(uploadedBytes);
          decompressedBytes = uploadedBytes;
        }

        var decompressedHash = await HashUtils.computeSHA256(decompressedBytes.buffer || decompressedBytes);
        var match = HashUtils.compareHashes(originalHash, decompressedHash);

        showVerification(
          match ? "success" : "warning",
          "SHA-256 " + (match ? "Match: Verified" : "Mismatch: Files differ") +
          "\nOriginal: " + originalHash.substring(0, 16) + "..." +
          "\nRebuilt:  " + decompressedHash.substring(0, 16) + "..."
        );

        /* Store decompressed for download */
        window._decompressedBlob = new Blob([decompressedBytes]);
        if (currentExtension === ".txt" || currentExtension === ".csv") {
          window._decompressedFilename = TextCompressor.getDecompressedFilename(file.name);
        } else {
          window._decompressedFilename = "decompressed_" + file.name;
        }
        downloadDecompressedBtn.classList.remove("hidden");

      } else {
        /* Lossy: compute quality metrics */
        if (currentExtension === ".jpg" || currentExtension === ".jpeg") {
          var jpgResult = ImageCompressor.decompressJPG(uploadedBytes);

          if (originalPixels && jpgResult.pixels) {
            var psnr = Metrics.computePSNR(originalPixels, jpgResult.pixels);
            var ssim = Metrics.computeSSIM(originalPixels, jpgResult.pixels);
            showVerification(
              "info",
              "PSNR: " + psnr.toFixed(2) + " dB | SSIM: " + ssim.toFixed(4)
            );
          } else {
            showVerification("info", "Quality metrics unavailable (original data not in memory).");
          }

          window._decompressedBlob = new Blob([uploadedBytes], { type: "image/jpeg" });
          window._decompressedFilename = "decompressed_" + file.name;
          downloadDecompressedBtn.classList.remove("hidden");

        } else if (currentExtension === ".wav" || currentExtension === ".mp3") {
          showVerification(
            "info",
            "Original Bitrate: " + audioOriginalBitrate + " kbps\n" +
            "Compressed Bitrate: " + audioCompressedBitrate + " kbps\n" +
            "Duration: " + audioDuration.toFixed(1) + "s"
          );

          window._decompressedBlob = new Blob([uploadedBytes], { type: "audio/mpeg" });
          window._decompressedFilename = file.name;
          downloadDecompressedBtn.classList.remove("hidden");

        } else if (currentExtension === ".mp4") {
          if (videoFallback) {
            /* GZIP fallback: decompress and verify hash */
            var decompressed = fflate.gunzipSync(uploadedBytes);
            var decompHash = await HashUtils.computeSHA256(decompressed.buffer);
            var origHash = await HashUtils.computeSHA256(originalBytes.buffer);
            var hashMatch = HashUtils.compareHashes(origHash, decompHash);

            showVerification(
              hashMatch ? "success" : "warning",
              "SHA-256 " + (hashMatch ? "Match: Verified" : "Mismatch")
            );

            window._decompressedBlob = new Blob([decompressed], { type: "video/mp4" });
            window._decompressedFilename = "decompressed_" + currentFile.name;
          } else {
            showVerification(
              "info",
              "Original Bitrate: " + audioOriginalBitrate + " kbps\n" +
              "Compressed Bitrate: " + audioCompressedBitrate + " kbps\n" +
              "Duration: " + audioDuration.toFixed(1) + "s"
            );

            window._decompressedBlob = new Blob([uploadedBytes], { type: "video/webm" });
            window._decompressedFilename = file.name;
          }
          downloadDecompressedBtn.classList.remove("hidden");
        }
      }

    } catch (err) {
      showError("Decompression failed. " + (err.message || "Ensure this file was compressed by compRazor."));
    }
  }

  /**
   * Downloads the decompressed file.
   */
  function handleDownloadDecompressed() {
    if (window._decompressedBlob && window._decompressedFilename) {
      FileUtils.downloadBlob(window._decompressedBlob, window._decompressedFilename);
    }
  }

  /* --- UI Helpers --- */

  /**
   * Shows an error message in the popup.
   * @param {string} message - Error message text.
   */
  function showError(message) {
    errorMessage.textContent = message;
    errorMessage.classList.remove("hidden");
  }

  /**
   * Hides the error message.
   */
  function hideError() {
    errorMessage.classList.add("hidden");
  }

  /**
   * Shows the indeterminate progress bar.
   */
  function showProgress() {
    progressBar.classList.remove("hidden");
    progressFill.classList.add("indeterminate");
  }

  /**
   * Hides the progress bar.
   */
  function hideProgress() {
    progressBar.classList.add("hidden");
    progressFill.classList.remove("indeterminate");
  }

  /**
   * Displays rebuild verification results.
   * @param {string} type - "success", "warning", or "info".
   * @param {string} message - The verification message.
   */
  function showVerification(type, message) {
    verificationResult.className = "verification " + type;
    verificationResult.textContent = message;
    verificationResult.style.whiteSpace = "pre-line";
    verificationResult.classList.remove("hidden");
  }

  /**
   * Resets all result sections to hidden state.
   */
  function resetResults() {
    resultsSection.classList.add("hidden");
    rebuildSection.classList.add("hidden");
    verificationResult.classList.add("hidden");
    downloadDecompressedBtn.classList.add("hidden");
    downloadResidualBtn.classList.add("hidden");
    compressedBytes = null;
    residualBytes = null;
    residualFilename = "";
    originalPixels = null;
    originalHash = null;
    window._decompressedBlob = null;
    window._decompressedFilename = null;
  }
})();
