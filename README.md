# H2P - 自用工具集合

一个基于 Node.js 和 Express 的多功能工具服务，提供 HTML 转图片、内容爬取、音频视频处理、多平台发布等功能。

## 功能特性

### 1. HTML 转图片 (Render)
- 将 HTML 内容转换为 PNG/JPEG 图片
- 支持移动端/PC 端设备模拟
- 支持自定义尺寸和视口设置
- 支持 Base64 编码输出或文件保存

### 2. 内容爬取 (Crawl)
- AIBase 新闻爬虫
- 支持 axios+cheerio 和 Puppeteer 两种爬取方式
- 自动存储到 Supabase 数据库
- 支持去重和增量更新

### 3. 音频处理 (Audio)
- 音频文件合并
- 音频转视频（带可视化波形）
- 支持字幕文件（SRT）添加
- 支持自定义背景图片和颜色

### 4. 视频处理 (Video)
- 音频转视频转换
- 支持多种波形可视化模式
- 支持自定义视频尺寸和样式

### 5. 登录验证 (Login)
- 多平台登录状态验证
- 支持抖音、小红书、YouTube 等平台

### 6. 内容发布 (Publish)
- 支持发布到抖音、小红书、YouTube
- 使用 Playwright 自动化发布流程

## 快速开始

### 环境要求

- Node.js >= 14.0.0
- FFmpeg（用于音视频处理）

### 安装依赖

```bash
npm install
# 或
pnpm install
```

### 环境配置

创建 `.env` 文件并配置以下环境变量：

```env
# 服务器端口（可选，默认 3000）
PORT=3000

# Supabase 配置（用于爬虫数据存储）
SUPABASE_URL=your-supabase-project-url
SUPABASE_KEY=your-supabase-anon-key
```

### 初始化数据库

如果使用爬虫功能，需要在 Supabase 数据库中执行 `supabase_schema.sql` 文件中的 SQL 语句来创建表结构。

### 启动服务

```bash
npm start
# 或
npm run dev
```

服务启动后，访问 `http://localhost:3000` 查看 API 信息，或访问 `http://localhost:3000/api-docs` 查看 Swagger API 文档。

## API 接口

### HTML 转图片

**POST** `/render`

将 HTML 内容转换为图片。

**请求示例：**
```json
{
  "html": "<html><body><h1>Hello World</h1></body></html>",
  "type": "png",
  "width": 1080,
  "height": 1920,
  "device": "mobile",
  "encoding": "base64"
}
```

### 爬取 AIBase 新闻

**POST** `/crawl/aibase`

爬取 AIBase 新闻并存储到数据库。

**请求示例：**
```json
{
  "page": 1,
  "limit": 20,
  "usePuppeteer": false,
  "saveToDb": true
}
```

详细说明请参考 [README_CRAWLER.md](./README_CRAWLER.md)

### 音频合并

**POST** `/merge/audio`

合并多个音频文件。

**请求示例：**
```json
{
  "audioUrls": [
    "https://example.com/audio1.mp3",
    "https://example.com/audio2.mp3"
  ]
}
```

### 音频转视频

**POST** `/convert/audio-to-video`

将音频转换为带可视化波形的视频。

**请求示例：**
```json
{
  "audioUrl": "https://example.com/audio.mp3",
  "width": 1080,
  "height": 1920,
  "backgroundColor": "#000000",
  "backgroundImage": "https://example.com/bg.jpg",
  "waveColor": "#00ffff",
  "mode": "bar",
  "srt": "https://example.com/subtitle.srt"
}
```

### 登录验证

**POST** `/login/validate`

验证指定平台的登录状态。

**GET** `/login/platforms`

获取支持的平台列表。

**GET** `/login/platform/:platform`

获取指定平台的登录信息。

### 内容发布

**POST** `/publish/xiaohongshu`

发布内容到小红书。

**POST** `/publish/douyin`

发布内容到抖音。

**POST** `/publish/youtube`

发布内容到 YouTube。

## 项目结构

```
h2p/
├── config/              # 配置文件
│   ├── ffmpeg.js       # FFmpeg 配置
│   └── supabase.js     # Supabase 配置
├── cookies/            # 平台登录 Cookie 存储
├── public/             # 静态文件目录
│   ├── audio/         # 音频文件
│   ├── cover/         # 封面文件
│   ├── images/        # 图片文件
│   ├── temp/          # 临时文件
│   └── videos/         # 视频文件
├── routes/             # 路由模块
│   ├── audio.js       # 音频处理路由
│   ├── crawl.js       # 爬虫路由
│   ├── login.js       # 登录验证路由
│   ├── publish.js     # 发布路由
│   ├── publish/       # 各平台发布子路由
│   │   ├── douyin.js
│   │   ├── xiaohongshu.js
│   │   └── youtube.js
│   ├── render.js      # HTML 转图片路由
│   └── video.js       # 视频处理路由
├── utils/              # 工具函数
│   ├── colorUtils.js  # 颜色处理工具
│   ├── download.js    # 文件下载工具
│   ├── fileUtils.js   # 文件处理工具
│   ├── loginValidator.js  # 登录验证工具
│   └── urlUtils.js    # URL 处理工具
├── index.js            # 应用入口
├── package.json        # 项目配置
├── swagger.json        # API 文档配置
└── supabase_schema.sql # 数据库表结构
```

## 技术栈

- **Express** - Web 框架
- **Playwright** - 浏览器自动化
- **FFmpeg** - 音视频处理
- **Supabase** - 数据库服务
- **Cheerio** - HTML 解析
- **Axios** - HTTP 请求
- **Swagger UI** - API 文档

## 注意事项

1. **FFmpeg 安装**：确保系统已安装 FFmpeg，项目使用 `@ffmpeg-installer/ffmpeg` 自动安装，但某些情况下可能需要手动安装。

2. **Supabase 配置**：爬虫功能需要配置 Supabase，如果不使用爬虫功能，可以不配置。

3. **Cookie 管理**：各平台的登录 Cookie 存储在 `cookies/` 目录下，请妥善保管。

4. **文件存储**：生成的图片、音频、视频文件存储在 `public/` 目录下，可通过 `/static` 路径访问。

5. **临时文件清理**：处理过程中产生的临时文件会自动清理，但建议定期检查 `public/temp/` 目录。

## 开发说明

这是一个自用工具项目，主要用于个人工作流程自动化。代码结构相对简单，各功能模块相对独立，便于维护和扩展。

## License

ISC

