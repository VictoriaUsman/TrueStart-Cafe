// lib/transform/status.js
const { getFunnelStage } = require('./stage');

const MIN_MEANINGFUL_SPEND = 1; // GBP; below this a creative is treated as STARVED
const PROVEN_PURCHASE_THRESHOLD = 20;

function isInProvenCampaign(campaignName) {
  return /BOF-PROVEN/i.test(campaignName);
}

function getCreativeStatus({ campaignName, spend, purchases }) {
  const stage = getFunnelStage(campaignName);
  if (stage === 'TOF' || stage === 'MOF') return 'Feeder';
  if (spend < MIN_MEANINGFUL_SPEND) return 'STARVED';
  // Historical totals cannot establish current seven-day qualification.
  // The dedicated Proven snapshot evaluates that independently by Meta ad ID.
  return 'TESTING';
}

module.exports = { getCreativeStatus, isInProvenCampaign, PROVEN_PURCHASE_THRESHOLD };
