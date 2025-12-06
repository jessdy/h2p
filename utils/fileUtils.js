const path = require('path');

/**
 * 从URL获取文件扩展名（音频）
 * @param {string} url - 文件URL
 * @returns {string} 文件扩展名
 */
function getFileExtension(url) {
  try {
    const urlPath = new URL(url).pathname;
    const ext = path.extname(urlPath).slice(1).toLowerCase();
    // 如果没有扩展名或扩展名不在常见音频格式中，默认使用mp3
    const audioExtensions = ['mp3', 'wav', 'm4a', 'aac', 'ogg', 'flac', 'wma'];
    return audioExtensions.includes(ext) ? ext : 'mp3';
  } catch {
    return 'mp3';
  }
}

/**
 * 从URL获取图片扩展名
 * @param {string} url - 图片URL
 * @returns {string} 图片扩展名
 */
function getImageExtension(url) {
  try {
    const urlPath = new URL(url).pathname;
    const ext = path.extname(urlPath).slice(1).toLowerCase();
    // 常见图片格式
    const imageExtensions = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp'];
    return imageExtensions.includes(ext) ? ext : 'jpg';
  } catch {
    return 'jpg';
  }
}

module.exports = {
  getFileExtension,
  getImageExtension,
};

