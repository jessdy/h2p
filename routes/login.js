const express = require('express');
const { LoginValidator, PLATFORM_CONFIG } = require('../utils/loginValidator');

const router = express.Router();

/**
 * 验证平台登录状态
 * POST /login/validate
 * 
 * 请求体:
 * {
 *   "platform": "xiaohongshu" | "douyin" | "youtube",
 *   "cookies": [  // 可选，如果为空则自动从本地文件加载
 *     {
 *       "name": "cookie_name",
 *       "value": "cookie_value",
 *       "domain": ".example.com",
 *       "path": "/",
 *       "secure": false,
 *       "httpOnly": false,
 *       "session": false
 *     }
 *   ],
 *   "options": {
 *     "headless": true,
 *     "timeout": 30000,
 *     "savePath": "./cookies",  // cookies 保存/加载路径
 *     "cookieFilePath": null  // 可选，指定 cookie 文件路径（如果不指定则自动查找最新文件）
 *   }
 * }
 * 
 * 注意：如果 cookies 参数为空或未提供，系统会自动从 savePath 目录下查找该平台最新的 cookie 文件并加载。
 */
router.post('/validate', express.json(), async (req, res) => {
  try {
    const { platform, cookies = [], options = {} } = req.body || {};

    // 验证必需参数
    if (!platform) {
      return res.status(400).json({
        error: 'invalid_request',
        message: 'platform 参数是必需的',
        supportedPlatforms: Object.keys(PLATFORM_CONFIG),
      });
    }

    // 验证平台是否支持
    if (!PLATFORM_CONFIG[platform]) {
      return res.status(400).json({
        error: 'unsupported_platform',
        message: `不支持的平台: ${platform}`,
        supportedPlatforms: Object.keys(PLATFORM_CONFIG),
      });
    }

    // 验证 cookies 格式（如果提供了 cookies）
    if (cookies !== undefined && cookies !== null) {
      if (!Array.isArray(cookies)) {
        return res.status(400).json({
          error: 'invalid_request',
          message: 'cookies 必须是一个数组',
        });
      }

      // 验证 cookies 数组中的每个元素
      // if (cookies.length > 0) {
      //   const requiredFields = ['name', 'value', 'domain'];
      //   for (let i = 0; i < cookies.length; i++) {
      //     const cookie = cookies[i];
      //     const missingFields = requiredFields.filter(field => !cookie[field]);
      //     if (missingFields.length > 0) {
      //       return res.status(400).json({
      //         error: 'invalid_cookie_format',
      //         message: `cookies[${i}] 缺少必需字段: ${missingFields.join(', ')}`,
      //         requiredFields,
      //       });
      //     }
      //   }
      // }
    }

    // 如果提供了 cookieFilePath，将其添加到 options 中
    if (req.body.cookieFilePath) {
      options.cookieFilePath = req.body.cookieFilePath;
    }

    const cookiesCount = (cookies && Array.isArray(cookies)) ? cookies.length : 0;
    console.log(`[login/validate] 开始验证 ${PLATFORM_CONFIG[platform].displayName} 登录状态，cookies 数量: ${cookiesCount}${cookiesCount === 0 ? ' (将尝试从本地文件加载)' : ''}`);

    // 调用验证器
    const result = await LoginValidator.validate(platform, cookies, options);

    // 根据验证结果返回响应
    if (result.success) {
      return res.json({
        success: true,
        platform: platform,
        platformName: PLATFORM_CONFIG[platform].displayName,
        message: result.message,
        cookies: result.cookies,
        cookiesCount: result.cookies.length,
        savedPath: result.savedPath,
      });
    } else {
      return res.status(200).json({
        success: false,
        platform: platform,
        platformName: PLATFORM_CONFIG[platform].displayName,
        message: result.message,
        error: result.error || 'validation_failed',
      });
    }
  } catch (error) {
    console.error('[login/validate] 验证过程中发生错误:', error);
    return res.status(500).json({
      error: 'validation_error',
      message: error.message || '验证过程中发生未知错误',
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined,
    });
  }
});

/**
 * 获取支持的平台列表
 * GET /login/platforms
 */
router.get('/platforms', (req, res) => {
  const platforms = Object.keys(PLATFORM_CONFIG).map(key => ({
    key,
    name: PLATFORM_CONFIG[key].name,
    displayName: PLATFORM_CONFIG[key].displayName,
    loginUrl: PLATFORM_CONFIG[key].loginUrl,
  }));

  return res.json({
    success: true,
    platforms,
    count: platforms.length,
  });
});

/**
 * 获取指定平台的配置信息
 * GET /login/platform/:platform
 */
router.get('/platform/:platform', (req, res) => {
  const { platform } = req.params;

  if (!PLATFORM_CONFIG[platform]) {
    return res.status(404).json({
      error: 'platform_not_found',
      message: `平台 ${platform} 不存在`,
      supportedPlatforms: Object.keys(PLATFORM_CONFIG),
    });
  }

  const config = PLATFORM_CONFIG[platform];
  return res.json({
    success: true,
    platform: {
      key: platform,
      name: config.name,
      displayName: config.displayName,
      loginUrl: config.loginUrl,
      checkUrl: config.checkUrl,
    },
  });
});

module.exports = router;

