/* ── IndexedDB (Dexie) + Supabase Cloud DB ── */

/* Local DB — v3: compound primary key [stationId+obsTime] prevents duplicates */
const localDB = new Dexie('FriWeatherDB');
localDB.version(2).stores({
  weather:  '++id, stationId, obsTime, county, town',
  rainfall: '++id, stationId, obsTime, county, town',
  uploads:  '++id, type, uploadedAt, note'
});
localDB.version(3).stores({
  weather:  '[stationId+obsTime], obsTime, county, town',
  rainfall: '[stationId+obsTime], obsTime, county, town',
  uploads:  '++id, type, uploadedAt, note'
});

/* ── Supabase clients (read = anon, write = service_role) ── */
let _sbRead  = null;  // anon key  — for SELECT
let _sbWrite = null;  // service_role key — for INSERT/UPSERT (bypasses RLS)

function getSupabaseRead() {
  const cfg = Config.load();
  if (!cfg.supabaseUrl || !cfg.supabaseKey) return null;
  if (!_sbRead) _sbRead = supabase.createClient(cfg.supabaseUrl, cfg.supabaseKey);
  return _sbRead;
}

function getSupabaseWrite() {
  const cfg = Config.load();
  if (!cfg.supabaseUrl) return null;
  // prefer service_role key; fall back to anon key
  const key = cfg.supabaseServiceKey || cfg.supabaseKey;
  if (!key) return null;
  if (!_sbWrite) _sbWrite = supabase.createClient(cfg.supabaseUrl, key);
  return _sbWrite;
}

function resetSupabaseClient() { _sbRead = null; _sbWrite = null; }

/* ── SQL script for Supabase setup ── */
const SUPABASE_SQL = `-- ============================================================
-- 農業部水產試驗所 氣象監測儀表板 — Supabase 建表腳本 v4
-- 請在 Supabase → SQL Editor 中執行此完整腳本
-- 注意：會刪除並重建資料表（舊資料將清除）
-- ============================================================

-- 1. 刪除舊表（無論欄位名稱為何）
DROP TABLE IF EXISTS rainfall_observations CASCADE;
DROP TABLE IF EXISTS weather_observations  CASCADE;
DROP TABLE IF EXISTS rainfall_obs CASCADE;
DROP TABLE IF EXISTS weather_obs  CASCADE;

-- 2. 建立氣象觀測資料表
CREATE TABLE weather_observations (
  id            BIGSERIAL    PRIMARY KEY,
  observed_at   TIMESTAMPTZ  NOT NULL,
  station_id    TEXT         NOT NULL,
  station_name  TEXT,
  county        TEXT,
  town          TEXT,
  temperature   NUMERIC,
  humidity      NUMERIC,
  pressure      NUMERIC,
  wind_speed    NUMERIC,
  wind_dir      NUMERIC,
  gust          NUMERIC,
  precipitation NUMERIC,
  sunshine_dur  NUMERIC,
  created_at    TIMESTAMPTZ  DEFAULT NOW(),
  UNIQUE (observed_at, station_id)
);
CREATE INDEX idx_weather_obs_time   ON weather_observations(observed_at);
CREATE INDEX idx_weather_obs_county ON weather_observations(county);

-- 3. 建立雨量觀測資料表
CREATE TABLE rainfall_observations (
  id           BIGSERIAL    PRIMARY KEY,
  observed_at  TIMESTAMPTZ  NOT NULL,
  station_id   TEXT         NOT NULL,
  station_name TEXT,
  county       TEXT,
  town         TEXT,
  rain_10min   NUMERIC,
  rain_1hr     NUMERIC,
  rain_3hr     NUMERIC,
  rain_6hr     NUMERIC,
  rain_12hr    NUMERIC,
  rain_24hr    NUMERIC,
  rain_48hr    NUMERIC,
  rain_month   NUMERIC,
  created_at   TIMESTAMPTZ  DEFAULT NOW(),
  UNIQUE (observed_at, station_id)
);
CREATE INDEX idx_rainfall_obs_time   ON rainfall_observations(observed_at);
CREATE INDEX idx_rainfall_obs_county ON rainfall_observations(county);

-- 4. 授予 anon / authenticated 角色讀寫權限
GRANT ALL ON weather_observations   TO anon, authenticated;
GRANT ALL ON rainfall_observations  TO anon, authenticated;
GRANT USAGE, SELECT ON SEQUENCE weather_observations_id_seq  TO anon, authenticated;
GRANT USAGE, SELECT ON SEQUENCE rainfall_observations_id_seq TO anon, authenticated;

-- 5. 啟用 Row Level Security 並建立允許所有操作的政策
ALTER TABLE weather_observations  ENABLE ROW LEVEL SECURITY;
ALTER TABLE rainfall_observations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow all anon" ON weather_observations;
DROP POLICY IF EXISTS "Allow all anon" ON rainfall_observations;
CREATE POLICY "Allow all anon" ON weather_observations
  FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Allow all anon" ON rainfall_observations
  FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

-- 6. 驗證（執行後請確認兩張表均有 observed_at 欄位）
SELECT table_name, column_name, data_type
FROM information_schema.columns
WHERE table_name IN ('weather_observations','rainfall_observations')
  AND column_name IN ('observed_at','station_id')
ORDER BY table_name, ordinal_position;
`;

/* ── DB API ── */
const DB = {

  /* Save weather batch to local + cloud */
  async saveWeather(records) {
    if (!records || !records.length) return;

    // local IndexedDB — compound key [stationId+obsTime] deduplicates automatically
    await localDB.weather.bulkPut(records.map(r => ({
      stationId: r.stationId || 'UNKNOWN',
      obsTime:   r.obsTime   || new Date().toISOString(),
      county:    r.county    || '',
      town:      r.town      || '',
      data:      r
    })));

    // cloud Supabase (use write client to bypass RLS)
    const sb = getSupabaseWrite();
    if (!sb) return;
    const rows = records.map(r => ({
      observed_at:  r.obsTime,
      station_id:   r.stationId,
      station_name: r.stationName,
      county:       r.county,
      town:         r.town,
      temperature:  r.temperature,
      humidity:     r.relativeHumidity,
      pressure:     r.pressure,
      wind_speed:   r.windSpeed,
      wind_dir:     r.windDirection,
      gust:         r.gustInfo,
      precipitation:r.precipitation,
      sunshine_dur: r.sunshineDuration
    }));
    try {
      const { error } = await sb
        .from('weather_observations')
        .upsert(rows, { onConflict: 'observed_at,station_id' });
      if (error) throw new Error(error.message);
    } catch (e) { throw new Error('Supabase 氣象儲存失敗：' + e.message); }
  },

  /* Save rainfall batch to local + cloud */
  async saveRainfall(records) {
    if (!records || !records.length) return;

    // local IndexedDB — compound key [stationId+obsTime] deduplicates automatically
    await localDB.rainfall.bulkPut(records.map(r => ({
      stationId: r.stationId || 'UNKNOWN',
      obsTime:   r.obsTime   || new Date().toISOString(),
      county:    r.county    || '',
      town:      r.town      || '',
      data:      r
    })));

    // cloud Supabase (use write client to bypass RLS)
    const sb = getSupabaseWrite();
    if (!sb) return;
    const rows = records.map(r => ({
      observed_at:  r.obsTime,
      station_id:   r.stationId,
      station_name: r.stationName,
      county:       r.county,
      town:         r.town,
      rain_10min:   r.rain10Min,
      rain_1hr:     r.rain1hr,
      rain_3hr:     r.rain3hr,
      rain_6hr:     r.rain6hr,
      rain_12hr:    r.rain12hr,
      rain_24hr:    r.rain24hr,
      rain_48hr:    r.rain48hr,
      rain_month:   r.rainMonth
    }));
    try {
      const { error } = await sb
        .from('rainfall_observations')
        .upsert(rows, { onConflict: 'observed_at,station_id' });
      if (error) throw new Error(error.message);
    } catch (e) { throw new Error('Supabase 雨量儲存失敗：' + e.message); }
  },

  /* Query rainfall in time range — cloud first, then local fallback */
  async queryRainfallRange(startMs, endMs) {
    const start = new Date(startMs).toISOString();
    const end   = new Date(endMs).toISOString();

    const sb = getSupabaseRead();
    if (sb) {
      try {
        const { data, error } = await sb
          .from('rainfall_observations')
          .select('*')
          .gte('observed_at', start)
          .lte('observed_at', end)
          .order('observed_at', { ascending: true });
        if (error) {
          console.warn('Supabase range query error:', error.message);
        } else if (data && data.length > 0) {
          return data.map(mapFromCloud);
        }
      } catch (e) { console.warn('Supabase range query exception:', e.message); }
    }

    // fallback: local IndexedDB
    const all = await localDB.rainfall
      .where('obsTime').between(start, end, true, true)
      .toArray();
    return all.map(r => r.data);
  },

  /* DB statistics */
  async getStats() {
    const wCount = await localDB.weather.count();
    const rCount = await localDB.rainfall.count();
    const wFirst = await localDB.weather.orderBy('obsTime').first();
    const wLast  = await localDB.weather.orderBy('obsTime').last();
    const rFirst = await localDB.rainfall.orderBy('obsTime').first();
    const rLast  = await localDB.rainfall.orderBy('obsTime').last();
    return { wCount, rCount, wFirst, wLast, rFirst, rLast };
  },

  /* Test Supabase connection */
  async testSupabase() {
    const sbR = getSupabaseRead();
    const sbW = getSupabaseWrite();
    if (!sbR && !sbW) return { ok: false, msg: '未設定 Supabase 連線' };
    try {
      // test read
      const { error: re } = await (sbR || sbW)
        .from('rainfall_observations').select('id').limit(1);
      if (re) return { ok: false, msg: re.message };
      // test write with empty upsert (just checks permission)
      const { error: we } = await (sbW || sbR)
        .from('rainfall_observations').upsert([], { onConflict: 'observed_at,station_id' });
      if (we && we.code === '42501') return { ok: false, msg: we.message + ' / ' + we.code };
      return { ok: true, msg: '連線成功，讀寫權限正常' };
    } catch (e) { return { ok: false, msg: e.message }; }
  },

  /* Prune local data older than retentionDays */
  async pruneLocal() {
    const days = parseInt(Config.get('retentionDays')) || 0;
    if (!days) return;
    const cutoff = new Date(Date.now() - days * 86400000).toISOString();
    await localDB.weather.where('obsTime').below(cutoff).delete();
    await localDB.rainfall.where('obsTime').below(cutoff).delete();
  },

  async clearAll() {
    await localDB.weather.clear();
    await localDB.rainfall.clear();
    await localDB.uploads.clear();
  }
};

/* Map Supabase row → app record */
function mapFromCloud(r) {
  return {
    obsTime:     r.observed_at,
    stationId:   r.station_id,
    stationName: r.station_name,
    county:      r.county,
    town:        r.town,
    rain10Min:   r.rain_10min,
    rain1hr:     r.rain_1hr,
    rain3hr:     r.rain_3hr,
    rain6hr:     r.rain_6hr,
    rain12hr:    r.rain_12hr,
    rain24hr:    r.rain_24hr,
    rain48hr:    r.rain_48hr,
    rainMonth:   r.rain_month
  };
}
