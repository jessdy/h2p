const axios = require('axios');
const fs = require('fs');
const { normalizeUrl } = require('./urlUtils');

/**
 * 下载音频文件
 * @param {string} url - 音频文件URL
 * @param {string} filePath - 保存路径
 */
async function downloadAudio(url, filePath) {
  try {
    url = normalizeUrl(url);
    const response = await axios({
      method: 'GET',
      url: url,
      responseType: 'stream',
      timeout: 60000, // 60秒超时
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
      },
    });

    const writer = fs.createWriteStream(filePath);
    response.data.pipe(writer);

    return new Promise((resolve, reject) => {
      writer.on('finish', resolve);
      writer.on('error', reject);
      response.data.on('error', reject);
    });
  } catch (err) {
    throw new Error(`Failed to download audio from ${url}: ${err.message}`);
  }
}

/**
 * 下载图片文件
 * @param {string} url - 图片文件URL
 * @param {string} filePath - 保存路径
 */
async function downloadImage(url, filePath) {
  try {
    url = normalizeUrl(url);
    const response = await axios({
      method: 'GET',
      url: url,
      responseType: 'stream',
      timeout: 60000, // 60秒超时
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
      },
    });

    const writer = fs.createWriteStream(filePath);
    response.data.pipe(writer);

    return new Promise((resolve, reject) => {
      writer.on('finish', resolve);
      writer.on('error', reject);
      response.data.on('error', reject);
    });
  } catch (err) {
    throw new Error(`Failed to download image from ${url}: ${err.message}`);
  }
}

/**
 * 下载字幕文件（SRT等）
 * @param {string} url - 字幕文件URL
 * @param {string} filePath - 保存路径
 */
async function downloadSrt(url, filePath) {
  try {
    url = normalizeUrl(url);
    const response = await axios({
      method: 'GET',
      url: url,
      responseType: 'stream',
      timeout: 60000, // 60秒超时
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
      },
    });

    const writer = fs.createWriteStream(filePath);
    response.data.pipe(writer);

    return new Promise((resolve, reject) => {
      writer.on('finish', resolve);
      writer.on('error', reject);
      response.data.on('error', reject);
    });
  } catch (err) {
    throw new Error(`Failed to download subtitle from ${url}: ${err.message}`);
  }
}

module.exports = {
  downloadAudio,
  downloadImage,
  downloadSrt,
};

