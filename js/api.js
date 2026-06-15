/* ── CWA Open Data API ── */

const API = {
  /* Fetch full-station hourly weather */
  async fetchWeather() {
    const cfg = Config.load();
    const url = `${cfg.weatherEndpoint}?Authorization=${cfg.apiKey}&format=JSON&limit=1000`;
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const json = await resp.json();
    const raw = json?.records?.Station || [];
    return raw.map(parseWeather).filter(Boolean);
  },

  /* Fetch rainfall stations */
  async fetchRainfall() {
    const cfg = Config.load();
    const url = `${cfg.rainfallEndpoint}?Authorization=${cfg.apiKey}&format=JSON&limit=1000`;
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const json = await resp.json();
    const raw = json?.records?.Station || [];
    return raw.map(parseRainfall).filter(Boolean);
  }
};

/* ── Parsers ── */
function parseWeather(s) {
  try {
    const ow = s.WeatherElement;
    return {
      stationId:       s.StationId,
      stationName:     s.StationName,
      county:          s.GeoInfo?.CountyName   || '',
      town:            s.GeoInfo?.TownName      || '',
      lat:             s.GeoInfo?.Coordinates?.[0]?.StationLatitude  || null,
      lon:             s.GeoInfo?.Coordinates?.[0]?.StationLongitude || null,
      obsTime:         s.ObsTime?.DateTime      || new Date().toISOString(),
      temperature:     toNum(ow?.AirTemperature),
      relativeHumidity:toNum(ow?.RelativeHumidity),
      pressure:        toNum(ow?.AirPressure),
      windSpeed:       toNum(ow?.WindSpeed),
      windDirection:   toNum(ow?.WindDirection),
      gustInfo:        toNum(ow?.GustInfo?.PeakGustSpeed),
      precipitation:   toNum(ow?.Now?.Precipitation),
      sunshineDuration:toNum(ow?.SunshineDuration),
      weather:         ow?.Weather || ''
    };
  } catch { return null; }
}

function parseRainfall(s) {
  try {
    const re = s.RainfallElement;
    return {
      stationId:  s.StationId,
      stationName:s.StationName,
      county:     s.GeoInfo?.CountyName  || '',
      town:       s.GeoInfo?.TownName    || '',
      lat:        s.GeoInfo?.Coordinates?.[0]?.StationLatitude  || null,
      lon:        s.GeoInfo?.Coordinates?.[0]?.StationLongitude || null,
      obsTime:    s.ObsTime?.DateTime    || new Date().toISOString(),
      rain10Min:  toNum(re?.Past10Min?.Precipitation),
      rain1hr:    toNum(re?.Past1hr?.Precipitation),
      rain3hr:    toNum(re?.Past3hr?.Precipitation),
      rain6hr:    toNum(re?.Past6hr?.Precipitation),
      rain12hr:   toNum(re?.Past12hr?.Precipitation),
      rain24hr:   toNum(re?.Past24hr?.Precipitation),
      rain48hr:   toNum(re?.Past48hr?.Precipitation),
      rainDay:    toNum(re?.Today?.Precipitation),
      rainWeek:   toNum(re?.PastWeek?.Precipitation),
      rainMonth:  toNum(re?.PastMonth?.Precipitation)
    };
  } catch { return null; }
}

function toNum(v) {
  if (v === null || v === undefined || v === '' || v === '-') return null;
  const n = parseFloat(v);
  return isNaN(n) ? null : n;
}
