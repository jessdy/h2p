const express = require('express');
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const { LoginValidator, PLATFORM_CONFIG } = require('../../utils/loginValidator');
const axios = require('axios');
const { normalizeUrl } = require('../../utils/urlUtils');

const router = express.Router();

/**
 * 发布视频到 YouTube Shorts
 * POST /publish/youtube
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
 *     "timeout": 300000, // 超时时间（毫秒），默认 300 秒（YouTube 上传可能需要更长时间）
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

    // 验证标题长度（YouTube 限制 100 字符）
    if (title.length > 100) {
      return res.status(400).json({
        error: 'invalid_request',
        message: '标题长度不能超过 100 个字符',
      });
    }

    // 验证描述长度（YouTube 限制 5000 字符）
    if (description && description.length > 5000) {
      return res.status(400).json({
        error: 'invalid_request',
        message: '描述长度不能超过 5000 个字符',
      });
    }

    const platform = 'youtube';
    const config = PLATFORM_CONFIG[platform];
    const publishOptions = {
      headless: options.headless !== undefined ? options.headless : false, // 默认有头模式，方便调试
      timeout: options.timeout || 300000, // 默认 300 秒超时（YouTube 上传需要更长时间）
      savePath: options.savePath || path.join(__dirname, '../../cookies'),
      cookieFilePath: options.cookieFilePath || null,
      ...options,
    };

    console.log(`[publish/youtube] 开始发布 YouTube Shorts，标题: ${title}`);

    // 加载 cookies
    let cookiesToUse = cookies;
    if (!cookiesToUse || cookiesToUse.length === 0) {
      console.log(`[publish/youtube] Cookies 参数为空，尝试从本地文件加载...`);
      const validator = new LoginValidator(platform, [], publishOptions);
      const loadResult = await validator.loadCookiesFromFile(publishOptions.cookieFilePath);
      if (loadResult.success) {
        cookiesToUse = loadResult.cookies;
        console.log(`[publish/youtube] 成功从本地文件加载 ${cookiesToUse.length} 个 cookies`);
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
      console.log(`[publish/youtube] 下载视频文件: ${videoUrl}`);
      const tempDir = path.join(__dirname, '../../public/temp');
      await fs.promises.mkdir(tempDir, { recursive: true });
      const videoFileName = `video-${Date.now()}-${Math.random().toString(36).substring(7)}.mp4`;
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
      console.log(`[publish/youtube] 视频文件已下载到: ${videoFilePath}`);
    } else {
      // 本地文件路径
      videoFilePath = path.isAbsolute(videoUrl) ? videoUrl : path.join(__dirname, '../../', videoUrl);
      if (!fs.existsSync(videoFilePath)) {
        return res.status(400).json({
          error: 'file_not_found',
          message: `视频文件不存在: ${videoFilePath}`,
        });
      }
      console.log(`[publish/youtube] 使用本地视频文件: ${videoFilePath}`);
    }

    // 启动浏览器
    console.log(`[publish/youtube] 启动浏览器...`);
    browser = await chromium.launch({
      headless: publishOptions.headless,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--remote-debugging-port=9222', '--remote-debugging-address=0.0.0.0', '--remote-allow-origins=*'],
      env: {
        ...process.env,
        BROWSER_REMOTE_DEBUGGING_PORT: '9222',
        BROWSER_REMOTE_DEBUGGING_ADDRESS: '0.0.0.0',
        BROWSER_REMOTE_ALLOW_ORIGINS: '*',
        PLAYWRIGHT_CHROMIUM_ARGS: '--remote-debugging-address=0.0.0.0'
      },
    });

    // 创建上下文
    context = await browser.newContext({
      viewport: { width: 1920, height: 1080 },
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
      console.log(`[publish/youtube] 已添加 ${playwrightCookies.length} 个 cookies`);
    }

    // 创建页面
    page = await context.newPage();

    // 导航到 YouTube Studio 上传页面
    const uploadUrl = 'https://studio.youtube.com/channel/UC*/videos/upload';
    console.log(`[publish/youtube] 访问 YouTube Studio: ${uploadUrl}`);
    await page.goto(uploadUrl, {
      timeout: publishOptions.timeout,
    });

    // 等待页面加载
    await page.waitForTimeout(5000);

    // 检查是否已登录
    const currentUrl = page.url();
    if (currentUrl.includes('/accounts/') || currentUrl.includes('/signin') || currentUrl.includes('/login')) {
      return res.status(401).json({
        error: 'not_logged_in',
        message: '未登录或登录已过期，请先登录',
      });
    }

    console.log(`[publish/youtube] 已确认登录状态`);

    // 查找并点击"创建"或"上传"按钮
    console.log(`[publish/youtube] 查找上传按钮...`);
    
    // YouTube Studio 的上传按钮可能有多种选择器
    const createButtonSelectors = [
      'button[aria-label*="上传视频"]'
    ];

    let createButton = null;
    for (const selector of createButtonSelectors) {
      try {
        const button = await page.$(selector);
        if (button) {
          const isVisible = await button.isVisible();
          if (isVisible) {
            createButton = button;
            console.log(`[publish/youtube] 找到创建按钮: ${selector}`);
            break;
          }
        }
      } catch (e) {
        // 继续尝试下一个选择器
      }
    }

    // 如果找不到创建按钮，尝试直接访问上传页面
    console.log(`[publish/youtube] 点击创建按钮...`);
    await createButton.click();
    await page.waitForTimeout(3000);

    // 如果出现菜单，选择"上传视频"
    // 等待上传输入框出现
    console.log(`[publish/youtube] 等待上传输入框...`);
    
    const uploadInputSelectors = [
      'input[type="file"][name*="Filedata"]'
    ];

    let uploadInput = null;
    for (const selector of uploadInputSelectors) {
      try {
        await page.waitForSelector(selector, { timeout: 10000 });
        uploadInput = await page.$(selector);
        if (uploadInput) {
          console.log(`[publish/youtube] 找到上传输入框: ${selector}`);
          break;
        }
      } catch (e) {
        // 继续尝试下一个选择器
      }
    }

    // 如果找不到上传输入框，尝试点击"选择文件"按钮
    if (!uploadInput) {
      const selectFileButtonSelectors = [
        'button[aria-label*="选择文件"]'
      ];

      for (const selector of selectFileButtonSelectors) {
        try {
          const button = await page.$(selector);
          if (button) {
            await button.click();
            await page.waitForTimeout(2000);
            // 再次尝试查找文件输入框
            uploadInput = await page.$('input[type="file"]');
            if (uploadInput) break;
          }
        } catch (e) {
          // 继续尝试
        }
      }
    }

    if (!uploadInput) {
      // 保存页面截图用于调试
      const screenshotPath = path.join(__dirname, '../../public/temp', `youtube-debug-${Date.now()}.png`);
      await fs.promises.mkdir(path.dirname(screenshotPath), { recursive: true });
      await page.screenshot({ path: screenshotPath, fullPage: true });
      
      return res.status(500).json({
        error: 'upload_element_not_found',
        message: '无法找到上传按钮或文件输入框，请检查页面结构',
        debugScreenshot: screenshotPath,
      });
    }

    // 上传视频文件
    console.log(`[publish/youtube] 上传视频文件: ${videoFilePath}`);
    await uploadInput.setInputFiles(videoFilePath);
    console.log(`[publish/youtube] 视频文件已选择，等待上传和处理完成...`);

    // 等待视频上传和处理完成
    await page.waitForTimeout(5000);

    // 等待上传进度完成
    try {
      // YouTube 通常会有上传进度指示器
      await page.waitForSelector('[class*="progress"], [class*="upload"], [class*="processing"]', { 
        state: 'hidden', 
        timeout: 180000 // 3 分钟
      });
      console.log(`[publish/youtube] 视频上传和处理完成`);
    } catch (e) {
      console.log(`[publish/youtube] 等待上传超时，继续执行...`);
      // 等待额外时间确保上传完成
      await page.waitForTimeout(10000);
    }

    // 填写标题
    console.log(`[publish/youtube] 填写标题: ${title}`);
    const titleSelectors = [
      '#textbox[aria-label*="标题"]'
    ];

    let titleFilled = false;
    for (const selector of titleSelectors) {
      try {
        const titleInput = await page.$(selector);
        if (titleInput) {
          await titleInput.fill(title);
          // 触发输入事件
          await titleInput.evaluate((el) => {
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
          });
          titleFilled = true;
          console.log(`[publish/youtube] 标题已填写`);
          await page.waitForTimeout(1000);
          break;
        }
      } catch (e) {
        // 继续尝试下一个选择器
      }
    }

    if (!titleFilled) {
      // 尝试通过页面评估来填写标题
      await page.evaluate((titleText) => {
        const inputs = Array.from(document.querySelectorAll('input, textarea, #textbox'));
        for (const input of inputs) {
          const label = input.getAttribute('aria-label') || input.placeholder || '';
          if (label.includes('标题') || label.includes('Title') || label.includes('title')) {
            input.value = titleText;
            input.dispatchEvent(new Event('input', { bubbles: true }));
            input.dispatchEvent(new Event('change', { bubbles: true }));
            return true;
          }
        }
        return false;
      }, title);
      await page.waitForTimeout(1000);
    }

    // 填写描述（如果提供）
    if (description && description.trim().length > 0) {
      console.log(`[publish/youtube] 填写描述`);
      const descSelectors = [
        '#textbox[aria-label*="描述"]',
        '#textbox[aria-label*="Description"]',
        'textarea[aria-label*="描述"]',
        'textarea[aria-label*="Description"]',
        '#textbox[placeholder*="告诉观看者"]',
        '#textbox[placeholder*="Tell viewers"]',
        '[id*="description"] textarea',
        '[id*="description"] #textbox',
        '[class*="description"] textarea',
        '[class*="description"] #textbox',
      ];

      for (const selector of descSelectors) {
        try {
          const descInput = await page.$(selector);
          if (descInput) {
            await descInput.fill(description);
            await descInput.evaluate((el) => {
              el.dispatchEvent(new Event('input', { bubbles: true }));
              el.dispatchEvent(new Event('change', { bubbles: true }));
            });
            console.log(`[publish/youtube] 描述已填写`);
            await page.waitForTimeout(1000);
            break;
          }
        } catch (e) {
          // 继续尝试下一个选择器
        }
      }
    }

    // 确保视频被识别为 Shorts（通常小于 60 秒的视频会自动识别）
    // 设置内容不是面向儿童的
    try {
      const notchildSelector = '[id=radioContainer][class="style-scope tp-yt-paper-radio-button"]';
      const notchildInputs = await page.$$(notchildSelector);
      if (notchildInputs && notchildInputs.length > 1) {
        await notchildInputs[1].click();
        console.log(`[publish/youtube] 已设置为 内容不是面向儿童的`);
      }
    } catch (e) {
      console.log(`[publish/youtube] 设置儿童内容选项时出错: ${e.message}`);
    }
    await page.waitForTimeout(1000);

    // 查找并点击"下一步"或"发布"按钮
    console.log(`[publish/youtube] 查找下一步/发布按钮...`);
    
    // YouTube 上传流程通常有多个步骤，需要点击"下一步"
    const nextButtonSelectors = [
      'button[aria-label*="继续"]'
    ];

    // 尝试点击"下一步"按钮（如果有多个步骤）
    let hasNextStep = true;
    let stepCount = 0;
    const maxSteps = 3; // 最多 3 个步骤

    while (hasNextStep && stepCount < maxSteps) {
      let nextButton = null;
      for (const selector of nextButtonSelectors) {
        try {
          const button = await page.$(selector);
          if (button && await button.isVisible()) {
            nextButton = button;
            break;
          }
        } catch (e) {
          // 继续尝试
        }
      }

      if (nextButton) {
        console.log(`[publish/youtube] 点击下一步按钮 (步骤 ${stepCount + 1})`);
        await nextButton.click();
        await page.waitForTimeout(3000);
        stepCount++;
      } else {
        hasNextStep = false;
      }
    }

    // 设置发布选项（选择第3个单选按钮）
    try {
      const publishSelector = '[id=radioContainer][class="style-scope tp-yt-paper-radio-button"]';
      const publishInputs = await page.$$(publishSelector);
      if (publishInputs && publishInputs.length > 2) {
        await publishInputs[2].click();
        console.log(`[publish/youtube] 已设置发布选项`);
      }
    } catch (e) {
      console.log(`[publish/youtube] 设置发布选项时出错: ${e.message}`);
    }
    await page.waitForTimeout(3000);

    // 查找最终发布按钮
    const publishButtonSelectors = [
      '#done-button'
    ];

    let publishButton = null;
    let publishSelector = null;

    for (const selector of publishButtonSelectors) {
      await page.waitForTimeout(1000);
      console.log(`[publish/youtube] 等待发布按钮...${selector}`);
      try {
        const button = await page.$(selector);
        if (button) {
          console.log(`[publish/youtube] 找到发布按钮: ${selector}`);
          publishButton = button;
          publishSelector = selector;
          console.log(`[publish/youtube] 找到发布按钮: ${selector}`);
          break;
        }
      } catch (e) {
        // 继续尝试下一个选择器
        console.error(`[publish/youtube] 找到发布按钮时出错: ${e.message}`);
      }
    }

    if (!publishButton) {
      // 保存页面截图用于调试
      const screenshotPath = path.join(__dirname, '../../public/temp', `youtube-publish-debug-${Date.now()}.png`);
      await fs.promises.mkdir(path.dirname(screenshotPath), { recursive: true });
      await page.screenshot({ path: screenshotPath, fullPage: true });
      
      return res.status(500).json({
        error: 'publish_button_not_found',
        message: '无法找到发布按钮，请检查页面状态',
        debugScreenshot: screenshotPath,
      });
    }

    // 等待发布按钮变为可用状态
    console.log(`[publish/youtube] 等待发布按钮变为可用状态...`);
    
    const maxWaitTime = 60000; // 60 秒
    const pollInterval = 2000; // 每 2 秒检查一次
    const startTime = Date.now();
    let isButtonEnabled = false;

    while (Date.now() - startTime < maxWaitTime) {
      try {
        const currentButton = await page.$(publishSelector);
        if (currentButton) {
          const isDisabled = await currentButton.isDisabled();
          
          const buttonInfo = await currentButton.evaluate((btn) => {
            return {
              disabled: btn.disabled,
              hasDisabledAttr: btn.hasAttribute('disabled'),
              hasDisabledClass: btn.classList.contains('disabled') || btn.classList.contains('is-disabled'),
            };
          });

          const isActuallyDisabled = isDisabled || 
                                    buttonInfo.hasDisabledAttr || 
                                    buttonInfo.hasDisabledClass;

          if (!isActuallyDisabled) {
            isButtonEnabled = true;
            publishButton = currentButton;
            console.log(`[publish/youtube] 发布按钮已变为可用状态`);
            break;
          }
        }
      } catch (e) {
        console.warn(`[publish/youtube] 检查按钮状态时出错:`, e.message);
      }

      await page.waitForTimeout(pollInterval);
    }

    if (!isButtonEnabled) {
      console.log(`[publish/youtube] 发布按钮可能仍处于禁用状态，尝试点击...`);
    }

    // 点击发布按钮
    console.log(`[publish/youtube] 点击发布按钮`);
    await publishButton.click();

    // 等待发布完成
    console.log(`[publish/youtube] 等待发布完成...`);
    await page.waitForTimeout(10000);

    // 检查是否发布成功
    const finalUrl = page.url();
    const pageContent = await page.content();
    
    const successIndicators = [
      /发布成功/i,
      /Published/i,
      /发布完成/i,
      /success/i,
      /已发布/i,
    ];

    const isSuccess = successIndicators.some(pattern => 
      pattern.test(pageContent) || pattern.test(finalUrl)
    );

    if (isSuccess || !finalUrl.includes('/upload')) {
      console.log(`[publish/youtube] 发布成功`);
      return res.json({
        success: true,
        message: 'YouTube Shorts 发布成功',
        platform: 'youtube',
        title,
        description,
        tags,
        videoUrl: videoUrl,
        publishedAt: new Date().toISOString(),
      });
    } else {
      // 即使没有明确的成功提示，也认为可能已发布
      console.log(`[publish/youtube] 发布流程已完成`);
      return res.json({
        success: true,
        message: '发布流程已完成，请手动确认发布状态',
        platform: 'youtube',
        title,
        description,
        tags,
        videoUrl: videoUrl,
        publishedAt: new Date().toISOString(),
        note: '建议在 YouTube Studio 手动确认发布状态',
      });
    }

  } catch (error) {
    console.error('[publish/youtube] 发布过程中发生错误:', error);
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
          console.log(`[publish/youtube] 已清理临时视频文件: ${tempVideoPath}`);
        } catch (e) {
          console.warn(`[publish/youtube] 清理临时文件失败:`, e);
        }
      }
    } catch (e) {
      console.warn('[publish/youtube] 清理资源时出错:', e);
    }
  }
});

module.exports = router;
