'use strict';

window.BnbDashboard = window.BnbDashboard || {};
window.BnbDashboard.learning = (() => {
  const { fetchApi } = window.BnbDashboard.api;
  const { formatUSD, formatPreciseUSD, formatPercent, formatSignedUSD, escapeHTML, formatAgentTime } =
    window.BnbDashboard.format;

  let learningLifecycleRequestId = 0;

  async function loadLearningLifecycleStatus() {
    const target = document.getElementById('learnLifecycleStatus');
    if (!target) return;
    const requestId = ++learningLifecycleRequestId;
    try {
      const [lifecycle, execution, aggressive] = await Promise.all([
        fetchApi('/api/lifecycle/activation'),
        fetchApi('/api/execution/status'),
        fetchApi('/api/agent/aggressive-performance'),
      ]);
      if (requestId !== learningLifecycleRequestId) return;
      const shadow = lifecycle.shadowValidation;
      const progress = Math.min(100, (shadow.elapsedHours / (shadow.targetDays * 24)) * 100);
      const waitingFor = [];
      if (shadow.blockers.includes('SHADOW_MINIMUM_14_DAYS_NOT_REACHED')) waitingFor.push('masa uji 14 hari');
      if (shadow.blockers.includes('NO_COMPLETED_14D_PAPER_POSITION'))
        waitingFor.push('satu posisi paper selesai 14 hari');
      if (shadow.blockers.includes('NO_VALID_14D_FINAL_EVALUATION'))
        waitingFor.push('evaluasi final yang valid');
      target.innerHTML = `
          <div class="agent-heading" style="margin-bottom: 10px;">
            <strong>Status full-range: ${escapeHTML(lifecycle.activation.mode.replaceAll('_', ' '))}</strong>
            <span class="outcome-badge ${aggressive.enabled ? 'outcome-correct' : 'outcome-pending'}">AGRESIF ${aggressive.enabled ? 'PAPER AKTIF' : 'NONAKTIF'}</span>
          </div>
          <div class="metrics-grid">
            <div class="metric"><div class="metric-label">Progress Uji Full-Range 14 Hari</div><div class="metric-value">${progress.toFixed(1)}%</div></div>
            <div class="metric"><div class="metric-label">Kelengkapan Data per Jam</div><div class="metric-value">${shadow.coveragePercent.toFixed(1)}%</div></div>
            <div class="metric"><div class="metric-label">Nilai Portfolio Agresif</div><div class="metric-value">${formatUSD(aggressive.performance.portfolioValueUsd)}</div></div>
            <div class="metric"><div class="metric-label">P&amp;L Agresif</div><div class="metric-value ${aggressive.performance.portfolioPnlUsd >= 0 ? 'positive' : 'negative'}">${formatSignedUSD(aggressive.performance.portfolioPnlUsd)}</div></div>
            <div class="metric"><div class="metric-label">Range / Aksi Agresif</div><div class="metric-value" style="font-size: 1rem;">${aggressive.performance.activePosition ? `±${aggressive.performance.activePosition.rangePercent.toFixed(2)}%` : 'NO POSITION'} · ${escapeHTML(aggressive.performance.latestAction?.action ?? 'BELUM ADA')}</div></div>
            <div class="metric"><div class="metric-label">Transaksi Live</div><div class="metric-value ${execution.ready ? 'positive' : 'negative'}">${execution.ready ? 'SIAP MANUAL FULL-RANGE' : 'TERKUNCI'}</div></div>
          </div>
          <div class="refresh-info">Target minimum ${escapeHTML(formatAgentTime(shadow.run.targetEndAt))}. ${waitingFor.length ? `Masih menunggu ${waitingFor.map(escapeHTML).join(', ')}.` : 'Semua syarat paper sudah terpenuhi.'}</div>
        `;
    } catch (error) {
      if (requestId === learningLifecycleRequestId) {
        target.innerHTML = `<span class="negative">Status lifecycle tidak tersedia: ${escapeHTML(error.message)}</span>`;
      }
    }
  }

  function updateLearningContent(price) {
    const priceElement = document.getElementById('learnCurrentPrice');
    const rangesElement = document.getElementById('learnRanges');
    if (!priceElement || !rangesElement || !Number.isFinite(price)) return;

    priceElement.textContent = formatUSD(price);
    const ranges = [
      { label: 'Lebar ±10%', percent: 10 },
      { label: 'Menengah ±5%', percent: 5 },
      { label: 'Sempit ±2%', percent: 2 },
    ];
    rangesElement.innerHTML = ranges
      .map(range => {
        const lower = price * (1 - range.percent / 100);
        const upper = price * (1 + range.percent / 100);
        return `<li><strong>${range.label}:</strong> ${formatUSD(lower)} – ${formatUSD(upper)}</li>`;
      })
      .join('');
  }

  return { loadLearningLifecycleStatus, updateLearningContent };
})();
