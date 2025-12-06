const ffmpeg = require('fluent-ffmpeg');
const ffmpegInstaller = require('@ffmpeg-installer/ffmpeg');

/**
 * 初始化FFmpeg配置
 */
function initFFmpeg() {
  ffmpeg.setFfmpegPath(ffmpegInstaller.path);
  console.log('✓ FFmpeg initialized');
}

module.exports = {
  initFFmpeg,
};

