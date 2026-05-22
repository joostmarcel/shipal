// Carrier codes are the numeric `key` field from 17Track's published carrier
// dataset: https://res.17track.net/asset/carrier/info/apicarrier.all.json
// (CSV variant: https://res.17track.net/asset/carrier/info/apicarrier.all.csv).
//
// This is a curated snapshot of the top global carriers for casual single-package
// lookups in chat — NOT the full ~2,100-carrier set. We resolve the carrier name
// only when the user explicitly names a carrier; otherwise 17Track auto-detects it.
//
// To extend: open the JSON above and copy the carrier's `key` value here. Do not
// guess codes — an incorrect carrier code makes lookups fail rather than help.
const CARRIER_CODES: Record<string, number> = {
  dhl: 100001,
  "dhl express": 100001,
  "dhl paket": 7041,
  "deutsche post": 7044,
  ups: 100002,
  "united parcel service": 100002,
  fedex: 100003,
  "federal express": 100003,
  usps: 21051,
  "us postal": 21051,
  "us postal service": 21051,
  "united states postal service": 21051,
  "royal mail": 11031,
  dpd: 100007,
  gls: 100005,
  hermes: 100331,
  evri: 100331,
  myhermes: 100331,
  "china post": 3011,
  "china ems": 3013,
  ems: 3013,
  "japan post": 10021,
  "australia post": 1151,
  auspost: 1151,
  "canada post": 3041,
  postnl: 14041,
  "la poste": 6051,
  colissimo: 6051,
  "sf express": 100012,
  sf: 100012,
  shunfeng: 100012,
  aramex: 100006,
  tnt: 100004,
  // TODO(sourcing): 4PX, YunExpress, Yanwen, Cainiao — codes not yet confirmed from
  // apicarrier.all.json. Add their numeric `key` before advertising support; do not guess.
};

function normalize(raw: string): string {
  return raw
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "") // strip diacritics
    .toLowerCase()
    .replace(/[._\-/]/g, " ")
    .replace(/[^a-z0-9 ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Resolve an LLM-supplied carrier name/alias to a 17Track numeric carrier code.
 * Returns null when the input is empty or not in the curated map — callers fall
 * back to 17Track's auto-detection in that case.
 */
export function resolveCarrier(raw: string | undefined | null): number | null {
  if (!raw) return null;
  const key = normalize(raw);
  if (!key) return null;
  return CARRIER_CODES[key] ?? null;
}
