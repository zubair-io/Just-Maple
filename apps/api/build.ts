const entries = [
    ['src/index.ts', 'index.js'],
    ['src/db/sqlite/worker.ts', 'sqlite-worker.js'],
    ['src/workers/message-archive.ts', 'message-archive-worker.js'],
    ['scripts/sqlite/migrate.ts', 'migrate.js'],
    ['scripts/sqlite/backup.ts', 'backup.js'],
    ['scripts/sqlite/smoke.ts', 'smoke.js'],
    ['scripts/sqlite/benchmark.ts', 'benchmark.js'],
] as const;
for (const [entry, name] of entries) {
    const result = await Bun.build({
        entrypoints: [entry],
        outdir: 'dist',
        naming: name,
        target: 'bun',
        external: ['sharp'],
        minify: true,
        // Bun otherwise folds NODE_ENV at build time. Authentication gates must read deployment configuration.
        define: { 'process.env.NODE_ENV': 'Bun.env.NODE_ENV' },
        env: 'disable',
    });
    if (!result.success) throw new AggregateError(result.logs, `Build failed: ${entry}`);
    console.log(`Built ${name}`);
}
