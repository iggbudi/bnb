import type { ScheduledTaskDefinition } from '../../../shared/runtime/scheduled-task.js';

export interface MarketDataTaskService {
  capturePoolSnapshot(): unknown;
  captureOnchainPoolState(): unknown;
}

export function createMarketDataTasks(service: MarketDataTaskService): readonly ScheduledTaskDefinition[] {
  return [
    {
      name: 'market-snapshot',
      label: 'Background snapshot',
      startupLabel: 'Initial snapshot',
      intervalMs: 60_000,
      registrationOrder: 10,
      run: () => service.capturePoolSnapshot(),
      runOnStartup: true,
      readinessCritical: true,
    },
    {
      name: 'onchain-snapshot',
      label: 'On-chain snapshot',
      startupLabel: 'Initial on-chain snapshot',
      intervalMs: 5 * 60_000,
      registrationOrder: 20,
      run: () => service.captureOnchainPoolState(),
      runOnStartup: true,
      readinessCritical: true,
    },
  ];
}
