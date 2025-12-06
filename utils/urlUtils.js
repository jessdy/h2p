/**
 * 获取基础URL前缀（从环境变量）
 * @returns {string} 基础URL前缀，如果未配置则返回空字符串
 */
function getBaseUrl() {
  return process.env.BASE_URL || '';
}

/**
 * 处理URL，如果URL不是以http开头，则添加基础URL前缀
 * @param {string} url - 原始URL
 * @returns {string} 处理后的URL
 */
function normalizeUrl(url) {
  if (!url || typeof url !== 'string') {
    return url;
  }
  
  if (url.startsWith('http')) {
    return url;
  }
  
  const baseUrl = getBaseUrl();
  if (baseUrl) {
    // 确保baseUrl不以/结尾，url不以/开头
    const cleanBaseUrl = baseUrl.replace(/\/$/, '');
    const cleanUrl = url.startsWith('/') ? url : `/${url}`;
    return `${cleanBaseUrl}${cleanUrl}`;
  }
  
  return url;
}

module.exports = {
  getBaseUrl,
  normalizeUrl,
};

