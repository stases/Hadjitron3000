import { spawn } from 'node:child_process';
import electron from 'electron';
import { createServer } from 'vite';

const server = await createServer({ server: { host: '127.0.0.1' } });
try {
  await server.listen();
  const url = server.resolvedUrls?.local[0];
  if (!url) throw new Error('Vite did not expose a local URL');
  const env = { ...process.env, HADJITRON_DEV_URL: url };
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(electron, ['.', ...process.argv.slice(2)], {
    stdio: 'inherit',
    env,
  });
  const stop = () => child.kill('SIGTERM');
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  try {
    process.exitCode = await new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('exit', (code) => resolve(code ?? 1));
    });
  } finally {
    process.off('SIGINT', stop);
    process.off('SIGTERM', stop);
  }
} finally {
  await server.close();
}
