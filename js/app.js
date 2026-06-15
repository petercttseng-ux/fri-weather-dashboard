/* ── Toast Helper ── */
const Toast = {
  show(msg, type = 'info') {
    const colors = { success:'bg-success', danger:'bg-danger', warning:'bg-warning text-dark', info:'bg-primary' };
    const id = 'toast_' + Date.now();
    const html = `<div id="${id}" class="toast align-items-center text-white ${colors[type]||'bg-secondary'} border-0 show" role="alert">
      <div class="d-flex"><div class="toast-body">${esc(msg)}</div>
      <button type="button" class="btn-close btn-close-white me-2 m-auto" onclick="document.getElementById('${id}').remove()"></button>
      </div></div>`;
    const container = document.getElementById('toastContainer');
    if (container) {
      container.insertAdjacentHTML('beforeend', html);
      setTimeout(() => document.getElementById(id)?.remove(), 5000);
    }
  }
};

/* ── Main Application ── */
const App = (() => {
  let _refreshTimer = null;
  let _weatherData  = [];
  let _rainfallData = [];

  async function init() {
    // load settings into UI
    SettingsUI.init();

    // init flatpickr
    QueryUI.init();

    // refresh DB stats
    await UploadUI.refreshStats();

    // auto-fetch
    await fetchAll();

    // schedule auto-refresh
    scheduleRefresh();
  }

  async function fetchAll() {
    setStatus('loading', '更新中...');
    const btnRefresh = document.getElementById('btnRefresh');
    if (btnRefresh) { btnRefresh.disabled = true; btnRefresh.innerHTML = '<span class="spinner-border spinner-border-sm"></span>'; }

    let weatherOk = false, rainfallOk = false;
    try {
      _weatherData = await API.fetchWeather();
      WeatherUI.render(_weatherData);
      weatherOk = true;
      // save to DB separately so Supabase errors don't block display
      DB.saveWeather(_weatherData).catch(e => {
        console.warn('[Supabase] weather save skipped:', e.message);
        _showDbHint();
      });
    } catch (e) {
      console.error('Weather fetch error:', e);
      Toast.show('氣象資料取得失敗：' + e.message, 'danger');
    }

    try {
      _rainfallData = await API.fetchRainfall();
      RainfallUI.render(_rainfallData);
      RankingUI.render();
      rainfallOk = true;
      DB.saveRainfall(_rainfallData).catch(e => {
        console.warn('[Supabase] rainfall save skipped:', e.message);
        _showDbHint();
      });
    } catch (e) {
      console.error('Rainfall fetch error:', e);
      Toast.show('雨量資料取得失敗：' + e.message, 'danger');
    }

    if (weatherOk && rainfallOk) {
      setStatus('online', '資料正常');
      Toast.show(`已更新：氣象 ${_weatherData.length} 站 / 雨量 ${_rainfallData.length} 站`, 'success');
    } else if (!weatherOk && !rainfallOk) {
      setStatus('offline', '連線失敗');
    } else {
      setStatus('online', '部分資料');
    }

    const now = new Date();
    const timeEl = document.getElementById('lastUpdateTime');
    if (timeEl) timeEl.textContent = `最後更新：${now.toLocaleTimeString('zh-TW')}`;

    if (btnRefresh) { btnRefresh.disabled = false; btnRefresh.innerHTML = '<i class="bi bi-arrow-clockwise"></i> 更新'; }

    // prune old local data
    await DB.pruneLocal();
    await UploadUI.refreshStats();
  }

  function scheduleRefresh() {
    if (_refreshTimer) clearInterval(_refreshTimer);
    const mins = parseInt(Config.get('autoRefreshMin')) || 0;
    if (mins > 0) {
      _refreshTimer = setInterval(fetchAll, mins * 60 * 1000);
    }
  }

  function switchTab(el, tabId) {
    document.querySelectorAll('.tab-pane').forEach(p => p.classList.add('d-none'));
    document.querySelectorAll('.fri-nav-pills .nav-link').forEach(a => a.classList.remove('active'));
    const pane = document.getElementById(tabId);
    if (pane) pane.classList.remove('d-none');
    el.classList.add('active');

    // Trigger lazy renders
    if (tabId === 'tabRanking') RankingUI.render();
    if (tabId === 'tabUpload')  UploadUI.refreshStats();
  }

  let _dbHintShown = false;
  function _showDbHint() {
    if (_dbHintShown) return;
    _dbHintShown = true;
    const el = document.getElementById('dbHintBanner');
    if (el) el.classList.remove('d-none');
  }

  function setStatus(state, text) {
    const dot  = document.querySelector('.status-dot');
    const txt  = document.getElementById('apiStatusText');
    if (dot) { dot.className = 'status-dot ' + state; }
    if (txt) txt.textContent = text;
  }

  function getWeatherData()  { return _weatherData; }
  function getRainfallData() { return _rainfallData; }

  return { init, fetchAll, scheduleRefresh, switchTab, getWeatherData, getRainfallData };
})();

/* ── Bootstrap ── */
document.addEventListener('DOMContentLoaded', () => App.init());
