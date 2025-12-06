const express = require('express');
const router = express.Router();

// 导入子路由
const xiaohongshuRouter = require('./publish/xiaohongshu');
const douyinRouter = require('./publish/douyin');
const youtubeRouter = require('./publish/youtube');

// 注册子路由
router.use('/xiaohongshu', xiaohongshuRouter);
router.use('/douyin', douyinRouter);
router.use('/youtube', youtubeRouter);

module.exports = router;
