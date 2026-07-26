'use strict';

window.BnbDashboard = window.BnbDashboard || {};
window.BnbDashboard.execution = (() => {
  const { fetchApi } = window.BnbDashboard.api;
  const { formatUSD, formatPreciseUSD, formatPercent, formatSignedUSD, escapeHTML, formatAgentTime } =
    window.BnbDashboard.format;

  // ============================================
  // 📌 Position Lifecycle Dashboard
  // ============================================

  let positionRequestId = 0;
  let selectedPositionId = null;

  function renderPositionStatusBadge(status) {
    const statusClass =
      status === 'OPEN'
        ? 'position-status-open'
        : status === 'PENDING_ENTRY' || status === 'PENDING_EXIT'
          ? 'position-status-pending'
          : status === 'EMERGENCY_EXITED' || status === 'CANCELLED'
            ? 'position-status-emergency'
            : 'position-status-closed';
    return `<span class="action-badge ${statusClass}">${escapeHTML(status.replaceAll('_', ' '))}</span>`;
  }

  function renderLifecycleActionBadge(action) {
    const actionClass =
      action === 'ENTER'
        ? 'position-action-enter'
        : action === 'HOLD'
          ? 'position-action-hold'
          : action === 'REVIEW_7D' || action === 'REVIEW_14D'
            ? 'position-action-review'
            : action === 'EXIT' || action === 'EMERGENCY_EXIT'
              ? 'position-action-exit'
              : 'position-action-wait';
    return `<span class="action-badge ${actionClass}">${escapeHTML(action.replaceAll('_', ' '))}</span>`;
  }

  function formatPositionAge(hours) {
    if (!Number.isFinite(hours) || hours < 0) return '—';
    const days = Math.floor(hours / 24);
    const remainingHours = Math.floor(hours % 24);
    return days > 0 ? `${days} hari ${remainingHours} jam` : `${remainingHours} jam`;
  }

  function shortIdentifier(value, start = 8, end = 6) {
    if (!value) return '—';
    const text = String(value);
    return text.length > start + end + 3 ? `${text.slice(0, start)}…${text.slice(-end)}` : text;
  }

  function formatTokenUnits(rawValue) {
    if (rawValue === null || rawValue === undefined) return '—';
    const raw = String(rawValue);
    if (!/^\d+$/.test(raw)) return raw;
    const padded = raw.padStart(19, '0');
    const whole = padded.slice(0, -18).replace(/^0+(?=\d)/, '');
    const fraction = padded.slice(-18).replace(/0+$/, '').slice(0, 6);
    return fraction ? `${whole}.${fraction}` : whole;
  }

  function lifecycleTiming(position) {
    if (!position?.openedAt) return { ageHours: 0, progress: 0, nextLabel: 'Menunggu entry', nextAt: null };
    const endTime = position.closedAt ? new Date(position.closedAt).getTime() : Date.now();
    const openedTime = new Date(position.openedAt).getTime();
    const ageHours = Math.max(0, (endTime - openedTime) / (60 * 60 * 1000));
    const progress = Math.min(100, (ageHours / (14 * 24)) * 100);
    if (position.closedAt)
      return { ageHours, progress, nextLabel: 'Lifecycle selesai', nextAt: position.closedAt };
    if (ageHours < 7 * 24) {
      return {
        ageHours,
        progress,
        nextLabel: 'Review 7 hari',
        nextAt: new Date(openedTime + 7 * 24 * 60 * 60 * 1000).toISOString(),
      };
    }
    return {
      ageHours,
      progress,
      nextLabel: 'Review final & paper exit 14 hari',
      nextAt: new Date(openedTime + 14 * 24 * 60 * 60 * 1000).toISOString(),
    };
  }

  async function loadPositionDashboard(positionId = selectedPositionId) {
    const requestId = ++positionRequestId;
    const dashboard = document.getElementById('positionDashboard');
    if (!dashboard) return;
    dashboard.innerHTML = '<div class="loading">Membaca lifecycle, accounting, dan review position...</div>';

    try {
      const status = await fetchApi('/api/positions/status');
      if (requestId !== positionRequestId) return;
      const availablePositions = status.recentPositions || [];
      const requestedId = Number(positionId);
      const selected =
        availablePositions.find(position => position.id === requestedId) ||
        status.activePosition ||
        availablePositions[0] ||
        null;
      selectedPositionId = selected?.id ?? null;
      const detail = selected ? await fetchApi(`/api/positions/${selected.id}`) : null;
      if (requestId !== positionRequestId) return;

      const latestAction = detail?.actions?.[0] || status.latestAction;
      const latestEvaluation = detail?.evaluations?.[0] || null;
      const position = detail?.position || null;
      const timing = lifecycleTiming(position);
      const selector =
        availablePositions.length > 0
          ? `
          <div class="position-selector" aria-label="Pilih histori position">
            ${availablePositions
              .map(
                item => `
              <button class="history-range ${item.id === selectedPositionId ? 'active' : ''}" onclick="loadPositionDashboard(${item.id})">
                #${item.id} · ${escapeHTML(item.status.replaceAll('_', ' '))}
              </button>
            `
              )
              .join('')}
          </div>
        `
          : '';

      const header = `
          <div class="card">
            <div class="agent-heading">
              <div>
                <h3>🧭 Full-Range Position Lifecycle</h3>
                <div class="metric-label">Stage ${escapeHTML(status.stage)} · paper-only · execution live tetap terpisah</div>
              </div>
              <button class="btn" onclick="loadPositionDashboard()">Refresh</button>
            </div>
            <div class="metrics-grid">
              <div class="metric">
                <div class="metric-label">Lifecycle</div>
                <div class="metric-value ${status.lifecycleEnabled ? 'positive' : 'negative'}">${status.lifecycleEnabled ? 'AKTIF' : 'NONAKTIF'}</div>
              </div>
              <div class="metric">
                <div class="metric-label">Lifecycle Mode</div>
                <div class="metric-value warning">${escapeHTML(status.lifecycleMode)}</div>
              </div>
              <div class="metric">
                <div class="metric-label">Shadow Gate</div>
                <div class="metric-value ${status.shadowValidation.qualified ? 'positive' : 'warning'}">${status.shadowValidation.qualified ? 'QUALIFIED' : 'RUNNING'}</div>
              </div>
              <div class="metric">
                <div class="metric-label">Behavior Integrated</div>
                <div class="metric-value ${status.behaviorIntegrated ? 'positive' : 'warning'}">${status.behaviorIntegrated ? 'YA' : 'TIDAK'}</div>
              </div>
              <div class="metric">
                <div class="metric-label">NFT Receipt Verifier</div>
                <div class="metric-value ${status.nftReceiptVerification.available ? 'positive' : 'warning'}">${status.nftReceiptVerification.available ? 'READY' : 'UNAVAILABLE'}</div>
              </div>
              <div class="metric">
                <div class="metric-label">Konfirmasi Mint Minimum</div>
                <div class="metric-value">${status.nftReceiptVerification.minimumConfirmations} block</div>
              </div>
              <div class="metric">
                <div class="metric-label">Unsigned Exit Planner</div>
                <div class="metric-value ${status.exitPlanner.available ? 'positive' : 'warning'}">${status.exitPlanner.available ? 'READY' : 'UNAVAILABLE'}</div>
              </div>
              <div class="metric">
                <div class="metric-label">Optional WBNB Swap</div>
                <div class="metric-value ${status.exitPlanner.optionalSwapAvailable ? 'positive' : 'warning'}">${status.exitPlanner.optionalSwapAvailable ? 'READY' : 'UNAVAILABLE'}</div>
              </div>
              <div class="metric">
                <div class="metric-label">Total Position</div>
                <div class="metric-value">${status.totalPositions}</div>
              </div>
              <div class="metric">
                <div class="metric-label">Posisi Aktif</div>
                <div class="metric-value">${status.activePosition ? `#${status.activePosition.id}` : 'TIDAK ADA'}</div>
              </div>
              <div class="metric">
                <div class="metric-label">Minimum Hold</div>
                <div class="metric-value">${status.policy.minimumHoldDays} hari</div>
              </div>
              <div class="metric">
                <div class="metric-label">Final Paper Review</div>
                <div class="metric-value">${status.policy.finalPaperReviewDays} hari</div>
              </div>
              <div class="metric">
                <div class="metric-label">Gas per Jam</div>
                <div class="metric-value positive">${formatUSD(status.policy.hourlyGasChargedUsd)}</div>
              </div>
              <div class="metric">
                <div class="metric-label">Cooldown Setelah Exit</div>
                <div class="metric-value">${status.policy.reentryCooldownHours} jam</div>
              </div>
            </div>
            ${selector}
          </div>
        `;

      const activation = status.lifecycleActivation;
      const activationCard = `
          <div class="card">
            <div class="agent-heading">
              <div>
                <h3>🚦 Stage G Paper Activation</h3>
                <div class="metric-label">Explicit admin activation · paper-only · tidak membuka live execution</div>
              </div>
              <span class="outcome-badge ${activation.mode === 'PAPER_ACTIVE' ? 'outcome-correct' : 'outcome-pending'}">${escapeHTML(activation.mode.replaceAll('_', ' '))}</span>
            </div>
            <div class="metrics-grid">
              <div class="metric"><div class="metric-label">Activation Eligible</div><div class="metric-value ${status.activationEligible ? 'positive' : 'warning'}">${status.activationEligible ? 'YA' : 'BELUM'}</div></div>
              <div class="metric"><div class="metric-label">Paper Only</div><div class="metric-value positive">${activation.paperOnly ? 'YA' : 'TIDAK'}</div></div>
              <div class="metric"><div class="metric-label">Live Execution Diubah</div><div class="metric-value positive">${activation.liveExecutionChanged ? 'YA' : 'TIDAK'}</div></div>
              <div class="metric"><div class="metric-label">Qualified Shadow Run</div><div class="metric-value">${activation.qualifiedShadowRunId ? `#${activation.qualifiedShadowRunId}` : '—'}</div></div>
              <div class="metric"><div class="metric-label">Activated At</div><div class="metric-value" style="font-size: 1rem;">${escapeHTML(formatAgentTime(activation.activatedAt))}</div></div>
              <div class="metric"><div class="metric-label">Updated At</div><div class="metric-value" style="font-size: 1rem;">${escapeHTML(formatAgentTime(activation.updatedAt))}</div></div>
            </div>
            <div class="info-box" style="margin-top: 15px; margin-bottom: 0;">
              <strong>${escapeHTML(activation.reason)}</strong><br>
              ${
                activation.mode === 'PAPER_ACTIVE'
                  ? 'Paper lifecycle aktif. Jika shadow qualification hilang, sistem otomatis kembali ke SHADOW.'
                  : 'Aktivasi ditolak sampai seluruh Stage F gate lulus, lalu tetap membutuhkan admin token, alasan, dan confirmPaperOnly=true.'
              }
            </div>
          </div>
        `;
      const shadow = status.shadowValidation;
      const shadowProgress = Math.min(100, (shadow.elapsedHours / (shadow.targetDays * 24)) * 100);
      const shadowCard = `
          <div class="card">
            <div class="agent-heading">
              <div>
                <h3>🧪 Stage F Shadow Validation</h3>
                <div class="metric-label">Minimum 14 hari · coverage hourly ≥${shadow.requiredCoveragePercent}% · satu lifecycle final valid</div>
              </div>
              <span class="outcome-badge ${shadow.qualified ? 'outcome-correct' : 'outcome-pending'}">${shadow.qualified ? 'QUALIFIED' : escapeHTML(shadow.run.status)}</span>
            </div>
            <div class="learning-progress"><div class="learning-progress-bar" style="width: ${shadowProgress.toFixed(1)}%;"></div></div>
            <div class="lifecycle-labels" style="margin-top: 7px;"><span>${shadowProgress.toFixed(1)}%</span><span>${formatPositionAge(shadow.remainingHours)} tersisa</span></div>
            <div class="metrics-grid" style="margin-top: 16px;">
              <div class="metric"><div class="metric-label">Mulai</div><div class="metric-value" style="font-size: 1rem;">${escapeHTML(formatAgentTime(shadow.run.startedAt))}</div></div>
              <div class="metric"><div class="metric-label">Target Minimum</div><div class="metric-value" style="font-size: 1rem;">${escapeHTML(formatAgentTime(shadow.run.targetEndAt))}</div></div>
              <div class="metric"><div class="metric-label">Coverage Hourly</div><div class="metric-value ${shadow.coveragePercent >= shadow.requiredCoveragePercent ? 'positive' : 'warning'}">${shadow.coveragePercent.toFixed(1)}%</div></div>
              <div class="metric"><div class="metric-label">Observasi Sukses</div><div class="metric-value">${shadow.successfulHours} / ${shadow.expectedHourlyObservations}</div></div>
              <div class="metric"><div class="metric-label">Jam Dengan Error</div><div class="metric-value ${shadow.errorHours > 0 ? 'negative' : 'positive'}">${shadow.errorHours}</div></div>
              <div class="metric"><div class="metric-label">Lifecycle 14d Selesai</div><div class="metric-value">${shadow.completed14dPaperPositions}</div></div>
              <div class="metric"><div class="metric-label">Final Evaluation Valid</div><div class="metric-value">${shadow.valid14dFinalEvaluations}</div></div>
              <div class="metric"><div class="metric-label">Live Entry Gate</div><div class="metric-value ${shadow.qualified ? 'positive' : 'negative'}">${shadow.qualified ? 'LULUS' : 'TERKUNCI'}</div></div>
            </div>
            ${
              shadow.blockers.length > 0
                ? `
              <div class="error" style="margin-top: 15px;">
                <strong>Shadow validation belum lulus:</strong>
                <ul style="margin-top: 8px; padding-left: 20px;">${shadow.blockers.map(blocker => `<li>${escapeHTML(blocker)}</li>`).join('')}</ul>
              </div>
            `
                : '<div class="info-box" style="margin-top: 15px; margin-bottom: 0;"><strong>Seluruh shadow gate lulus.</strong> Aktivasi tahap berikutnya tetap memerlukan keputusan manual dan safety gate lain.</div>'
            }
            <div class="refresh-info">Run #${shadow.run.id} · tidak dapat dipercepat atau dibackdate · reset memulai periode 14 hari baru</div>
          </div>
        `;

      if (!position) {
        dashboard.innerHTML = `${header}${activationCard}${shadowCard}
            <div class="card">
              <div class="agent-heading">
                <div>
                  <h3>Belum Ada Position</h3>
                  <div class="metric-label">Sistem tidak memaksa entry dan menunggu sinyal hourly yang lolos gate.</div>
                </div>
                ${latestAction ? renderLifecycleActionBadge(latestAction.action) : renderLifecycleActionBadge('WAIT')}
              </div>
              ${
                latestAction
                  ? `
                <div class="info-box" style="margin-bottom: 0;">
                  <strong>${escapeHTML(latestAction.reasonCode)}</strong> — ${escapeHTML(latestAction.rationale)}
                  <div class="refresh-info">${escapeHTML(formatAgentTime(latestAction.createdAt))} · confidence ${escapeHTML(latestAction.confidence.toUpperCase())}</div>
                </div>
              `
                  : '<div class="info-box" style="margin-bottom: 0;">Lifecycle siap. Action pertama akan tersimpan pada siklus hourly berikutnya.</div>'
              }
            </div>
            <div class="info-box">
              Sinyal WAIT tetap dicatat sebagai abstention lifecycle, tetapi tidak membuat posisi dan tidak mengenakan gas.
            </div>
          `;
        return;
      }

      const liveNft = detail.liveNft;
      const latestExitProposal = detail.exitProposals?.[0] || null;
      const exitProposalCard = liveNft
        ? `
          <div class="card">
            <div class="agent-heading">
              <div>
                <h3>🚪 Manual Exit Planning</h3>
                <div class="metric-label">decreaseLiquidity → collect → optional burn/swap</div>
              </div>
              ${
                latestExitProposal
                  ? `<span class="outcome-badge ${latestExitProposal.status === 'APPROVED' ? 'outcome-correct' : latestExitProposal.status === 'REJECTED' || latestExitProposal.status === 'EXPIRED' ? 'outcome-wrong' : 'outcome-pending'}">${escapeHTML(latestExitProposal.status.replaceAll('_', ' '))}</span>`
                  : '<span class="outcome-badge outcome-pending">NO PROPOSAL</span>'
              }
            </div>
            ${
              latestExitProposal
                ? `
              <div class="metrics-grid">
                <div class="metric"><div class="metric-label">Proposal</div><div class="metric-value">#${latestExitProposal.id}</div></div>
                <div class="metric"><div class="metric-label">Slippage</div><div class="metric-value">${(latestExitProposal.slippageBps / 100).toFixed(2)}%</div></div>
                <div class="metric"><div class="metric-label">Burn NFT Kosong</div><div class="metric-value">${latestExitProposal.burnAfterCollect ? 'YA' : 'TIDAK'}</div></div>
                <div class="metric"><div class="metric-label">Swap WBNB → USDT</div><div class="metric-value">${latestExitProposal.swapWbnbToUsdt ? 'YA' : 'TIDAK'}</div></div>
                <div class="metric"><div class="metric-label">Dibuat</div><div class="metric-value" style="font-size: 1rem;">${escapeHTML(formatAgentTime(latestExitProposal.createdAt))}</div></div>
                <div class="metric"><div class="metric-label">Kedaluwarsa</div><div class="metric-value" style="font-size: 1rem;">${escapeHTML(formatAgentTime(latestExitProposal.expiresAt))}</div></div>
              </div>
              <div class="info-box" style="margin-top: 15px; margin-bottom: 0;"><strong>${escapeHTML(latestExitProposal.reason)}</strong><br>Proposal hanya menyiapkan calldata unsigned setelah approval manual.</div>
            `
                : `
              <div class="info-box" style="margin-bottom: 0;">Belum ada proposal exit. Pembuatan dan approval hanya tersedia melalui endpoint administrator; dashboard ini read-only.</div>
            `
            }
          </div>
        `
        : '';
      const liveNftCard = liveNft
        ? `
          <div class="card">
            <div class="agent-heading">
              <div>
                <h3>🔗 Verified PancakeSwap V3 NFT</h3>
                <div class="metric-label">Receipt dan positions(tokenId) dibaca langsung dari BSC</div>
              </div>
              <span class="outcome-badge ${liveNft.ownershipVerified ? 'outcome-correct' : 'outcome-wrong'}">${liveNft.ownershipVerified ? 'OWNERSHIP VERIFIED' : 'OWNERSHIP WARNING'}</span>
            </div>
            <div class="metrics-grid">
              <div class="metric"><div class="metric-label">Token ID</div><div class="metric-value">#${escapeHTML(liveNft.tokenId)}</div></div>
              <div class="metric"><div class="metric-label">Owner</div><div class="metric-value" style="font-size: 1rem;">${escapeHTML(shortIdentifier(liveNft.owner))}</div></div>
              <div class="metric"><div class="metric-label">Liquidity</div><div class="metric-value" style="font-size: 1rem;">${escapeHTML(shortIdentifier(liveNft.liquidity, 10, 8))}</div></div>
              <div class="metric"><div class="metric-label">Ticks</div><div class="metric-value" style="font-size: 1rem;">${liveNft.tickLower} → ${liveNft.tickUpper}</div></div>
              <div class="metric"><div class="metric-label">Fee Tier</div><div class="metric-value">${(liveNft.fee / 10000).toFixed(2)}%</div></div>
              <div class="metric"><div class="metric-label">Konfirmasi Saat Verifikasi</div><div class="metric-value">${liveNft.confirmationsAtVerification}</div></div>
              <div class="metric"><div class="metric-label">Transaction</div><div class="metric-value" style="font-size: 1rem;">${escapeHTML(shortIdentifier(liveNft.txHash))}</div></div>
              <div class="metric"><div class="metric-label">Block</div><div class="metric-value">#${liveNft.blockNumber}</div></div>
              <div class="metric"><div class="metric-label">Gas Used</div><div class="metric-value">${Number(liveNft.gasUsed).toLocaleString('id-ID')}</div></div>
              <div class="metric"><div class="metric-label">Diverifikasi</div><div class="metric-value" style="font-size: 1rem;">${escapeHTML(formatAgentTime(liveNft.verifiedAt))}</div></div>
              <div class="metric"><div class="metric-label">Fee Checkpoint USDT</div><div class="metric-value" style="font-size: 0.9rem;">${escapeHTML(shortIdentifier(liveNft.feeGrowthInside0LastX128, 10, 8))}</div></div>
              <div class="metric"><div class="metric-label">Fee Checkpoint WBNB</div><div class="metric-value" style="font-size: 0.9rem;">${escapeHTML(shortIdentifier(liveNft.feeGrowthInside1LastX128, 10, 8))}</div></div>
            </div>
            <div class="info-box" style="margin-top: 15px; margin-bottom: 0;">
              Server hanya mengobservasi transaksi yang telah ditandatangani dan disiarkan external wallet. Server tidak memiliki private key dan tidak dapat memindahkan NFT.
            </div>
          </div>
        `
        : '';

      const evaluationRows = detail.evaluations
        .map(
          evaluation => `
          <tr>
            <td>${escapeHTML(formatAgentTime(evaluation.evaluatedAt))}</td>
            <td>${(evaluation.ageHours / 24).toFixed(2)}d</td>
            <td>${formatUSD(evaluation.lpValueUsd)}</td>
            <td>${formatUSD(evaluation.holdValueUsd)}</td>
            <td class="positive">${formatUSD(evaluation.accumulatedFeeUsd)}</td>
            <td class="${evaluation.netPnlUsd >= 0 ? 'positive' : 'negative'}">${formatSignedUSD(evaluation.netPnlUsd)}</td>
            <td class="${evaluation.differenceVsHoldUsd >= 0 ? 'positive' : 'negative'}">${formatSignedUSD(evaluation.differenceVsHoldUsd)}</td>
            <td>${formatUSD(evaluation.estimatedExitCostUsd)}</td>
            <td><span class="outcome-badge ${evaluation.dataQuality === 'valid' ? 'outcome-correct' : 'outcome-pending'}">${escapeHTML(evaluation.dataQuality.toUpperCase())}</span></td>
          </tr>
        `
        )
        .join('');
      const actionTimeline = detail.actions
        .map(
          action => `
          <div class="timeline-item">
            <div class="agent-heading" style="margin-bottom: 0;">
              <div>${renderLifecycleActionBadge(action.action)} <strong>${escapeHTML(action.reasonCode)}</strong></div>
              <span class="refresh-info">${escapeHTML(formatAgentTime(action.createdAt))}</span>
            </div>
            <p>${escapeHTML(action.rationale)}</p>
          </div>
        `
        )
        .join('');
      const eventRows = detail.events
        .map(
          event => `
          <tr>
            <td>${escapeHTML(formatAgentTime(event.createdAt))}</td>
            <td>${escapeHTML(event.eventType)}</td>
            <td>${event.fromStatus ? escapeHTML(event.fromStatus.replaceAll('_', ' ')) : '—'}</td>
            <td>${event.toStatus ? escapeHTML(event.toStatus.replaceAll('_', ' ')) : '—'}</td>
          </tr>
        `
        )
        .join('');

      dashboard.innerHTML = `${header}${activationCard}${shadowCard}
          <div class="card">
            <div class="agent-heading">
              <div>
                <h3>Position #${position.id}</h3>
                <div class="metric-label">${escapeHTML(position.mode)} · ${escapeHTML(position.strategy.replaceAll('_', ' '))} · modal ${formatUSD(position.investmentUsd)}</div>
              </div>
              ${renderPositionStatusBadge(position.status)}
            </div>
            <div class="lifecycle-progress" role="progressbar" aria-label="Umur lifecycle 14 hari" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${timing.progress.toFixed(1)}">
              <div class="lifecycle-progress-bar" style="width: ${timing.progress.toFixed(1)}%;"></div>
              <div class="lifecycle-review-marker" title="Review hari ke-7"></div>
            </div>
            <div class="lifecycle-labels"><span>Entry</span><span>Review 7d</span><span>Final/Exit 14d</span></div>
            <div class="metrics-grid" style="margin-top: 18px;">
              <div class="metric">
                <div class="metric-label">Umur Position</div>
                <div class="metric-value">${formatPositionAge(timing.ageHours)}</div>
              </div>
              <div class="metric">
                <div class="metric-label">Tahap Berikutnya</div>
                <div class="metric-value" style="font-size: 1rem;">${escapeHTML(timing.nextLabel)}</div>
                <div class="refresh-info">${escapeHTML(formatAgentTime(timing.nextAt))}</div>
              </div>
              <div class="metric">
                <div class="metric-label">Dibuka</div>
                <div class="metric-value" style="font-size: 1rem;">${escapeHTML(formatAgentTime(position.openedAt))}</div>
              </div>
              <div class="metric">
                <div class="metric-label">Ditutup</div>
                <div class="metric-value" style="font-size: 1rem;">${escapeHTML(formatAgentTime(position.closedAt))}</div>
              </div>
            </div>
          </div>

          ${liveNftCard}
          ${exitProposalCard}

          <div class="card">
            <h3>💰 Mark-to-Market & Lifecycle Cost</h3>
            <div class="metrics-grid">
              <div class="metric">
                <div class="metric-label">Nilai LP Saat Ini</div>
                <div class="metric-value">${position.currentValueUsd === null ? '—' : formatUSD(position.currentValueUsd)}</div>
              </div>
              <div class="metric">
                <div class="metric-label">Net P&L Jika Exit</div>
                <div class="metric-value ${latestEvaluation && latestEvaluation.netPnlUsd >= 0 ? 'positive' : 'negative'}">${latestEvaluation ? formatSignedUSD(latestEvaluation.netPnlUsd) : '—'}</div>
              </div>
              <div class="metric">
                <div class="metric-label">Net LP vs HOLD</div>
                <div class="metric-value ${latestEvaluation && latestEvaluation.differenceVsHoldUsd >= 0 ? 'positive' : 'negative'}">${latestEvaluation ? formatSignedUSD(latestEvaluation.differenceVsHoldUsd) : '—'}</div>
              </div>
              <div class="metric">
                <div class="metric-label">Fee Terkumpul</div>
                <div class="metric-value positive">${formatUSD(position.accumulatedFeeUsd)}</div>
              </div>
              <div class="metric">
                <div class="metric-label">Entry Gas · Sekali</div>
                <div class="metric-value negative">${formatUSD(position.entryGasUsd)}</div>
              </div>
              <div class="metric">
                <div class="metric-label">Estimasi Exit Gas</div>
                <div class="metric-value negative">${latestEvaluation ? formatUSD(latestEvaluation.estimatedExitCostUsd) : formatUSD(position.exitGasUsd)}</div>
              </div>
              <div class="metric">
                <div class="metric-label">Harga Entry</div>
                <div class="metric-value">${position.entryPrice === null ? '—' : formatUSD(position.entryPrice)}</div>
              </div>
              <div class="metric">
                <div class="metric-label">Kualitas Evaluasi</div>
                <div class="metric-value">${latestEvaluation ? `<span class="outcome-badge ${latestEvaluation.dataQuality === 'valid' ? 'outcome-correct' : 'outcome-pending'}">${escapeHTML(latestEvaluation.dataQuality.toUpperCase())}</span>` : '—'}</div>
              </div>
              <div class="metric">
                <div class="metric-label">USDT Amount</div>
                <div class="metric-value" style="font-size: 1rem;">${formatTokenUnits(position.token0Amount)}</div>
              </div>
              <div class="metric">
                <div class="metric-label">WBNB Amount</div>
                <div class="metric-value" style="font-size: 1rem;">${formatTokenUnits(position.token1Amount)}</div>
              </div>
            </div>
            <div class="info-box" style="margin-top: 15px; margin-bottom: 0;">
              Net P&L adalah nilai likuidasi: gross LP + fee − modal − entry gas − estimasi exit gas. Tidak ada gas tambahan selama HOLD.
            </div>
          </div>

          <div class="card">
            <h3>Lifecycle Actions</h3>
            <div class="timeline-list">${actionTimeline || '<div class="info-box">Belum ada action.</div>'}</div>
          </div>

          <div class="card">
            <h3>Evaluasi Mark-to-Market</h3>
            ${
              evaluationRows
                ? `
              <div class="table-scroll">
                <table class="il-table agent-table">
                  <thead><tr><th>Waktu</th><th>Umur</th><th>LP</th><th>HOLD</th><th>Fee</th><th>Net P&L</th><th>vs HOLD</th><th>Exit Cost</th><th>Data</th></tr></thead>
                  <tbody>${evaluationRows}</tbody>
                </table>
              </div>
            `
                : '<div class="info-box">Belum ada evaluasi mark-to-market.</div>'
            }
          </div>

          <div class="card">
            <h3>State Transition Audit</h3>
            ${
              eventRows
                ? `
              <div class="table-scroll">
                <table class="il-table">
                  <thead><tr><th>Waktu</th><th>Event</th><th>Dari</th><th>Ke</th></tr></thead>
                  <tbody>${eventRows}</tbody>
                </table>
              </div>
            `
                : '<div class="info-box">Belum ada event.</div>'
            }
          </div>

          <div class="info-box">
            Dashboard ini hanya memantau paper lifecycle. Review hari ke-14 menutup simulasi paper; tidak ada signing atau broadcast transaksi live.
          </div>
        `;
    } catch (error) {
      if (requestId === positionRequestId) {
        dashboard.innerHTML = `<div class="error">❌ ${escapeHTML(error.message)}</div>`;
      }
    }
  }

  return { loadPositionDashboard };
})();
