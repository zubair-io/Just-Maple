import { Database } from 'bun:sqlite';
import { existsSync, mkdirSync, chmodSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

// Run as a separate process/connection, never inside the API event loop.
const [source, destination] = process.argv.slice(2);
if (!source || !destination) throw new Error('Usage: backup.ts EXISTING_DATABASE NEW_SNAPSHOT');
const input = resolve(source),
    output = resolve(destination);
if (!existsSync(input) || existsSync(output) || input === output)
    throw new Error('Source must exist and snapshot must be new');
mkdirSync(dirname(output), { recursive: true, mode: 0o700 });
const db = new Database(input, { readonly: true });
try {
    db.exec('PRAGMA busy_timeout=5000');
    db.query('VACUUM INTO ?').run(output);
    chmodSync(output, 0o600);
    const copy = new Database(output, { readonly: true });
    try {
        const result = copy.query('PRAGMA integrity_check').get() as { integrity_check: string };
        if (result.integrity_check !== 'ok') throw new Error('Backup integrity failed');
    } finally {
        copy.close();
    }
    console.log(JSON.stringify({ snapshot: output, integrity: 'ok' }));
} finally {
    db.close();
}
