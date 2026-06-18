import { XMLParser } from 'fast-xml-parser';

// Ti gia Vietcombank — dung chung cho process-images / ship-quocte.
const VCB_URL = 'https://portal.vietcombank.com.vn/Usercontrols/TVPortal.TyGia/pXML.aspx';
let cachedRates: Record<string, number> | null = null;
let cacheTimestamp = 0;
const CACHE_TTL = 30 * 60 * 1000;

export const FALLBACK_RATES: Record<string, number> = {
  VND: 1, USD: 25500, CNY: 3500, EUR: 27500, GBP: 32000, JPY: 170,
  AUD: 16500, CAD: 18500, CHF: 28000, DKK: 3700, HKD: 3250,
  INR: 305, KRW: 18.5, KWD: 82500, MYR: 5700, NOK: 2400,
  RUB: 280, SAR: 6800, SEK: 2450, SGD: 19000, THB: 720,
};

export async function getExchangeRates(): Promise<{ rates: Record<string, number>; source: string }> {
  const now = Date.now();
  if (cachedRates && (now - cacheTimestamp) < CACHE_TTL) {
    return { rates: cachedRates, source: 'vietcombank_cached' };
  }
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    const res = await fetch(VCB_URL, { signal: controller.signal });
    clearTimeout(timeout);
    if (!res.ok) throw new Error(`VCB API returned ${res.status}`);
    const xml = await res.text();
    const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '' });
    const json = parser.parse(xml);
    const exrateList = json?.ExrateList?.Exrate;
    if (!exrateList) throw new Error('Invalid VCB XML structure');
    const rates: Record<string, number> = { VND: 1 };
    const items = Array.isArray(exrateList) ? exrateList : [exrateList];
    for (const item of items) {
      const code = (item.CurrencyCode || '').trim();
      const transferStr = (item.Transfer || item.Sell || '').toString().replace(/,/g, '');
      const rate = parseFloat(transferStr);
      if (code && !isNaN(rate) && rate > 0) rates[code] = rate;
    }
    cachedRates = rates;
    cacheTimestamp = now;
    return { rates, source: 'vietcombank' };
  } catch (e: any) {
    console.error('VCB rate fetch error (using fallback):', e?.message);
    return { rates: FALLBACK_RATES, source: 'fallback' };
  }
}
