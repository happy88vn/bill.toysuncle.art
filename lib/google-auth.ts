import { GoogleAuth, OAuth2Client } from 'google-auth-library';
import * as fs from 'fs';
import * as path from 'path';

let cachedAuth: GoogleAuth | null = null;

function getAuth(): GoogleAuth {
  if (cachedAuth) return cachedAuth;

  const jsonPaths = [
    path.join(process.cwd(), 'data', 'google-service-account.json'),
    path.join(__dirname, '..', 'data', 'google-service-account.json'),
  ];

  let credentials: any = null;
  for (const p of jsonPaths) {
    try {
      if (fs.existsSync(p)) {
        credentials = JSON.parse(fs.readFileSync(p, 'utf-8'));
        break;
      }
    } catch (e) { /* continue */ }
  }

  if (!credentials) {
    const clientEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
    const privateKey = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n');
    if (!clientEmail || !privateKey) throw new Error('Missing Google Service Account credentials');
    credentials = { client_email: clientEmail, private_key: privateKey };
  }

  cachedAuth = new GoogleAuth({
    credentials: { client_email: credentials.client_email, private_key: credentials.private_key },
    scopes: ['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/drive'],
  });
  return cachedAuth;
}

/** Service Account token — for Google Sheets */
export async function getGoogleAccessToken(): Promise<string> {
  const auth = getAuth();
  const client = await auth.getClient();
  const tokenResponse = await client.getAccessToken();
  const token = typeof tokenResponse === 'string' ? tokenResponse : tokenResponse?.token;
  if (!token) throw new Error('Failed to obtain Google access token');
  return token;
}

/** Helper: get refresh token from DB (persistent) or env (fallback) */
async function getStoredRefreshToken(): Promise<string | null> {
  // 1. Check process.env first (fastest, set at runtime after OAuth callback)
  if (process.env.GOOGLE_OAUTH_REFRESH_TOKEN) {
    return process.env.GOOGLE_OAUTH_REFRESH_TOKEN;
  }

  // 2. Check database (persistent across deployments)
  try {
    const { prisma } = await import('@/lib/prisma');
    const config = await prisma.appConfig.findUnique({ where: { key: 'GOOGLE_DRIVE_REFRESH_TOKEN' } });
    if (config?.value) {
      // Cache in process.env for subsequent calls in this process
      process.env.GOOGLE_OAUTH_REFRESH_TOKEN = config.value;
      return config.value;
    }
  } catch (e) {
    console.error('Failed to read refresh token from DB:', e);
  }

  return null;
}

/** OAuth2 user token — for Google Drive (personal account) */
export async function getDriveUserToken(): Promise<string> {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  const refreshToken = await getStoredRefreshToken();

  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error('DRIVE_NOT_CONNECTED');
  }

  const oauth2Client = new OAuth2Client(clientId, clientSecret);
  oauth2Client.setCredentials({ refresh_token: refreshToken });

  const { token } = await oauth2Client.getAccessToken();
  if (!token) throw new Error('Failed to obtain Drive user access token');
  return token;
}

/** Check if Drive is connected (check env + DB) */
export async function isDriveConnected(): Promise<boolean> {
  const token = await getStoredRefreshToken();
  return !!token;
}

/** Get OAuth2Client for Drive authorization flow */
export function getDriveOAuth2Client(redirectUri: string): OAuth2Client {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error('Missing GOOGLE_OAUTH_CLIENT_ID or GOOGLE_OAUTH_CLIENT_SECRET');
  }
  return new OAuth2Client(clientId, clientSecret, redirectUri);
}