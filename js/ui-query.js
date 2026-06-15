/* ── Time-range Cumulative Rainfall Query UI ── */
const QueryUI = (() => {
  let _fp_start, _fp_end;

  function init() {
    const opts = { locale: 'zh_tw', enableTime: true, dateFormat: 'Y-m-d H:i', time_24hr: true };
    _fp_start = flatpickr('#queryStart', opts);
    _fp_end   = flatpickr('#queryEnd',   opts);
    // default: last 24h
    const now = new Date();
    _fp_end.setDate(now, true);
    _fp_start.setDate(new Date(now - 24*3600*1000), true);
  }

  function setQuick(hours) {
    if (!hours) return;
    const now = new Date();
    _fp_end.setDate(now, true);
    _fp_start.setDate(new Date(now - hours*3600*1000), true);
  }

  async function query() {
    const s = _fp_start?.selectedDates[0];
    const e = _fp_end?.selectedDates[0];
    if (!s || !e) { Toast.show('請選擇查詢時段', 'warning'); return; }
    if (s >= e) { Toast.show('開始時間必須早於結束時間', 'danger'); return; }

    Toast.show('查詢中，請稍候...', 'info');

    try {
      const records = await DB.queryRainfallRange(s.getTime(), e.getTime());
      if (!records.length) {
        Toast.show('查詢時段內無資料。請先載入即時資料或上傳歷史資料。', 'warning');
        _drawEmpty();
        return;
      }

      // Aggregate by station
      const stationMap = {};
      records.forEach(r => {
        const key = r.stationId || r.station_id || r.stationName;
        if (!stationMap[key]) {
          stationMap[key] = {
            county: r.county, town: r.town,
            station: r.stationName || r.station_name || key,
            sumRain: 0, count: 0
          };
        }
        const val = parseFloat(r.rain1hr || r.rain_1hr || 0);
        if (!isNaN(val)) { stationMap[key].sumRain += val; stationMap[key].count++; }
      });

      const stations = Object.values(stationMap).sort((a,b) => b.sumRain - a.sumRain);

      // Duration in hours
      const hrs = (e - s) / 3600000;
      const label24 = hrs <= 24 ? '累積雨量' : '24小時累積';
      const label48 = hrs <= 48 ? '累積雨量' : '48小時累積';

      _draw('query24Body', stations, 24);
      _draw('query48Body', stations, 48);
      Toast.show(`查詢完成，共 ${stations.length} 測站`, 'success');
    } catch (err) {
      Toast.show('查詢失敗：' + err.message, 'danger');
    }
  }

  function _draw(bodyId, stations, threshold) {
    const tbody = document.getElementById(bodyId);
    if (!tbody) return;
    tbody.innerHTML = stations.map((r, i) => {
      const val = r.sumRain;
      const isAlert = threshold === 24 ? val >= 250 : val >= 650;
      const trCls = isAlert ? (threshold===24?'alert-24h':'alert-48h') : '';
      const badge = isAlert
        ? `<span class="badge-alert"><i class="bi bi-exclamation-triangle-fill me-1"></i>警戒</span>`
        : '<span class="badge-ok">正常</span>';
      return `<tr class="${trCls}">
        <td class="${rankCls(i)}">${i+1}</td>
        <td>${esc(r.county)}</td>
        <td><strong>${esc(r.town)}</strong></td>
        <td class="text-muted small">${esc(r.station)}</td>
        <td class="${isAlert?'text-danger fw-bold':''}">${val.toFixed(1)}</td>
        <td>${badge}</td>
      </tr>`;
    }).join('') || '<tr><td colspan="6" class="text-center text-muted">無資料</td></tr>';
  }

  function _drawEmpty() {
    ['query24Body','query48Body'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.innerHTML = '<tr><td colspan="6" class="text-center text-muted py-3">查詢時段內無資料</td></tr>';
    });
  }

  function exportCSV() {
    const rows = [...document.querySelectorAll('#query24Body tr')];
    const lines = ['排名,縣市,鄉鎮,測站,累積雨量(mm),警戒'];
    rows.forEach(tr => {
      const cells = [...tr.querySelectorAll('td')].map(td => td.textContent.trim().replace(/,/g,''));
      if (cells.length) lines.push(cells.join(','));
    });
    const blob = new Blob(['﻿'+lines.join('\n')], { type:'text/csv;charset=utf-8' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url; a.download = `rainfall_query_${new Date().toISOString().slice(0,10)}.csv`;
    a.click(); URL.revokeObjectURL(url);
  }

  function rankCls(i) {
    if (i===0) return 'rank-1'; if (i===1) return 'rank-2'; if (i===2) return 'rank-3'; return '';
  }

  return { init, setQuick, query, exportCSV };
})();
