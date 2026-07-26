import 'dotenv/config';
import type { PaperAgentOutcomeDetail } from '../../../agent-store.js';

const OPENAI_RESPONSES_URL = 'https://api.openai.com/v1/responses';
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-5.6-sol';
const REQUEST_TIMEOUT_MS = 45_000;
export const REFLECTION_PROMPT_VERSION = '1.2';

export interface ReflectionLessonContext {
  lesson: string;
  futureChecks: string[];
  confidence: 'low' | 'medium' | 'high';
}

export interface AgentReflectionContent {
  assessment: 'correct' | 'partially_correct' | 'incorrect';
  confidence: 'low' | 'medium' | 'high';
  summary: string;
  predictionErrorAnalysis: string;
  whatWorked: string[];
  whatFailed: string[];
  lesson: string;
  futureChecks: string[];
}

const reflectionSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    assessment: {
      type: 'string',
      enum: ['correct', 'partially_correct', 'incorrect'],
    },
    confidence: { type: 'string', enum: ['low', 'medium', 'high'] },
    summary: { type: 'string' },
    predictionErrorAnalysis: { type: 'string' },
    whatWorked: {
      type: 'array',
      items: { type: 'string' },
      minItems: 1,
      maxItems: 3,
    },
    whatFailed: {
      type: 'array',
      items: { type: 'string' },
      minItems: 1,
      maxItems: 3,
    },
    lesson: { type: 'string' },
    futureChecks: {
      type: 'array',
      items: { type: 'string' },
      minItems: 2,
      maxItems: 4,
    },
  },
  required: [
    'assessment',
    'confidence',
    'summary',
    'predictionErrorAnalysis',
    'whatWorked',
    'whatFailed',
    'lesson',
    'futureChecks',
  ],
} as const;

function isStringArray(value: unknown, min: number, max: number): value is string[] {
  return (
    Array.isArray(value) &&
    value.length >= min &&
    value.length <= max &&
    value.every(item => typeof item === 'string' && item.trim().length > 0)
  );
}

export function parseAgentReflection(value: unknown): AgentReflectionContent {
  if (!value || typeof value !== 'object') {
    throw new Error('OpenAI returned an invalid reflection object');
  }

  const data = value as Record<string, unknown>;
  const validAssessment = ['correct', 'partially_correct', 'incorrect'];
  const validConfidence = ['low', 'medium', 'high'];
  const allText = [
    data.summary,
    data.predictionErrorAnalysis,
    data.lesson,
    ...(Array.isArray(data.whatWorked) ? data.whatWorked : []),
    ...(Array.isArray(data.whatFailed) ? data.whatFailed : []),
    ...(Array.isArray(data.futureChecks) ? data.futureChecks : []),
  ]
    .filter(item => typeof item === 'string')
    .join(' ');
  const containsDraftArtifact = /\b(the user|need to|let(?:'s| us)|draft|placeholder)\b|\?/i.test(allText);

  if (
    typeof data.assessment !== 'string' ||
    !validAssessment.includes(data.assessment) ||
    typeof data.confidence !== 'string' ||
    !validConfidence.includes(data.confidence) ||
    typeof data.summary !== 'string' ||
    typeof data.predictionErrorAnalysis !== 'string' ||
    !isStringArray(data.whatWorked, 1, 3) ||
    !isStringArray(data.whatFailed, 1, 3) ||
    typeof data.lesson !== 'string' ||
    !isStringArray(data.futureChecks, 2, 4) ||
    containsDraftArtifact
  ) {
    throw new Error('OpenAI returned reflection with an invalid schema');
  }

  return data as unknown as AgentReflectionContent;
}

function extractOutputText(response: unknown): string {
  if (!response || typeof response !== 'object') {
    throw new Error('OpenAI returned an empty response');
  }
  const output = (response as { output?: unknown }).output;
  if (!Array.isArray(output)) throw new Error('OpenAI response does not contain output');

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

export async function reflectOnPaperOutcome(
  outcome: PaperAgentOutcomeDetail,
  previousLessons: ReflectionLessonContext[]
): Promise<AgentReflectionContent & { model: string; promptVersion: string }> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY is not configured');

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
      max_output_tokens: 1_500,
      input: [
        {
          role: 'developer',
          content: [
            {
              type: 'input_text',
              text: [
                'Anda adalah reviewer keputusan paper liquidity provider yang konservatif.',
                'Tulis hanya hasil final Bahasa Indonesia tanpa proses berpikir, draf, pertanyaan, atau komentar meta.',
                'Gunakan hanya data keputusan dan outcome yang diberikan.',
                'Bedakan profit LP terhadap modal dari selisih LP terhadap HOLD.',
                'Nilai correctness berdasarkan interpretation.economicActionCorrect dan interpretation.economicDifferenceVsHold pada verdict entry 168 jam; raw actionCorrect/differenceVsHold dan legacy assessment hanya diagnostik audit.',
                'Outcome diagnostik awal, ABSTAINED_SAFETY, dan data gap tidak dikirim untuk refleksi, akurasi, atau training.',
                'Pelajaran harus spesifik, dapat diuji pada data berikutnya, dan tidak boleh menjanjikan profit.',
                'Jangan menyarankan transaksi live, nominal modal baru, atau perubahan otomatis pada hard safety gate.',
                'Lesson sebelumnya hanya konteks; jangan mengulangnya kecuali outcome baru benar-benar memperkuat atau membantahnya.',
                'Nominal gunakan US$ dan maksimal dua desimal; persentase maksimal dua desimal.',
              ].join(' '),
            },
          ],
        },
        {
          role: 'user',
          content: [
            {
              type: 'input_text',
              text: `Refleksikan verdict entry 168 jam berikut:\n${JSON.stringify({ outcome, previousLessons }, null, 2)}`,
            },
          ],
        },
      ],
      text: {
        format: {
          type: 'json_schema',
          name: 'paper_agent_reflection',
          strict: true,
          schema: reflectionSchema,
        },
      },
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    console.error(`OpenAI reflection error ${response.status}:`, errorBody.slice(0, 500));
    throw new Error(`OpenAI reflection request failed with status ${response.status}`);
  }

  const outputText = extractOutputText((await response.json()) as unknown);
  let parsed: unknown;
  try {
    parsed = JSON.parse(outputText);
  } catch {
    throw new Error('OpenAI returned invalid reflection JSON');
  }

  return {
    ...parseAgentReflection(parsed),
    model: OPENAI_MODEL,
    promptVersion: REFLECTION_PROMPT_VERSION,
  };
}
