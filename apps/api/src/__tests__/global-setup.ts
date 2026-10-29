import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { TestProject } from 'vitest/node';

declare module 'vitest' {
    export interface ProvidedContext {
        sqliteDatabasePath: string;
    }
}

/** Tests use the actual Bun SQLite worker; a missing database is a failure, never a skip. */
export async function setup(project: TestProject) {
    const directory = mkdtempSync(join(tmpdir(), 'just-maple-api-tests-'));
    project.provide('sqliteDatabasePath', join(directory, 'test.sqlite'));
    return () => {
        rmSync(directory, { recursive: true, force: true });
    };
}
