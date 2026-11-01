// 현공풍수 계산 — 노트북 QGIS 메뉴와 같은 코드를 자바스크립트로 옮김 (계산 로직은 그대로, 새로 만들지 않음)
//   A. startup.py 의 7번 현공풍수 해석 · 10번 비성반: xk_chart / xk_report (쉬운 말 해석)
//   B. plugins/xk_judge/xuankong_rules.py 의 11번 玄空 판정 패널: make_chart / evaluate_chart / fenjin
// 파이썬과 같은 값이 나오는지는 tools/xk_compare.mjs 로 같은 입력 수천 건을 비교해 확인한다.
import { fixed } from "./publicdata.js";

// 파이썬의 % 와 똑같이(부동소수 포함): 나머지가 0 이 아니고 부호가 n 과 다르면 n 을 더한다
const mod = (a, n) => { let m = a % n; if (m !== 0 && (n < 0) !== (m < 0)) m += n; return m; };
const sorted = (arr) => arr.slice().sort();
const pyRound = (x, nd) => Number(fixed(x, nd));

// ═══════════════ A. startup.py ═══════════════
export const XK_MT = "壬子癸丑艮寅甲卯乙辰巽巳丙午丁未坤申庚酉辛戌乾亥";
export const XK_MT_KO = "임자계축간인갑묘을진손사병오정미곤신경유신술건해";
export const XK_PAL_ORDER = [1, 8, 3, 4, 9, 2, 7, 6];
export const XK_PAL_MTS = {};
XK_PAL_ORDER.forEach((p, i) => { XK_PAL_MTS[p] = XK_MT.slice(i * 3, i * 3 + 3); });
export const XK_YANG = new Set("壬甲庚丙乾坤艮巽寅申巳亥");
export const XK_REPLACE = {};
for (const [s, ms] of [[1, "子癸甲申"], [2, "壬卯乙未坤"], [6, "戌乾亥辰巽巳"], [7, "酉辛丑艮丙"], [9, "寅午庚丁"]]) for (const m of ms) XK_REPLACE[m] = s;
export const XK_PATH = [5, 6, 7, 8, 9, 1, 2, 3, 4];
export const XK_DIR = { 1: "북", 8: "북동", 3: "동", 4: "남동", 9: "남", 2: "남서", 7: "서", 6: "북서", 5: "중앙" };
export const XK_NUM = "零一二三四五六七八九";

export const xkYun = (n) => XK_NUM[n] + "運";
export function xkFly(center, forward = true) {
  const s = forward ? 1 : -1, out = {};
  XK_PATH.forEach((p, k) => { out[p] = mod(center - 1 + s * k, 9) + 1; });
  return out;
}
export const xkMtIndex = (deg) => mod(Math.floor(mod(deg - 337.5, 360.0) / 15), 24);
export const xkOffset = (deg, i) => mod(deg - mod(345.0 + 15 * i, 360.0) + 180.0, 360.0) - 180.0;
export function xkPeriodOfYear(year) {
  const i = Math.floor((year - 1864) / 20);
  return [mod(i, 9) + 1, 1864 + 20 * i, 1864 + 20 * i + 19];
}
export function xkState(star, n) {
  if (star === 5 && n !== 5) return "煞";
  return { 0: "旺", 1: "生", 2: "生", 8: "退", 7: "衰" }[mod(star - n, 9)] ?? "死";
}
export function xkChart(period, facingDeg, replaceMode = "auto") {
  const fi = xkMtIndex(facingDeg), si = (fi + 12) % 24, yuan = fi % 3, off = xkOffset(facingDeg, fi);
  const useRep = replaceMode === "auto" ? Math.abs(off) > 3.0 : replaceMode === "replace";
  const fPal = XK_PAL_ORDER[Math.floor(fi / 3)], sPal = XK_PAL_ORDER[Math.floor(si / 3)];
  const yun = xkFly(period, true);
  const start = (base, ownMt) => {
    let ref, center;
    if (base === 5) { ref = ownMt; center = useRep ? (XK_REPLACE[ref] ?? 5) : 5; }
    else { ref = XK_PAL_MTS[base][yuan]; center = useRep && ref in XK_REPLACE ? XK_REPLACE[ref] : base; }
    return [center, XK_YANG.has(ref)];
  };
  const [mc, mf] = start(yun[sPal], XK_MT[si]);
  const [wc, wf] = start(yun[fPal], XK_MT[fi]);
  return { period, deg: mod(facingDeg, 360.0), f_mt: XK_MT[fi], s_mt: XK_MT[si], f_ko: XK_MT_KO[fi], s_ko: XK_MT_KO[si], f_pal: fPal, s_pal: sPal,
    off, replace: useRep, yun, mtn: xkFly(mc, mf), wat: xkFly(wc, wf), m_fwd: mf, w_fwd: wf };
}
export const xkSide = (p) => (p === 5 ? "집 한가운데" : XK_DIR[p] + "쪽");
export const xkWhere = (chart, n) => { for (let p = 1; p <= 9; p++) if (chart[p] === n) return p; throw new Error("없음"); };

export function xkFormation(ch, n) {
  const mAt = xkWhere(ch.mtn, n), wAt = xkWhere(ch.wat, n), S = ch.s_pal, F = ch.f_pal;
  if (mAt === S && wAt === F) return "뒤(앉은 쪽)와 앞(바라보는 쪽) 모두 지금 시기의 좋은 기운이 맞게 놓인 배치예요. 전통 현공풍수에서 가장 반기는 구조(旺山旺向)로 봐요.";
  if (mAt === F && wAt === S) return "좋은 기운이 앞뒤로 바뀌어 놓인 배치(上山下水)예요. 전통적으로는 집 앞쪽이 높고 뒤쪽이 낮거나 트여 있으면 보완된다고 봐요.";
  if (mAt === F && wAt === F) return "좋은 기운이 집 앞쪽에 모인 배치(雙星會向)예요. 앞쪽이 트여 있고 그 너머에 높은 건물·산이 있으면 좋다고 봐요.";
  if (mAt === S && wAt === S) return "좋은 기운이 집 뒤쪽에 모인 배치(雙星會坐)예요. 뒤쪽에 산·높은 건물이 있고 그 앞(또는 뒤)이 트여 있으면 좋다고 봐요.";
  return `지금 시기의 좋은 기운이 ${xkSide(mAt)}(사람·휴식)과 ${xkSide(wAt)}(활동·재물)에 있어요.`;
}
export function xkRoomAdvice(m, w, n) {
  const sm = xkState(m, n), sw = xkState(w, n), good = ["旺", "生"];
  if ((m === 5 || w === 5) && n !== 5) return ["■", ["오래 머무는 방보다 수납·드레스룸 추천", "정리정돈·밝은 조명 권장"]];
  const tips = []; let icon = "·";
  if (good.includes(sw) && good.includes(sm)) { icon = "★"; tips.push("활동·휴식 기운이 모두 좋은 자리 — 거실·안방 추천"); }
  else if (good.includes(sw)) { icon = "★"; tips.push("활동 기운이 좋은 자리 — 거실·현관·업무 공간 추천"); }
  else if (good.includes(sm)) { icon = "●"; tips.push("휴식 기운이 좋은 자리 — 침실·서재 추천"); }
  const stars = new Set([m, w]);
  if (stars.has(2) && !good.includes(xkState(2, n))) tips.push("환기·청소를 자주 하면 좋은 자리");
  if ((stars.has(1) && stars.has(4)) || (stars.has(4) && xkState(4, n) !== "煞")) { if (!tips.some((t) => t.includes("공부"))) tips.push("공부방·책상 자리로도 추천"); }
  if (stars.has(3) && !good.includes(xkState(3, n))) tips.push("차분한 용도 추천");
  if (stars.has(7) && !good.includes(xkState(7, n))) tips.push("문단속·보안 점검 권장");
  if (stars.has(6) && !tips.some((t) => t.includes("업무") || t.includes("서재"))) tips.push("업무·서재 용도로도 무난");
  if (!tips.length) tips.push("평범한 자리 — 용도에 맞게 자유롭게 사용");
  return [icon, tips.slice(0, 2)];
}
export const XK_STATE_WORD = { 旺: "가장 왕성", 生: "점점 좋아지는", 退: "서서히 약해지는", 衰: "약해진", 死: "쉬어 가는", 煞: "조심이 필요한" };
export function xkPeriodStory(ch, n) {
  const S = ch.s_pal, F = ch.f_pal, sm = xkState(ch.mtn[S], n), sw = xkState(ch.wat[F], n), good = ["旺", "生"];
  let life;
  if (good.includes(sm) && good.includes(sw)) life = "활동과 가정생활 모두 순조로운 시기로 봐요";
  else if (good.includes(sw)) life = "바깥 활동·일은 활발하지만, 가족 건강·휴식에는 조금 더 신경 쓰면 좋은 시기로 봐요";
  else if (good.includes(sm)) life = "가정·건강은 안정적이지만, 활동·재물 흐름은 차분한 시기로 봐요";
  else life = `좋은 기운이 다른 칸(${xkSide(xkWhere(ch.mtn, n))}·${xkSide(xkWhere(ch.wat, n))})으로 옮겨 간 시기로, 그 칸을 잘 활용하면 좋다고 봐요`;
  if (sm === "煞" || sw === "煞") life += " (앞·뒤 쪽은 정리정돈·환기 권장)";
  return `뒤쪽 사람·가정 기운 '${XK_STATE_WORD[sm]}', 앞쪽 활동·재물 기운 '${XK_STATE_WORD[sw]}' → 전통 해석상 ${life}.`;
}
export function xkTimeline(ch, builtYear, nowYear) {
  const iBuilt = Math.floor((builtYear - 1864) / 20), iNow = Math.floor((nowYear - 1864) / 20);
  let idxs = []; for (let i = iBuilt; i < iNow + 2; i++) idxs.push(i);
  if (idxs.length > 4) idxs = [idxs[0], ...idxs.slice(-3)];
  const out = ["[시기별 흐름] (20년마다 바뀌는 '운'에 따라 좋은 기운의 자리가 옮겨 간다고 봐요)"];
  for (const i of idxs) {
    const n = mod(i, 9) + 1, a = 1864 + 20 * i, b = a + 19, tag = [];
    if (i === iBuilt) tag.push("지어진 시기");
    if (i === iNow) tag.push("지금");
    if (i === iNow + 1) tag.push("다음");
    out.push(` • ${xkYun(n)}(${a}~${b}${tag.length ? ", " + tag.join("·") : ""}): ${xkPeriodStory(ch, n)}`);
  }
  const nxt = mod(iNow + 1, 9) + 1;
  out.push(`[운이 바뀔 때] 지금 운이 끝나는 ${1864 + 20 * (iNow + 1)}년부터는 ${xkYun(nxt)}이 되어, 좋은 기운의 자리가 ${xkSide(xkWhere(ch.mtn, nxt))}(사람·휴식)과 ${xkSide(xkWhere(ch.wat, nxt))}(활동·재물)으로 옮겨 간다고 봐요. 전통 해석에서는 큰 수리(지붕·대문·창 교체 등)를 하면 그 시기의 운으로 다시 본다(換天心)고도 해요.`);
  return out;
}
export const XK_DISCLAIMER = "※ 본 자료는 지도 기반의 풍수지리 컨설팅 참고자료이며, 상세한 분석에는 현장 실측 및 추가 확인이 필요합니다. 전통 풍수이론에 따른 참고 의견으로, 법정 중개대상물 확인·설명서를 대체하지 않습니다.";
const ORDER8 = [1, 8, 3, 4, 9, 2, 7, 6];
export function xkReport(facingDeg, builtYear, nowYear, replaceMode = "auto") {
  const [pBuilt, a, b] = xkPeriodOfYear(builtYear), [n, na, nb] = xkPeriodOfYear(nowYear);
  const ch = xkChart(pBuilt, facingDeg, replaceMode);
  const rooms = {}; for (let p = 1; p <= 9; p++) rooms[p] = xkRoomAdvice(ch.mtn[p], ch.wat[p], n);
  const head = `${ch.s_ko}좌${ch.f_ko}향 (${ch.s_ko}${ch.s_mt}坐 ${ch.f_ko}${ch.f_mt}向) · 대문 방향 ${fixed(ch.deg, 1)}°`;
  const lines = [`[집의 방향] ${head}`, `[지어진 시기] ${builtYear}년 준공 → ${xkYun(pBuilt)}(${a}~${b}년) 건물, 지금은 ${xkYun(n)}(${na}~${nb}년)`, `[전체 구조] ${xkFormation(ch, n)}`];
  if (ch.replace) lines.push(`[참고] 방향이 방위 경계 쪽으로 ${fixed(ch.off, 1)}° 기울어 있어 보정 계산(替卦)을 적용했어요.`);
  if (Math.abs(ch.off) >= 6.0) lines.push("[참고] 방향이 두 방위의 경계에 가까워요. 나침반으로 한 번 더 재 보길 권장해요.");
  lines.push(...xkTimeline(ch, builtYear, nowYear));
  lines.push(`[칸별 생활 제안] (지금 ${xkYun(n)} 기준)`);
  for (const p of ORDER8) {
    const [icon, tips] = rooms[p];
    const tag = p === ch.f_pal ? " (앞)" : p === ch.s_pal ? " (뒤)" : "";
    lines.push(` ${icon} ${XK_DIR[p]}${tag}: ${tips.join(" / ")}`);
  }
  lines.push(XK_DISCLAIMER);
  const bestLive = ORDER8.filter((p) => rooms[p][0] === "★").map((p) => XK_DIR[p]);
  const bestRest = ORDER8.filter((p) => rooms[p][0] === "●").map((p) => XK_DIR[p]);
  const store = ORDER8.filter((p) => rooms[p][0] === "■").map((p) => XK_DIR[p]);
  const short = [`• 풍수(현공) 참고: ${ch.s_ko}좌${ch.f_ko}향 · ${xkYun(pBuilt)} 건물`];
  if (bestLive.length) short.push("• 거실·활동 공간 추천: " + bestLive.join(", "));
  if (bestRest.length) short.push("• 침실·휴식 공간 추천: " + bestRest.join(", "));
  if (store.length) short.push("• 수납·드레스룸 추천: " + store.join(", "));
  short.push(XK_DISCLAIMER);
  return { chart: ch, now: n, built: builtYear, rooms, detail: lines.join("\n"), short: short.join("\n") };
}

// ═══════════════ B. plugins/xk_judge/xuankong_rules.py ═══════════════
export const MOUNTAINS = ["子", "癸", "丑", "艮", "寅", "甲", "卯", "乙", "辰", "巽", "巳", "丙", "午", "丁", "未", "坤", "申", "庚", "酉", "辛", "戌", "乾", "亥", "壬"];
export const PALACE_TRIO = { 1: ["壬", "子", "癸"], 8: ["丑", "艮", "寅"], 3: ["甲", "卯", "乙"], 4: ["辰", "巽", "巳"], 9: ["丙", "午", "丁"], 2: ["未", "坤", "申"], 7: ["庚", "酉", "辛"], 6: ["戌", "乾", "亥"] };
export const PALACE_NAME = { 1: "坎(北)", 2: "坤(西南)", 3: "震(東)", 4: "巽(東南)", 5: "中宮", 6: "乾(西北)", 7: "兌(西)", 8: "艮(東北)", 9: "離(南)" };
export const TI_STAR = {};
for (const [s, ms] of [[1, "子癸甲申"], [2, "坤壬乙卯未"], [6, "戌乾亥辰巽巳"], [7, "艮丙辛酉丑"], [9, "寅午庚丁"]]) for (const m of ms) TI_STAR[m] = s;
export const FLY_ORDER = [5, 6, 7, 8, 9, 1, 2, 3, 4];
export const WUXING = { 1: "水", 2: "土", 3: "木", 4: "木", 5: "土", 6: "金", 7: "金", 8: "土", 9: "火" };
const SHENG = { 水: "木", 木: "火", 火: "土", 土: "金", 金: "水" };
const KE = { 水: "火", 火: "金", 金: "木", 木: "土", 土: "水" };
const YANG_STARS = new Set([1, 3, 6, 8]), YIN_STARS = new Set([2, 4, 7, 9]);

export const palacePolarity = (palace, sub) => ([1, 3, 7, 9].includes(palace) ? [+1, -1, -1][sub] : [-1, +1, +1][sub]);
export function locate(mountain) {
  for (const p of [1, 8, 3, 4, 9, 2, 7, 6]) { const i = PALACE_TRIO[p].indexOf(mountain); if (i >= 0) return [p, i]; }
  throw new Error(mountain);
}
export function fly(center, forward = true) {
  const out = {}; FLY_ORDER.forEach((p, k) => { out[p] = mod(center + (forward ? k : -k) - 1, 9) + 1; }); return out;
}
export function mountainAt(deg) {
  deg = mod(deg, 360.0);
  const i = mod(Math.floor((deg + 7.5) / 15), 24), off = mod(deg - i * 15 + 180, 360) - 180;
  return [MOUNTAINS[i], i, off];
}
const BRANCHES = "子丑寅卯辰巳午未申酉戌亥";
export function fenjin(deg) {
  const [m, i, off] = mountainAt(deg);
  const k = Math.min(4, Math.max(0, Math.floor((off + 7.5) / 3))), b = i % 12;
  const stems = b % 2 === 0 ? "甲丙戊庚壬" : "乙丁己辛癸";
  return { 山: m, 중심편차: pyRound(off, 2), 분금: stems[k] + BRANCHES[b], 순번: k + 1, 사용: k >= 1 && k <= 3, 경계까지: pyRound(7.5 - Math.abs(off), 2) };
}
function startStar(yun, mountain, useTi) {
  const [p, sub] = locate(mountain), n = yun[p];
  if (n === 5) return [5, palacePolarity(p, sub) > 0, mountain, n];
  const corr = PALACE_TRIO[n][sub], fwd = palacePolarity(n, sub) > 0;
  return [useTi ? TI_STAR[corr] : n, fwd, corr, n];
}
export function makeChart(period, facingDeg, useTi = false) {
  const [facing, fi] = mountainAt(facingDeg), sitting = MOUNTAINS[(fi + 12) % 24], yun = fly(period);
  const [ms, mf, mc, mn] = startStar(yun, sitting, useTi), [ws, wf, wc, wn] = startStar(yun, facing, useTi);
  const d = (f) => (f ? "順" : "逆");
  return { period, sitting, facing, use_ti: useTi, sit_palace: locate(sitting)[0], face_palace: locate(facing)[0], yun, mountain: fly(ms, mf), water: fly(ws, wf),
    basis: `山星 ${mn}→${ms}(${mc},${d(mf)}) · 向星 ${wn}→${ws}(${wc},${d(wf)})` + (useTi ? " · 替卦" : " · 下卦") };
}
export const annualCenter = (year) => mod((2 - (year - 2025)) - 1, 9) + 1;
export const GOOD = new Set(["旺", "生", "次生"]);
export function status(star, period) {
  if (star === 5 && period !== 5) return "殺";
  return { 0: "旺", 1: "生", 2: "次生", 8: "退", 7: "衰" }[mod(star - period, 9)] ?? "死";
}
export function rel(a, b) {
  const ea = WUXING[a], eb = WUXING[b];
  if (ea === eb) return "比和";
  if (SHENG[ea] === eb) return "生";
  if (SHENG[eb] === ea) return "被生";
  return KE[ea] === eb ? "剋" : "被剋";
}
function lianzhu(a, b, c) {
  const s = new Set([a, b, c]);
  if (s.size !== 3) return false;
  for (let x = 1; x <= 9; x++) { const t = [x, (x % 9) + 1, ((x + 1) % 9) + 1]; if (t.every((v) => s.has(v)) && new Set(t).size === 3) return true; }
  return false;
}
export const pk = (a, b) => sorted([...`${a}${b}`]).join("");
const S_ = (...a) => new Set(a);
const HESHI = S_("19", "28", "37", "46"), SHENGCHENG = S_("16", "27", "38", "49"), ZHENGPEI = S_("19", "26", "34", "78"), FU = S_("68", "29", "89"), GUI = S_("39", "49", "13", "14");
const DOUNIU = S_("23", "24"), CHUANXIN = S_("36", "46", "37", "47"), JIAOJIAN = S_("67");
const BIG_GOOD = S_("14", "16", "68", "89"), BIG_BAD = S_("12", "15", "25", "37", "38", "46", "47", "48", "69", "79"), XIANHOU = S_("17", "12", "38", "24", "69", "47", "68", "39");
const THIRD_MOD = { "1,2,5": "凶 가중", "2,1,5": "凶 가중", "1,3,7": "凶 가중", "2,6,8": "吉 가중", "2,6,9": "吉 가중", "3,9,7": "凶 가중", "5,9,7": "凶 가중", "9,5,7": "凶 가중" };
const TRIPLES = [[[1, 2, 5], "大凶", "1·2·5: 불임·신장/자궁 계통 경고"], [[2, 7, 9], "大凶", "2·7·9: 화재 최고 경고"], [[5, 7, 9], "凶", "9·5 + 7: 독·식중독 경고"]];
const CANCER_PART = { 1: "자궁·신장", 2: "위·피부", 3: "간", 4: "유방", 5: "내장기관·피부", 6: "폐·뇌", 7: "인후", 8: "코", 9: "심장·혈액" };
const PAIR_PAGES = { 12: 436, 13: 436, 14: 436, 15: 437, 16: 437, 17: 437, 18: 437, 19: 438, 22: 438, 23: 438, 24: 439, 25: 439, 26: 440, 27: 440, 28: 441, 29: 441, 33: 441, 34: 442, 35: 442, 36: 442, 37: 443, 38: 443, 39: 443, 44: 443, 45: 443, 46: 444, 47: 444, 48: 444, 49: 444, 55: 445, 56: 445, 57: 445, 58: 445, 59: 445, 66: 446, 67: 446, 68: 447, 69: 447, 77: 448, 78: 448, 79: 448, 88: 448, 89: 449, 99: 450 };
export const PAIR_NOTES = {};
for (let a = 1; a <= 9; a++) for (let b = a; b <= 9; b++) PAIR_NOTES[pk(a, b)] = { 득운: [], 실운: [], page: PAIR_PAGES[pk(a, b)] ?? null };
Object.assign(PAIR_NOTES["14"], { 득운: ["시험·학업", "명예"], 실운: ["도화", "투기·사기"] });

export function evaluatePalace(p, m, w, yunStar, period, { yearStar = null, room = null, terrain = null, gainMode = "any" } = {}) {
  const tags = [], add = (lv, t) => tags.push([lv, t]);
  const sm = status(m, period), sw = status(w, period);
  const gain = gainMode === "any" ? (GOOD.has(sm) || GOOD.has(sw)) : (GOOD.has(sm) && GOOD.has(sw));
  const k = pk(m, w), thirds = [yunStar, ...(yearStar ? [yearStar] : [])];
  for (const [s, name] of [[HESHI, "合十"], [SHENGCHENG, "聯星(生成)"], [ZHENGPEI, "正配"], [FU, "富 조합"], [GUI, "貴 조합"]]) if (s.has(k)) add(gain ? "吉" : "참고", name);
  for (const [s, name] of [[DOUNIU, "鬪牛殺"], [CHUANXIN, "穿心殺"], [JIAOJIAN, "交劍殺"]]) if (s.has(k)) add(gain ? "注意" : (k === "37" ? "大凶" : "凶"), name);
  if ((m === 5 || w === 5) && period !== 5) add("凶", "五黃 비출" + (m === 2 || w === 2 ? " + 2: 질병 경고" : ""));
  if (BIG_GOOD.has(k) && gain) add("大吉", "★ 대길 조합");
  if (BIG_BAD.has(k) && !gain) add("大凶", "▼ 대흉 조합");
  if (rel(w, m) === "剋") add("凶", "向星剋山星 (강하고 빠름)");
  else if (rel(m, w) === "剋") add("小凶", "山星剋向星 (약하고 느림)");
  else if (rel(w, m) === "生") add("小吉", "向星生山星");
  else if (rel(m, w) === "生") add("小吉", "山星生向星");
  if (rel(m, yunStar) === "剋" && rel(w, yunStar) === "剋") add("小凶", "山·向星剋運盤");
  if (rel(m, yunStar) === "生" && rel(w, yunStar) === "生") add("小吉", "山·向星生運盤");
  if (m + yunStar === 10) add("吉", "山星+運盤 合十");
  if (w + yunStar === 10) add("吉", "向星+運盤 合十");
  if (m + yunStar === 5) add("吉", "山星+運盤 合五");
  if (w + yunStar === 5) add("吉", "向星+運盤 合五");
  if (lianzhu(m, w, yunStar)) add("吉", "連珠三般卦");
  const mw = [m, w];
  if (mw.every((x) => YANG_STARS.has(x))) add("注意", "純陽 조합");
  else if (mw.every((x) => YIN_STARS.has(x))) add("注意", "純陰 조합");
  if (XIANHOU.has(k)) add("참고", "선천·후천 통함");
  const stars = new Set([m, w, ...thirds]);
  for (const [need, lv, txt] of TRIPLES) if (need.every((x) => stars.has(x))) add(lv, txt);
  if (stars.has(5) && (stars.has(3) || stars.has(4)) && period !== 5) add("注意", "3·4 + 5: 전염병 경고");
  if (k === "25" && !gain) for (const t of thirds) add("凶", `25 + ${t}: ${CANCER_PART[t]} 계통 주의`);
  for (const t of thirds) { const key = `${w},${m},${t}`; if (key in THIRD_MOD) add("참고", `向${w}·山${m} + ${t}: ${THIRD_MOD[key]}`); }
  if (p === 5 && (k === "26" || k === "57") && !gain) add("注意", `${k} 中宮 실운 (형기 확인)`);
  if ((k === "29" || k === "89") && yearStar === 8) add("吉", "年星 8 가세: 경사 증폭");
  if (room === "주방" && k === "59") add("凶", "59 방위 주방");
  if (room === "공부방" && k === "89" && period === 8) add("注意", "8運 89 공부방 비추천");
  if (room === "신혼방" && (k === "26" || [1, 2, 5].every((x) => stars.has(x))) && !gain) add("注意", "신혼방 부적합");
  for (const [name, s, st] of [["山星", m, sm], ["向星", w, sw]]) if (st === "退" && period !== 5 && WUXING[s] === WUXING[period]) add("참고", `${name} ${s} 退氣지만 旺星과 同五行 → 흉 완화`);
  if (terrain && "rel_height" in terrain) {
    const h = terrain.rel_height;
    if (GOOD.has(sm) && h < 0) add("注意", "山星 득운인데 지형이 낮음 (형기 불일치)");
    if (GOOD.has(sw) && h > 0) add("注意", "向星 득운인데 지형이 높고 막힘 (형기 불일치)");
    if (!GOOD.has(sm) && h > 0) add("注意", "실운 山星 방향이 높음 → 흉 발현 가능");
  }
  return { palace: p, name: PALACE_NAME[p], stars: [m, w, yunStar], status: [sm, sw], key: k, page: PAIR_NOTES[k].page, notes: PAIR_NOTES[k], tags };
}
function fuyinFanyin(layer) {
  const outer = [1, 2, 3, 4, 6, 7, 8, 9];
  const fu = outer.filter((p) => layer[p] === p).length, fan = outer.filter((p) => layer[p] + p === 10).length;
  if (fu === 8) return "滿盤伏吟";
  if (fan === 8) return "滿盤返吟";
  const parts = []; if (fu) parts.push(`伏吟 ${fu}궁`); if (fan) parts.push(`返吟 ${fan}궁`);
  return parts.join(", ") || "없음";
}
export function evaluateChart(chart, { year = null, rooms = null, terrain = null, gainMode = "any" } = {}) {
  const P = chart.period, M = chart.mountain, W = chart.water, Y = chart.yun, sp = chart.sit_palace, fp = chart.face_palace;
  let ju;
  if (M[sp] === P && W[fp] === P) ju = "旺山旺向"; else if (M[fp] === P && W[sp] === P) ju = "上山下水";
  else if (M[fp] === P && W[fp] === P) ju = "雙星會向"; else if (M[sp] === P && W[sp] === P) ju = "雙星會坐"; else ju = "기타";
  const special = [], all = [1, 2, 3, 4, 5, 6, 7, 8, 9];
  if (M[5] === P) special.push("山星入囚");
  if (W[5] === P) special.push("向星入囚");
  if (all.every((p) => M[p] + Y[p] === 10)) special.push("山星·運盤 全盤合十");
  if (all.every((p) => W[p] + Y[p] === 10)) special.push("向星·運盤 全盤合十");
  if (all.every((p) => M[p] + W[p] === 10)) special.push("山星·向星 全盤合十");
  if (all.every((p) => lianzhu(M[p], W[p], Y[p]))) special.push("全盤 連珠三般卦");
  const yc = year ? fly(annualCenter(year)) : null;
  const palaces = [4, 9, 2, 3, 5, 7, 8, 1, 6].map((p) => evaluatePalace(p, M[p], W[p], Y[p], P, { yearStar: yc ? yc[p] : null, room: (rooms || {})[p] ?? null, terrain: (terrain || {})[p] ?? null, gainMode }));
  return { 四局: ju, 特記: special, "山星 反伏吟": fuyinFanyin(M), "向星 反伏吟": fuyinFanyin(W), basis: chart.basis, palaces };
}
