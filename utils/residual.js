/**
 * Residual format: the sidecar file produced alongside a lossy artifact so
 * the original can be reconstructed. Two strategies are supported:
 *
 *   Strategy 0 (BIT_EXACT): payload = gzip(original_bytes). Works for any
 *     format; reconstruction is bit-for-bit. Residual size ~= gzip(original).
 *
 *   Strategy 1 (WAV_DIFF): payload = WAV header + gzip(original_pcm - decoded_mp3_pcm).
 *     WAV-only. Reconstruction needs the lossy MP3 file. Residual is
 *     meaningfully smaller for natural audio because the diff samples
 *     cluster near zero and gzip exploits that.
 *
 * File layout (little-endian):
 *   0    4  magic "CRZR"
 *   4    1  version (1)
 *   5    1  strategy (0 or 1)
 *   6    1  extension length N
 *   7    N  extension UTF-8 (e.g. ".wav")
 *   7+N  .. strategy-specific payload (see pack/unpack below)
 */
var Residual = (function () {
  var MAGIC = [0x43, 0x52, 0x5A, 0x52]; /* "CRZR" */
  var VERSION = 1;
  var STRATEGY_BIT_EXACT = 0;
  var STRATEGY_WAV_DIFF = 1;

  function isResidual(bytes) {
    return !!(bytes && bytes.length >= 6 &&
      bytes[0] === MAGIC[0] && bytes[1] === MAGIC[1] &&
      bytes[2] === MAGIC[2] && bytes[3] === MAGIC[3]);
  }

  function concat(chunks) {
    var total = 0;
    for (var i = 0; i < chunks.length; i++) total += chunks[i].length;
    var out = new Uint8Array(total);
    var off = 0;
    for (var j = 0; j < chunks.length; j++) {
      out.set(chunks[j], off);
      off += chunks[j].length;
    }
    return out;
  }

  function u32LE(n) {
    var b = new Uint8Array(4);
    new DataView(b.buffer).setUint32(0, n >>> 0, true);
    return b;
  }

  function encodeCommonHeader(strategy, extension) {
    var extBytes = new TextEncoder().encode(extension || "");
    if (extBytes.length > 255) throw new Error("Extension too long for residual.");
    var out = new Uint8Array(4 + 1 + 1 + 1 + extBytes.length);
    out.set(MAGIC, 0);
    out[4] = VERSION;
    out[5] = strategy;
    out[6] = extBytes.length;
    out.set(extBytes, 7);
    return out;
  }

  /* --- Strategy 0: bit-exact --- */

  function makeBitExact(originalBytes, extension) {
    var payload = fflate.gzipSync(originalBytes, { level: 9 });
    return concat([
      encodeCommonHeader(STRATEGY_BIT_EXACT, extension),
      u32LE(payload.length),
      payload
    ]);
  }

  /* --- Strategy 1: WAV PCM diff --- */

  function parseWav(bytes) {
    if (bytes.length < 44) throw new Error("WAV too short.");
    if (bytes[0] !== 0x52 || bytes[1] !== 0x49 || bytes[2] !== 0x46 || bytes[3] !== 0x46) {
      throw new Error("Not a RIFF file.");
    }
    if (bytes[8] !== 0x57 || bytes[9] !== 0x41 || bytes[10] !== 0x56 || bytes[11] !== 0x45) {
      throw new Error("Not a WAVE file.");
    }
    var view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    var off = 12;
    var fmt = null, dataStart = -1, dataEnd = -1;
    while (off + 8 <= bytes.length) {
      var id = (bytes[off] << 24) | (bytes[off + 1] << 16) | (bytes[off + 2] << 8) | bytes[off + 3];
      var size = view.getUint32(off + 4, true);
      if (id === 0x666d7420) { /* "fmt " */
        fmt = {
          audioFormat: view.getUint16(off + 8, true),
          numChannels: view.getUint16(off + 10, true),
          sampleRate: view.getUint32(off + 12, true),
          bitsPerSample: view.getUint16(off + 22, true)
        };
      } else if (id === 0x64617461) { /* "data" */
        dataStart = off + 8;
        dataEnd = dataStart + size;
        break;
      }
      off += 8 + size + (size & 1);
    }
    if (!fmt) throw new Error("No fmt chunk.");
    if (dataStart < 0) throw new Error("No data chunk.");
    if (fmt.audioFormat !== 1 || fmt.bitsPerSample !== 16) {
      throw new Error("WAV diff residual requires 16-bit PCM.");
    }
    return {
      fmt: fmt,
      prefix: bytes.subarray(0, dataStart),
      suffix: bytes.subarray(Math.min(dataEnd, bytes.length)),
      dataStart: dataStart,
      dataEnd: dataEnd
    };
  }

  function fmtFromPrefix(prefix) {
    var view = new DataView(prefix.buffer, prefix.byteOffset, prefix.byteLength);
    var off = 12;
    while (off + 8 <= prefix.length) {
      var id = (prefix[off] << 24) | (prefix[off + 1] << 16) | (prefix[off + 2] << 8) | prefix[off + 3];
      var size = view.getUint32(off + 4, true);
      if (id === 0x666d7420) {
        return {
          numChannels: view.getUint16(off + 10, true),
          sampleRate: view.getUint32(off + 12, true)
        };
      }
      off += 8 + size + (size & 1);
    }
    throw new Error("No fmt chunk in residual prefix.");
  }

  function clampI16(x) {
    if (x > 32767) return 32767;
    if (x < -32768) return -32768;
    return x | 0;
  }

  async function decodeMp3ToInt16(mp3Bytes, sampleRate, channels) {
    var ctx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: sampleRate });
    var ab = mp3Bytes.buffer.slice(mp3Bytes.byteOffset, mp3Bytes.byteOffset + mp3Bytes.byteLength);
    var buffer = await ctx.decodeAudioData(ab);
    try { ctx.close(); } catch (_) {}
    var ch = [];
    for (var c = 0; c < buffer.numberOfChannels; c++) ch.push(buffer.getChannelData(c));
    var frames = buffer.length;
    var out = new Int16Array(frames * channels);
    for (var i = 0; i < frames; i++) {
      for (var c2 = 0; c2 < channels; c2++) {
        var src = c2 < ch.length ? ch[c2][i] : ch[0][i];
        if (src > 1) src = 1; else if (src < -1) src = -1;
        out[i * channels + c2] = src < 0 ? Math.round(src * 32768) : Math.round(src * 32767);
      }
    }
    return out;
  }

  function findBestOffsetFrames(original, decoded, channels, maxOffsetFrames) {
    var bestOffset = 0;
    var bestErr = Infinity;
    var probeFrames = Math.min(20000, Math.floor(original.length / channels) - maxOffsetFrames);
    if (probeFrames <= 0) return 0;
    var probeSamples = probeFrames * channels;
    for (var off = 0; off <= maxOffsetFrames; off++) {
      var shift = off * channels;
      if (shift + probeSamples > decoded.length) continue;
      var err = 0;
      for (var i = 0; i < probeSamples; i++) {
        var d = original[i] - decoded[i + shift];
        err += d * d;
        if (err >= bestErr) break;
      }
      if (err < bestErr) {
        bestErr = err;
        bestOffset = off;
      }
    }
    return bestOffset;
  }

  async function makeWavDiff(wavBytes, lossyMp3Bytes) {
    var parsed = parseWav(wavBytes);
    var pcmSlice = wavBytes.buffer.slice(
      wavBytes.byteOffset + parsed.dataStart,
      wavBytes.byteOffset + parsed.dataEnd
    );
    var original = new Int16Array(pcmSlice);
    var decoded = await decodeMp3ToInt16(lossyMp3Bytes, parsed.fmt.sampleRate, parsed.fmt.numChannels);

    var offsetFrames = findBestOffsetFrames(original, decoded, parsed.fmt.numChannels, 1500);
    var shift = offsetFrames * parsed.fmt.numChannels;

    /* Use int32 so the int16-int16 diff never overflows and reconstruction
       stays bit-exact. gzip collapses the sign-extended high bytes cheaply. */
    var residual = new Int32Array(original.length);
    for (var i = 0; i < original.length; i++) {
      var d = (i + shift) < decoded.length ? decoded[i + shift] : 0;
      residual[i] = original[i] - d;
    }

    var residualBytes = new Uint8Array(residual.buffer, residual.byteOffset, residual.byteLength);
    var compressed = fflate.gzipSync(residualBytes, { level: 9 });

    return concat([
      encodeCommonHeader(STRATEGY_WAV_DIFF, ".wav"),
      u32LE(parsed.prefix.length), parsed.prefix,
      u32LE(parsed.suffix.length), parsed.suffix,
      u32LE(offsetFrames),
      u32LE(original.length),
      u32LE(compressed.length), compressed
    ]);
  }

  /* --- Reconstruction --- */

  async function reconstruct(residualBytes, lossyBytes) {
    if (!isResidual(residualBytes)) throw new Error("Not a CRZR residual.");
    var view = new DataView(residualBytes.buffer, residualBytes.byteOffset, residualBytes.byteLength);
    var off = 4;
    var version = residualBytes[off++];
    if (version !== VERSION) throw new Error("Unsupported residual version: " + version);
    var strategy = residualBytes[off++];
    var extLen = residualBytes[off++];
    var extension = new TextDecoder().decode(residualBytes.subarray(off, off + extLen));
    off += extLen;

    if (strategy === STRATEGY_BIT_EXACT) {
      var payloadLen = view.getUint32(off, true); off += 4;
      var payload = residualBytes.subarray(off, off + payloadLen);
      return {
        original: fflate.gunzipSync(payload),
        extension: extension,
        requiresLossy: false
      };
    }

    if (strategy === STRATEGY_WAV_DIFF) {
      if (!lossyBytes) throw new Error("WAV residual requires the lossy MP3 companion file.");
      var prefLen = view.getUint32(off, true); off += 4;
      var prefix = residualBytes.subarray(off, off + prefLen); off += prefLen;
      var sufLen = view.getUint32(off, true); off += 4;
      var suffix = residualBytes.subarray(off, off + sufLen); off += sufLen;
      var offsetFrames = view.getUint32(off, true); off += 4;
      var sampleCount = view.getUint32(off, true); off += 4;
      var compLen = view.getUint32(off, true); off += 4;
      var comp = residualBytes.subarray(off, off + compLen);

      var raw = fflate.gunzipSync(comp);
      var rawCopy = new Uint8Array(raw);
      var residual = new Int32Array(rawCopy.buffer, 0, rawCopy.byteLength / 4);

      var fmt = fmtFromPrefix(prefix);
      var decoded = await decodeMp3ToInt16(lossyBytes, fmt.sampleRate, fmt.numChannels);
      var shift = offsetFrames * fmt.numChannels;

      var rebuilt = new Int16Array(sampleCount);
      for (var i = 0; i < sampleCount; i++) {
        var d = (i + shift) < decoded.length ? decoded[i + shift] : 0;
        rebuilt[i] = clampI16(residual[i] + d);
      }
      var pcmBytes = new Uint8Array(rebuilt.buffer, rebuilt.byteOffset, rebuilt.byteLength);
      return {
        original: concat([prefix, pcmBytes, suffix]),
        extension: extension,
        requiresLossy: true
      };
    }

    throw new Error("Unknown residual strategy: " + strategy);
  }

  /* --- Public dispatcher --- */

  async function make(originalBytes, extension, lossyBytes) {
    if (extension === ".wav" && lossyBytes) {
      try {
        return {
          bytes: await makeWavDiff(originalBytes, lossyBytes),
          strategy: "wav-diff"
        };
      } catch (e) {
        /* Fall through to bit-exact if MP3 decode or WAV parse fails. */
      }
    }
    return {
      bytes: makeBitExact(originalBytes, extension),
      strategy: "bit-exact"
    };
  }

  return {
    isResidual: isResidual,
    make: make,
    reconstruct: reconstruct
  };
})();
