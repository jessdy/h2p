// 加载 .env 文件中的环境变量
require('dotenv').config();

const express = require('express');
const swaggerUi = require('swagger-ui-express');
const swaggerDocument = require('./swagger.json');
const path = require('path');

// 导入配置
const { initSupabase } = require('./config/supabase');
const { initFFmpeg } = require('./config/ffmpeg');

// 导入路由
const renderRouter = require('./routes/render');
const crawlRouter = require('./routes/crawl');
const audioRouter = require('./routes/audio');
const videoRouter = require('./routes/video');
const loginRouter = require('./routes/login');
const publishRouter = require('./routes/publish');
const satoriRouter = require('./routes/satori');

const app = express();
const port = process.env.PORT || 3000;

// 初始化配置
initFFmpeg();
const supabase = initSupabase();

// 将supabase实例存储到app中，供路由使用
app.set('supabase', supabase);

// Swagger UI 文档路由
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerDocument));

// 静态文件路由，提供已保存文件的访问
app.use('/static', express.static(path.join(__dirname, 'public')));

// 根路由
app.get('/', (req, res) => {
  res.send({
    message: 'HTML -> Image API is running',
    endpoints: {
      render: 'POST /render',
      crawl: 'POST /crawl/aibase',
      mergeAudio: 'POST /merge/audio',
      audioToVideo: 'POST /convert/audio-to-video',
      generateVideo916: 'POST /generate/video-9-16',
      loginValidate: 'POST /login/validate',
      loginPlatforms: 'GET /login/platforms',
      loginPlatform: 'GET /login/platform/:platform',
      publishXiaohongshu: 'POST /publish/xiaohongshu',
      publishDouyin: 'POST /publish/douyin',
      satori: 'GET /satori (Satori 代码预览界面)',
      satoriRender: 'POST /satori/render',
      docs: 'GET /api-docs (Swagger UI)',
    },
    usage: 'POST /render with JSON { html: "<html>...</html>", type: "png|jpeg", encoding: "binary|base64", width, height, device: "mobile|pc" } or raw HTML with Content-Type: text/plain',
    documentation: 'Visit /api-docs for interactive API documentation',
    tools: 'Visit /satori for Satori code preview tool',
  });
});

// 注册路由
app.use('/render', renderRouter);
app.use('/crawl', crawlRouter);
app.use('/merge', audioRouter);
app.use('/', videoRouter);
app.use('/login', loginRouter);
app.use('/publish', publishRouter);
app.use('/satori', satoriRouter);

// 启动服务器
app.listen(port, () => {
  console.log(`HTML -> Image API listening at http://localhost:${port}`);
});
