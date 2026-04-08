const { join } = require('path');

/**
 * @type {import("puppeteer").Configuration}
 */
module.exports = {
  // Garante que o cache fique dentro da pasta do projeto no Render [cite: 1]
  cacheDirectory: join(__dirname, '.cache', 'puppeteer'),
};