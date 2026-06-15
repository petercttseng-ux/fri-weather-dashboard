/* ── Weather Table UI ── */
const WeatherUI = (() => {
  let _data = [], _filtered = [], _sortKey = '', _sortAsc = true;

  function render(data) {
    _data = data || _data;
    _filtered = _data.filter(_currentFilter);
    _applySort();
    _draw();
    _updateKPI();
  }

  let _currentFilter = () => true;
  let _searchVal = '';

  function filter(val) {
    _searchVal = val.trim().toLowerCase();
    _currentFilter = !_searchVal ? () => true
      : r => (r.stationName || '').toLowerCase().includes(_searchVal)
           || (r.county     || '').toLowerCase().includes(_searchVal)
           || (r.town       || '').toLowerCase().includes(_searchVal);
    render();
  }

  function sort(key) {
    if (_sortKey === key) { _sortAsc = !_sortAsc; }
    else { _sortKey = key; _sortAsc = true; }
    // update icons
    document.querySelectorAll('#weatherTable .sort-icon').forEach(el => {
      el.className = 'bi bi-arrow-down-up sort-icon';
    });
    const th = [...document.querySelectorAll('#weatherTable thead th')]
      .find(t => t.getAttribute('onclick')?.includes(`'${key}'`));
    if (th) {
      const icon = th.querySelector('.sort-icon');
      if (icon) icon.className = `bi bi-arrow-${_sortAsc ? 'up' : 'down'} sort-icon ${_sortAsc ? 'asc' : 'desc'}`;
    }
    render();
  }

  function _applySort() {
    if (!_sortKey) return;
    _filtered.sort((a, b) => {
      let av = a[_sortKey] ?? '', bv = b[_sortKey] ?? '';
      if (typeof av === 'number' && typeof bv === 'number') return _sortAsc ? av - bv : bv - av;
      return _sortAsc ? String(av).localeCompare(String(bv)) : String(bv).localeCompare(String(av));
    });
  }

  function _draw() {
    const tbody = document.getElementById('weatherBody');
    const count = document.getElementById('weatherCount');
    if (!tbody) return;
    count.textContent = `${_filtered.length} 站`;
    if (!_filtered.length) {
      tbody.innerHTML = '<tr><td colspan="12" class="text-center py-4 text-muted">無資料</td></tr>';
      return;
    }
    tbody.innerHTML = _filtered.map(r => `<tr>
      <td><strong>${esc(r.stationName)}</strong></td>
      <td>${esc(r.county)}</td>
      <td>${esc(r.town)}</td>
      <td class="${tempClass(r.temperature)}">${fmt(r.temperature,'°')}</td>
      <td>${fmt(r.relativeHumidity,'%')}</td>
      <td>${fmt(r.pressure)}</td>
      <td>${fmt(r.windSpeed)}</td>
      <td>${fmt(r.windDirection,'°')}</td>
      <td>${fmt(r.gustInfo)}</td>
      <td class="${rainClass(r.precipitation)}">${fmt(r.precipitation)}</td>
      <td>${fmt(r.sunshineDuration)}</td>
      <td class="text-muted">${fmtTime(r.obsTime)}</td>
    </tr>`).join('');
  }

  function _updateKPI() {
    const temps = _data.map(r => r.temperature).filter(v => v !== null);
    const humis = _data.map(r => r.relativeHumidity).filter(v => v !== null);
    const winds = _data.map(r => r.windSpeed).filter(v => v !== null);
    const rains = _data.map(r => r.precipitation).filter(v => v !== null);
    setKPI('kpiTemp',   temps.length ? Math.max(...temps).toFixed(1) : '—');
    setKPI('kpiHumi',   humis.length ? (humis.reduce((a,b)=>a+b,0)/humis.length).toFixed(0) : '—');
    setKPI('kpiWind',   winds.length ? Math.max(...winds).toFixed(1) : '—');
    setKPI('kpiRain1h', rains.length ? Math.max(...rains).toFixed(1) : '—');
  }

  function tempClass(v) { if (v===null) return ''; return v>=35?'text-danger fw-bold':v<=10?'text-primary':''; }
  function rainClass(v) { if (v===null) return ''; return v>=10?'text-danger fw-bold':v>=1?'text-warning':''; }

  return { render, filter, sort };
})();

/* helpers */
function fmt(v, suffix='') {
  return v === null || v === undefined ? '<span class="text-muted">—</span>' : `${v}${suffix}`;
}
function fmtTime(t) {
  if (!t) return '—';
  try { return new Date(t).toLocaleString('zh-TW',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}); }
  catch { return t; }
}
function esc(s) { return (s||'').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function setKPI(id, val) {
  const el = document.getElementById(id);
  if (el) el.querySelector('.kpi-val').textContent = val;
}
