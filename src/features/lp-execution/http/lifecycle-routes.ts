import type { Express } from 'express';

import type { ExecutionStore } from '../../../execution-store.js';
import type { LifecycleActivationStore } from '../../../lifecycle-activation-store.js';
import { PANCAKE_V3_POSITION_MANAGER } from '../../../pancakeswap-v3-execution.js';
import { PANCAKE_V3_SWAP_ROUTER } from '../../../pancakeswap-v3-exit.js';
import type { PositionStore } from '../../../position-store.js';
import type { ShadowModeStore } from '../../../shadow-mode-store.js';
import { parsePositiveNumber } from '../../../validation.js';

export interface LifecycleRuntimeView {
  activation: { mode: string };
  activationEligible: boolean;
  shadowValidation: {
    qualified: boolean;
    run: { id: number };
    blockers: string[];
  };
}

export interface PositionLifecycleRouteDependencies {
  positionStore: PositionStore;
  executionStore: ExecutionStore;
  lifecycleActivationStore: LifecycleActivationStore;
  shadowModeStore: ShadowModeStore;
  lifecycleEnabled: boolean;
  mintReceiptMinimumConfirmations: number;
  reconcileLifecycle(): LifecycleRuntimeView;
  isAdminAuthorized(authorization: string | undefined): boolean;
  isExecutionAdapterReady(): boolean;
  isExitSwapRouterReady(): boolean;
}

export function registerPositionLifecycleRoutes(
  app: Express,
  dependencies: PositionLifecycleRouteDependencies
): void {
  const { positionStore, executionStore, lifecycleActivationStore, shadowModeStore } = dependencies;

  app.get('/api/lifecycle/activation', (_req, res) => {
    const runtime = dependencies.reconcileLifecycle();
    res.json({
      success: true,
      data: {
        stage: 'G',
        lifecycleEnabled: dependencies.lifecycleEnabled,
        activation: runtime.activation,
        activationEligible: runtime.activationEligible,
        shadowValidation: runtime.shadowValidation,
        events: lifecycleActivationStore.getEvents(100),
        liveExecutionChanged: false,
      },
      timestamp: new Date().toISOString(),
    });
  });

  app.post('/api/lifecycle/activate-paper', (req, res) => {
    if (!dependencies.isAdminAuthorized(req.headers.authorization)) {
      res.status(401).json({
        success: false,
        error: 'Unauthorized',
        timestamp: new Date().toISOString(),
      });
      return;
    }
    try {
      if (typeof req.body?.reason !== 'string' || req.body.reason.trim().length < 5) {
        throw new Error('reason is required and must contain at least 5 characters');
      }
      if (req.body?.confirmPaperOnly !== true) {
        throw new Error('confirmPaperOnly=true is required');
      }
      const runtime = dependencies.reconcileLifecycle();
      const activation = lifecycleActivationStore.activatePaper({
        shadowQualified: runtime.shadowValidation.qualified,
        shadowRunId: runtime.shadowValidation.run.id,
        shadowBlockers: runtime.shadowValidation.blockers,
        confirmPaperOnly: true,
        reason: req.body.reason.trim(),
      });
      executionStore.recordAudit('PAPER_LIFECYCLE_ACTIVATED', null, {
        shadowRunId: runtime.shadowValidation.run.id,
        reason: req.body.reason.trim(),
        liveExecutionChanged: false,
      });
      res.json({
        success: true,
        data: { activation, shadowValidation: runtime.shadowValidation, liveExecutionChanged: false },
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Paper lifecycle activation failed';
      res.status(message.includes('SHADOW_VALIDATION_NOT_QUALIFIED') ? 409 : 400).json({
        success: false,
        error: message,
        timestamp: new Date().toISOString(),
      });
    }
  });

  app.post('/api/lifecycle/return-to-shadow', (req, res) => {
    if (!dependencies.isAdminAuthorized(req.headers.authorization)) {
      res.status(401).json({
        success: false,
        error: 'Unauthorized',
        timestamp: new Date().toISOString(),
      });
      return;
    }
    try {
      if (typeof req.body?.reason !== 'string' || req.body.reason.trim().length < 5) {
        throw new Error('reason is required and must contain at least 5 characters');
      }
      if (req.body?.resetShadowRun !== undefined && typeof req.body.resetShadowRun !== 'boolean') {
        throw new Error('resetShadowRun must be a boolean');
      }
      const activation = lifecycleActivationStore.returnToShadow(req.body.reason.trim());
      const shadowValidation = req.body?.resetShadowRun
        ? shadowModeStore.reset(req.body.reason.trim())
        : shadowModeStore.refreshQualification();
      executionStore.recordAudit('PAPER_LIFECYCLE_RETURNED_TO_SHADOW', null, {
        shadowRunId: shadowValidation.run.id,
        reason: req.body.reason.trim(),
        resetShadowRun: req.body?.resetShadowRun ?? false,
      });
      res.json({
        success: true,
        data: { activation, shadowValidation, liveExecutionChanged: false },
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      res.status(400).json({
        success: false,
        error: error instanceof Error ? error.message : 'Return to shadow failed',
        timestamp: new Date().toISOString(),
      });
    }
  });

  app.get('/api/shadow/status', (_req, res) => {
    const runtime = dependencies.reconcileLifecycle();
    res.json({
      success: true,
      data: {
        lifecycleEnabled: dependencies.lifecycleEnabled,
        lifecycleMode: runtime.activation.mode,
        validation: runtime.shadowValidation,
      },
      timestamp: new Date().toISOString(),
    });
  });

  app.get('/api/shadow/observations', (req, res) => {
    try {
      const requestedLimit =
        req.query.limit === undefined ? 336 : parsePositiveNumber(req.query.limit, 'limit');
      const limit = Math.min(1_000, Math.max(1, Math.floor(requestedLimit)));
      res.json({
        success: true,
        data: { observations: shadowModeStore.getObservations(limit) },
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      res.status(400).json({
        success: false,
        error: error instanceof Error ? error.message : 'Invalid shadow observation parameters',
        timestamp: new Date().toISOString(),
      });
    }
  });

  app.post('/api/shadow/reset', (req, res) => {
    if (!dependencies.isAdminAuthorized(req.headers.authorization)) {
      res.status(401).json({
        success: false,
        error: 'Unauthorized',
        timestamp: new Date().toISOString(),
      });
      return;
    }
    try {
      if (typeof req.body?.reason !== 'string' || req.body.reason.trim().length < 5) {
        throw new Error('reason is required and must contain at least 5 characters');
      }
      const validation = shadowModeStore.reset(req.body.reason.trim());
      executionStore.recordAudit('SHADOW_VALIDATION_RESET', null, {
        shadowRunId: validation.run.id,
        reason: req.body.reason.trim(),
      });
      res.json({ success: true, data: { validation }, timestamp: new Date().toISOString() });
    } catch (error) {
      res.status(400).json({
        success: false,
        error: error instanceof Error ? error.message : 'Shadow validation reset failed',
        timestamp: new Date().toISOString(),
      });
    }
  });

  app.get('/api/positions/status', (_req, res) => {
    const activePosition = positionStore.getActivePosition();
    const lifecycleRuntime = dependencies.reconcileLifecycle();
    const executionAdapterReady = dependencies.isExecutionAdapterReady();
    res.json({
      success: true,
      data: {
        stage: 'G',
        lifecycleEnabled: dependencies.lifecycleEnabled,
        lifecycleMode: lifecycleRuntime.activation.mode,
        lifecycleActivation: lifecycleRuntime.activation,
        activationEligible: lifecycleRuntime.activationEligible,
        shadowValidation: lifecycleRuntime.shadowValidation,
        behaviorIntegrated: dependencies.lifecycleEnabled,
        dashboardIntegrated: true,
        nftReceiptVerification: {
          available: executionAdapterReady,
          positionManager: PANCAKE_V3_POSITION_MANAGER,
          minimumConfirmations: dependencies.mintReceiptMinimumConfirmations,
          adminAuthenticationRequired: true,
          externalWalletSigningOnly: true,
        },
        recentLiveNfts: positionStore.getRecentLiveNfts(10),
        exitPlanner: {
          available: executionAdapterReady,
          optionalSwapAvailable: dependencies.isExitSwapRouterReady(),
          swapRouter: PANCAKE_V3_SWAP_ROUTER,
          signingAvailable: false,
          broadcastAvailable: false,
          recentProposals: executionStore.getRecentExitProposals(10),
        },
        totalPositions: positionStore.count(),
        activePosition,
        latestAction: positionStore.getRecentActions(1)[0] ?? null,
        latestEvaluation: activePosition
          ? (positionStore.getEvaluations(activePosition.id, 1)[0] ?? null)
          : null,
        recentPositions: positionStore.getRecentPositions(10),
        supportedStatuses: [
          'PENDING_ENTRY',
          'OPEN',
          'PENDING_EXIT',
          'CLOSED',
          'EMERGENCY_EXITED',
          'CANCELLED',
        ],
        supportedActions: ['WAIT', 'ENTER', 'HOLD', 'REVIEW_7D', 'REVIEW_14D', 'EXIT', 'EMERGENCY_EXIT'],
        policy: {
          maxActivePositions: 1,
          minimumHoldDays: 7,
          finalPaperReviewDays: 14,
          reentryCooldownHours: 24,
          hourlyGasChargedUsd: 0,
        },
        note:
          lifecycleRuntime.activation.mode === 'PAPER_ACTIVE'
            ? 'Stage G paper lifecycle is active. Live execution remains independently gated and external-wallet-only.'
            : 'Stage G controls are installed but remain in SHADOW because Stage F qualification and explicit activation are required.',
      },
      timestamp: new Date().toISOString(),
    });
  });

  app.get('/api/positions/:id', (req, res) => {
    try {
      const id = Math.floor(parsePositiveNumber(req.params.id, 'id'));
      const position = positionStore.getPosition(id);
      if (!position) {
        res.status(404).json({
          success: false,
          error: 'Position not found',
          timestamp: new Date().toISOString(),
        });
        return;
      }
      res.json({
        success: true,
        data: {
          position,
          liveNft: positionStore.getLiveNftByPosition(id),
          exitProposals: executionStore.getExitProposalsForPosition(id, 100),
          actions: positionStore.getActions(id, 1_000),
          evaluations: positionStore.getEvaluations(id, 10_000),
          events: positionStore.getEvents(id, 1_000),
        },
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      res.status(400).json({
        success: false,
        error: error instanceof Error ? error.message : 'Invalid position parameter',
        timestamp: new Date().toISOString(),
      });
    }
  });
}
