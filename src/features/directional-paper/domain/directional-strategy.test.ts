import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEFAULT_DIRECTIONAL_CONFIG,
  entryFillPrice,
  exitFillPrice,
  makeDirectionalSignal,
  positionLevels,
  rawPositionPnl,
  type DirectionalStrategyConfig,
  validateDirectionalConfig,
} from './directional-strategy.js';

const TEST_CONFIG: DirectionalStrategyConfig = {
  ...DEFAULT_DIRECTIONAL_CONFIG,
  minimumHistoryPoints: 20,
  fastEmaPoints: 3,
  slowEmaPoints: 10,
  shortMomentumPoints: 5,
  longMomentumPoints: 10,
  volatilityPoints: 10,
  minimumShortMomentum: 0.0002,
  minimumLongMomentum: 0.001,
  minimumTrendGap: 0.0001,
};

function trendingPrices(direction: 1 | -1, count = 38): number[] {
  let price = 100;
  return Array.from({ length: count }, (_, index) => {
    const upwardPattern = index % 5 < 3 ? 0.002 : -0.0015;
    price *= 1 + direction * upwardPattern;
    return price;
  });
}

test('directional strategy waits for enough minute history', () => {
  const signal = makeDirectionalSignal([100, 101], TEST_CONFIG);
  assert.equal(signal.action, 'WAIT');
  assert.equal(signal.reasonCode, 'HISTORY_INSUFFICIENT');
});

test('directional strategy validates the max drawdown halt threshold', () => {
  assert.throws(
    () => validateDirectionalConfig({ ...TEST_CONFIG, maxDrawdownHaltPercent: -1 }),
    /max drawdown halt percent/
  );
  assert.doesNotThrow(() => validateDirectionalConfig({ ...TEST_CONFIG, maxDrawdownHaltPercent: 0 }));
  assert.doesNotThrow(() => validateDirectionalConfig({ ...TEST_CONFIG, maxDrawdownHaltPercent: 25 }));
});

test('directional strategy defaults enable SHORT and disable the drawdown halt', () => {
  assert.equal(DEFAULT_DIRECTIONAL_CONFIG.shortEnabled, true);
  assert.equal(DEFAULT_DIRECTIONAL_CONFIG.maxDrawdownHaltPercent, 0);
});

test('directional strategy detects confirmed long and short momentum', () => {
  const long = makeDirectionalSignal(trendingPrices(1), TEST_CONFIG);
  const short = makeDirectionalSignal(trendingPrices(-1), TEST_CONFIG);

  assert.equal(long.action, 'ENTER_LONG');
  assert.equal(short.action, 'ENTER_SHORT');
  assert.ok(long.confidence >= 0.45);
  assert.ok(short.confidence >= 0.45);
  assert.ok((long.features.stopDistance ?? 0) >= TEST_CONFIG.minimumStopDistance);
});

test('directional fills, levels, and PnL are adverse-cost aware', () => {
  const longEntry = entryFillPrice('LONG', 100, 2);
  const longExit = exitFillPrice('LONG', 102, 2);
  const shortEntry = entryFillPrice('SHORT', 100, 2);
  const shortExit = exitFillPrice('SHORT', 98, 2);
  assert.ok(longEntry > 100);
  assert.ok(longExit < 102);
  assert.ok(shortEntry < 100);
  assert.ok(shortExit > 98);
  assert.ok(rawPositionPnl('LONG', longEntry, longExit, 1) > 0);
  assert.ok(rawPositionPnl('SHORT', shortEntry, shortExit, 1) > 0);

  const levels = positionLevels({
    side: 'LONG',
    entryPrice: 100,
    stopDistance: 0.01,
    leverage: 5,
    maintenanceMarginRate: 0.005,
    rewardRiskRatio: 2,
  });
  assert.equal(levels.stopLossPrice, 99);
  assert.equal(levels.takeProfitPrice, 102);
  assert.equal(levels.liquidationPrice, 80.5);
});
