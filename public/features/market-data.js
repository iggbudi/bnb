'use strict';

window.BnbDashboard = window.BnbDashboard || {};
window.BnbDashboard.marketData = (() => {
  const { fetchApi } = window.BnbDashboard.api;
  const { formatUSD, formatPreciseUSD, formatPercent, formatSignedUSD, escapeHTML, formatAgentTime } =
    window.BnbDashboard.format;

  // ============================================
  // 📌 Load Overview
  // ============================================

  let hasOverviewData = false;
  let selectedHistoryHours = 24;
  let historyRequestId = 0;

  async function loadOverview() {
    try {
      const data = await fetchApi('/api/wbnbusdt');

      // Update price display
      document.getElementById('priceMain').textContent = `$${data.price.toLocaleString()}`;
      document.getElementById('priceChange').innerHTML = `
          <span class="change-item ${data.priceChange1h >= 0 ? 'change-positive' : 'change-negative'}">
            1h: ${formatPercent(data.priceChange1h)}
          </span>
          <span class="change-item ${data.priceChange6h >= 0 ? 'change-positive' : 'change-negative'}">
            6h: ${formatPercent(data.priceChange6h)}
          </span>
          <span class="change-item ${data.priceChange24h >= 0 ? 'change-positive' : 'change-negative'}">
            24h: ${formatPercent(data.priceChange24h)}
          </span>
        `;
      document.getElementById('lastUpdate').textContent = `Last update: ${new Date().toLocaleTimeString()}`;
      window.BnbDashboard.learning.updateLearningContent(data.price);
      hasOverviewData = true;

      // Render overview
      document.getElementById('overviewContent').innerHTML = `
          <div class="card">
            <h3>📊 Pool Metrics</h3>
            <div class="metrics-grid">
              <div class="metric">
                <div class="metric-label">💰 TVL (Total Value Locked)</div>
                <div class="metric-value">${formatUSD(data.tvl)}</div>
              </div>
              <div class="metric">
                <div class="metric-label">📈 Volume 24h</div>
                <div class="metric-value">${formatUSD(data.volume24h)}</div>
              </div>
              <div class="metric">
                <div class="metric-label">📊 Vol/Liq Ratio</div>
                <div class="metric-value ${data.volLiqRatio > 1 ? 'positive' : ''}">${data.volLiqRatio.toFixed(2)}x</div>
              </div>
              <div class="metric">
                <div class="metric-label">💧 Est. Fee 24h</div>
                <div class="metric-value">${formatUSD(data.estimatedFees24h)}</div>
              </div>
              <div class="metric">
                <div class="metric-label">🎯 Est. APR</div>
                <div class="metric-value ${data.estimatedAPR > 30 ? 'positive' : 'warning'}">${data.estimatedAPR.toFixed(2)}%</div>
              </div>
              <div class="metric">
                <div class="metric-label">🔄 Txns 24h</div>
                <div class="metric-value">${data.txns24h.buys + data.txns24h.sells}</div>
              </div>
            </div>
          </div>

          <div class="card">
            <h3>💧 Pool Composition</h3>
            <div class="metrics-grid">
              <div class="metric">
                <div class="metric-label">🟡 WBNB in Pool</div>
                <div class="metric-value" style="color: var(--bnb-color)">${data.wbnbInPool.toLocaleString()} WBNB</div>
              </div>
              <div class="metric">
                <div class="metric-label">💵 USDT in Pool</div>
                <div class="metric-value" style="color: var(--usdt-color)">${formatUSD(data.usdtInPool)}</div>
              </div>
            </div>
          </div>

          <div class="card">
            <h3>📍 Pool Info</h3>
            <div style="font-size: 0.9rem; color: var(--text-secondary);">
              <p>
                <strong>Pair Address:</strong>
                <a class="address-link" href="https://bscscan.com/address/${encodeURIComponent(data.pairAddress)}" target="_blank" rel="noopener noreferrer" title="Buka contract pool di BscScan">
                  ${escapeHTML(data.pairAddress)} ↗
                </a>
              </p>
              <p><strong>Fee Tier:</strong> 0.01%</p>
              <p><strong>DEX:</strong> PancakeSwap V3</p>
              <p><strong>Chain:</strong> BNB Smart Chain</p>
              <div class="pool-links">
                <a class="address-link" href="https://dexscreener.com/bsc/${encodeURIComponent(data.pairAddress)}" target="_blank" rel="noopener noreferrer">Lihat di DexScreener ↗</a>
                <a class="address-link" href="https://pancakeswap.finance/info/v3/bsc/pairs/${encodeURIComponent(data.pairAddress)}" target="_blank" rel="noopener noreferrer">Lihat di PancakeSwap ↗</a>
              </div>
            </div>
          </div>

          <div class="card">
            <h3>⛓️ PancakeSwap V3 On-chain State</h3>
            <div id="onchainDashboard"><div class="loading">Membaca contract pool BSC...</div></div>
          </div>

          <div class="card">
            <h3>📈 Historical Pool Data</h3>
            <div class="history-controls">
              <button class="history-range" data-hours="1" onclick="loadHistoryDashboard(1)">1 Jam</button>
              <button class="history-range" data-hours="24" onclick="loadHistoryDashboard(24)">24 Jam</button>
              <button class="history-range" data-hours="168" onclick="loadHistoryDashboard(168)">7 Hari</button>
              <button class="history-range" data-hours="720" onclick="loadHistoryDashboard(720)">30 Hari</button>
            </div>
            <div id="historyDashboard"><div class="loading">Memuat histori SQLite...</div></div>
          </div>

          <div class="card">
            <div class="ai-heading">
              <div>
                <h3 style="border: 0; margin: 0; padding: 0;">🤖 AI LP Feasibility Analysis</h3>
                <div class="metric-label">GPT-5.6 Sol · reasoning medium · cache 15 menit</div>
              </div>
              <button id="aiAnalysisButton" class="btn" onclick="runLPAnalysis()">Analisis dengan AI</button>
            </div>
            <div class="info-box">
              AI menginterpretasikan metrik pool dan skenario IL. Hasil bersifat edukatif, bukan rekomendasi investasi.
            </div>
            <div id="aiAnalysisResult"></div>
          </div>
        `;

      window.BnbDashboard.lpAnalysis.renderLatestAnalysis();
      void loadOnchainDashboard();
      void loadHistoryDashboard(selectedHistoryHours);
    } catch (error) {
      if (hasOverviewData) {
        document.getElementById('lastUpdate').textContent = `Refresh gagal: ${error.message}`;
        return;
      }
      document.getElementById('overviewContent').innerHTML = `
          <div class="error">❌ Error: ${error.message}</div>
        `;
    }
  }

  // ============================================
  // 📌 PancakeSwap V3 On-chain Dashboard
  // ============================================

  function formatBigInteger(value) {
    try {
      return BigInt(value).toLocaleString('id-ID');
    } catch {
      return escapeHTML(value);
    }
  }

  function shortenInteger(value) {
    const text = String(value);
    return text.length > 22 ? `${text.slice(0, 10)}…${text.slice(-8)}` : text;
  }

  async function loadOnchainDashboard() {
    const dashboard = document.getElementById('onchainDashboard');
    if (!dashboard) return;

    try {
      const data = await fetchApi('/api/onchain/pool');
      const rangeRows = data.ranges
        .map(
          range => `
          <tr>
            <td>±${range.percent}%</td>
            <td>${range.tickLower}</td>
            <td>${range.tickUpper}</td>
            <td>${formatUSD(range.priceLowerUsd)}</td>
            <td>${formatUSD(range.priceUpperUsd)}</td>
            <td><span class="outcome-badge ${range.inRange ? 'outcome-correct' : 'outcome-wrong'}">${range.inRange ? 'IN RANGE' : 'OUT OF RANGE'}</span></td>
            <td>${range.boundaryCheckpointMode === 'existing_ticks' ? 'Existing ticks' : 'Hypothetical init'}</td>
          </tr>
        `
        )
        .join('');
      const delta = data.historyDelta;

      dashboard.innerHTML = `
          <div class="metrics-grid">
            <div class="metric">
              <div class="metric-label">Block BSC</div>
              <div class="metric-value">${data.blockNumber.toLocaleString()}</div>
            </div>
            <div class="metric">
              <div class="metric-label">Current Tick</div>
              <div class="metric-value">${data.currentTick}</div>
            </div>
            <div class="metric">
              <div class="metric-label">Tick Spacing</div>
              <div class="metric-value">${data.tickSpacing}</div>
            </div>
            <div class="metric">
              <div class="metric-label">Fee Contract</div>
              <div class="metric-value">${data.feePercent.toFixed(2)}%</div>
            </div>
            <div class="metric">
              <div class="metric-label">Harga WBNB dari Tick</div>
              <div class="metric-value">${formatUSD(data.priceWbnbUsd)}</div>
            </div>
            <div class="metric">
              <div class="metric-label">Active Liquidity</div>
              <div class="metric-value" title="${escapeHTML(data.activeLiquidity)}" style="font-size: 1rem;">${escapeHTML(shortenInteger(data.activeLiquidity))}</div>
            </div>
          </div>

          <div class="table-scroll" style="margin-top: 15px;">
            <table class="il-table latest-data-table">
              <thead><tr><th>Range</th><th>Tick Lower</th><th>Tick Upper</th><th>Harga Lower</th><th>Harga Upper</th><th>Status</th><th>Checkpoint</th></tr></thead>
              <tbody>${rangeRows}</tbody>
            </table>
          </div>

          <div class="metrics-grid" style="margin-top: 15px;">
            <div class="metric">
              <div class="metric-label">Fee Growth Global USDT X128</div>
              <div class="metric-value" title="${escapeHTML(data.feeGrowthGlobal0X128)}" style="font-size: 1rem;">${escapeHTML(shortenInteger(data.feeGrowthGlobal0X128))}</div>
            </div>
            <div class="metric">
              <div class="metric-label">Fee Growth Global WBNB X128</div>
              <div class="metric-value" title="${escapeHTML(data.feeGrowthGlobal1X128)}" style="font-size: 1rem;">${escapeHTML(shortenInteger(data.feeGrowthGlobal1X128))}</div>
            </div>
            <div class="metric">
              <div class="metric-label">Gas Price</div>
              <div class="metric-value">${data.gas.gasPriceGwei.toFixed(3)} Gwei</div>
            </div>
            <div class="metric">
              <div class="metric-label">Est. Gas Mint</div>
              <div class="metric-value">${formatUSD(data.gas.estimatedMintCostUsd)}</div>
            </div>
            <div class="metric">
              <div class="metric-label">Est. Gas Rebalance</div>
              <div class="metric-value">${formatUSD(data.gas.estimatedRebalanceCostUsd)}</div>
            </div>
            <div class="metric">
              <div class="metric-label">Snapshot On-chain</div>
              <div class="metric-value">${data.storedSnapshots}</div>
            </div>
          </div>

          <div class="info-box" style="margin-top: 15px; margin-bottom: 0;">
            Token0 ${escapeHTML(data.token0Symbol)} (${data.token0Decimals} desimal), Token1 ${escapeHTML(data.token1Symbol)} (${data.token1Decimals} desimal). ${
              delta
                ? `Delta sejak block ${delta.previousBlockNumber}: USDT/liquidity ${Number(delta.token0PerLiquidity).toExponential(3)}, WBNB/liquidity ${Number(delta.token1PerLiquidity).toExponential(3)}.`
                : 'Menunggu snapshot kedua untuk menghitung delta fee growth.'
            }
            Gas memakai asumsi ${data.gas.assumedMintGasUnits.toLocaleString()} unit untuk mint dan ${data.gas.assumedRebalanceGasUnits.toLocaleString()} unit untuk rebalance, bukan estimasi transaksi siap-kirim.
          </div>
          <div class="refresh-info">Block time ${escapeHTML(formatAgentTime(data.blockTimestamp))} · read-only RPC · fee growth range adalah checkpoint, bukan fee yang sudah dimiliki.</div>
        `;
    } catch (error) {
      dashboard.innerHTML = `<div class="error">❌ Data on-chain tidak tersedia: ${escapeHTML(error.message)}</div>`;
    }
  }

  // ============================================
  // 📌 Historical Data Dashboard
  // ============================================

  function buildLineChart(points, key, color, formatter) {
    if (!points.length) return '<div class="info-box">Belum ada data untuk periode ini.</div>';

    const width = 640;
    const height = 180;
    const padding = 24;
    const values = points.map(point => Number(point[key])).filter(Number.isFinite);
    const min = Math.min(...values);
    const max = Math.max(...values);
    const range = max - min || 1;
    const coordinates = points
      .map((point, index) => {
        const x = padding + (index / Math.max(1, points.length - 1)) * (width - padding * 2);
        const y = height - padding - ((Number(point[key]) - min) / range) * (height - padding * 2);
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(' ');

    return `
        <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Grafik ${escapeHTML(key)}">
          <line x1="${padding}" y1="${padding}" x2="${padding}" y2="${height - padding}" stroke="var(--border)" />
          <line x1="${padding}" y1="${height - padding}" x2="${width - padding}" y2="${height - padding}" stroke="var(--border)" />
          <polyline points="${coordinates}" fill="none" stroke="${color}" stroke-width="3" stroke-linejoin="round" stroke-linecap="round" />
          <text x="${padding + 4}" y="${padding - 7}" class="chart-label">Max ${escapeHTML(formatter(max))}</text>
          <text x="${padding + 4}" y="${height - 7}" class="chart-label">Min ${escapeHTML(formatter(min))}</text>
        </svg>
      `;
  }

  async function loadHistoryDashboard(hours = selectedHistoryHours) {
    selectedHistoryHours = hours;
    const requestId = ++historyRequestId;
    document.querySelectorAll('.history-range').forEach(button => {
      button.classList.toggle('active', Number(button.dataset.hours) === hours);
    });

    const dashboard = document.getElementById('historyDashboard');
    if (!dashboard) return;
    dashboard.innerHTML = '<div class="loading">Membaca histori SQLite...</div>';

    try {
      const [chart, stats, latestHistory] = await Promise.all([
        fetchApi(`/api/history/chart?hours=${hours}&points=240`),
        fetchApi('/api/history/stats'),
        fetchApi('/api/history?hours=720&limit=5'),
      ]);
      if (requestId !== historyRequestId) return;

      const labelByHours = { 1: '1h', 24: '24h', 168: '7d', 720: '30d' };
      const period = stats.periods.find(item => item.label === labelByHours[hours]);
      const priceChange = period?.price.changePercent;
      const tvlChange = period?.tvl.changePercent;
      const historyCoverage = document.getElementById('learnHistoryCoverage');
      const sevenDayStats = stats.periods.find(item => item.label === '7d');
      if (historyCoverage && sevenDayStats) {
        historyCoverage.textContent =
          `${sevenDayStats.count.toLocaleString()} snapshot, coverage 7 hari ${sevenDayStats.coveragePercent.toFixed(1)}%. ` +
          (sevenDayStats.coveragePercent >= 80
            ? 'Syarat coverage entry sudah terpenuhi.'
            : 'Agent tetap WAIT sampai coverage mencapai 80%.');
      }

      const latestSnapshots = [...latestHistory.snapshots].reverse();
      const latestTable = latestSnapshots.length
        ? `
          <div class="table-scroll">
            <table class="il-table latest-data-table">
              <thead>
                <tr>
                  <th>Waktu Capture</th>
                  <th>Harga BNB</th>
                  <th>TVL</th>
                  <th>Volume 24h</th>
                  <th>Est. APR</th>
                  <th>Harga 1h</th>
                  <th>Harga 24h</th>
                </tr>
              </thead>
              <tbody>
                ${latestSnapshots
                  .map(
                    snapshot => `
                  <tr>
                    <td>${escapeHTML(new Date(snapshot.capturedAt).toLocaleString('id-ID'))}</td>
                    <td>${formatUSD(snapshot.price)}</td>
                    <td>${formatUSD(snapshot.tvl)}</td>
                    <td>${formatUSD(snapshot.volume24h)}</td>
                    <td>${snapshot.estimatedAPR.toFixed(2)}%</td>
                    <td class="${snapshot.priceChange1h >= 0 ? 'positive' : 'negative'}">${formatPercent(snapshot.priceChange1h)}</td>
                    <td class="${snapshot.priceChange24h >= 0 ? 'positive' : 'negative'}">${formatPercent(snapshot.priceChange24h)}</td>
                  </tr>
                `
                  )
                  .join('')}
              </tbody>
            </table>
          </div>
        `
        : '<div class="info-box">Belum ada data capture tersimpan.</div>';

      dashboard.innerHTML = `
          <h4 style="margin-bottom: 10px;">5 Data Capture Terakhir</h4>
          ${latestTable}
          <div class="metrics-grid" style="margin-top: 20px;">
            <div class="metric">
              <div class="metric-label">Total Snapshot Tersimpan</div>
              <div class="metric-value">${stats.totalRows.toLocaleString()}</div>
            </div>
            <div class="metric">
              <div class="metric-label">Coverage ${escapeHTML(period?.label || '')}</div>
              <div class="metric-value">${(period?.coveragePercent || 0).toFixed(1)}%</div>
            </div>
            <div class="metric">
              <div class="metric-label">Perubahan Harga</div>
              <div class="metric-value ${(priceChange || 0) >= 0 ? 'positive' : 'negative'}">${priceChange === null || priceChange === undefined ? 'N/A' : formatPercent(priceChange)}</div>
            </div>
            <div class="metric">
              <div class="metric-label">Perubahan TVL</div>
              <div class="metric-value ${(tvlChange || 0) >= 0 ? 'positive' : 'negative'}">${tvlChange === null || tvlChange === undefined ? 'N/A' : formatPercent(tvlChange)}</div>
            </div>
            <div class="metric">
              <div class="metric-label">Rata-rata Volume 24h</div>
              <div class="metric-value">${period?.volume24h.average == null ? 'N/A' : formatUSD(period.volume24h.average)}</div>
            </div>
            <div class="metric">
              <div class="metric-label">Rata-rata Est. APR</div>
              <div class="metric-value">${period?.estimatedAPR.average == null ? 'N/A' : `${period.estimatedAPR.average.toFixed(2)}%`}</div>
            </div>
          </div>
          <div class="chart-grid">
            <div class="chart-box">
              <h4>Harga BNB</h4>
              ${buildLineChart(chart.points, 'price', 'var(--bnb-color)', value => `$${value.toFixed(2)}`)}
            </div>
            <div class="chart-box">
              <h4>TVL</h4>
              ${buildLineChart(chart.points, 'tvl', 'var(--usdt-color)', formatUSD)}
            </div>
            <div class="chart-box">
              <h4>Estimasi APR</h4>
              ${buildLineChart(chart.points, 'estimatedAPR', 'var(--accent)', value => `${value.toFixed(2)}%`)}
            </div>
          </div>
          <div class="refresh-info">${chart.count} titik grafik · data lokal SQLite</div>
        `;
    } catch (error) {
      if (requestId === historyRequestId) {
        dashboard.innerHTML = `<div class="error">❌ ${escapeHTML(error.message)}</div>`;
      }
    }
  }

  return { loadOverview, loadOnchainDashboard, loadHistoryDashboard };
})();
