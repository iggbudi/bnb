export interface ScheduledTaskDefinition {
  name: string;
  label: string;
  intervalMs: number;
  registrationOrder: number;
  run(): unknown;
  runOnStartup?: boolean;
  startupLabel?: string;
  readinessCritical?: boolean;
}

export type ScheduledTaskMetadata = Omit<ScheduledTaskDefinition, 'run'>;
