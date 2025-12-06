const express = require('express');
const nodeHtmlToImage = require('node-html-to-image');
const fs = require('fs');
const path = require('path');

const router = express.Router();

// 在路由层解析文本（适配 * 所有 content-type），内部再尝试解析为 JSON
router.post('/', express.text({ type: '*/*', limit: '10mb' }), async (req, res) => {
  // 统一归一化请求体：优先解析 JSON，失败则按原始 HTML 处理
  let payload;
  if (typeof req.body === 'string') {
    const raw = req.body.trim();
    try {
      payload = JSON.parse(raw);
    } catch {
      payload = { html: raw };
    }
  } else if (req.body && typeof req.body === 'object') {
    payload = req.body;
  } else {
    payload = {};
  }

  const {
    html,
    type = 'png',
    quality = 80,
    transparent = false,
    encoding = 'binary',
    selector,
    waitUntil = 'networkidle0',
    puppeteerArgs = { args: ['--no-sandbox', '--disable-setuid-sandbox'] },
    // 新增：图片目标尺寸与视口参数
    width,
    height,
    viewportWidth,
    viewportHeight,
    deviceScaleFactor,
    // 新增：设备类型（mobile/pc/desktop）
    device,
  } = payload || {};

  // 调试：打印传入参数（避免输出完整HTML，仅预览片段与长度）
  try {
    const htmlLength = typeof html === 'string' ? Buffer.byteLength(html, 'utf8') : 0;
    const htmlPreview = typeof html === 'string' ? html.slice(0, 120).replace(/\n/g, ' ') : undefined;
    console.log('[render] incoming request', {
      ip: req.ip,
      contentType: req.get('content-type'),
      type,
      quality,
      transparent,
      encoding,
      selector,
      waitUntil,
      width,
      height,
      viewportWidth,
      viewportHeight,
      deviceScaleFactor,
      device,
      outputDir: payload && payload.outputDir,
      outputName: payload && payload.outputName,
      puppeteerArgs: (puppeteerArgs && puppeteerArgs.args) ? puppeteerArgs.args : puppeteerArgs,
      htmlLength,
      htmlPreview,
    });
  } catch (e) {
    console.warn('[render] failed to log incoming params:', e);
  }

  if (!html || typeof html !== 'string') {
    return res.status(400).json({ error: 'invalid_request', message: 'html (string) is required in request body, or send raw HTML with Content-Type: text/plain' });
  }

  // 组装带有尺寸的 HTML：若传入 width/height，则为 body 注入尺寸样式
  let finalHtml = html;
  try {
    if (width || height) {
      const w = typeof width === 'number' ? width : parseInt(width, 10);
      const h = typeof height === 'number' ? height : parseInt(height, 10);
      const sizeStyle = `body{margin:0;${w ? `width:${w}px;` : ''}${h ? `height:${h}px;` : ''}}`;
      if (/<head[\s>]/i.test(html) && /<body[\s>]/i.test(html)) {
        finalHtml = html.replace(/<head(.*?)>/i, (m) => `${m}\n<style>${sizeStyle}</style>`);
      } else if (/<body[\s>]/i.test(html)) {
        // 有 body 无 head：在 body 前注入一个 head
        finalHtml = html.replace(/<html(.*?)>/i, (m) => `${m}`)
          .replace(/<body(.*?)>/i, (m) => `<head><style>${sizeStyle}</style></head>\n${m}`);
      } else {
        // 无完整文档结构，进行包装
        finalHtml = `<!DOCTYPE html><html><head><style>${sizeStyle}</style></head><body>${html}</body></html>`;
      }
    }
  } catch (e) {
    console.warn('Failed to inject size styles, fallback to original html:', e);
    finalHtml = html;
  }

  // 组装 puppeteerArgs 的视口参数，防止大尺寸内容被默认视口裁剪
  const viewport = (viewportWidth || viewportHeight || deviceScaleFactor)
    ? {
        width: viewportWidth ? parseInt(viewportWidth, 10) : undefined,
        height: viewportHeight ? parseInt(viewportHeight, 10) : undefined,
        deviceScaleFactor: deviceScaleFactor ? parseInt(deviceScaleFactor, 10) : undefined,
      }
    : undefined;
  const puppeteerArgsWithViewport = viewport
    ? { ...puppeteerArgs, defaultViewport: { width: viewport.width || 800, height: viewport.height || 600, deviceScaleFactor: viewport.deviceScaleFactor || 1 } }
    : puppeteerArgs;

  // 根据 device 参数设置 UA 与视口（如未显式传入 viewport 参数）
  const deviceType = (device || '').toLowerCase();
  let ua;
  let deviceViewport;
  if (deviceType === 'mobile') {
    ua = 'Mozilla/5.0 (iPhone; CPU iPhone OS 15_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.0 Mobile/15E148 Safari/604.1';
    deviceViewport = { width: 390, height: 844, deviceScaleFactor: 3 };
  } else if (deviceType === 'pc' || deviceType === 'desktop') {
    ua = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/118.0.0.0 Safari/537.36';
    deviceViewport = { width: 1366, height: 768, deviceScaleFactor: 1 };
  }
  const finalPuppeteerArgs = (!viewport && deviceViewport)
    ? { ...puppeteerArgsWithViewport, defaultViewport: { width: deviceViewport.width, height: deviceViewport.height, deviceScaleFactor: deviceViewport.deviceScaleFactor } }
    : puppeteerArgsWithViewport;
  finalPuppeteerArgs.args = [ '--no-sandbox', '--disable-setuid-sandbox', '--font-render-hinting=medium' ]
  try {
    const image = await nodeHtmlToImage({
      html: finalHtml,
      type,
      quality,
      transparent,
      encoding,
      selector,
      waitUntil,
      puppeteerArgs: finalPuppeteerArgs,
      beforeScreenshot: async (page) => {
        try {
          if (ua) {
            await page.setUserAgent(ua);
          }
          // 不在此处调整 viewport，避免破坏 DOM 上下文
        } catch (e) {
          console.warn('beforeScreenshot adjustments failed:', e);
        }
      },
    });

    if (encoding === 'base64') {
      return res.json({ encoding: 'base64', data: image, type });
    }

    // 新增：encoding=url 时保存到本地并返回访问地址
    if (encoding === 'url') {
      try {
        const ext = type === 'jpeg' ? 'jpg' : 'png';
        const outputDir = payload && payload.outputDir
          ? path.isAbsolute(payload.outputDir) ? payload.outputDir : path.join(__dirname, '..', payload.outputDir)
          : path.join(__dirname, '..', 'public', 'images');
        await fs.promises.mkdir(outputDir, { recursive: true });

        const baseName = payload && payload.outputName
          ? payload.outputName.replace(/\.[a-zA-Z0-9]+$/, '')
          : `render-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const fileName = `${baseName}.${ext}`;
        const filePath = path.join(outputDir, fileName);

        const buffer = typeof image === 'string' ? Buffer.from(image, 'base64') : image;
        await fs.promises.writeFile(filePath, buffer);

        // 构造可访问的URL（挂载在/static下，public目录为根）
        const baseUrl = `${req.protocol}://${req.get('host')}`;
        let urlPath;
        if (outputDir.startsWith(path.join(__dirname, '..', 'public'))) {
          const relativePath = path.relative(path.join(__dirname, '..', 'public'), filePath);
          urlPath = `/static/${relativePath.split(path.sep).join('/')}`;
        } else {
          // 非public目录，仍返回相对文件URL路径，可能不可直接访问
          urlPath = `/static/${fileName}`;
        }

        // 调试：打印保存结果
        console.log('[render] saved image', { path: filePath, url: `${baseUrl}${urlPath}`, type, filename: fileName });

        return res.json({ encoding: 'url', url: `${baseUrl}${urlPath}`, path: filePath, type, filename: fileName });
      } catch (e) {
        console.error('Saving image failed:', e);
        return res.status(500).json({ error: 'render_failed', message: `save_failed: ${e && e.message ? e.message : String(e)}` });
      }
    }

    const mime = type === 'jpeg' ? 'image/jpeg' : 'image/png';
    const ext = type === 'jpeg' ? 'jpg' : 'png';
    res.set('Content-Type', mime);
    res.set('Content-Disposition', `inline; filename="rendered.${ext}"`);
    return res.send(image);
  } catch (err) {
    console.error('Render error:', err);
    return res.status(500).json({ error: 'render_failed', message: err && err.message ? err.message : String(err) });
  }
});

module.exports = router;

