/**
 * SHA-256 hash utilities using the SubtleCrypto Web API.
 */
var HashUtils = (function () {
  /**
   * Computes the SHA-256 hash of an ArrayBuffer.
   * @param {ArrayBuffer} buffer - The data to hash.
   * @returns {Promise<string>} Hex string of the SHA-256 hash.
   */
  async function computeSHA256(buffer) {
    var hashBuffer = await crypto.subtle.digest("SHA-256", buffer);
    var hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(function (b) {
      return b.toString(16).padStart(2, "0");
    }).join("");
  }

  /**
   * Compares two SHA-256 hex strings for equality.
   * @param {string} hash1 - First hash.
   * @param {string} hash2 - Second hash.
   * @returns {boolean} True if hashes match.
   */
  function compareHashes(hash1, hash2) {
    return hash1 === hash2;
  }

  return {
    computeSHA256: computeSHA256,
    compareHashes: compareHashes
  };
})();
