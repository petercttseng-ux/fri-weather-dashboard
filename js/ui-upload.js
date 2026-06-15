/* ── Historical Data Upload UI ── */
const UploadUI = (() => {

  async function upload() {
    const fileInput = document.getElementById('uploadFile');
    const type      = document.getElementById('uploadType').value;
    const note      = document.getElementById('uploadNote').value;
    const file      = fileInput?.files?.[0];
    if (!file) { Toast.show('請選擇要上傳的檔案', 'warning'); return; }

    const ext = file.name.split('.').pop().toLowerCase();
    if (!['csv', 'json'].includes(ext)) {
      Toast.show('僅支援 CSV 或 JSON 格式', 'danger'); return;
    }

    _showProgress(true);
    _setProgress(5, '讀取檔案...');

    let text;
    try {
      text = await file.text();
    } catch (e) {
      _fail('無法讀取檔案：' + e.message); return;
    }

    let records;
    try {
      records = ext === 'csv' ? parseCSV(text, type) : parseJSON(text, type);
    } catch (e) {
      _fail('解析失敗：' + e.message); return;
    }

    if (!records.length) {
      _fail('檔案中未找到有效資料列。請確認欄位名稱符合範本格式。'); return;
    }

    _setProgress(30, `解析完成，共 ${records.length} 筆，寫入本機資料庫...`);

    // ── 1. Save to local IndexedDB (always, never throws to UI) ──
    let localOk = 0;
    const BATCH = 300;
    try {
      for (let i = 0; i < records.length; i += BATCH) {
        const batch = records.slice(i, i + BATCH);
        await _saveLocal(type, batch);
        localOk += batch.length;
        const pct = 30 + Math.round((localOk / records.length) * 50);
        _setProgress(pct, `已存入本機 ${localOk} / ${records.length} 筆`);
      }
    } catch (e) {
      _fail('本機儲存失敗：' + e.message); return;
    }

    // ── 2. Try Supabase (non-blocking, errors shown but don't abort) ──
    _setProgress(85, '嘗試同步至雲端資料庫...');
    let cloudMsg = '';
    try {
      for (let i = 0; i < records.length; i += BATCH) {
        const batch = records.slice(i, i + BATCH);
        if (type === 'rainfall') await DB.saveRainfall(batch);
        else                     await DB.saveWeather(batch);
      }
      cloudMsg = '，並同步至 Supabase 雲端';
    } catch (e) {
      cloudMsg = '（雲端同步失敗，已儲存至本機）';
      console.warn('[Upload] Supabase sync skipped:', e.message);
    }

    // ── 3. Record upload log ──
    try {
      await localDB.uploads.add({
        type, uploadedAt: new Date().toISOString(),
        note, count: localOk, filename: file.name
      });
    } catch (_) {}

    _setProgress(100, `完成！共寫入 ${localOk} 筆${cloudMsg}`);
    Toast.show(`上傳完成：${localOk} 筆資料已儲存${cloudMsg}`, 'success');
    if (fileInput) fileInput.value = '';
    await refreshStats();
  }

  /* Save batch to IndexedDB only */
  async function _saveLocal(type, batch) {
    if (type === 'rainfall') {
      await localDB.rainfall.bulkPut(batch.map(r => ({
        stationId: r.stationId || 'UPLOAD',
        obsTime:   r.obsTime   || new Date().toISOString(),
        county:    r.county    || '',
        town:      r.town      || '',
        data:      r
      })));
    } else {
      await localDB.weather.bulkPut(batch.map(r => ({
        stationId: r.stationId || 'UPLOAD',
        obsTime:   r.obsTime   || new Date().toISOString(),
        county:    r.county    || '',
        town:      r.town      || '',
        data:      r
      })));
    }
  }

  /* ── CSV Parser (auto-detects CWA MH format) ── */
  function parseCSV(text, type) {
    const clean = text.replace(/^﻿/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    const lines  = clean.split('\n');

    // ── Detect CWA MH Multifield Hourly Format ──
    // Header comment lines start with '*', column title line starts with '#'
    if (lines[0]?.trim().startsWith('*') || lines[0]?.trim().startsWith('﻿*')) {
      return parseCWA_MH(lines, type);
    }

    // ── Standard CSV (first line = headers) ──
    const dataLines = lines.filter(l => l.trim() && !l.trim().startsWith('#'));
    if (dataLines.length < 2) throw new Error('CSV 至少需要標題列與一筆資料');
    return parseStandardCSV(dataLines, type);
  }

  /* ── CWA MH Multifield Hourly Format parser ──
     Header lines start with '*', column line starts with '#'
     Time: yyyymmddhh  Special values: -999.x / -9.x / None → null          */
  function parseCWA_MH(lines, type) {
    // find column header line (starts with '#')
    const headerLineIdx = lines.findIndex(l => l.trimStart().startsWith('#'));
    if (headerLineIdx < 0) throw new Error('CWA MH 格式：找不到以 # 開頭的欄位標題列');

    const headers = lines[headerLineIdx]
      .replace(/^#\s*/, '')
      .split(',')
      .map(h => h.trim().toLowerCase());

    // CWA code → our field name
    const CWA_MAP = {
      stno:  'stationId',
      yyyymmddhh: 'obsTime',
      ps01: 'pressure',        // 測站氣壓
      ps02: 'seaPressure',     // 海平面氣壓
      tx01: 'temperature',     // 氣溫
      rh01: 'relativeHumidity',// 相對溼度
      wd01: 'windSpeed',       // 平均風速
      wd02: 'windDirection',   // 平均風向
      wd04: 'maxWindSpeed',    // 最大平均風速
      wd07: 'gustInfo',        // 最大瞬間風速
      wd08: 'gustDirection',   // 最大瞬間風向
      pp01: 'precipitation',   // 降水量 (= rain1hr)
      pp02: 'rainHours',       // 降水時數
      ss01: 'sunshineDuration',// 日照時數
      gr01: 'radiation',       // 全天空日射量
      td01: 'dewPoint',        // 露點溫度
      vs01: 'visibility',      // 能見度
      uv01: 'uvIndex',         // 紫外線指數
    };

    const col = name => headers.indexOf(name.toLowerCase());
    const stnoIdx = col('stno');
    const timeIdx = col('yyyymmddhh');
    if (stnoIdx < 0) throw new Error('CWA MH 格式：找不到 stno（站碼）欄位');
    if (timeIdx < 0) throw new Error('CWA MH 格式：找不到 yyyymmddhh（時間）欄位');

    const parsed = [];
    for (let i = headerLineIdx + 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line || line.startsWith('*') || line.startsWith('#')) continue;

      const cells = line.split(',').map(c => c.trim());
      if (cells.length < 2) continue;

      const stno    = cells[stnoIdx];
      const rawTime = cells[timeIdx];
      if (!stno || !rawTime) continue;

      // yyyymmddhh → ISO: 2026010101 → 2026-01-01T01:00:00
      const y = rawTime.slice(0,4), mo = rawTime.slice(4,6),
            d = rawTime.slice(6,8), h  = rawTime.slice(8,10);
      const obsTime = `${y}-${mo}-${d}T${h}:00:00`;

      // Map all columns
      const rec = { stationId: stno, stationName: stno, obsTime, county: '', town: '' };
      headers.forEach((h, idx) => {
        const field = CWA_MAP[h];
        if (field) rec[field] = toN(cells[idx]);
      });

      if (type === 'rainfall') {
        // PP01（逐時降水量）→ rain1hr，用於累積雨量計算
        parsed.push({
          stationId:   rec.stationId,
          stationName: rec.stationName,
          obsTime:     rec.obsTime,
          county:      rec.county,
          town:        rec.town,
          rain1hr:     rec.precipitation,   // PP01
          rain10Min:   null,
          rain3hr:     null,
          rain6hr:     null,
          rain12hr:    null,
          rain24hr:    null,
          rain48hr:    null,
          rainMonth:   null,
        });
      } else {
        parsed.push({
          stationId:        rec.stationId,
          stationName:      rec.stationName,
          obsTime:          rec.obsTime,
          county:           rec.county,
          town:             rec.town,
          temperature:      rec.temperature,
          relativeHumidity: rec.relativeHumidity,
          pressure:         rec.pressure,
          windSpeed:        rec.windSpeed,
          windDirection:    rec.windDirection,
          gustInfo:         rec.gustInfo,
          precipitation:    rec.precipitation,
          sunshineDuration: rec.sunshineDuration,
        });
      }
    }
    if (!parsed.length) throw new Error('CWA MH 格式：標題行後無有效資料列');
    return parsed;
  }

  /* ── Standard CSV parser (first row = headers) ── */
  function parseStandardCSV(lines, type) {
    if (lines.length < 2) throw new Error('CSV 至少需要標題列與一筆資料');
    const headers = splitCSVLine(lines[0]).map(h => h.trim());

    const ALIASES = {
      obstime:         ['obstime','datetime','time','obs_time','觀測時間','時間'],
      stationid:       ['stationid','station_id','站號','stid','stno'],
      stationname:     ['stationname','station_name','站名','測站'],
      county:          ['county','縣市','縣市名稱'],
      town:            ['town','鄉鎮','鄉鎮市區'],
      rain10min:       ['rain10min','10min','r10m','10分鐘雨量'],
      rain1hr:         ['rain1hr','rain1h','1hr','1小時雨量','一小時雨量','pp01'],
      rain3hr:         ['rain3hr','rain3h','3hr','3小時雨量'],
      rain6hr:         ['rain6hr','rain6h','6hr','6小時雨量'],
      rain12hr:        ['rain12hr','rain12h','12hr','12小時雨量'],
      rain24hr:        ['rain24hr','rain24h','24hr','24小時雨量'],
      rain48hr:        ['rain48hr','rain48h','48hr','48小時雨量'],
      rainmonth:       ['rainmonth','rain_month','月累積','本月雨量'],
      temperature:     ['temperature','temp','氣溫','tx01'],
      relativehumidity:['relativehumidity','humidity','rh','相對濕度','濕度','rh01'],
      pressure:        ['pressure','airpressure','氣壓','ps01'],
      windspeed:       ['windspeed','wind_speed','風速','wd01'],
      winddirection:   ['winddirection','wind_direction','風向','wd02'],
      precipitation:   ['precipitation','precip','雨量','時雨量','pp01'],
    };

    function col(key) {
      for (const alias of (ALIASES[key] || [key])) {
        const idx = headers.findIndex(h => h.toLowerCase().replace(/\s/g,'') === alias.toLowerCase().replace(/\s/g,''));
        if (idx >= 0) return idx;
      }
      return -1;
    }

    const timeCol = col('obstime'), stIdCol = col('stationid');
    const nameCol = col('stationname'), countyCol = col('county'), townCol = col('town');
    if (timeCol < 0) throw new Error(`找不到時間欄位。實際標題：${headers.slice(0,8).join(', ')}`);

    const parsed = [];
    for (let i = 1; i < lines.length; i++) {
      const cells = splitCSVLine(lines[i]);
      if (cells.length < 2) continue;
      const rawTime = cells[timeCol]?.trim();
      if (!rawTime) continue;

      const obsTime = rawTime
        .replace(/(\d{4})\/(\d{2})\/(\d{2})\s+(\d{2}):(\d{2})/, '$1-$2-$3T$4:$5:00')
        .replace(/(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2})$/, '$1-$2-$3T$4:$5:00');

      const base = {
        obsTime,
        stationId:   cells[stIdCol]  ?.trim() || `ROW${i}`,
        stationName: cells[nameCol]  ?.trim() || '',
        county:      cells[countyCol]?.trim() || '',
        town:        cells[townCol]  ?.trim() || '',
      };

      if (type === 'rainfall') {
        parsed.push({ ...base,
          rain10Min: toN(cells[col('rain10min')]), rain1hr:  toN(cells[col('rain1hr')]),
          rain3hr:   toN(cells[col('rain3hr')]),   rain6hr:  toN(cells[col('rain6hr')]),
          rain12hr:  toN(cells[col('rain12hr')]),  rain24hr: toN(cells[col('rain24hr')]),
          rain48hr:  toN(cells[col('rain48hr')]),  rainMonth:toN(cells[col('rainmonth')]),
        });
      } else {
        parsed.push({ ...base,
          temperature:      toN(cells[col('temperature')]),
          relativeHumidity: toN(cells[col('relativehumidity')]),
          pressure:         toN(cells[col('pressure')]),
          windSpeed:        toN(cells[col('windspeed')]),
          windDirection:    toN(cells[col('winddirection')]),
          precipitation:    toN(cells[col('precipitation')]),
        });
      }
    }
    return parsed;
  }

  /* Split a CSV line respecting quoted fields */
  function splitCSVLine(line) {
    const result = [];
    let cur = '', inQ = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQ && line[i+1] === '"') { cur += '"'; i++; }
        else inQ = !inQ;
      } else if (ch === ',' && !inQ) {
        result.push(cur); cur = '';
      } else {
        cur += ch;
      }
    }
    result.push(cur);
    return result;
  }

  function parseJSON(text, type) {
    let arr;
    try { arr = JSON.parse(text); } catch (e) { throw new Error('JSON 格式錯誤：' + e.message); }
    if (!Array.isArray(arr)) throw new Error('JSON 格式需為陣列 [...]');
    if (!arr.length) throw new Error('JSON 陣列為空');
    return arr;
  }

  function toN(v) {
    if (v === undefined || v === null) return null;
    const s = String(v).trim();
    // CWA special values and common nulls
    if (s === '' || s === '-' || s === 'N/A' || s === 'None' || s === 'X') return null;
    const n = parseFloat(s);
    if (isNaN(n)) return null;
    // CWA error codes: negative values below -9
    if (n <= -9 && (s.includes('-9') || s.includes('-999'))) return null;
    return n;
  }

  /* ── Stats panel ── */
  async function refreshStats() {
    const el = document.getElementById('dbStats');
    if (!el) return;
    try {
      const s       = await DB.getStats();
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
        ${s.rFirst ? `<div class="small mb-1"><i class="bi bi-calendar-range me-1 text-muted"></i><strong>雨量資料區間：</strong>${fmtTime(s.rFirst?.obsTime)} ～ ${fmtTime(s.rLast?.obsTime)}</div>` : '<div class="small text-muted mb-1">尚無雨量資料</div>'}
        ${s.wFirst ? `<div class="small mb-2"><i class="bi bi-calendar-range me-1 text-muted"></i><strong>氣象資料區間：</strong>${fmtTime(s.wFirst?.obsTime)} ～ ${fmtTime(s.wLast?.obsTime)}</div>` : '<div class="small text-muted mb-2">尚無氣象資料</div>'}
        ${uploads.length ? `
          <hr class="my-2"/>
          <div class="small text-muted mb-1"><strong>最近上傳記錄：</strong></div>
          <ul class="list-unstyled mb-0">${uploads.map(u => `
            <li class="small text-muted"><i class="bi bi-file-earmark-check me-1 text-success"></i>
              <strong>${esc(u.filename || '檔案')}</strong> — ${u.count} 筆
              <span class="ms-1">(${fmtTime(u.uploadedAt)})</span>
            </li>`).join('')}
          </ul>` : ''}`;
    } catch (e) {
      el.innerHTML = '<div class="text-muted small">無法讀取資料庫狀態：' + esc(e.message) + '</div>';
    }
  }

  /* ── Template download ── */
  function downloadTemplate(type) {
    let header, rows;
    if (type === 'rainfall') {
      header = 'ObsTime,StationId,StationName,County,Town,Rain10Min,Rain1hr,Rain3hr,Rain6hr,Rain12hr,Rain24hr,Rain48hr,RainMonth';
      rows   = [
        '2024-07-25T08:00:00,C0D660,彭佳嶼,基隆市,中正區,0.0,0.5,1.2,3.5,10.0,25.5,40.0,380.0',
        '2024-07-25T09:00:00,C0D660,彭佳嶼,基隆市,中正區,0.5,3.0,6.5,15.2,35.0,88.5,120.0,383.0',
      ];
    } else {
      header = 'ObsTime,StationId,StationName,County,Town,Temperature,RelativeHumidity,Pressure,WindSpeed,WindDirection,Precipitation';
      rows   = [
        '2024-07-25T08:00:00,466920,板橋,新北市,板橋區,30.2,82,1010.5,2.1,180,0.0',
        '2024-07-25T09:00:00,466920,板橋,新北市,板橋區,31.5,78,1009.8,3.2,200,0.5',
      ];
    }
    const csv  = '﻿' + [header, ...rows].join('\n') + '\n';
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const a    = Object.assign(document.createElement('a'), {
      href: URL.createObjectURL(blob),
      download: `template_${type}.csv`
    });
    a.click(); URL.revokeObjectURL(a.href);
  }

  /* ── Helpers ── */
  function _fail(msg) {
    _setProgress(0, '');
    _showProgress(false);
    Toast.show('上傳失敗：' + msg, 'danger');
    console.error('[Upload]', msg);
  }
  function _showProgress(show) {
    const el = document.getElementById('uploadProgress');
    if (el) el.classList.toggle('d-none', !show);
  }
  function _setProgress(pct, msg) {
    const bar = document.getElementById('uploadBar');
    const sta = document.getElementById('uploadStatus');
    if (bar) { bar.style.width = pct + '%'; bar.textContent = pct + '%'; }
    if (sta) sta.textContent = msg;
  }

  /* 立即快照：若無資料則先從 API 抓取，再存入 DB */
  async function snapshot() {
    const statusEl = document.getElementById('snapshotStatus');
    const btn = document.querySelector('[onclick="UploadUI.snapshot()"]');
    if (statusEl) statusEl.textContent = '';
    if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span>處理中...'; }

    try {
      let w = App.getWeatherData();
      let r = App.getRainfallData();

      // 若尚無資料，自動先抓 API
      if (!w.length && !r.length) {
        if (statusEl) statusEl.textContent = '正在從 CWA API 取得即時資料...';
        try {
          w = await API.fetchWeather();
          r = await API.fetchRainfall();
        } catch (e) {
          throw new Error('API 取得失敗：' + e.message);
        }
      }

      if (!w.length && !r.length) throw new Error('API 未回傳任何資料，請確認 API 金鑰是否正確');

      if (statusEl) statusEl.textContent = `取得 ${w.length} 站氣象、${r.length} 站雨量，儲存中...`;

      if (w.length) await _saveLocal('weather',  w);
      if (r.length) await _saveLocal('rainfall', r);

      const now = new Date().toLocaleString('zh-TW', { month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit' });
      if (statusEl) statusEl.textContent = `✓ ${now} 已存 ${w.length} 氣象 / ${r.length} 雨量`;
      Toast.show(`快照完成：氣象 ${w.length} 站、雨量 ${r.length} 站已存入本機`, 'success');
      await refreshStats();
    } catch (e) {
      if (statusEl) statusEl.textContent = '✗ ' + e.message;
      Toast.show('快照失敗：' + e.message, 'danger');
    } finally {
      if (btn) { btn.disabled = false; btn.innerHTML = '<i class="bi bi-camera me-1"></i>立即儲存當前快照'; }
    }
  }

  return { upload, snapshot, refreshStats, downloadTemplate };
})();
