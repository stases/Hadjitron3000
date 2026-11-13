const path = require('node:path');

const contentTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.wasm': 'application/wasm',
  '.woff2': 'font/woff2',
  '.png': 'image/png',
  '.svg': 'image/svg+xml; charset=utf-8',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
};

function contentType(file) {
  return contentTypes[path.extname(file).toLowerCase()] || 'application/octet-stream';
}

function validateLibraryName(name) {
  if (typeof name !== 'string' || !name || name === '.' || name === '..' || /[/\\\0]/.test(name)) {
    throw new TypeError('Invalid sound name');
  }
  return name;
}

function appFilePath(url, dist) {
  if (typeof url !== 'string') return null;
  const match = /^app:\/\/hadjitron(\/[^?#]*)?(?:[?#].*)?$/.exec(url);
  if (!match) return null;
  try {
    const pathname = decodeURIComponent(match[1] || '/');
    if (/[\\\0:]/.test(pathname) || pathname.split('/').some((part) => part === '..')) return null;
    const root = path.resolve(dist);
    const file = path.resolve(root, '.' + pathname);
    if (file !== root && !file.startsWith(root + path.sep)) return null;
    return file === root ? path.join(root, 'index.html') : file;
  } catch {
    return null;
  }
}

module.exports = { validateLibraryName, appFilePath, contentType };
