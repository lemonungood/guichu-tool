const { nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');

// 从 icon.png 生成 32x32 托盘图标
function createTrayIcon(accentColor) {
  const iconPath = path.join(__dirname, '..', 'icon.png');
  if (fs.existsSync(iconPath)) {
    return nativeImage.createFromPath(iconPath).resize({ width: 32, height: 32 });
  }
  return nativeImage.createEmpty();
}

// App window icon
function createAppIcon() {
  const iconPath = path.join(__dirname, '..', 'icon.png');
  if (fs.existsSync(iconPath)) {
    return nativeImage.createFromPath(iconPath);
  }
  return null;
}

module.exports = { createTrayIcon, createAppIcon };
