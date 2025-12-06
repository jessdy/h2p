const express = require('express');
const ffmpeg = require('fluent-ffmpeg');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { downloadAudio, downloadImage, downloadSrt } = require('../utils/download');
const { getFileExtension, getImageExtension } = require('../utils/fileUtils');
const { parseColorForFFmpeg } = require('../utils/colorUtils');
const { normalizeUrl } = require('../utils/urlUtils');

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

module.exports = router;

