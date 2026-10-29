import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const directory = mkdtempSync(join(tmpdir(), 'just-maple-e2e-'));
const server = spawn('bun', ['run', 'src/index.ts'], {
    stdio: 'inherit',
    env: {
        ...process.env,
        DATABASE_DRIVER: 'sqlite',
        DATABASE_PATH: join(directory, 'test.sqlite'),
        DISABLE_BACKGROUND_JOBS: 'true',
        HOST: '127.0.0.1',
        PORT: '7072',
        RP_ID: 'localhost',
        ORIGIN: 'http://localhost:7072',
        REDIS_URL: '',
        JWT_SECRET: 'isolated-e2e-secret',
        STATIC_DIR: resolve('../web/dist/web-e2e/browser'),
    },
});
let stopping = false;
async function stop(code = 0) {
    if (stopping) return;
    stopping = true;
    server.kill('SIGTERM');
    rmSync(directory, { recursive: true, force: true });
    process.exit(code);
}
process.on('SIGINT', () => stop());
process.on('SIGTERM', () => stop());
server.on('exit', (code) => stop(code ?? 1));
server.on('error', () => stop(1));
