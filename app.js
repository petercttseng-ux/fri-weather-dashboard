const CWA_BASE = "https://opendata.cwa.gov.tw/api/v1/rest/datastore/";
const DEFAULT_SETTINGS = {
  apiKey: "",
  rainResource: "O-A0002-001",
  weatherResource: "O-A0003-001",
  supabaseUrl: "",
  supabaseKey: "",
  supabaseTable: "weather_observations",
};

const state = {
  settings: { ...DEFAULT_SETTINGS },
  liveRows: [],
  dbRows: [],
  sort: { key: "rain1h", direction: "desc" },
  countySort: { key: "rain24h", direction: "desc" },
  townSort: { key: "rain24h", direction: "desc" },
};

const $ = (id) => document.getElementById(id);
const numberOrNull = (value) => {
  if (value === undefined || value === null || value === "" || value === "-99" || value === "-999") return null;
  const numeric = Number(String(value).replace(/[^\d.-]/g, ""));
  return Number.isFinite(numeric) ? numeric : null;
};
const textOrDash = (value) => value || "--";
const formatRain = (value) => value === null || value === undefined ? "--" : `${Number(value).toFixed(1)} mm`;
const formatMetric = (value, unit = "") => value === null || value === undefined ? "--" : `${Number(value).toFixed(1)}${unit}`;
const parseTime = (value) => {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};
const toInputDateTime = (date) => {
  if (!date) return "";
  const pad = (num) => String(num).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
};
const formatTime = (value) => {
  const date = parseTime(value);
  return date ? date.toLocaleString("zh-TW", { hour12: false }) : "--";
};

function toast(message) {
  const box = $("toast");
  box.textContent = message;
  box.classList.add("show");
  window.clearTimeout(toast.timer);
  toast.timer = window.setTimeout(() => box.classList.remove("show"), 3600);
}

function setStatus(type, text, hint) {
  $("statusDot").className = `dot ${type || ""}`.trim();
  $("statusText").textContent = text;
  $("statusHint").textContent = hint;
}

function loadSettings() {
  const saved = JSON.parse(localStorage.getItem("friWeatherSettings") || "{}");
  state.settings = { ...DEFAULT_SETTINGS, ...saved };
  Object.entries(state.settings).forEach(([key, value]) => {
    if ($(key)) $(key).value = value;
  });
  updateStorageMode();
}

function saveSettings() {
  state.settings = { ...DEFAULT_SETTINGS };
  Object.keys(state.settings).forEach((key) => {
    if ($(key)) state.settings[key] = $(key).value.trim();
  });
  localStorage.setItem("friWeatherSettings", JSON.stringify(state.settings));
  updateStorageMode();
  toast("設定已儲存。");
}

function updateStorageMode() {
  const hasSupabase = state.settings.supabaseUrl && state.settings.supabaseKey;
  $("storageMode").textContent = hasSupabase ? "Supabase 雲端資料庫" : "本機 IndexedDB";
}

async function fetchCwa(resource) {
  const url = new URL(`${CWA_BASE}${encodeURIComponent(resource)}`);
  url.searchParams.set("Authorization", state.settings.apiKey);
  url.searchParams.set("format", "JSON");
  const response = await fetch(url);
  if (!response.ok) throw new Error(`CWA ${resource} 回應 ${response.status}`);
  return response.json();
}

function getRecordStations(data) {
  const records = data?.records;
  if (Array.isArray(records?.Station)) return records.Station;
  if (Array.isArray(records?.location)) return records.location;
  if (Array.isArray(records?.Locations?.[0]?.Location)) return records.Locations[0].Location;
  if (Array.isArray(records)) return records;
  return [];
}

function getObsTime(station) {
  return station?.ObsTime?.DateTime || station?.obsTime || station?.time?.obsTime || station?.DateTime || new Date().toISOString();
}

function getGeo(station) {
  const county = station?.GeoInfo?.CountyName || station?.GeoInfo?.County || station?.parameter?.find?.((x) => x.parameterName === "CITY")?.parameterValue || station?.city || station?.county || "";
  const town = station?.GeoInfo?.TownName || station?.GeoInfo?.Town || station?.parameter?.find?.((x) => x.parameterName === "TOWN")?.parameterValue || station?.town || "";
  return { county, town };
}

function getRain(station) {
  const rain = station?.RainfallElement || station?.rainfallElement || station?.weatherElement || {};
  if (Array.isArray(rain)) {
    const byName = (names) => {
      const found = rain.find((item) => names.includes(item.elementName) || names.includes(item.name));
      return numberOrNull(found?.elementValue ?? found?.value);
    };
    return {
      rain1h: byName(["Past1hr", "HOUR_1", "RAIN", "rain_1h"]),
      rain24h: byName(["Past24hr", "HOUR_24", "rain_24h"]),
      rain48h: byName(["Past48hr", "HOUR_48", "rain_48h"]),
    };
  }
  return {
    rain1h: numberOrNull(rain?.Past1hr ?? rain?.Now?.Precipitation ?? station?.rain_1h ?? station?.RAIN),
    rain24h: numberOrNull(rain?.Past24hr ?? station?.rain_24h),
    rain48h: numberOrNull(rain?.Past48hr ?? station?.rain_48h),
  };
}

function getWeather(station) {
  const element = station?.WeatherElement || station?.weatherElement || station;
  return {
    temperature: numberOrNull(element?.AirTemperature ?? element?.TEMP ?? station?.temperature),
    humidity: numberOrNull(element?.RelativeHumidity ?? element?.HUMD ?? station?.humidity),
    windSpeed: numberOrNull(element?.WindSpeed ?? element?.WDSD ?? station?.wind_speed),
    pressure: numberOrNull(element?.AirPressure ?? element?.PRES ?? station?.pressure),
  };
}

function normalizeStation(station, source) {
  const geo = getGeo(station);
  const rain = getRain(station);
  const weather = getWeather(station);
  const observedAt = parseTime(getObsTime(station))?.toISOString() || new Date().toISOString();
  return {
    stationId: station?.StationId || station?.stationId || station?.station_id || station?.StationID || "",
    stationName: station?.StationName || station?.stationName || station?.station_name || "",
    county: geo.county,
    town: geo.town,
    observedAt,
    source,
    ...rain,
    ...weather,
    payload: station,
  };
}

function toDbRow(row) {
  return {
    station_id: row.stationId,
    station_name: row.stationName,
    county: row.county,
    town: row.town,
    observed_at: row.observedAt,
    source: row.source,
    rain_1h: row.rain1h,
    rain_24h: row.rain24h,
    rain_48h: row.rain48h,
    temperature: row.temperature,
    humidity: row.humidity,
    wind_speed: row.windSpeed,
    pressure: row.pressure,
    payload: row.payload,
  };
}

function fromDbRow(row) {
  return {
    stationId: row.stationId || row.station_id || "",
    stationName: row.stationName || row.station_name || "",
    county: row.county || "",
    town: row.town || "",
    observedAt: row.observedAt || row.observed_at,
    source: row.source || "history",
    rain1h: numberOrNull(row.rain1h ?? row.rain_1h),
    rain24h: numberOrNull(row.rain24h ?? row.rain_24h),
    rain48h: numberOrNull(row.rain48h ?? row.rain_48h),
    temperature: numberOrNull(row.temperature),
    humidity: numberOrNull(row.humidity),
    windSpeed: numberOrNull(row.windSpeed ?? row.wind_speed),
    pressure: numberOrNull(row.pressure),
    payload: row.payload || row,
  };
}

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("fri-weather-db", 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      const store = db.createObjectStore("observations", { keyPath: "id", autoIncrement: true });
      store.createIndex("observedAt", "observedAt");
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function saveLocal(rows) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("observations", "readwrite");
    rows.forEach((row) => tx.objectStore("observations").add(row));
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}

async function readLocal() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("observations", "readonly");
    const request = tx.objectStore("observations").getAll();
    request.onsuccess = () => resolve(request.result.map(fromDbRow));
    request.onerror = () => reject(request.error);
  });
}

async function saveSupabase(rows) {
  const endpoint = `${state.settings.supabaseUrl.replace(/\/$/, "")}/rest/v1/${state.settings.supabaseTable}`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      apikey: state.settings.supabaseKey,
      Authorization: `Bearer ${state.settings.supabaseKey}`,
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    },
    body: JSON.stringify(rows.map(toDbRow)),
  });
  if (!response.ok) throw new Error(`Supabase 儲存失敗：${response.status}`);
}

async function readSupabase() {
  const endpoint = new URL(`${state.settings.supabaseUrl.replace(/\/$/, "")}/rest/v1/${state.settings.supabaseTable}`);
  endpoint.searchParams.set("select", "*");
  endpoint.searchParams.set("order", "observed_at.desc");
  endpoint.searchParams.set("limit", "5000");
  const response = await fetch(endpoint, {
    headers: {
      apikey: state.settings.supabaseKey,
      Authorization: `Bearer ${state.settings.supabaseKey}`,
    },
  });
  if (!response.ok) throw new Error(`Supabase 讀取失敗：${response.status}`);
  return (await response.json()).map(fromDbRow);
}

async function persistRows(rows) {
  if (state.settings.supabaseUrl && state.settings.supabaseKey) {
    await saveSupabase(rows);
  } else {
    await saveLocal(rows);
  }
}

async function loadDatabaseRows() {
  try {
    state.dbRows = state.settings.supabaseUrl && state.settings.supabaseKey ? await readSupabase() : await readLocal();
  } catch (error) {
    console.warn(error);
    state.dbRows = await readLocal();
    toast("雲端讀取失敗，已改用本機資料。");
  }
  renderDateRange();
  renderAggregates();
}

async function refreshData() {
  saveSettings();
  if (!state.settings.apiKey) {
    toast("請先輸入 CWA API 授權碼。");
    return;
  }
  setStatus("", "更新中", "正在連線中央氣象署開放資料平台");
  try {
    const [rainData, weatherData] = await Promise.all([
      fetchCwa(state.settings.rainResource),
      fetchCwa(state.settings.weatherResource),
    ]);
    const rainRows = getRecordStations(rainData).map((item) => normalizeStation(item, "rain"));
    const weatherRows = getRecordStations(weatherData).map((item) => normalizeStation(item, "weather"));
    state.liveRows = mergeRows([...rainRows, ...weatherRows]);
    await persistRows(state.liveRows);
    await loadDatabaseRows();
    renderLiveRows();
    renderSummary();
    setStatus("ok", "更新完成", `已取得 ${state.liveRows.length} 筆最新觀測資料`);
    toast("CWA 最新資料已更新並寫入資料庫。");
  } catch (error) {
    setStatus("error", "更新失敗", error.message);
    toast(error.message);
  }
}

function mergeRows(rows) {
  const map = new Map();
  rows.forEach((row) => {
    const key = `${row.stationId}-${row.observedAt}`;
    const previous = map.get(key) || {};
    map.set(key, { ...previous, ...row, payload: { previous: previous.payload, current: row.payload } });
  });
  return [...map.values()];
}

function filteredLiveRows() {
  const query = $("searchInput").value.trim().toLowerCase();
  const source = $("sourceFilter").value;
  return state.liveRows.filter((row) => {
    const sourceMatch = source === "all" || row.source === source;
    const text = `${row.stationName} ${row.stationId} ${row.county} ${row.town}`.toLowerCase();
    return sourceMatch && (!query || text.includes(query));
  });
}

function renderLiveRows() {
  const rows = [...filteredLiveRows()].sort((a, b) => compareValues(a[state.sort.key], b[state.sort.key], state.sort.direction));
  $("weatherRows").innerHTML = rows.map((row) => `
    <tr class="${row.rain24h >= 250 || row.rain48h >= 650 ? "rain-alert" : ""}">
      <td><strong>${textOrDash(row.stationName)}</strong><br><small>${textOrDash(row.stationId)}</small></td>
      <td>${textOrDash(row.county)}</td>
      <td>${textOrDash(row.town)}</td>
      <td>${formatTime(row.observedAt)}</td>
      <td>${formatRain(row.rain1h)}</td>
      <td>${formatRain(row.rain24h)}</td>
      <td>${formatRain(row.rain48h)}</td>
      <td>${formatMetric(row.temperature, "°C")}</td>
      <td>${formatMetric(row.humidity, "%")}</td>
      <td>${formatMetric(row.windSpeed, " m/s")}</td>
      <td>${formatMetric(row.pressure, " hPa")}</td>
    </tr>
  `).join("") || `<tr><td colspan="11">尚無資料，請更新 CWA API 或載入示範資料。</td></tr>`;
}

function compareValues(a, b, direction) {
  const normalize = (value) => {
    const time = parseTime(value);
    if (time) return time.getTime();
    const num = numberOrNull(value);
    return num ?? -Infinity;
  };
  const result = normalize(a) - normalize(b);
  return direction === "asc" ? result : -result;
}

function summarizeByArea(rows, type) {
  const end = parseTime($("rangeEnd").value) || latestTime(rows) || new Date();
  const from24 = new Date(end.getTime() - 24 * 60 * 60 * 1000);
  const from48 = new Date(end.getTime() - 48 * 60 * 60 * 1000);
  const grouped = new Map();
  rows.forEach((row) => {
    const time = parseTime(row.observedAt);
    if (!time || time > end || time < from48) return;
    const area = type === "county" ? row.county : `${row.county} / ${row.town}`;
    if (!area.trim() || area.includes("undefined")) return;
    const item = grouped.get(area) || { area, rain24h: 0, rain48h: 0, stations: new Set(), direct24: null, direct48: null };
    const rain = numberOrNull(row.rain1h);
    if (rain !== null) {
      item.rain48h += rain;
      if (time >= from24) item.rain24h += rain;
    }
    item.direct24 = Math.max(item.direct24 ?? 0, numberOrNull(row.rain24h) ?? 0);
    item.direct48 = Math.max(item.direct48 ?? 0, numberOrNull(row.rain48h) ?? 0);
    item.stations.add(row.stationId || row.stationName);
    grouped.set(area, item);
  });
  return [...grouped.values()].map((item) => ({
    ...item,
    rain24h: item.rain24h || item.direct24 || 0,
    rain48h: item.rain48h || item.direct48 || 0,
    stationCount: item.stations.size,
  }));
}

function latestTime(rows) {
  return rows.reduce((latest, row) => {
    const time = parseTime(row.observedAt);
    return time && (!latest || time > latest) ? time : latest;
  }, null);
}

function renderAggregates() {
  if (!$("rangeEnd").value && state.dbRows.length) $("rangeEnd").value = toInputDateTime(latestTime(state.dbRows));
  const counties = summarizeByArea(state.dbRows, "county").sort((a, b) => compareValues(a[state.countySort.key], b[state.countySort.key], state.countySort.direction));
  const towns = summarizeByArea(state.dbRows, "town").sort((a, b) => compareValues(a[state.townSort.key], b[state.townSort.key], state.townSort.direction));
  $("countyRows").innerHTML = counties.map(renderAggRow).join("") || `<tr><td colspan="4">尚無可計算資料。</td></tr>`;
  $("townRows").innerHTML = towns.map(renderAggRow).join("") || `<tr><td colspan="4">尚無可計算資料。</td></tr>`;
  $("alert24Count").textContent = counties.filter((row) => row.rain24h >= 250 || row.rain48h >= 650).length;
}

function renderAggRow(row) {
  const alert24 = row.rain24h >= 250;
  const alert48 = row.rain48h >= 650;
  const badge = alert24 || alert48
    ? `<span class="badge danger">${alert24 ? "24H >= 250" : ""}${alert24 && alert48 ? " / " : ""}${alert48 ? "48H >= 650" : ""}</span>`
    : `<span class="badge ok">正常</span>`;
  return `
    <tr class="${alert24 || alert48 ? "rain-alert" : ""}">
      <td><strong>${row.area}</strong><br><small>${row.stationCount} 站</small></td>
      <td>${formatRain(row.rain24h)}</td>
      <td>${formatRain(row.rain48h)}</td>
      <td>${badge}</td>
    </tr>
  `;
}

function renderSummary() {
  $("stationCount").textContent = state.liveRows.length;
  const maxRain = Math.max(0, ...state.liveRows.map((row) => numberOrNull(row.rain1h) || 0));
  $("maxRain1h").textContent = formatRain(maxRain);
}

function renderDateRange() {
  if (!state.dbRows.length) {
    $("dbRange").textContent = "尚無資料";
    $("minDate").textContent = "尚無資料";
    $("maxDate").textContent = "尚無資料";
    return;
  }
  const times = state.dbRows.map((row) => parseTime(row.observedAt)).filter(Boolean).sort((a, b) => a - b);
  const min = times[0];
  const max = times[times.length - 1];
  $("dbRange").textContent = `${min.toLocaleDateString("zh-TW")} - ${max.toLocaleDateString("zh-TW")}`;
  $("minDate").textContent = min.toLocaleString("zh-TW", { hour12: false });
  $("maxDate").textContent = max.toLocaleString("zh-TW", { hour12: false });
}

function parseCsv(text) {
  const lines = text.trim().split(/\r?\n/).filter(Boolean);
  const headers = lines.shift().split(",").map((x) => x.trim());
  return lines.map((line) => {
    const cells = line.match(/("([^"]|"")*"|[^,]*)/g).filter((_, index) => index % 2 === 0).map((cell) => cell.replace(/^"|"$/g, "").replace(/""/g, "\"").trim());
    return Object.fromEntries(headers.map((header, index) => [header, cells[index] ?? ""]));
  });
}

async function importHistory(file) {
  if (!file) return;
  const text = await file.text();
  const raw = file.name.toLowerCase().endsWith(".json") ? JSON.parse(text) : parseCsv(text);
  const rows = raw.map(fromDbRow).filter((row) => parseTime(row.observedAt));
  if (!rows.length) {
    toast("未找到可匯入的歷史資料。");
    return;
  }
  await persistRows(rows);
  await loadDatabaseRows();
  toast(`已匯入 ${rows.length} 筆歷史資料。`);
}

function loadSampleData() {
  const now = new Date();
  const areas = [
    ["宜蘭縣", "蘇澳鎮", "蘇澳", 22],
    ["屏東縣", "恆春鎮", "恆春", 8],
    ["花蓮縣", "秀林鄉", "太魯閣", 18],
    ["臺東縣", "大武鄉", "大武", 31],
    ["高雄市", "桃源區", "桃源", 11],
    ["新北市", "瑞芳區", "瑞芳", 5],
  ];
  const rows = [];
  for (let h = 0; h < 50; h += 1) {
    areas.forEach(([county, town, name, base], index) => {
      const rain1h = Math.max(0, base + Math.sin((h + index) / 4) * 8 + (index === 3 ? 18 : 0));
      rows.push({
        stationId: `S${index + 1}`,
        stationName: name,
        county,
        town,
        observedAt: new Date(now.getTime() - h * 60 * 60 * 1000).toISOString(),
        source: "sample",
        rain1h,
        rain24h: null,
        rain48h: null,
        temperature: 24 + index + Math.sin(h / 5),
        humidity: 78 + index,
        windSpeed: 2 + index / 2,
        pressure: 1006 - index,
        payload: {},
      });
    });
  }
  state.liveRows = rows.filter((row) => parseTime(row.observedAt) > new Date(now.getTime() - 60 * 60 * 1000));
  persistRows(rows).then(loadDatabaseRows);
  renderLiveRows();
  renderSummary();
  setStatus("ok", "示範資料已載入", "可檢視排序、警戒與歷史區間功能");
}

document.addEventListener("click", (event) => {
  const sortKey = event.target.dataset.sort;
  if (sortKey) {
    state.sort = {
      key: sortKey,
      direction: state.sort.key === sortKey && state.sort.direction === "desc" ? "asc" : "desc",
    };
    renderLiveRows();
  }
  const aggKey = event.target.dataset.aggSort;
  if (aggKey) {
    const target = event.target.dataset.target === "county" ? "countySort" : "townSort";
    state[target] = {
      key: aggKey,
      direction: state[target].key === aggKey && state[target].direction === "desc" ? "asc" : "desc",
    };
    renderAggregates();
  }
});

$("saveSettingsBtn").addEventListener("click", saveSettings);
$("refreshBtn").addEventListener("click", refreshData);
$("sampleBtn").addEventListener("click", loadSampleData);
$("searchInput").addEventListener("input", renderLiveRows);
$("sourceFilter").addEventListener("change", renderLiveRows);
$("calcRangeBtn").addEventListener("click", renderAggregates);
$("historyFile").addEventListener("change", (event) => importHistory(event.target.files[0]));

loadSettings();
loadDatabaseRows();
renderLiveRows();
renderSummary();
