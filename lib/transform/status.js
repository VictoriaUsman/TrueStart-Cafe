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
  if (isInProvenCampaign(campaignName)) return 'PROVEN';
  if (spend < MIN_MEANINGFUL_SPEND) return 'STARVED';
  return purchases >= PROVEN_PURCHASE_THRESHOLD ? 'PROVEN' : 'TESTING';
}

module.exports = { getCreativeStatus, isInProvenCampaign, PROVEN_PURCHASE_THRESHOLD };
