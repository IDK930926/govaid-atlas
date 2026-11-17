// Administrative list of Taiwan's 22 municipalities / counties / cities. This is a
// data-entry validation list only; it does NOT change which cities are covered by
// encoded policies (see COVERED_LOCAL_CITIES / COVERED_CENTRAL_NAVIGATION_CITIES).
export const TAIWAN_CITIES = [
  "臺北市",
  "新北市",
  "桃園市",
  "臺中市",
  "臺南市",
  "高雄市",
  "基隆市",
  "新竹市",
  "嘉義市",
  "新竹縣",
  "苗栗縣",
  "彰化縣",
  "南投縣",
  "雲林縣",
  "嘉義縣",
  "屏東縣",
  "宜蘭縣",
  "花蓮縣",
  "臺東縣",
  "澎湖縣",
  "金門縣",
  "連江縣",
] as const;

export function normalizeCityName(city: string | undefined): string | undefined {
  const trimmed = city?.trim();
  if (!trimmed) {
    return undefined;
  }
  return trimmed.replace(/^台/, "臺");
}
