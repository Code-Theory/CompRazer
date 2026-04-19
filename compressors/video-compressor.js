/**
 * Video compressor using the MediaRecorder API to re-encode MP4 as WebM.
 * Falls back to GZIP compression if MediaRecorder is unavailable.
 */
var VideoCompressor = (function () {
  /**
   * Checks if the browser supports MediaRecorder with VP8 codec.
   * @returns {boolean} True if MediaRecorder is supported.
   */
  function isMediaRecorderSupported() {
    return typeof MediaRecorder !== "undefined" &&
      MediaRecorder.isTypeSupported("video/webm;codecs=vp8");
  }

  /**
   * Compresses an MP4 video by re-encoding to WebM using MediaRecorder.
   * Creates a hidden video element, draws frames to canvas, and records the stream.
   * @param {Uint8Array} data - Raw MP4 file bytes.
   * @param {number} targetBitrate - Target video bitrate in bps. Default: 500000.
   * @returns {Promise<object>} Object with compressedData, duration, bitrate info.
   */
  function compressMP4(data, targetBitrate) {
    targetBitrate = targetBitrate || 500000;

    return new Promise(function (resolve, reject) {
      if (!isMediaRecorderSupported()) {
        /* Fallback: GZIP the raw MP4 bytes */
        var compressed = fflate.gzipSync(new Uint8Array(data), { level: 9 });
        resolve({
          compressedData: compressed,
          duration: 0,
          originalBitrate: 0,
          compressedBitrate: 0,
          fallback: true,
          outputExtension: ".mp4.gz"
        });
        return;
      }

      var blob = new Blob([data], { type: "video/mp4" });
      var url = URL.createObjectURL(blob);
      var video = document.createElement("video");
      var canvas = document.createElement("canvas");
      var ctx = canvas.getContext("2d");

      video.muted = true;
      video.playsInline = true;
      video.src = url;

      video.onloadedmetadata = function () {
        var scale = 0.7;
        canvas.width = Math.round(video.videoWidth * scale);
        canvas.height = Math.round(video.videoHeight * scale);

        var duration = video.duration;
        var originalBitrate = (data.length * 8) / duration;

        var canvasStream = canvas.captureStream(30);

        /* Try to capture audio from the video */
        try {
          var videoStream = video.captureStream();
          var audioTracks = videoStream.getAudioTracks();
          audioTracks.forEach(function (track) {
            canvasStream.addTrack(track);
          });
        } catch (audioErr) {
          /* Audio capture may fail; continue without audio */
        }

        var recorder = new MediaRecorder(canvasStream, {
          mimeType: "video/webm;codecs=vp8",
          videoBitsPerSecond: targetBitrate
        });

        var chunks = [];
        recorder.ondataavailable = function (event) {
          if (event.data.size > 0) {
            chunks.push(event.data);
          }
        };

        recorder.onstop = function () {
          var webmBlob = new Blob(chunks, { type: "video/webm" });
          var reader = new FileReader();
          reader.onload = function () {
            var compressedData = new Uint8Array(reader.result);
            URL.revokeObjectURL(url);
            resolve({
              compressedData: compressedData,
              duration: duration,
              originalBitrate: Math.round(originalBitrate / 1000),
              compressedBitrate: Math.round(targetBitrate / 1000),
              fallback: false,
              outputExtension: ".webm"
            });
          };
          reader.readAsArrayBuffer(webmBlob);
        };

        recorder.onerror = function (err) {
          URL.revokeObjectURL(url);
          reject(new Error("MediaRecorder error: " + err.message));
        };

        recorder.start();

        /* Draw video frames to canvas */
        function drawFrame() {
          if (video.ended || video.paused) {
            recorder.stop();
            return;
          }
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          requestAnimationFrame(drawFrame);
        }

        video.onended = function () {
          recorder.stop();
        };

        video.play().then(function () {
          drawFrame();
        }).catch(function (playErr) {
          URL.revokeObjectURL(url);
          reject(new Error("Video playback failed: " + playErr.message));
        });
      };

      video.onerror = function () {
        URL.revokeObjectURL(url);
        reject(new Error("Failed to load video file."));
      };
    });
  }

  /**
   * Returns the compressed filename for a video file.
   * @param {string} originalName - Original filename.
   * @param {boolean} isFallback - Whether GZIP fallback was used.
   * @returns {string} Compressed filename.
   */
  function getCompressedFilename(originalName, isFallback) {
    var baseName = originalName.substring(0, originalName.lastIndexOf("."));
    if (isFallback) {
      return originalName + ".gz";
    }
    return baseName + "_compressed.webm";
  }

  return {
    isMediaRecorderSupported: isMediaRecorderSupported,
    compressMP4: compressMP4,
    getCompressedFilename: getCompressedFilename
  };
})();
