/**
 * 解析颜色值用于FFmpeg（支持十六进制和RGB）
 * @param {string} color - 颜色值（#RRGGBB, #RGB, 或 rgb(r,g,b)）
 * @returns {string} FFmpeg格式的颜色值（0xRRGGBB）
 */
function parseColorForFFmpeg(color) {
  if (!color) return '0x000000';
  
  // 如果是十六进制格式（#RRGGBB 或 #RGB）
  if (color.startsWith('#')) {
    const hex = color.slice(1);
    if (hex.length === 3) {
      // 扩展 #RGB 到 #RRGGBB
      const fullHex = hex.split('').map(c => c + c).join('');
      return `0x${fullHex}`;
    } else if (hex.length === 6) {
      return `0x${hex}`;
    }
  }
  
  // 如果是 RGB 格式 (rgb(255,255,255))
  const rgbMatch = color.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
  if (rgbMatch) {
    const r = parseInt(rgbMatch[1], 10).toString(16).padStart(2, '0');
    const g = parseInt(rgbMatch[2], 10).toString(16).padStart(2, '0');
    const b = parseInt(rgbMatch[3], 10).toString(16).padStart(2, '0');
    return `0x${r}${g}${b}`;
  }
  
  // 默认返回黑色
  return '0x000000';
}

module.exports = {
  parseColorForFFmpeg,
};

