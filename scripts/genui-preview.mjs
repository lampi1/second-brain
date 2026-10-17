// Local visual fixture server for reviewers. No Electron, no brain reads and no agent execution.
import { createServer } from 'vite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const server = await createServer({ configFile: path.join(root, 'vite.config.ts'), server: { host: '127.0.0.1', port: 4387, strictPort: true, open: false } });
await server.listen();
console.log('GenUI fixture: http://127.0.0.1:4387/genui-preview.html');
