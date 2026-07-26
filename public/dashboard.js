'use strict';

// ============================================
// 📌 Tab Navigation
// ============================================

document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    tab.classList.add('active');
    document.getElementById(`tab-${tab.dataset.tab}`).classList.add('active');
    if (tab.dataset.tab === 'agent') void loadAgentDashboard();
    if (tab.dataset.tab === 'directional') void loadDirectionalDashboard();
    if (tab.dataset.tab === 'position') void loadPositionDashboard();
    if (tab.dataset.tab === 'learn') void loadLearningLifecycleStatus();
  });
});

// ============================================
// 📌 Format Helpers
// ============================================

function formatUSD(value) {
  if (!Number.isFinite(value) || value === 0) return '$0';
  const sign = value < 0 ? '-' : '';
  const absolute = Math.abs(value);
  if (absolute >= 1e9) return `${sign}$${(absolute / 1e9).toFixed(2)}B`;
  if (absolute >= 1e6) return `${sign}$${(absolute / 1e6).toFixed(2)}M`;
  if (absolute >= 1e3) return `${sign}$${(absolute / 1e3).toFixed(2)}K`;
  return `${sign}$${absolute.toFixed(2)}`;
}

function formatPreciseUSD(value) {
  if (!Number.isFinite(value) || value === 0) return '$0';
  const absolute = Math.abs(value);
  if (absolute >= 0.01) return formatUSD(value);
  const sign = value < 0 ? '-' : '';
  return `${sign}$${absolute.toFixed(absolute >= 0.0001 ? 4 : 6)}`;
}

function formatPercent(value) {
  return `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`;
}

function formatSignedUSD(value) {
  if (!Number.isFinite(value)) return 'N/A';
  return `${value >= 0 ? '+' : '-'}$${Math.abs(value).toFixed(2)}`;
}

function escapeHTML(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

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

// ============================================
// 📌 Load Overview
// ============================================

let hasOverviewData = false;
let latestLPAnalysis = null;
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
    updateLearningContent(data.price);
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

    if (latestLPAnalysis) renderLPAnalysis(latestLPAnalysis);
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

// ============================================
// 📌 Paper Agent Dashboard
// ============================================

let selectedAgentHorizon = 24;
let agentRequestId = 0;

function formatAgentTime(value) {
  return value ? new Date(value).toLocaleString('id-ID') : '—';
}

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

// ============================================
// 📌 Directional / Perpetual Paper Dashboard
// ============================================

let directionalRequestId = 0;

function directionalActionBadge(action) {
  const classification =
    action === 'CLOSE' ? 'outcome-wrong' : action.startsWith('OPEN') ? 'outcome-pending' : 'outcome-correct';
  return `<span class="outcome-badge ${classification}">${escapeHTML(action.replaceAll('_', ' '))}</span>`;
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
          <div class="metric"><div class="metric-label">Aksi Terakhir</div><div class="metric-value" style="font-size: 1rem;">${escapeHTML(latest?.action ?? 'N/A')}</div></div>
          <div class="metric"><div class="metric-label">Diproses Sampai</div><div class="metric-value" style="font-size: 1rem;">${escapeHTML(formatAgentTime(run?.lastProcessedAt))}</div></div>
        </div>
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

// ============================================
// 📌 Init
// ============================================

loadOverview();

// Auto-refresh every 60 seconds
setInterval(loadOverview, 60 * 1000);
setInterval(() => {
  const activeTab = document.querySelector('.tab.active')?.dataset.tab;
  if (activeTab === 'agent') void loadAgentDashboard();
  if (activeTab === 'directional') void loadDirectionalDashboard();
  if (activeTab === 'position') void loadPositionDashboard();
  if (activeTab === 'learn') void loadLearningLifecycleStatus();
}, 60 * 1000);
