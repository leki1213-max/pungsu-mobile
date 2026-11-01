// 한국부동산원 R-ONE 아파트 가격 흐름 (노트북 scripts/reb_stats.py 를 옮김)
// transport(경로, 질문) -> 응답 글(JSON). 키(KEY)와 Type=json 은 transport 가 붙인다. 앱에서는 Worker 프록시(/p/reb/…)가 대신 부른다.
import { comma, signed } from "./publicdata.js";

export const START = "200601";
export const T_INDEX = "(월) 매매가격지수_아파트";
export const T_AVG_SGG = "(월) 평균매매가격_아파트";
export const T_AVG_SIDO = "(월) 지역별 매매 평균가격_아파트";
export const ERAS = [[8, "200401", "202312"], [9, "202401", "204312"]];
export const MIN_POINTS = 12;
export const RETRIES = 2;
const BASE = "/r-one/openapi/";

export class REBError extends Error {}
const pad2 = (n) => String(n).padStart(2, "0");
export const ymLabel = (ym) => `${ym.slice(0, 4)}-${ym.slice(4, 6)}`;
export const sourceLabel = (name, ym) => `한국부동산원 R-ONE, ${name}, 기준월 ${ymLabel(ym)}`;

export class Reb {
  constructor(transport, { today = new Date(), cache = null, sleepFn = (s) => new Promise((r) => setTimeout(r, s * 1000)) } = {}) { this.t = transport; this.today = today; this.cache = cache; this.sleep = sleepFn; }
  // R-ONE 호출. 연결 실패(시간 초과 포함)면 2번까지 다시 시도한다(2초·4초 쉼). 키 오류 등은 다시 시도하지 않는다. 파이썬 reb_stats._call 과 같음.
  async call(path, p) {
    for (let n = 0; n <= RETRIES; n++) {
      try { return await this.callOnce(path, p); } catch (e) {
        if (!(e instanceof REBError) || !e.message.startsWith("연결 실패") || n === RETRIES) throw e;
        await this.sleep(2.0 * (n + 1));
      }
    }
  }
  async callOnce(path, p) {
    let out;
    try { out = await this.t(BASE + path, p); } catch (e) { throw new REBError("연결 실패: " + String(e.message).slice(0, 120)); }
    let j;
    try { j = JSON.parse(out); } catch { throw new REBError("JSON 이 아닌 응답: " + String(out).slice(0, 120)); }
    if ("RESULT" in j && !Object.keys(j).some((x) => x.startsWith("Stts"))) {
      const res = j.RESULT;
      if (String(res.CODE || "") === "INFO-200") return {};
      throw new REBError(`${res.CODE || ""} ${res.MESSAGE || ""}`.trim());
    }
    return j;
  }
  rows(j, name) {
    const blk = j[name] || [];
    const head = (blk.find((b) => "head" in b) || { head: [] }).head;
    for (const h of head) if (h && typeof h === "object" && "RESULT" in h && String(h.RESULT.CODE || "").startsWith("ERROR")) throw new REBError(`${h.RESULT.CODE} ${h.RESULT.MESSAGE || ""}`);
    return (blk.find((b) => "row" in b) || { row: [] }).row;
  }
  async tables() {
    const key = "reb_tables_" + this.today.toISOString().slice(0, 10);
    if (this.cache) { const hit = await this.cache.get(key); if (hit) return hit; }
    let rows = [];
    for (let i = 1; ; i++) {
      const part = this.rows(await this.call("SttsApiTbl.do", { pIndex: i, pSize: 300 }), "SttsApiTbl");
      rows = rows.concat(part);
      if (part.length < 300) break;
    }
    if (this.cache) await this.cache.put(key, rows);
    return rows;
  }
  async findTable(name) {
    for (const r of await this.tables()) if (r.STATBL_NM === name) return [r.STATBL_ID, r.STATBL_NM, r.RPSTUI_NM];
    throw new REBError("통계표를 찾지 못했습니다: " + name);
  }
  async latestMonth(statbl) {
    let y = this.today.getUTCFullYear(), m = this.today.getUTCMonth() + 1;
    for (let i = 0; i < 8; i++) {
      const ym = `${y}${pad2(m)}`;
      if (this.rows(await this.call("SttsApiTblData.do", { STATBL_ID: statbl, DTACYCLE_CD: "MM", WRTTIME_IDTFR_ID: ym, pIndex: 1, pSize: 1 }), "SttsApiTblData").length) return ym;
      m--; if (!m) { m = 12; y--; }
    }
    throw new REBError("최근 자료 달을 찾지 못했습니다");
  }
  async classes(statbl, ym) {
    const out = [];
    for (const r of this.rows(await this.call("SttsApiTblData.do", { STATBL_ID: statbl, DTACYCLE_CD: "MM", WRTTIME_IDTFR_ID: ym, pIndex: 1, pSize: 1000 }), "SttsApiTblData")) {
      const full = r.CLS_FULLNM || r.CLS_NM;
      if (full) out.push([r.CLS_ID, full]);
    }
    return out;
  }
  static candidates(reg, clsList) {
    const { sido, sgg } = reg;
    const si = sgg.includes("시") && !sgg.endsWith("시") ? sgg.slice(0, sgg.indexOf("시") + 1) : "";
    const out = [];
    for (const [cid, full] of clsList) {
      const comps = full.split(">");
      if (!(sido.includes(comps[0]) || sido.startsWith(comps[0]))) continue;
      const last = comps[comps.length - 1];
      if (comps.length >= 2 && (last === sgg || sgg === comps[comps.length - 2] + last || (sgg.endsWith(last) && sgg.includes(comps[comps.length - 2])))) out.push(["시군구", cid, full]);
      else if (si && comps.length >= 2 && last === si) out.push(["시", cid, full]);
      else if (comps.length === 1) out.push(["시도", cid, full]);
    }
    const order = { 시군구: 0, 시: 1, 시도: 2 };
    return out.sort((a, b) => order[a[0]] - order[b[0]]);
  }
  async series(statbl, cid, end) {
    const rows = this.rows(await this.call("SttsApiTblData.do", { STATBL_ID: statbl, DTACYCLE_CD: "MM", CLS_ID: cid, START_WRTTIME: START, END_WRTTIME: end, pIndex: 1, pSize: 1000 }), "SttsApiTblData");
    const pts = rows.filter((r) => r.DTA_VAL !== null && r.DTA_VAL !== undefined && /^\d{6}$/.test(String(r.WRTTIME_IDTFR_ID)))
      .map((r) => [String(r.WRTTIME_IDTFR_ID), Number(r.DTA_VAL)])
      .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] - b[1]));
    return [pts, rows.length ? rows[0].UI_NM : ""];
  }
  // reg = Bjd.find() 결과. 반환: {region, series[], missing[]}
  async collect(reg) {
    const out = [], missing = [];
    for (const tname of [T_INDEX, T_AVG_SGG, T_AVG_SIDO]) {
      try {
        const [sid, nm, base] = await this.findTable(tname);
        const end = await this.latestMonth(sid);
        const tried = [];
        let chosen = null;
        for (const [lvl, cid, full] of Reb.candidates(reg, await this.classes(sid, end))) {
          const [pts, unit] = await this.series(sid, cid, end);
          tried.push(`${lvl} ${full}(${pts.length}개월)`);
          if (pts.length >= MIN_POINTS) {
            chosen = { table: sid, name: nm, unit, scope: full, level: lvl, points: pts, latest: pts[pts.length - 1][0], base,
              note: lvl === "시군구" ? "" : `시군구 단위 자료가 없거나 짧아 ${lvl} 단위로 대신함 (확인한 분류: ${tried.join(", ")})` };
            chosen.source = sourceLabel(nm, chosen.latest);
            break;
          }
        }
        if (chosen) out.push(chosen);
        else missing.push([tname, `이 지역에 맞는 분류가 없거나 자료가 ${MIN_POINTS}개월보다 짧습니다 (확인: ${tried.join("; ") || "없음"})`]);
      } catch (e) {
        if (!(e instanceof REBError)) throw e;
        missing.push([tname, e.message.slice(0, 120)]);
      }
    }
    return { region: reg, series: out, missing };
  }
}

export function eraSummary(points) {
  const rows = [];
  for (const [n, a, b] of ERAS) {
    const p = points.filter(([ym]) => a <= ym && ym <= b);
    if (!p.length) continue;
    let hi = p[0];
    for (const x of p) if (x[1] > hi[1]) hi = x;
    rows.push([n, p[0], p[p.length - 1], 100.0 * (p[p.length - 1][1] / p[0][1] - 1.0), hi]);
  }
  return rows;
}
export function yearly(points) {
  const by = new Map();
  for (const [ym, v] of points) { const y = ym.slice(0, 4); if (!by.has(y)) by.set(y, []); by.get(y).push(v); }
  return [...by].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([y, v]) => [y, v.reduce((s, x) => s + x, 0) / v.length, v.length]);
}
export const fmtVal = (v, unit) => ((unit || "") === "지수" ? comma(v, 1) : comma(v, 0));

export function md(res) {
  const reg = res.region;
  const L = [`# ${reg.name} — 아파트 매매가격지수·평균가격 (월별, 2006년~현재)`, "",
    `법정동 파일 기준 시도·시군구: ${reg.sido} ${reg.sgg}. R-ONE 은 시군구 단위까지만 제공해 동 단위는 없습니다. 7운(1984~2003)은 자료가 없어 8운·9운만 봅니다.`, ""];
  for (const s of res.series) {
    L.push(`## ${s.name}`, "", `출처: ${s.source}`, "", `지역: **${s.scope}** (${s.level} 단위) · 단위: ${s.unit || ""}${s.base ? " · " + s.base : ""}`, "");
    if (s.note) L.push("※ " + s.note, "");
    L.push("### 운별 흐름", "", "| 운 | 시작(달 · 값) | 끝(달 · 값) | 변화율 | 최고(달 · 값) |", "|---|---|---|---|---|");
    for (const [n, a, b, ch, hi] of eraSummary(s.points)) L.push(`| ${n}운 | ${ymLabel(a[0])} · ${fmtVal(a[1], s.unit)} | ${ymLabel(b[0])} · ${fmtVal(b[1], s.unit)} | ${signed(ch, 1)}% | ${ymLabel(hi[0])} · ${fmtVal(hi[1], s.unit)} |`);
    L.push("", "### 연도별 (연평균)", "", "| 연도 | 운 | 값 | 자료 달 수 |", "|---|---|---|---|");
    for (const [y, v, c] of yearly(s.points)) L.push(`| ${y} | ${parseInt(y, 10) <= 2023 ? 8 : 9}운 | ${fmtVal(v, s.unit)} | ${c} |`);
    L.push("");
  }
  if (res.missing.length) { L.push("## 가져오지 못한 통계", "", "| 통계 | 이유 |", "|---|---|"); for (const [a, b] of res.missing) L.push(`| ${a} | ${b} |`); L.push(""); }
  L.push("※ 지수는 기준 시점 = 100 으로 맞춘 상대 값이라 단위(지역) 사이의 수준 비교는 못 하고, 같은 지역의 시간 흐름만 봅니다.");
  return L.join("\n");
}
