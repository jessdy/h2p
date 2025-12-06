const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

/**
 * 平台配置
 */
const PLATFORM_CONFIG = {
  xiaohongshu: {
    name: 'xiaohongshu',
    displayName: '小红书',
    loginUrl: 'https://creator.xiaohongshu.com',
    checkUrl: 'https://creator.xiaohongshu.com',
    // 验证登录成功的标识（页面标题、URL、或特定元素）
    successIndicators: {
      title: /创作者中心|小红书/,
      url: /creator\.xiaohongshu\.com/,
    },
  },
  douyin: {
    name: 'douyin',
    displayName: '抖音',
    loginUrl: 'https://creator.douyin.com',
    checkUrl: 'https://creator.douyin.com',
    successIndicators: {
      title: /创作者中心|抖音/,
      url: /creator\.douyin\.com/,
    },
  },
  youtube: {
    name: 'youtube',
    displayName: 'YouTube',
    loginUrl: 'https://studio.youtube.com',
    checkUrl: 'https://studio.youtube.com',
    successIndicators: {
      title: /YouTube Studio|YouTube/,
      url: /studio\.youtube\.com/,
    },
  },
};

/**
 * 登录验证器类
 * 使用 Playwright 模拟浏览器验证平台登录状态
 */
class LoginValidator {
  /**
   * 构造函数
   * @param {string} platform - 平台类型 (xiaohongshu, douyin)
   * @param {Array} cookies - Cookies 数组
   * @param {Object} options - 可选配置
   */
  constructor(platform, cookies = [], options = {}) {
    if (!PLATFORM_CONFIG[platform]) {
      throw new Error(`不支持的平台: ${platform}。支持的平台: ${Object.keys(PLATFORM_CONFIG).join(', ')}`);
    }

    this.platform = platform;
    this.config = PLATFORM_CONFIG[platform];
    this.cookies = cookies;
    this.options = {
      headless: options.headless !== false, // 默认无头模式
      timeout: options.timeout || 30000, // 默认30秒超时
      savePath: options.savePath || path.join(__dirname, '../cookies'), // 默认保存路径
      ...options,
    };

    // 确保保存目录存在
    if (!fs.existsSync(this.options.savePath)) {
      fs.mkdirSync(this.options.savePath, { recursive: true });
    }
  }

  /**
   * 验证登录状态
   * @returns {Promise<Object>} 验证结果 { success: boolean, message: string, cookies: Array }
   */
  async validate() {
    let browser = null;
    let context = null;
    let page = null;

    try {
      console.log(`[LoginValidator] 开始验证 ${this.config.displayName} 登录状态...`);

      // 如果 cookies 为空，尝试从本地文件加载
      let cookiesToUse = this.cookies;
      let loadedFromFile = false;
      
      if (!cookiesToUse || cookiesToUse.length === 0) {
        console.log(`[LoginValidator] Cookies 参数为空，尝试从本地文件加载...`);
        // 如果 options 中指定了 cookieFilePath，使用指定的文件路径
        const cookieFilePath = this.options.cookieFilePath || null;
        const loadedResult = await this.loadCookiesFromFile(cookieFilePath);
        if (loadedResult.success) {
          cookiesToUse = loadedResult.cookies;
          loadedFromFile = true;
          this.cookies = cookiesToUse;
          console.log(`[LoginValidator] 成功从本地文件加载 ${cookiesToUse.length} 个 cookies: ${loadedResult.filePath}`);
        } else {
          return {
            success: false,
            message: `Cookies 参数为空且无法从本地文件加载: ${loadedResult.message}`,
            cookies: [],
            error: 'no_cookies_available',
          };
        }
      }

      // 启动浏览器
      browser = await chromium.launch({
        headless: this.options.headless,
      });

      // 创建上下文
      context = await browser.newContext({
        viewport: { width: 1920, height: 1080 },
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      });

      // 添加 cookies
      if (cookiesToUse && cookiesToUse.length > 0) {
        // 转换 cookies 格式为 Playwright 需要的格式
        const playwrightCookies = this.cookies.map(cookie => ({
          name: cookie.name,
          value: cookie.value,
          domain: cookie.domain,
          path: cookie.path || '/',
          secure: cookie.secure || false,
          httpOnly: cookie.httpOnly || false,
          sameSite: cookie.sameSite || 'Lax',
          expires: cookie.expires || -1, // -1 表示会话 cookie
        }));

        await context.addCookies(playwrightCookies);
        console.log(`[LoginValidator] 已添加 ${playwrightCookies.length} 个 cookies${loadedFromFile ? ' (从本地文件加载)' : ''}`);
      }

      // 创建页面
      page = await context.newPage();

      // 导航到登录检查页面
      console.log(`[LoginValidator] 正在访问 ${this.config.checkUrl}...`);
      await page.goto(this.config.checkUrl, {
        waitUntil: 'domcontentloaded',
        timeout: this.options.timeout,
      });

      // 等待页面加载
      await page.waitForTimeout(2000);

      // 检查登录状态
      const isLoggedIn = await this.checkLoginStatus(page);

      if (isLoggedIn) {
        console.log(`[LoginValidator] ✓ ${this.config.displayName} 登录验证成功`);

        // 获取当前页面的所有 cookies
        const currentCookies = await context.cookies();
        
        // 转换为指定格式
        const formattedCookies = this.formatCookies(currentCookies);

        // 保存 cookies 到本地文件
        const savedPath = await this.saveCookies(formattedCookies);

        return {
          success: true,
          message: `${this.config.displayName} 登录验证成功`,
          cookies: formattedCookies,
          savedPath,
        };
      } else {
        console.log(`[LoginValidator] ✗ ${this.config.displayName} 登录验证失败`);
        return {
          success: false,
          message: `${this.config.displayName} 登录验证失败，请检查 cookies 是否有效`,
          cookies: [],
        };
      }
    } catch (error) {
      console.error(`[LoginValidator] 验证过程中发生错误:`, error);
      return {
        success: false,
        message: `验证失败: ${error.message}`,
        cookies: [],
        error: error.message,
      };
    } finally {
      // 清理资源
      if (page) await page.close();
      if (context) await context.close();
      if (browser) await browser.close();
    }
  }

  /**
   * 检查登录状态
   * @param {Object} page - Playwright 页面对象
   * @returns {Promise<boolean>} 是否已登录
   */
  async checkLoginStatus(page) {
    try {
      const indicators = this.config.successIndicators;
      const currentUrl = page.url();
      const title = await page.title();

      // 检查 URL
      if (indicators.url && !indicators.url.test(currentUrl)) {
        console.log(`[LoginValidator] URL 不匹配: ${currentUrl}`);
        return false;
      }

      // 检查标题
      if (indicators.title && !indicators.title.test(title)) {
        console.log(`[LoginValidator] 标题不匹配: ${title}`);
        return false;
      }

      // 检查是否跳转到登录页面（常见登录页标识）
      const loginPageIndicators = [
        /login/i,
        /signin/i,
        /登录/i,
        /auth/i,
      ];

      const isLoginPage = loginPageIndicators.some(pattern => 
        pattern.test(currentUrl) || pattern.test(title)
      );

      if (isLoginPage) {
        console.log(`[LoginValidator] 检测到登录页面，登录状态无效`);
        return false;
      }

      // 尝试查找用户相关元素（可选，根据平台调整）
      try {
        // 等待页面稳定
        await page.waitForTimeout(1000);
        
        // 检查是否有用户信息或登录后的特征元素
        // 这里可以根据不同平台添加特定的检查逻辑
        const hasUserInfo = await page.evaluate(() => {
          // 检查是否有用户相关的文本或元素
          const bodyText = document.body.innerText || '';
          return !bodyText.includes('登录') && !bodyText.includes('请登录');
        });

        return hasUserInfo;
      } catch (e) {
        // 如果检查失败，至少 URL 和标题匹配，认为可能已登录
        console.log(`[LoginValidator] 无法检查用户信息，但 URL 和标题匹配`);
        return true;
      }
    } catch (error) {
      console.error(`[LoginValidator] 检查登录状态时出错:`, error);
      return false;
    }
  }

  /**
   * 格式化 cookies 为指定格式
   * @param {Array} cookies - Playwright cookies 数组
   * @returns {Array} 格式化后的 cookies
   */
  formatCookies(cookies) {
    return cookies.map(cookie => ({
      name: cookie.name,
      value: cookie.value,
      domain: cookie.domain,
      path: cookie.path || '/',
      secure: cookie.secure || false,
      httpOnly: cookie.httpOnly || false,
      session: cookie.expires === -1 || !cookie.expires || cookie.expires < Date.now() / 1000,
    }));
  }

  /**
   * 从本地文件加载 cookies
   * @param {string} filePath - 可选的指定文件路径，如果不提供则自动查找最新文件
   * @returns {Promise<Object>} { success: boolean, cookies: Array, filePath: string, message: string }
   */
  async loadCookiesFromFile(filePath = null) {
    try {
      let targetPath = filePath;

      // 如果没有指定文件路径，查找最新的 cookie 文件
      if (!targetPath) {
        const latestFile = this.findLatestCookieFile();
        if (!latestFile) {
          return {
            success: false,
            cookies: [],
            message: `未找到 ${this.config.displayName} 的本地 cookie 文件`,
          };
        }
        targetPath = latestFile;
      }

      // 检查文件是否存在
      if (!fs.existsSync(targetPath)) {
        return {
          success: false,
          cookies: [],
          message: `Cookie 文件不存在: ${targetPath}`,
        };
      }

      // 读取文件内容
      const fileContent = fs.readFileSync(targetPath, 'utf-8');
      const cookies = JSON.parse(fileContent);

      // 验证 cookies 格式
      if (!Array.isArray(cookies)) {
        return {
          success: false,
          cookies: [],
          message: `Cookie 文件格式错误: 应为数组格式`,
        };
      }

      if (cookies.length === 0) {
        return {
          success: false,
          cookies: [],
          message: `Cookie 文件为空`,
        };
      }

      return {
        success: true,
        cookies,
        filePath: targetPath,
        message: `成功加载 ${cookies.length} 个 cookies`,
      };
    } catch (error) {
      console.error(`[LoginValidator] 加载本地 cookies 时出错:`, error);
      return {
        success: false,
        cookies: [],
        message: `加载失败: ${error.message}`,
      };
    }
  }

  /**
   * 查找指定平台最新的 cookie 文件
   * @returns {string|null} 最新文件的路径，如果未找到则返回 null
   */
  findLatestCookieFile() {
    try {
      const cookieDir = this.options.savePath;

      // 检查目录是否存在
      if (!fs.existsSync(cookieDir)) {
        console.log(`[LoginValidator] Cookie 目录不存在: ${cookieDir}`);
        return null;
      }

      // 查找匹配平台的文件（格式: platform-cookies-timestamp.json）
      const pattern = new RegExp(`^${this.platform}-cookies-\\d+\\.json$`);
      const files = fs.readdirSync(cookieDir)
        .filter(file => pattern.test(file))
        .map(file => ({
          name: file,
          path: path.join(cookieDir, file),
          mtime: fs.statSync(path.join(cookieDir, file)).mtime.getTime(),
        }))
        .sort((a, b) => b.mtime - a.mtime); // 按修改时间降序排序

      if (files.length === 0) {
        console.log(`[LoginValidator] 未找到 ${this.config.displayName} 的 cookie 文件`);
        return null;
      }

      // 返回最新的文件
      const latestFile = files[0];
      console.log(`[LoginValidator] 找到最新的 cookie 文件: ${latestFile.name} (修改时间: ${new Date(latestFile.mtime).toLocaleString()})`);
      return latestFile.path;
    } catch (error) {
      console.error(`[LoginValidator] 查找 cookie 文件时出错:`, error);
      return null;
    }
  }

  /**
   * 保存 cookies 到本地 JSON 文件
   * @param {Array} cookies - Cookies 数组
   * @returns {Promise<string>} 保存的文件路径
   */
  async saveCookies(cookies) {
    const filename = `${this.platform}-cookies.json`;
    const filepath = path.join(this.options.savePath, filename);

    try {
      // 确保目录存在
      if (!fs.existsSync(this.options.savePath)) {
        fs.mkdirSync(this.options.savePath, { recursive: true });
      }

      // 保存 cookies
      fs.writeFileSync(filepath, JSON.stringify(cookies, null, 2), 'utf-8');
      console.log(`[LoginValidator] Cookies 已保存到: ${filepath}`);

      return filepath;
    } catch (error) {
      console.error(`[LoginValidator] 保存 cookies 时出错:`, error);
      throw error;
    }
  }

  /**
   * 静态方法：验证登录（便捷方法）
   * @param {string} platform - 平台类型
   * @param {Array} cookies - Cookies 数组
   * @param {Object} options - 可选配置
   * @returns {Promise<Object>} 验证结果
   */
  static async validate(platform, cookies, options = {}) {
    const validator = new LoginValidator(platform, cookies, options);
    return await validator.validate();
  }
}

module.exports = {
  LoginValidator,
  PLATFORM_CONFIG,
};

