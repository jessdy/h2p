const express = require('express');
const ffmpeg = require('fluent-ffmpeg');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { downloadAudio, downloadImage, downloadSrt } = require('../utils/download');
const { getFileExtension, getImageExtension } = require('../utils/fileUtils');
const { parseColorForFFmpeg } = require('../utils/colorUtils');
const { normalizeUrl } = require('../utils/urlUtils');
const axios = require('axios');

const router = express.Router();

// 音频转视频接口（使用音频可视化）
router.post('/convert/audio-to-video', express.json({ limit: '50mb' }), async (req, res) => {
  let { audioUrl, width = 1080, height = 1920, backgroundColor = '#000000', backgroundImage, waveColor = '#00ffff', mode = 'bar', barWidth = 4, barGap = 2, barSpacing = 2, waveX, waveY, waveWidth, waveHeight, srt } = req.body || {};

  // 参数验证
  if (!audioUrl || typeof audioUrl !== 'string') {
    return res.status(400).json({
      error: 'invalid_request',
      message: 'audioUrl (string) is required in request body',
    });
  }

  // URL处理
  audioUrl = normalizeUrl(audioUrl);

  // 背景图片URL处理
  if (backgroundImage && typeof backgroundImage === 'string') {
    backgroundImage = normalizeUrl(backgroundImage);
  }

  // SRT字幕URL处理
  let srtUrl = srt;
  if (srt && typeof srt === 'string') {
    srtUrl = normalizeUrl(srt);
  }

  const tempDir = path.join(os.tmpdir(), `audio-viz-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  const outputDir = path.join(__dirname, '..', 'public', 'videos');
  let audioFilePath = null;
  let backgroundImagePath = null;
  let srtFilePath = null;
  let outputFilePath = null;

  try {
    // 创建临时目录和输出目录
    await fs.promises.mkdir(tempDir, { recursive: true });
    await fs.promises.mkdir(outputDir, { recursive: true });

    console.log(`[convert/audio-to-video] Starting conversion, audioUrl: ${audioUrl}, backgroundImage: ${backgroundImage || 'none'}, srt: ${srtUrl || 'none'}`);

    // 下载音频文件
    const audioFileName = `audio-${Date.now()}.${getFileExtension(audioUrl)}`;
    audioFilePath = path.join(tempDir, audioFileName);
    await downloadAudio(audioUrl, audioFilePath);
    console.log(`[convert/audio-to-video] Downloaded audio: ${audioFilePath}`);

    // 如果提供了背景图片，下载图片
    if (backgroundImage && typeof backgroundImage === 'string') {
      const imageExt = getImageExtension(backgroundImage) || 'jpg';
      const imageFileName = `bg-${Date.now()}.${imageExt}`;
      backgroundImagePath = path.join(tempDir, imageFileName);
      await downloadImage(backgroundImage, backgroundImagePath);
      console.log(`[convert/audio-to-video] Downloaded background image: ${backgroundImagePath}`);
    }

    // 如果提供了SRT字幕，下载字幕文件
    if (srtUrl && typeof srtUrl === 'string') {
      const srtFileName = `subtitle-${Date.now()}.srt`;
      srtFilePath = path.join(tempDir, srtFileName);
      await downloadSrt(srtUrl, srtFilePath);
      console.log(`[convert/audio-to-video] Downloaded SRT subtitle: ${srtFilePath}`);
    }

    // 生成输出文件名
    const outputFileName = `video-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.mp4`;
    outputFilePath = path.join(outputDir, outputFileName);

    // 解析颜色值
    const bgColor = parseColorForFFmpeg(backgroundColor);
    const wvColor = parseColorForFFmpeg(waveColor);

    // 使用 ffmpeg 创建音频可视化视频
    // 支持的模式：line（线条）、point（点）、p2p（点到点）、cline（圆形线条）、bar（垂直条形图/均衡器）
    const waveMode = ['line', 'point', 'p2p', 'cline', 'bar'].includes(mode) ? mode : 'bar';
    
    // 条形图参数（用于bar模式，创建垂直条形图效果）
    const barWidthValue = parseInt(barWidth, 10) || 4;
    const barGapValue = parseInt(barGap, 10) || 2;
    const barSpacingValue = parseInt(barSpacing, 10) || 2; // 每个柱子之间的横向间隔（像素）
    
    // 根据条形间隔计算合适的win_size
    // 间隔越大，需要的条形越少，win_size应该越小
    // 间隔越小，需要的条形越多，win_size应该越大
    // 默认win_size=2048，根据间隔调整
    // 公式：win_size = baseWinSize * (defaultSpacing / actualSpacing)
    const baseWinSize = 2048;
    const defaultSpacing = 2; // 默认间隔
    const spacingRatio = defaultSpacing / Math.max(1, barSpacingValue); // 间隔比例
    // const adjustedWinSize = Math.max(512, Math.min(4096, Math.round(baseWinSize * spacingRatio)));
    const adjustedWinSize = 1024;
    
    // 波形图位置和尺寸参数
    // 如果未指定，波形图占满整个画面
    const waveXValue = waveX !== undefined ? parseInt(waveX, 10) : 0;
    const waveYValue = waveY !== undefined ? parseInt(waveY, 10) : 0;
    const waveWidthValue = waveWidth !== undefined ? parseInt(waveWidth, 10) : width;
    const waveHeightValue = waveHeight !== undefined ? parseInt(waveHeight, 10) : height;
    
    // 验证波形图尺寸不超过视频尺寸
    const finalWaveWidth = Math.min(waveWidthValue, width - waveXValue);
    const finalWaveHeight = Math.min(waveHeightValue, height - waveYValue);

    await new Promise((resolve, reject) => {
      let ffmpegCommand = ffmpeg();
      
      let filterComplex;
      
      if (backgroundImagePath) {
        // 使用背景图片
        let wavesFilter;
        if (waveMode === 'bar') {
          // 创建垂直条形图（均衡器样式）- 使用showfreqs
          // 波形图创建在指定尺寸的画布上
          // win_size根据barSpacing调整，控制条形数量和间隔
          wavesFilter = `[1:a]showfreqs=s=${finalWaveWidth}x${finalWaveHeight}:mode=bar:ascale=log:fscale=log:win_size=${adjustedWinSize}:overlap=0.5:colors=${wvColor}[waves]`;
        } else {
          // 使用showwaves创建波形
          wavesFilter = `[1:a]showwaves=mode=${waveMode}:colors=${wvColor}:s=${finalWaveWidth}x${finalWaveHeight}:rate=30[waves]`;
        }
        // 背景图片缩放并填充到视频尺寸
        // 波形图叠加到指定位置
        let videoFilter = `[0:v]scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=${bgColor},setsar=1,fps=30[bg];${wavesFilter};[bg][waves]overlay=${waveXValue}:${waveYValue}:shortest=1[v]`;
        
        // 如果提供了SRT字幕，添加字幕滤镜
        let finalVideoLabel = '[v]';
        if (srtFilePath) {
          // 转义SRT文件路径中的特殊字符
          // FFmpeg subtitles 滤镜需要将路径中的反斜杠转换为正斜杠
          // 使用单引号包裹路径，内部单引号需要转义为 '\''
          const escapedSrtPath = srtFilePath.replace(/\\/g, '/').replace(/'/g, "'\\''");
          // 字幕样式：白色文字，黑色描边，半透明背景，字体大小根据视频宽度自适应
          // Alignment=2 表示底部居中
          // MarginV=60 表示距离底部60像素（往上移动60像素）
          // const fontSize = Math.max(12, Math.round(width * 0.015)); // 字体大小至少12，为视频宽度的1.5%
          const fontSize = 11;
          const marginV = 60; // 字幕距离底部的像素距离
          console.log(`fontSize: ${fontSize}, marginV: ${marginV}`);
          // 使用中间标签 [vsub] 避免重复使用 [v]
          videoFilter = `${videoFilter};[v]subtitles='${escapedSrtPath}':force_style='FontName=Arial,FontSize=${fontSize},PrimaryColour=&Hffffff,OutlineColour=&H000000,BackColour=&H80000000,Bold=1,Alignment=2,MarginV=${marginV}'[vsub]`;
          finalVideoLabel = '[vsub]';
        }
        
        filterComplex = videoFilter;
        
        ffmpegCommand
          .input(backgroundImagePath)
          .inputOptions(['-loop', '1', '-framerate', '30'])
          .input(audioFilePath);
      } else {
        // 使用纯色背景
        let wavesFilter;
        if (waveMode === 'bar') {
          // 创建垂直条形图（均衡器样式）- 使用showfreqs
          // 波形图创建在指定尺寸的画布上
          // win_size根据barSpacing调整，控制条形数量和间隔
          wavesFilter = `[1:a]showfreqs=s=${finalWaveWidth}x${finalWaveHeight}:mode=bar:ascale=log:fscale=log:win_size=${adjustedWinSize}:overlap=0.5:colors=${wvColor}[waves]`;
        } else {
          // 使用showwaves创建波形
          wavesFilter = `[1:a]showwaves=mode=${waveMode}:colors=${wvColor}:s=${finalWaveWidth}x${finalWaveHeight}:rate=30[waves]`;
        }
        // 创建纯色背景，然后将波形图叠加到指定位置
        // 使用lavfi创建颜色背景
        let videoFilter = `[0:v]setsar=1,fps=30[bg];${wavesFilter};[bg][waves]overlay=${waveXValue}:${waveYValue}:shortest=1[v]`;
        
        // 如果提供了SRT字幕，添加字幕滤镜
        let finalVideoLabel = '[v]';
        if (srtFilePath) {
          // 转义SRT文件路径中的特殊字符
          // FFmpeg subtitles 滤镜需要将路径中的反斜杠转换为正斜杠
          // 使用单引号包裹路径，内部单引号需要转义为 '\''
          const escapedSrtPath = srtFilePath.replace(/\\/g, '/').replace(/'/g, "'\\''");
          // 字幕样式：白色文字，黑色描边，半透明背景，字体大小根据视频高度自适应
          // Alignment=2 表示底部居中
          // MarginV=60 表示距离底部60像素（往上移动60像素）
          const fontSize = Math.max(12, Math.round(height * 0.04)); // 字体大小至少12，为视频高度的4%
          const marginV = 60; // 字幕距离底部的像素距离
          // 使用中间标签 [vsub] 避免重复使用 [v]
          videoFilter = `${videoFilter};[v]subtitles='${escapedSrtPath}':force_style='FontName=Arial,FontSize=${fontSize},PrimaryColour=&Hffffff,OutlineColour=&H000000,BackColour=&H80000000,Bold=1,Alignment=2,MarginV=${marginV}'[vsub]`;
          finalVideoLabel = '[vsub]';
        }
        
        filterComplex = videoFilter;
        ffmpegCommand
          .input(`color=c=${bgColor}:s=${width}x${height}:d=1`)
          .inputOptions(['-f', 'lavfi'])
          .input(audioFilePath);
      }

      // 确定最终使用的视频标签（如果有字幕则使用 [vsub]，否则使用 [v]）
      const videoOutputLabel = srtFilePath ? '[vsub]' : '[v]';
      
      ffmpegCommand
        .complexFilter(filterComplex)
        .outputOptions([
          '-map', videoOutputLabel,
          '-map', backgroundImagePath ? '1:a' : '1:a', // 音频总是第二个输入（背景图片或颜色背景是第一个）
          '-c:v', 'libx264',
          '-c:a', 'aac',
          '-pix_fmt', 'yuv420p',
          '-shortest',
          '-r', '30'
        ])
        .on('start', (commandLine) => {
          console.log(`[convert/audio-to-video] FFmpeg command: ${commandLine}`);
          console.log(`[convert/audio-to-video] Background image path: ${backgroundImagePath || 'none'}`);
          console.log(`[convert/audio-to-video] SRT subtitle path: ${srtFilePath || 'none'}`);
          console.log(`[convert/audio-to-video] Waveform position: x=${waveXValue}, y=${waveYValue}, width=${finalWaveWidth}, height=${finalWaveHeight}`);
          console.log(`[convert/audio-to-video] Bar spacing: ${barSpacingValue}px, adjusted win_size: ${adjustedWinSize}`);
        })
        .on('progress', (progress) => {
          console.log(`[convert/audio-to-video] Processing: ${JSON.stringify(progress)}`);
        })
        .on('end', () => {
          console.log(`[convert/audio-to-video] Video conversion completed: ${outputFilePath}`);
          resolve();
        })
        .on('error', (err) => {
          console.error(`[convert/audio-to-video] FFmpeg error:`, err);
          console.error(`[convert/audio-to-video] Error details:`, {
            backgroundImagePath,
            audioFilePath,
            filterComplex
          });
          reject(err);
        })
        .save(outputFilePath);
    });

    // 将生成的 MP4 文件复制到指定目录
    const targetDir = '/root/projects/xhs-mcp/data';
    let copiedFilePath = null;
    try {
      // 确保目标目录存在
      await fs.promises.mkdir(targetDir, { recursive: true });
      
      // 复制文件到目标目录
      copiedFilePath = path.join(targetDir, outputFileName);
      await fs.promises.copyFile(outputFilePath, copiedFilePath);
      console.log(`[convert/audio-to-video] Video copied to: ${copiedFilePath}`);
    } catch (copyErr) {
      console.warn(`[convert/audio-to-video] Failed to copy video to ${targetDir}:`, copyErr);
      // 复制失败不影响主流程，继续执行
    }

    // 构造可访问的URL
    const baseUrl = `${req.protocol}://${req.get('host')}`;
    const relativePath = path.relative(path.join(__dirname, '..', 'public'), outputFilePath);
    const urlPath = `/static/${relativePath.split(path.sep).join('/')}`;
    const videoUrl = `${baseUrl}${urlPath}`;

    console.log(`[convert/audio-to-video] Conversion successful, URL: ${videoUrl}`);

    const response = {
      success: true,
      url: videoUrl,
      path: outputFilePath,
      filename: outputFileName,
      width: parseInt(width, 10),
      height: parseInt(height, 10),
      waveX: waveXValue,
      waveY: waveYValue,
      waveWidth: finalWaveWidth,
      waveHeight: finalWaveHeight,
      barSpacing: barSpacingValue,
    };

    if (srtUrl) {
      response.srtUrl = srtUrl;
      response.hasSubtitles = true;
    }

    if (copiedFilePath) {
      response.copiedPath = copiedFilePath;
    }

    return res.json(response);
  } catch (err) {
    console.error('[convert/audio-to-video] Conversion error:', err);
    
    if (outputFilePath) {
      try {
        await fs.promises.unlink(outputFilePath);
      } catch (e) {
        console.warn('[convert/audio-to-video] Failed to cleanup output file:', e);
      }
    }

    return res.status(500).json({
      error: 'conversion_failed',
      message: err && err.message ? err.message : String(err),
    });
  } finally {
    // 清理临时文件
    try {
      if (audioFilePath) {
        try {
          await fs.promises.unlink(audioFilePath);
        } catch (e) {
          console.warn(`[convert/audio-to-video] Failed to delete temp audio file:`, e);
        }
      }
      if (backgroundImagePath) {
        try {
          await fs.promises.unlink(backgroundImagePath);
        } catch (e) {
          console.warn(`[convert/audio-to-video] Failed to delete temp background image:`, e);
        }
      }
      if (srtFilePath) {
        try {
          await fs.promises.unlink(srtFilePath);
        } catch (e) {
          console.warn(`[convert/audio-to-video] Failed to delete temp SRT file:`, e);
        }
      }
      // 删除临时目录
      try {
        await fs.promises.rmdir(tempDir);
        console.log(`[convert/audio-to-video] Cleaned up temp directory: ${tempDir}`);
      } catch (e) {
        if (fs.promises.rm) {
          try {
            await fs.promises.rm(tempDir, { recursive: true, force: true });
            console.log(`[convert/audio-to-video] Cleaned up temp directory (recursive): ${tempDir}`);
          } catch (rmErr) {
            console.warn(`[convert/audio-to-video] Failed to remove temp directory: ${tempDir}`, rmErr);
          }
        } else {
          console.warn(`[convert/audio-to-video] Failed to remove temp directory: ${tempDir}`, e);
        }
      }
    } catch (e) {
      console.warn('[convert/audio-to-video] Failed to cleanup temp files:', e);
    }
  }
});

/**
 * 下载视频文件
 * @param {string} url - 视频文件URL
 * @param {string} filePath - 保存路径
 */
async function downloadVideo(url, filePath) {
  try {
    url = normalizeUrl(url);
    const response = await axios({
      method: 'GET',
      url: url,
      responseType: 'stream',
      timeout: 120000, // 120秒超时
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
    throw new Error(`Failed to download video from ${url}: ${err.message}`);
  }
}

/**
 * 获取视频文件时长（秒）
 * @param {string} filePath - 视频文件路径
 * @returns {Promise<number>} 视频时长（秒）
 */
function getVideoDuration(filePath) {
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
 * 获取图片尺寸
 * @param {string} filePath - 图片文件路径
 * @returns {Promise<{width: number, height: number}>} 图片尺寸
 */
function getImageDimensions(filePath) {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(filePath, (err, metadata) => {
      if (err) {
        reject(err);
        return;
      }
      const stream = metadata.streams.find(s => s.width && s.height);
      if (!stream) {
        reject(new Error('Could not find image dimensions'));
        return;
      }
      resolve({
        width: stream.width,
        height: stream.height,
      });
    });
  });
}

/**
 * 生成9:16的指定时长视频
 * POST /generate/video-9-16
 * 
 * 输入：
 * - targetDuration: 目标时长（秒）
 * - imageUrls: 图片URL数组
 * - videoUrls: 视频URL数组
 * - appendVideoUrls: 追加视频URL数组（当videoUrls和imageUrls生成的时长不够时使用）
 * 
 * 输出：
 * - url: 视频文件URL
 * - path: 本地路径
 * - duration: 视频实际时长
 */
router.post('/generate/video-9-16', express.json({ limit: '100mb' }), async (req, res) => {
  let { targetDuration, imageUrls = [], videoUrls = [], appendVideoUrls = [] } = req.body || {};

  // 参数验证
  if (typeof targetDuration !== 'number' || targetDuration <= 0) {
    return res.status(400).json({
      error: 'invalid_request',
      message: 'targetDuration (number > 0) is required in request body',
    });
  }

  if (!Array.isArray(imageUrls)) {
    return res.status(400).json({
      error: 'invalid_request',
      message: 'imageUrls must be an array',
    });
  }

  if (!Array.isArray(videoUrls)) {
    return res.status(400).json({
      error: 'invalid_request',
      message: 'videoUrls must be an array',
    });
  }

  if (!Array.isArray(appendVideoUrls)) {
    return res.status(400).json({
      error: 'invalid_request',
      message: 'appendVideoUrls must be an array',
    });
  }

  if (imageUrls.length === 0 && videoUrls.length === 0 && appendVideoUrls.length === 0) {
    return res.status(400).json({
      error: 'invalid_request',
      message: 'At least one of imageUrls, videoUrls, or appendVideoUrls must be provided',
    });
  }

  // URL处理
  imageUrls = imageUrls.map(url => normalizeUrl(url)).filter(url => url);
  videoUrls = videoUrls.map(url => normalizeUrl(url)).filter(url => url);
  appendVideoUrls = appendVideoUrls.map(url => normalizeUrl(url)).filter(url => url);

  const tempDir = path.join(os.tmpdir(), `video-9-16-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  const outputDir = path.join(__dirname, '..', 'public', 'videos');
  let outputFilePath = null;
  const tempFiles = [];

  try {
    // 创建临时目录和输出目录
    await fs.promises.mkdir(tempDir, { recursive: true });
    await fs.promises.mkdir(outputDir, { recursive: true });

    console.log(`[generate/video-9-16] Starting generation, targetDuration: ${targetDuration}s, videoUrls: ${videoUrls.length}, imageUrls: ${imageUrls.length}, appendVideoUrls: ${appendVideoUrls.length}`);

    const VIDEO_WIDTH = 1080;
    const VIDEO_HEIGHT = 1920;
    const processedVideoFiles = [];

    // 步骤1: 处理视频URL，拼接视频
    if (videoUrls.length > 0) {
      console.log(`[generate/video-9-16] Processing ${videoUrls.length} videos...`);
      
      // 下载所有视频
      const downloadedVideoFiles = [];
      for (let i = 0; i < videoUrls.length; i++) {
        const videoUrl = videoUrls[i];
        const videoExt = getFileExtension(videoUrl) || 'mp4';
        const videoFileName = `video-${i}-${Date.now()}.${videoExt}`;
        const videoFilePath = path.join(tempDir, videoFileName);
        await downloadVideo(videoUrl, videoFilePath);
        downloadedVideoFiles.push(videoFilePath);
        tempFiles.push(videoFilePath);
        console.log(`[generate/video-9-16] Downloaded video ${i + 1}/${videoUrls.length}: ${videoFilePath}`);
      }

      // 处理每个视频：转换为9:16，并获取时长
      const processedVideos = [];
      let totalVideoDuration = 0;

      for (let i = 0; i < downloadedVideoFiles.length; i++) {
        const videoPath = downloadedVideoFiles[i];
        const duration = await getVideoDuration(videoPath);
        console.log(`[generate/video-9-16] Video ${i + 1} duration: ${duration.toFixed(2)}s`);

        // 转换为9:16格式
        const processedVideoPath = path.join(tempDir, `processed-video-${i}-${Date.now()}.mp4`);
        await new Promise((resolve, reject) => {
          ffmpeg(videoPath)
            .videoFilters([
              `scale=${VIDEO_WIDTH}:${VIDEO_HEIGHT}:force_original_aspect_ratio=decrease`,
              `pad=${VIDEO_WIDTH}:${VIDEO_HEIGHT}:(ow-iw)/2:(oh-ih)/2:color=black`,
              'setsar=1',
            ])
            .videoCodec('libx264')
            .outputOptions([
              '-pix_fmt', 'yuv420p',
              '-r', '30',
              '-map', '0:v:0', // 映射视频流
              '-map', '0:a?',  // 可选音频流（如果存在）
            ])
            .audioCodec('aac') // 统一使用aac编码，如果原视频没有音频则会被忽略
            .on('start', (commandLine) => {
              console.log(`[generate/video-9-16] Processing video ${i + 1}: ${commandLine}`);
            })
            .on('end', () => {
              console.log(`[generate/video-9-16] Processed video ${i + 1}: ${processedVideoPath}`);
              resolve();
            })
            .on('error', (err) => {
              console.error(`[generate/video-9-16] Error processing video ${i + 1}:`, err);
              reject(err);
            })
            .save(processedVideoPath);
        });

        processedVideos.push({
          path: processedVideoPath,
          duration: duration,
        });
        tempFiles.push(processedVideoPath);
        totalVideoDuration += duration;

        // 如果累计时长已经达到或超过目标时长，停止处理
        if (totalVideoDuration >= targetDuration) {
          console.log(`[generate/video-9-16] Total video duration (${totalVideoDuration.toFixed(2)}s) reached target duration`);
          break;
        }
      }

      // 拼接所有处理后的视频
      if (processedVideos.length > 0) {
        const fileListPath = path.join(tempDir, 'video-list.txt');
        const fileListContent = processedVideos
          .map(v => `file '${v.path.replace(/'/g, "'\\''")}'`)
          .join('\n');
        await fs.promises.writeFile(fileListPath, fileListContent, 'utf8');
        tempFiles.push(fileListPath);

        const concatenatedVideoPath = path.join(tempDir, `concatenated-videos-${Date.now()}.mp4`);
        await new Promise((resolve, reject) => {
          ffmpeg()
            .input(fileListPath)
            .inputOptions(['-f', 'concat', '-safe', '0'])
            .videoCodec('libx264')
            .audioCodec('aac')
            .outputOptions(['-pix_fmt', 'yuv420p', '-r', '30'])
            .on('start', (commandLine) => {
              console.log(`[generate/video-9-16] Concatenating videos: ${commandLine}`);
            })
            .on('end', () => {
              console.log(`[generate/video-9-16] Videos concatenated: ${concatenatedVideoPath}`);
              resolve();
            })
            .on('error', (err) => {
              console.error(`[generate/video-9-16] Error concatenating videos:`, err);
              reject(err);
            })
            .save(concatenatedVideoPath);
        });

        tempFiles.push(concatenatedVideoPath);

        // 检查拼接后的视频时长，如果超过目标时长则截取
        const concatenatedDuration = await getVideoDuration(concatenatedVideoPath);
        console.log(`[generate/video-9-16] Concatenated video duration: ${concatenatedDuration.toFixed(2)}s`);

        if (concatenatedDuration > targetDuration) {
          // 截取到目标时长
          const trimmedVideoPath = path.join(tempDir, `trimmed-videos-${Date.now()}.mp4`);
          await new Promise((resolve, reject) => {
            ffmpeg(concatenatedVideoPath)
              .setDuration(targetDuration)
              .videoCodec('libx264')
              .audioCodec('aac')
              .outputOptions(['-pix_fmt', 'yuv420p'])
              .on('start', (commandLine) => {
                console.log(`[generate/video-9-16] Trimming video: ${commandLine}`);
              })
              .on('end', () => {
                console.log(`[generate/video-9-16] Video trimmed: ${trimmedVideoPath}`);
                resolve();
              })
              .on('error', (err) => {
                console.error(`[generate/video-9-16] Error trimming video:`, err);
                reject(err);
              })
              .save(trimmedVideoPath);
          });
          processedVideoFiles.push(trimmedVideoPath);
          tempFiles.push(trimmedVideoPath);
        } else {
          processedVideoFiles.push(concatenatedVideoPath);
        }
      }
    }

    // 步骤2: 如果视频时长未达到目标时长，处理图片
    let currentDuration = 0;
    if (processedVideoFiles.length > 0) {
      const firstVideoDuration = await getVideoDuration(processedVideoFiles[0]);
      currentDuration = firstVideoDuration;
    }

    const remainingDuration = targetDuration - currentDuration;
    console.log(`[generate/video-9-16] Current duration: ${currentDuration.toFixed(2)}s, Remaining: ${remainingDuration.toFixed(2)}s`);

    if (remainingDuration > 0 && imageUrls.length > 0) {
      console.log(`[generate/video-9-16] Processing images to fill remaining duration...`);

      // 下载所有图片
      const downloadedImageFiles = [];
      for (let i = 0; i < imageUrls.length; i++) {
        const imageUrl = imageUrls[i];
        const imageExt = getImageExtension(imageUrl) || 'jpg';
        const imageFileName = `image-${i}-${Date.now()}.${imageExt}`;
        const imageFilePath = path.join(tempDir, imageFileName);
        try {
          await downloadImage(imageUrl, imageFilePath);
          downloadedImageFiles.push(imageFilePath);
          tempFiles.push(imageFilePath);
          console.log(`[generate/video-9-16] Downloaded image ${i + 1}/${imageUrls.length}: ${imageFilePath}`);
        } catch (err) {
          console.warn(`[generate/video-9-16] Failed to download image ${i + 1}:`, err);
        }
      }

      // 过滤图片：丢弃宽度或高度小于500的图片
      const validImages = [];
      for (let i = 0; i < downloadedImageFiles.length; i++) {
        const imagePath = downloadedImageFiles[i];
        try {
          const dimensions = await getImageDimensions(imagePath);
          if (dimensions.width >= 500 && dimensions.height >= 500) {
            validImages.push({
              path: imagePath,
              width: dimensions.width,
              height: dimensions.height,
            });
            console.log(`[generate/video-9-16] Image ${i + 1} valid: ${dimensions.width}x${dimensions.height}`);
          } else {
            console.log(`[generate/video-9-16] Image ${i + 1} discarded: ${dimensions.width}x${dimensions.height} (too small)`);
          }
        } catch (err) {
          console.warn(`[generate/video-9-16] Failed to get dimensions for image ${i + 1}:`, err);
        }
      }

      // 处理每个有效图片：等比缩放为宽度1080，生成视频
      const imageVideoFiles = [];
      let accumulatedDuration = 0;

      for (let i = 0; i < validImages.length; i++) {
        const image = validImages[i];
        const imagePath = image.path;

        // 计算缩放后的高度
        const scaleRatio = VIDEO_WIDTH / image.width;
        const scaledHeight = Math.round(image.height * scaleRatio);

        let imageVideoPath;
        let imageVideoDuration;

        if (scaledHeight > VIDEO_HEIGHT) {
          // 高度超过1920，制作向下滚动视频
          // 滚动速度：假设滚动到底需要的时间为 (scaledHeight - VIDEO_HEIGHT) / 100 秒（每100像素1秒）
          const scrollDistance = scaledHeight - VIDEO_HEIGHT;
          const scrollDuration = Math.max(3, scrollDistance / 100); // 至少3秒
          imageVideoDuration = scrollDuration;

          // 如果累计时长加上这个视频时长会超过剩余时长，调整滚动时长
          if (accumulatedDuration + imageVideoDuration > remainingDuration) {
            imageVideoDuration = Math.max(1, remainingDuration - accumulatedDuration);
          }

          imageVideoPath = path.join(tempDir, `image-video-scroll-${i}-${Date.now()}.mp4`);
          await new Promise((resolve, reject) => {
            // 创建滚动视频：从顶部滚动到底部
            // 计算滚动速度：从y=0滚动到y=scrollDistance，用时imageVideoDuration秒
            const scrollSpeed = scrollDistance / imageVideoDuration; // 像素/秒
            
            // 使用crop滤镜实现滚动：y坐标从0开始，随时间增加，最大为scrollDistance
            // FFmpeg表达式：使用if(gte(...), max, calculated)来限制最大值
            const cropYExpression = `if(gte(t*${scrollSpeed}\\,${scrollDistance})\\,${scrollDistance}\\,t*${scrollSpeed})`;

            ffmpeg()
              .input(imagePath)
              .inputOptions(['-loop', '1', '-framerate', '30'])
              .outputOptions(['-vf', `"crop=w=${VIDEO_WIDTH}:h=${VIDEO_HEIGHT}:x=0:y='min(t*100, H-1920)',fps=30"`])
              .outputOptions(['-t', String(imageVideoDuration)])
              .videoCodec('libx264')
              .outputOptions([
                '-pix_fmt', 'yuv420p'
              ])
              .on('start', (commandLine) => {
                console.log(`[generate/video-9-16] Creating scroll video for image ${i + 1}: ${commandLine}`);
              })
              .on('end', () => {
                console.log(`[generate/video-9-16] Scroll video created for image ${i + 1}: ${imageVideoPath}`);
                resolve();
              })
              .on('error', (err) => {
                console.error(`[generate/video-9-16] Error creating scroll video for image ${i + 1}:`, err);
                reject(err);
              })
              .save(imageVideoPath);
          });
        } else {
          // 高度不超过1920，制作停留5秒的视频
          imageVideoDuration = 5;

          // 如果累计时长加上这个视频时长会超过剩余时长，调整时长
          if (accumulatedDuration + imageVideoDuration > remainingDuration) {
            imageVideoDuration = Math.max(1, remainingDuration - accumulatedDuration);
          }

          imageVideoPath = path.join(tempDir, `image-video-static-${i}-${Date.now()}.mp4`);
          await new Promise((resolve, reject) => {
            ffmpeg()
              .input(imagePath)
              .inputOptions(['-loop', '1', '-framerate', '30'])
              .input('anullsrc=channel_layout=stereo:sample_rate=44100')
              .inputOptions(['-f', 'lavfi', '-t', String(imageVideoDuration)])
              .videoFilters([
                `scale=${VIDEO_WIDTH}:${scaledHeight}:force_original_aspect_ratio=decrease`,
                `pad=${VIDEO_WIDTH}:${VIDEO_HEIGHT}:(ow-iw)/2:(oh-ih)/2:color=black`,
                'setsar=1',
              ])
              .videoCodec('libx264')
              .audioCodec('aac')
              .outputOptions([
                '-pix_fmt', 'yuv420p',
                '-r', '30',
                '-shortest',
                '-map', '0:v:0',
                '-map', '1:a:0',
              ])
              .on('start', (commandLine) => {
                console.log(`[generate/video-9-16] Creating static video for image ${i + 1}: ${commandLine}`);
              })
              .on('end', () => {
                console.log(`[generate/video-9-16] Static video created for image ${i + 1}: ${imageVideoPath}`);
                resolve();
              })
              .on('error', (err) => {
                console.error(`[generate/video-9-16] Error creating static video for image ${i + 1}:`, err);
                reject(err);
              })
              .save(imageVideoPath);
          });
        }

        imageVideoFiles.push(imageVideoPath);
        tempFiles.push(imageVideoPath);
        accumulatedDuration += imageVideoDuration;

        console.log(`[generate/video-9-16] Image ${i + 1} video duration: ${imageVideoDuration.toFixed(2)}s, Total: ${accumulatedDuration.toFixed(2)}s`);

        // 如果累计时长已经达到或超过剩余时长，停止处理
        if (accumulatedDuration >= remainingDuration) {
          console.log(`[generate/video-9-16] Image videos duration (${accumulatedDuration.toFixed(2)}s) reached remaining duration`);
          break;
        }
      }

      processedVideoFiles.push(...imageVideoFiles);
    }

    // 步骤3: 如果时长还不够，处理追加的视频
    let currentTotalDuration = 0;
    if (processedVideoFiles.length > 0) {
      // 计算当前所有视频的总时长
      for (const videoFile of processedVideoFiles) {
        const duration = await getVideoDuration(videoFile);
        currentTotalDuration += duration;
      }
    }

    const remainingAfterImages = targetDuration - currentTotalDuration;
    console.log(`[generate/video-9-16] Current total duration: ${currentTotalDuration.toFixed(2)}s, Remaining after images: ${remainingAfterImages.toFixed(2)}s`);

    if (remainingAfterImages > 0 && appendVideoUrls.length > 0) {
      console.log(`[generate/video-9-16] Processing append videos to fill remaining duration...`);

      // 下载所有追加视频
      const downloadedAppendVideoFiles = [];
      for (let i = 0; i < appendVideoUrls.length; i++) {
        const videoUrl = appendVideoUrls[i];
        const videoExt = getFileExtension(videoUrl) || 'mp4';
        const videoFileName = `append-video-${i}-${Date.now()}.${videoExt}`;
        const videoFilePath = path.join(tempDir, videoFileName);
        try {
          await downloadVideo(videoUrl, videoFilePath);
          downloadedAppendVideoFiles.push(videoFilePath);
          tempFiles.push(videoFilePath);
          console.log(`[generate/video-9-16] Downloaded append video ${i + 1}/${appendVideoUrls.length}: ${videoFilePath}`);
        } catch (err) {
          console.warn(`[generate/video-9-16] Failed to download append video ${i + 1}:`, err);
        }
      }

      // 处理每个追加视频：转换为9:16，并获取时长
      const appendProcessedVideos = [];
      let appendAccumulatedDuration = 0;

      for (let i = 0; i < downloadedAppendVideoFiles.length; i++) {
        const videoPath = downloadedAppendVideoFiles[i];
        const duration = await getVideoDuration(videoPath);
        console.log(`[generate/video-9-16] Append video ${i + 1} duration: ${duration.toFixed(2)}s`);

        // 转换为9:16格式
        const processedVideoPath = path.join(tempDir, `append-processed-video-${i}-${Date.now()}.mp4`);
        await new Promise((resolve, reject) => {
          ffmpeg(videoPath)
            .videoFilters([
              `scale=${VIDEO_WIDTH}:${VIDEO_HEIGHT}:force_original_aspect_ratio=decrease`,
              `pad=${VIDEO_WIDTH}:${VIDEO_HEIGHT}:(ow-iw)/2:(oh-ih)/2:color=black`,
              'setsar=1',
            ])
            .videoCodec('libx264')
            .outputOptions([
              '-pix_fmt', 'yuv420p',
              '-r', '30',
              '-map', '0:v:0',
              '-map', '0:a?',
            ])
            .audioCodec('aac')
            .on('start', (commandLine) => {
              console.log(`[generate/video-9-16] Processing append video ${i + 1}: ${commandLine}`);
            })
            .on('end', () => {
              console.log(`[generate/video-9-16] Processed append video ${i + 1}: ${processedVideoPath}`);
              resolve();
            })
            .on('error', (err) => {
              console.error(`[generate/video-9-16] Error processing append video ${i + 1}:`, err);
              reject(err);
            })
            .save(processedVideoPath);
        });

        appendProcessedVideos.push({
          path: processedVideoPath,
          duration: duration,
        });
        tempFiles.push(processedVideoPath);
        appendAccumulatedDuration += duration;

        // 如果累计时长已经达到或超过剩余时长，停止处理
        if (appendAccumulatedDuration >= remainingAfterImages) {
          console.log(`[generate/video-9-16] Append videos duration (${appendAccumulatedDuration.toFixed(2)}s) reached remaining duration`);
          break;
        }
      }

      // 如果追加视频总时长超过剩余时长，需要截取最后一个视频
      if (appendProcessedVideos.length > 0 && appendAccumulatedDuration > remainingAfterImages) {
        const lastVideo = appendProcessedVideos[appendProcessedVideos.length - 1];
        const lastVideoDuration = await getVideoDuration(lastVideo.path);
        const excessDuration = appendAccumulatedDuration - remainingAfterImages;
        const trimmedDuration = lastVideoDuration - excessDuration;

        if (trimmedDuration > 0) {
          // 截取最后一个视频
          const trimmedVideoPath = path.join(tempDir, `append-trimmed-video-${Date.now()}.mp4`);
          await new Promise((resolve, reject) => {
            ffmpeg(lastVideo.path)
              .setDuration(trimmedDuration)
              .videoCodec('libx264')
              .audioCodec('aac')
              .outputOptions(['-pix_fmt', 'yuv420p'])
              .on('start', (commandLine) => {
                console.log(`[generate/video-9-16] Trimming last append video: ${commandLine}`);
              })
              .on('end', () => {
                console.log(`[generate/video-9-16] Last append video trimmed: ${trimmedVideoPath}`);
                resolve();
              })
              .on('error', (err) => {
                console.error(`[generate/video-9-16] Error trimming last append video:`, err);
                reject(err);
              })
              .save(trimmedVideoPath);
          });

          // 替换最后一个视频
          appendProcessedVideos[appendProcessedVideos.length - 1] = {
            path: trimmedVideoPath,
            duration: trimmedDuration,
          };
          tempFiles.push(trimmedVideoPath);
        } else {
          // 如果截取后时长<=0，移除最后一个视频
          appendProcessedVideos.pop();
        }
      }

      // 将追加的视频添加到处理后的视频列表
      const appendVideoPaths = appendProcessedVideos.map(v => v.path);
      processedVideoFiles.push(...appendVideoPaths);
      console.log(`[generate/video-9-16] Added ${appendVideoPaths.length} append videos to the final list`);
    }

    // 步骤4: 拼接所有视频（视频拼接的视频 + 图片生成的视频 + 追加的视频）
    if (processedVideoFiles.length === 0) {
      return res.status(400).json({
        error: 'no_video_generated',
        message: 'No video was generated from the provided inputs',
      });
    }

    console.log(`[generate/video-9-16] Final concatenating ${processedVideoFiles.length} video segments...`);

    const finalFileListPath = path.join(tempDir, 'final-list.txt');
    const finalFileListContent = processedVideoFiles
      .map(v => `file '${v.replace(/'/g, "'\\''")}'`)
      .join('\n');
    await fs.promises.writeFile(finalFileListPath, finalFileListContent, 'utf8');
    tempFiles.push(finalFileListPath);

    // 生成输出文件名
    const outputFileName = `video-9-16-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.mp4`;
    outputFilePath = path.join(outputDir, outputFileName);

    await new Promise((resolve, reject) => {
      ffmpeg()
        .input(finalFileListPath)
        .inputOptions(['-f', 'concat', '-safe', '0'])
        .videoCodec('libx264')
        .audioCodec('aac')
        .outputOptions(['-pix_fmt', 'yuv420p', '-r', '30'])
        .on('start', (commandLine) => {
          console.log(`[generate/video-9-16] Final concatenation: ${commandLine}`);
        })
        .on('progress', (progress) => {
          console.log(`[generate/video-9-16] Processing: ${JSON.stringify(progress)}`);
        })
        .on('end', () => {
          console.log(`[generate/video-9-16] Final video created: ${outputFilePath}`);
          resolve();
        })
        .on('error', (err) => {
          console.error(`[generate/video-9-16] Error in final concatenation:`, err);
          reject(err);
        })
        .save(outputFilePath);
    });

    // 获取最终视频的实际时长
    const finalDuration = await getVideoDuration(outputFilePath);
    console.log(`[generate/video-9-16] Final video duration: ${finalDuration.toFixed(2)}s`);

    // 如果最终视频时长超过目标时长，截取到目标时长
    if (finalDuration > targetDuration) {
      const trimmedOutputPath = path.join(tempDir, `final-trimmed-${Date.now()}.mp4`);
      await new Promise((resolve, reject) => {
        ffmpeg(outputFilePath)
          .setDuration(targetDuration)
          .videoCodec('libx264')
          .audioCodec('aac')
          .outputOptions(['-pix_fmt', 'yuv420p'])
          .on('start', (commandLine) => {
            console.log(`[generate/video-9-16] Final trimming: ${commandLine}`);
          })
          .on('end', () => {
            console.log(`[generate/video-9-16] Final video trimmed: ${trimmedOutputPath}`);
            resolve();
          })
          .on('error', (err) => {
            console.error(`[generate/video-9-16] Error in final trimming:`, err);
            reject(err);
          })
          .save(trimmedOutputPath);
      });

      // 替换输出文件
      await fs.promises.unlink(outputFilePath);
      await fs.promises.rename(trimmedOutputPath, outputFilePath);
      tempFiles.push(trimmedOutputPath);
    }

    // 获取最终的实际时长
    const actualDuration = await getVideoDuration(outputFilePath);

    // 构造可访问的URL
    const baseUrl = `${req.protocol}://${req.get('host')}`;
    const relativePath = path.relative(path.join(__dirname, '..', 'public'), outputFilePath);
    const urlPath = `/static/${relativePath.split(path.sep).join('/')}`;
    const videoUrl = `${baseUrl}${urlPath}`;

    console.log(`[generate/video-9-16] Generation successful, URL: ${videoUrl}, Duration: ${actualDuration.toFixed(2)}s`);

    return res.json({
      success: true,
      url: videoUrl,
      path: outputFilePath,
      duration: parseFloat(actualDuration.toFixed(2)),
      targetDuration: targetDuration,
    });
  } catch (err) {
    console.error('[generate/video-9-16] Generation error:', err);

    if (outputFilePath) {
      try {
        await fs.promises.unlink(outputFilePath);
      } catch (e) {
        console.warn('[generate/video-9-16] Failed to cleanup output file:', e);
      }
    }

    return res.status(500).json({
      error: 'generation_failed',
      message: err && err.message ? err.message : String(err),
    });
  } finally {
    // 清理临时文件
    try {
      for (const file of tempFiles) {
        try {
          if (fs.existsSync(file)) {
            await fs.promises.unlink(file);
          }
        } catch (e) {
          console.warn(`[generate/video-9-16] Failed to delete temp file ${file}:`, e);
        }
      }
      // 删除临时目录
      try {
        if (fs.existsSync(tempDir)) {
          await fs.promises.rmdir(tempDir);
          console.log(`[generate/video-9-16] Cleaned up temp directory: ${tempDir}`);
        }
      } catch (e) {
        if (fs.promises.rm) {
          try {
            await fs.promises.rm(tempDir, { recursive: true, force: true });
            console.log(`[generate/video-9-16] Cleaned up temp directory (recursive): ${tempDir}`);
          } catch (rmErr) {
            console.warn(`[generate/video-9-16] Failed to remove temp directory: ${tempDir}`, rmErr);
          }
        } else {
          console.warn(`[generate/video-9-16] Failed to remove temp directory: ${tempDir}`, e);
        }
      }
    } catch (e) {
      console.warn('[generate/video-9-16] Failed to cleanup temp files:', e);
    }
  }
});

module.exports = router;

