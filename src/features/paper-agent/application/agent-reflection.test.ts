import assert from 'node:assert/strict';
import test from 'node:test';

import { parseAgentReflection } from './agent-reflection.js';

const validReflection = {
  assessment: 'incorrect',
  confidence: 'medium',
  summary: 'Keputusan WAIT tidak sesuai karena LP mengungguli HOLD pada outcome 24 jam.',
  predictionErrorAnalysis: 'Estimasi awal terlalu menekankan risiko IL dibanding fee aktual.',
  whatWorked: ['Agent mempertahankan hard safety gate saat coverage rendah.'],
  whatFailed: ['Prediksi fee lebih rendah daripada hasil estimasi outcome.'],
  lesson: 'Bandingkan perubahan volume satu jam dengan estimasi fee awal sebelum mempertahankan sinyal WAIT.',
  futureChecks: ['Pantau perubahan volume satu jam.', 'Ukur error prediksi fee terhadap outcome 24 jam.'],
};

test('parseAgentReflection accepts valid structured reflection', () => {
  assert.deepEqual(parseAgentReflection(validReflection), validReflection);
});

test('parseAgentReflection rejects unsupported assessment', () => {
  assert.throws(
    () => parseAgentReflection({ ...validReflection, assessment: 'certain_profit' }),
    /invalid schema/
  );
});

test('parseAgentReflection rejects drafting artifacts', () => {
  assert.throws(
    () => parseAgentReflection({ ...validReflection, lesson: 'Need to draft this lesson?' }),
    /invalid schema/
  );
});
