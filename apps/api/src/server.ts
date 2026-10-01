import { loadConfig, loadDotenvFiles } from './config/env.ts';
import { buildApp } from './app.ts';
import { createDeps } from './container.ts';

loadDotenvFiles();
const config = loadConfig();
const deps = createDeps(config);
for (const warning of config.warnings) deps.logger.warn(warning);

const app = buildApp(deps);
const server = app.listen(config.PORT, () => {
  deps.logger.info(
    { port: config.PORT, provider: config.TRAIN_DATA_PROVIDER, cache: deps.cache.kind, email: deps.mailer.mode },
    `RailTrack Live API listening on http://localhost:${config.PORT} (docs: /api/docs)`,
  );
});

let shuttingDown = false;
async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  deps.logger.info({ signal }, 'shutting down');
  server.close();
  await deps.close();
  process.exit(0);
}
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
