import type { Express } from 'express';

import type { AgentStore } from '../infrastructure/agent-store.js';
import { parsePositiveNumber, parsePositiveNumberOrDefault } from '../../../shared/http/validation.js';

export type AgentHorizon = 1 | 6 | 24 | 168;

export interface PaperAgentStatusPolicy {
  strategyVersion: string;
  investment: number;
  entryPolicy: Record<string, unknown>;
  highRiskAdvisoryPolicy: Record<string, unknown>;
  directionalPaperPolicy: Record<string, unknown>;
  outcomeInterpretation: Record<string, unknown>;
  legacyOutcomeAssessment: Record<string, unknown>;
  evaluationHorizonsHours: readonly AgentHorizon[];
}

export interface PaperAgentRouteDependencies {
  store: Pick<
    AgentStore,
    | 'count'
    | 'getRecent'
    | 'outcomeCounts'
    | 'outcomeInterpretationCounts'
    | 'outcomeAssessmentCounts'
    | 'getRecentOutcomes'
    | 'getOutcomeDetails'
    | 'getPerformance'
    | 'getRecentReflections'
  >;
  policy: PaperAgentStatusPolicy;
  getReflectionStatus(): Record<string, unknown>;
  getLearningStatus(): Record<string, unknown>;
  isLearningEnabled(): boolean;
}

function parseAgentHorizon(value: unknown, horizons: readonly AgentHorizon[]): AgentHorizon {
  const horizon = parsePositiveNumberOrDefault(value, 'horizon', 24);
  if (!horizons.includes(horizon as AgentHorizon)) {
    throw new Error('Parameter "horizon" must be one of: 1, 6, 24, 168');
  }
  return horizon as AgentHorizon;
}

function getNextAgentRunAt(now = new Date()): string {
  const next = new Date(now);
  next.setUTCMinutes(0, 0, 0);
  next.setUTCHours(next.getUTCHours() + 1);
  return next.toISOString();
}

export function buildPaperAgentStatus(
  dependencies: PaperAgentRouteDependencies,
  now = new Date()
): Record<string, unknown> {
  const { store, policy } = dependencies;
  return {
    mode: 'paper',
    strategyVersion: policy.strategyVersion,
    investment: policy.investment,
    decisionIntervalHours: 1,
    decisionSemantics: 'HOURLY_ENTRY_SIGNAL_NOT_TRANSACTION',
    entryPolicy: policy.entryPolicy,
    highRiskAdvisoryPolicy: policy.highRiskAdvisoryPolicy,
    directionalPaperPolicy: policy.directionalPaperPolicy,
    totalDecisions: store.count(),
    latestDecision: store.getRecent(1)[0] ?? null,
    outcomeCounts: store.outcomeCounts(),
    outcomeInterpretation: {
      ...policy.outcomeInterpretation,
      counts: store.outcomeInterpretationCounts(),
    },
    legacyOutcomeAssessment: {
      ...policy.legacyOutcomeAssessment,
      counts: store.outcomeAssessmentCounts(),
    },
    evaluationHorizonsHours: policy.evaluationHorizonsHours,
    nextDecisionAt: getNextAgentRunAt(now),
    outcomeEvaluationEnabled: true,
    reflection: dependencies.getReflectionStatus(),
    learning: dependencies.getLearningStatus(),
    learningEnabled: dependencies.isLearningEnabled(),
  };
}

export function registerPaperAgentRoutes(app: Express, dependencies: PaperAgentRouteDependencies): void {
  app.get('/api/agent/status', (_req, res) => {
    res.json({
      success: true,
      data: buildPaperAgentStatus(dependencies),
      timestamp: new Date().toISOString(),
    });
  });

  app.get('/api/agent/decisions', (req, res) => {
    try {
      const requestedLimit =
        req.query.limit === undefined ? 24 : parsePositiveNumber(req.query.limit, 'limit');
      const limit = Math.min(1_000, Math.max(1, Math.floor(requestedLimit)));
      res.json({
        success: true,
        data: { count: dependencies.store.count(), decisions: dependencies.store.getRecent(limit) },
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      res.status(400).json({
        success: false,
        error: error instanceof Error ? error.message : 'Invalid agent history parameters',
        timestamp: new Date().toISOString(),
      });
    }
  });

  app.get('/api/agent/outcomes', (req, res) => {
    try {
      const requestedLimit =
        req.query.limit === undefined ? 100 : parsePositiveNumber(req.query.limit, 'limit');
      const limit = Math.min(1_000, Math.max(1, Math.floor(requestedLimit)));
      const horizon =
        req.query.horizon === undefined
          ? null
          : parseAgentHorizon(req.query.horizon, dependencies.policy.evaluationHorizonsHours);
      res.json({
        success: true,
        data: {
          ...dependencies.store.outcomeCounts(horizon ?? undefined),
          horizon,
          outcomes:
            horizon === null
              ? dependencies.store.getRecentOutcomes(limit)
              : dependencies.store.getOutcomeDetails(horizon, limit),
        },
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      res.status(400).json({
        success: false,
        error: error instanceof Error ? error.message : 'Invalid outcome history parameters',
        timestamp: new Date().toISOString(),
      });
    }
  });

  app.get('/api/agent/performance', (req, res) => {
    try {
      const horizon = parseAgentHorizon(req.query.horizon, dependencies.policy.evaluationHorizonsHours);
      res.json({
        success: true,
        data: dependencies.store.getPerformance(horizon),
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      res.status(400).json({
        success: false,
        error: error instanceof Error ? error.message : 'Invalid performance parameters',
        timestamp: new Date().toISOString(),
      });
    }
  });

  app.get('/api/agent/reflections', (req, res) => {
    try {
      const requestedLimit =
        req.query.limit === undefined ? 20 : parsePositiveNumber(req.query.limit, 'limit');
      const limit = Math.min(100, Math.max(1, Math.floor(requestedLimit)));
      res.json({
        success: true,
        data: {
          ...dependencies.getReflectionStatus(),
          reflections: dependencies.store.getRecentReflections(limit),
        },
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      res.status(400).json({
        success: false,
        error: error instanceof Error ? error.message : 'Invalid reflection parameters',
        timestamp: new Date().toISOString(),
      });
    }
  });
}
