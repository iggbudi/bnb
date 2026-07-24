import assert from 'node:assert/strict';
import test from 'node:test';

import { parseAILPAnalysis } from './openai-analysis.js';

const validAnalysis = {
  score: 72,
  verdict: 'perlu_hati_hati',
  confidence: 'medium',
  summary: 'Pool cukup aktif, tetapi data historis terbatas.',
  positiveFactors: ['Volume terhadap TVL tinggi', 'TVL relatif besar'],
  riskFactors: ['Harga aset volatil', 'APR bersifat estimasi'],
  recommendedActions: ['Gunakan modal sesuai toleransi risiko', 'Pantau perubahan TVL'],
  poolFeasibility: 'mixed',
  operationalSummary: 'Paper agent masih mengumpulkan outcome dan execution tetap terkunci.',
  disclaimer: 'Analisis edukatif berbasis data terbatas, bukan nasihat investasi atau jaminan profit.',
};

test('parseAILPAnalysis accepts a valid structured response', () => {
  assert.deepEqual(parseAILPAnalysis(validAnalysis), validAnalysis);
});

test('parseAILPAnalysis rejects scores outside 0-100', () => {
  assert.throws(() => parseAILPAnalysis({ ...validAnalysis, score: 101 }), /invalid schema/);
});

test('parseAILPAnalysis rejects unsupported verdicts', () => {
  assert.throws(() => parseAILPAnalysis({ ...validAnalysis, verdict: 'pasti_untung' }), /invalid schema/);
});

test('parseAILPAnalysis rejects drafting artifacts and wrong currency', () => {
  assert.throws(
    () => parseAILPAnalysis({ ...validAnalysis, summary: 'TVL Rp? Need to revise.' }),
    /invalid schema/
  );
});

test('parseAILPAnalysis rejects unsupported pool feasibility', () => {
  assert.throws(
    () => parseAILPAnalysis({ ...validAnalysis, poolFeasibility: 'guaranteed_profit' }),
    /invalid schema/
  );
});
