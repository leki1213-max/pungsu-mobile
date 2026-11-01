// 브이월드: 지도 타일 · 연속지적도 · 주소(역지오코딩) · 필지 정보. 키는 코드에 없고 설정 화면에서 입력한 값만 쓴다.
export const JIMOK = { 대: "대지", 전: "밭", 답: "논", 과: "과수원", 목: "목장용지", 임: "임야", 광: "광천지", 염: "염전", 장: "공장용지", 학: "학교용지", 차: "주차장", 주: "주유소용지", 창: "창고용지",
  도: "도로", 철: "철도용지", 제: "제방", 천: "하천", 구: "구거(작은 수로)", 유: "유지(저수지 등)", 양: "양어장", 수: "수도용지", 공: "공원", 체: "체육용지", 원: "유원지", 종: "종교용지", 사: "사적지", 묘: "묘지", 잡: "잡종지" };
export const CAD_NOTE = "※ 연속지적도는 참고용이며, 실제 경계·면적은 지적도·토지대장·측량으로 확인해야 합니다.";

export const tileUrl = (key, layer) => `https://api.vworld.kr/req/wmts/1.0.0/${encodeURIComponent(key)}/${layer}/{z}/{y}/{x}.${layer === "Satellite" ? "jpeg" : "png"}`;

// JSONP: 프록시가 없을 때 브이월드를 직접 부르는 길(브이월드는 callback 을 지원한다)
export function jsonp(url, params, timeout = 15000) {
  return new Promise((resolve, reject) => {
    const cb = "vw_" + Math.random().toString(36).slice(2);
    const s = document.createElement("script");
    const t = setTimeout(() => { cleanup(); reject(new Error("연결 실패: 시간 초과")); }, timeout);
    function cleanup() { clearTimeout(t); delete window[cb]; s.remove(); }
    window[cb] = (d) => { cleanup(); resolve(d); };
    s.onerror = () => { cleanup(); reject(new Error("연결 실패")); };
    s.src = url + "?" + new URLSearchParams({ ...params, callback: cb }).toString();
    document.head.appendChild(s);
  });
}
// path 예: "/req/address". 브이월드는 프록시(Cloudflare)를 거치면 520 으로 막히는 것을 확인해(2026-11-02), 브라우저에서 JSONP 로 직접 부른다.
export async function vcall(cfg, path, params) {
  return await jsonp("https://api.vworld.kr" + path, { ...params, key: cfg.vworldKey, domain: cfg.domain || location.hostname });
}
// 브이월드 주소가 안 될 때 대신 쓰는 카카오 좌표→주소 (프록시 경유, 카카오는 프록시로 정상). 반환 모양은 reverseGeocode 와 같다.
export async function kakaoReverse(cfg, lon, lat) {
  const q = new URLSearchParams({ x: lon.toFixed(7), y: lat.toFixed(7), input_coord: "WGS84" });
  const r = await fetch(`${cfg.proxy.replace(/\/$/, "")}/p/kakao/v2/local/geo/coord2address.json?${q}`, { headers: { "X-Key": cfg.kakaoKey } });
  if (!r.ok) throw new Error(`카카오 주소 변환 실패 (HTTP ${r.status})`);
  const d = ((await r.json()).documents || [])[0];
  if (!d) return { road: "", parcel: "", structure: null, status: "NOT_FOUND" };
  const a = d.address || {}, ro = d.road_address || {};
  const s = a.region_1depth_name ? { level1: a.region_1depth_name, level2: a.region_2depth_name, level4L: a.region_3depth_name } : null;
  return { road: ro.address_name || "", parcel: a.address_name || "", structure: s, status: "OK" };
}
export async function reverseGeocode(cfg, lon, lat) {
  const j = await vcall(cfg, "/req/address", { service: "address", request: "getAddress", version: "2.0", crs: "epsg:4326", point: `${lon},${lat}`, format: "json", type: "BOTH", zipcode: "false", simple: "false" });
  const res = (j.response && j.response.result) || [];
  const parcel = res.find((r) => r.type === "parcel"), road = res.find((r) => r.type === "road");
  return { road: road ? road.text : "", parcel: parcel ? parcel.text : "", structure: (parcel || road || {}).structure || null, status: j.response && j.response.status };
}
// 법정동 조회 문장: "시도 시군구 읍면동" (Bjd.find 에 넣는다)
export function regionQuery(structure) {
  if (!structure) return "";
  const s = structure;
  return [s.level1, s.level2, s.level4L || s.level3].filter(Boolean).join(" ");
}
export async function parcelAt(cfg, lon, lat) {
  const j = await vcall(cfg, "/req/data", { service: "data", request: "GetFeature", data: "LP_PA_CBND_BUBUN", geomFilter: `POINT(${lon} ${lat})`, geometry: "false", size: "1", format: "json" });
  const f = (((j.response || {}).result || {}).featureCollection || {}).features;
  return f && f.length ? f[0].properties : null;
}
// 9번 메뉴(필지 정보 한글로 보기)와 같은 글 — startup.py parcel_text
export function parcelText(a) {
  const jb = String(a.jibun || "").trim();
  const m = jb.match(/^(산?\s*\d+(?:-\d+)?)\s*(\D*)$/);
  const [no, jm] = m ? [m[1].trim(), m[2].trim()] : [jb, ""];
  const lines = ["[필지 정보]"];
  if (a.addr) lines.push("주소: " + a.addr);
  lines.push("지번: " + (no || "-"));
  lines.push(jm ? `지목: ${jm} (${JIMOK[jm[0]] || jm})` : "지목: 표시 없음 (토지대장 확인)");
  let jiga = Math.trunc(parseFloat(String(a.jiga || "0")) || 0);
  if (jiga) {
    const when = a.gosi_year ? ` · ${a.gosi_year}년 ${a.gosi_month || ""}월 기준` : "";
    lines.push(`개별공시지가: 1㎡당 ${jiga.toLocaleString("en-US")}원 (1평당 약 ${Math.round((jiga * 3.305785) / 10000).toLocaleString("en-US")}만원)${when}`);
    lines.push("  ※ 공시지가는 세금 기준 값이라 시세와 달라요.");
  }
  const pnu = a.pnu;
  // 소수로 바뀐 큰 번호(1.2e+18)는 틀릴 수 있어 안 보여 줌
  if ((typeof pnu === "number" && Number.isSafeInteger(pnu)) || (typeof pnu === "string" && /^\d+$/.test(pnu.trim()))) lines.push("필지 고유번호(PNU): " + String(pnu).trim());
  lines.push(CAD_NOTE);
  return lines.join("\n");
}
