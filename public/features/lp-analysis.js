'use strict';

window.BnbDashboard = window.BnbDashboard || {};
window.BnbDashboard.lpAnalysis = (() => {
  const { fetchApi } = window.BnbDashboard.api;
  const { formatUSD, formatPreciseUSD, formatPercent, formatSignedUSD, escapeHTML, formatAgentTime } =
    window.BnbDashboard.format;

  let latestLPAnalysis = null;

  // ============================================
  // 📌 AI LP Feasibility Analysis
  // ============================================

  function renderLPAnalysis(data) {
    const resultDiv = document.getElementById('aiAnalysisResult');
    if (!resultDiv) return;

    const verdictLabels = {
      layak_dipertimbangkan: 'Layak Dipertimbangkan',
      perlu_hati_hati: 'Perlu Hati-hati',
      kurang_layak: 'Kurang Layak',
    };
    const renderItems = items => items.map(item => `<li>${escapeHTML(item)}</li>`).join('');
    const projection = data.investmentProjection;
    const projectionHTML = projection
      ? `
        <div class="ai-section">
          <strong>💵 Simulasi US$100 — Jika Masuk 24 Jam Lalu</strong>
          <div class="metrics-grid" style="margin-top: 10px;">
            <div class="metric">
              <div class="metric-label">Perubahan Harga BNB 24h</div>
              <div class="metric-value ${projection.priceChangePercent >= 0 ? 'positive' : 'negative'}">${formatPercent(projection.priceChangePercent)}</div>
            </div>
            <div class="metric">
              <div class="metric-label">Estimasi Fee 24h</div>
              <div class="metric-value positive">${formatUSD(projection.estimatedFee)}</div>
            </div>
            <div class="metric">
              <div class="metric-label">Nilai Jika HOLD</div>
              <div class="metric-value">${formatUSD(projection.holdValue)}</div>
            </div>
            <div class="metric">
              <div class="metric-label">Nilai LP + Estimasi Fee</div>
              <div class="metric-value">${formatUSD(projection.lpValueAfterFee)}</div>
            </div>
            <div class="metric">
              <div class="metric-label">Profit/Rugi vs Modal US$100</div>
              <div class="metric-value ${projection.profitLossVsInvestment >= 0 ? 'positive' : 'negative'}">${formatSignedUSD(projection.profitLossVsInvestment)}</div>
            </div>
            <div class="metric">
              <div class="metric-label">Selisih LP vs HOLD</div>
              <div class="metric-value ${projection.differenceVsHold >= 0 ? 'positive' : 'negative'}">${formatSignedUSD(projection.differenceVsHold)}</div>
            </div>
          </div>
          <div class="info-box" style="margin-top: 10px; margin-bottom: 0;">
            IL ${projection.ilPercent.toFixed(2)}% (${formatUSD(projection.ilLoss)}). Proyeksi ringkas ini memakai perubahan harga rolling 24 jam, full-range 50/50, serta fee berdasarkan share active liquidity V3 setelah protocol fee; belum memasukkan lifecycle gas dan slippage. Full-range tidak memakai rebalance berkala.
          </div>
        </div>
      `
      : '';

    resultDiv.innerHTML = `
        <div class="summary-box">
          <div class="ai-score">${data.score}/100</div>
          <div class="ai-verdict">${escapeHTML(verdictLabels[data.verdict] || data.verdict)}</div>
          <p>${escapeHTML(data.summary)}</p>

          ${projectionHTML}

          <div class="ai-section">
            <strong>🧭 Status Analisis dan Operasional</strong>
            <div class="metrics-grid" style="margin-top: 10px;">
              <div class="metric">
                <div class="metric-label">Pool Feasibility</div>
                <div class="metric-value">${escapeHTML({ favorable: 'FAVORABLE', mixed: 'MIXED', unfavorable: 'UNFAVORABLE' }[data.poolFeasibility] || data.poolFeasibility)}</div>
              </div>
              <div class="metric">
                <div class="metric-label">Paper Agent Readiness</div>
                <div class="metric-value">${escapeHTML(data.paperAgentReadiness.replaceAll('_', ' ').toUpperCase())}</div>
              </div>
              <div class="metric">
                <div class="metric-label">Execution Readiness</div>
                <div class="metric-value ${data.executionReadiness === 'manual_approval_ready' ? 'positive' : 'negative'}">${escapeHTML(data.executionReadiness.replaceAll('_', ' ').toUpperCase())}</div>
              </div>
              <div class="metric">
                <div class="metric-label">Safety Blockers</div>
                <div class="metric-value ${data.safetyBlockers.length === 0 ? 'positive' : 'warning'}">${data.safetyBlockers.length}</div>
              </div>
            </div>
            <div class="info-box" style="margin-top: 10px;">
              ${escapeHTML(data.operationalSummary)}
            </div>
            ${
              data.safetyBlockers.length
                ? `
              <div class="error">
                <strong>Execution tetap terkunci:</strong>
                <ul style="margin-top: 8px; padding-left: 20px;">${data.safetyBlockers.map(blocker => `<li>${escapeHTML(blocker)}</li>`).join('')}</ul>
              </div>
            `
                : ''
            }
          </div>

          <div class="ai-section">
            <strong>✅ Faktor Positif</strong>
            <ul>${renderItems(data.positiveFactors)}</ul>
          </div>
          <div class="ai-section">
            <strong>⚠️ Faktor Risiko</strong>
            <ul>${renderItems(data.riskFactors)}</ul>
          </div>
          <div class="ai-section">
            <strong>📌 Tindakan yang Disarankan</strong>
            <ul>${renderItems(data.recommendedActions)}</ul>
          </div>
          <div class="refresh-info">
            Confidence: ${escapeHTML(data.confidence)} · ${escapeHTML(data.model)} · prompt v${escapeHTML(data.promptVersion || '1.0')} ·
            ${data.cached ? 'hasil cache' : new Date(data.generatedAt).toLocaleString()}
          </div>
          <div class="info-box" style="margin-top: 15px; margin-bottom: 0;">
            ${escapeHTML(data.disclaimer)}
          </div>
        </div>
      `;
  }

  async function runLPAnalysis() {
    const button = document.getElementById('aiAnalysisButton');
    const resultDiv = document.getElementById('aiAnalysisResult');
    if (!button || !resultDiv) return;

    button.disabled = true;
    resultDiv.innerHTML = '<div class="loading">GPT-5.6 Sol sedang menganalisis...</div>';

    try {
      const data = await fetchApi('/api/lp-analysis', { method: 'POST' });
      latestLPAnalysis = data;
      renderLPAnalysis(data);
    } catch (error) {
      resultDiv.innerHTML = `<div class="error">❌ ${escapeHTML(error.message)}</div>`;
    } finally {
      button.disabled = false;
    }
  }

  function renderLatestAnalysis() {
    if (latestLPAnalysis) renderLPAnalysis(latestLPAnalysis);
  }

  // ============================================
  // 📌 Run Simulation
  // ============================================

  async function runSimulation() {
    const amount = document.getElementById('simAmount').value;
    const resultDiv = document.getElementById('simulatorResult');

    resultDiv.innerHTML = '<div class="loading">Menghitung simulasi...</div>';

    try {
      const data = await fetchApi(`/api/simulate?amount=${amount}`);

      resultDiv.innerHTML = `
          <div class="summary-box">
            <h4>💰 Hasil Simulasi LP (${formatUSD(data.investment)})</h4>
            <div class="metrics-grid">
              <div class="metric">
                <div class="metric-label">📊 Share Liquidity Aktif</div>
                <div class="metric-value">${(data.shareOfActiveLiquidity * 100).toFixed(8)}%</div>
              </div>
              <div class="metric">
                <div class="metric-label">🎯 APR Fee (Sebelum Gas)</div>
                <div class="metric-value positive">${data.apr.toFixed(2)}%</div>
              </div>
              <div class="metric">
                <div class="metric-label">💵 Fee / Hari</div>
                <div class="metric-value">${formatPreciseUSD(data.dailyFee)}</div>
              </div>
              <div class="metric">
                <div class="metric-label">💵 Fee / Minggu</div>
                <div class="metric-value">${formatPreciseUSD(data.weeklyFee)}</div>
              </div>
              <div class="metric">
                <div class="metric-label">💵 Fee / Bulan</div>
                <div class="metric-value">${formatPreciseUSD(data.monthlyFee)}</div>
              </div>
              <div class="metric">
                <div class="metric-label">💵 Fee / Tahun</div>
                <div class="metric-value">${formatUSD(data.yearlyFee)}</div>
              </div>
              <div class="metric">
                <div class="metric-label">🏛️ Protocol Cut</div>
                <div class="metric-value">${(data.protocolFeeShareBps / 100).toFixed(2)}%</div>
              </div>
              <div class="metric">
                <div class="metric-label">⛽ Estimasi Gas Entry + Exit</div>
                <div class="metric-value negative">${formatUSD(data.totalLifecycleGasUsd)}</div>
              </div>
            </div>
            <div class="refresh-info" style="margin-top: 12px;">${data.assumptions.map(assumption => escapeHTML(assumption)).join(' · ')}</div>
          </div>

          <div class="card" style="margin-top: 15px;">
            <h3>💧 IL Scenarios — Fee ${data.feePeriodDays} Hari + Estimasi Gas</h3>
            <table class="il-table">
              <thead>
                <tr>
                  <th>Skenario</th>
                  <th>Harga BNB</th>
                  <th>Hold Value</th>
                  <th>LP + Fee</th>
                  <th>IL %</th>
                  <th>P/L vs Modal</th>
                  <th>Selisih vs HOLD</th>
                </tr>
              </thead>
              <tbody>
                ${data.ilScenarios
                  .map(
                    s => `
                  <tr>
                    <td>${s.scenario}</td>
                    <td>$${s.newPrice.toFixed(0)}</td>
                    <td>${formatUSD(s.holdValue)}</td>
                    <td>${formatUSD(s.lpValueAfterFee)}</td>
                    <td class="${s.ilPercent > 5 ? 'negative' : ''}">${s.ilPercent.toFixed(2)}%</td>
                    <td class="${s.profitLossVsInvestment >= 0 ? 'positive' : 'negative'}">${formatSignedUSD(s.profitLossVsInvestment)}</td>
                    <td class="${s.differenceVsHold >= 0 ? 'positive' : 'negative'}">${formatSignedUSD(s.differenceVsHold)}</td>
                  </tr>
                `
                  )
                  .join('')}
              </tbody>
            </table>
          </div>
        `;
    } catch (error) {
      resultDiv.innerHTML = `<div class="error">❌ Error: ${error.message}</div>`;
    }
  }

  // ============================================
  // 📌 Calculate IL
  // ============================================

  async function calculateIL() {
    const from = document.getElementById('ilFrom').value;
    const to = document.getElementById('ilTo').value;
    const invest = document.getElementById('ilInvest').value;

    const resultDiv = document.getElementById('ilResult');
    resultDiv.innerHTML = '<div class="loading">Menghitung...</div>';

    try {
      const data = await fetchApi(`/api/il?from=${from}&to=${to}&invest=${invest}`);

      resultDiv.innerHTML = `
          <div class="summary-box">
            <h4>💧 Hasil Perhitungan IL</h4>
            <div class="metrics-grid">
              <div class="metric">
                <div class="metric-label">Harga Awal</div>
                <div class="metric-value">$${parseFloat(data.initialPrice).toLocaleString()}</div>
              </div>
              <div class="metric">
                <div class="metric-label">Harga Baru</div>
                <div class="metric-value">$${parseFloat(data.currentPrice).toLocaleString()}</div>
              </div>
              <div class="metric">
                <div class="metric-label">Price Ratio</div>
                <div class="metric-value">${data.priceRatio.toFixed(2)}x</div>
              </div>
              <div class="metric">
                <div class="metric-label">IL Persen</div>
                <div class="metric-value negative">${data.ilPercent.toFixed(2)}%</div>
              </div>
              <div class="metric">
                <div class="metric-label">💰 Jika HOLD</div>
                <div class="metric-value positive">$${data.holdValue.toFixed(2)}</div>
              </div>
              <div class="metric">
                <div class="metric-label">💧 Jika LP</div>
                <div class="metric-value ${data.isProfit ? 'positive' : 'negative'}">$${data.lpValue.toFixed(2)}</div>
              </div>
            </div>
          </div>
        `;
    } catch (error) {
      resultDiv.innerHTML = `<div class="error">❌ Error: ${error.message}</div>`;
    }
  }

  return { renderLatestAnalysis, runLPAnalysis, runSimulation, calculateIL };
})();
