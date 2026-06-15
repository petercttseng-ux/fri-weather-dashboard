/* ── County / Township Ranking UI ── */
const RankingUI = (() => {

  function render() {
    const data = RainfallUI.getData();
    if (!data.length) {
      ['county24Body','county48Body','town24Body','town48Body']
        .forEach(id => { const el=document.getElementById(id); if(el) el.innerHTML='<tr><td colspan="6" class="text-center py-3 text-muted">請先載入即時雨量資料</td></tr>'; });
      return;
    }

    const countyMap24 = {}, countyMap48 = {};
    const townList24 = [], townList48 = [];

    data.forEach(r => {
      const c = r.county || '未知';
      const t = r.town   || '未知';
      const v24 = r.rain24hr ?? 0;
      const v48 = r.rain48hr ?? 0;

      // County 24h
      if (!countyMap24[c]) countyMap24[c] = { county: c, max: 0, sum: 0, cnt: 0 };
      countyMap24[c].max = Math.max(countyMap24[c].max, v24);
      countyMap24[c].sum += v24; countyMap24[c].cnt++;

      // County 48h
      if (!countyMap48[c]) countyMap48[c] = { county: c, max: 0, sum: 0, cnt: 0 };
      countyMap48[c].max = Math.max(countyMap48[c].max, v48);
      countyMap48[c].sum += v48; countyMap48[c].cnt++;

      townList24.push({ county:c, town:t, station:r.stationName, val:v24 });
      townList48.push({ county:c, town:t, station:r.stationName, val:v48 });
    });

    const c24 = Object.values(countyMap24).sort((a,b)=>b.max-a.max);
    const c48 = Object.values(countyMap48).sort((a,b)=>b.max-a.max);
    townList24.sort((a,b)=>b.val-a.val);
    townList48.sort((a,b)=>b.val-a.val);

    _drawCounty('county24Body', c24, 24);
    _drawCounty('county48Body', c48, 48);
    _drawTown('town24Body', townList24.slice(0,30), 24);
    _drawTown('town48Body', townList48.slice(0,30), 48);
  }

  function _drawCounty(bodyId, rows, hr) {
    const tbody = document.getElementById(bodyId);
    if (!tbody) return;
    tbody.innerHTML = rows.map((r, i) => {
      const isAlert = (hr===24 && r.max>=250) || (hr===48 && r.max>=650);
      const trCls = isAlert ? (hr===24?'alert-24h':'alert-48h') : '';
      const badge = isAlert ? `<span class="badge-alert"><i class="bi bi-exclamation-triangle-fill me-1"></i>警戒</span>` : '<span class="badge-ok">正常</span>';
      return `<tr class="${trCls}">
        <td class="${rankCls(i)}">${i+1}</td>
        <td><strong>${esc(r.county)}</strong></td>
        <td>${r.cnt}</td>
        <td class="${isAlert?'text-danger fw-bold':''}">${r.max.toFixed(1)}</td>
        <td>${(r.sum/r.cnt).toFixed(1)}</td>
        <td>${badge}</td>
      </tr>`;
    }).join('') || '<tr><td colspan="6" class="text-center text-muted">無資料</td></tr>';
  }

  function _drawTown(bodyId, rows, hr) {
    const tbody = document.getElementById(bodyId);
    if (!tbody) return;
    tbody.innerHTML = rows.map((r, i) => {
      const isAlert = (hr===24 && r.val>=250) || (hr===48 && r.val>=650);
      const trCls = isAlert ? (hr===24?'alert-24h':'alert-48h') : '';
      const badge = isAlert ? `<span class="badge-alert"><i class="bi bi-exclamation-triangle-fill me-1"></i>警戒</span>` : '<span class="badge-ok">正常</span>';
      return `<tr class="${trCls}">
        <td class="${rankCls(i)}">${i+1}</td>
        <td>${esc(r.county)}</td>
        <td><strong>${esc(r.town)}</strong></td>
        <td class="text-muted small">${esc(r.station)}</td>
        <td class="${isAlert?'text-danger fw-bold':''}">${r.val.toFixed(1)}</td>
        <td>${badge}</td>
      </tr>`;
    }).join('') || '<tr><td colspan="6" class="text-center text-muted">無資料</td></tr>';
  }

  function rankCls(i) {
    if (i===0) return 'rank-1'; if (i===1) return 'rank-2'; if (i===2) return 'rank-3';
    return '';
  }

  return { render };
})();
