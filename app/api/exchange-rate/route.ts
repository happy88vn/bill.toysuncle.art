export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { XMLParser } from 'fast-xml-parser';

const VCB_URL = 'https://portal.vietcombank.com.vn/Usercontrols/TVPortal.TyGia/pXML.aspx';

// Cache rates for 30 minutes to avoid hammering VCB
let cachedRates: Record<string, number> | null = null;
let cacheTimestamp = 0;
const CACHE_TTL = 30 * 60 * 1000; // 30 minutes

async function fetchVCBRates(): Promise<Record<string, number>> {
  const now = Date.now();
  if (cachedRates && (now - cacheTimestamp) < CACHE_TTL) {
    return cachedRates;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);

  try {
    const res = await fetch(VCB_URL, { signal: controller.signal });
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
      // Use Transfer rate, clean commas before parsing
      const transferStr = (item.Transfer || item.Sell || '').toString().replace(/,/g, '');
      const rate = parseFloat(transferStr);
      if (code && !isNaN(rate) && rate > 0) {
        rates[code] = rate;
      }
    }

    cachedRates = rates;
    cacheTimestamp = now;
    return rates;
  } finally {
    clearTimeout(timeout);
  }
}

// Hardcoded fallback rates (approximate)
const FALLBACK_RATES: Record<string, number> = {
  VND: 1, USD: 25500, CNY: 3500, EUR: 27500, GBP: 32000, JPY: 170,
  AUD: 16500, CAD: 18500, CHF: 28000, DKK: 3700, HKD: 3250,
  INR: 305, KRW: 18.5, KWD: 82500, MYR: 5700, NOK: 2400,
  RUB: 280, SAR: 6800, SEK: 2450, SGD: 19000, THB: 720,
};

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const currency = request.nextUrl.searchParams.get('currency');
    const amount = parseFloat(request.nextUrl.searchParams.get('amount') || '0') || 0;

    let rates: Record<string, number>;
    let source = 'vietcombank';
    try {
      rates = await fetchVCBRates();
    } catch (err: any) {
      console.error('VCB rate fetch failed, using fallback:', err?.message);
      rates = FALLBACK_RATES;
      source = 'fallback';
    }

    if (currency && amount > 0) {
      // Single conversion
      const code = currency.toUpperCase();
      if (code === 'VND') {
        return NextResponse.json({ tongBillVnd: amount, rate: 1, source });
      }
      const rate = rates[code];
      if (!rate) {
        return NextResponse.json({ error: `Kh\u00f4ng t\u00ecm th\u1ea5y t\u1ef7 gi\u00e1 cho ${code}` }, { status: 400 });
      }
      const tongBillVnd = Math.round(amount * rate);
      return NextResponse.json({ tongBillVnd, rate, source });
    }

    // Return all rates
    return NextResponse.json({ rates, source });
  } catch (error: any) {
    console.error('Exchange rate error:', error);
    return NextResponse.json({ error: error?.message || 'L\u1ed7i l\u1ea5y t\u1ef7 gi\u00e1' }, { status: 500 });
  }
}
