const { fetchWindsorData } = require('./windsor');

const BOF_FIELDS = ['ad_id', 'ad_name', 'campaign', 'spend', 'actions_omni_purchase', 'action_values_omni_purchase'];

// Use the ad set's attribution setting, as in the standard Ads Manager view.
// https://windsor.ai/data-field/facebook/#options
// Keep both the daily snapshot and custom ranges on this same metric basis.
function fetchBofData(env, { dateFrom, dateTo }, extraFields = []) {
  if (!env.WINDSOR_API_KEY) throw new Error('Missing WINDSOR_API_KEY');
  return fetchWindsorData({
    apiKey: env.WINDSOR_API_KEY, connector: 'facebook', accountId: '732629205086',
    dateFrom, dateTo, fields: [...BOF_FIELDS, ...extraFields],
    useUnifiedAttributionSetting: true,
  });
}

module.exports = { fetchBofData };
