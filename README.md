# 農業部水產試驗所逐時氣象與累積雨量儀表板

這是一個可部署至 GitHub Pages 的靜態網頁系統，用於連接中央氣象署氣象開放資料平台，呈現雨量觀測站資料、全測站逐時氣象資料、縣市與鄉鎮 24 / 48 小時累積降雨量排序，以及歷史資料上傳。

## 使用方式

1. 開啟 `index.html`。
2. 在「CWA API 與雲端資料庫設定」輸入 CWA API 授權碼。
3. 預設資料集為：
   - 雨量觀測站：`O-A0002-001`
   - 全測站逐時氣象：`O-A0003-001`
4. 點選「更新 CWA 最新資料」取得最新資料。
5. 若要使用免費雲端資料庫，建立 Supabase free project，執行頁面中的建表 SQL，並填入 Project URL 與 anon key。
6. 若沒有設定 Supabase，系統會以瀏覽器 IndexedDB 儲存資料，方便本機測試。

## 歷史 CSV 欄位

CSV 至少需要一個時間欄位，例如 `observed_at`、`observedAt`、`ObsTime`、`DateTime`、`觀測時間`、`資料時間` 或 `時間`。

可使用英文欄位：

- `station_id`
- `station_name`
- `county`
- `town`
- `observed_at`
- `rain_1h`
- `rain_24h`
- `rain_48h`
- `temperature`
- `humidity`
- `wind_speed`
- `pressure`

也可使用中文欄位：

- `站號`
- `測站名稱`
- `縣市`
- `鄉鎮`
- `觀測時間`
- `1小時雨量`
- `24小時雨量`
- `48小時雨量`
- `溫度`
- `濕度`
- `風速`
- `氣壓`

支援一般西元時間、民國年時間如 `113/06/15 08:00`，以及 `202606150900` 這類緊湊格式。

## GitHub Pages 部署

將本資料夾推送到 GitHub repository 後，可在 GitHub repository 的 Settings → Pages 選擇 `main` branch 與 root folder 發布。

## 注意事項

純前端部署會使 CWA 授權碼與 Supabase anon key 出現在瀏覽器端。若授權碼需要保密，應改為使用後端 proxy 或 serverless function 代為呼叫 CWA API。
