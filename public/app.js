'use strict';

window.BnbDashboard = window.BnbDashboard || {};
window.BnbDashboard.app = (() => {
  let overviewTimer = null;
  let featureTimer = null;
  const tabListeners = [];

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
    document.querySelectorAll('.tab').forEach(tab => {
      const listener = () => {
        document.querySelectorAll('.tab').forEach(item => item.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));
        tab.classList.add('active');
        document.getElementById(`tab-${tab.dataset.tab}`).classList.add('active');
        refreshActiveFeature(tab.dataset.tab);
      };
      tab.addEventListener('click', listener);
      tabListeners.push({ tab, listener });
    });

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
  }

  return { init, dispose };
})();

window.BnbDashboard.app.init();
