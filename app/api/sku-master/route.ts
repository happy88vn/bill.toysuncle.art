export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getGoogleAccessToken } from '@/lib/google-auth';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';

// SKU_Mua_Hang sheet inside the shared Google Sheets workbook
const SKU_SPREADSHEET_ID = '1AQuUFd1CtEC6nRS8tGBMRdmuZ6TuR_jLNEUmjXt135c';
const SKU_SHEET_TAB = 'SKU_Mua_Hang';

// Cache SKU list for 5 minutes
let cachedSkuList: { sku: string; moTa: string }[] | null = null;
let skuCacheTime = 0;
const SKU_CACHE_TTL = 5 * 60 * 1000;

/** GET: Read column A (SKU) and B (Haravan_Biến Thể) from SKU_Mua_Hang */
export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const forceRefresh = request.nextUrl.searchParams.get('refresh') === 'true';
    const now = Date.now();

    if (!forceRefresh && cachedSkuList && (now - skuCacheTime) < SKU_CACHE_TTL) {
      return NextResponse.json({ items: cachedSkuList, source: 'cache' });
    }

    const accessToken = await getGoogleAccessToken();

    // Read columns A and B from row 2 onwards (skip header)
    const range = `${SKU_SHEET_TAB}!A2:B1000`;
    const res = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${SKU_SPREADSHEET_ID}/values/${encodeURIComponent(range)}`,
      { headers: { 'Authorization': `Bearer ${accessToken}` } }
    );

    if (!res.ok) {
      // Sheet not accessible — return empty gracefully
      return NextResponse.json({ items: [], source: 'error', message: `Sheet error: ${res.status}` });
    }

    const data = await res.json();
    const rows = data.values || [];

    const items: { sku: string; description: string }[] = [];
    for (const row of rows) {
      const sku = (row[0] || '').toString().trim();
      const description = (row[1] || '').toString().trim();
      if (description) {
        items.push({ sku, description });
      }
    }

    cachedSkuList = items as any;
    skuCacheTime = now;

    return NextResponse.json({ items, source: 'sheets' });
  } catch (error: any) {
    // Gracefully return empty array so frontend doesn't break
    return NextResponse.json({ items: [], source: 'error', message: error?.message || 'Lỗi đọc SKU' });
  }
}

/** Generate 4-character SKU: 2 uppercase letters from keyword + 2 random digits */
function generateSku4(productName: string): string {
  // Extract first meaningful word (skip common Vietnamese prepositions)
  const skipWords = new Set(['mua', 'bán', 'của', 'cho', 'với', 'từ', 'đến', 'và', 'hoặc', 'các', 'những', 'phí', 'tiền', 'chi']);
  const words = productName
    .replace(/[^a-zA-ZÀ-ỹ\s]/g, '')
    .split(/\s+/)
    .filter(w => w.length > 0 && !skipWords.has(w.toLowerCase()));

  let prefix = 'SP';
  if (words.length > 0) {
    const word = words[0];
    // Take first 2 characters, convert to uppercase ASCII-safe
    const chars = word.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase();
    if (chars.length >= 2) {
      prefix = chars.substring(0, 2);
    } else if (chars.length === 1) {
      prefix = chars + 'X';
    }
  }

  // Ensure prefix is exactly 2 uppercase letters
  prefix = prefix.replace(/[^A-Z]/g, '').substring(0, 2);
  if (prefix.length < 2) prefix = ('SP' + prefix).substring(0, 2);

  const num = String(Math.floor(Math.random() * 99) + 1).padStart(2, '0');
  return prefix + num;
}

/** POST: Append new rows to SKU_Mua_Hang (col A = auto SKU, col B = moTa) */
export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    // YC5: Accept both { description: string } (single) and { newDescriptions: string[] } (array)
    let newDescriptions: string[];
    if (body.newDescriptions && Array.isArray(body.newDescriptions)) {
      newDescriptions = body.newDescriptions;
    } else if (body.description && typeof body.description === 'string') {
      newDescriptions = [body.description];
    } else {
      return NextResponse.json({ error: 'description (string) or newDescriptions (array) is required' }, { status: 400 });
    }

    if (newDescriptions.length === 0) {
      return NextResponse.json({ message: 'No valid descriptions to add', added: 0 });
    }

    const accessToken = await getGoogleAccessToken();

    // Generate rows: [SKU_4char, description]
    const newRows = newDescriptions
      .filter((d: string) => d && d.trim())
      .map((desc: string) => {
        const sku = generateSku4(desc);
        return [sku, desc.trim()];
      });

    if (newRows.length === 0) {
      return NextResponse.json({ message: 'No valid descriptions to add', added: 0 });
    }

    // APPEND (not overwrite) to the sheet
    const appendRes = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${SKU_SPREADSHEET_ID}/values/${encodeURIComponent(SKU_SHEET_TAB)}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ values: newRows }),
      }
    );

    if (!appendRes.ok) {
      const errText = await appendRes.text();
      console.error('SKU append error:', errText);
      throw new Error(`Failed to append to SKU sheet: ${appendRes.status}`);
    }

    // Invalidate cache so next read gets fresh data
    cachedSkuList = null;
    skuCacheTime = 0;

    return NextResponse.json({
      message: `Đã thêm ${newRows.length} mô tả mới vào SKU_Mua_Hang`,
      added: newRows.length,
      rows: newRows,
    });
  } catch (error: any) {
    console.error('SKU master write error:', error);
    return NextResponse.json({ error: error?.message || 'Lỗi ghi SKU' }, { status: 500 });
  }
}
