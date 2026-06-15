/* ── Settings UI ── */

/* 最精簡的 RLS 修復腳本 — 停用 RLS 並重設權限 */
const RLS_FIX_SQL = `-- ============================================================
-- 【快速修復】停用 RLS 並授予完整寫入權限
-- 在 Supabase → SQL Editor 執行此腳本即可解決 401 錯誤
-- ============================================================

-- 停用 Row Level Security（公開天氣資料不需要列層級保護）
ALTER TABLE weather_observations  DISABLE ROW LEVEL SECURITY;
ALTER TABLE rainfall_observations DISABLE ROW LEVEL SECURITY;

-- 授予 anon 角色完整讀寫權限
GRANT ALL PRIVILEGES ON TABLE weather_observations  TO anon;
GRANT ALL PRIVILEGES ON TABLE rainfall_observations TO anon;
GRANT ALL PRIVILEGES ON TABLE weather_observations  TO authenticated;
GRANT ALL PRIVILEGES ON TABLE rainfall_observations TO authenticated;

-- 授予序列（自動遞增 id）的使用權限
GRANT USAGE, SELECT, UPDATE
  ON SEQUENCE weather_observations_id_seq  TO anon, authenticated;
GRANT USAGE, SELECT, UPDATE
  ON SEQUENCE rainfall_observations_id_seq TO anon, authenticated;

-- 驗證：確認 RLS 已停用
SELECT tablename, rowsecurity
FROM pg_tables
WHERE tablename IN ('weather_observations','rainfall_observations');
-- rowsecurity 應顯示 false
`;

const SettingsUI = (() => {

  function init() {
    const cfg = Config.load();
    const el = id => document.getElementById(id);
    if (el('settingApiKey'))          el('settingApiKey').value          = cfg.apiKey || '';
    if (el('settingInterval'))        el('settingInterval').value        = cfg.autoRefreshMin || 30;
    if (el('settingWeatherEndpoint')) el('settingWeatherEndpoint').value = cfg.weatherEndpoint;
    if (el('settingRainfallEndpoint'))el('settingRainfallEndpoint').value= cfg.rainfallEndpoint;
    if (el('settingSupabaseUrl'))        el('settingSupabaseUrl').value        = cfg.supabaseUrl        || '';
    if (el('settingSupabaseKey'))        el('settingSupabaseKey').value        = cfg.supabaseKey        || '';
    if (el('settingSupabaseServiceKey')) el('settingSupabaseServiceKey').value = cfg.supabaseServiceKey || '';
    if (el('settingRetention'))          el('settingRetention').value          = cfg.retentionDays      || 30;
    if (el('settingApiKey'))          el('settingApiKey').type           = 'password';
  }

  function toggleKey() {
    const inp  = document.getElementById('settingApiKey');
    const icon = document.getElementById('eyeIcon');
    if (!inp) return;
    if (inp.type === 'password') { inp.type = 'text';     icon.className = 'bi bi-eye-slash'; }
    else                         { inp.type = 'password'; icon.className = 'bi bi-eye'; }
  }

  function saveCWA() {
    const el = id => document.getElementById(id)?.value?.trim();
    Config.save({
      apiKey:           el('settingApiKey'),
      autoRefreshMin:   parseInt(el('settingInterval')) || 30,
      weatherEndpoint:  el('settingWeatherEndpoint'),
      rainfallEndpoint: el('settingRainfallEndpoint')
    });
    Toast.show('CWA API 設定已儲存', 'success');
    App.scheduleRefresh();
  }

  function toggleServiceKey() {
    const inp  = document.getElementById('settingSupabaseServiceKey');
    const icon = document.getElementById('eyeServiceIcon');
    if (!inp) return;
    if (inp.type === 'password') { inp.type = 'text';     icon.className = 'bi bi-eye-slash'; }
    else                         { inp.type = 'password'; icon.className = 'bi bi-eye'; }
  }

  function saveSupabase() {
    const url        = document.getElementById('settingSupabaseUrl')?.value?.trim();
    const key        = document.getElementById('settingSupabaseKey')?.value?.trim();
    const serviceKey = document.getElementById('settingSupabaseServiceKey')?.value?.trim();
    Config.save({ supabaseUrl: url, supabaseKey: key, supabaseServiceKey: serviceKey });
    resetSupabaseClient();
    const hasService = !!serviceKey;
    Toast.show(
      hasService
        ? '✓ Supabase 設定已儲存（使用 service_role key，可繞過 RLS）'
        : 'Supabase 設定已儲存（僅 anon key，寫入需停用 RLS）',
      hasService ? 'success' : 'warning'
    );
  }

  async function testSupabase() {
    const url = document.getElementById('settingSupabaseUrl')?.value?.trim();
    const key = document.getElementById('settingSupabaseKey')?.value?.trim();
    if (!url || !key) { Toast.show('請先填入 Supabase URL 及 Key', 'warning'); return; }
    Config.save({ supabaseUrl: url, supabaseKey: key });
    resetSupabaseClient();
    Toast.show('連線測試中...', 'info');

    const result = await DB.testSupabase();
    if (result.ok) {
      Toast.show('✓ Supabase 連線成功！資料表結構正常。', 'success');
    } else {
      const hint = result.msg && result.msg.includes('42501')
        ? '（RLS 權限問題）請複製「快速修復SQL」並在 Supabase SQL Editor 執行。'
        : result.msg && result.msg.includes('does not exist')
          ? '（資料表不存在）請先執行「完整建表SQL腳本」。'
          : '';
      Toast.show(`✗ 連線失敗：${result.msg} ${hint}`, 'danger');
    }
  }

  function showSqlScript() {
    const box = document.getElementById('sqlScriptBox');
    const txt = document.getElementById('sqlScriptText');
    if (!box || !txt) return;
    txt.value = SUPABASE_SQL;
    box.classList.remove('d-none');
  }

  function showRlsFix() {
    const box = document.getElementById('rlsFixBox');
    const txt = document.getElementById('rlsFixText');
    if (txt) txt.value = RLS_FIX_SQL;
    if (box) box.classList.remove('d-none');
    if (txt) setTimeout(() => txt.select(), 50);
  }

  function copyRlsFix() {
    navigator.clipboard.writeText(RLS_FIX_SQL);
    Toast.show('快速修復SQL已複製到剪貼簿！請貼入 Supabase SQL Editor 執行。', 'success');
  }

  function copySql() {
    const txt = document.getElementById('sqlScriptText');
    if (txt) { navigator.clipboard.writeText(txt.value); Toast.show('完整建表SQL已複製', 'success'); }
  }

  function clearLocal() {
    if (!confirm('確定清除所有本機資料？此操作無法復原。')) return;
    DB.clearAll().then(() => { Toast.show('本機資料已清除', 'success'); UploadUI.refreshStats(); });
  }

  function exportLocal() {
    Promise.all([localDB.weather.toArray(), localDB.rainfall.toArray()])
      .then(([w, r]) => {
        const blob = new Blob([JSON.stringify({ weather: w, rainfall: r, exportedAt: new Date().toISOString() }, null, 2)], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `fri_weather_export_${new Date().toISOString().slice(0,10)}.json`;
        a.click();
      });
  }

  return { init, toggleKey, toggleServiceKey, saveCWA, saveSupabase, testSupabase, showSqlScript, showRlsFix, copyRlsFix, copySql, clearLocal, exportLocal };
})();
