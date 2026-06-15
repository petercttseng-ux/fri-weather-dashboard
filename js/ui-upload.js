/* ── Historical Data Upload UI ── */
const UploadUI = (() => {

  async function upload() {
    const fileInput = document.getElementById('uploadFile');
    const type = document.getElementById('uploadType').value;
    const note = document.getElementById('uploadNote').value;
    const file = fileInput?.files?.[0];
    if (!file) { Toast.show('請選擇要上傳的檔案', 'warning'); return; }

    const ext = file.name.split('.').pop().toLowerCase();
    if (!['csv','json'].includes(ext)) { Toast.show('僅支援 CSV 或 JSON 格式', 'danger'); return; }

    _showProgress(true);
    _setProgress(10, '讀取檔案...');

    try {
      const text = await file.text();
      let records = ext === 'csv' ? parseCSV(text, type) : parseJSON(text, type);
      if (!records.length) throw new Error('檔案中未找到有效資料列');

      _setProgress(40, `解析完成，共 ${records.length} 筆資料，儲存中...`);

      const BATCH = 200;
      for (let i = 0; i < records.length; i += BATCH) {
        const batch = records.slice(i, i + BATCH);
        if (type === 'rainfall') await DB.saveRainfall(batch);
        else await DB.saveWeather(batch);
        const pct = 40 + Math.round((i / records.length) * 55);
        _setProgress(pct, `已存入 ${Math.min(i+BATCH, records.length)} / ${records.length} 筆`);
      }

      await localDB.uploads.add({ type, uploadedAt: new Date().toISOString(), note, count: records.length, filename: file.name });
      _setProgress(100, `上傳完成！共寫入 ${records.length} 筆資料`);
      Toast.show(`上傳完成！共寫入 ${records.length} 筆資料`, 'success');
      fileInput.value = '';
      await refreshStats();
    } catch (err) {
      _setProgress(0, '');
      _showProgress(false);
      Toast.show('上傳失敗：' + err.message, 'danger');
    }
  }

  function parseCSV(text, type) {
    const lines = text.replace(/\r/g,'').split('\n').filter(l=>l.trim());
    if (lines.length < 2) return [];
    const headers = lines[0].split(',').map(h=>h.trim());
    const col = k => headers.findIndex(h => h.toLowerCase() === k.toLowerCase());

    const timeCol  = col('ObsTime') >= 0 ? col('ObsTime') : col('DateTime');
    const stIdCol  = col('StationId');
    const nameCol  = col('StationName');
    const countyCol= col('County');
    const townCol  = col('Town');

    return lines.slice(1).map(line => {
      const cells = line.split(',').map(c=>c.trim());
      const base = {
        obsTime:     cells[timeCol]  || new Date().toISOString(),
        stationId:   cells[stIdCol]  || 'UPLOAD',
        stationName: cells[nameCol]  || '',
        county:      cells[countyCol]|| '',
        town:        cells[townCol]  || ''
      };
      if (type === 'rainfall') {
        return { ...base,
          rain10Min: toN(cells[col('Rain10Min')]), rain1hr:  toN(cells[col('Rain1hr')]),
          rain3hr:   toN(cells[col('Rain3hr')]),   rain6hr:  toN(cells[col('Rain6hr')]),
          rain12hr:  toN(cells[col('Rain12hr')]),  rain24hr: toN(cells[col('Rain24hr')]),
          rain48hr:  toN(cells[col('Rain48hr')]),  rainMonth:toN(cells[col('RainMonth')])
        };
      }
      return { ...base,
        temperature:      toN(cells[col('Temperature')]),
        relativeHumidity: toN(cells[col('RelativeHumidity')]),
        pressure:         toN(cells[col('Pressure')]),
        windSpeed:        toN(cells[col('WindSpeed')]),
        windDirection:    toN(cells[col('WindDirection')]),
        precipitation:    toN(cells[col('Precipitation')])
      };
    }).filter(r=>r.obsTime);
  }

  function parseJSON(text, type) {
    const arr = JSON.parse(text);
    if (!Array.isArray(arr)) throw new Error('JSON 格式需為陣列');
    return arr;
  }

  function toN(v) { const n=parseFloat(v); return isNaN(n)?null:n; }

  async function refreshStats() {
    const el = document.getElementById('dbStats');
    if (!el) return;
    try {
      const s = await DB.getStats();
      const uploads = await localDB.uploads.orderBy('uploadedAt').reverse().limit(5).toArray();
      el.innerHTML = `
        <div class="row g-2 mb-3">
          <div class="col-6"><div class="border rounded p-2 text-center">
            <div class="fw-bold text-primary fs-4">${s.wCount.toLocaleString()}</div>
            <div class="text-muted small">氣象資料筆數</div>
          </div></div>
          <div class="col-6"><div class="border rounded p-2 text-center">
            <div class="fw-bold text-info fs-4">${s.rCount.toLocaleString()}</div>
            <div class="text-muted small">雨量資料筆數</div>
          </div></div>
        </div>
        ${s.rFirst ? `<div class="small mb-1"><i class="bi bi-calendar-range me-1 text-muted"></i><strong>雨量資料區間：</strong>${fmtTime(s.rFirst?.obsTime)} ～ ${fmtTime(s.rLast?.obsTime)}</div>` : ''}
        ${s.wFirst ? `<div class="small mb-2"><i class="bi bi-calendar-range me-1 text-muted"></i><strong>氣象資料區間：</strong>${fmtTime(s.wFirst?.obsTime)} ～ ${fmtTime(s.wLast?.obsTime)}</div>` : ''}
        ${uploads.length ? `<div class="small text-muted mt-2"><strong>最近上傳：</strong></div>
          <ul class="list-unstyled small">${uploads.map(u=>`<li class="text-muted"><i class="bi bi-file-earmark-text me-1"></i>${u.filename||'檔案'} — ${u.count}筆 (${fmtTime(u.uploadedAt)})</li>`).join('')}</ul>` : ''}`;
    } catch (e) {
      el.innerHTML = '<div class="text-muted small">無法讀取資料庫狀態</div>';
    }
  }

  function _showProgress(show) {
    const el = document.getElementById('uploadProgress');
    if (el) el.classList.toggle('d-none', !show);
  }
  function _setProgress(pct, msg) {
    const bar = document.getElementById('uploadBar');
    const sta = document.getElementById('uploadStatus');
    if (bar) { bar.style.width = pct+'%'; bar.textContent = pct+'%'; }
    if (sta) sta.textContent = msg;
  }

  function downloadTemplate(type) {
    let header, sample;
    if (type === 'rainfall') {
      header = 'ObsTime,StationId,StationName,County,Town,Rain10Min,Rain1hr,Rain3hr,Rain6hr,Rain12hr,Rain24hr,Rain48hr,RainMonth';
      sample = '2024-07-25T10:00:00,C0D660,彭佳嶼,基隆市,中正區,0.5,5.2,12.0,25.3,45.0,88.5,120.0,500.0';
    } else {
      header = 'ObsTime,StationId,StationName,County,Town,Temperature,RelativeHumidity,Pressure,WindSpeed,WindDirection,Precipitation';
      sample = '2024-07-25T10:00:00,466920,板橋,新北市,板橋區,32.5,78,1010.2,3.2,180,0.0';
    }
    const csv = `﻿${header}\n${sample}\n`;
    const blob = new Blob([csv], { type:'text/csv;charset=utf-8' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url; a.download = `template_${type}.csv`; a.click();
    URL.revokeObjectURL(url);
  }

  return { upload, refreshStats, downloadTemplate };
})();
