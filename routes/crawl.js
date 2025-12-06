const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');

const router = express.Router();

// AIBase 爬虫路由
router.post('/aibase', express.json(), async (req, res) => {
  const supabase = req.app.get('supabase'); // 从app获取supabase实例
  const targetUrl = 'https://news.aibase.com/zh/news';
  const { page = 1, limit = 20, usePuppeteer = false, saveToDb = true } = req.body || {};
  
  // 如果没有配置 Supabase 但要求保存到数据库，返回错误
  if (saveToDb && !supabase) {
    return res.status(500).json({ 
      error: 'supabase_not_configured', 
      message: 'Supabase credentials not configured. Set SUPABASE_URL and SUPABASE_KEY environment variables, or set saveToDb: false to test crawling without saving.',
      tip: 'You can test the crawler by setting saveToDb: false in the request body'
    });
  }

  try {
    console.log(`[crawl/aibase] Starting crawl from ${targetUrl}, page: ${page}, usePuppeteer: ${usePuppeteer}`);
    
    let htmlContent;
    
    // 根据 usePuppeteer 参数选择爬取方式
    if (usePuppeteer) {
      try {
        // 尝试使用 puppeteer（如果可用）
        const puppeteer = require('puppeteer');
        const browser = await puppeteer.launch({
          args: ['--no-sandbox', '--disable-setuid-sandbox'],
          headless: 'shell',
        });
        const page = await browser.newPage();
        await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/118.0.0.0 Safari/537.36');
        await page.goto(targetUrl, { waitUntil: 'networkidle0', timeout: 30000 });
        htmlContent = await page.content();
        await browser.close();
        console.log('[crawl/aibase] Successfully fetched page using Puppeteer');
      } catch (puppeteerError) {
        console.warn('[crawl/aibase] Puppeteer failed, falling back to axios:', puppeteerError.message);
        // 回退到 axios
        const response = await axios.get(targetUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/118.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
            'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
          },
          timeout: 30000,
        });
        htmlContent = response.data;
      }
    } else {
      // 使用 axios 获取页面内容
      const response = await axios.get(targetUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/118.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
          'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        },
        timeout: 30000,
      });
      htmlContent = response.data;
    }

    const $ = cheerio.load(htmlContent);
    const newsItems = [];
    const urlSet = new Set(); // 用于去重

    // 查找所有新闻链接（href包含 /zh/news/ 或 /news/）
    $('a[href*="/zh/news/"], a[href*="/news/"]').each((index, element) => {
      if (newsItems.length >= limit) return false;

      const $link = $(element);
      let url = $link.attr('href');
      
      // 跳过无效链接
      if (!url || url.includes('#') || url.includes('javascript:')) return;
      
      // 处理相对URL
      if (!url.startsWith('http')) {
        url = new URL(url, targetUrl).href;
      }
      
      // 去重检查
      if (urlSet.has(url)) return;
      
      // 查找标题
      const $titleEl = $link.find('div.font600, div[class*="font600"], div.md\\:text-\\[18px\\]').first();
      let title = $titleEl.text().trim();
      
      // 如果没找到，尝试查找所有div中的文本（排除摘要和时间）
      if (!title || title.length < 5) {
        const $allTexts = $link.find('div').not('.tipColor').not('[class*="tipColor"]');
        for (let i = 0; i < $allTexts.length; i++) {
          const text = $($allTexts[i]).text().trim();
          if (text.length > 10 && text.length < 200 && !text.match(/[\d.]+[KMB]/i) && !text.match(/(刚刚|小时前|天前)/)) {
            title = text;
            break;
          }
        }
      }
      
      if (!title || title.length < 5) return;
      
      // 提取摘要
      let summary = '';
      
      // 方法1: 查找包含 "truncate2" 且包含较长文本的tipColor元素
      $link.find('div[class*="truncate2"]').each((i, el) => {
        const $el = $(el);
        const text = $el.text().trim();
        if (text.length > 30 && 
            !text.match(/[\d.]+[KMB]/i) && 
            !text.match(/(刚刚|\d+\s*小时前|\d+\s*天前)/) &&
            !$el.find('i.iconfont').length) {
          summary = text;
          return false;
        }
      });
      
      // 方法2: 如果还没找到，查找所有包含较长文本的tipColor元素
      if (!summary || summary.length < 10) {
        $link.find('div[class*="tipColor"]').each((i, el) => {
          const $el = $(el);
          if ($el.find('i.iconfont, i[class*="icon-"]').length > 0) return;
          const text = $el.text().trim();
          if (text.length > 30 && 
              !text.match(/[\d.]+[KMB]/i) && 
              !text.match(/(刚刚|\d+\s*小时前|\d+\s*天前)/) &&
              text !== title) {
            summary = text;
            return false;
          }
        });
      }
      
      // 方法3: 如果还是没找到，尝试从链接内的所有文本中提取
      if (!summary || summary.length < 10) {
        const allText = $link.clone().children('img').remove().end().text().trim();
        const cleanedText = allText
          .replace(new RegExp(title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), '')
          .replace(/[\d.]+[KMB]/gi, '')
          .replace(/(刚刚|\d+\s*小时前|\d+\s*天前)/g, '')
          .trim();
        if (cleanedText.length > 30) {
          summary = cleanedText;
        }
      }
      
      // 提取时间
      let timeText = '';
      $link.find('i[class*="icon-rili"], i.icon-rili').closest('div').each((i, el) => {
        const text = $(el).text().trim();
        const timeMatch = text.match(/(刚刚|\d+\s*小时前|\d+\s*天前)/);
        if (timeMatch) {
          timeText = timeMatch[1].trim();
          return false;
        }
      });
      
      // 提取观看次数
      let viewText = '';
      $link.find('i.icon-fangwenliang1, i[class*="icon-fangwenliang1"]').closest('div').each((i, el) => {
        const text = $(el).text().trim();
        const match = text.match(/([\d.]+[KMB]?)/i);
        if (match) {
          viewText = match[1];
          return false;
        }
      });
      
      let viewCount = 0;
      if (viewText) {
        const match = viewText.match(/([\d.]+)([KMB]?)/i);
        if (match) {
          const num = parseFloat(match[1]);
          const unit = match[2].toUpperCase();
          viewCount = unit === 'K' ? Math.round(num * 1000) : unit === 'M' ? Math.round(num * 1000000) : Math.round(num);
        }
      }

      // 解析发布时间
      let publishedAt = null;
      if (timeText) {
        if (timeText.includes('刚刚')) {
          publishedAt = new Date();
        } else if (timeText.includes('小时前')) {
          const hours = parseInt(timeText.match(/(\d+)/)?.[1] || '0', 10);
          publishedAt = new Date(Date.now() - hours * 60 * 60 * 1000);
        } else if (timeText.includes('天前')) {
          const days = parseInt(timeText.match(/(\d+)/)?.[1] || '0', 10);
          publishedAt = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
        }
      }

      // 保存新闻项
      urlSet.add(url);
      newsItems.push({
        title: title.trim(),
        summary: summary && summary.length > 10 ? summary.trim() : null,
        published_at: publishedAt ? publishedAt.toISOString() : null,
        view_count: viewCount,
        url,
      });
    });
    
    console.log(`[crawl/aibase] Parsed ${newsItems.length} news items from HTML`);

    // 如果不需要保存到数据库，直接返回爬取的数据
    if (!saveToDb || !supabase) {
      console.log(`[crawl/aibase] Test mode: returning ${newsItems.length} items without saving to database`);
      return res.json({
        success: true,
        mode: 'test',
        message: saveToDb ? 'Supabase not configured, returning crawled data only' : 'Test mode: data not saved to database',
        crawled: newsItems.length,
        items: newsItems,
      });
    }

    // 批量插入到 Supabase（使用 upsert 避免重复）
    console.log(`[crawl/aibase] Saving ${newsItems.length} items to database...`);
    const results = [];
    const errors = [];

    for (const item of newsItems) {
      try {
        const { data, error } = await supabase
          .from('aibase_news')
          .insert(
            {
              title: item.title,
              summary: item.summary,
              published_at: item.published_at,
              view_count: item.view_count,
              url: item.url,
            },
            {
              onConflict: 'url',
              upsert: false,
            }
          )
          .select();

        if (error) {
          console.error(`[crawl/aibase] Error inserting item:`, error);
          errors.push({ item, error: error.message });
        } else {
          results.push(data?.[0] || item);
        }
      } catch (e) {
        console.error(`[crawl/aibase] Exception inserting item:`, e);
        errors.push({ item, error: e.message });
      }
    }

    return res.json({
      success: true,
      mode: 'database',
      crawled: newsItems.length,
      inserted: results.length,
      errors: errors.length,
      items: results,
      errorDetails: errors.length > 0 ? errors : undefined,
    });
  } catch (err) {
    console.error('[crawl/aibase] Crawl error:', err);
    return res.status(500).json({
      error: 'crawl_failed',
      message: err && err.message ? err.message : String(err),
    });
  }
});

module.exports = router;

