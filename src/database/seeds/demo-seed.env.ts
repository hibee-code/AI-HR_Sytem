/**
 * Imported first by demo-seed.ts: ConfigModule validates the environment the
 * moment AppModule is imported, so this must run before that import.
 * The seed only enqueues jobs; the running API's workers process them.
 */
process.env.WORKERS_ENABLED = 'false';
