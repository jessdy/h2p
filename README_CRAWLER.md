# AIBase 爬虫功能使用说明

## 功能概述

本功能用于爬取 https://news.aibase.com/zh/news 网站中的"AI新闻资讯"，提取以下信息并存储到 Supabase 数据库：

- 标题
- 摘要
- 发布时间
- 观看次数
- 访问地址
- 是否已制作成播客（标识字段）

## 环境配置

### 1. 安装依赖

依赖已包含在 `package.json` 中，运行以下命令安装：

```bash
npm install
```

### 2. 配置 Supabase

设置以下环境变量：

```bash
export SUPABASE_URL="your-supabase-project-url"
export SUPABASE_KEY="your-supabase-anon-key"
```

或者在 `.env` 文件中配置：

```
SUPABASE_URL=your-supabase-project-url
SUPABASE_KEY=your-supabase-anon-key
```

### 3. 创建数据库表

在 Supabase 数据库中执行 `supabase_schema.sql` 文件中的 SQL 语句来创建表结构。

## API 使用

### 爬取新闻接口

**端点**: `POST /crawl/aibase`

**请求体** (JSON):

```json
{
  "page": 1,           // 可选，页码（默认：1）
  "limit": 20,         // 可选，限制爬取数量（默认：20）
  "usePuppeteer": false // 可选，是否使用 Puppeteer（默认：false，使用 axios+cheerio）
}
```

**响应示例**:

```json
{
  "success": true,
  "crawled": 15,
  "inserted": 15,
  "errors": 0,
  "items": [
    {
      "id": "uuid",
      "title": "新闻标题",
      "summary": "新闻摘要",
      "published_at": "2025-11-22T03:00:00.000Z",
      "view_count": 5600,
      "url": "https://news.aibase.com/zh/news/xxx",
      "is_podcast": false,
      "created_at": "2025-11-22T03:00:00.000Z",
      "updated_at": "2025-11-22T03:00:00.000Z"
    }
  ]
}
```

## 使用示例

### 使用 curl

```bash
curl -X POST http://localhost:3000/crawl/aibase \
  -H "Content-Type: application/json" \
  -d '{
    "limit": 20,
    "usePuppeteer": false
  }'
```

### 使用 JavaScript/Node.js

```javascript
const axios = require('axios');

async function crawlAibase() {
  try {
    const response = await axios.post('http://localhost:3000/crawl/aibase', {
      limit: 20,
      usePuppeteer: false
    });
    console.log('爬取结果:', response.data);
  } catch (error) {
    console.error('爬取失败:', error.message);
  }
}

crawlAibase();
```

## 数据库表结构

表名: `aibase_news`

| 字段名 | 类型 | 说明 |
|--------|------|------|
| id | UUID | 主键，自动生成 |
| title | TEXT | 新闻标题（必填） |
| summary | TEXT | 新闻摘要 |
| published_at | TIMESTAMP WITH TIME ZONE | 发布时间 |
| view_count | INTEGER | 观看次数（默认：0） |
| url | TEXT | 访问地址（唯一约束） |
| is_podcast | BOOLEAN | 是否已制作成播客（默认：false） |
| created_at | TIMESTAMP WITH TIME ZONE | 创建时间 |
| updated_at | TIMESTAMP WITH TIME ZONE | 更新时间 |

## 注意事项

1. **去重机制**: 系统使用 `url` 字段作为唯一标识，相同 URL 的新闻会被更新而不是重复插入。

2. **爬取方式选择**:
   - `usePuppeteer: false` (默认): 使用 axios + cheerio，速度快但可能无法处理动态内容
   - `usePuppeteer: true`: 使用 Puppeteer，可以处理动态加载的内容，但速度较慢

3. **时间解析**: 系统会自动将相对时间（如"刚刚"、"7小时前"）转换为绝对时间。

4. **观看次数解析**: 系统会自动将"5.6K"、"1.2M"等格式转换为数字。

5. **错误处理**: 如果某个新闻项插入失败，会在响应中的 `errorDetails` 字段中显示详细信息，但不会影响其他新闻项的插入。

## 定时任务建议

可以使用 cron 或类似工具设置定时任务定期爬取新闻：

```bash
# 每小时爬取一次
0 * * * * curl -X POST http://localhost:3000/crawl/aibase -H "Content-Type: application/json" -d '{"limit": 50}'
```

