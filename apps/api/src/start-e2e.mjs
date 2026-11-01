import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const directory = mkdtempSync(join(tmpdir(), 'just-maple-e2e-'));
const server = spawn('bun', ['--no-env-file', 'run', 'src/index.ts'], {
    stdio: 'inherit',
    env: {
        // The API command's parent Bun may have loaded apps/api/.env. Carry only
        // OS essentials, never production credentials, into the disposable server.
        ...Object.fromEntries(
            ['PATH', 'HOME', 'TMPDIR', 'TEMP', 'TMP', 'SYSTEMROOT']
                .filter((name) => process.env[name] !== undefined)
                .map((name) => [name, process.env[name]]),
        ),
        NODE_ENV: 'development',
        LOCAL_STORAGE_PATH: join(directory, 'media'),
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
