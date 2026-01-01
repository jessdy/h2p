const express = require('express');
const satoriModule = require('satori');
const satori = satoriModule.default || satoriModule;
const fs = require('fs');
const path = require('path');
const axios = require('axios');

const router = express.Router();

// 解析 JSON 请求体
router.use(express.json({ limit: '10mb' }));

/**
 * 验证字体文件格式
 * @param {Buffer} buffer - 字体文件缓冲区
 * @returns {boolean} 是否为有效的字体格式
 */
function validateFontFormat(buffer) {
  if (!buffer || buffer.length < 4) {
    return false;
  }
  
  // 检查文件头
  const header = buffer.slice(0, 4);
  
  // TTF/OTF: 0x00 01 00 00 或 OTTO
  if (header[0] === 0x00 && header[1] === 0x01 && header[2] === 0x00 && header[3] === 0x00) {
    return true;
  }
  
  // OTF: 'OTTO'
  if (header.toString('ascii', 0, 4) === 'OTTO') {
    return true;
  }
  
  // WOFF: 'wOFF'
  if (header.toString('ascii', 0, 4) === 'wOFF') {
    return true;
  }
  
  // WOFF2: 'wOF2'
  if (header.toString('ascii', 0, 4) === 'wOF2') {
    return true;
  }
  
  return false;
}

/**
 * 解析 CSS @font-face 规则，提取字体信息
 * @param {string} cssText - CSS 文本
 * @returns {Array} 字体信息数组
 */
function parseFontFaceFromCSS(cssText) {
  const fonts = [];
  
  // 匹配 @font-face 规则
  const fontFaceRegex = /@font-face\s*\{([^}]+)\}/gi;
  let match;
  
  while ((match = fontFaceRegex.exec(cssText)) !== null) {
    const fontFaceContent = match[1];
    const fontInfo = {
      name: null,
      url: null,
      weight: 400,
      style: 'normal',
    };
    
    // 提取 font-family
    const fontFamilyMatch = fontFaceContent.match(/font-family\s*:\s*['"]?([^'";}]+)['"]?/i);
    if (fontFamilyMatch) {
      fontInfo.name = fontFamilyMatch[1].trim();
    }
    
    // 提取 src URL
    // 支持多种格式：url('...'), url("..."), url(...)
    const srcMatch = fontFaceContent.match(/src\s*:\s*url\(['"]?([^'")]+)['"]?\)/i);
    if (srcMatch) {
      fontInfo.url = srcMatch[1].trim();
    }
    
    // 提取 font-weight
    const weightMatch = fontFaceContent.match(/font-weight\s*:\s*(\d+)/i);
    if (weightMatch) {
      fontInfo.weight = parseInt(weightMatch[1], 10);
    } else {
      // 支持关键字
      const weightKeywordMatch = fontFaceContent.match(/font-weight\s*:\s*(normal|bold|bolder|lighter)/i);
      if (weightKeywordMatch) {
        const keyword = weightKeywordMatch[1].toLowerCase();
        if (keyword === 'bold' || keyword === 'bolder') {
          fontInfo.weight = 700;
        } else if (keyword === 'lighter') {
          fontInfo.weight = 300;
        }
      }
    }
    
    // 提取 font-style
    const styleMatch = fontFaceContent.match(/font-style\s*:\s*(normal|italic|oblique)/i);
    if (styleMatch) {
      fontInfo.style = styleMatch[1].toLowerCase();
    }
    
    // 只有当有 name 和 url 时才添加
    if (fontInfo.name && fontInfo.url) {
      fonts.push(fontInfo);
    }
  }
  
  return fonts;
}

/**
 * 渲染 Satori 代码为 SVG
 * POST /satori/render
 */
router.post('/render', async (req, res) => {
  try {
    const { code, width = 1080, height = 1920, fonts = [], fontCss } = req.body;

    if (!code || typeof code !== 'string') {
      return res.status(400).json({
        error: 'invalid_request',
        message: 'code (string) is required in request body',
      });
    }

    // 加载字体（如果需要）
    const fontData = [];
    
    // 如果提供了 CSS，先解析 CSS 中的 @font-face
    if (fontCss && typeof fontCss === 'string') {
      try {
        const cssFonts = parseFontFaceFromCSS(fontCss);
        // 将 CSS 解析的字体添加到 fonts 数组
        fonts.push(...cssFonts);
      } catch (cssErr) {
        console.warn('Failed to parse font CSS:', cssErr.message);
      }
    }
    
    // 加载用户提供的字体
    for (const font of fonts) {
      try {
        if (font.path) {
          const fontPath = path.isAbsolute(font.path)
            ? font.path
            : path.join(__dirname, '..', font.path);
          
          if (fs.existsSync(fontPath)) {
            const fontBuffer = await fs.promises.readFile(fontPath);
            fontData.push({
              name: font.name || 'Inter',
              data: fontBuffer,
              weight: font.weight || 400,
              style: font.style || 'normal',
            });
          }
        } else if (font.url) {
          // 从 URL 加载字体
          try {
            const response = await axios.get(font.url, {
              responseType: 'arraybuffer',
              timeout: 15000,
            });
            
            const fontBuffer = Buffer.from(response.data);
            
            // 验证字体文件格式（检查文件头）
            const isValidFont = validateFontFormat(fontBuffer);
            if (!isValidFont) {
              console.warn(`Font file format may not be supported: ${font.url}. Satori supports TTF, OTF, and WOFF2 formats.`);
            }
            
            // 检查是否是可变字体（文件名包含 VF 或 Variable）
            const isVariableFont = font.url.toLowerCase().includes('vf') || 
                                  font.url.toLowerCase().includes('variable');
            
            if (isVariableFont) {
              console.warn(`Warning: Variable font detected: ${font.url}. Satori may have issues parsing variable fonts. Consider using a static font version instead.`);
            }
            
            fontData.push({
              name: font.name || 'Inter',
              data: fontBuffer,
              weight: font.weight || 400,
              style: font.style || 'normal',
            });
          } catch (urlErr) {
            console.warn(`Failed to load font from URL: ${font.url}`, urlErr.message);
          }
        }
      } catch (err) {
        console.warn(`Failed to load font: ${font.name || font.path}`, err.message);
      }
    }

    // 如果没有提供字体，加载默认字体
    if (fontData.length === 0) {
      try {
        // 尝试加载多个备用字体（按优先级）
        // 注意：避免使用可变字体（Variable Font），使用静态字体
        const defaultFontUrls = [
          // 优先使用静态字体（非 VF 版本）
          'https://cdn.dreamyshare.com/zimeiti/fonts/TaoBaoMaiCaiTi-Regular/TaoBaoMaiCaiTi-Regular.ttf',
        ];
        
        let fontLoaded = false;
        for (const defaultFontUrl of defaultFontUrls) {
          try {
            const response = await axios.get(defaultFontUrl, {
              responseType: 'arraybuffer',
              timeout: 15000,
            });
            
            const fontBuffer = Buffer.from(response.data);
            
            // 验证字体格式
            if (!validateFontFormat(fontBuffer)) {
              console.warn(`Default font format may not be supported: ${defaultFontUrl}`);
              // 继续尝试下一个字体
              continue;
            }
            
            // 检查是否是可变字体（文件名包含 VF 或 Variable）
            const isVariableFont = defaultFontUrl.toLowerCase().includes('vf') || 
                                   defaultFontUrl.toLowerCase().includes('variable');
            
            if (isVariableFont) {
              console.warn(`Warning: Variable font detected: ${defaultFontUrl}. Satori may have issues with variable fonts.`);
            }
            
            fontData.push({
              name: 'Noto Sans SC',
              data: fontBuffer,
              weight: 400,
              style: 'normal',
            });
            
            fontLoaded = true;
            break; // 成功加载，退出循环
          } catch (fontErr) {
            console.warn(`Failed to load default font from ${defaultFontUrl}:`, fontErr.message);
            // 继续尝试下一个字体
          }
        }
        
        if (!fontLoaded) {
          throw new Error('All default fonts failed to load');
        }
      } catch (defaultFontErr) {
        console.error('Failed to load default font:', defaultFontErr.message);
        return res.status(500).json({
          error: 'font_loading_failed',
          message: 'Failed to load default font. Please provide a font using fontCss or fonts parameter. Supported formats: TTF, OTF, WOFF2.',
        });
      }
    }

    // 执行用户代码
    // 注意：这里需要安全地执行代码
    // 在实际生产环境中，应该使用沙箱环境
    let jsxElement;
    try {
      // 首先尝试解析为 JSON（支持直接传入对象结构）
      let parsedCode = null;
      const trimmedCode = code.trim();
      
      // 检查是否是 JSON 格式（以 { 或 [ 开头）
      if ((trimmedCode.startsWith('{') && trimmedCode.endsWith('}')) ||
          (trimmedCode.startsWith('[') && trimmedCode.endsWith(']'))) {
        try {
          parsedCode = JSON.parse(trimmedCode);
          // 如果成功解析为 JSON，直接使用
          if (parsedCode && typeof parsedCode === 'object') {
            // 验证对象结构是否符合 Satori 元素格式
            if (parsedCode.type && parsedCode.props) {
              // 标准格式：{ type: 'div', props: { ... } }
              jsxElement = parsedCode;
            } else if (parsedCode.type && !parsedCode.props) {
              // 只有 type，没有 props，将其他属性作为 props
              const { type, ...rest } = parsedCode;
              jsxElement = {
                type,
                props: rest,
              };
            } else if (Array.isArray(parsedCode) && parsedCode.length > 0) {
              // 如果是数组，取第一个元素
              if (parsedCode[0].type && parsedCode[0].props) {
                jsxElement = parsedCode[0];
              } else if (parsedCode[0].type) {
                const { type, ...rest } = parsedCode[0];
                jsxElement = {
                  type,
                  props: rest,
                };
              } else {
                // 数组中的对象没有 type，包装为 div
                jsxElement = {
                  type: 'div',
                  props: {
                    children: parsedCode,
                  },
                };
              }
            } else {
              // 如果不是标准格式，尝试包装为 div
              jsxElement = {
                type: 'div',
                props: parsedCode,
              };
            }
          }
        } catch (jsonError) {
          // JSON 解析失败，继续使用代码执行方式
          parsedCode = null;
        }
      }
      
      // 如果不是 JSON 或 JSON 解析失败，使用代码执行方式
      if (!jsxElement) {
        // 模拟 React.createElement（Satori 兼容的 JSX）
        const React = {
          createElement: (type, props, ...children) => {
            // 处理 children
            let processedChildren;
            if (children.length === 0) {
              processedChildren = undefined;
            } else if (children.length === 1) {
              processedChildren = children[0];
            } else {
              processedChildren = children;
            }

            // 处理 props
            const processedProps = { ...props };
            if (processedChildren !== undefined) {
              processedProps.children = processedChildren;
            }

            return {
              type,
              props: processedProps,
            };
          },
        };

        // 创建一个安全的执行环境
        // 支持多种代码格式：
        // 1. 直接返回 element
        // 2. 定义 render 函数
        // 3. 直接写 JSX 代码
        // 4. 直接返回对象字面量
        const safeEval = new Function(
          'React',
          'satori',
          `
          try {
            ${code}
            
            // 尝试获取 element
            if (typeof element !== 'undefined') {
              return element;
            }
            
            // 尝试调用 render 函数
            if (typeof render === 'function') {
              return render();
            }
            
            // 尝试调用函数表达式
            if (typeof renderElement === 'function') {
              return renderElement();
            }
            
            return null;
          } catch (err) {
            throw err;
          }
          `
        );

        jsxElement = safeEval(React, satori);
      }
    } catch (evalError) {
      return res.status(400).json({
        error: 'code_execution_error',
        message: evalError.message,
        stack: process.env.NODE_ENV === 'development' ? evalError.stack : undefined,
      });
    }

    if (!jsxElement) {
      return res.status(400).json({
        error: 'invalid_code',
        message: 'Code must return a JSX element. Use "const element = React.createElement(...)" or define a "render" function that returns an element.',
      });
    }

    // 使用 Satori 渲染为 SVG
    let svg;
    try {
      svg = await satori(jsxElement, {
        width: parseInt(width, 10),
        height: parseInt(height, 10),
        fonts: fontData.length > 0 ? fontData : undefined,
      });
    } catch (satoriError) {
      // 检查是否是字体解析错误
      const errorMessage = satoriError.message || '';
      const errorStack = satoriError.stack || '';
      
      // 检查是否是 fvar（可变字体）相关的错误
      if (errorMessage.includes('fvar') || errorStack.includes('parseFvarAxis') || errorStack.includes('parseFvarTable')) {
        return res.status(400).json({
          error: 'variable_font_error',
          message: '可变字体（Variable Font）解析失败。Satori 对某些可变字体的支持有限。',
          suggestion: '请使用静态字体（Static Font）而非可变字体，或尝试使用字体的静态版本。可变字体通常包含 "VF" 或 "Variable" 在文件名中。',
          details: errorMessage,
          workaround: '可以尝试：1) 使用字体的静态版本（非 VF 版本）2) 使用其他字体文件 3) 通过 CSS 加载字体时使用静态字体 URL',
        });
      }
      
      // 其他字体相关错误
      if (errorMessage.includes('font') || errorMessage.includes('opentype') || errorStack.includes('opentype')) {
        return res.status(400).json({
          error: 'font_parse_error',
          message: `字体解析失败: ${errorMessage}`,
          suggestion: '请确保字体文件格式正确（支持 TTF、OTF、WOFF2），避免使用可变字体（Variable Font）或损坏的字体文件。',
          details: errorMessage,
        });
      }
      
      throw satoriError; // 重新抛出其他错误
    }

    return res.json({
      success: true,
      svg,
      width: parseInt(width, 10),
      height: parseInt(height, 10),
    });
  } catch (error) {
    console.error('Satori render error:', error);
    return res.status(500).json({
      error: 'render_failed',
      message: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined,
    });
  }
});

/**
 * 渲染 Satori 代码为图片并保存
 * POST /satori/render-image
 */
router.post('/render-image', async (req, res) => {
  try {
    const {
      code,
      width = 1080,
      height = 1920,
      fonts = [],
      fontCss,
      type = 'png',
      quality = 90,
      outputDir,
      outputName,
      encoding = 'url', // 'url' | 'base64' | 'binary'
    } = req.body;

    if (!code || typeof code !== 'string') {
      return res.status(400).json({
        error: 'invalid_request',
        message: 'code (string) is required in request body',
      });
    }

    // 验证图片格式
    if (!['png', 'jpeg'].includes(type)) {
      return res.status(400).json({
        error: 'invalid_request',
        message: 'type must be "png" or "jpeg"',
      });
    }

    // 首先渲染为 SVG（复用现有逻辑）
    // 加载字体（如果需要）
    const fontData = [];
    
    // 如果提供了 CSS，先解析 CSS 中的 @font-face
    if (fontCss && typeof fontCss === 'string') {
      try {
        const cssFonts = parseFontFaceFromCSS(fontCss);
        fonts.push(...cssFonts);
      } catch (cssErr) {
        console.warn('Failed to parse font CSS:', cssErr.message);
      }
    }
    
    // 加载用户提供的字体
    for (const font of fonts) {
      try {
        if (font.path) {
          const fontPath = path.isAbsolute(font.path)
            ? font.path
            : path.join(__dirname, '..', font.path);
          
          if (fs.existsSync(fontPath)) {
            const fontBuffer = await fs.promises.readFile(fontPath);
            fontData.push({
              name: font.name || 'Inter',
              data: fontBuffer,
              weight: font.weight || 400,
              style: font.style || 'normal',
            });
          }
        } else if (font.url) {
          try {
            const response = await axios.get(font.url, {
              responseType: 'arraybuffer',
              timeout: 15000,
            });
            
            const fontBuffer = Buffer.from(response.data);
            
            if (!validateFontFormat(fontBuffer)) {
              console.warn(`Font file format may not be supported: ${font.url}`);
            }
            
            fontData.push({
              name: font.name || 'Inter',
              data: fontBuffer,
              weight: font.weight || 400,
              style: font.style || 'normal',
            });
          } catch (urlErr) {
            console.warn(`Failed to load font from URL: ${font.url}`, urlErr.message);
          }
        }
      } catch (err) {
        console.warn(`Failed to load font: ${font.name || font.path}`, err.message);
      }
    }

    // 如果没有提供字体，加载默认字体
    if (fontData.length === 0) {
      try {
        const defaultFontUrls = [
          'https://cdn.dreamyshare.com/zimeiti/fonts/TaoBaoMaiCaiTi-Regular/TaoBaoMaiCaiTi-Regular.ttf',
        ];
        
        let fontLoaded = false;
        for (const defaultFontUrl of defaultFontUrls) {
          try {
            const response = await axios.get(defaultFontUrl, {
              responseType: 'arraybuffer',
              timeout: 15000,
            });
            
            const fontBuffer = Buffer.from(response.data);
            
            if (!validateFontFormat(fontBuffer)) {
              continue;
            }
            
            fontData.push({
              name: 'Noto Sans SC',
              data: fontBuffer,
              weight: 400,
              style: 'normal',
            });
            
            fontLoaded = true;
            break;
          } catch (fontErr) {
            console.warn(`Failed to load default font from ${defaultFontUrl}:`, fontErr.message);
          }
        }
        
        if (!fontLoaded) {
          throw new Error('All default fonts failed to load');
        }
      } catch (defaultFontErr) {
        console.error('Failed to load default font:', defaultFontErr.message);
        return res.status(500).json({
          error: 'font_loading_failed',
          message: 'Failed to load default font. Please provide a font using fontCss or fonts parameter.',
        });
      }
    }

    // 执行用户代码生成 JSX 元素
    let jsxElement;
    try {
      let parsedCode = null;
      const trimmedCode = code.trim();
      
      if ((trimmedCode.startsWith('{') && trimmedCode.endsWith('}')) ||
          (trimmedCode.startsWith('[') && trimmedCode.endsWith(']'))) {
        try {
          parsedCode = JSON.parse(trimmedCode);
          if (parsedCode && typeof parsedCode === 'object') {
            if (parsedCode.type && parsedCode.props) {
              jsxElement = parsedCode;
            } else if (parsedCode.type && !parsedCode.props) {
              const { type, ...rest } = parsedCode;
              jsxElement = {
                type,
                props: rest,
              };
            } else if (Array.isArray(parsedCode) && parsedCode.length > 0) {
              if (parsedCode[0].type && parsedCode[0].props) {
                jsxElement = parsedCode[0];
              } else if (parsedCode[0].type) {
                const { type, ...rest } = parsedCode[0];
                jsxElement = {
                  type,
                  props: rest,
                };
              } else {
                jsxElement = {
                  type: 'div',
                  props: {
                    children: parsedCode,
                  },
                };
              }
            } else {
              jsxElement = {
                type: 'div',
                props: parsedCode,
              };
            }
          }
        } catch (jsonError) {
          parsedCode = null;
        }
      }
      
      if (!jsxElement) {
        const React = {
          createElement: (type, props, ...children) => {
            let processedChildren;
            if (children.length === 0) {
              processedChildren = undefined;
            } else if (children.length === 1) {
              processedChildren = children[0];
            } else {
              processedChildren = children;
            }

            const processedProps = { ...props };
            if (processedChildren !== undefined) {
              processedProps.children = processedChildren;
            }

            return {
              type,
              props: processedProps,
            };
          },
        };

        const safeEval = new Function(
          'React',
          'satori',
          `
          try {
            ${code}
            
            if (typeof element !== 'undefined') {
              return element;
            }
            
            if (typeof render === 'function') {
              return render();
            }
            
            if (typeof renderElement === 'function') {
              return renderElement();
            }
            
            return null;
          } catch (err) {
            throw err;
          }
          `
        );

        jsxElement = safeEval(React, satori);
      }
    } catch (evalError) {
      return res.status(400).json({
        error: 'code_execution_error',
        message: evalError.message,
        stack: process.env.NODE_ENV === 'development' ? evalError.stack : undefined,
      });
    }

    if (!jsxElement) {
      return res.status(400).json({
        error: 'invalid_code',
        message: 'Code must return a JSX element.',
      });
    }

    // 使用 Satori 渲染为 SVG
    let svg;
    try {
      svg = await satori(jsxElement, {
        width: parseInt(width, 10),
        height: parseInt(height, 10),
        fonts: fontData.length > 0 ? fontData : undefined,
      });
    } catch (satoriError) {
      const errorMessage = satoriError.message || '';
      const errorStack = satoriError.stack || '';
      
      if (errorMessage.includes('fvar') || errorStack.includes('parseFvarAxis') || errorStack.includes('parseFvarTable')) {
        return res.status(400).json({
          error: 'variable_font_error',
          message: '可变字体（Variable Font）解析失败。',
        });
      }
      
      if (errorMessage.includes('font') || errorMessage.includes('opentype') || errorStack.includes('opentype')) {
        return res.status(400).json({
          error: 'font_parse_error',
          message: `字体解析失败: ${errorMessage}`,
        });
      }
      
      throw satoriError;
    }

    // 使用 Puppeteer 将 SVG 转换为图片
    let puppeteer;
    try {
      puppeteer = require('puppeteer');
    } catch (puppeteerErr) {
      return res.status(500).json({
        error: 'puppeteer_not_available',
        message: 'Puppeteer is required to convert SVG to image. Please install puppeteer.',
      });
    }

    let browser;
    try {
      browser = await puppeteer.launch({
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
      });

      const page = await browser.newPage();
      
      // 设置视口大小
      await page.setViewport({
        width: parseInt(width, 10),
        height: parseInt(height, 10),
        deviceScaleFactor: 1,
      });

      // 创建包含 SVG 的 HTML
      const htmlContent = `
        <!DOCTYPE html>
        <html>
          <head>
            <meta charset="UTF-8">
            <style>
              body {
                margin: 0;
                padding: 0;
                width: ${parseInt(width, 10)}px;
                height: ${parseInt(height, 10)}px;
                overflow: hidden;
              }
              svg {
                width: 100%;
                height: 100%;
              }
            </style>
          </head>
          <body>
            ${svg}
          </body>
        </html>
      `;

      await page.setContent(htmlContent, { waitUntil: 'networkidle0' });

      // 截图
      const screenshotOptions = {
        type: type,
        quality: type === 'jpeg' ? quality : undefined,
        omitBackground: type === 'png' ? false : undefined,
      };

      const imageBuffer = await page.screenshot(screenshotOptions);

      await browser.close();

      // 根据 encoding 参数返回不同格式
      if (encoding === 'base64') {
        return res.json({
          success: true,
          encoding: 'base64',
          data: imageBuffer.toString('base64'),
          type,
          width: parseInt(width, 10),
          height: parseInt(height, 10),
        });
      }

      if (encoding === 'url') {
        // 保存到本地并返回 URL
        const ext = type === 'jpeg' ? 'jpg' : 'png';
        const finalOutputDir = outputDir
          ? (path.isAbsolute(outputDir) ? outputDir : path.join(__dirname, '..', outputDir))
          : path.join(__dirname, '..', 'public', 'images');
        
        await fs.promises.mkdir(finalOutputDir, { recursive: true });

        const baseName = outputName
          ? outputName.replace(/\.[a-zA-Z0-9]+$/, '')
          : `satori-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const fileName = `${baseName}.${ext}`;
        const filePath = path.join(finalOutputDir, fileName);

        await fs.promises.writeFile(filePath, imageBuffer);

        // 构造可访问的 URL
        const baseUrl = `${req.protocol}://${req.get('host')}`;
        let urlPath;
        if (finalOutputDir.startsWith(path.join(__dirname, '..', 'public'))) {
          const relativePath = path.relative(path.join(__dirname, '..', 'public'), filePath);
          urlPath = `/yuniyouyue/${relativePath.split(path.sep).join('/')}`;
        } else {
          urlPath = `/yuniyouyue/${fileName}`;
        }

        return res.json({
          success: true,
          encoding: 'url',
          url: `${baseUrl}${urlPath}`,
          path: filePath,
          filename: fileName,
          type,
          width: parseInt(width, 10),
          height: parseInt(height, 10),
        });
      }

      // encoding === 'binary' 或默认
      const mime = type === 'jpeg' ? 'image/jpeg' : 'image/png';
      const ext = type === 'jpeg' ? 'jpg' : 'png';
      res.set('Content-Type', mime);
      res.set('Content-Disposition', `inline; filename="satori-rendered.${ext}"`);
      return res.send(imageBuffer);

    } catch (puppeteerError) {
      if (browser) {
        await browser.close().catch(() => {});
      }
      throw puppeteerError;
    }

  } catch (error) {
    console.error('Satori render-image error:', error);
    return res.status(500).json({
      error: 'render_failed',
      message: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined,
    });
  }
});

/**
 * 获取 Satori 预览页面
 * GET /satori
 */
router.get('/', (req, res) => {
  const htmlPath = path.join(__dirname, '..', 'public', 'satori', 'index.html');
  res.sendFile(htmlPath);
});

module.exports = router;

