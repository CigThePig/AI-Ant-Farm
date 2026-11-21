import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
const root = resolve(new URL('..', import.meta.url).pathname);
const types = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.json': 'application/json',
  '.md': 'text/plain; charset=utf-8',
};
const port = Number(process.env.PORT || 8080);
createServer(async (req, res) => {
  try {
    const name = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    const file = resolve(root, '.' + (name === '/' ? '/index.html' : name));
    if (
      !file.startsWith(root + sep) ||
      !['.html', '.css', '.js', '.json', '.md'].includes(extname(file)) ||
      !(await stat(file)).isFile()
    ) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, { 'Content-Type': types[extname(file)], 'Cache-Control': 'no-store' });
    res.end(await readFile(file));
  } catch {
    res.writeHead(404).end();
  }
}).listen(port, '0.0.0.0', () => console.log(`Ant Farm: http://localhost:${port}`));
