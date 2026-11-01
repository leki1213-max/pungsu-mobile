// 풍수모바일 — 화면 연결. 계산은 모두 js/ 아래 모듈(노트북 파이썬과 같은 결과를 확인한 것)을 쓴다.
import { loadSettings, saveSettings, SETTINGS_KEY } from "./transport.js";
import { takeSetupFromHash } from "./setup-link.js";
import * as V from "./vworld.js";
import * as PD from "./publicdata.js";
import * as R from "./reb.js";
import * as X from "./xuankong.js";
import * as T from "./terrain.js";
import * as D from "./dem.js";
import * as N from "./nearby.js";
import { chartSvg, compassLines, dest } from "./chart.js";
import { mdToHtml } from "./mdtable.js";
import { buildKmz } from "./kmz.js";

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
let cfg = loadSettings();
// 설정 QR로 들어왔으면(주소 # 뒤) 키를 이 폰에 저장하고 주소창에서 바로 지운다
const fromQr = takeSetupFromHash();
if (fromQr) { cfg = { ...cfg, ...fromQr }; saveSettings(cfg); }
let map, baseLayer, cadLayer, centerInfo = { road: "", parcel: "", structure: null }, overlays = {};

// ───────── 알림 ─────────
let toastT;
function toast(msg, ms = 4000) { const t = $("toast"); t.textContent = msg; t.style.display = "block"; clearTimeout(toastT); toastT = setTimeout(() => (t.style.display = "none"), ms); }
const need = (what) => { toast(`설정 화면에서 ${what}을(를) 먼저 입력해 주세요`); openTab("set"); return false; };
const hasVworld = () => !!cfg.vworldKey || need("브이월드 인증키");
const center = () => { const c = map.getCenter(); return { lat: c.lat, lon: c.lng }; };

// ───────── 설정 ─────────
function fillSettings() {
  $("s-proxy").value = cfg.proxy || ""; $("s-vworld").value = cfg.vworldKey || ""; $("s-domain").value = cfg.domain || location.hostname;
  $("s-kakao").value = cfg.kakaoKey || ""; $("s-datago").value = cfg.dataGoKey || ""; $("s-reb").value = cfg.rebKey || ""; $("s-decl").value = cfg.decl ?? -8.5;
}
$("s-save").onclick = () => {
  cfg = { proxy: $("s-proxy").value.trim(), vworldKey: $("s-vworld").value.trim(), domain: $("s-domain").value.trim(), kakaoKey: $("s-kakao").value.trim(),
    dataGoKey: $("s-datago").value.trim(), rebKey: $("s-reb").value.trim(), decl: parseFloat($("s-decl").value) };
  $("s-msg").textContent = saveSettings(cfg) ? "저장했어요. 키는 이 폰에만 있어요." : "저장하지 못했어요(브라우저 저장소가 막혀 있어요).";
  setBase(currentBase); reverseSoon();
};
$("s-clear").onclick = () => { try { localStorage.removeItem(SETTINGS_KEY); } catch { /* 무시 */ } cfg = {}; fillSettings(); $("s-msg").textContent = "키를 모두 지웠어요."; };
const decl = () => (Number.isFinite(cfg.decl) ? cfg.decl : -8.5);

// ───────── 탭 ─────────
function openTab(name) {
  document.querySelectorAll("#tabs button").forEach((b) => b.classList.toggle("on", b.dataset.tab === name));
  document.querySelectorAll(".pane").forEach((p) => (p.hidden = p.dataset.pane !== name));
  $("sheet").classList.remove("closed");
}
document.querySelectorAll("#tabs button").forEach((b) => (b.onclick = () => { const sh = $("sheet"); if (b.classList.contains("on") && !sh.classList.contains("closed")) sh.classList.add("closed"); else openTab(b.dataset.tab); }));
$("grab").onclick = () => $("sheet").classList.add("closed");

// ───────── 지도 ─────────
let currentBase = "Base";
function setBase(layer) {
  currentBase = layer;
  if (baseLayer) map.removeLayer(baseLayer);
  if (!cfg.vworldKey) { baseLayer = L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: "© OpenStreetMap" }).addTo(map); return; }
  baseLayer = L.layerGroup();
  baseLayer.addLayer(L.tileLayer(V.tileUrl(cfg.vworldKey, layer === "Hybrid" ? "Satellite" : layer), { maxZoom: 19, attribution: "© 브이월드" }));
  if (layer === "Hybrid") baseLayer.addLayer(L.tileLayer(V.tileUrl(cfg.vworldKey, "Hybrid"), { maxZoom: 19 }));
  baseLayer.addTo(map);
  document.querySelectorAll("#maptools [data-base]").forEach((b) => b.classList.toggle("on", b.dataset.base === layer));
}
function toggleCad() {
  if (!hasVworld()) return;
  if (cadLayer) { map.removeLayer(cadLayer); cadLayer = null; $("t-cad").classList.remove("on"); return; }
  cadLayer = L.tileLayer.wms("https://api.vworld.kr/req/wms", { layers: "lp_pa_cbnd_bubun,lp_pa_cbnd_bonbun", styles: "lp_pa_cbnd_bubun,lp_pa_cbnd_bonbun", format: "image/png", transparent: true, version: "1.3.0", key: cfg.vworldKey, domain: cfg.domain || location.hostname, maxZoom: 19 }).addTo(map);
  $("t-cad").classList.add("on");
  toast("지적도는 충분히 확대해야 보여요. " + V.CAD_NOTE, 6000);
}
let revT, revSeq = 0;
function reverseSoon() {
  clearTimeout(revT);
  revT = setTimeout(async () => {
    if (!cfg.vworldKey) { $("addr").textContent = "설정에서 브이월드 키를 넣으면 가운데 주소가 나와요"; return; }
    const seq = ++revSeq, { lat, lon } = center();
    try {
      const r = await V.reverseGeocode(cfg, lon, lat);
      if (seq !== revSeq) return;
      centerInfo = r;
      $("addr").textContent = [r.road, r.parcel && r.parcel !== r.road ? "(" + r.parcel + ")" : ""].filter(Boolean).join(" ") || "주소를 찾지 못했어요";
    } catch (e) { if (seq === revSeq) $("addr").textContent = "주소를 불러오지 못했어요: " + e.message; }
  }, 600);
}
function initMap() {
  map = L.map("map", { zoomControl: false, center: cfg.last || [37.4563, 126.7052], zoom: cfg.lastZoom || 16 });
  L.control.zoom({ position: "bottomleft" }).addTo(map);
  setBase("Base");
  map.on("moveend", () => { reverseSoon(); cfg.last = [map.getCenter().lat, map.getCenter().lng]; cfg.lastZoom = map.getZoom(); saveSettings(cfg); });
  document.querySelectorAll("#maptools [data-base]").forEach((b) => (b.onclick = () => { if (b.dataset.base !== "Base" && !hasVworld()) return; setBase(b.dataset.base); }));
  $("t-cad").onclick = toggleCad;
  $("btn-here").onclick = () => navigator.geolocation ? navigator.geolocation.getCurrentPosition((p) => map.setView([p.coords.latitude, p.coords.longitude], 17), () => toast("위치를 가져오지 못했어요")) : toast("이 브라우저는 위치를 지원하지 않아요");
  reverseSoon();
}

// ───────── 오버레이(패철·반경·지형) ─────────
function setOverlay(name, layer) { if (overlays[name]) map.removeLayer(overlays[name]); overlays[name] = layer; if (layer) layer.addTo(map); }
const clearOverlay = (name) => setOverlay(name, null);
function compass(kind) {
  const key = "compass" + kind;
  if (overlays[key]) return clearOverlay(key);
  const { lat, lon } = center(), { lines, labels } = compassLines(lat, lon, decl(), { kind, radius: 300 });
  const g = L.layerGroup();
  lines.forEach((l) => L.polyline(l, { color: "#b88a1c", weight: 1.5 }).addTo(g));
  labels.forEach((b) => L.marker(b.at, { icon: L.divIcon({ className: "", html: `<div style="font:700 13px system-ui;color:#fff;text-shadow:0 0 3px #000,0 0 3px #000;white-space:nowrap;transform:translate(-50%,-50%)">${b.text}</div>`, iconSize: [0, 0] }), interactive: false }).addTo(g));
  L.circle([lat, lon], { radius: 300, color: "#b88a1c", weight: 1, fill: false }).addTo(g);
  setOverlay(key, g);
  toast(`${kind}방위 패철을 지도 가운데에 그렸어요 (자북 편각 ${decl()}° 적용)`);
}
$("ov-compass").onclick = () => compass(24);
$("ov-8").onclick = () => compass(8);
$("ov-buf").onclick = () => {
  if (overlays.buf) return clearOverlay("buf");
  const { lat, lon } = center(), g = L.layerGroup();
  $("buf-m").value.split(",").map((s) => parseFloat(s)).filter((v) => v > 0).forEach((m) => { L.circle([lat, lon], { radius: m, color: "#1f6f5c", weight: 2, fill: false, dashArray: "6 4" }).addTo(g); L.marker(D.dest(lon, lat, 0, m).reverse(), { icon: L.divIcon({ className: "", html: `<div style="font:700 12px system-ui;color:#1f6f5c;text-shadow:0 0 3px #fff">${m}m</div>`, iconSize: [0, 0] }), interactive: false }).addTo(g); });
  setOverlay("buf", g);
};

// ───────── 현공풍수 ─────────
$("fs-run").onclick = () => {
  const deg = parseFloat($("fs-deg").value), year = parseInt($("fs-year").value, 10);
  if (!(deg >= 0 && deg < 360) || !(year >= 1864 && year <= 2200)) return toast("각도(0~359.9)와 준공 연도(1864~2200)를 확인해 주세요");
  const rep = X.xkReport(deg, year, new Date().getFullYear());
  const ch = rep.chart, c2 = X.makeChart(ch.period, deg, ch.replace);
  const ev = X.evaluateChart(c2, { year: new Date().getFullYear() });
  const row = (p) => {
    const e = ev.palaces.find((x) => x.palace === p);
    const tags = e.tags.map(([lv, t]) => `<span class="tag ${/吉/.test(lv) ? "good" : /凶/.test(lv) ? "bad" : ""}">${esc(lv)} ${esc(t)}</span>`).join("");
    return `<details><summary><b>${esc(e.name)}</b> 山${e.stars[0]}(${e.status[0]}) 向${e.stars[1]}(${e.status[1]}) 運${e.stars[2]}</summary>${tags || "<span class='hint'>특이 조합 없음</span>"}</details>`;
  };
  $("fs-out").innerHTML = `<h3>비성반 · ${ch.period}運 ${esc(ch.s_mt)}坐${esc(ch.f_mt)}向</h3>` + chartSvg(ch, { sitPal: ch.s_pal, facePal: ch.f_pal, period: ch.period })
    + `<h3>현공풍수 해석</h3><pre class="say">${esc(rep.detail)}</pre><h3>玄空 판정 (${esc(ev.四局)}${ev.特記.length ? " · " + esc(ev.特記.join(", ")) : ""})</h3><p class="hint">${esc(c2.basis)} · 山星 ${esc(ev["山星 反伏吟"])} / 向星 ${esc(ev["向星 反伏吟"])}</p>`
    + [4, 9, 2, 3, 5, 7, 8, 1, 6].map(row).join("") + `<p class="hint">${esc(X.XK_DISCLAIMER)}</p>`;
  lastFs = rep;
};
let lastFs = null;
$("fs-parcel").onclick = async () => {
  if (!hasVworld()) return;
  const { lat, lon } = center();
  try { const a = await V.parcelAt(cfg, lon, lat); $("fs-out").innerHTML = a ? `<pre class="say">${esc(V.parcelText(a))}</pre>` : "<p>이 자리에서 필지를 찾지 못했어요. 지도를 더 확대해 보세요.</p>"; } catch (e) { toast("필지 정보를 불러오지 못했어요: " + e.message); }
};

// ───────── 지형분석 ─────────
let terrain = null;
function mercToLatLng(x, y) { const W = 40075016.685578488; return [(Math.atan(Math.sinh((y / (W / 2)) * Math.PI)) * 180) / Math.PI, (x / W) * 360]; }
function renderPng(g, kind, rv) {
  const cv = document.createElement("canvas"); cv.width = g.W; cv.height = g.H;
  const cx = cv.getContext("2d"), img = cx.createImageData(g.W, g.H), d = img.data;
  const put = (i, r, gg, b, a) => { d[4 * i] = r; d[4 * i + 1] = gg; d[4 * i + 2] = b; d[4 * i + 3] = a; };
  const hsv = (h) => { const f = (n) => { const k = (n + h / 60) % 6; return Math.round(255 * (1 - Math.max(0, Math.min(k, 4 - k, 1)))); }; return [f(5), f(3), f(1)]; };
  if (kind === "hill") { const h = T.hillshade(g); for (let i = 0; i < h.length; i++) put(i, h[i], h[i], h[i], h[i] ? 200 : 0); }
  else if (kind === "slope") { const s = T.slope(g); for (let i = 0; i < s.length; i++) s[i] === T.NODATA ? put(i, 0, 0, 0, 0) : put(i, 200, 40, 40, Math.min(220, Math.round(s[i] * 10))); }
  else if (kind === "aspect") { const a = T.aspect(g); for (let i = 0; i < a.length; i++) { if (a[i] === T.NODATA) put(i, 0, 0, 0, 0); else { const [r, gg, b] = hsv(a[i]); put(i, r, gg, b, 170); } } }
  else { const k = rv.cls, sx = g.W / rv.W, sy = g.H / rv.H; for (let r = 0; r < g.H; r++) for (let c = 0; c < g.W; c++) { const v = k[Math.min(rv.H - 1, Math.floor(r / sy)) * rv.W + Math.min(rv.W - 1, Math.floor(c / sx))]; const i = r * g.W + c; v === 2 ? put(i, 192, 57, 43, 170) : v === 1 ? put(i, 59, 125, 216, 170) : put(i, 0, 0, 0, 0); } }
  cx.putImageData(img, 0, 0); return cv.toDataURL("image/png");
}
async function runTerrain() {
  const { lat, lon } = center();
  toast("주변 높이 자료를 받는 중…", 8000);
  try {
    const dem = await D.fetchDem(lon, lat, D.browserTile), g = T.gridFromDem(dem);
    const rv = T.ridgeValley(g);
    terrain = { dem, g, rv, ct: null };
    const [la0, lo0] = mercToLatLng(dem.ox, dem.oy), [la1, lo1] = mercToLatLng(dem.ox + dem.W * dem.px, dem.oy - dem.H * dem.px);
    terrain.bounds = [[la1, lo0], [la0, lo1]];
    showTerrain();
    toast(`높이 타일 ${dem.tiles}/${dem.tilesTotal}장으로 지형분석을 만들었어요 (AWS 지형 타일, 노트북 DEM과 같은 값)`);
  } catch (e) { toast(e.message); }
}
function showTerrain() {
  if (!terrain) return;
  const kind = $("terr-kind").value;
  setOverlay("terrain", L.imageOverlay(renderPng(terrain.g, kind, terrain.rv), terrain.bounds, { opacity: kind === "hill" ? 0.7 : 0.6 }));
  if (kind === "rv") $("fs-out").innerHTML = `<p><span class="dot" style="background:#c0392b"></span>능선(용맥) ${[...terrain.rv.cls].filter((v) => v === 2).length}칸 · <span class="dot" style="background:#3b7dd8"></span>계곡(산곡수살처 후보) ${[...terrain.rv.cls].filter((v) => v === 1).length}칸 (30m 격자)</p>`;
}
$("terr-run").onclick = runTerrain;
$("terr-kind").onchange = showTerrain;
$("terr-clear").onclick = () => { clearOverlay("terrain"); clearOverlay("contour"); terrain = null; };
$("ct-toggle").onclick = () => {
  if (overlays.contour) return clearOverlay("contour");
  if (!terrain) return toast("먼저 '지형분석'을 눌러 주세요");
  const itv = Math.max(1, parseInt($("terr-int").value, 10) || 5), ct = T.contours(terrain.g, itv), g = L.layerGroup(), d = terrain.dem;
  for (const [lev, segs] of Object.entries(ct)) for (const [x1, y1, x2, y2] of segs) {
    L.polyline([mercToLatLng(d.ox + x1 + d.px / 2, d.oy - y1 - d.px / 2), mercToLatLng(d.ox + x2 + d.px / 2, d.oy - y2 - d.px / 2)], { color: Number(lev) % (itv * 5) === 0 ? "#6b3f1d" : "#a98a62", weight: Number(lev) % (itv * 5) === 0 ? 1.6 : 0.8, interactive: false }).addTo(g);
  }
  setOverlay("contour", g);
};

// ───────── 매물 ─────────
const STATUS_COLOR = { 진행중: "#1f8f4d", 보류: "#e0a800", 계약완료: "#c0392b", 기타: "#7f8c8d" };
let listings = [];
function statusOf(p) { const s = String(p.status ?? p.상태 ?? p["진행상태"] ?? "").trim(); return Object.keys(STATUS_COLOR).find((k) => s.includes(k)) || "기타"; }
async function loadListings() { try { const r = await (await caches.open("pungsu-user")).match("listings"); if (r) listings = (await r.json()).features || []; } catch { listings = []; } }
async function saveListings(fc) { try { await (await caches.open("pungsu-user")).put("listings", new Response(JSON.stringify(fc))); } catch { toast("이 브라우저는 매물을 저장하지 못해요(이번에만 보여요)"); } }
function drawListings() {
  const g = L.layerGroup(); const count = {};
  for (const f of listings) {
    if (!f.geometry || f.geometry.type !== "Point") continue;
    const [lon, lat] = f.geometry.coordinates, st = statusOf(f.properties || {}); count[st] = (count[st] || 0) + 1;
    const name = f.properties.name ?? f.properties.이름 ?? f.properties.주소 ?? f.properties.addr ?? f.properties.jibun ?? "";
    L.circleMarker([lat, lon], { radius: 9, color: "#fff", weight: 2, fillColor: STATUS_COLOR[st], fillOpacity: 0.95 }).bindPopup(`<b>${esc(st)}</b><br>${esc(name)}<br>${Object.entries(f.properties).filter(([k]) => !["name", "이름"].includes(k)).slice(0, 6).map(([k, v]) => `${esc(k)}: ${esc(v ?? "")}`).join("<br>")}`).addTo(g);
  }
  setOverlay("listings", g);
  $("ml-legend").innerHTML = Object.entries(STATUS_COLOR).map(([k, c]) => `<span class="tag"><span class="dot" style="background:${c}"></span>${k} ${count[k] || 0}</span>`).join("");
  $("ml-out").textContent = listings.length ? `${listings.length}개 매물 (이 폰에만 저장)` : "";
}
$("ml-file").onchange = async (e) => {
  const f = e.target.files[0]; if (!f) return;
  try { const fc = JSON.parse(await f.text()); listings = (fc.features || []).filter((x) => x && x.geometry); await saveListings({ type: "FeatureCollection", features: listings }); drawListings(); if (listings.length) { const pts = listings.filter((x) => x.geometry.type === "Point").map((x) => [x.geometry.coordinates[1], x.geometry.coordinates[0]]); if (pts.length) map.fitBounds(pts, { maxZoom: 16 }); } }
  catch { toast("GeoJSON 파일을 읽지 못했어요"); }
};
$("ml-heat").onclick = () => {
  if (overlays.heat) return clearOverlay("heat");
  const pts = listings.filter((x) => x.geometry.type === "Point").map((x) => [x.geometry.coordinates[1], x.geometry.coordinates[0], 1]);
  if (!pts.length) return toast("먼저 매물을 불러오세요");
  setOverlay("heat", L.heatLayer(pts, { radius: 30, blur: 22, maxZoom: 16 }));
};
$("ml-clear").onclick = async () => { listings = []; try { await (await caches.open("pungsu-user")).delete("listings"); } catch { /* 무시 */ } clearOverlay("listings"); clearOverlay("heat"); drawListings(); };

// ───────── 공공데이터 브리핑 ─────────
let lastDoc = { title: "", lines: [] };
function proxyTransport(svc, keyName) {
  return async (path, params) => {
    if (!cfg.proxy) throw new Error("설정에서 프록시(Worker) 주소를 입력해 주세요");
    const r = await fetch(`${cfg.proxy.replace(/\/$/, "")}/p/${svc}${path}?${new URLSearchParams(params)}`, { headers: cfg[keyName] ? { "X-Key": cfg[keyName] } : {} });
    return await r.text();
  };
}
async function fetchJson(rel) { const r = await fetch(rel); if (!r.ok) throw new Error(rel + " 를 읽지 못했어요"); return await r.json(); }
const cacheStore = (name) => ({
  async get(key) { try { const r = await (await caches.open(name)).match("/k/" + encodeURIComponent(key)); return r ? await r.json() : null; } catch { return null; } },
  async put(key, v) { try { await (await caches.open(name)).put("/k/" + encodeURIComponent(key), new Response(JSON.stringify(v))); } catch { /* 저장 못 해도 계속 */ } },
});
$("pd-run").onclick = async () => {
  let q = $("pd-query").value.trim() || V.regionQuery(centerInfo.structure);
  if (!q) return toast("지도를 움직여 가운데 주소가 나오게 하거나 지역 이름을 입력해 주세요");
  if (!cfg.proxy || !cfg.dataGoKey) return need("프록시 주소와 공공데이터포털 키");
  const out = $("pd-out"), prog = $("pd-prog"); out.innerHTML = ""; prog.hidden = false; prog.value = 0;
  const L_ = [], note = (...a) => { L_.push(...a); };
  try {
    const bjd = new PD.Bjd(await fetchJson("data/bjd.json"));
    const dg = new PD.DataGo(proxyTransport("datago", "dataGoKey"), { cache: cacheStore("pungsu-datago") });
    const lc = await bjd.lawdCodes(q, (s, u, ym) => dg.probeTrade(s, u, ym)), reg = lc.region, codes = lc.codes.map((c) => c.sgg), umd = reg.emd, today = dg.todayIso();
    note(`# ${reg.name} — 운별 공공데이터 숫자표`, "", `수집일 ${today} · 법정동 코드 ${reg.code} · 조회 시군구 코드 ${codes.join(" / ")}`, "", "출처 표시: 기관명 · 데이터명 · 기준일. 7운(1984~2003)은 월별·거래 자료가 없어 8운·9운만 봅니다.", "");
    const steps = [
      ["apt_trade", async () => { prog.value = 5; const rows = await dg.allRows("apt_trade", codes.slice(0, 1), umd, (d, n) => (prog.value = 5 + (d / n) * 20)); return PD.tradeTables("아파트 매매 실거래가", rows, PD.sourceLabel("아파트 매매 실거래가", today)); }],
      ["apt_rent", async () => { const rows = await dg.allRows("apt_rent", codes.slice(0, 1), umd, (d, n) => (prog.value = 25 + (d / n) * 20)); return PD.rentTables(rows, PD.sourceLabel("아파트 전월세 실거래가", today)); }],
      ["nrg_trade", async () => { const rows = await dg.allRows("nrg_trade", codes.slice(0, 1), umd, (d, n) => (prog.value = 45 + (d / n) * 20)); return PD.tradeTables("상업업무용 부동산 매매 실거래가", rows, PD.sourceLabel("상업업무용 부동산 매매 실거래가", today)).concat(rows.length ? PD.nrgExtra(rows) : []); }],
      ["bld", async () => { prog.value = 70; return PD.bldTable(await dg.bldTitles(reg.sgg_cd, reg.code.slice(5, 10)), PD.sourceLabel("건축물대장 표제부(건축HUB)", today)); }],
    ];
    note("## 1. 아파트·상가 거래", "");
    for (const [name, fn] of steps) { try { note(...(await fn())); } catch (e) { note(`${name} 수집 못 함: ${e.message}`, ""); } out.innerHTML = mdToHtml(L_); }
    if (cfg.rebKey) { try { prog.value = 85; const reb = new R.Reb(proxyTransportReb(), { cache: cacheStore("pungsu-reb") }); const res = await reb.collect(reg); note("## 2. 한국부동산원 아파트 가격 흐름", "", ...R.md(res).split("\n").slice(3)); } catch (e) { note("R-ONE 수집 못 함: " + e.message, ""); } } else note("R-ONE(한국부동산원)은 설정에 키가 없어 받지 않았어요.", "");
    try {
      const idx = await fetchJson("data/store/_index.json");
      const sr = await PD.storeCollect(q, (k) => fetchJson(`data/store/${k}.json`), idx), ss = PD.storeSummarize(sr);
      note("## 3. 상가(상권)정보", "", `출처: ${PD.storeSource(sr.ym)}`, "", `가게 모두 **${ss.total.toLocaleString("en-US")}곳**. 한 시점의 현재 모습이라 운별로 나눠 볼 수 없습니다.`, "", "| 업종 대분류 | 가게 수 | 비율 |", "|---|---|---|");
      ss.big.slice(0, 8).forEach(([k, v]) => note(`| ${k} | ${v.toLocaleString("en-US")} | ${PD.fixed((100 * v) / ss.total, 1)}% |`));
      const pr = await PD.popCollect(q, bjd, (s) => fetchJson(`data/pop/${s}.json`), sr), [y, w, o, mean] = PD.popBands(pr.age), t = pr.total;
      note("", "## 4. 인구", "", `출처: ${PD.popSource(pr.asof)}`, "", `행정동 ${pr.dongs.join(", ")} 합계 **${t.toLocaleString("en-US")}명** · 유소년 ${PD.fixed((100 * y) / t, 1)}% · 생산연령 ${PD.fixed((100 * w) / t, 1)}% · 고령 ${PD.fixed((100 * o) / t, 1)}% · 평균 ${PD.fixed(mean, 1)}세`, `이은 방법: ${pr.how}`, "");
    } catch (e) { note("상가·인구 자료 집계 실패: " + e.message, ""); }
    lastDoc = { title: reg.name, lines: L_ };
  } catch (e) { note("조회 실패: " + e.message); lastDoc = { title: q, lines: L_ }; }
  prog.value = 100; $("pd-out").innerHTML = mdToHtml(L_); setTimeout(() => (prog.hidden = true), 800);
};
function proxyTransportReb() { return async (path, params) => { const r = await fetch(`${cfg.proxy.replace(/\/$/, "")}/p/reb${path}?${new URLSearchParams({ Type: "json", ...params })}`, { headers: cfg.rebKey ? { "X-Key": cfg.rebKey } : {} }); return await r.text(); }; }
function printHtml(title, html) {
  let a = $("printarea"); if (!a) { a = document.createElement("div"); a.id = "printarea"; document.body.appendChild(a); }
  a.innerHTML = `<h1>${esc(title)}</h1>${html}<p style="font-size:10px">풍수모바일 — 참고 자료이며 법정 중개대상물 확인·설명서를 대체하지 않습니다.</p>`;
  document.title = title; window.print();
}
$("pd-print").onclick = () => lastDoc.lines.length ? printHtml(lastDoc.title + " 공공데이터 브리핑", mdToHtml(lastDoc.lines)) : toast("먼저 조회해 주세요");
$("pd-share").onclick = async () => {
  if (!lastDoc.lines.length) return toast("먼저 조회해 주세요");
  const text = lastDoc.lines.join("\n");
  if (navigator.share) { try { await navigator.share({ title: lastDoc.title, text }); } catch { /* 취소 */ } } else { try { await navigator.clipboard.writeText(text); toast("글을 복사했어요"); } catch { toast("이 브라우저는 공유를 지원하지 않아요"); } }
};

// ───────── 주변시설 ─────────
let lastNear = null;
$("nb-run").onclick = async () => {
  if (!cfg.proxy || !cfg.kakaoKey) return need("프록시 주소와 카카오 키");
  const { lat, lon } = center(), out = $("nb-out"); out.textContent = "검색 중…";
  const kf = async (base, params) => { const r = await fetch(`${cfg.proxy.replace(/\/$/, "")}/p/kakao${base}?${new URLSearchParams(params)}`, { headers: { "X-Key": cfg.kakaoKey } }); const t = await r.text(); if (!r.ok) throw new N.SearchError(`HTTP ${r.status}: ${t.slice(0, 100)}`); return t; };
  const of = async (url, q) => { const r = await fetch(url, { method: "POST", body: new URLSearchParams({ data: q }) }); if (!r.ok) throw new Error("OSM " + r.status); return await r.text(); };
  const rules = N.DEFAULT_RULES.filter((r) => r.use), results = [];
  const kakaoRules = rules.filter((r) => r.source !== N.SRC_OSM), osmRules = rules.filter((r) => r.source === N.SRC_OSM);
  for (const r of kakaoRules) results.push(await N.evaluate(kf, of, lat, lon, r));
  if (osmRules.length) results.push(...(await N.evaluateOsm(of, lat, lon, osmRules)));
  const total = results.reduce((s, r) => s + r.score, 0);
  lastNear = { lat, lon, results, total, addr: centerInfo.road || centerInfo.parcel };
  const rows = results.map((r) => `<tr><td>${esc(r.rule.name)}</td><td>${r.error ? esc(r.error) : r.nearest ? `${esc(r.nearest.name)} ${Math.round(r.nearest.dist)}m` : "없음"}</td><td>${r.score > 0 ? "+" : ""}${r.score}</td></tr>`).join("");
  out.innerHTML = `<p><b>${esc(lastNear.addr || "가운데 위치")}</b></p><table><thead><tr><th>시설</th><th>가장 가까운 곳</th><th>점수</th></tr></thead><tbody>${rows}<tr><td><b>합계</b></td><td></td><td><b>${total > 0 ? "+" : ""}${total}</b></td></tr></tbody></table>`;
  const g = L.layerGroup(); results.forEach((r) => r.items.slice(0, 5).forEach((i) => L.circleMarker([i.lat, i.lon], { radius: 6, color: r.score < 0 ? "#c0392b" : "#1f8f4d", fillOpacity: 0.8 }).bindPopup(esc(`${r.rule.name} · ${i.name} ${Math.round(i.dist)}m`)).addTo(g))); setOverlay("near", g);
};
$("fs-print").onclick = () => $("fs-out").innerHTML.trim() ? printHtml((centerInfo.road || centerInfo.parcel || "현공풍수") + " 풍수 분석", $("fs-out").innerHTML) : toast("먼저 '현공풍수 해석'을 눌러 주세요");
$("nb-print").onclick = () => lastNear ? printHtml("주변시설 점수표", $("nb-out").innerHTML) : toast("먼저 점수표를 만들어 주세요");

// ───────── KMZ ─────────
$("kmz").onclick = async () => {
  const { lat, lon } = center(), deg = parseFloat($("fs-deg").value);
  try {
    const blob = await buildKmz({ lat, lon, decl: decl(), deg: Number.isFinite(deg) ? deg : 180, name: centerInfo.road || centerInfo.parcel || "풍수모바일" });
    const file = new File([blob], "풍수모바일.kmz", { type: "application/vnd.google-earth.kmz" });
    if (navigator.canShare && navigator.canShare({ files: [file] })) { try { await navigator.share({ files: [file], title: "풍수모바일.kmz" }); return; } catch { /* 취소 → 내려받기 */ } }
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "풍수모바일.kmz"; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  } catch (e) { toast("KMZ를 만들지 못했어요: " + e.message); }
};

// ───────── 시작 ─────────
fillSettings();
initMap();
loadListings().then(drawListings);
if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => { /* 오프라인 저장은 없어도 앱은 돌아간다 */ });
if (fromQr) { openTab("set"); $("s-msg").textContent = "QR로 설정을 받았어요. 주소창에서 키는 지웠어요."; toast("설정을 받았어요 (이 폰에만 저장)", 5000); }
else if (!cfg.vworldKey) { openTab("set"); toast("처음이에요. 설정에서 키를 입력해 주세요", 6000); }
window.__pungsu = { X, T, D, PD, R, N };   // 시험용
