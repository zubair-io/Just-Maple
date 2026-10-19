// Keep MongoMemoryServer on Node: its child-process lifecycle requires Node APIs.
import { MongoMemoryServer } from 'mongodb-memory-server';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

const mongo = await MongoMemoryServer.create({ instance: { dbName: 'justmaple-e2e' } });
const server = spawn('bun', ['run', 'src/index.ts'], {
    stdio: 'inherit',
    env: {
        ...process.env,
        MONGODB_URI: mongo.getUri(),
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
    await mongo.stop();
    process.exit(code);
}
process.on('SIGINT', () => stop());
process.on('SIGTERM', () => stop());
server.on('exit', (code) => stop(code ?? 1));
server.on('error', () => stop(1));
