/* ── Default Configuration ── */
const DEFAULT_CONFIG = {
  apiKey: 'CWA-4024AEE6-8945-4BAE-9AE2-3A5D649911CC',
  weatherEndpoint: 'https://opendata.cwa.gov.tw/api/v1/rest/datastore/O-A0001-001',
  rainfallEndpoint: 'https://opendata.cwa.gov.tw/api/v1/rest/datastore/O-A0002-001',
  autoRefreshMin: 30,
  retentionDays: 30,
  supabaseUrl: '',
  supabaseKey: '',        // anon key（讀取用）
  supabaseServiceKey: ''  // service_role key（寫入用，可繞過 RLS）
};

/* ── Config Manager ── */
const Config = (() => {
  const KEY = 'friDashConfig';

  function load() {
    try {
      const saved = JSON.parse(localStorage.getItem(KEY) || '{}');
      return { ...DEFAULT_CONFIG, ...saved };
    } catch { return { ...DEFAULT_CONFIG }; }
  }

  function save(patch) {
    const current = load();
    const updated = { ...current, ...patch };
    localStorage.setItem(KEY, JSON.stringify(updated));
    return updated;
  }

  function get(key) { return load()[key]; }

  return { load, save, get };
})();
