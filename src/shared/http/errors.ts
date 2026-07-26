export function safeErrorMessage(error: unknown, fallback: string): string {
  if (!(error instanceof Error)) return fallback;
  return error.message
    .replace(/https?:\/\/[^\s)]+/gi, '[redacted-url]')
    .replace(/(api[_-]?key|token|password|secret)=([^\s&]+)/gi, '$1=[redacted]');
}
