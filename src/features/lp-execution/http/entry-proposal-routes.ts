import type { Express } from 'express';
import { parsePositiveNumber, parsePositiveNumberOrDefault } from '../../../shared/http/validation.js';
import type { ExecutionRouteDependencies } from './execution-routes.js';

export function registerEntryProposalRoutes(app: Express, dependencies: ExecutionRouteDependencies): void {
  const { agentStore, executionStore } = dependencies;
  const EXECUTION_CONFIG = { limits: dependencies.limits };
  const getExecutionStatus = dependencies.getExecutionStatus;
  const isExecutionAdminAuthorized = dependencies.isAdminAuthorized;

  app.post('/api/execution/proposals', (req, res) => {
    if (!isExecutionAdminAuthorized(req.headers.authorization)) {
      res.status(401).json({ success: false, error: 'Unauthorized', timestamp: new Date().toISOString() });
      return;
    }

    try {
      const status = getExecutionStatus();
      if (!status.ready) {
        executionStore.recordAudit('PROPOSAL_BLOCKED', null, { blockers: status.blockers });
        res.status(409).json({
          success: false,
          error: 'Execution readiness gates are not satisfied',
          data: status,
          timestamp: new Date().toISOString(),
        });
        return;
      }

      const amountUsd = parsePositiveNumberOrDefault(
        req.body?.amountUsd,
        'amountUsd',
        EXECUTION_CONFIG.limits.maxCapitalUsd
      );
      if (amountUsd > EXECUTION_CONFIG.limits.maxCapitalUsd) {
        throw new Error(`Parameter "amountUsd" must not exceed ${EXECUTION_CONFIG.limits.maxCapitalUsd}`);
      }
      const decision = agentStore.getRecent(1)[0];
      if (!decision) throw new Error('No agent decision is available');
      const expiresAt = new Date(
        Date.now() + EXECUTION_CONFIG.limits.proposalExpiryMinutes * 60 * 1_000
      ).toISOString();
      const proposal = executionStore.createProposal({
        decisionId: decision.id,
        amountUsd,
        readiness: status as unknown as Record<string, unknown>,
        expiresAt,
      });
      res.status(201).json({ success: true, data: proposal, timestamp: new Date().toISOString() });
    } catch (error) {
      res.status(400).json({
        success: false,
        error: error instanceof Error ? error.message : 'Proposal could not be created',
        timestamp: new Date().toISOString(),
      });
    }
  });

  app.post('/api/execution/proposals/:id/review', (req, res) => {
    if (!isExecutionAdminAuthorized(req.headers.authorization)) {
      res.status(401).json({ success: false, error: 'Unauthorized', timestamp: new Date().toISOString() });
      return;
    }

    try {
      const id = parsePositiveNumber(req.params.id, 'id');
      if (
        typeof req.body?.approve !== 'boolean' ||
        typeof req.body?.reason !== 'string' ||
        req.body.reason.trim().length < 5
      ) {
        throw new Error('approve boolean and reason are required');
      }
      if (req.body.approve) {
        const status = getExecutionStatus();
        if (!status.ready) {
          executionStore.recordAudit(
            'APPROVAL_BLOCKED',
            executionStore.getProposal(Math.floor(id)) ? Math.floor(id) : null,
            { blockers: status.blockers }
          );
          res.status(409).json({
            success: false,
            error: 'Execution readiness gates are not satisfied',
            data: status,
            timestamp: new Date().toISOString(),
          });
          return;
        }
      }
      const proposal = executionStore.reviewProposal(
        Math.floor(id),
        req.body.approve,
        req.body.reason.trim()
      );
      res.json({
        success: true,
        data: {
          proposal,
          transactionSigned: false,
          transactionBroadcast: false,
          note: 'Manual review recorded. No private key is stored and no transaction was broadcast.',
        },
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      res.status(400).json({
        success: false,
        error: error instanceof Error ? error.message : 'Proposal review failed',
        timestamp: new Date().toISOString(),
      });
    }
  });
}
