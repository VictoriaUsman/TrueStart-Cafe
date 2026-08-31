// lib/transform/stage.js

function getFunnelStage(campaignName) {
  if (/(?<![a-zA-Z])(TOF)(?![a-zA-Z])/i.test(campaignName)) return 'TOF';
  if (/(?<![a-zA-Z])(MOF)(?![a-zA-Z])/i.test(campaignName)) return 'MOF';
  if (/(?<![a-zA-Z])(BOF)(?![a-zA-Z])/i.test(campaignName)) return 'BOF';
  return 'Other';
}

module.exports = { getFunnelStage };
