/* ── IndexedDB (Dexie) + Supabase Cloud DB ── */

/* Local DB */
const localDB = new Dexie('FriWeatherDB');
localDB.version(2).stores({
  weather:  '++id, stationId, obsTime, county, town',
  rainfall: '++id, stationId, obsTime, county, town',
  uploads:  '++id, type, uploadedAt, note'
});

/* ── Supabase client (initialised when config is available) ── */
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
const SUPABASE_SQL = `-- 在 Supabase SQL Editor 執行此腳本建立資料表

-- 氣象觀測資料表
CREATE TABLE IF NOT EXISTS weather_obs (
  id           BIGSERIAL PRIMARY KEY,
  obs_time     TIMESTAMPTZ NOT NULL,
  station_id   TEXT NOT NULL,
  station_name TEXT,
  county       TEXT,
  town         TEXT,
  temperature  NUMERIC,
  humidity     NUMERIC,
  pressure     NUMERIC,
  wind_speed   NUMERIC,
  wind_dir     NUMERIC,
  gust         NUMERIC,
  precipitation NUMERIC,
  sunshine_dur NUMERIC,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_weather_time ON weather_obs(obs_time);
CREATE INDEX IF NOT EXISTS idx_weather_county ON weather_obs(county);

-- 雨量觀測資料表
CREATE TABLE IF NOT EXISTS rainfall_obs (
  id           BIGSERIAL PRIMARY KEY,
  obs_time     TIMESTAMPTZ NOT NULL,
  station_id   TEXT NOT NULL,
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
  created_at   TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_rainfall_time ON rainfall_obs(obs_time);
CREATE INDEX IF NOT EXISTS idx_rainfall_county ON rainfall_obs(county);

-- 啟用 Row Level Security（設定公開讀寫，可依需求調整）
ALTER TABLE weather_obs  ENABLE ROW LEVEL SECURITY;
ALTER TABLE rainfall_obs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all" ON weather_obs  FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all" ON rainfall_obs FOR ALL USING (true) WITH CHECK (true);
`;

/* ── DB API ── */
const DB = {
  /* Save weather batch to local + cloud */
  async saveWeather(records) {
    // local
    await localDB.weather.bulkPut(records.map(r => ({
      stationId: r.stationId, obsTime: r.obsTime,
      county: r.county, town: r.town, data: r
    })));

    // cloud
    const sb = getSupabase();
    if (sb) {
      const rows = records.map(r => ({
        obs_time: r.obsTime, station_id: r.stationId,
        station_name: r.stationName, county: r.county, town: r.town,
        temperature: r.temperature, humidity: r.humidity,
        pressure: r.pressure, wind_speed: r.windSpeed,
        wind_dir: r.windDirection, gust: r.gustInfo,
        precipitation: r.precipitation, sunshine_dur: r.sunshineDuration
      }));
      try {
        await sb.from('weather_obs').upsert(rows, { onConflict: 'obs_time,station_id' });
      } catch (e) { console.warn('Supabase weather upsert:', e.message); }
    }
  },

  /* Save rainfall batch to local + cloud */
  async saveRainfall(records) {
    await localDB.rainfall.bulkPut(records.map(r => ({
      stationId: r.stationId, obsTime: r.obsTime,
      county: r.county, town: r.town, data: r
    })));

    const sb = getSupabase();
    if (sb) {
      const rows = records.map(r => ({
        obs_time: r.obsTime, station_id: r.stationId,
        station_name: r.stationName, county: r.county, town: r.town,
        rain_10min: r.rain10Min, rain_1hr: r.rain1hr,
        rain_3hr: r.rain3hr, rain_6hr: r.rain6hr,
        rain_12hr: r.rain12hr, rain_24hr: r.rain24hr,
        rain_48hr: r.rain48hr, rain_month: r.rainMonth
      }));
      try {
        await sb.from('rainfall_obs').upsert(rows, { onConflict: 'obs_time,station_id' });
      } catch (e) { console.warn('Supabase rainfall upsert:', e.message); }
    }
  },

  /* Query rainfall in time range from local DB */
  async queryRainfallRange(startMs, endMs) {
    const start = new Date(startMs).toISOString();
    const end   = new Date(endMs).toISOString();

    // try cloud first
    const sb = getSupabase();
    if (sb) {
      try {
        const { data, error } = await sb
          .from('rainfall_obs')
          .select('*')
          .gte('obs_time', start)
          .lte('obs_time', end)
          .order('obs_time', { ascending: true });
        if (!error && data && data.length > 0) return data.map(mapFromCloud);
      } catch (e) { console.warn('Supabase query:', e.message); }
    }

    // fallback local
    const all = await localDB.rainfall
      .where('obsTime').between(start, end, true, true)
      .toArray();
    return all.map(r => r.data);
  },

  /* DB stats */
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
    if (!sb) return false;
    try {
      const { error } = await sb.from('rainfall_obs').select('id').limit(1);
      return !error;
    } catch { return false; }
  },

  /* Clear local data older than retentionDays */
  async pruneLocal() {
    const days = Config.get('retentionDays');
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

function mapFromCloud(r) {
  return {
    obsTime: r.obs_time, stationId: r.station_id,
    stationName: r.station_name, county: r.county, town: r.town,
    rain10Min: r.rain_10min, rain1hr: r.rain_1hr,
    rain3hr: r.rain_3hr, rain6hr: r.rain_6hr,
    rain12hr: r.rain_12hr, rain24hr: r.rain_24hr,
    rain48hr: r.rain_48hr, rainMonth: r.rain_month
  };
}
