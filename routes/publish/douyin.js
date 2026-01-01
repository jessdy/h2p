const express = require('express');
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const { LoginValidator, PLATFORM_CONFIG } = require('../../utils/loginValidator');
const axios = require('axios');
const { normalizeUrl } = require('../../utils/urlUtils');

const router = express.Router();

/**
 * 发布视频到抖音
 * POST /publish/douyin
 * 
 * 请求体:
 * {
 *   "videoUrl": "视频文件URL或本地路径",
 *   "title": "视频标题",
 *   "description": "视频描述（可选）",
 *   "tags": ["标签1", "标签2"], // 可选
 *   "coverImage": "封面图片URL（可选）",
 *   "cookies": [...], // 可选，如果为空则自动从本地文件加载
 *   "options": {
 *     "headless": false, // 是否无头模式，默认 false（方便调试）
 *     "timeout": 120000, // 超时时间（毫秒），默认 120 秒
 *     "savePath": "./cookies", // cookies 保存/加载路径
 *     "cookieFilePath": null // 可选，指定 cookie 文件路径
 *   }
 * }
 */
router.post('/', express.json({ limit: '100mb' }), async (req, res) => {
  let browser = null;
  let context = null;
  let page = null;
  let tempVideoPath = null;

  try {
    const { 
      videoUrl, 
      title, 
      description = '', 
      tags = [], 
      coverImage,
      cookies = [],
      options = {} 
    } = req.body || {};

    // 参数验证
    if (!videoUrl) {
      return res.status(400).json({
        error: 'invalid_request',
        message: 'videoUrl 参数是必需的',
      });
    }

    if (!title || typeof title !== 'string' || title.trim().length === 0) {
      return res.status(400).json({
        error: 'invalid_request',
        message: 'title 参数是必需的且不能为空',
      });
    }

    // 验证标题长度（抖音限制，通常允许更长的标题）
    if (title.length > 55) {
      return res.status(400).json({
        error: 'invalid_request',
        message: '标题长度不能超过 55 个字符',
      });
    }

    // 验证描述长度（抖音限制）
    if (description && description.length > 2200) {
      return res.status(400).json({
        error: 'invalid_request',
        message: '描述长度不能超过 2200 个字符',
      });
    }

    const platform = 'douyin';
    const config = PLATFORM_CONFIG[platform];
    const publishOptions = {
      headless: options.headless !== undefined ? options.headless : false, // 默认有头模式，方便调试
      timeout: options.timeout || 120000, // 默认 120 秒超时
      savePath: options.savePath || path.join(__dirname, '../../cookies'),
      cookieFilePath: options.cookieFilePath || null,
      ...options,
    };

    console.log(`[publish/douyin] 开始发布视频，标题: ${title}`);

    // 加载 cookies
    let cookiesToUse = cookies;
    if (!cookiesToUse || cookiesToUse.length === 0) {
      console.log(`[publish/douyin] Cookies 参数为空，尝试从本地文件加载...`);
      const validator = new LoginValidator(platform, [], publishOptions);
      const loadResult = await validator.loadCookiesFromFile(publishOptions.cookieFilePath);
      if (loadResult.success) {
        cookiesToUse = loadResult.cookies;
        console.log(`[publish/douyin] 成功从本地文件加载 ${cookiesToUse.length} 个 cookies`);
      } else {
        return res.status(401).json({
          error: 'no_cookies',
          message: `Cookies 参数为空且无法从本地文件加载: ${loadResult.message}`,
        });
      }
    }

    // 处理视频文件
    let videoFilePath = null;
    if (videoUrl.startsWith('http://') || videoUrl.startsWith('https://')) {
      // 下载远程视频文件
      console.log(`[publish/douyin] 下载视频文件: ${videoUrl}`);
      const tempDir = path.join(__dirname, '../../public/temp');
      await fs.promises.mkdir(tempDir, { recursive: true });
      const videoFileName = `video-${Date.now()}.mp4`;
      tempVideoPath = path.join(tempDir, videoFileName);
      
      const response = await axios({
        url: normalizeUrl(videoUrl),
        method: 'GET',
        responseType: 'stream',
        timeout: 60000,
      });
      
      const writer = fs.createWriteStream(tempVideoPath);
      response.data.pipe(writer);
      
      await new Promise((resolve, reject) => {
        writer.on('finish', resolve);
        writer.on('error', reject);
      });
      
      videoFilePath = tempVideoPath;
      console.log(`[publish/douyin] 视频文件已下载到: ${videoFilePath}`);
    } else {
      // 本地文件路径
      videoFilePath = path.isAbsolute(videoUrl) ? videoUrl : path.join(__dirname, '../../', videoUrl);
      if (!fs.existsSync(videoFilePath)) {
        return res.status(400).json({
          error: 'file_not_found',
          message: `视频文件不存在: ${videoFilePath}`,
        });
      }
      console.log(`[publish/douyin] 使用本地视频文件: ${videoFilePath}`);
    }

    // 启动浏览器
    console.log(`[publish/douyin] 启动浏览器...`);
    browser = await chromium.launch({
      headless: publishOptions.headless,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });

    // 创建上下文
    context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    });

    // 添加 cookies
    if (cookiesToUse && cookiesToUse.length > 0) {
      const playwrightCookies = cookiesToUse.map(cookie => ({
        name: cookie.name,
        value: cookie.value,
        domain: cookie.domain,
        path: cookie.path || '/',
        secure: cookie.secure || false,
        httpOnly: cookie.httpOnly || false,
        sameSite: cookie.sameSite || 'Lax',
        expires: cookie.expires || -1,
      }));

      await context.addCookies(playwrightCookies);
      console.log(`[publish/douyin] 已添加 ${playwrightCookies.length} 个 cookies`);
    }

    // 创建页面
    page = await context.newPage();

    // 导航到抖音创作者中心发布页面
    const publishUrl = 'https://creator.douyin.com/creator-micro/content/post/video?enter_from=publish_page';
    console.log(`[publish/douyin] 访问发布页面: ${publishUrl}`);
    await page.goto(publishUrl, {
      waitUntil: 'networkidle',
      timeout: publishOptions.timeout,
    });

    // 等待页面加载
    await page.waitForTimeout(3000);

    // 检查是否已登录
    const currentUrl = page.url();
    if (currentUrl.includes('/login') || currentUrl.includes('/signin') || currentUrl.includes('/passport')) {
      return res.status(200).json({
        error: 'not_logged_in',
        message: '未登录或登录已过期，请先登录',
      });
    }

    console.log(`[publish/douyin] 已确认登录状态`);

    // 等待上传按钮出现
    console.log(`[publish/douyin] 等待上传按钮...`);
    
    // 尝试多种可能的上传按钮选择器（抖音可能的选择器）
    const uploadSelectors = [
      'div[class*=content-right-] input[class*=upload-btn-input-][name=upload-btn]'
    ];
    
    let uploadInput = null;
    for (const selector of uploadSelectors) {
      try {
        await page.waitForTimeout(5000);
        // await page.waitForSelector(selector, { timeout: 15000 });
        uploadInput = await page.locator(selector);
        if (uploadInput) {
          console.log(`[publish/douyin] 找到上传输入框: ${selector}`);
          break;
        }
      } catch (e) {
        console.error(`[publish/douyin] 等待上传按钮超时: ${e.message}`);
      }
    }

    // 上传视频文件
    console.log(`[publish/douyin] 上传视频文件: ${videoFilePath}`);
    await uploadInput.setInputFiles(videoFilePath);
    console.log(`[publish/douyin] 视频文件已选择，等待上传完成...`);

    // 等待视频上传完成（通常会有进度提示）
    await page.waitForTimeout(2000);

    // 等待视频检测完成，判断检测结果是否为"作品未见异常"
    console.log(`[publish/douyin] 等待视频检测完成...`);
    try {
      // 等待检测项标题元素出现，并检查文本是否为"作品未见异常"
      await page.waitForFunction(
        () => {
          const detectItems = Array.from(document.querySelectorAll('div[class*="detectItemTitle-"]'));
          for (const item of detectItems) {
            const text = item.textContent?.trim() || '';
            if (text === '作品未见异常') {
              return true;
            }
          }
          return false;
        },
        { timeout: 20000 } // 最多等待 30 秒
      );
      console.log(`[publish/douyin] 视频检测完成，作品未见异常`);
    } catch (e) {
      console.warn(`[publish/douyin] 等待视频检测超时或未找到检测结果，继续执行...`);
      // 即使超时也继续执行，因为可能检测已经完成但元素结构不同
    }
    // await page.screenshot({ path: path.join(__dirname, '../../public/temp', `debug-${Date.now()}.png`), fullPage: true });
    
    // 填写标题
    console.log(`[publish/douyin] 填写标题: ${title}`);
    const titleSelectors = [
      '.editor-kit-root-container>div>div>div>input',
    ];

    let titleFilled = false;
    for (const selector of titleSelectors) {
      try {
        const titleInput = await page.$(selector);
        if (titleInput) {
          await titleInput.fill(title);
          titleFilled = true;
          console.log(`[publish/douyin] 标题已填写`);
          break;
        }
      } catch (e) {
        // 继续尝试下一个选择器
      }
    }

    // 填写描述（如果提供）
    if (description && description.trim().length > 0) {
      const tagText = tags.map(tag => tag.startsWith('#') ? tag : `#${tag}`).join(' ');
      console.log(`[publish/douyin] 填写描述`);
      const descSelectors = [
        'div.editor-kit-editor-container.old > div',
      ];

      for (const selector of descSelectors) {
        try {
          const descInput = await page.$(selector);
          if (descInput) {
            await descInput.fill(description + '\n' + tagText);
            console.log(`[publish/douyin] 描述已填写`);
            break;
          }
        } catch (e) {
          // 继续尝试下一个选择器
        }
      }
    }

    // 等待一下，确保所有内容都已填写
    await page.waitForTimeout(20000);

    // 查找发布按钮
    console.log(`[publish/douyin] 查找发布按钮...`);
    const publishSelectors = [
      '#popover-tip-container button:text-is("发布")'
    ];

    let publishButton = null;
    let publishSelector = null;

    // 先找到发布按钮元素
    for (const selector of publishSelectors) {
      try {
        const button = await page.$(selector);
        if (button) {
          publishButton = button;
          publishSelector = selector;
          console.log(`[publish/douyin] 找到发布按钮: ${selector}`);
          break;
        }
      } catch (e) {
        // 继续尝试下一个选择器
      }
    }

    if (!publishButton) {
      return res.status(500).json({
        error: 'publish_button_not_found',
        message: '无法找到发布按钮，请检查页面状态',
      });
    }

    // 等待发布按钮变为可用状态（表示视频已上传完成）
    console.log(`[publish/douyin] 等待发布按钮变为可用状态（视频上传中...）`);
    
    // 使用轮询方式等待按钮变为可用，最多等待 60 秒
    const maxWaitTime = 60000; // 60 秒
    const pollInterval = 1000; // 每秒检查一次
    const startTime = Date.now();
    let isButtonEnabled = false;

    while (Date.now() - startTime < maxWaitTime) {
      try {
        // 重新获取按钮元素（因为页面可能更新）
        const currentButton = await page.$(publishSelector);
        if (currentButton) {
          const isDisabled = await currentButton.isDisabled();
          
          // 也检查按钮的类名和属性
          const buttonInfo = await currentButton.evaluate((btn) => {
            return {
              disabled: btn.disabled,
              hasDisabledAttr: btn.hasAttribute('disabled'),
              hasDisabledClass: btn.classList.contains('disabled') || btn.classList.contains('is-disabled'),
              className: btn.className,
            };
          });

          const isActuallyDisabled = isDisabled || 
                                    buttonInfo.hasDisabledAttr || 
                                    buttonInfo.hasDisabledClass;

          if (!isActuallyDisabled) {
            isButtonEnabled = true;
            publishButton = currentButton; // 更新按钮引用
            console.log(`[publish/douyin] 发布按钮已变为可用状态，视频上传完成`);
            break;
          }
        }
      } catch (e) {
        console.warn(`[publish/douyin] 检查按钮状态时出错:`, e.message);
      }

      // 等待一段时间后再次检查
      await page.waitForTimeout(pollInterval);
    }

    if (!isButtonEnabled) {
      // 最后再检查一次
      try {
        const finalButton = await page.$(publishSelector);
        if (finalButton) {
          const finalCheck = await finalButton.isDisabled();
          if (!finalCheck) {
            isButtonEnabled = true;
            publishButton = finalButton;
          }
        }
      } catch (e) {
        // 忽略错误
      }
    }

    if (!isButtonEnabled) {
      return res.status(500).json({
        error: 'publish_button_disabled',
        message: '发布按钮一直处于禁用状态，视频可能未上传完成或存在其他问题。请检查视频是否已成功上传。',
      });
    }

    // 确认按钮可用后点击
    console.log(`[publish/douyin] 点击发布按钮`);
    await publishButton.click();

    // 等待发布完成
    console.log(`[publish/douyin] 等待发布完成...`);
    await page.waitForTimeout(120000);

    // 检查是否发布成功（通常会有成功提示或跳转）
    const finalUrl = page.url();
    const pageContent = await page.content();
    
    const successIndicators = [
      /发布成功/i,
      /发布完成/i,
      /success/i,
      /已发布/i,
    ];

    const isSuccess = successIndicators.some(pattern => 
      pattern.test(pageContent) || pattern.test(finalUrl)
    );
    // page.screenshot({ path: path.join(__dirname, '../../public/temp', `debug-${Date.now()}.png`), fullPage: true });

    if (isSuccess || !finalUrl.includes('/upload')) {
      console.log(`[publish/douyin] 发布成功`);
      return res.json({
        success: true,
        message: '视频发布成功',
        title,
        description,
        tags,
        videoUrl: videoUrl,
        publishedAt: new Date().toISOString(),
      });
    } else {
      // 即使没有明确的成功提示，也认为可能已发布（因为点击了发布按钮）
      console.log(`[publish/douyin] 发布流程已完成`);
      return res.json({
        success: true,
        message: '发布流程已完成，请手动确认发布状态',
        title,
        description,
        tags,
        videoUrl: videoUrl,
        publishedAt: new Date().toISOString(),
        note: '建议在抖音创作者中心手动确认发布状态',
      });
    }

  } catch (error) {
    console.error('[publish/douyin] 发布过程中发生错误:', error);
    return res.status(500).json({
      error: 'publish_failed',
      message: error.message || '发布过程中发生未知错误',
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined,
    });
  } finally {
    // 清理资源
    try {
      if (page) await page.close();
      if (context) await context.close();
      if (browser) await browser.close();
      
      // 清理临时视频文件
      if (tempVideoPath && fs.existsSync(tempVideoPath)) {
        try {
          await fs.promises.unlink(tempVideoPath);
          console.log(`[publish/douyin] 已清理临时视频文件: ${tempVideoPath}`);
        } catch (e) {
          console.warn(`[publish/douyin] 清理临时文件失败:`, e);
        }
      }
    } catch (e) {
      console.warn('[publish/douyin] 清理资源时出错:', e);
    }
  }
});

module.exports = router;

