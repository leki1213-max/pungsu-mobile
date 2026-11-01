// 주변시설 점수표 (노트북 plugins/fengshui_nearby/core.py 를 자바스크립트로 옮김)
// fetch(url, headers, body) -> 응답 글(JSON). 앱에서는 카카오는 프록시(/p/kakao/…)로, OSM(Overpass)은 직접 부른다.
export const SRC_KAKAO_CAT = "카카오분류", SRC_KAKAO_KW = "카카오검색", SRC_OSM = "OSM";
export const OVERPASS_URLS = ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter"];
export class SearchError extends Error {}

const rule = (name, source, query, tiers, filter = "", use = true) => ({ use, name, source, query, filter, tiers });
export const DEFAULT_RULES = [
  rule("지하철역", SRC_KAKAO_CAT, "SW8", [[300, 5], [500, 3], [1000, 1]]),
  rule("초등학교", SRC_KAKAO_CAT, "SC4", [[300, 4], [600, 2], [1000, 1]], "초등학교"),
  rule("중·고등학교", SRC_KAKAO_CAT, "SC4", [[500, 2], [1000, 1]], "중학교|고등학교"),
  rule("어린이집·유치원", SRC_KAKAO_CAT, "PS3", [[300, 1]]),
  rule("대형마트", SRC_KAKAO_CAT, "MT1", [[500, 2], [1000, 1]]),
  rule("공원", SRC_KAKAO_KW, "공원", [[300, 2], [500, 1]], "공원"),
  rule("장례식장·장사시설", SRC_KAKAO_KW, "장례식장;화장장;봉안당;납골당", [[100, -5], [300, -3], [500, -1]], "장례|화장|봉안|납골|추모"),
  rule("묘지", SRC_OSM, "landuse=cemetery;amenity=grave_yard", [[100, -5], [300, -3], [500, -1]]),
  rule("변전소", SRC_OSM, "power=substation", [[100, -4], [300, -2]]),
  rule("고압 송전선", SRC_OSM, "power=line", [[100, -4], [300, -2]]),
  rule("철도", SRC_OSM, "railway=rail", [[100, -3], [300, -1]]),
  rule("쓰레기·하수 처리시설", SRC_OSM, "amenity=waste_transfer_station;landuse=landfill;man_made=wastewater_plant", [[300, -3], [500, -2], [1000, -1]]),
  rule("주유소", SRC_KAKAO_CAT, "OL7", [[50, -2], [100, -1]]),
  rule("유흥업소", SRC_KAKAO_KW, "유흥주점;나이트클럽", [[100, -2], [300, -1]], "", false),
  rule("종교시설", SRC_KAKAO_KW, "교회;성당;사찰", [[50, -2], [100, -1]], "종교", false),
];

// ── 거리 ──
const rad = (d) => d * (Math.PI / 180);   // 파이썬 math.radians 와 같은 계산 순서
export function haversine(lat1, lon1, lat2, lon2) {
  const r = 6371008.8, p1 = rad(lat1), p2 = rad(lat2), dp = p2 - p1, dl = rad(lon2 - lon1);
  const a = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * r * Math.asin(Math.min(1.0, Math.sqrt(a)));
}
const kx = (lat0) => 111320.0 * Math.cos(rad(lat0)), KY = 110540.0;
const toXY = (lat, lon, lat0, lon0) => [(lon - lon0) * kx(lat0), (lat - lat0) * KY];
const toLL = (x, y, lat0, lon0) => [lat0 + y / KY, lon0 + x / kx(lat0)];
function segNearest(ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy;
  const t = L === 0 ? 0.0 : Math.max(0.0, Math.min(1.0, -(ax * dx + ay * dy) / L));
  const x = ax + t * dx, y = ay + t * dy;
  return [Math.hypot(x, y), x, y];
}
function inside(ring) {
  let ins = false; const n = ring.length;
  for (let i = 0; i < n - 1; i++) {
    const [x1, y1] = ring[i], [x2, y2] = ring[i + 1];
    if ((y1 > 0) !== (y2 > 0)) { const xc = x1 + ((0 - y1) * (x2 - x1)) / (y2 - y1); if (xc > 0) ins = !ins; }
  }
  return ins;
}
export function elementDistance(el, lat0, lon0) {
  const t = el.type; let geoms;
  if (t === "node") { if (!("lat" in el)) return [null, null, null]; return [haversine(lat0, lon0, el.lat, el.lon), el.lat, el.lon]; }
  if (t === "way") geoms = [el.geometry || []];
  else if (t === "relation") geoms = (el.members || []).filter((m) => m.type === "way").map((m) => m.geometry || []);
  else return [null, null, null];
  let best = null;
  for (const g of geoms) {
    const pts = g.filter((p) => p && "lat" in p).map((p) => toXY(p.lat, p.lon, lat0, lon0));
    if (!pts.length) continue;
    if (pts.length >= 4 && pts[0][0] === pts[pts.length - 1][0] && pts[0][1] === pts[pts.length - 1][1] && inside(pts)) return [0.0, lat0, lon0];
    if (pts.length === 1) { const cand = [Math.hypot(pts[0][0], pts[0][1]), pts[0][0], pts[0][1]]; if (best === null || cand[0] < best[0]) best = cand; }
    for (let i = 0; i + 1 < pts.length; i++) { const cand = segNearest(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1]); if (best === null || cand[0] < best[0]) best = cand; }
  }
  if (best === null) return [null, null, null];
  const [lat, lon] = toLL(best[1], best[2], lat0, lon0);
  return [best[0], lat, lon];
}

// ── 점수 ──
export function cleanTiers(tiers) {
  const out = [];
  for (const t of tiers || []) { const d = Number(t[0]), p = Number(t[1]); if (Number.isFinite(d) && Number.isFinite(p) && d > 0) out.push([d, p]); }
  return out.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
}
export function ruleRadius(r) { const t = cleanTiers(r.tiers); return t.length ? t[t.length - 1][0] : 0.0; }
export function scoreFor(dist, tiers) {
  if (dist === null || dist === undefined) return 0.0;
  for (const [d, p] of cleanTiers(tiers)) if (dist <= d) return p;
  return 0.0;
}

// ── 카카오 ──
function kakaoHint(msg) {
  if (msg.includes("401")) return "카카오 API 키가 올바르지 않습니다 (설정에서 카카오 키 입력)";
  if (msg.includes("403")) return "카카오 권한 오류: 개발자 콘솔에서 이 앱의 카카오맵(로컬) 사용 설정을 확인하세요";
  if (msg.includes("429")) return "카카오 호출 한도 초과 — 잠시 후 다시 시도하세요";
  return "카카오 검색 실패: " + msg;
}
const KAKAO = "/v2/local/search/";
export async function kakaoSearch(fetchFn, lat, lon, radius, source, query, filt = "") {
  radius = Math.max(1, Math.min(Math.round(radius), 20000));
  const tokens = (filt || "").split("|").map((s) => s.trim()).filter(Boolean);
  const found = new Map();
  for (const q of (query || "").split(";").map((s) => s.trim()).filter(Boolean)) {
    for (const page of [1, 2, 3]) {
      const params = { x: lon.toFixed(7), y: lat.toFixed(7), radius, sort: "distance", page, size: 15 };
      let base;
      if (source === SRC_KAKAO_CAT) { params.category_group_code = q; base = KAKAO + "category.json"; } else { params.query = q; base = KAKAO + "keyword.json"; }
      let js;
      try { js = JSON.parse(await fetchFn(base, params)); } catch (e) { throw new SearchError(e instanceof SearchError ? kakaoHint(e.message) : e instanceof SyntaxError ? "카카오 응답을 읽을 수 없습니다" : kakaoHint(String(e.message))); }
      if (js.errorType || js.code < 0) throw new SearchError(kakaoHint(`${js.errorType || ""} ${js.message || js.code}`));
      for (const d of js.documents || []) {
        const cat = d.category_name || "";
        if (tokens.length && !tokens.some((t) => cat.includes(t))) continue;
        const pid = d.id || `${d.place_name}|${d.x}|${d.y}`;
        if (found.has(pid)) continue;
        const plon = parseFloat(d.x), plat = parseFloat(d.y);
        if (!Number.isFinite(plon) || !Number.isFinite(plat)) continue;
        let dist = parseFloat(d.distance); if (!Number.isFinite(dist)) dist = haversine(lat, lon, plat, plon);
        found.set(pid, { name: d.place_name || "", dist, lat: plat, lon: plon, category: cat, address: d.road_address_name || d.address_name || "" });
      }
      if ((js.meta || {}).is_end ?? true) break;
    }
  }
  return [...found.values()].sort((a, b) => a.dist - b.dist).filter((i) => i.dist <= radius);
}
export async function kakaoAddress(fetchFn, lat, lon) {
  const js = JSON.parse(await fetchFn("/v2/local/geo/coord2address.json", { x: lon.toFixed(7), y: lat.toFixed(7), input_coord: "WGS84" }));
  const d = (js.documents || [])[0]; if (!d) return "";
  return (d.road_address || {}).address_name || (d.address || {}).address_name || "";
}

// ── OSM(Overpass) ──
export function osmPairs(query) {
  const out = [];
  for (let tok of (query || "").split(";")) {
    tok = tok.trim().replace(/"/g, ""); if (!tok) continue;
    if (tok.includes("=")) { const i = tok.indexOf("="); out.push([tok.slice(0, i).trim(), tok.slice(i + 1).trim()]); } else out.push([tok, null]);
  }
  return out;
}
const osmFilter = (k, v) => (v !== null ? `["${k}"="${v}"]` : `["${k}"]`);
async function overpass(osmFetch, filters, lat, lon, radius) {
  const body = filters.map((f) => `nwr${f}(around:${Math.round(radius)},${lat.toFixed(7)},${lon.toFixed(7)});`).join("");
  const q = `[out:json][timeout:25];(${body});out geom;`;
  for (const url of OVERPASS_URLS) { try { return JSON.parse(await osmFetch(url, q)); } catch { /* 다음 서버 */ } }
  throw new SearchError("OSM 서버 응답 없음");
}
const tagMatch = (tags, pairs) => pairs.some(([k, v]) => (v !== null ? tags[k] === v : k in tags));
export async function evaluateOsm(osmFetch, lat, lon, rules) {
  const results = rules.map((r) => ({ rule: r, items: [], nearest: null, score: 0.0, error: "", radius: ruleRadius(r) }));
  const todo = [];
  for (const res of results) {
    const pairs = osmPairs(res.rule.query || "");
    if (res.radius <= 0) res.error = "거리 구간이 없습니다"; else if (!pairs.length) res.error = "OSM 태그가 비어 있습니다"; else todo.push([res, pairs]);
  }
  if (!todo.length) return results;
  const filters = [...new Set(todo.flatMap(([, pairs]) => pairs.map(([k, v]) => osmFilter(k, v))))].sort();
  let js;
  try { js = await overpass(osmFetch, filters, lat, lon, Math.max(...todo.map(([r]) => r.radius))); } catch (e) { for (const [res] of todo) res.error = e.message; return results; }
  for (const el of js.elements || []) {
    const tags = el.tags || {}, hit = todo.filter(([, pairs]) => tagMatch(tags, pairs));
    if (!hit.length) continue;
    const [d, plat, plon] = elementDistance(el, lat, lon);
    if (d === null) continue;
    for (const [res] of hit) if (d <= res.radius) res.items.push({ name: tags["name:ko"] || tags.name || res.rule.name || "", dist: d, lat: plat, lon: plon, category: res.rule.query || "", address: "" });
  }
  for (const [res] of todo) { res.items.sort((a, b) => a.dist - b.dist); if (res.items.length) { res.nearest = res.items[0]; res.score = scoreFor(res.nearest.dist, res.rule.tiers); } }
  return results;
}
export async function evaluate(kakaoFetch, osmFetch, lat, lon, r) {
  const res = { rule: r, items: [], nearest: null, score: 0.0, error: "", radius: ruleRadius(r) };
  if (res.radius <= 0) { res.error = "거리 구간이 없습니다"; return res; }
  if (r.source === SRC_OSM) return (await evaluateOsm(osmFetch, lat, lon, [r]))[0];
  try { res.items = await kakaoSearch(kakaoFetch, lat, lon, res.radius, r.source, r.query || "", r.filter || ""); } catch (e) { res.error = e.message; return res; }
  if (res.items.length) { res.nearest = res.items[0]; res.score = scoreFor(res.items[0].dist, r.tiers); }
  return res;
}
