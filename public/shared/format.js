'use strict';

window.BnbDashboard = window.BnbDashboard || {};
window.BnbDashboard.format = (() => {
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

  function formatAgentTime(value) {
    return value ? new Date(value).toLocaleString('id-ID') : '—';
  }

  return { formatUSD, formatPreciseUSD, formatPercent, formatSignedUSD, escapeHTML, formatAgentTime };
})();
