/**
 * File utility functions for reading, formatting, and downloading files.
 */
var FileUtils = (function () {
  /**
   * Formats a byte count into a human-readable string (e.g., "1.23 KB").
   * @param {number} bytes - The number of bytes.
   * @returns {string} Formatted size string.
   */
  function formatSize(bytes) {
    if (bytes === 0) return "0 B";
    var units = ["B", "KB", "MB", "GB"];
    var unitIndex = 0;
    var size = bytes;
    while (size >= 1024 && unitIndex < units.length - 1) {
      size /= 1024;
      unitIndex++;
    }
    return size.toFixed(unitIndex === 0 ? 0 : 2) + " " + units[unitIndex];
  }

  /**
   * Reads a File object as an ArrayBuffer.
   * @param {File} file - The file to read.
   * @returns {Promise<ArrayBuffer>} The file contents as an ArrayBuffer.
   */
  function readFileAsArrayBuffer(file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () { resolve(reader.result); };
      reader.onerror = function () { reject(new Error("Failed to read file.")); };
      reader.readAsArrayBuffer(file);
    });
  }

  /**
   * Triggers a download of a Blob with the given filename.
   * @param {Blob} blob - The data to download.
   * @param {string} filename - The name for the downloaded file.
   */
  function downloadBlob(blob, filename) {
    var url = URL.createObjectURL(blob);
    var anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
  }

  /**
   * Gets the file extension from a filename (lowercase, with dot).
   * @param {string} filename - The filename.
   * @returns {string} Extension like ".txt", ".png", etc.
   */
  function getExtension(filename) {
    var dotIndex = filename.lastIndexOf(".");
    if (dotIndex === -1) return "";
    return filename.substring(dotIndex).toLowerCase();
  }

  /**
   * Returns the file category and compression info based on extension.
   * @param {string} extension - The file extension (e.g., ".txt").
   * @returns {object|null} Object with category, type (lossless/lossy), and algorithm name.
   */
  function getFileTypeInfo(extension) {
    var typeMap = {
      ".txt":  { category: "Text",  type: "lossless", algorithm: "GZIP (fflate)" },
      ".csv":  { category: "Text",  type: "lossless", algorithm: "GZIP (fflate)" },
      ".png":  { category: "Image", type: "lossless", algorithm: "PNG Re-encode (UPNG.js)" },
      ".jpg":  { category: "Image", type: "lossy",    algorithm: "JPEG Re-encode (jpeg-js)" },
      ".jpeg": { category: "Image", type: "lossy",    algorithm: "JPEG Re-encode (jpeg-js)" },
      ".mp3":  { category: "Audio", type: "lossy",    algorithm: "MP3 Re-encode (lamejs)" },
      ".wav":  { category: "Audio", type: "lossy",    algorithm: "WAV to MP3 (lamejs)" },
      ".mp4":  { category: "Video", type: "lossy",    algorithm: "MediaRecorder (WebM)" }
    };
    return typeMap[extension] || null;
  }

  return {
    formatSize: formatSize,
    readFileAsArrayBuffer: readFileAsArrayBuffer,
    downloadBlob: downloadBlob,
    getExtension: getExtension,
    getFileTypeInfo: getFileTypeInfo
  };
})();
