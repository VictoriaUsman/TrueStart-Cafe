// lib/transform/creative-parse.js

const PERSONAS = ['Upgrader', 'Loyal', 'Barista', 'Convenience', 'Ritual'];
const ANGLES = ['Price', 'Trust', 'Quality', 'Health', 'Social', 'Delivery', 'Faff', 'Cafe', 'Taste', 'Packaging', 'Caffeine'];
const PRODUCTS = ['Starter', 'Taster'];
const FORMATS = ['Bags', 'Instant', 'Beans', 'Ground', 'Concentrate'];

function findExact(token, list) {
  const trimmed = (token || '').trim();
  return list.find((v) => v.toLowerCase() === trimmed.toLowerCase()) || null;
}

function parseCreativeName(adName) {
  const tokens = adName.split('_');
  const personaIdx = tokens.findIndex((t) => findExact(t, PERSONAS));
  if (personaIdx === -1) {
    return { persona: 'Other', angle: 'Other', product: 'Other', format: 'Other' };
  }
  const persona = findExact(tokens[personaIdx], PERSONAS);
  const angle = findExact(tokens[personaIdx + 1] || '', ANGLES) || 'Other';
  const product = findExact(tokens[personaIdx + 2] || '', PRODUCTS) || 'Other';
  const rawFormat = (tokens[personaIdx + 3] || '').trim().split(' ')[0];
  const format = findExact(rawFormat, FORMATS) || 'Other';
  return { persona, angle, product, format };
}

module.exports = { parseCreativeName };
