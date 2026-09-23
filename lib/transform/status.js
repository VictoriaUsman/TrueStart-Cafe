// lib/transform/status.js
const { getFunnelStage } = require('./stage');

const MIN_MEANINGFUL_SPEND = 1; // GBP; below this a creative is treated as STARVED

function getCreativeStatus({ campaignName, spend }) {
  const stage = getFunnelStage(campaignName);
  if (stage === 'TOF' || stage === 'MOF') return 'Feeder';
  if (spend < MIN_MEANINGFUL_SPEND) return 'STARVED';
  // Historical totals cannot establish current seven-day qualification.
  // The BOF rules evaluate that independently by Meta ad ID.
  return 'TESTING';
}

module.exports = { getCreativeStatus };
