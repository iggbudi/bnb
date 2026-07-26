#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail

APP_DIR="${APP_DIR:-/data/data/com.termux/files/home/bnb}"
PID_FILE="${PID_FILE:-$APP_DIR/run/server.pid}"
PROC_ROOT="${PROC_ROOT:-/proc}"
CURL_BIN="${CURL_BIN:-curl}"
EXPECTED_ENTRY_POINT="${EXPECTED_ENTRY_POINT:-dist/app/server.js}"
cd "$APP_DIR"

if [[ ! -f "$PID_FILE" ]]; then
  echo "Status: stopped (PID file tidak ada)"
  exit 1
fi

pid="$(cat "$PID_FILE")"
if ! kill -0 "$pid" 2>/dev/null; then
  echo "Status: stopped (PID $pid sudah tidak aktif)"
  exit 1
fi

cmdline_file="$PROC_ROOT/$pid/cmdline"
if [[ ! -r "$cmdline_file" ]]; then
  echo "Status: stale (command PID $pid tidak dapat dibaca)"
  exit 1
fi
command="$(tr '\0' ' ' < "$cmdline_file")"
if [[ "$command" != *"node $EXPECTED_ENTRY_POINT"* ]]; then
  echo "Status: stale (PID $pid menjalankan '${command% }', expected 'node $EXPECTED_ENTRY_POINT')"
  exit 1
fi

port="${PORT:-$(grep -E '^PORT=' .env 2>/dev/null | tail -1 | cut -d= -f2-)}"
port="${port:-3000}"
expected_revision="${EXPECTED_RELEASE_REVISION:-$(git rev-parse HEAD)}"
if [[ -n "${EXPECTED_SCHEMA_VERSION:-}" ]]; then
  expected_schema="$EXPECTED_SCHEMA_VERSION"
else
  expected_schema="$(node --input-type=module -e \
    "import('./dist/app/migrations.js').then(module => process.stdout.write(String(module.APPLICATION_SCHEMA_VERSION)))")"
fi

readiness="$($CURL_BIN -sS --max-time 5 "http://127.0.0.1:${port}/api/health/ready")" || {
  echo "Status: running (PID $pid), readiness check gagal"
  exit 1
}

validation="$(
  READINESS_JSON="$readiness" \
  EXPECTED_ENTRY_POINT="$EXPECTED_ENTRY_POINT" \
  EXPECTED_RELEASE_REVISION="$expected_revision" \
  EXPECTED_SCHEMA_VERSION="$expected_schema" \
  node <<'NODE'
const payload = JSON.parse(process.env.READINESS_JSON || '{}');
const readiness = payload.data;
const deployment = readiness?.deployment;
const schema = deployment?.schema;
const expectedSchema = Number(process.env.EXPECTED_SCHEMA_VERSION);
const failures = [];
if (payload.success !== true || readiness?.ready !== true) failures.push('readiness is not healthy');
if (deployment?.entryPoint !== process.env.EXPECTED_ENTRY_POINT) failures.push('entry point identity mismatch');
if (deployment?.revision !== process.env.EXPECTED_RELEASE_REVISION) failures.push('release revision mismatch');
if (schema?.expectedVersion !== expectedSchema) failures.push('expected schema identity mismatch');
if (schema?.appliedVersion !== expectedSchema) failures.push('applied schema version mismatch');
if (failures.length > 0) {
  console.error(failures.join('; '));
  process.exit(1);
}
process.stdout.write(
  `revision=${deployment.revision}, schema=${schema.appliedVersion}, builtAt=${deployment.builtAt}`
);
NODE
)" || {
  echo "Status: stale (PID $pid, deployment identity/readiness tidak sesuai)"
  exit 1
}

echo "Status: running (PID $pid, port $port, $validation, readiness OK)"
