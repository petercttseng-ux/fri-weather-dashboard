/* ── IndexedDB (Dexie) + Supabase Cloud DB ── */

/* Local DB */
const localDB = new Dexie('FriWeatherDB');
localDB.version(2).stores({
  weather:  '++id, stationId, obsTime, county, town',
  rainfall: '++id, stationId, obsTime, county, town',
  uploads:  '++id, type, uploadedAt, note'
});

/* ── Supabase client ── */
let _sbClient = null;

function getSupabase() {
  const cfg = Config.load();
  if (!cfg.supabaseUrl || !cfg.supabaseKey) return null;
  if (!_sbClient) {
    _sbClient = supabase.createClient(cfg.supabaseUrl, cfg.supabaseKey);
  }
  return _sbClient;
}

function resetSupabaseClient() { _sbClient = null; }

/* ── SQL script for Supabase setup ── */
const SUPABASE_SQL = `-- ============================================================
-- 農業部水產試驗所 氣象監測儀表板 — Supabase 建表腳本 v3
-- 請在 Supabase → SQL Editor 中執行此完整腳本
-- 注意：會刪除並重建 weather_obs 及 rainfall_obs 資料表
-- ============================================================

-- 刪除舊表（含所有舊欄位定義）
DROP TABLE IF EXISTS rainfall_obs CASCADE;
DROP TABLE IF EXISTS weather_obs  CASCADE;

-- 氣象觀測資料表
CREATE TABLE weather_obs (
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
CREATE INDEX idx_weather_time   ON weather_obs(observed_at);
CREATE INDEX idx_weather_county ON weather_obs(county);

-- 雨量觀測資料表
CREATE TABLE rainfall_obs (
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
CREATE INDEX idx_rainfall_time   ON rainfall_obs(observed_at);
CREATE INDEX idx_rainfall_county ON rainfall_obs(county);

-- Row Level Security（允許公開讀寫）
ALTER TABLE weather_obs  ENABLE ROW LEVEL SECURITY;
ALTER TABLE rainfall_obs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all" ON weather_obs  FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all" ON rainfall_obs FOR ALL USING (true) WITH CHECK (true);

-- 驗證欄位
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name IN ('weather_obs','rainfall_obs')
ORDER BY table_name, ordinal_position;
`;

/* ── DB API ── */
const DB = {

  /* Save weather batch to local + cloud */
  async saveWeather(records) {
    if (!records || !records.length) return;

    // local IndexedDB
    await localDB.weather.bulkPut(records.map(r => ({
      stationId: r.stationId,
      obsTime:   r.obsTime,
      county:    r.county,
      town:      r.town,
      data:      r
    })));

    // cloud Supabase
    const sb = getSupabase();
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
        .from('weather_obs')
        .upsert(rows, { onConflict: 'observed_at,station_id' });
      if (error) console.warn('Supabase weather upsert error:', error.message, error.details);
    } catch (e) { console.warn('Supabase weather upsert exception:', e.message); }
  },

  /* Save rainfall batch to local + cloud */
  async saveRainfall(records) {
    if (!records || !records.length) return;

    // local IndexedDB
    await localDB.rainfall.bulkPut(records.map(r => ({
      stationId: r.stationId,
      obsTime:   r.obsTime,
      county:    r.county,
      town:      r.town,
      data:      r
    })));

    // cloud Supabase
    const sb = getSupabase();
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
        .from('rainfall_obs')
        .upsert(rows, { onConflict: 'observed_at,station_id' });
      if (error) console.warn('Supabase rainfall upsert error:', error.message, error.details);
    } catch (e) { console.warn('Supabase rainfall upsert exception:', e.message); }
  },

  /* Query rainfall in time range — cloud first, then local fallback */
  async queryRainfallRange(startMs, endMs) {
    const start = new Date(startMs).toISOString();
    const end   = new Date(endMs).toISOString();

    const sb = getSupabase();
    if (sb) {
      try {
        const { data, error } = await sb
          .from('rainfall_obs')
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
    const sb = getSupabase();
    if (!sb) return { ok: false, msg: '未設定 Supabase 連線' };
    try {
      const { data, error } = await sb
        .from('rainfall_obs')
        .select('id, observed_at')
        .limit(1);
      if (error) return { ok: false, msg: error.message };
      return { ok: true, msg: '連線成功' };
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
