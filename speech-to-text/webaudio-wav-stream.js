'use strict';
var Transform = require('stream').Transform;
var util = require('util');

function WebAudioWavStream(opts) {

  Transform.call(this, opts);

  this.sourceSampleRate = 4800;
  this.sampleRate = 16000;

  this.bufferUnusedSamples = new Float32Array(0);

  var self = this;
  this.on('pipe', function (src) {
    src.on('format', function (format) {
      self.sourceSampleRate = format.sampleRate;
    });
  });

  self.writeHeader();
}
util.inherits(WebAudioWavStream, Transform);

/**
 * Converts WebAudio to 'audio/l16' (raw wav) and downsamples to 16 kHz.
 *
 * Explanation for the math: The raw values captured from the Web Audio API are
 * in 32-bit Floating Point, between -1 and 1 (per the specification).
 * The values for 16-bit PCM range between -32768 and +32767 (16-bit signed integer).
 * Multiply to control the volume of the output. We store in little endian.
 *
 * @param  {Object} buffer Microphone/MediaElement audio chunk
 * @return {Buffer} 'audio/l16' chunk
 * @deprecated This method is deprecated
 */
WebAudioWavStream.prototype._exportDataBufferTo16Khz = function (nodebuffer) {
  var bufferNewSamples = new Float32Array(nodebuffer.buffer),
    buffer = null,
    newSamples = bufferNewSamples.length,
    unusedSamples = this.bufferUnusedSamples.length;


  if (unusedSamples > 0) {
    buffer = new Float32Array(unusedSamples + newSamples);
    for (var i = 0; i < unusedSamples; ++i) {
      buffer[i] = this.bufferUnusedSamples[i];
    }
    for (i = 0; i < newSamples; ++i) {
      buffer[unusedSamples + i] = bufferNewSamples[i];
    }
  } else {
    buffer = bufferNewSamples;
  }

  // downsampling variables
  var filter = [
      -0.037935, -0.00089024, 0.040173, 0.019989, 0.0047792, -0.058675, -0.056487,
      -0.0040653, 0.14527, 0.26927, 0.33913, 0.26927, 0.14527, -0.0040653, -0.056487,
      -0.058675, 0.0047792, 0.019989, 0.040173, -0.00089024, -0.037935
    ],
    samplingRateRatio = this.sourceSampleRate / 16000,
    nOutputSamples = Math.floor((buffer.length - filter.length) / (samplingRateRatio)) + 1,
    pcmEncodedBuffer16k = new ArrayBuffer(nOutputSamples * 2),
    dataView16k = new DataView(pcmEncodedBuffer16k),
    index = 0,
    volume = 0x7FFF, //range from 0 to 0x7FFF to control the volume
    nOut = 0;

  for (i = 0; i + filter.length - 1 < buffer.length; i = Math.round(samplingRateRatio * nOut)) {
    var sample = 0;
    for (var j = 0; j < filter.length; ++j) {
      sample += buffer[i + j] * filter[j];
    }
    sample *= volume;
    try {
      dataView16k.setInt16(index, sample, true); // 'true' -> means little endian
    } catch (ex) {
      // chrome occasionally throws RangeError: Offset is outside the bounds of the DataView
      // todo: actually fix it instead of just ignoring the error..
    }
    index += 2;
    nOut++;
  }

  var indexSampleAfterLastUsed = Math.round(samplingRateRatio * nOut);
  var remaining = buffer.length - indexSampleAfterLastUsed;
  if (remaining > 0) {
    this.bufferUnusedSamples = new Float32Array(remaining);
    for (i = 0; i < remaining; ++i) {
      this.bufferUnusedSamples[i] = buffer[indexSampleAfterLastUsed + i];
    }
  } else {
    this.bufferUnusedSamples = new Float32Array(0);
  }

  return new Buffer(dataView16k.buffer);
};


/**
 * The max size of the "data" chunk of a WAVE file. This is the max unsigned
 * 32-bit int value, minus 100 bytes (overkill, 44 would be safe) for the header.
 *
 * From https://github.com/TooTallNate/node-wav/blob/master/lib/writer.js
 *
 * @api private
 */

var MAX_WAV = 4294967295 - 100;

function writeString(view, offset, string) {
  for (var i = 0; i < string.length; i++){
    view.setUint8(offset + i, string.charCodeAt(i));
  }
}

WebAudioWavStream.prototype.writeHeader = function writeHeader() {
  var buffer = new ArrayBuffer(44);
  var view = new DataView(buffer);
  var length = MAX_WAV; // can't use the actuall length because we don't know it yet
  var numChannels = 1;
  var sampleRate = 16000;

  /* RIFF identifier */
  writeString(view, 0, 'RIFF');
  /* RIFF chunk length */
  view.setUint32(4, 36 + length, true);
  /* RIFF type */
  writeString(view, 8, 'WAVE');
  /* format chunk identifier */
  writeString(view, 12, 'fmt ');
  /* format chunk length */
  view.setUint32(16, 16, true);
  /* sample format (raw PCM) */
  view.setUint16(20, 1, true);
  /* channel count */
  view.setUint16(22, numChannels, true);
  /* sample rate */
  view.setUint32(24, sampleRate, true);
  /* byte rate (sample rate * block align) */
  view.setUint32(28, sampleRate * 4, true);
  /* block align (channel count * bytes per sample) */
  view.setUint16(32, numChannels * 2, true);
  /* bits per sample */
  view.setUint16(34, 16, true);
  /* data chunk identifier */
  writeString(view, 36, 'data');
  /* data chunk length */
  view.setUint32(40, length, true);

  this.push(new Buffer(buffer));
};

WebAudioWavStream.prototype._transform = function (chunk, encoding, next) {
  this.push(this._exportDataBufferTo16Khz(chunk));
  next();
};

WebAudioWavStream.prototype._flush = function (next) {
  // todo: handle anything left in this.bufferUnusedSamples here...
  next();
};

module.exports = WebAudioWavStream;

