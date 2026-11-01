// 설정 QR: 주소 뒤 # 부분에 담긴 설정을 읽어 이 폰에만 저장하고, 주소창에서 바로 지운다.
// # 뒤의 글은 브라우저가 서버에 보내지 않는다(요청 주소·Referer 에 들어가지 않음). 형식:  #cfg=<JSON 을 base64url 로 바꾼 글>
// JSON 칸: proxy, domain, vworldKey, kakaoKey, dataGoKey, rebKey  (글자만, 각 400자 이하. 그 밖의 칸은 무시)
export const FIELDS = ["proxy", "domain", "vworldKey", "kakaoKey", "dataGoKey", "rebKey"];

export function decodeCfg(b64url) {
  const b64 = b64url.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(b64url.length / 4) * 4, "=");
  const bin = atob(b64), bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  const obj = JSON.parse(new TextDecoder().decode(bytes)), out = {};
  for (const k of FIELDS) if (typeof obj[k] === "string" && obj[k].trim() && obj[k].length <= 400) out[k] = obj[k].trim();
  if (out.proxy && !/^https:\/\/[^\s/]+/.test(out.proxy)) delete out.proxy;     // 프록시는 https 주소만
  return out;
}
// 주소에 설정이 있으면 읽어서 돌려주고 주소창에서 지운다. 없거나 깨졌으면 null (주소창은 그래도 정리한다).
export function takeSetupFromHash(loc = location, hist = history) {
  const m = /^#cfg=([A-Za-z0-9_-]+)$/.exec(loc.hash || "");
  if (!m) return null;
  try { hist.replaceState(null, "", loc.pathname + loc.search); } catch { /* 지우지 못해도 계속 */ }
  try { const cfg = decodeCfg(m[1]); return Object.keys(cfg).length ? cfg : null; } catch { return null; }
}
