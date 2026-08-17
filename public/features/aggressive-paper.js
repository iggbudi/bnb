'use strict';

window.BnbDashboard = window.BnbDashboard || {};
window.BnbDashboard.aggressivePaper = (() => {
  const { formatUSD, formatPreciseUSD, formatSignedUSD, escapeHTML, formatAgentTime } =
    window.BnbDashboard.format;

  function renderHighRiskPlan(highRiskPlan) {
    const selectedHighRiskRange = highRiskPlan?.selectedRange ?? null;
    const highRiskHistoryLabel = highRiskPlan
      ? highRiskPlan.historyWindowHours >= 24
        ? `${(highRiskPlan.historyWindowHours / 24).toFixed(0)} Hari`
        : `${highRiskPlan.historyWindowHours} Jam`
      : 'Histori';
    const highRiskPlanHTML = highRiskPlan
      ? `
          <div class="card">
            <div class="agent-heading">
              <div>
                <h3>🔥 High Risk / High Gain Advisory</h3>
                <div class="metric-label">Target ${highRiskPlan.targetMonthlyReturnPercent.toFixed(1)}% net / 30 hari · modal paper ${formatUSD(highRiskPlan.investment)}</div>
              </div>
              <span class="outcome-badge ${selectedHighRiskRange ? 'outcome-correct' : 'outcome-pending'}">${escapeHTML(highRiskPlan.advisoryAction.replaceAll('_', ' '))}</span>
            </div>
            ${
              selectedHighRiskRange
                ? `
              <div class="metrics-grid">
                <div class="metric">
                  <div class="metric-label">Concentrated Range</div>
                  <div class="metric-value">±${selectedHighRiskRange.rangePercent.toFixed(2)}%</div>
                </div>
                <div class="metric">
                  <div class="metric-label">Batas Harga</div>
                  <div class="metric-value" style="font-size: 1rem;">${formatUSD(selectedHighRiskRange.priceLowerUsd)} – ${formatUSD(selectedHighRiskRange.priceUpperUsd)}</div>
                </div>
                <div class="metric">
                  <div class="metric-label">Proyeksi Net 30d</div>
                  <div class="metric-value positive">${formatSignedUSD(selectedHighRiskRange.projectedNetProfit30dUsd)} (${selectedHighRiskRange.projectedNetReturn30dPercent.toFixed(2)}%)</div>
                </div>
                <div class="metric">
                  <div class="metric-label">Fee 30d Setelah Haircut</div>
                  <div class="metric-value positive">${formatUSD(selectedHighRiskRange.retainedFee30dUsd)}</div>
                </div>
                <div class="metric">
                  <div class="metric-label">Budget Gas + Recenter</div>
                  <div class="metric-value negative">${formatUSD(selectedHighRiskRange.plannedLifecycleCostUsd)}</div>
                </div>
                <div class="metric">
                  <div class="metric-label">Occupancy Histori ${escapeHTML(highRiskHistoryLabel)}</div>
                  <div class="metric-value">${selectedHighRiskRange.historicalOccupancyPercent.toFixed(1)}%</div>
                </div>
                <div class="metric">
                  <div class="metric-label">Range Exit Histori ${escapeHTML(highRiskHistoryLabel)}</div>
                  <div class="metric-value warning">${selectedHighRiskRange.historicalRangeExits}</div>
                </div>
                <div class="metric">
                  <div class="metric-label">Volume 24h Observasi</div>
                  <div class="metric-value" style="font-size: 1rem;">${formatUSD(highRiskPlan.observedVolume24h)}</div>
                </div>
                <div class="metric">
                  <div class="metric-label">Volume Konservatif</div>
                  <div class="metric-value warning" style="font-size: 1rem;">${formatUSD(highRiskPlan.conservativeVolume24h)} (${(highRiskPlan.volumeHaircutFactor * 100).toFixed(1)}%)</div>
                </div>
                <div class="metric">
                  <div class="metric-label">Stress BNB −5%</div>
                  <div class="metric-value negative">${selectedHighRiskRange.stressDown5ReturnPercent.toFixed(2)}%</div>
                </div>
                <div class="metric">
                  <div class="metric-label">Hard Stop</div>
                  <div class="metric-value negative">${formatUSD(highRiskPlan.stopValueUsd)} (−${highRiskPlan.stopLossPercent}%)</div>
                </div>
              </div>
            `
                : '<div class="info-box">Belum ada range yang lolos target dan data-quality gate.</div>'
            }
            <div class="info-box" style="margin-top: 15px; margin-bottom: 0;">
              <strong>${escapeHTML(highRiskPlan.status)}</strong> — ${escapeHTML(highRiskPlan.reason)}
              Model ${escapeHTML(highRiskPlan.projectionVersion)} memakai occupancy ${escapeHTML(highRiskHistoryLabel)} dan volume konservatif yang tidak melebihi rata-rata rolling 7 hari.
              Maksimal ${highRiskPlan.maxRecentersPerMonth} recenter/bulan dengan asumsi slippage ${highRiskPlan.recenterSlippageBps} bps per recenter.
              Proyeksi ini menentukan entry/recenter paper. Live concentrated execution tetap dinonaktifkan.
            </div>
          </div>
        `
      : '<div class="card"><div class="error">High Risk advisory sementara tidak tersedia; dashboard agent utama tetap berjalan.</div></div>';

    return highRiskPlanHTML;
  }

  function renderAggressivePerformance(aggressivePaper) {
    const aggressivePerformance = aggressivePaper?.performance ?? null;
    const aggressiveEvidence = aggressivePerformance?.projectionEvidence ?? null;
    const aggressivePosition = aggressivePerformance?.activePosition ?? null;
    const aggressiveEvaluation = aggressivePerformance?.latestEvaluation ?? null;
    const aggressiveFeePace30d =
      aggressivePosition && aggressiveEvaluation?.ageHours >= 1
        ? (aggressivePosition.accumulatedFeeUsd / aggressiveEvaluation.ageHours) * 30 * 24
        : null;
    const aggressiveRequiredFeeForTarget = aggressivePosition
      ? aggressivePosition.targetValueUsd -
        aggressivePosition.investmentUsd +
        aggressivePerformance.totalCostsIfExitUsd
      : aggressivePerformance.initialCapitalUsd * 0.1;
    const aggressiveActionRows = (aggressivePaper?.recentActions ?? [])
      .slice(0, 12)
      .map(
        action => `
          <tr>
            <td>${escapeHTML(formatAgentTime(action.createdAt))}</td>
            <td><span class="outcome-badge ${action.action === 'EXIT' ? 'outcome-wrong' : action.action === 'ENTER' || action.action === 'RECENTER' ? 'outcome-pending' : 'outcome-correct'}">${escapeHTML(action.action)}</span></td>
            <td>${escapeHTML(action.reasonCode)}</td>
            <td>${escapeHTML(action.rationale)}</td>
          </tr>
        `
      )
      .join('');
    const aggressiveEvaluationRows = (aggressivePaper?.recentEvaluations ?? [])
      .slice(0, 12)
      .map(
        evaluation => `
          <tr>
            <td>${escapeHTML(formatAgentTime(evaluation.evaluatedAt))}</td>
            <td>${formatUSD(evaluation.priceUsd)}</td>
            <td><span class="outcome-badge ${evaluation.inRange ? 'outcome-correct' : 'outcome-wrong'}">${evaluation.inRange ? 'IN RANGE' : 'OUT'}</span></td>
            <td class="${evaluation.netPnlUsd >= 0 ? 'positive' : 'negative'}">${formatSignedUSD(evaluation.netPnlUsd)} (${evaluation.netReturnPercent.toFixed(2)}%)</td>
            <td>${formatPreciseUSD(evaluation.feeIncrementUsd)}</td>
            <td>${evaluation.occupancyPercent.toFixed(1)}%</td>
            <td>${escapeHTML(evaluation.dataQuality.toUpperCase())}</td>
          </tr>
        `
      )
      .join('');
    const aggressivePerformanceHTML =
      aggressivePaper && aggressivePerformance
        ? `
          <div class="card">
            <div class="agent-heading">
              <div>
                <h3>🔥 Performa Paper Agresif · Portfolio Aktual</h3>
                <div class="metric-label">${escapeHTML(aggressivePaper.strategyVersion)} · satu posisi concentrated · modal awal ${formatUSD(aggressivePerformance.initialCapitalUsd)}</div>
              </div>
              <span class="outcome-badge ${aggressivePosition ? 'outcome-correct' : 'outcome-pending'}">${aggressivePosition ? 'POSITION OPEN' : 'WAIT / COOLDOWN'}</span>
            </div>
            <div class="metrics-grid">
              <div class="metric">
                <div class="metric-label">Nilai Portfolio Jika Exit</div>
                <div class="metric-value">${formatUSD(aggressivePerformance.portfolioValueUsd)}</div>
              </div>
              <div class="metric">
                <div class="metric-label">Net P&amp;L Portfolio</div>
                <div class="metric-value ${aggressivePerformance.portfolioPnlUsd >= 0 ? 'positive' : 'negative'}">${formatSignedUSD(aggressivePerformance.portfolioPnlUsd)} (${aggressivePerformance.portfolioReturnPercent.toFixed(2)}%)</div>
              </div>
              <div class="metric">
                <div class="metric-label">Return Tahunan (Annualized)</div>
                <div class="metric-value ${(aggressivePerformance.annualizedReturnPercent ?? 0) >= 0 ? 'positive' : 'negative'}">${aggressivePerformance.annualizedReturnPercent === null ? 'N/A' : `${aggressivePerformance.annualizedReturnPercent.toFixed(2)}%`}</div>
              </div>
              <div class="metric">
                <div class="metric-label">Fee Paper Teramati On-chain</div>
                <div class="metric-value positive">${formatPreciseUSD(aggressivePerformance.totalFeesUsd)}</div>
              </div>
              <div class="metric">
                <div class="metric-label">Pace Fee 30d · Setelah ≥1h</div>
                <div class="metric-value ${aggressiveFeePace30d !== null && aggressiveFeePace30d >= aggressiveRequiredFeeForTarget ? 'positive' : 'warning'}">${aggressiveFeePace30d === null ? 'MENUNGGU' : formatUSD(aggressiveFeePace30d)}</div>
              </div>
              <div class="metric">
                <div class="metric-label">Umur Siklus</div>
                <div class="metric-value">${aggressiveEvaluation ? `${aggressiveEvaluation.ageHours.toFixed(1)} jam` : 'N/A'}</div>
              </div>
              <div class="metric">
                <div class="metric-label">Total Biaya Jika Exit</div>
                <div class="metric-value negative">${formatPreciseUSD(aggressivePerformance.totalCostsIfExitUsd)}</div>
              </div>
              <div class="metric">
                <div class="metric-label">Status Range</div>
                <div class="metric-value ${aggressiveEvaluation?.inRange ? 'positive' : 'warning'}">${aggressiveEvaluation ? (aggressiveEvaluation.inRange ? 'IN RANGE' : `OUT ${aggressiveEvaluation.outOfRangeMinutes.toFixed(0)}m`) : 'BELUM ADA'}</div>
              </div>
              <div class="metric">
                <div class="metric-label">Range Aktif</div>
                <div class="metric-value" style="font-size: 1rem;">${aggressivePosition ? `±${aggressivePosition.rangePercent.toFixed(2)}% · ${formatUSD(aggressivePosition.priceLowerUsd)}–${formatUSD(aggressivePosition.priceUpperUsd)}` : 'Tidak ada posisi'}</div>
              </div>
              <div class="metric">
                <div class="metric-label">Target / Hard Stop Siklus</div>
                <div class="metric-value" style="font-size: 1rem;">${aggressivePosition ? `${formatUSD(aggressivePosition.targetValueUsd)} / ${formatUSD(aggressivePosition.stopValueUsd)}` : 'Menunggu entry'}</div>
              </div>
              <div class="metric">
                <div class="metric-label">Recenter</div>
                <div class="metric-value">${aggressivePosition?.recenterCount ?? aggressivePerformance.totalRecenters} / ${aggressivePaper.policy.maxRecentersPerCycle}</div>
              </div>
              <div class="metric">
                <div class="metric-label">Posisi Selesai</div>
                <div class="metric-value">${aggressivePerformance.completedPositions}</div>
              </div>
              <div class="metric">
                <div class="metric-label">Win Rate Siklus</div>
                <div class="metric-value">${aggressivePerformance.winRatePercent === null ? 'N/A' : `${aggressivePerformance.winRatePercent.toFixed(1)}%`}</div>
              </div>
              <div class="metric">
                <div class="metric-label">Max Drawdown</div>
                <div class="metric-value negative">${aggressivePerformance.maxDrawdownPercent.toFixed(2)}%</div>
              </div>
              <div class="metric">
                <div class="metric-label">Bukti Proyeksi 30d</div>
                <div class="metric-value ${aggressiveEvidence?.status === 'OBSERVATION_READY' ? 'positive' : 'warning'}">${aggressiveEvidence ? escapeHTML(aggressiveEvidence.status.replaceAll('_', ' ')) : 'N/A'}</div>
              </div>
              <div class="metric">
                <div class="metric-label">Proyeksi / Realized Rata-rata</div>
                <div class="metric-value" style="font-size: 1rem;">${aggressiveEvidence?.averageProjectedNetReturn30dPercent === null || aggressiveEvidence?.averageProjectedNetReturn30dPercent === undefined ? 'N/A' : `${aggressiveEvidence.averageProjectedNetReturn30dPercent.toFixed(2)}% / ${aggressiveEvidence.averageRealizedCycleReturnPercent.toFixed(2)}%`}</div>
              </div>
              <div class="metric">
                <div class="metric-label">Gagal Recenter</div>
                <div class="metric-value warning">${aggressiveEvidence?.noFeasibleRecenterRatePercent === null || aggressiveEvidence?.noFeasibleRecenterRatePercent === undefined ? 'N/A' : `${aggressiveEvidence.noFeasibleRecenterRatePercent.toFixed(1)}%`}</div>
              </div>
              <div class="metric">
                <div class="metric-label">Data Quality Terakhir</div>
                <div class="metric-value ${aggressiveEvaluation?.dataQuality === 'valid' ? 'positive' : 'warning'}">${aggressiveEvaluation ? escapeHTML(aggressiveEvaluation.dataQuality.toUpperCase()) : 'N/A'}</div>
              </div>
            </div>
            <div class="info-box" style="margin-top: 15px;">
              Ini P&amp;L satu portfolio paper yang benar-benar dibuka, bukan penjumlahan sinyal per jam. Fee dikreditkan dari delta feeGrowthGlobal on-chain dan dikalikan occupancy in-range; gas entry/exit, slippage recenter, perubahan komposisi token, target +10%, serta stop −5% masuk ke nilai likuidasi net. Pace fee 30d baru muncul setelah satu jam dan hanya mengekstrapolasi laju fee teramati—bukan jaminan hasil.
              ${aggressiveEvidence ? `Bukti proyeksi tetap ${escapeHTML(aggressiveEvidence.status)} sampai minimal ${aggressiveEvidence.minimumCompletedPositions} posisi selesai dan ${aggressiveEvidence.minimumObservedCalendarDays} hari kalender teramati; metrik ini tidak memiliki execution authority.` : ''}
            </div>
            ${
              aggressiveEvaluationRows
                ? `
              <h4 style="margin: 15px 0 10px;">Evaluasi Portfolio Terakhir</h4>
              <div class="table-scroll"><table class="il-table agent-table">
                <thead><tr><th>Waktu</th><th>Harga</th><th>Range</th><th>Net P&amp;L</th><th>Fee Interval</th><th>Occupancy</th><th>Data</th></tr></thead>
                <tbody>${aggressiveEvaluationRows}</tbody>
              </table></div>
            `
                : '<div class="info-box">Belum ada evaluasi posisi agresif.</div>'
            }
            ${
              aggressiveActionRows
                ? `
              <h4 style="margin: 15px 0 10px;">Aksi Lifecycle Agresif</h4>
              <div class="table-scroll"><table class="il-table agent-table">
                <thead><tr><th>Waktu</th><th>Aksi</th><th>Kode</th><th>Alasan</th></tr></thead>
                <tbody>${aggressiveActionRows}</tbody>
              </table></div>
            `
                : ''
            }
          </div>
        `
        : '<div class="card"><div class="error">Ledger performa paper agresif belum tersedia.</div></div>';

    return aggressivePerformanceHTML;
  }

  return { renderHighRiskPlan, renderAggressivePerformance };
})();
