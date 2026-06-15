/**
 * 農業部水產試驗所 — CWA 逐時氣象資料自動擷取
 * 由 GitHub Actions 每小時執行，寫入 Supabase
 */

import { createClient } from '@supabase/supabase-js';
import WebSocket from 'ws';

const CWA_KEY     = process.env.CWA_API_KEY        || 'CWA-4024AEE6-8945-4BAE-9AE2-3A5D649911CC';
const SB_URL      = process.env.SUPABASE_URL        || '';
const SB_KEY      = process.env.SUPABASE_SERVICE_KEY || '';
const DEBUG       = process.env.DEBUG === 'true';

const CWA_BASE    = 'https://opendata.cwa.gov.tw/api/v1/rest/datastore';
const WEATHER_EP  = `${CWA_BASE}/O-A0001-001`;
const RAINFALL_EP = `${CWA_BASE}/O-A0002-001`;

const BATCH_SIZE  = 500;   // Supabase upsert batch size

// ── Helpers ───────────────────────────────────────────────────────────

function toN(v) {
  if (v === null || v === undefined || v === '' || v === '-' || v === 'None') return null;
  const n = parseFloat(v);
  return isNaN(n) ? null : n;
}

function log(...args)  { console.log(`[${now()}]`, ...args); }
function warn(...args) { console.warn(`[${now()}] ⚠`, ...args); }
function err(...args)  { console.error(`[${now()}] ✗`, ...args); }
function now() { return new Date().toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' }); }

async function fetchJSON(url) {
  const resp = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!resp.ok) throw new Error(`HTTP ${resp.status} ${resp.statusText}`);
  return resp.json();
}

// ── CWA Parsers ──────────────────────────────────────────────────────────

function parseWeatherStation(s) {
  const ow = s.WeatherElement || {};
  return {
    observed_at:  s.ObsTime?.DateTime || new Date().toISOString(),
    station_id:   s.StationId,
    station_name: s.StationName,
    county:       s.GeoInfo?.CountyName || '',
    town:         s.GeoInfo?.TownName   || '',
    temperature:  toN(ow.AirTemperature),
    humidity:     toN(ow.RelativeHumidity),
    pressure:     toN(ow.AirPressure),
    wind_speed:   toN(ow.WindSpeed),
    wind_dir:     toN(ow.WindDirection),
    gust:         toN(ow.GustInfo?.PeakGustSpeed),
    precipitation:toN(ow.Now?.Precipitation),
    sunshine_dur: toN(ow.SunshineDuration),
  };
}

function parseRainfallStation(s) {
  const re = s.RainfallElement || {};
  return {
    observed_at:  s.ObsTime?.DateTime || new Date().toISOString(),
    station_id:   s.StationId,
    station_name: s.StationName,
    county:       s.GeoInfo?.CountyName || '',
    town:         s.GeoInfo?.TownName   || '',
    rain_10min:   toN(re.Past10Min?.Precipitation),
    rain_1hr:     toN(re.Past1hr?.Precipitation),
    rain_3hr:     toN(re.Past3hr?.Precipitation),
    rain_6hr:     toN(re.Past6hr?.Precipitation),
    rain_12hr:    toN(re.Past12hr?.Precipitation),
    rain_24hr:    toN(re.Past24hr?.Precipitation),
    rain_48hr:    toN(re.Past48hr?.Precipitation),
    rain_month:   toN(re.PastMonth?.Precipitation),
  };
}

// ── Supabase Upsert ────────────────────────────────────────────────────────

async function upsertBatched(sb, table, rows, conflict) {
  let total = 0;
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    const { error } = await sb.from(table).upsert(batch, { onConflict: conflict });
    if (error) throw new Error(`${table} upsert error: ${error.message} (${error.code})`);
    total += batch.length;
    if (DEBUG) log(`  ${table}: 已寫入 ${total}/${rows.length}`);
  }
  return total;
}

// ── Main ────────────────────────────────────────────────────────────

async function main() {
  log('═══ CWA 逐時氣象資料擷取開始 ═══');

  // ── 1. Fetch CWA Weather ──
  log('取得氣象觀測站資料（O-A0001-001）...');
  let weatherRows = [];
  try {
    const url  = `${WEATHER_EP}?Authorization=${CWA_KEY}&format=JSON&limit=1000`;
    const json = await fetchJSON(url);
    const raw  = json?.records?.Station || [];
    weatherRows = raw.map(parseWeatherStation).filter(r => r.station_id);
    log(`  氣象：取得 ${weatherRows.length} 筆`);
  } catch (e) {
    warn('氣象 API 失敗：', e.message);
  }

  // ── 2. Fetch CWA Rainfall ──
  log('取得雨量觀測站資料（O-A0002-001）...');
  let rainfallRows = [];
  try {
    const url  = `${RAINFALL_EP}?Authorization=${CWA_KEY}&format=JSON&limit=1000`;
    const json = await fetchJSON(url);
    const raw  = json?.records?.Station || [];
    rainfallRows = raw.map(parseRainfallStation).filter(r => r.station_id);
    log(`  雨量：取得 ${rainfallRows.length} 筆`);
  } catch (e) {
    warn('雨量 API 失敗：', e.message);
  }

  if (!weatherRows.length && !rainfallRows.length) {
    err('兩個 API 均未取得資料，中止執行');
    process.exit(1);
  }

  // ── 3. Write to Supabase ──
  if (!SB_URL || !SB_KEY) {
    warn('未設定 SUPABASE_URL 或 SUPABASE_SERVICE_KEY，跳過雲端寫入');
    log('若需雲端儲存，請至 GitHub repo → Settings → Secrets 新增以下 Secrets：');
    log('  SUPABASE_URL、SUPABASE_SERVICE_KEY、CWA_API_KEY（可選）');
    process.exit(0);
  }

  // �� Supabase 客戶端配置 WebSocket（Node.js 20+ 相容性）
  if (typeof globalThis.WebSocket === 'undefined') {
    globalThis.WebSocket = WebSocket;
  }

  const sb = createClient(SB_URL, SB_KEY);

  let wOk = 0, rOk = 0;
  if (weatherRows.length) {
    try {
      wOk = await upsertBatched(sb, 'weather_observations', weatherRows, 'observed_at,station_id');
      log(`  ✓ weather_observations 寫入 ${wOk} 筆`);
    } catch (e) {
      err('weather_observations 寫入失敗：', e.message);
    }
  }
  if (rainfallRows.length) {
    try {
      rOk = await upsertBatched(sb, 'rainfall_observations', rainfallRows, 'observed_at,station_id');
      log(`  ✓ rainfall_observations 寫入 ${rOk} 筆`);
    } catch (e) {
      err('rainfall_observations 寫入失敗：', e.message);
    }
  }

  log(`═══ 完成：氣象 ${wOk} 筆 / 雨量 ${rOk} 筆 ═══`);
}

main().catch(e => { err('未預期錯誤：', e); process.exit(1); });
