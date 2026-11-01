// 휴대폰 앱이 공공데이터를 부르는 길: 앱 -> Cloudflare Worker 프록시 -> 공공데이터포털 / 한국부동산원 R-ONE.
// 키는 코드에 없다. 설정 화면에서 입력한 값을 이 폰의 localStorage 에만 저장하고, 요청 머리글(X-Key)로 Worker 에 넘긴다.
// (Worker 비밀값에 키를 저장했다면 설정 화면의 키는 비워 두어도 된다.)
export const SETTINGS_KEY = "pungsu_settings_v1";

export function loadSettings() {
  try { return JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}"); } catch { return {}; }
}
export function saveSettings(s) {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); return true; } catch { return false; }
}

// svc: "datago" | "reb" | "vworld" | "kakao"   keyName: 설정에 저장된 키 이름
function proxyFetch(svc, keyName) {
  return async (path, params) => {
    const s = loadSettings();
    if (!s.proxy) throw new Error("설정에서 프록시(Worker) 주소를 먼저 입력하세요");
    const q = new URLSearchParams(params).toString();
    const headers = s[keyName] ? { "X-Key": s[keyName] } : {};
    const r = await fetch(`${s.proxy.replace(/\/$/, "")}/p/${svc}${path}?${q}`, { headers });
    return await r.text();
  };
}
export const dataGoTransport = proxyFetch("datago", "dataGoKey");     // DataGo(transport) 에 넣는다
const rebFetch = proxyFetch("reb", "rebKey");
export const rebTransport = (path, params) => rebFetch(path, { Type: "json", ...params });   // Reb(transport) 에 넣는다 (KEY 는 Worker 가 붙임)
export const vworldTransport = proxyFetch("vworld", "vworldKey");
export const kakaoTransport = proxyFetch("kakao", "kakaoKey");
