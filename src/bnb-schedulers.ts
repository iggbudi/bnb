// Backward-compatible exports while callers migrate to the application composition root.
export {
  registerBnbSchedulers,
  registerBnbSchedulers as startBnbSchedulers,
} from './app/register-schedulers.js';
export type { BnbSchedulerController, BnbSchedulerRuntime } from './app/register-schedulers.js';
