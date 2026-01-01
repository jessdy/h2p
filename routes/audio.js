const express = require('express');
const ffmpeg = require('fluent-ffmpeg');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { downloadAudio } = require('../utils/download');
const { getFileExtension } = require('../utils/fileUtils');
const { normalizeUrl } = require('../utils/urlUtils');

const router = express.Router();

/**
 * 获取音频文件时长（秒）
 * @param {string} filePath - 音频文件路径
 * @returns {Promise<number>} 音频时长（秒）
 */
function getAudioDuration(filePath) {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(filePath, (err, metadata) => {
      if (err) {
        reject(err);
        return;
      }
      const duration = metadata.format.duration || 0;
      resolve(duration);
    });
  });
}

/**
 * 将秒数转换为 SRT 时间格式 (HH:MM:SS,mmm)
 * @param {number} seconds - 秒数
 * @returns {string} SRT 时间格式字符串
 */
function formatSrtTime(seconds) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  const milliseconds = Math.floor((seconds % 1) * 1000);
  
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')},${String(milliseconds).padStart(3, '0')}`;
}

/**
 * 按标点符号分割文本
 * @param {string} text - 原始文本
 * @returns {Array<string>} 分割后的文本数组
 */
function splitTextByPunctuation(text) {
  if (!text || text.trim().length === 0) {
    return [];
  }

  // 定义标点符号（包括中文和英文标点）
  const punctuationRegex = /([。！？；：，、\n])/;
  
  // 按标点符号分割，但保留标点符号
  const parts = text.split(punctuationRegex);
  const segments = [];
  let currentSegment = '';

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (!part) continue;

    // 检查是否是标点符号（使用新的正则避免 lastIndex 问题）
    if (punctuationRegex.test(part)) {
      currentSegment += part;
      if (currentSegment.trim().length > 0) {
        segments.push(currentSegment.trim());
        currentSegment = '';
      }
    } else {
      currentSegment += part;
      // 如果当前片段太长（超过50个字符），强制分割
      if (currentSegment.length > 50) {
        const words = currentSegment.split('');
        let tempSegment = '';
        for (const word of words) {
          tempSegment += word;
          if (tempSegment.length >= 50) {
            segments.push(tempSegment.trim());
            tempSegment = '';
          }
        }
        currentSegment = tempSegment;
      }
    }
  }

  // 添加最后一段
  if (currentSegment.trim().length > 0) {
    segments.push(currentSegment.trim());
  }

  return segments.filter(seg => seg.length > 0);
}

/**
 * 根据字数和总时长计算每个文本片段的时间戳
 * @param {Array<string>} segments - 文本片段数组
 * @param {number} totalDuration - 总时长（秒）
 * @param {number} startTime - 开始时间（秒）
 * @returns {Array<{text: string, startTime: number, endTime: number}>} 带时间戳的字幕数组
 */
function calculateSubtitleTimings(segments, totalDuration, startTime = 0) {
  if (segments.length === 0) {
    return [];
  }

  // 计算总字符数（不包括标点符号）
  const punctuationRegex = /[。！？；：，、\n\s]/g;
  const totalChars = segments.reduce((sum, seg) => {
    return sum + seg.replace(punctuationRegex, '').length;
  }, 0);

  if (totalChars === 0) {
    // 如果全是标点符号，平均分配时间
    const segmentDuration = totalDuration / segments.length;
    return segments.map((seg, index) => ({
      text: seg,
      startTime: startTime + index * segmentDuration,
      endTime: startTime + (index + 1) * segmentDuration,
    }));
  }

  // 计算每个字符的平均时长
  const timePerChar = totalDuration / totalChars;
  
  // 先计算每个片段的理想时长
  const idealDurations = segments.map(segment => {
    const charCount = segment.replace(punctuationRegex, '').length;
    // 每个片段至少0.5秒，最多不超过总时长的1/3
    return Math.max(0.5, Math.min(totalDuration / 3, charCount * timePerChar));
  });

  // 计算理想总时长
  const idealTotal = idealDurations.reduce((sum, dur) => sum + dur, 0);
  
  // 如果理想总时长超过实际时长，按比例缩放
  const scaleFactor = idealTotal > totalDuration ? totalDuration / idealTotal : 1;
  
  // 为每个片段分配时间
  const subtitles = [];
  let currentTime = startTime;
  let remainingTime = totalDuration;

  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i];
    let segmentDuration = idealDurations[i] * scaleFactor;
    
    // 最后一个片段使用剩余的所有时间
    if (i === segments.length - 1) {
      segmentDuration = remainingTime;
    } else {
      // 确保不会超过剩余时间
      segmentDuration = Math.min(segmentDuration, remainingTime - 0.5 * (segments.length - i - 1));
    }
    
    // 确保每个片段至少0.3秒（最后一个片段除外）
    if (i < segments.length - 1) {
      segmentDuration = Math.max(0.3, segmentDuration);
    }
    
    subtitles.push({
      text: segment,
      startTime: currentTime,
      endTime: currentTime + segmentDuration,
    });
    
    currentTime += segmentDuration;
    remainingTime -= segmentDuration;
  }

  // 确保最后一个片段的时间准确
  if (subtitles.length > 0) {
    subtitles[subtitles.length - 1].endTime = startTime + totalDuration;
  }

  return subtitles;
}

/**
 * 生成 SRT 字幕文件内容
 * @param {Array<{text: string, startTime: number, endTime: number}>} subtitles - 字幕数组
 * @returns {string} SRT 文件内容
 */
function generateSrtContent(subtitles) {
  let srtContent = '';
  subtitles.forEach((subtitle, index) => {
    const sequence = index + 1;
    const startTime = formatSrtTime(subtitle.startTime);
    const endTime = formatSrtTime(subtitle.endTime);
    srtContent += `${sequence}\n${startTime} --> ${endTime}\n${subtitle.text}\n\n`;
  });
  return srtContent;
}

// 音频拼接接口
router.post('/audio', express.json({ limit: '50mb' }), async (req, res) => {
  let { bgUrl, introUrl, audioUrls = [], introTxt, audioTxts = [] } = req.body || {};

  // 参数验证
  if (!introUrl || typeof introUrl !== 'string') {
    return res.status(400).json({
      error: 'invalid_request',
      message: 'introUrl (string) is required in request body',
    });
  }

  if (!Array.isArray(audioUrls) || audioUrls.length === 0) {
    return res.status(400).json({
      error: 'invalid_request',
      message: 'audioUrls (array of strings) is required and must not be empty',
    });
  }

  // 验证所有URL都是字符串
  if (!audioUrls.every(url => typeof url === 'string' && url.trim().length > 0)) {
    return res.status(400).json({
      error: 'invalid_request',
      message: 'All items in audioUrls must be non-empty strings',
    });
  }

  // 验证字幕参数
  if (introTxt !== undefined && typeof introTxt !== 'string') {
    return res.status(400).json({
      error: 'invalid_request',
      message: 'introTxt must be a string if provided',
    });
  }

  if (!Array.isArray(audioTxts)) {
    return res.status(400).json({
      error: 'invalid_request',
      message: 'audioTxts must be an array if provided',
    });
  }

  // 如果提供了字幕，验证数量匹配
  const hasSubtitles = introTxt !== undefined || audioTxts.length > 0;
  if (hasSubtitles) {
    if (introTxt === undefined) {
      return res.status(400).json({
        error: 'invalid_request',
        message: 'introTxt is required when providing subtitles',
      });
    }
    if (audioTxts.length !== audioUrls.length) {
      return res.status(400).json({
        error: 'invalid_request',
        message: `audioTxts array length (${audioTxts.length}) must match audioUrls array length (${audioUrls.length})`,
      });
    }
    // 验证所有字幕都是字符串
    if (!audioTxts.every(txt => typeof txt === 'string')) {
      return res.status(400).json({
        error: 'invalid_request',
        message: 'All items in audioTxts must be strings',
      });
    }
  }

  // URL处理
  if (bgUrl) {
    bgUrl = normalizeUrl(bgUrl);
  }
  introUrl = normalizeUrl(introUrl);
  audioUrls = audioUrls.map(url => normalizeUrl(url));

  const tempDir = path.join(os.tmpdir(), `audio-merge-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  const outputDir = path.join(__dirname, '..', 'public', 'audio');
  let downloadedFiles = [];
  let bgFilePath = null;
  let mergedAudioPath = null;
  let outputFilePath = null;
  let srtFilePath = null;

  try {
    // 创建临时目录和输出目录
    await fs.promises.mkdir(tempDir, { recursive: true });
    await fs.promises.mkdir(outputDir, { recursive: true });

    console.log(`[merge/audio] Starting audio merge, introUrl: ${introUrl}, audioUrls count: ${audioUrls.length}, bgUrl: ${bgUrl || 'none'}`);

    // 下载背景音乐（如果提供）
    if (bgUrl) {
      const bgFileName = `bg-${Date.now()}.${getFileExtension(bgUrl)}`;
      bgFilePath = path.join(tempDir, bgFileName);
      await downloadAudio(bgUrl, bgFilePath);
      console.log(`[merge/audio] Downloaded background music: ${bgFilePath}`);
    }

    // 下载介绍音频
    const introFileName = `intro-${Date.now()}.${getFileExtension(introUrl)}`;
    const introFilePath = path.join(tempDir, introFileName);
    await downloadAudio(introUrl, introFilePath);
    downloadedFiles.push(introFilePath);
    console.log(`[merge/audio] Downloaded intro audio: ${introFilePath}`);

    // 下载所有音频文件
    for (let i = 0; i < audioUrls.length; i++) {
      const audioUrl = audioUrls[i];
      const fileName = `audio-${i}-${Date.now()}.${getFileExtension(audioUrl)}`;
      const filePath = path.join(tempDir, fileName);
      await downloadAudio(audioUrl, filePath);
      downloadedFiles.push(filePath);
      console.log(`[merge/audio] Downloaded audio ${i + 1}/${audioUrls.length}: ${filePath}`);
    }

    // 先拼接所有音频文件（intro + audioUrls）
    const fileListPath = path.join(tempDir, 'filelist.txt');
    const fileListContent = downloadedFiles
      .map(file => `file '${file.replace(/'/g, "'\\''")}'`)
      .join('\n');
    await fs.promises.writeFile(fileListPath, fileListContent, 'utf8');
    console.log(`[merge/audio] Created file list: ${fileListPath}`);

    // 生成临时拼接音频文件路径
    mergedAudioPath = path.join(tempDir, `merged-temp-${Date.now()}.mp3`);

    // 使用 ffmpeg 拼接音频（intro + audioUrls）
    await new Promise((resolve, reject) => {
      ffmpeg()
        .input(fileListPath)
        .inputOptions(['-f', 'concat', '-safe', '0'])
        .audioCodec('libmp3lame')
        .audioBitrate(128)
        .on('start', (commandLine) => {
          console.log(`[merge/audio] FFmpeg concat command: ${commandLine}`);
        })
        .on('progress', (progress) => {
          console.log(`[merge/audio] Processing concat: ${JSON.stringify(progress)}`);
        })
        .on('end', () => {
          console.log(`[merge/audio] Audio concat completed: ${mergedAudioPath}`);
          resolve();
        })
        .on('error', (err) => {
          console.error(`[merge/audio] FFmpeg concat error:`, err);
          reject(err);
        })
        .save(mergedAudioPath);
    });

    // 生成最终输出文件名
    const outputFileName = `merged-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.mp3`;
    outputFilePath = path.join(outputDir, outputFileName);

    // 如果有背景音乐，混合背景音乐和拼接的音频
    if (bgFilePath) {
      // 背景音乐从0秒开始，拼接的音频从5秒开始
      const DELAY_SECONDS = 1;
      await new Promise((resolve, reject) => {
        ffmpeg()
          .input(bgFilePath)
          .input(mergedAudioPath)
          .complexFilter([
            // 延迟拼接的音频5秒
            `[1:a]adelay=${DELAY_SECONDS * 1000}|${DELAY_SECONDS * 1000}[delayed]`,
            // 混合背景音乐和延迟后的音频
            `[0:a][delayed]amix=inputs=2:duration=longest:dropout_transition=0`
          ])
          .audioCodec('libmp3lame')
          .audioBitrate(128)
          .on('start', (commandLine) => {
            console.log(`[merge/audio] FFmpeg mix command: ${commandLine}`);
          })
          .on('progress', (progress) => {
            console.log(`[merge/audio] Processing mix: ${JSON.stringify(progress)}`);
          })
          .on('end', () => {
            console.log(`[merge/audio] Audio mix completed: ${outputFilePath}`);
            resolve();
          })
          .on('error', (err) => {
            console.error(`[merge/audio] FFmpeg mix error:`, err);
            reject(err);
          })
          .save(outputFilePath);
      });
    } else {
      // 没有背景音乐，拼接的音频从5秒开始（在前面添加5秒静音）
      const DELAY_SECONDS = 5;
      await new Promise((resolve, reject) => {
        ffmpeg()
          .input('anullsrc=channel_layout=stereo:sample_rate=44100')
          .inputOptions(['-f', 'lavfi', '-t', String(DELAY_SECONDS)])
          .input(mergedAudioPath)
          .complexFilter([
            // 将静音和拼接的音频连接
            `[0:a][1:a]concat=n=2:v=0:a=1`
          ])
          .audioCodec('libmp3lame')
          .audioBitrate(128)
          .on('start', (commandLine) => {
            console.log(`[merge/audio] FFmpeg delay command: ${commandLine}`);
          })
          .on('progress', (progress) => {
            console.log(`[merge/audio] Processing delay: ${JSON.stringify(progress)}`);
          })
          .on('end', () => {
            console.log(`[merge/audio] Audio delay completed: ${outputFilePath}`);
            resolve();
          })
          .on('error', (err) => {
            console.error(`[merge/audio] FFmpeg delay error:`, err);
            reject(err);
          })
          .save(outputFilePath);
      });
    }

    // 构造可访问的URL
    const baseUrl = `${req.protocol}://${req.get('host')}`;
    const relativePath = path.relative(path.join(__dirname, '..', 'public'), outputFilePath);
    const urlPath = `/static/${relativePath.split(path.sep).join('/')}`;
    const audioUrl = `${baseUrl}${urlPath}`;

    console.log(`[merge/audio] Audio merge successful, URL: ${audioUrl}`);

    // 如果提供了字幕，生成 SRT 文件
    let srtUrl = null;
    if (hasSubtitles) {
      try {
        console.log(`[merge/audio] Generating SRT subtitle file...`);
        
        // 获取每个音频文件的时长
        const durations = [];
        for (const filePath of downloadedFiles) {
          const duration = await getAudioDuration(filePath);
          durations.push(duration);
          console.log(`[merge/audio] Audio duration: ${duration.toFixed(2)}s`);
        }

        // 计算每个字幕的时间戳（按标点符号分割长文本）
        // 字幕从5秒开始（拼接的音频从5秒开始播放）
        const SUBTITLE_START_OFFSET = 5;
        const subtitles = [];
        let currentTime = SUBTITLE_START_OFFSET;

        // 添加介绍音频的字幕
        const introDuration = durations[0];
        if (introTxt && introTxt.trim().length > 0) {
          // 按标点符号分割文本
          const introSegments = splitTextByPunctuation(introTxt.trim());
          if (introSegments.length > 0) {
            // 根据字数和时长计算每个片段的时间
            const introSubtitles = calculateSubtitleTimings(introSegments, introDuration, currentTime);
            subtitles.push(...introSubtitles);
          }
        }
        currentTime += introDuration; // 即使没有字幕，也要推进时间

        // 添加其他音频的字幕
        for (let i = 0; i < audioTxts.length; i++) {
          const audioTxt = audioTxts[i];
          const audioDuration = durations[i + 1]; // +1 因为第一个是 intro
          if (audioTxt && audioTxt.trim().length > 0) {
            // 按标点符号分割文本
            const audioSegments = splitTextByPunctuation(audioTxt.trim());
            if (audioSegments.length > 0) {
              // 根据字数和时长计算每个片段的时间
              const audioSubtitles = calculateSubtitleTimings(audioSegments, audioDuration, currentTime);
              subtitles.push(...audioSubtitles);
            }
          }
          currentTime += audioDuration; // 即使没有字幕，也要推进时间
        }

        // 生成 SRT 文件
        const srtContent = generateSrtContent(subtitles);
        const srtFileName = `merged-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.srt`;
        srtFilePath = path.join(outputDir, srtFileName);
        await fs.promises.writeFile(srtFilePath, srtContent, 'utf8');
        console.log(`[merge/audio] SRT file created: ${srtFilePath}`);

        // 构造 SRT 文件的 URL
        const srtRelativePath = path.relative(path.join(__dirname, '..', 'public'), srtFilePath);
        const srtUrlPath = `/static/${srtRelativePath.split(path.sep).join('/')}`;
        srtUrl = `${baseUrl}${srtUrlPath}`;
        console.log(`[merge/audio] SRT file URL: ${srtUrl}`);
      } catch (srtErr) {
        console.error('[merge/audio] Failed to generate SRT file:', srtErr);
        // SRT 生成失败不影响音频合并，继续返回音频结果
      }
    }

    const response = {
      success: true,
      url: audioUrl,
      path: outputFilePath,
      filename: outputFileName,
      duration: downloadedFiles.length,
    };

    if (srtUrl) {
      response.srtUrl = srtUrl;
      response.srtPath = srtFilePath;
      response.srtFilename = path.basename(srtFilePath);
    }

    return res.json(response);
  } catch (err) {
    console.error('[merge/audio] Audio merge error:', err);
    
    // 如果输出文件已创建但出错，尝试删除
    if (outputFilePath) {
      try {
        await fs.promises.unlink(outputFilePath);
      } catch (e) {
        console.warn('[merge/audio] Failed to cleanup output file:', e);
      }
    }

    // 如果 SRT 文件已创建但出错，尝试删除
    if (srtFilePath) {
      try {
        await fs.promises.unlink(srtFilePath);
      } catch (e) {
        console.warn('[merge/audio] Failed to cleanup SRT file:', e);
      }
    }

    return res.status(500).json({
      error: 'merge_failed',
      message: err && err.message ? err.message : String(err),
    });
  } finally {
    // 清理临时文件
    try {
      for (const file of downloadedFiles) {
        try {
          await fs.promises.unlink(file);
        } catch (e) {
          console.warn(`[merge/audio] Failed to delete temp file ${file}:`, e);
        }
      }
      // 删除背景音乐文件
      if (bgFilePath) {
        try {
          await fs.promises.unlink(bgFilePath);
        } catch (e) {
          console.warn(`[merge/audio] Failed to delete bg file ${bgFilePath}:`, e);
        }
      }
      // 删除临时拼接音频文件
      if (mergedAudioPath) {
        try {
          await fs.promises.unlink(mergedAudioPath);
        } catch (e) {
          console.warn(`[merge/audio] Failed to delete merged audio file ${mergedAudioPath}:`, e);
        }
      }
      // 删除文件列表
      const fileListPath = path.join(tempDir, 'filelist.txt');
      try {
        await fs.promises.unlink(fileListPath);
      } catch (e) {
        // 忽略错误
      }
      // 删除临时目录
      try {
        await fs.promises.rmdir(tempDir);
        console.log(`[merge/audio] Cleaned up temp directory: ${tempDir}`);
      } catch (e) {
        if (fs.promises.rm) {
          try {
            await fs.promises.rm(tempDir, { recursive: true, force: true });
            console.log(`[merge/audio] Cleaned up temp directory (recursive): ${tempDir}`);
          } catch (rmErr) {
            console.warn(`[merge/audio] Failed to remove temp directory: ${tempDir}`, rmErr);
          }
        } else {
          console.warn(`[merge/audio] Failed to remove temp directory: ${tempDir}`, e);
        }
      }
    } catch (e) {
      console.warn('[merge/audio] Failed to cleanup temp files:', e);
    }
  }
});

module.exports = router;

