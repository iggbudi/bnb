export const APPLICATION_NAME = 'bnb-lp-analyzer';
export const SERVER_ENTRY_POINT = 'dist/app/server.js';

const processStartedAt = new Date().toISOString();

export interface ApplicationReleaseIdentity {
  application: string;
  revision: string;
  builtAt: string;
  startedAt: string;
  entryPoint: string;
}

export function getApplicationReleaseIdentity(
  environment: NodeJS.ProcessEnv = process.env
): ApplicationReleaseIdentity {
  return {
    application: APPLICATION_NAME,
    revision: environment.BNB_RELEASE_REVISION || 'development',
    builtAt: environment.BNB_BUILD_TIMESTAMP || 'unknown',
    startedAt: processStartedAt,
    entryPoint: SERVER_ENTRY_POINT,
  };
}
