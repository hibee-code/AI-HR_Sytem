/**
 * Imported first by one-off scripts (demo seed, admin recovery): ConfigModule
 * validates the environment when AppModule is imported, so this must run
 * before that import. Scripts only enqueue jobs; the API's workers run them.
 */
process.env.WORKERS_ENABLED = 'false';
