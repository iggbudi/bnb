'use strict';

window.BnbDashboard = window.BnbDashboard || {};
window.BnbDashboard.directionalPaper = (() => {
  const { fetchApi } = window.BnbDashboard.api;
  const { formatUSD, formatPreciseUSD, formatPercent, formatSignedUSD, escapeHTML, formatAgentTime } =
    window.BnbDashboard.format;

  // ============================================
  // 📌 Directional / Perpetual Paper Dashboard
  // ============================================

  let directionalRequestId = 0;

  function directionalActionBadge(action) {
    const classification =
      action === 'CLOSE'
        ? 'outcome-wrong'
        : action.startsWith('OPEN')
          ? 'outcome-pending'
          : 'outcome-correct';
    return `<span class="outcome-badge ${classification}">${escapeHTML(action.replaceAll('_', ' '))}</span>`;
  }

  // SVG mini-chart dua seri (ekuitas & harga) dinormalisasi ke rentangnya masing-masing.
  function equityCurveSvg(curve) {
    if (!curve || curve.length < 2) return null;
    const width = 760;
    const height = 180;
    const padX = 8;
    const padY = 16;
    const equities = curve.map(point => point.equityUsd);
    const prices = curve.map(point => point.priceUsd).filter(value => value !== null);
    const eqMin = Math.min(...equities);
    const eqMax = Math.max(...equities);
    const eqRange = eqMax - eqMin || 1;
    const prMin = prices.length ? Math.min(...prices) : 0;
    const prMax = prices.length ? Math.max(...prices) : 1;
    const prRange = prMax - prMin || 1;
    const x = index => padX + (index / (curve.length - 1)) * (width - padX * 2);
    const yEq = value => height - padY - ((value - eqMin) / eqRange) * (height - padY * 2);
    const yPr = value => height - padY - ((value - prMin) / prRange) * (height - padY * 2);
    const eqLine = curve
      .map((point, index) => `${x(index).toFixed(1)},${yEq(point.equityUsd).toFixed(1)}`)
      .join(' ');
    const prLine = curve
      .map((point, index) =>
        point.priceUsd === null ? null : `${x(index).toFixed(1)},${yPr(point.priceUsd).toFixed(1)}`
      )
      .filter(Boolean)
      .join(' ');
    const last = curve.at(-1);
    return `
      <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Kurva ekuitas dan harga forward" style="width:100%;height:auto;background:var(--surface,#101418);border-radius:10px;">
        <polyline points="${eqLine}" fill="none" stroke="var(--positive,#2bd576)" stroke-width="2" />
        ${prLine ? `<polyline points="${prLine}" fill="none" stroke="var(--accent,#f0b90b)" stroke-width="1.5" stroke-dasharray="4 3" />` : ''}
        <line x1="${padX}" y1="${height - padY}" x2="${width - padX}" y2="${height - padY}" stroke="#333" stroke-width="1" />
        <circle cx="${x(curve.length - 1).toFixed(1)}" cy="${yEq(last.equityUsd).toFixed(1)}" r="3" fill="var(--positive,#2bd576)" />
      </svg>
      <div class="metric-label" style="margin-top:8px;">
        <span style="color:var(--positive,#2bd576);">▬ Ekuitas</span> ·
        <span style="color:var(--accent,#f0b90b);">┅ Harga</span> ·
        nilai dinormalisasi 0–100%; <span class="negative">ekuitas akhir $${last.equityUsd.toFixed(2)}</span>
      </div>`;
  }

  async function loadDirectionalDashboard() {
    const target = document.getElementById('directionalDashboard');
    if (!target) return;
    const requestId = ++directionalRequestId;
    target.innerHTML = '<div class="loading">Membaca posisi, P&amp;L, dan keputusan directional...</div>';

    try {
      const data = await fetchApi('/api/agent/directional-performance');
      if (requestId !== directionalRequestId) return;
      const forward = data.forwardPerformance;
      const backtest = data.latestBacktestPerformance;
      const run = forward?.run ?? null;
      const position = forward?.activePosition ?? null;
      const evaluation = forward?.latestEvaluation ?? null;
      const latest = forward?.latestDecision ?? null;
      const forwardReturn = run ? (run.markEquityUsd / run.initialEquityUsd - 1) * 100 : null;
      const backtestReturn = backtest
        ? (backtest.run.markEquityUsd / backtest.run.initialEquityUsd - 1) * 100
        : null;

      const positionRows = (data.recentPositions ?? [])
        .map(
          item => `
          <tr>
            <td>#${item.id}</td>
            <td><span class="outcome-badge ${item.side === 'LONG' ? 'outcome-correct' : 'outcome-pending'}">${escapeHTML(item.side)}</span></td>
            <td>${escapeHTML(item.status)}</td>
            <td>${escapeHTML(formatAgentTime(item.openedAt))}</td>
            <td>${formatUSD(item.entryFillPrice)}</td>
            <td>${item.exitFillPrice === null ? '—' : formatUSD(item.exitFillPrice)}</td>
            <td class="${(item.realizedPnlUsd ?? item.unrealizedPnlUsd) >= 0 ? 'positive' : 'negative'}">${item.realizedPnlUsd === null ? formatSignedUSD(item.unrealizedPnlUsd) : formatSignedUSD(item.realizedPnlUsd)}</td>
            <td>${escapeHTML(item.closeReason ?? 'OPEN')}</td>
          </tr>
        `
        )
        .join('');
      const decisionRows = (data.recentDecisions ?? [])
        .slice(0, 50)
        .map(
          decision => `
          <tr>
            <td>${escapeHTML(formatAgentTime(decision.capturedAt))}</td>
            <td>${directionalActionBadge(decision.action)}</td>
            <td>${formatUSD(decision.priceUsd)}</td>
            <td>${(decision.confidence * 100).toFixed(1)}%</td>
            <td>${Number(decision.features.historyCoveragePercent ?? 0).toFixed(1)}%</td>
            <td>${escapeHTML(decision.reasonCode)}</td>
            <td>${escapeHTML(decision.rationale)}</td>
          </tr>
        `
        )
        .join('');

      target.innerHTML = `
      <div class="card">
        <div class="agent-heading">
          <div>
            <h3>📈 Perpetual Paper Trading</h3>
            <div class="metric-label">${escapeHTML(data.strategyVersion)} · long/short otomatis per menit · simulasi tanpa API key</div>
          </div>
          <span class="outcome-badge ${position ? 'outcome-pending' : 'outcome-correct'}">${position ? `${escapeHTML(position.side)} OPEN` : escapeHTML(latest?.action ?? 'WAIT')}</span>
        </div>
        <div class="metrics-grid">
          <div class="metric"><div class="metric-label">Modal Awal</div><div class="metric-value">${formatUSD(data.policy.initialCapitalUsd)}</div></div>
          <div class="metric"><div class="metric-label">Leverage / Margin</div><div class="metric-value">${data.policy.leverage.toFixed(1)}× / ${(data.policy.marginFraction * 100).toFixed(0)}%</div></div>
          <div class="metric"><div class="metric-label">Taker Fee / Slippage</div><div class="metric-value" style="font-size: 1rem;">${data.policy.takerFeeBps} / ${data.policy.slippageBps} bps</div></div>
          <div class="metric"><div class="metric-label">Eksekusi Live</div><div class="metric-value positive">NONAKTIF</div></div>
        </div>
        <div class="info-box" style="margin-top: 15px; margin-bottom: 0;">
          Agent menentukan long, short, TP, SL, trailing stop, dan close. Semua fill bersifat sintetis; tidak ada private key, signing, broadcast, atau order ke exchange.
        </div>
      </div>

      <div class="card">
        <div class="agent-heading">
          <h3>Forward Paper Portfolio</h3>
          <span class="outcome-badge ${run?.status === 'ACTIVE' ? 'outcome-correct' : 'outcome-pending'}">${escapeHTML(run?.status ?? 'BELUM MULAI')}</span>
        </div>
        <div class="metrics-grid">
          <div class="metric"><div class="metric-label">Equity</div><div class="metric-value ${forwardReturn !== null && forwardReturn >= 0 ? 'positive' : 'negative'}">${run ? formatUSD(run.markEquityUsd) : 'N/A'}</div></div>
          <div class="metric"><div class="metric-label">Return</div><div class="metric-value ${forwardReturn !== null && forwardReturn >= 0 ? 'positive' : 'negative'}">${forwardReturn === null ? 'N/A' : `${forwardReturn.toFixed(2)}%`}</div></div>
          <div class="metric"><div class="metric-label">Max Drawdown</div><div class="metric-value negative">${run ? `${run.maxDrawdownPercent.toFixed(2)}%` : 'N/A'}</div></div>
          <div class="metric"><div class="metric-label">Posisi Selesai</div><div class="metric-value">${forward?.completedPositions ?? 0}</div></div>
          <div class="metric"><div class="metric-label">Win Rate</div><div class="metric-value">${forward?.winRatePercent === null || forward?.winRatePercent === undefined ? 'N/A' : `${forward.winRatePercent.toFixed(1)}%`}</div></div>
          <div class="metric"><div class="metric-label">Total Fee</div><div class="metric-value negative">${forward ? formatPreciseUSD(forward.totalFeesUsd) : 'N/A'}</div></div>
          <div class="metric"><div class="metric-label">Avg Win / Avg Loss</div><div class="metric-value" style="font-size: 0.95rem;"><span class="positive">${forward?.avgWinUsd === null || forward?.avgWinUsd === undefined ? 'N/A' : formatSignedUSD(forward.avgWinUsd)}</span> / <span class="negative">${forward?.avgLossUsd === null || forward?.avgLossUsd === undefined ? 'N/A' : formatSignedUSD(forward.avgLossUsd)}</span></div></div>
          <div class="metric"><div class="metric-label">EV per Trade (net)</div><div class="metric-value ${(forward?.expectedValuePerTradeUsd ?? 0) >= 0 ? 'positive' : 'negative'}">${forward?.expectedValuePerTradeUsd === null || forward?.expectedValuePerTradeUsd === undefined ? 'N/A' : formatSignedUSD(forward.expectedValuePerTradeUsd)}</div></div>
          <div class="metric"><div class="metric-label">Avg Hold</div><div class="metric-value">${forward?.avgHoldHours === null || forward?.avgHoldHours === undefined ? 'N/A' : `${forward.avgHoldHours.toFixed(1)} jam`}</div></div>
          <div class="metric"><div class="metric-label">Aksi Terakhir</div><div class="metric-value" style="font-size: 1rem;">${escapeHTML(latest?.action ?? 'N/A')}</div></div>
          <div class="metric"><div class="metric-label">Diproses Sampai</div><div class="metric-value" style="font-size: 1rem;">${escapeHTML(formatAgentTime(run?.lastProcessedAt))}</div></div>
        </div>
      </div>

      <div class="card">
        <div class="agent-heading">
          <h3>Kurva Ekuitas Forward vs Harga</h3>
          <span class="outcome-badge ${forward?.expectedValuePerTradeUsd !== null && (forward?.expectedValuePerTradeUsd ?? 0) >= 0 ? 'outcome-correct' : 'outcome-wrong'}">EV ${forward?.expectedValuePerTradeUsd === null || forward?.expectedValuePerTradeUsd === undefined ? 'N/A' : formatSignedUSD(forward.expectedValuePerTradeUsd)}/trade</span>
        </div>
        ${equityCurveSvg(data.equityCurve ?? []) ?? '<div class="info-box">Belum ada data evaluasi mark-to-market untuk kurva ekuitas.</div>'}
        <div class="metric-label" style="margin-top:8px;">Mark-to-market hanya dicatat selama posisi terbuka; hari tanpa posisi tidak muncul. Equity dan harga dinormalisasi ke rentangnya masing-masing.</div>
      </div>

      <div class="card">
        <div class="agent-heading">
          <h3>Posisi Aktif</h3>
          ${position ? `<span class="outcome-badge ${position.side === 'LONG' ? 'outcome-correct' : 'outcome-pending'}">${escapeHTML(position.side)} ${position.leverage.toFixed(1)}×</span>` : '<span class="outcome-badge outcome-pending">NO POSITION</span>'}
        </div>
        ${
          position
            ? `
          <div class="metrics-grid">
            <div class="metric"><div class="metric-label">Notional / Margin</div><div class="metric-value">${formatUSD(position.notionalUsd)} / ${formatUSD(position.marginUsd)}</div></div>
            <div class="metric"><div class="metric-label">Entry / Mark</div><div class="metric-value" style="font-size: 1rem;">${formatUSD(position.entryFillPrice)} / ${formatUSD(evaluation?.markPriceUsd ?? position.signalPrice)}</div></div>
            <div class="metric"><div class="metric-label">Unrealized Net</div><div class="metric-value ${(evaluation?.netUnrealizedPnlUsd ?? position.unrealizedPnlUsd) >= 0 ? 'positive' : 'negative'}">${formatSignedUSD(evaluation?.netUnrealizedPnlUsd ?? position.unrealizedPnlUsd)}</div></div>
            <div class="metric"><div class="metric-label">Take Profit</div><div class="metric-value positive">${formatUSD(position.takeProfitPrice)}</div></div>
            <div class="metric"><div class="metric-label">Stop Loss</div><div class="metric-value negative">${formatUSD(position.stopLossPrice)}</div></div>
            <div class="metric"><div class="metric-label">Trailing Stop</div><div class="metric-value warning">${position.trailingStopPrice === null ? 'BELUM AKTIF' : formatUSD(position.trailingStopPrice)}</div></div>
            <div class="metric"><div class="metric-label">Liquidation Sintetis</div><div class="metric-value negative">${formatUSD(position.liquidationPrice)}</div></div>
            <div class="metric"><div class="metric-label">Dibuka</div><div class="metric-value" style="font-size: 1rem;">${escapeHTML(formatAgentTime(position.openedAt))}</div></div>
          </div>
        `
            : '<div class="info-box">Agent sedang menunggu momentum long/short yang memenuhi seluruh filter.</div>'
        }
      </div>

      <div class="card">
        <div class="agent-heading">
          <h3>Backtest Historis Terakhir</h3>
          <span class="outcome-badge ${backtestReturn !== null && backtestReturn >= 0 ? 'outcome-correct' : 'outcome-wrong'}">${backtestReturn === null ? 'BELUM ADA' : `${backtestReturn.toFixed(2)}%`}</span>
        </div>
        <div class="metrics-grid">
          <div class="metric"><div class="metric-label">Equity Akhir</div><div class="metric-value ${backtestReturn !== null && backtestReturn >= 0 ? 'positive' : 'negative'}">${backtest ? formatUSD(backtest.run.markEquityUsd) : 'N/A'}</div></div>
          <div class="metric"><div class="metric-label">Max Drawdown</div><div class="metric-value negative">${backtest ? `${backtest.run.maxDrawdownPercent.toFixed(2)}%` : 'N/A'}</div></div>
          <div class="metric"><div class="metric-label">Posisi / Win Rate</div><div class="metric-value">${backtest ? `${backtest.completedPositions} / ${backtest.winRatePercent?.toFixed(1) ?? 'N/A'}%` : 'N/A'}</div></div>
          <div class="metric"><div class="metric-label">Total Fee</div><div class="metric-value negative">${backtest ? formatUSD(backtest.totalFeesUsd) : 'N/A'}</div></div>
          <div class="metric"><div class="metric-label">Periode</div><div class="metric-value" style="font-size: 1rem;">${backtest ? `${escapeHTML(formatAgentTime(backtest.run.startedAt))} – ${escapeHTML(formatAgentTime(backtest.run.endedAt))}` : 'N/A'}</div></div>
        </div>
        <div class="error" style="margin-top: 15px; margin-bottom: 0;">
          Backtest adalah baseline evaluasi, bukan jaminan profit. Hasil negatif tetap ditampilkan dan tidak disembunyikan melalui tuning pada sampel yang sama.
        </div>
      </div>

      <div class="card">
        <h3>Riwayat Posisi Forward</h3>
        ${
          positionRows
            ? `<div class="table-scroll"><table class="il-table agent-table"><thead><tr><th>ID</th><th>Side</th><th>Status</th><th>Dibuka</th><th>Entry</th><th>Exit</th><th>P&amp;L</th><th>Alasan</th></tr></thead><tbody>${positionRows}</tbody></table></div>`
            : '<div class="info-box">Belum ada posisi forward.</div>'
        }
      </div>

      <div class="card">
        <h3>50 Keputusan Menit Terakhir</h3>
        ${
          decisionRows
            ? `<div class="table-scroll"><table class="il-table agent-table"><thead><tr><th>Waktu</th><th>Aksi</th><th>Harga</th><th>Confidence</th><th>Coverage</th><th>Kode</th><th>Alasan</th></tr></thead><tbody>${decisionRows}</tbody></table></div>`
            : '<div class="info-box">Belum ada keputusan directional.</div>'
        }
      </div>

      <div class="info-box">
        Sumber harga adalah sampled close pool WBNB/USDT per menit, bukan feed perpetual native. High/low intramenit, mark/index spread, order book, dan funding exchange belum tersedia; funding simulasi saat ini ${data.policy.fundingRate8h} per 8 jam.
      </div>
    `;
    } catch (error) {
      if (requestId === directionalRequestId) {
        target.innerHTML = `<div class="error">❌ ${escapeHTML(error.message)}</div>`;
      }
    }
  }

  return { loadDirectionalDashboard };
})();
