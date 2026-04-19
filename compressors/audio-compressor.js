/**
 * Audio compressor handling WAV-to-MP3 conversion and MP3 re-encoding via lamejs.
 */
var AudioCompressor = (function () {
  /**
   * Parses a WAV file header and extracts PCM sample data.
   * @param {ArrayBuffer} buffer - The WAV file as ArrayBuffer.
   * @returns {object} Object with sampleRate, numChannels, bitDepth, samples (Int16Array per channel), duration.
   */
  function parseWAV(buffer) {
    var view = new DataView(buffer);
    var numChannels = view.getUint16(22, true);
    var sampleRate = view.getUint32(24, true);
    var bitDepth = view.getUint16(34, true);

    /* Find the data chunk */
    var dataOffset = 12;
    while (dataOffset < buffer.byteLength - 8) {
      var chunkId = String.fromCharCode(
        view.getUint8(dataOffset),
        view.getUint8(dataOffset + 1),
        view.getUint8(dataOffset + 2),
        view.getUint8(dataOffset + 3)
      );
      var chunkSize = view.getUint32(dataOffset + 4, true);
      if (chunkId === "data") {
        dataOffset += 8;
        break;
      }
      dataOffset += 8 + chunkSize;
    }

    var bytesPerSample = bitDepth / 8;
    var totalSamples = (buffer.byteLength - dataOffset) / bytesPerSample;
    var samplesPerChannel = Math.floor(totalSamples / numChannels);
    var duration = samplesPerChannel / sampleRate;

    /* Extract interleaved PCM samples into per-channel Int16Arrays */
    var channels = [];
    for (var ch = 0; ch < numChannels; ch++) {
      channels.push(new Int16Array(samplesPerChannel));
    }

    for (var i = 0; i < samplesPerChannel; i++) {
      for (var ch = 0; ch < numChannels; ch++) {
        var sampleIndex = dataOffset + (i * numChannels + ch) * bytesPerSample;
        if (bitDepth === 16) {
          channels[ch][i] = view.getInt16(sampleIndex, true);
        } else if (bitDepth === 8) {
          channels[ch][i] = (view.getUint8(sampleIndex) - 128) * 256;
        }
      }
    }

    return {
      sampleRate: sampleRate,
      numChannels: numChannels,
      bitDepth: bitDepth,
      channels: channels,
      duration: duration,
      samplesPerChannel: samplesPerChannel
    };
  }

  /**
   * Compresses WAV PCM data to MP3 using lamejs.
   * @param {Uint8Array} data - Raw WAV file bytes.
   * @param {number} bitrate - Target MP3 bitrate in kbps. Default: 128.
   * @returns {object} Object with compressedData (Uint8Array), duration, originalBitrate.
   */
  function compressWAV(data, bitrate) {
    bitrate = bitrate || 128;
    var wavInfo = parseWAV(data.buffer);
    var encoder = new lamejs.Mp3Encoder(wavInfo.numChannels, wavInfo.sampleRate, bitrate);

    var mp3Chunks = [];
    var chunkSize = 1152;

    for (var i = 0; i < wavInfo.samplesPerChannel; i += chunkSize) {
      var leftChunk = wavInfo.channels[0].subarray(i, i + chunkSize);
      var rightChunk = wavInfo.numChannels > 1
        ? wavInfo.channels[1].subarray(i, i + chunkSize)
        : leftChunk;

      var mp3buf;
      if (wavInfo.numChannels === 1) {
        mp3buf = encoder.encodeBuffer(leftChunk);
      } else {
        mp3buf = encoder.encodeBuffer(leftChunk, rightChunk);
      }

      if (mp3buf.length > 0) {
        mp3Chunks.push(mp3buf);
      }
    }

    var finalBuf = encoder.flush();
    if (finalBuf.length > 0) {
      mp3Chunks.push(finalBuf);
    }

    /* Concatenate all MP3 chunks */
    var totalLength = 0;
    for (var i = 0; i < mp3Chunks.length; i++) {
      totalLength += mp3Chunks[i].length;
    }
    var mp3Data = new Uint8Array(totalLength);
    var offset = 0;
    for (var i = 0; i < mp3Chunks.length; i++) {
      mp3Data.set(mp3Chunks[i], offset);
      offset += mp3Chunks[i].length;
    }

    var originalBitrate = wavInfo.sampleRate * wavInfo.bitDepth * wavInfo.numChannels / 1000;

    return {
      compressedData: mp3Data,
      duration: wavInfo.duration,
      originalBitrate: originalBitrate,
      compressedBitrate: bitrate
    };
  }

  /**
   * Re-encodes an MP3 at a lower bitrate by decoding via AudioContext and re-encoding.
   * @param {Uint8Array} data - Raw MP3 file bytes.
   * @param {number} targetBitrate - Target bitrate in kbps. Default: 96.
   * @returns {Promise<object>} Object with compressedData, duration, bitrate info.
   */
  async function compressMP3(data, targetBitrate) {
    targetBitrate = targetBitrate || 96;

    var audioContext = new (window.AudioContext || window.webkitAudioContext)();
    var audioBuffer = await audioContext.decodeAudioData(data.buffer.slice(0));
    var duration = audioBuffer.duration;
    var sampleRate = audioBuffer.sampleRate;
    var numChannels = audioBuffer.numberOfChannels;

    /* Extract PCM samples as Int16 */
    var channels = [];
    for (var ch = 0; ch < Math.min(numChannels, 2); ch++) {
      var floatData = audioBuffer.getChannelData(ch);
      var int16Data = new Int16Array(floatData.length);
      for (var i = 0; i < floatData.length; i++) {
        var sample = Math.max(-1, Math.min(1, floatData[i]));
        int16Data[i] = sample < 0 ? sample * 32768 : sample * 32767;
      }
      channels.push(int16Data);
    }

    var encChannels = Math.min(numChannels, 2);
    var encoder = new lamejs.Mp3Encoder(encChannels, sampleRate, targetBitrate);
    var mp3Chunks = [];
    var chunkSize = 1152;

    for (var i = 0; i < channels[0].length; i += chunkSize) {
      var leftChunk = channels[0].subarray(i, i + chunkSize);
      var rightChunk = encChannels > 1
        ? channels[1].subarray(i, i + chunkSize)
        : leftChunk;

      var mp3buf = encChannels === 1
        ? encoder.encodeBuffer(leftChunk)
        : encoder.encodeBuffer(leftChunk, rightChunk);

      if (mp3buf.length > 0) {
        mp3Chunks.push(mp3buf);
      }
    }

    var finalBuf = encoder.flush();
    if (finalBuf.length > 0) {
      mp3Chunks.push(finalBuf);
    }

    var totalLength = 0;
    for (var i = 0; i < mp3Chunks.length; i++) {
      totalLength += mp3Chunks[i].length;
    }
    var mp3Data = new Uint8Array(totalLength);
    var offset = 0;
    for (var i = 0; i < mp3Chunks.length; i++) {
      mp3Data.set(mp3Chunks[i], offset);
      offset += mp3Chunks[i].length;
    }

    audioContext.close();

    var originalBitrate = (data.length * 8) / duration / 1000;

    return {
      compressedData: mp3Data,
      duration: duration,
      originalBitrate: Math.round(originalBitrate),
      compressedBitrate: targetBitrate
    };
  }

  /**
   * Returns the compressed filename for an audio file.
   * @param {string} originalName - Original filename.
   * @param {string} extension - Original extension.
   * @returns {string} Compressed filename.
   */
  function getCompressedFilename(originalName, extension) {
    var baseName = originalName.substring(0, originalName.lastIndexOf("."));
    if (extension === ".wav") {
      return baseName + ".mp3";
    }
    return baseName + "_compressed.mp3";
  }

  return {
    compressWAV: compressWAV,
    compressMP3: compressMP3,
    getCompressedFilename: getCompressedFilename
  };
})();
