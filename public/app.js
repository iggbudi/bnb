'use strict';

window.BnbDashboard = window.BnbDashboard || {};
window.BnbDashboard.app = (() => {
  let overviewTimer = null;
  let featureTimer = null;
  const tabListeners = [];
  const moreListeners = [];

  function refreshActiveFeature(tabName) {
    if (tabName === 'agent') void window.BnbDashboard.paperAgent.loadAgentDashboard();
    if (tabName === 'directional') void window.BnbDashboard.directionalPaper.loadDirectionalDashboard();
    if (tabName === 'position') void window.BnbDashboard.execution.loadPositionDashboard();
    if (tabName === 'learn') void window.BnbDashboard.learning.loadLearningLifecycleStatus();
  }

  function exposeInlineHandlers() {
    window.loadHistoryDashboard = window.BnbDashboard.marketData.loadHistoryDashboard;
    window.loadAgentDashboard = window.BnbDashboard.paperAgent.loadAgentDashboard;
    window.loadDirectionalDashboard = window.BnbDashboard.directionalPaper.loadDirectionalDashboard;
    window.loadPositionDashboard = window.BnbDashboard.execution.loadPositionDashboard;
    window.runLPAnalysis = window.BnbDashboard.lpAnalysis.runLPAnalysis;
    window.runSimulation = window.BnbDashboard.lpAnalysis.runSimulation;
    window.calculateIL = window.BnbDashboard.lpAnalysis.calculateIL;
  }

  function init() {
    exposeInlineHandlers();

    const morePanel = document.getElementById('tab-more-panel');
    const moreToggle = document.querySelector('.tab-more-toggle');
    const moreLabelSpan = moreToggle ? moreToggle.querySelector('span') : null;

    function syncMoreLabel() {
      if (!moreToggle || !morePanel || !moreLabelSpan) return;
      const activeUtility = morePanel.querySelector('.tab.active');
      moreLabelSpan.textContent = activeUtility ? `${activeUtility.dataset.moreLabel || ''} ▾` : 'Lainnya';
    }

    document.querySelectorAll('.tab').forEach(tab => {
      if (!tab.dataset.tab) return; // tombol ⋯ Lainnya bukan tab konten
      const listener = () => {
        document.querySelectorAll('.tab').forEach(item => item.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));
        tab.classList.add('active');
        document.getElementById(`tab-${tab.dataset.tab}`).classList.add('active');
        refreshActiveFeature(tab.dataset.tab);
        if (morePanel && moreToggle) {
          if (morePanel.contains(tab)) morePanel.hidden = true;
          moreToggle.setAttribute('aria-expanded', 'false');
          syncMoreLabel();
        }
      };
      tab.addEventListener('click', listener);
      tabListeners.push({ tab, listener });
    });

    if (moreToggle && morePanel) {
      const toggleHandler = event => {
        event.stopPropagation();
        morePanel.hidden = !morePanel.hidden;
        moreToggle.setAttribute('aria-expanded', String(!morePanel.hidden));
      };
      const outsideHandler = event => {
        if (!morePanel.hidden && !morePanel.contains(event.target) && event.target !== moreToggle) {
          morePanel.hidden = true;
          moreToggle.setAttribute('aria-expanded', 'false');
        }
      };
      moreToggle.addEventListener('click', toggleHandler);
      document.addEventListener('click', outsideHandler);
      moreListeners.push({ toggle: moreToggle, toggleHandler, outsideHandler });
      syncMoreLabel();
    }

    void window.BnbDashboard.marketData.loadOverview();
    overviewTimer = setInterval(() => window.BnbDashboard.marketData.loadOverview(), 60 * 1000);
    featureTimer = setInterval(() => {
      refreshActiveFeature(document.querySelector('.tab.active')?.dataset.tab);
    }, 60 * 1000);
  }

  function dispose() {
    if (overviewTimer !== null) clearInterval(overviewTimer);
    if (featureTimer !== null) clearInterval(featureTimer);
    overviewTimer = null;
    featureTimer = null;
    for (const { tab, listener } of tabListeners) tab.removeEventListener('click', listener);
    tabListeners.length = 0;
    for (const { toggle, toggleHandler, outsideHandler } of moreListeners) {
      toggle.removeEventListener('click', toggleHandler);
      document.removeEventListener('click', outsideHandler);
    }
    moreListeners.length = 0;
  }

  return { init, dispose };
})();

window.BnbDashboard.app.init();
