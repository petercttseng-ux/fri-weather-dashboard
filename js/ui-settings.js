/* ── Settings UI ── */
const SettingsUI = (() => {

  function init() {
    const cfg = Config.load();
    const el = id => document.getElementById(id);
    if (el('settingApiKey'))          el('settingApiKey').value          = cfg.apiKey || '';
    if (el('settingInterval'))        el('settingInterval').value        = cfg.autoRefreshMin || 30;
    if (el('settingWeatherEndpoint')) el('settingWeatherEndpoint').value = cfg.weatherEndpoint;
    if (el('settingRainfallEndpoint'))el('settingRainfallEndpoint').value= cfg.rainfallEndpoint;
    if (el('settingSupabaseUrl'))     el('settingSupabaseUrl').value     = cfg.supabaseUrl || '';
    if (el('settingSupabaseKey'))     el('settingSupabaseKey').value     = cfg.supabaseKey || '';
    if (el('settingRetention'))       el('settingRetention').value       = cfg.retentionDays || 30;
    // mask key initially
    if (el('settingApiKey')) el('settingApiKey').type = 'password';
  }

  function toggleKey() {
    const inp  = document.getElementById('settingApiKey');
    const icon = document.getElementById('eyeIcon');
    if (!inp) return;
    if (inp.type === 'password') {
      inp.type = 'text'; icon.className = 'bi bi-eye-slash';
    } else {
      inp.type = 'password'; icon.className = 'bi bi-eye';
    }
  }

  function saveCWA() {
    const el = id => document.getElementById(id)?.value?.trim();
    Config.save({
      apiKey:             el('settingApiKey'),
      autoRefreshMin:     parseInt(el('settingInterval')) || 30,
      weatherEndpoint:    el('settingWeatherEndpoint'),
      rainfallEndpoint:   el('settingRainfallEndpoint')
    });
    Toast.show('CWA API 設定已儲存', 'success');
    App.scheduleRefresh();
  }

  function saveSupabase() {
    const url = document.getElementById('settingSupabaseUrl')?.value?.trim();
    const key = document.getElementById('settingSupabaseKey')?.value?.trim();
    Config.save({ supabaseUrl: url, supabaseKey: key });
    resetSupabaseClient();
    Toast.show('Supabase 設定已儲存', 'success');
  }

  async function testSupabase() {
    const url = document.getElementById('settingSupabaseUrl')?.value?.trim();
    const key = document.getElementById('settingSupabaseKey')?.value?.trim();
    if (!url || !key) { Toast.show('請先填入 Supabase URL 及 Key', 'warning'); return; }
    Config.save({ supabaseUrl: url, supabaseKey: key });
    resetSupabaseClient();
    Toast.show('連線測試中...', 'info');
    const ok = await DB.testSupabase();
    Toast.show(ok ? '✓ Supabase 連線成功！' : '✗ 連線失敗，請確認設定及資料表是否存在', ok ? 'success' : 'danger');
  }

  function showSqlScript() {
    const box = document.getElementById('sqlScriptBox');
    const txt = document.getElementById('sqlScriptText');
    if (!box || !txt) return;
    txt.value = SUPABASE_SQL;
    box.classList.remove('d-none');
  }

  function copySql() {
    const txt = document.getElementById('sqlScriptText');
    if (txt) { navigator.clipboard.writeText(txt.value); Toast.show('SQL已複製到剪貼簿', 'success'); }
  }
  function copySqlModal() {
    navigator.clipboard.writeText(SUPABASE_SQL);
    Toast.show('SQL已複製到剪貼簿', 'success');
  }

  function clearLocal() {
    if (!confirm('確定清除所有本機資料？此操作無法復原。')) return;
    DB.clearAll().then(() => { Toast.show('本機資料已清除', 'success'); UploadUI.refreshStats(); });
  }

  function exportLocal() {
    Promise.all([
      localDB.weather.toArray(),
      localDB.rainfall.toArray()
    ]).then(([w, r]) => {
      const data = { weather: w, rainfall: r, exportedAt: new Date().toISOString() };
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href = url;
      a.download = `fri_weather_export_${new Date().toISOString().slice(0,10)}.json`;
      a.click(); URL.revokeObjectURL(url);
    });
  }

  return { init, toggleKey, saveCWA, saveSupabase, testSupabase, showSqlScript, copySql, copySqlModal, clearLocal, exportLocal };
})();
