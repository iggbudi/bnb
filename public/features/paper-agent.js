'use strict';

window.BnbDashboard = window.BnbDashboard || {};
window.BnbDashboard.paperAgent = (() => {
  const { fetchApi } = window.BnbDashboard.api;
  const { formatUSD, formatPreciseUSD, formatPercent, formatSignedUSD, escapeHTML, formatAgentTime } =
    window.BnbDashboard.format;

  // ============================================
  // 📌 Paper Agent Dashboard
  // ============================================

  let selectedAgentHorizon = 24;
  let agentRequestId = 0;

  function renderActionBadge(action) {
    const enter = action === 'ENTER_FULL_RANGE';
    return `<span class="action-badge ${enter ? 'action-enter' : 'action-wait'}">${enter ? 'ENTER FULL-RANGE' : 'WAIT'}</span>`;
  }

  function renderOutcomeBadge(outcome) {
    const classification = outcome.interpretation?.classification;
    if (classification === 'DIAGNOSTIC_EARLY') {
      return '<span class="outcome-badge outcome-pending">DIAGNOSTIK AWAL</span>';
    }
    if (classification === 'ABSTAINED_SAFETY') {
      return '<span class="outcome-badge outcome-pending">SAFETY ABSTAIN</span>';
    }
    if (classification === 'SKIPPED_DATA_GAP' || outcome.status === 'SKIPPED_DATA_GAP') {
      return '<span class="outcome-badge outcome-skipped">DATA GAP</span>';
    }
    if (classification === 'CORRECT') {
      return '<span class="outcome-badge outcome-correct">BENAR · 7D NET</span>';
    }
    if (classification === 'INCORRECT') {
      return '<span class="outcome-badge outcome-wrong">SALAH · 7D NET</span>';
    }
    return '<span class="outcome-badge outcome-pending">MENUNGGU INTERPRETASI</span>';
  }

  async function loadAgentDashboard(horizon = selectedAgentHorizon) {
    selectedAgentHorizon = horizon;
    const requestId = ++agentRequestId;
    const dashboard = document.getElementById('agentDashboard');
    if (!dashboard) return;
    dashboard.innerHTML = '<div class="loading">Membaca keputusan dan outcome agent...</div>';

    try {
      const [
        status,
        decisionData,
        outcomeData,
        performance,
        modelData,
        reflectionData,
        executionStatus,
        highRiskPlan,
        aggressivePaper,
      ] = await Promise.all([
        fetchApi('/api/agent/status'),
        fetchApi('/api/agent/decisions?limit=24'),
        fetchApi(`/api/agent/outcomes?horizon=${horizon}&limit=24`),
        fetchApi(`/api/agent/performance?horizon=${horizon}`),
        fetchApi('/api/agent/models'),
        fetchApi('/api/agent/reflections?limit=10'),
        fetchApi('/api/execution/status'),
        fetchApi('/api/agent/high-risk-plan').catch(() => null),
        fetchApi('/api/agent/aggressive-performance').catch(() => null),
      ]);
      if (requestId !== agentRequestId) return;

      const latest = status.latestDecision;
      const horizonLabels = { 1: '1 Jam', 6: '6 Jam', 24: '24 Jam', 168: '7 Hari' };
      const horizonControls = [1, 6, 24, 168]
        .map(
          value => `
          <button class="history-range ${value === horizon ? 'active' : ''}" onclick="loadAgentDashboard(${value})">${horizonLabels[value]}</button>
        `
        )
        .join('');

      const latestDecisionHTML = latest
        ? `
          <div class="card">
            <div class="agent-heading">
              <h3>Sinyal Entry Terbaru</h3>
              ${renderActionBadge(latest.action)}
            </div>
            <div class="metrics-grid">
              <div class="metric">
                <div class="metric-label">Waktu Keputusan</div>
                <div class="metric-value" style="font-size: 1rem;">${escapeHTML(formatAgentTime(latest.createdAt))}</div>
              </div>
              <div class="metric">
                <div class="metric-label">Confidence</div>
                <div class="metric-value">${escapeHTML(latest.confidence.toUpperCase())}</div>
              </div>
              <div class="metric">
                <div class="metric-label">Versi Sinyal</div>
                <div class="metric-value" style="font-size: 1rem;">${escapeHTML(latest.strategyVersion)}</div>
              </div>
              <div class="metric">
                <div class="metric-label">Prediksi Fee 7d · Konservatif</div>
                <div class="metric-value positive">${Number.isFinite(Number(latest.features.predictedFee7d)) ? formatUSD(Number(latest.features.predictedFee7d)) : 'N/A'}</div>
              </div>
              <div class="metric">
                <div class="metric-label">Prediksi IL 7d · Stress</div>
                <div class="metric-value negative">${Number.isFinite(Number(latest.features.predictedIL7d)) ? formatUSD(Number(latest.features.predictedIL7d)) : 'N/A'}</div>
              </div>
              <div class="metric">
                <div class="metric-label">Lifecycle Gas</div>
                <div class="metric-value negative">${Number.isFinite(Number(latest.features.predictedLifecycleCostUsd)) ? formatUSD(Number(latest.features.predictedLifecycleCostUsd)) : 'N/A'}</div>
              </div>
              <div class="metric">
                <div class="metric-label">Prediksi Net Edge 7d</div>
                <div class="metric-value ${Number(latest.features.predictedNetEdge7d) >= 0.01 ? 'positive' : 'negative'}">${Number.isFinite(Number(latest.features.predictedNetEdge7d)) ? formatSignedUSD(Number(latest.features.predictedNetEdge7d)) : 'N/A'}</div>
              </div>
              <div class="metric">
                <div class="metric-label">Coverage Histori 7d</div>
                <div class="metric-value">${Number(latest.features.history7dCoveragePercent || 0).toFixed(1)}%</div>
              </div>
            </div>
            <div class="info-box" style="margin-top: 15px; margin-bottom: 0;">
              <strong>${escapeHTML(latest.reasonCode)}</strong> — ${escapeHTML(latest.rationale)}
            </div>
            ${
              latest.strategyVersion !== status.strategyVersion
                ? `
              <div class="info-box" style="margin-top: 10px; margin-bottom: 0;">
                Sinyal ini adalah histori immutable ${escapeHTML(latest.strategyVersion)}. Kebijakan ${escapeHTML(status.strategyVersion)} mulai berlaku pada slot keputusan UTC berikutnya.
              </div>
            `
                : ''
            }
          </div>
        `
        : '<div class="info-box">Agent belum membuat keputusan.</div>';

      const highRiskPlanHTML = window.BnbDashboard.aggressivePaper.renderHighRiskPlan(highRiskPlan);
      const aggressivePerformanceHTML =
        window.BnbDashboard.aggressivePaper.renderAggressivePerformance(aggressivePaper);
      const outcomeRows = outcomeData.outcomes
        .map(outcome => {
          const interpretation = outcome.interpretation;
          return `
            <tr>
              <td>${escapeHTML(formatAgentTime(outcome.decision.createdAt))}</td>
              <td>${renderActionBadge(outcome.decision.action)}</td>
              <td>${renderOutcomeBadge(outcome)}</td>
              <td>${outcome.lpProfitLossVsInvestment === null ? 'N/A' : formatSignedUSD(outcome.lpProfitLossVsInvestment)}</td>
              <td class="${(outcome.differenceVsHold || 0) >= 0 ? 'positive' : 'negative'}">${outcome.differenceVsHold === null ? 'N/A' : formatSignedUSD(outcome.differenceVsHold)}</td>
              <td>${interpretation?.totalLifecycleCostUsd === null || interpretation?.totalLifecycleCostUsd === undefined ? 'N/A' : formatUSD(interpretation.totalLifecycleCostUsd)}</td>
              <td class="${(interpretation?.economicDifferenceVsHold || 0) >= 0 ? 'positive' : 'negative'}">${interpretation?.economicDifferenceVsHold === null || interpretation?.economicDifferenceVsHold === undefined ? 'N/A' : formatSignedUSD(interpretation.economicDifferenceVsHold)}</td>
              <td>${outcome.estimatedFee === null ? 'N/A' : formatUSD(outcome.estimatedFee)}</td>
              <td>${outcome.ilPercent === null ? 'N/A' : `${outcome.ilPercent.toFixed(3)}%`}</td>
            </tr>
          `;
        })
        .join('');

      const reflectionCards = reflectionData.reflections
        .map(
          reflection => `
          <div class="summary-box" style="margin-top: 12px;">
            <div class="agent-heading" style="margin-bottom: 8px;">
              <strong>${escapeHTML(reflection.assessment.replaceAll('_', ' ').toUpperCase())}</strong>
              <span class="outcome-badge ${reflection.assessment === 'correct' ? 'outcome-correct' : reflection.assessment === 'incorrect' ? 'outcome-wrong' : 'outcome-pending'}">${escapeHTML(reflection.confidence.toUpperCase())}</span>
            </div>
            <p>${escapeHTML(reflection.summary)}</p>
            <div class="ai-section"><strong>Pelajaran</strong><p style="margin-top: 5px;">${escapeHTML(reflection.lesson)}</p></div>
            <div class="ai-section"><strong>Pemeriksaan Berikutnya</strong><ul>${reflection.futureChecks.map(item => `<li>${escapeHTML(item)}</li>`).join('')}</ul></div>
            <div class="refresh-info">${escapeHTML(formatAgentTime(reflection.createdAt))} · ${escapeHTML(reflection.model)} · prompt v${escapeHTML(reflection.promptVersion)}</div>
          </div>
        `
        )
        .join('');

      const modelRows = modelData.models
        .map(
          model => `
          <tr>
            <td>${escapeHTML(formatAgentTime(model.trainedAt))}</td>
            <td>${escapeHTML(model.version)}</td>
            <td><span class="outcome-badge ${model.status === 'ACTIVE' ? 'outcome-correct' : model.status === 'REJECTED' ? 'outcome-wrong' : 'outcome-pending'}">${escapeHTML(model.status)}</span></td>
            <td>${model.trainingRows}</td>
            <td>${model.accuracyPercent.toFixed(1)}%</td>
            <td>${model.baselineAccuracyPercent.toFixed(1)}%</td>
            <td>${model.brierScore.toFixed(3)}</td>
            <td>${escapeHTML(model.gateReason)}</td>
          </tr>
        `
        )
        .join('');

      const decisionRows = decisionData.decisions
        .map(
          decision => `
          <tr>
            <td>${escapeHTML(formatAgentTime(decision.createdAt))}</td>
            <td>${renderActionBadge(decision.action)}</td>
            <td>${escapeHTML(decision.confidence)}</td>
            <td>${formatUSD(decision.referencePrice)}</td>
            <td>${Number.isFinite(Number(decision.features.predictedFee7d)) ? formatUSD(Number(decision.features.predictedFee7d)) : 'N/A'}</td>
            <td>${Number.isFinite(Number(decision.features.predictedIL7d)) ? formatUSD(Number(decision.features.predictedIL7d)) : 'N/A'}</td>
            <td class="${Number(decision.features.predictedNetEdge7d) >= 0.01 ? 'positive' : 'negative'}">${Number.isFinite(Number(decision.features.predictedNetEdge7d)) ? formatSignedUSD(Number(decision.features.predictedNetEdge7d)) : 'N/A'}</td>
            <td>${escapeHTML(decision.reasonCode)}</td>
          </tr>
        `
        )
        .join('');

      dashboard.innerHTML = `
          <div class="card">
            <div class="agent-heading">
              <div>
                <h3>🧠 Hourly Entry Signal Agent</h3>
                <div class="metric-label">${escapeHTML(status.strategyVersion)} · mode PAPER · modal simulasi ${formatUSD(status.investment)}</div>
              </div>
              <button class="btn" onclick="loadAgentDashboard()">Refresh</button>
            </div>
            <div class="metrics-grid">
              <div class="metric">
                <div class="metric-label">Total Keputusan</div>
                <div class="metric-value">${status.totalDecisions}</div>
              </div>
              <div class="metric">
                <div class="metric-label">Total Outcome</div>
                <div class="metric-value">${status.outcomeCounts.total}</div>
              </div>
              <div class="metric">
                <div class="metric-label">Outcome Tervalidasi</div>
                <div class="metric-value positive">${status.outcomeCounts.evaluated}</div>
              </div>
              <div class="metric">
                <div class="metric-label">Outcome Scored</div>
                <div class="metric-value">${status.outcomeInterpretation.counts.scored}</div>
              </div>
              <div class="metric">
                <div class="metric-label">Diagnostik Awal</div>
                <div class="metric-value">${status.outcomeInterpretation.counts.diagnostic}</div>
              </div>
              <div class="metric">
                <div class="metric-label">Safety Abstention</div>
                <div class="metric-value warning">${status.outcomeInterpretation.counts.abstained}</div>
              </div>
              <div class="metric">
                <div class="metric-label">Data Gap</div>
                <div class="metric-value ${status.outcomeCounts.skipped > 0 ? 'negative' : ''}">${status.outcomeCounts.skipped}</div>
              </div>
              <div class="metric">
                <div class="metric-label">Keputusan Berikutnya</div>
                <div class="metric-value" style="font-size: 1rem;">${escapeHTML(formatAgentTime(status.nextDecisionAt))}</div>
              </div>
              <div class="metric">
                <div class="metric-label">Adaptive Learning</div>
                <div class="metric-value ${status.learning.activeModel ? 'positive' : 'warning'}">${status.learning.activeModel ? 'AKTIF' : 'MENGUMPULKAN DATA'}</div>
              </div>
              <div class="metric">
                <div class="metric-label">Refleksi AI</div>
                <div class="metric-value">${status.reflection.totalReflections}</div>
              </div>
              <div class="metric">
                <div class="metric-label">Outcome Menunggu Refleksi</div>
                <div class="metric-value">${status.reflection.pending168hOutcomes}</div>
              </div>
            </div>
          </div>

          <div class="card">
            <div class="agent-heading">
              <div>
                <h3>🎓 Learning Model</h3>
                <div class="metric-label">Logistic regression · purged expanding walk-forward validation</div>
              </div>
              <span class="outcome-badge ${status.learning.activeModel ? 'outcome-correct' : 'outcome-pending'}">${status.learning.activeModel ? 'MODEL ACTIVE' : 'BASELINE ACTIVE'}</span>
            </div>
            <div class="metrics-grid">
              <div class="metric">
                <div class="metric-label">Verdict 168h untuk Training</div>
                <div class="metric-value">${status.learning.examples} / ${status.learning.minimumExamples}</div>
                <div class="learning-progress"><div class="learning-progress-bar" style="width: ${status.learning.progressPercent.toFixed(1)}%;"></div></div>
              </div>
              <div class="metric">
                <div class="metric-label">Model Aktif</div>
                <div class="metric-value" style="font-size: 1rem;">${status.learning.activeModel ? escapeHTML(status.learning.activeModel.version) : 'Belum ada'}</div>
              </div>
              <div class="metric">
                <div class="metric-label">Model Terakhir</div>
                <div class="metric-value" style="font-size: 1rem;">${status.learning.latestModel ? escapeHTML(status.learning.latestModel.status) : 'Belum dilatih'}</div>
              </div>
              <div class="metric">
                <div class="metric-label">Training Berikutnya</div>
                <div class="metric-value">${status.learning.nextTrainingAtRows} outcome</div>
              </div>
              <div class="metric">
                <div class="metric-label">Gate Akurasi</div>
                <div class="metric-value">≥${status.learning.activationGates.minimumAccuracyPercent}%</div>
              </div>
              <div class="metric">
                <div class="metric-label">Harus Mengalahkan Baseline</div>
                <div class="metric-value">+${status.learning.activationGates.improvementOverBaselinePercent}%</div>
              </div>
            </div>
            <div class="info-box" style="margin-top: 15px; margin-bottom: 0;">
              Model baru hanya aktif setelah minimal ${status.learning.minimumExamples} verdict entry 168h, purge overlap 168 baris, kelas hasil cukup beragam, Brier score &lt;0,25, akurasi ≥55%, dan mengalahkan baseline. Hard safety serta minimum net edge tidak dapat dioverride model.
            </div>
          </div>

          <div class="card">
            <div class="agent-heading">
              <div>
                <h3>🔐 Live Execution Control</h3>
                <div class="metric-label">Safety control plane · manual approval only</div>
              </div>
              <span class="outcome-badge ${executionStatus.ready ? 'outcome-correct' : 'outcome-wrong'}">${executionStatus.mode}</span>
            </div>
            <div class="metrics-grid">
              <div class="metric">
                <div class="metric-label">Emergency Stop</div>
                <div class="metric-value ${executionStatus.control.killSwitchEngaged ? 'negative' : 'positive'}">${executionStatus.control.killSwitchEngaged ? 'ENGAGED' : 'DISENGAGED'}</div>
              </div>
              <div class="metric">
                <div class="metric-label">Maksimum Modal</div>
                <div class="metric-value">${formatUSD(executionStatus.limits.maxCapitalUsd)}</div>
              </div>
              <div class="metric">
                <div class="metric-label">Batas Loss Harian</div>
                <div class="metric-value">${formatUSD(executionStatus.limits.maxDailyLossUsd)}</div>
              </div>
              <div class="metric">
                <div class="metric-label">Private Key di Server</div>
                <div class="metric-value positive">TIDAK ADA</div>
              </div>
              <div class="metric">
                <div class="metric-label">Unsigned Tx Planner</div>
                <div class="metric-value ${executionStatus.unsignedTransactionPlanningAvailable ? 'positive' : 'warning'}">${executionStatus.unsignedTransactionPlanningAvailable ? 'READY' : 'TIDAK TERSEDIA'}</div>
              </div>
              <div class="metric">
                <div class="metric-label">Signing/Broadcast</div>
                <div class="metric-value warning">EXTERNAL WALLET</div>
              </div>
              <div class="metric">
                <div class="metric-label">Proposal Tersimpan</div>
                <div class="metric-value">${executionStatus.recentProposals.length}</div>
              </div>
            </div>
            ${
              executionStatus.ready
                ? `
              <div class="info-box" style="margin-top: 15px;"><strong>Readiness gate lulus.</strong> Proposal tetap memerlukan approval administrator dan tidak otomatis menyiarkan transaksi.</div>
            `
                : `
              <div class="error" style="margin-top: 15px;">
                <strong>Execution terkunci.</strong>
                <ul style="margin-top: 8px; padding-left: 20px;">
                  ${executionStatus.blockers.map(blocker => `<li>${escapeHTML(blocker)}</li>`).join('')}
                </ul>
              </div>
            `
            }
            <div class="info-box" style="margin-top: 15px; margin-bottom: 0;">
              Setelah seluruh gate lulus dan proposal disetujui, server dapat menyiapkan calldata approve USDT/WBNB dan mint full-range melalui PancakeSwap V3 Position Manager. Server tidak menandatangani atau menyiarkan transaksi; setiap langkah wajib dikonfirmasi di external wallet. Concentrated range tidak dieksekusi karena model agent hanya dilatih untuk full-range.
            </div>
          </div>

          <div class="card">
            <div class="agent-heading">
              <div>
                <h3>🪞 Memori Refleksi AI</h3>
                <div class="metric-label">Verdict entry 168h → kritik → lesson terstruktur → konteks analisis berikutnya</div>
              </div>
              <span class="outcome-badge ${reflectionData.configured ? 'outcome-correct' : 'outcome-wrong'}">${reflectionData.configured ? 'CONFIGURED' : 'NOT CONFIGURED'}</span>
            </div>
            <div class="info-box">
              Refleksi tidak memiliki otoritas keputusan dan tidak dapat mengubah hard safety gate atau mengaktifkan model statistik.
            </div>
            ${reflectionCards || '<div class="info-box" style="margin-bottom: 0;">Belum ada refleksi. Refleksi pertama dibuat setelah verdict entry 168 jam tervalidasi.</div>'}
          </div>

          <div class="card">
            <h3>Versi Model</h3>
            ${
              modelRows
                ? `
              <div class="table-scroll">
                <table class="il-table agent-table">
                  <thead><tr><th>Dilatih</th><th>Versi</th><th>Status</th><th>Data</th><th>Akurasi</th><th>Baseline</th><th>Brier</th><th>Gate</th></tr></thead>
                  <tbody>${modelRows}</tbody>
                </table>
              </div>
            `
                : `<div class="info-box">Belum ada model. Training pertama dimulai setelah ${status.learning.minimumExamples} verdict entry 168 jam tervalidasi.</div>`
            }
          </div>

          ${latestDecisionHTML}
          ${highRiskPlanHTML}
          ${aggressivePerformanceHTML}

          <div class="card">
            <div class="agent-heading">
              <h3>Diagnostik Sinyal Full-Range · Horizon ${horizonLabels[horizon]}</h3>
            </div>
            <div class="history-controls">${horizonControls}</div>
            <div class="metrics-grid">
              <div class="metric">
                <div class="metric-label">Outcome Dievaluasi</div>
                <div class="metric-value">${performance.evaluated}</div>
              </div>
              <div class="metric">
                <div class="metric-label">Outcome Scored · Hanya 168h</div>
                <div class="metric-value">${performance.scored}</div>
              </div>
              <div class="metric">
                <div class="metric-label">Diagnostik Awal</div>
                <div class="metric-value">${performance.diagnostic}</div>
              </div>
              <div class="metric">
                <div class="metric-label">Safety Abstention</div>
                <div class="metric-value warning">${performance.abstained}</div>
              </div>
              <div class="metric">
                <div class="metric-label">Akurasi Ekonomi</div>
                <div class="metric-value">${performance.accuracyPercent === null ? 'N/A' : `${performance.accuracyPercent.toFixed(1)}%`}</div>
              </div>
              <div class="metric">
                <div class="metric-label">Akurasi Strict · Diagnostik</div>
                <div class="metric-value">${performance.strictAccuracyPercent === null ? 'N/A' : `${performance.strictAccuracyPercent.toFixed(1)}%`}</div>
              </div>
              <div class="metric">
                <div class="metric-label">P&amp;L Sinyal Overlap · Bukan Portfolio</div>
                <div class="metric-value ${performance.cumulativeDecisionProfitLoss >= 0 ? 'positive' : 'negative'}">${formatSignedUSD(performance.cumulativeDecisionProfitLoss)}</div>
              </div>
              <div class="metric">
                <div class="metric-label">Lifecycle Cost Counterfactual</div>
                <div class="metric-value negative">${formatUSD(performance.cumulativeLifecycleCost)}</div>
              </div>
              <div class="metric">
                <div class="metric-label">Net LP vs HOLD · Scored</div>
                <div class="metric-value ${performance.cumulativeEconomicDifferenceVsHold >= 0 ? 'positive' : 'negative'}">${formatSignedUSD(performance.cumulativeEconomicDifferenceVsHold)}</div>
              </div>
              <div class="metric">
                <div class="metric-label">Economic Reward</div>
                <div class="metric-value ${performance.cumulativeReward >= 0 ? 'positive' : 'negative'}">${formatSignedUSD(performance.cumulativeReward)}</div>
              </div>
              <div class="metric">
                <div class="metric-label">Regret</div>
                <div class="metric-value ${performance.cumulativeRegret > 0 ? 'negative' : ''}">${formatUSD(performance.cumulativeRegret)}</div>
              </div>
              <div class="metric">
                <div class="metric-label">Error Prediksi Net 7d</div>
                <div class="metric-value">${performance.averagePredictionError === null ? 'N/A' : formatUSD(performance.averagePredictionError)}</div>
              </div>
            </div>
            <div class="refresh-info">Angka ini menjumlahkan simulasi sinyal full-range per jam yang overlap. Gunakan “Performa Paper Agresif · Portfolio Aktual” untuk P&amp;L modal US$50.</div>
          </div>

          <div class="card">
            <h3>Outcome Sinyal Full-Range ${horizonLabels[horizon]}</h3>
            ${
              outcomeRows
                ? `
              <div class="table-scroll">
                <table class="il-table agent-table">
                  <thead><tr><th>Keputusan</th><th>Sinyal</th><th>Interpretasi</th><th>Gross LP P&L</th><th>Gross vs HOLD</th><th>Lifecycle Cost</th><th>Net vs HOLD</th><th>Fee</th><th>IL</th></tr></thead>
                  <tbody>${outcomeRows}</tbody>
                </table>
              </div>
            `
                : '<div class="info-box">Belum ada outcome pada horizon ini.</div>'
            }
          </div>

          <div class="card">
            <h3>24 Keputusan Terakhir</h3>
            ${
              decisionRows
                ? `
              <div class="table-scroll">
                <table class="il-table agent-table">
                  <thead><tr><th>Waktu</th><th>Sinyal</th><th>Confidence</th><th>Harga</th><th>Pred. Fee 7d</th><th>Pred. IL 7d</th><th>Pred. Net 7d</th><th>Alasan</th></tr></thead>
                  <tbody>${decisionRows}</tbody>
                </table>
              </div>
            `
                : '<div class="info-box">Belum ada keputusan tersimpan.</div>'
            }
          </div>

          <div class="info-box">
            Raw outcome dan assessment v1 tetap immutable untuk audit. Interpretasi lifecycle v2 menjadikan 1h/6h/24h serta sinyal baseline-v1 historis sebagai diagnostik tanpa verdict; hanya 168h dari kebijakan lifecycle-v2/model kompatibel masuk akurasi, training, refleksi, dan reward. Jalur default memakai token USDT/WBNB seimbang, sehingga mint/withdraw hanya dikenai gas—slippage swap dihitung hanya jika proposal benar-benar meminta swap opsional.
          </div>
        `;
    } catch (error) {
      if (requestId === agentRequestId) {
        dashboard.innerHTML = `<div class="error">❌ ${escapeHTML(error.message)}</div>`;
      }
    }
  }

  return { loadAgentDashboard };
})();
