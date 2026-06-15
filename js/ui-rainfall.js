/* ── Rainfall Table UI ── */
const RainfallUI = (() => {
  let _data = [], _filtered = [], _sortKey = '', _sortAsc = true;

  function render(data) {
    _data = data || _data;
    _filtered = _data.filter(_currentFilter);
    _applySort();
    _draw();
    _updateKPI();
  }

  let _currentFilter = () => true;

  function filter(val) {
    const v = val.trim().toLowerCase();
    _currentFilter = !v ? () => true
      : r => (r.stationName||'').toLowerCase().includes(v)
           || (r.county||'').toLowerCase().includes(v)
           || (r.town||'').toLowerCase().includes(v);
    render();
  }

  function sort(key) {
    if (_sortKey === key) { _sortAsc = !_sortAsc; }
    else { _sortKey = key; _sortAsc = true; }
    document.querySelectorAll('#rainfallTable .sort-icon').forEach(el => {
      el.className = 'bi bi-arrow-down-up sort-icon';
    });
    const th = [...document.querySelectorAll('#rainfallTable thead th')]
      .find(t => t.getAttribute('onclick')?.includes(`'${key}'`));
    if (th) {
      const icon = th.querySelector('.sort-icon');
      if (icon) icon.className = `bi bi-arrow-${_sortAsc?'up':'down'} sort-icon ${_sortAsc?'asc':'desc'}`;
    }
    render();
  }

  function _applySort() {
    if (!_sortKey) return;
    _filtered.sort((a,b) => {
      let av = a[_sortKey] ?? 0, bv = b[_sortKey] ?? 0;
      if (typeof av==='number') return _sortAsc ? av-bv : bv-av;
      return _sortAsc ? String(av).localeCompare(String(bv)) : String(bv).localeCompare(String(av));
    });
  }

  function _draw() {
    const tbody = document.getElementById('rainfallBody');
    const count = document.getElementById('rainfallCount');
    if (!tbody) return;
    count.textContent = `${_filtered.length} 站`;
    if (!_filtered.length) {
      tbody.innerHTML = '<tr><td colspan="12" class="text-center py-4 text-muted">無資料</td></tr>';
      return;
    }
    tbody.innerHTML = _filtered.map(r => {
      const r24cls = r.rain24hr >= 250 ? 'text-danger fw-bold' : r.rain24hr >= 80 ? 'text-warning' : '';
      const r48cls = r.rain48hr >= 650 ? 'text-danger fw-bold' : r.rain48hr >= 200 ? 'text-warning' : '';
      return `<tr>
        <td><strong>${esc(r.stationName)}</strong></td>
        <td>${esc(r.county)}</td>
        <td>${esc(r.town)}</td>
        <td>${fmt(r.rain10Min)}</td>
        <td>${fmt(r.rain1hr)}</td>
        <td>${fmt(r.rain3hr)}</td>
        <td>${fmt(r.rain6hr)}</td>
        <td>${fmt(r.rain12hr)}</td>
        <td class="${r24cls}">${fmt(r.rain24hr)}${r.rain24hr>=250?' <span class="badge-alert">警戒</span>':''}</td>
        <td class="${r48cls}">${fmt(r.rain48hr)}${r.rain48hr>=650?' <span class="badge-alert">警戒</span>':''}</td>
        <td>${fmt(r.rainMonth)}</td>
        <td class="text-muted">${fmtTime(r.obsTime)}</td>
      </tr>`;
    }).join('');
  }

  function _updateKPI() {
    const v10  = _data.map(r=>r.rain10Min).filter(v=>v!==null);
    const v1h  = _data.map(r=>r.rain1hr).filter(v=>v!==null);
    const v24h = _data.map(r=>r.rain24hr).filter(v=>v!==null);
    const v48h = _data.map(r=>r.rain48hr).filter(v=>v!==null);
    const el = id => document.getElementById(id);
    if (el('kpiRain10m'))  el('kpiRain10m').textContent  = v10.length  ? Math.max(...v10).toFixed(1)  : '—';
    if (el('kpiRain1hMax'))el('kpiRain1hMax').textContent= v1h.length  ? Math.max(...v1h).toFixed(1)  : '—';
    if (el('kpiRain24hMax'))el('kpiRain24hMax').textContent=v24h.length ? Math.max(...v24h).toFixed(1) : '—';
    if (el('kpiRain48hMax'))el('kpiRain48hMax').textContent=v48h.length ? Math.max(...v48h).toFixed(1) : '—';
  }

  function getData() { return _data; }

  return { render, filter, sort, getData };
})();
