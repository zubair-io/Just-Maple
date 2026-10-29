import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** Tests use the actual Bun SQLite worker; a missing database is a failure, never a skip. */
export async function setup() {
    const directory = mkdtempSync(join(tmpdir(), 'just-maple-api-tests-'));
    const metadataDir = join(process.cwd(), '.test-tmp');
    mkdirSync(metadataDir, { recursive: true });
    writeFileSync(
        join(metadataDir, 'database.json'),
        JSON.stringify({ path: join(directory, 'test.sqlite') }),
    );
    return () => {
        rmSync(directory, { recursive: true, force: true });
        rmSync(join(metadataDir, 'database.json'), { force: true });
    };
}
