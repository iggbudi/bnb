import 'dotenv/config';
import type { HistoricalPeriodStats } from '../../../snapshot-store.js';

const OPENAI_RESPONSES_URL = 'https://api.openai.com/v1/responses';
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-5.6-sol';
const REQUEST_TIMEOUT_MS = 45_000;
const PROMPT_VERSION = '2.7';
const CANONICAL_DISCLAIMER =
  'Analisis edukatif berbasis data terbatas, bukan nasihat investasi atau jaminan profit.';

export interface LPAnalysisMetrics {
  pair: string;
  chain: string;
  dex: string;
  feeTierPercent: number;
  price: number;
  tvl: number;
  volume1h: number;
  volume6h: number;
  volume24h: number;
  volumeLiquidityRatio: number;
  estimatedFees24h: number;
  estimatedApr: number;
  priceChange1h: number;
  priceChange6h: number;
  priceChange24h: number;
  buys24h: number;
  sells24h: number;
  ilScenarios: Array<{
    priceChangePercent: number;
    ilPercent: number;
  }>;
  historicalContext: HistoricalPeriodStats[];
  historyDataQuality: {
    totalRows: number;
    availableHours: number;
    firstCapturedAt: string | null;
    latestCapturedAt: string | null;
  };
  agentLessons: Array<{
    lesson: string;
    futureChecks: string[];
    confidence: 'low' | 'medium' | 'high';
    createdAt: string;
  }>;
  onchainContext: {
    blockNumber: number;
    blockTimestamp: string;
    currentTick: number;
    activeLiquidity: string;
    feeGrowthGlobal0X128: string;
    feeGrowthGlobal1X128: string;
    gasPriceWei: string;
    priceWbnbUsd: number;
  } | null;
  operationalContext: {
    mode: 'paper';
    totalDecisions: number;
    latestDecision: {
      action: 'WAIT' | 'ENTER_FULL_RANGE';
      strategyVersion: string;
      confidence: 'low' | 'medium' | 'high';
      createdAt: string;
    } | null;
    outcomes168h: {
      evaluated: number;
      scored: number;
      abstained: number;
      accuracyPercent: number | null;
    };
    activeModel: {
      version: string;
      accuracyPercent: number;
      trainingRows: number;
    } | null;
    execution: {
      ready: boolean;
      mode: 'LOCKED' | 'MANUAL_APPROVAL';
      blockers: string[];
      strategy: 'FULL_RANGE_ONLY';
      transactionSigningAvailable: false;
      broadcastAvailable: false;
      privateKeyStoredByServer: false;
    };
  };
}

export interface AILPAnalysis {
  score: number;
  verdict: 'layak_dipertimbangkan' | 'perlu_hati_hati' | 'kurang_layak';
  confidence: 'low' | 'medium' | 'high';
  summary: string;
  positiveFactors: string[];
  riskFactors: string[];
  recommendedActions: string[];
  poolFeasibility: 'favorable' | 'mixed' | 'unfavorable';
  operationalSummary: string;
  paperAgentReadiness: 'collecting_data' | 'baseline_only' | 'model_active';
  executionReadiness: 'locked' | 'manual_approval_ready';
  safetyBlockers: string[];
  disclaimer: string;
  model: string;
  reasoningEffort: 'medium';
  promptVersion: '2.7';
  generatedAt: string;
}

const analysisSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    score: { type: 'integer', minimum: 0, maximum: 100 },
    verdict: {
      type: 'string',
      enum: ['layak_dipertimbangkan', 'perlu_hati_hati', 'kurang_layak'],
    },
    confidence: { type: 'string', enum: ['low', 'medium', 'high'] },
    summary: { type: 'string' },
    positiveFactors: {
      type: 'array',
      items: { type: 'string' },
      minItems: 2,
      maxItems: 4,
    },
    riskFactors: {
      type: 'array',
      items: { type: 'string' },
      minItems: 2,
      maxItems: 4,
    },
    recommendedActions: {
      type: 'array',
      items: { type: 'string' },
      minItems: 2,
      maxItems: 4,
    },
    poolFeasibility: {
      type: 'string',
      enum: ['favorable', 'mixed', 'unfavorable'],
    },
    operationalSummary: { type: 'string' },
    disclaimer: { type: 'string', enum: [CANONICAL_DISCLAIMER] },
  },
  required: [
    'score',
    'verdict',
    'confidence',
    'summary',
    'positiveFactors',
    'riskFactors',
    'recommendedActions',
    'poolFeasibility',
    'operationalSummary',
    'disclaimer',
  ],
} as const;

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(item => typeof item === 'string');
}

type ParsedAILPAnalysis = Omit<
  AILPAnalysis,
  | 'model'
  | 'reasoningEffort'
  | 'promptVersion'
  | 'generatedAt'
  | 'paperAgentReadiness'
  | 'executionReadiness'
  | 'safetyBlockers'
>;

export function parseAILPAnalysis(value: unknown): ParsedAILPAnalysis {
  if (!value || typeof value !== 'object') {
    throw new Error('OpenAI returned an invalid analysis object');
  }

  const data = value as Record<string, unknown>;
  const validVerdicts = ['layak_dipertimbangkan', 'perlu_hati_hati', 'kurang_layak'];
  const validConfidence = ['low', 'medium', 'high'];

  const allText = [
    data.summary,
    ...(Array.isArray(data.positiveFactors) ? data.positiveFactors : []),
    ...(Array.isArray(data.riskFactors) ? data.riskFactors : []),
    ...(Array.isArray(data.recommendedActions) ? data.recommendedActions : []),
    data.operationalSummary,
    data.disclaimer,
  ]
    .filter(item => typeof item === 'string')
    .join(' ');
  const containsDraftArtifact =
    /\?|\bRp\b|the user|need (?:not|to)|continue|balancedish|let(?:'s| us)|draf/i.test(allText);

  if (
    typeof data.score !== 'number' ||
    !Number.isInteger(data.score) ||
    data.score < 0 ||
    data.score > 100 ||
    typeof data.verdict !== 'string' ||
    !validVerdicts.includes(data.verdict) ||
    typeof data.confidence !== 'string' ||
    !validConfidence.includes(data.confidence) ||
    typeof data.summary !== 'string' ||
    !isStringArray(data.positiveFactors) ||
    data.positiveFactors.length < 2 ||
    data.positiveFactors.length > 4 ||
    !isStringArray(data.riskFactors) ||
    data.riskFactors.length < 2 ||
    data.riskFactors.length > 4 ||
    !isStringArray(data.recommendedActions) ||
    data.recommendedActions.length < 2 ||
    data.recommendedActions.length > 4 ||
    typeof data.poolFeasibility !== 'string' ||
    !['favorable', 'mixed', 'unfavorable'].includes(data.poolFeasibility) ||
    typeof data.operationalSummary !== 'string' ||
    data.disclaimer !== CANONICAL_DISCLAIMER ||
    containsDraftArtifact
  ) {
    throw new Error('OpenAI returned analysis with an invalid schema');
  }

  return data as unknown as ParsedAILPAnalysis;
}

function extractOutputText(response: unknown): string {
  if (!response || typeof response !== 'object') {
    throw new Error('OpenAI returned an empty response');
  }

  const output = (response as { output?: unknown }).output;
  if (!Array.isArray(output)) {
    throw new Error('OpenAI response does not contain output');
  }

  for (const item of output) {
    if (!item || typeof item !== 'object') continue;
    const content = (item as { content?: unknown }).content;
    if (!Array.isArray(content)) continue;

    for (const part of content) {
      if (
        part &&
        typeof part === 'object' &&
        (part as { type?: unknown }).type === 'output_text' &&
        typeof (part as { text?: unknown }).text === 'string'
      ) {
        return (part as { text: string }).text;
      }
    }
  }

  throw new Error('OpenAI response does not contain output text');
}

export async function analyzeLPWithOpenAI(metrics: LPAnalysisMetrics): Promise<AILPAnalysis> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY is not configured');
  }

  const response = await fetch(OPENAI_RESPONSES_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    body: JSON.stringify({
      model: OPENAI_MODEL,
      reasoning: { effort: 'medium' },
      max_output_tokens: 2_000,
      input: [
        {
          role: 'developer',
          content: [
            {
              type: 'input_text',
              text: [
                'Anda adalah analis risiko liquidity provider DeFi yang konservatif.',
                'Berikan hanya hasil akhir yang rapi dalam Bahasa Indonesia; jangan tampilkan proses berpikir, draf, koreksi diri, instruksi, atau fragmen Bahasa Inggris.',
                'Gunakan hanya angka yang diberikan. Jangan mengarang kondisi pasar, prediksi, atau data di luar input.',
                'Bedakan priceChange24h dari DexScreener (rolling 24 jam) dengan perubahan local history yang mungkin memiliki durasi lebih pendek; perbedaan keduanya bukan inkonsistensi.',
                'Jangan menilai tren 24h, 7d, atau 30d sebagai representatif bila coverage periode tersebut di bawah 80%.',
                'Confidence wajib low bila coverage 24h <25%, medium bila 25-80%, dan high hanya bila >=80%.',
                'Gunakan rubric score: likuiditas 0-20, aktivitas volume/TVL 0-25, estimasi APR 0-20, stabilitas/IL 0-15, kualitas data historis 0-20.',
                'Jika confidence low, score maksimal 69 dan verdict tidak boleh layak_dipertimbangkan. Jika confidence medium, score maksimal 79.',
                'Verdict wajib layak_dipertimbangkan untuk score >=70, perlu_hati_hati untuk score 45-69, dan kurang_layak untuk score <45.',
                'RecommendedActions harus berupa langkah riset, monitoring, atau simulasi; jangan menyuruh membuka posisi, menentukan nominal modal, membeli, atau menjual.',
                'agentLessons adalah memori refleksi verdict entry 168 jam sebelumnya. Gunakan hanya sebagai konteks kualitatif, sebutkan bila didukung data saat ini, dan jangan biarkan lesson mengubah angka sumber atau hard safety gate.',
                'onchainContext adalah checkpoint read-only PancakeSwap V3. Fee growth global bukan fee milik posisi; jangan mengubahnya menjadi profit tanpa liquidity posisi dan checkpoint sebelumnya.',
                'Pisahkan kelayakan ekonomi pool dari kesiapan operasional agent. Pool yang favorable tidak otomatis siap dieksekusi.',
                'Gunakan operationalContext untuk operationalSummary. Jika execution.ready=false, nyatakan execution terkunci dan jangan menyebut siap transaksi.',
                'Jangan menyarankan menghapus blocker, menurunkan gate, mengaktifkan live mode, mengisi admin token, atau mematikan emergency stop agar transaksi dapat dipaksakan.',
                'Adapter atau unsigned planner yang siap bukan izin transaksi. AI tidak memiliki decision authority, signing authority, atau broadcast authority.',
                'Strategi execution hanya FULL_RANGE_ONLY. Jangan merekomendasikan concentrated execution karena model dan outcome agent belum dilatih untuk itu.',
                'Jangan meminta atau menampilkan admin token, private key, seed phrase, signature, credential RPC, atau calldata transaksi.',
                'poolFeasibility hanya menilai data pool: favorable bila metrik relatif mendukung, mixed bila trade-off material, unfavorable bila risiko/data mendominasi.',
                'operationalSummary maksimal tiga kalimat dan wajib menyebut status paper agent serta execution tanpa memberikan cara bypass.',
                'Summary maksimal tiga kalimat. Setiap daftar wajib berisi 2-4 poin final yang spesifik dan tidak mengandung komentar meta.',
                'Format angka agar mudah dibaca: nominal maksimal 2 desimal, persentase maksimal 2 desimal, dan rasio maksimal 3 desimal. Jangan menyalin floating-point panjang dari input.',
                'Semua nominal menggunakan USD dengan prefiks US$; jangan gunakan Rupiah, simbol Rp, placeholder, atau tanda tanya.',
                'APR adalah estimasi gross full-range sebelum gas, perubahan TVL, waktu in-range, dan biaya rebalance; jangan menjanjikan profit.',
                `Disclaimer harus persis: "${CANONICAL_DISCLAIMER}"`,
              ].join(' '),
            },
          ],
        },
        {
          role: 'user',
          content: [
            {
              type: 'input_text',
              text: `Nilai kelayakan LP berdasarkan data berikut:\n${JSON.stringify(metrics, null, 2)}`,
            },
          ],
        },
      ],
      text: {
        format: {
          type: 'json_schema',
          name: 'lp_feasibility_analysis',
          strict: true,
          schema: analysisSchema,
        },
      },
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    console.error(`OpenAI API error ${response.status}:`, errorBody.slice(0, 500));
    throw new Error(`OpenAI API request failed with status ${response.status}`);
  }

  const rawResponse = (await response.json()) as unknown;
  const outputText = extractOutputText(rawResponse);
  let parsed: unknown;

  try {
    parsed = JSON.parse(outputText);
  } catch {
    throw new Error('OpenAI returned invalid JSON');
  }

  const authoredAnalysis = parseAILPAnalysis(parsed);
  const paperAgentReadiness: AILPAnalysis['paperAgentReadiness'] = metrics.operationalContext.activeModel
    ? 'model_active'
    : metrics.operationalContext.outcomes168h.scored >= 336
      ? 'baseline_only'
      : 'collecting_data';

  return {
    ...authoredAnalysis,
    paperAgentReadiness,
    executionReadiness: metrics.operationalContext.execution.ready ? 'manual_approval_ready' : 'locked',
    safetyBlockers: [...metrics.operationalContext.execution.blockers],
    model: OPENAI_MODEL,
    reasoningEffort: 'medium',
    promptVersion: PROMPT_VERSION,
    generatedAt: new Date().toISOString(),
  };
}
