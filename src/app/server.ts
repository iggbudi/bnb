import 'dotenv/config';

import { registerBnbSchedulers } from './register-schedulers.js';
import { bnbRuntime } from './runtime.js';

const schedulerController = registerBnbSchedulers(bnbRuntime);
const server = bnbRuntime.app.listen(bnbRuntime.port, bnbRuntime.host, () => {
  console.log(`
╔════════════════════════════════════════════════════════════╗
║       🚀 WBNB/USDT LP Analyzer - Web Server               ║
╠════════════════════════════════════════════════════════════╣
║                                                            ║
║  Server running at: http://${bnbRuntime.host}:${bnbRuntime.port}                   ║
║  Liveness:  /api/health/live                               ║
║  Readiness: /api/health/ready                              ║
║                                                            ║
╚════════════════════════════════════════════════════════════╝
  `);
});

let shutdownPromise: Promise<void> | null = null;

async function gracefulShutdown(signal: NodeJS.Signals): Promise<void> {
  if (shutdownPromise) {
    console.error(`Second ${signal} received; forcing shutdown.`);
    process.exit(1);
  }

  bnbRuntime.setShuttingDown(true);
  shutdownPromise = (async () => {
    console.log(`${signal} received; stopping timers and draining work...`);
    schedulerController.stop();

    const shutdownTimeoutMs = bnbRuntime.shutdownTimeoutMs;
    const serverClosed = new Promise<void>(resolve => {
      let resolved = false;
      let forceTimer: NodeJS.Timeout | null = null;
      const finish = () => {
        if (resolved) return;
        resolved = true;
        if (forceTimer) clearTimeout(forceTimer);
        resolve();
      };
      server.close(finish);
      server.closeIdleConnections?.();
      forceTimer = setTimeout(() => {
        console.error('HTTP drain timeout reached; closing remaining connections.');
        server.closeAllConnections?.();
        finish();
      }, shutdownTimeoutMs);
      forceTimer.unref();
    });
    const schedulersIdle = bnbRuntime.schedulerRegistry.waitForIdle(shutdownTimeoutMs);
    const [idle] = await Promise.all([schedulersIdle, serverClosed]);
    if (!idle) console.error('Scheduler drain timeout reached; closing stores fail-fast.');

    bnbRuntime.closeStores();
    console.log(`Shutdown complete; active HTTP requests=${bnbRuntime.getActiveHttpRequests()}.`);
  })();

  try {
    await shutdownPromise;
    process.exitCode = 0;
  } catch (error) {
    console.error('Graceful shutdown failed:', error);
    process.exitCode = 1;
  }
}

process.once('SIGTERM', () => {
  void gracefulShutdown('SIGTERM');
});
process.once('SIGINT', () => {
  void gracefulShutdown('SIGINT');
});
