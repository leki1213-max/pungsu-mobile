// 공공데이터 계산 (노트북 scripts/data_collect.py · bjd.py · store_stats.py · pop_stats.py 를 자바스크립트로 옮김)
// 휴대폰 브라우저와 Node 양쪽에서 같은 코드로 돈다. 호출은 transport(경로, 질문) 를 바꿔 끼워 프록시(Worker)나 직접 호출을 고른다.
// 표는 노트북과 같은 글(마크다운 줄)로 만든다 — 노트북 결과와 줄 단위로 비교하기 위해서다.

export const ERAS = [[7, 1984, 2003], [8, 2004, 2023], [9, 2024, 2043]];
export const START_YEAR = 2006;
export const APIS = {
  apt_trade: ["/1613000/RTMSDataSvcAptTradeDev/getRTMSDataSvcAptTradeDev", "아파트 매매 실거래가"],
  apt_rent: ["/1613000/RTMSDataSvcAptRent/getRTMSDataSvcAptRent", "아파트 전월세 실거래가"],
  nrg_trade: ["/1613000/RTMSDataSvcNrgTrade/getRTMSDataSvcNrgTrade", "상업업무용 부동산 매매 실거래가"],
};
export const PACE = { apt_trade: [3, 0.0], apt_rent: [3, 0.0], nrg_trade: [1, 0.6] };
export const BLD_PATH = "/1613000/BldRgstHubService/getBrTitleInfo";
export const POP_PATH = "/1741000/stdgPpltnHhStus/selectStdgPpltnHhStus";
export const DATA_START = "2006-01-01";

export class DataGoError extends Error {}
export const TIMEOUT_RETRIES = 2;
export const isTimeout = (msg) => msg.startsWith("연결 실패") || msg.includes("코드 05") || msg.toUpperCase().includes("TIMEOUT");
export class Ambiguous extends Error {}

// ───────── 파이썬과 같은 숫자 모양 ─────────
export function median(a) {
  const s = a.slice().sort((x, y) => x - y);
  const n = s.length;
  if (!n) throw new Error("빈 목록의 중위값");
  return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
}
export function num(x) {
  const s = String(x === undefined || x === null ? "" : x).replace(/,/g, "").trim();
  return /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(s) ? Number(s) : null;
}
// 파이썬 "{:,.Nf}" 와 같은 글. 정확히 반인 경우는 짝수 쪽으로 반올림(파이썬)하고 toFixed 는 올림이라 따로 처리한다.
export function fixed(v, nd) {
  // 이진수로 정확히 반(…5000)인 경우만 짝수로 올리고(파이썬), 나머지는 toFixed 가 정확히 반올림한다.
  const neg = v < 0 || Object.is(v, -0);
  const t = Math.abs(v).toFixed(Math.min(100, nd + 25));
  const [ip, fp = ""] = t.split(".");
  if (/^50*$/.test(fp.slice(nd))) {
    let n = BigInt(ip + fp.slice(0, nd));
    if (n % 2n === 1n) n += 1n;
    let d = n.toString().padStart(nd + 1, "0");
    const s = nd ? d.slice(0, d.length - nd) + "." + d.slice(d.length - nd) : d;
    return (neg ? "-" : "") + s;
  }
  return v.toFixed(nd);
}
export function comma(v, nd = 0) {
  let s = fixed(v, nd);
  const neg = s.startsWith("-");
  if (neg) s = s.slice(1);
  const [i, d] = s.split(".");
  return (neg ? "-" : "") + i.replace(/\B(?=(\d{3})+(?!\d))/g, ",") + (d !== undefined ? "." + d : "");
}
export const fmt = (v, nd = 0) => (v === null || v === undefined ? "—" : comma(v, nd));
export const eok = (v) => (v === null || v === undefined ? "—" : comma(v / 10000.0, 2) + "억");
export const signed = (v, nd) => { const s = fixed(v, nd); return s.startsWith("-") ? s : "+" + s; };
export function eraOf(year) {
  if (year < ERAS[0][1]) return "7운 이전";
  for (const [n, a, b] of ERAS) if (a <= year && year <= b) return n + "운";
  return "기타";
}
const pad2 = (n) => String(n).padStart(2, "0");
export function isoDate(d) { return d.getUTCFullYear() + "-" + pad2(d.getUTCMonth() + 1) + "-" + pad2(d.getUTCDate()); }
export function ymOf(d) { return d.getUTCFullYear() + pad2(d.getUTCMonth() + 1); }
export function sourceLabel(dataset, today, org = "국토교통부") { return `${org} · ${dataset} · 기준일 ${today}(조회일)`; }

// ───────── 법정동 코드 (bjd.py) ─────────
const SIDO_CUT = /(특별자치시|특별자치도|특별시|광역시|통합특별시|도)$/;
const stripSgg = (t) => t.replace(/[시군구]+$/, "");
const isSggWord = (t) => /[시군구]$/.test(t);
const isMetro = (t) => /(특별시|광역시|통합특별시)$/.test(t);

export class Bjd {
  // data = data/bjd.json 내용 {asof, rows:[[code,sido,sgg,emd,ri,created],...], history?:[[새,옛,개편일,설명]]}
  constructor(data, cache = {}) {
    this.asof = data.asof;
    this.rows = data.rows.map((r) => ({ code: r[0], sido: r[1], sgg: r[2], emd: r[3], ri: r[4], created: r[5] }));
    this.history = {};
    for (const r of data.history || []) if (r[0] && r[1]) (this.history[r[0].trim()] ||= []).push([r[1].trim(), (r[2] || "").trim(), (r[3] || "").trim()]);
    this.cache = cache;
  }
  sourceLabel() { return `국토교통부 · 전국 법정동 · 기준일 ${this.asof}`; }
  find(query) {
    let toks = query.trim().split(/\s+/).filter(Boolean);
    if (!toks.length) throw new Error("지역 이름이 비어 있습니다");
    let ri = "";
    let name = toks[toks.length - 1];
    if (toks.length >= 2 && name.endsWith("리") && /[읍면]$/.test(toks[toks.length - 2])) {
      ri = name; name = toks[toks.length - 2]; toks = toks.slice(0, -1);
    }
    let cand = this.rows.filter((r) => r.emd === name && r.ri === ri);
    if (!cand.length && !ri) throw new Error("그 이름의 읍·면·동을 법정동 파일에서 찾지 못했습니다(시·군·구 이름이면 동까지 써 주세요): " + query);
    if (!cand.length) throw new Error("법정동 파일에서 찾지 못했습니다: " + query);
    const heads = toks.slice(0, -1);
    const sidoT = heads.filter((t) => !isSggWord(t) || isMetro(t));
    const sggT = heads.filter((t) => isSggWord(t) && !isMetro(t));
    if (sidoT.length) {
      const by = cand.filter((r) => sidoT.some((t) => { const x = t.replace(SIDO_CUT, ""); return x && r.sido.includes(x); }));
      if (by.length) cand = by;
    }
    let groups = new Map();
    for (const r of cand) { const k = r.sido + "\u0000" + r.sgg; if (!groups.has(k)) groups.set(k, r); }
    if (groups.size > 1 && sggT.length) {
      const exact = new Map([...groups].filter(([, v]) => sggT.some((t) => v.sgg === t)));
      const loose = new Map([...groups].filter(([, v]) => sggT.some((t) => stripSgg(t) && v.sgg.includes(stripSgg(t)))));
      groups = exact.size ? exact : loose.size ? loose : groups;
    }
    if (groups.size > 1) throw new Ambiguous("같은 이름의 지역이 여러 곳입니다: " + [...groups.values()].map((v) => v.sido + " " + v.sgg).join(", "));
    const r = [...groups.values()][0];
    return { code: r.code, sido: r.sido, sgg: r.sgg, emd: r.emd, ri: r.ri, created: r.created,
      name: `${r.sido} ${r.sgg} ${r.emd}${r.ri ? " " + r.ri : ""}`.replace(/  /g, " "), sgg_cd: r.code.slice(0, 5) };
  }
  currentSggCodes(sidoCd) { return new Set(this.rows.filter((r) => r.code.startsWith(sidoCd) && r.emd !== "").map((r) => r.code.slice(0, 5))); }
  reorg(reg) {
    const sgg = this.rows.find((r) => r.code === reg.sgg_cd + "00000");
    const dates = [reg.created, sgg ? sgg.created : ""].filter(Boolean);
    const changed = dates.length ? dates.reduce((a, b) => (a > b ? a : b)) : "";
    return { needs_history: !!changed && changed >= DATA_START, changed_on: changed };
  }
  candidates(reg, limit = 60) {
    const used = this.currentSggCodes(reg.code.slice(0, 2));
    const nw = parseInt(reg.sgg_cd, 10);
    const lo = parseInt(reg.code.slice(0, 2), 10) * 1000;
    const pool = [];
    for (let i = 1; i < 1000; i++) if (!used.has(String(lo + i))) pool.push(lo + i);
    pool.sort((a, b) => ((a % 5 !== 0) - (b % 5 !== 0)) || (Math.abs(a - nw) - Math.abs(b - nw)) || (a - b));
    return pool.slice(0, limit).map(String);
  }
  async discover(reg, probe, limit = 60) {
    const info = this.reorg(reg);
    const d = new Date(info.changed_on + "T00:00:00Z");
    const before = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 0));
    const ym = ymOf(before);
    for (const c of this.candidates(reg, limit)) {
      try {
        if (await probe(c, reg.emd, ym)) return [c, `공공데이터 조회로 확인(${ym}월 자료에서 ${reg.emd} 확인)`];
      } catch (e) { return [null, "조회 실패: " + String(e.message).slice(0, 100)]; }
    }
    return [null, `후보 ${limit}개를 조회했지만 찾지 못했습니다`];
  }
  async lawdCodes(query, probe = null, limit = 60) {
    const reg = this.find(query);
    const info = this.reorg(reg);
    const out = [{ sgg: reg.sgg_cd, to: "", note: "현재 코드" }];
    const res = { region: reg, reorg: info, codes: out, old_unresolved: "", remapped: false };
    if (!info.needs_history) { out[0].from = ""; return res; }
    out[0].from = info.changed_on;
    if (probe) {
      const c0 = new Date(info.changed_on + "T00:00:00Z");
      const d0 = new Date(Date.UTC(c0.getUTCFullYear(), c0.getUTCMonth(), 0));
      try {
        if (await probe(reg.sgg_cd, reg.emd, ymOf(d0))) {
          out[0].from = "";
          out[0].note = `현재 코드 — 개편 전 자료도 이 코드로 조회됨(확인: ${d0.getUTCFullYear()}년 ${d0.getUTCMonth() + 1}월)`;
          res.remapped = true;
          return res;
        }
      } catch (e) { /* 파이썬과 같이 무시 */ }
    }
    const old = [];
    for (const [oc, , note] of this.history[reg.sgg_cd] || []) old.push([oc, "이력표" + (note ? " · " + note : "")]);
    const cached = this.cache[reg.code];
    if (!old.length && cached) old.push([cached.old_sgg, `이전에 찾아 둔 결과(${cached.how})`]);
    if (!old.length && probe) {
      const [oc, why] = await this.discover(reg, probe, limit);
      if (oc) { this.cache[reg.code] = { old_sgg: oc, how: why, found: isoDate(new Date()), changed_on: info.changed_on }; old.push([oc, why]); }
      else res.old_unresolved = why;
    }
    if (!old.length && !probe && !res.old_unresolved) res.old_unresolved = "이력표·찾아 둔 결과가 없고, 공공데이터 조회(probe)를 쓰지 않았습니다";
    const last = info.changed_on;
    for (const [oc, how] of old) {
      const e = new Date(new Date(last + "T00:00:00Z").getTime() - 86400000);
      out.push({ sgg: oc, from: "", to: isoDate(e), note: "옛 코드 — " + how, old_bjd: oc + reg.code.slice(5) });
    }
    return res;
  }
}

// ───────── 공공데이터포털 호출 (data_collect.py) ─────────
const sleep = (s) => new Promise((r) => setTimeout(r, s * 1000));
const unesc = (s) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16))).replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d)).replace(/&amp;/g, "&");
const tagText = (x, tag) => { const m = x.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`)); return m ? unesc(m[1]).trim() : ""; };

export function itemsXml(body) {
  const code = tagText(body, "resultCode");
  if (code && code !== "00" && code !== "000") throw new DataGoError(`${tagText(body, "resultMsg")} (코드 ${code})`);
  const items = [];
  for (const m of body.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const it = {};
    for (const c of m[1].matchAll(/<(\w+)>([\s\S]*?)<\/\1>|<(\w+)\s*\/>/g)) it[c[1] || c[3]] = c[1] ? unesc(c[2]).trim() : "";
    items.push(it);
  }
  return [parseInt(tagText(body, "totalCount") || "0", 10), items];
}

export class DataGo {
  // transport(path, params) -> 응답 본문 글. 키는 transport 가 붙인다(이 코드는 키를 다루지 않는다).
  constructor(transport, { today = new Date(), cache = null, sleepFn = sleep } = {}) {
    this.t = transport; this.today = today; this.cache = cache; this.sleep = sleepFn;
  }
  todayIso() { return isoDate(this.today); }
  async once(path, params) {
    let body;
    try { body = await this.t(path, params); } catch (e) { throw new DataGoError("연결 실패: " + String(e.message).slice(0, 80)); }
    if (!String(body).trim()) throw new DataGoError("빈 응답 (코드 23)");
    const head = body.slice(0, 400);
    if (head.includes("OpenAPI_ServiceResponse") || head.includes("cmmMsgHeader")) {
      const g = (t) => { const m = body.match(new RegExp(`(?:<${t}>|"${t}": ")([\\s\\S]*?)(?:</${t}>|")`)); return m ? m[1].trim() : ""; };
      throw new DataGoError(`${g("returnAuthMsg")} (${g("errMsg")}, 코드 ${g("returnReasonCode") || "?"})`);
    }
    return body;
  }
  // 호출 한 번. 초당 요청 제한(코드 23)이면 잠깐 쉬었다 다시 하고, 시간 초과(연결 실패·서비스 연결실패 코드 05)면 2번까지 다시 시도한다(파이썬 data_collect._data_go 와 같음).
  async call(path, params) {
    let retryTimeout = 0;
    for (let n = 0; n < 8; n++) {
      try { return await this.once(path, params); } catch (e) {
        if (!(e instanceof DataGoError)) throw e;
        if (isTimeout(e.message) && retryTimeout < TIMEOUT_RETRIES) { retryTimeout++; await this.sleep(2.0 * retryTimeout); continue; }
        if (!e.message.includes("코드 23") || n === 7) throw e;
        await this.sleep(0.6 * (n + 1));
      }
    }
  }
  async monthItems(api, lawd, ym) {
    const path = APIS[api][0];
    let out = [];
    for (let page = 1; ; page++) {
      const [total, its] = itemsXml(await this.call(path, { LAWD_CD: lawd, DEAL_YMD: ym, numOfRows: "1000", pageNo: String(page) }));
      out = out.concat(its);
      if (!its.length || out.length >= total) return out;
    }
  }
  async probeTrade(sgg, umd, ym) { return (await this.monthItems("apt_trade", sgg, ym)).some((r) => r.umdNm === umd); }
  months() {
    const y = this.today.getUTCFullYear(), m = this.today.getUTCMonth() + 1, out = [];
    for (let yy = START_YEAR; yy <= y; yy++) for (let mm = 1; mm <= 12; mm++) if (yy < y || mm <= m) out.push(`${yy}${pad2(mm)}`);
    return out;
  }
  async monthRows(api, lawd, ym, umd) {
    const key = `${api}_${lawd}_${ym}_${umd.replace(/[^\p{L}\p{N}_]/gu, "")}`;
    const past = ym < this.todayIso().slice(0, 4) + this.todayIso().slice(5, 7);
    if (past && this.cache) { const hit = await this.cache.get(key); if (hit) return hit; }
    const rows = (await this.monthItems(api, lawd, ym)).filter((r) => r.umdNm === umd && (r.cdealType || "") !== "O");
    await this.sleep(PACE[api][1]);
    if (past && this.cache) await this.cache.put(key, rows);
    return rows;
  }
  async allRows(api, codes, umd, onProgress = null) {
    const months = this.months();
    const res = new Array(months.length);
    let next = 0, done = 0;
    const worker = async () => {
      while (next < months.length) {
        const i = next++;
        let got = [];
        for (const c of codes) got = got.concat(await this.monthRows(api, c, months[i], umd));
        res[i] = got;
        if (onProgress) onProgress(++done, months.length);
      }
    };
    await Promise.all(Array.from({ length: PACE[api][0] }, worker));
    return res.flat();
  }
  async bldTitles(sgg5, bjd5) {
    let out = [];
    for (let page = 1; ; page++) {
      const [total, its] = itemsXml(await this.call(BLD_PATH, { sigunguCd: sgg5, bjdongCd: bjd5, numOfRows: "1000", pageNo: String(page) }));
      out = out.concat(its);
      if (!its.length || out.length >= total) return out;
    }
  }
  async popMonth(sgg, ym) {
    const key = `pop_${sgg}_${ym}`;
    if (this.cache) { const hit = await this.cache.get(key); if (hit) return hit; }
    let out = [];
    for (let page = 1; ; page++) {
      const body = await this.call(POP_PATH, { stdgCd: sgg + "00000", srchFrYm: ym, srchToYm: ym, lv: "3", regSeCd: "1", type: "JSON", numOfRows: "100", pageNo: String(page) });
      const j = JSON.parse(body).Response;
      const h = j.head;
      if (h.resultCode === "3") return null;
      if (h.resultCode !== "0") throw new DataGoError(`${h.resultMsg} (${h.resultCode})`);
      const it = j.items.item;
      out = out.concat(Array.isArray(it) ? it : [it]);
      if (out.length >= parseInt(h.totalCount, 10)) break;
    }
    const lim = new Date(Date.UTC(this.today.getUTCFullYear(), this.today.getUTCMonth(), 1) - 45 * 86400000);
    if (this.cache && ym < ymOf(lim)) await this.cache.put(key, out);
    return out;
  }
  async popMonthly(reg, emd = null) {
    emd = emd || reg.emd;
    let d = new Date(Date.UTC(this.today.getUTCFullYear(), this.today.getUTCMonth(), 1));
    const pts = []; let miss = 0;
    for (let i = 0; i < 240; i++) {
      d = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 0)); d = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
      const ym = ymOf(d);
      const rows = await this.popMonth(reg.sgg_cd, ym);
      const hit = rows ? rows.filter((x) => x.stdgNm === emd) : [];
      if (hit.length) { pts.push([ym, parseInt(hit[0].totNmprCnt, 10), parseInt(hit[0].hhCnt, 10)]); miss = 0; }
      else { miss++; if (pts.length && miss >= 3) break; }
    }
    return pts.sort((a, b) => (a[0] < b[0] ? -1 : 1));
  }
}

// ───────── 집계와 표 (마크다운 줄) ─────────
export const yearOf = (r) => parseInt(r.dealYear, 10);
export const amt = (r) => num(r.dealAmount);
export const perM2 = (r) => { const a = num(r.dealAmount), ar = num(r.excluUseAr); return a && ar ? a / ar : null; };
export function byYear(rows, val) {
  const g = new Map();
  for (const r of rows) { const y = yearOf(r); if (!g.has(y)) g.set(y, []); g.get(y).push(r); }
  const out = new Map();
  for (const [y, rs] of g) { const vs = rs.map(val).filter((v) => v !== null); out.set(y, [rs.length, vs.length ? median(vs) : null]); }
  return out;
}
export function eraRows(rows) {
  const g = new Map();
  for (const r of rows) { const k = eraOf(yearOf(r)); if (!g.has(k)) g.set(k, []); g.get(k).push(r); }
  return g;
}
const sortedKeys = (m) => [...m.keys()].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
const numKeys = (m) => [...m.keys()].sort((a, b) => a - b);

export function tradeTables(title, rows, src) {
  const L = [`**${title}** — 출처: ${src}`, ""];
  if (!rows.length) return L.concat(["거래가 없습니다.", ""]);
  const yr = byYear(rows, amt);
  const yr2 = "excluUseAr" in rows[0] ? byYear(rows, perM2) : new Map();
  const has2 = yr2.size > 0;
  L.push("| 운 | 거래 건수 | 중위 거래금액 | 첫해 → 끝해 중위 변화 |", "|---|---|---|---|");
  const er = eraRows(rows);
  for (const lab of sortedKeys(er)) {
    const rs = er.get(lab);
    const ys = [...new Set(rs.map(yearOf))].sort((a, b) => a - b);
    const a = yr.get(ys[0])[1], b = yr.get(ys[ys.length - 1])[1];
    const med = median(rs.map(amt).filter((v) => v !== null));
    const ch = a && b && ys[0] !== ys[ys.length - 1]
      ? `${eok(a)} ${ys[0]}년 → ${eok(b)} ${ys[ys.length - 1]}년 (${signed(100.0 * (b / a - 1), 0)}%)` : "—";
    L.push(`| ${lab} | ${comma(rs.length)} | ${eok(med)} | ${ch} |`);
  }
  L.push("", `| 연도 | 운 | 건수 | 중위 거래금액(만원) |${has2 ? " 중위 ㎡당(만원) |" : ""}`, `|---|---|---|---|${has2 ? "---|" : ""}`);
  for (const y of numKeys(yr)) L.push(`| ${y} | ${eraOf(y)} | ${yr.get(y)[0]} | ${fmt(yr.get(y)[1])} |${has2 ? ` ${fmt(yr2.get(y) ? yr2.get(y)[1] : undefined, 0)} |` : ""}`);
  return L.concat([""]);
}

export function rentTables(rows, src) {
  const L = [`**아파트 전월세** — 출처: ${src}`, ""];
  if (!rows.length) return L.concat(["거래가 없습니다.", ""]);
  const jeon = rows.filter((r) => (num(r.monthlyRent) || 0) === 0);
  const wol = rows.filter((r) => (num(r.monthlyRent) || 0) > 0);
  const dep = (r) => num(r.deposit), mon = (r) => num(r.monthlyRent);
  const yj = byYear(jeon, dep), yw = byYear(wol, mon);
  const med = (rs, f) => { if (!rs.length) return null; const v = rs.map(f).filter((x) => x !== null); return v.length ? median(v) : null; };
  L.push("| 운 | 전세 건수 | 중위 보증금 | 월세 건수 | 중위 월세(만원) | 월세 중위 보증금 |", "|---|---|---|---|---|---|");
  const years = new Set([...yj.keys(), ...yw.keys()]);
  for (const lab of [...new Set([...years].map(eraOf))].sort()) {
    const rj = jeon.filter((r) => eraOf(yearOf(r)) === lab), rw = wol.filter((r) => eraOf(yearOf(r)) === lab);
    L.push(`| ${lab} | ${comma(rj.length)} | ${eok(med(rj, dep))} | ${comma(rw.length)} | ${fmt(med(rw, mon))} | ${eok(med(rw, dep))} |`);
  }
  L.push("", "| 연도 | 운 | 전세 건수 | 중위 보증금(만원) | 월세 건수 | 중위 월세(만원) |", "|---|---|---|---|---|---|");
  for (const y of [...years].sort((a, b) => a - b)) {
    const j = yj.get(y) || [0, null], w = yw.get(y) || [0, null];
    L.push(`| ${y} | ${eraOf(y)} | ${j[0]} | ${fmt(j[1])} | ${w[0]} | ${fmt(w[1])} |`);
  }
  return L.concat([""]);
}

export function useTop(rows, key, n = 3) {
  const c = new Map();
  for (const r of rows) { const k = r[key] || "미상"; c.set(k, (c.get(k) || 0) + 1); }
  return [...c].sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, v]) => `${k} ${v}`).join(", ");
}
export function nrgExtra(rows) {
  const L = ["| 운 | 주요 용도(건수) | 건물 유형(건수) |", "|---|---|---|"];
  const er = eraRows(rows);
  for (const lab of sortedKeys(er)) L.push(`| ${lab} | ${useTop(er.get(lab), "buildingUse")} | ${useTop(er.get(lab), "buildingType", 2)} |`);
  return L.concat([""]);
}
export function bldTable(items, src) {
  const by = new Map();
  for (const r of items) {
    const d = (r.useAprDay || "").trim();
    if (d.length >= 4 && /^\d{4}/.test(d)) { const k = eraOf(parseInt(d.slice(0, 4), 10)); if (!by.has(k)) by.set(k, []); by.get(k).push(r); }
  }
  const have = [...by.values()].reduce((s, v) => s + v.length, 0);
  const tot = have || 1;
  const L = [`**건축물대장 표제부(건물 단위)** — 출처: ${src}`, "",
    `표제부 ${comma(items.length)}건 가운데 사용승인일이 있는 ${comma(have)}건. 지금 대장에 남은 건물만 셉니다(철거·말소된 건물은 빠짐).`, "",
    "| 시기 | 건물 수 | 비율 | 연면적 합(㎡) | 주요 용도 |", "|---|---|---|---|---|"];
  for (const lab of ["7운 이전", "7운", "8운", "9운"]) {
    const rs = by.get(lab) || [];
    L.push(`| ${lab} | ${comma(rs.length)} | ${fixed(100.0 * rs.length / tot, 0)}% | ${comma(rs.reduce((s, r) => s + (num(r.totArea) || 0), 0), 0)} | ${rs.length ? useTop(rs, "mainPurpsCdNm") : "—"} |`);
  }
  return L.concat([""]);
}
export function yearlyPoints(rows, minimum = 5) {
  return [...byYear(rows, amt)].sort((a, b) => a[0] - b[0]).filter(([, [n, med]]) => n >= minimum && med).map(([y, [, med]]) => [`${y}07`, med]);
}

// ───────── 상가(상권)정보 (store_stats.py) — data/store/<묶음>.json 은 집계(법정동×행정동×업종 개수)라 개수를 더해 센다 ─────────
export const STORE_ORG = "소상공인시장진흥공단", STORE_DATASET = "상가(상권)정보";
const SIDO_KEY = { 서울: "서울", 부산: "부산", 대구: "대구", 인천: "인천", 광주: "전남광주", 대전: "대전", 울산: "울산", 세종: "세종", 경기: "경기", 강원: "강원", 충북: "충북", 충청북: "충북", 충남: "충남", 충청남: "충남", 전북: "전북", 전라북: "전북", 전남: "전남광주", 전라남: "전남광주", 경북: "경북", 경상북: "경북", 경남: "경남", 경상남: "경남", 제주: "제주" };
export function parseRegion(query) {
  const toks = query.trim().split(/\s+/);
  const name = toks[toks.length - 1];
  let sido = null;
  for (const t of toks.slice(0, -1)) {
    const t2 = t.replace(/(특별자치시|특별자치도|특별시|광역시|도)$/, "");
    for (const [k, v] of Object.entries(SIDO_KEY)) if (t2.startsWith(k)) { sido = v; break; }
    if (sido) break;
  }
  const sgg = toks.slice(0, -1).filter((t) => /[시군구]$/.test(t) && !/(특별시|광역시)$/.test(t));
  return [sido, sgg, name];
}
// loadStore(키) -> data/store/<키>.json 내용,  index -> data/store/_index.json
export async function storeCollect(query, loadStore, index) {
  const [sido, sgg, name] = parseRegion(query);
  const keys = sido && index[sido] ? [sido] : Object.keys(index);
  let rows = [], ym = null;
  for (const key of keys) {
    const d = await loadStore(key);
    const W = d.words;
    const out = [], alt = [];
    for (const r of d.rows) {
      const rec = [W[r[0]], W[r[1]], W[r[2]], W[r[3]], W[r[4]], W[r[5]], W[r[6]], W[r[7]], r[8]];   // 7번 = 행정동코드 8자리, 8번 = 가게 수
      if (W[r[2]] === name) out.push(rec); else if (W[r[3]] === name) alt.push(rec);
    }
    const got = out.length ? out : alt;
    if (got.length) { rows = rows.concat(got); ym = d.ym; }
  }
  if (!rows.length) {
    if (/[시군구]$/.test(name)) throw new Error("읍·면·동 이름이 필요합니다(시·군·구 단위는 지원하지 않습니다): " + query);
    throw new Error("그 이름의 동에서 상가 자료를 찾지 못했습니다: " + query);
  }
  let by = new Map();
  for (const r of rows) { const k = r[0] + "\u0000" + r[1]; if (!by.has(k)) by.set(k, []); by.get(k).push(r); }
  if (by.size > 1) {
    const nar = new Map([...by].filter(([k]) => { const g = k.split("\u0000")[1]; return sgg.some((w) => stripSgg(w) && g.includes(stripSgg(w))); }));
    if (nar.size) by = nar;
  }
  if (by.size > 1) throw new Ambiguous("같은 이름의 동이 여러 곳입니다: " + [...by.keys()].map((k) => k.replace("\u0000", " ")).join(", "));
  const [k, rs] = [...by][0];
  const [sd, sg] = k.split("\u0000");
  return { region: `${sd} ${sg} ${name}`, name, ym, rows: rs };
}
function countBy(rows, keyFn) {
  const c = new Map();
  for (const r of rows) { const k = keyFn(r); c.set(k, (c.get(k) || 0) + r[8]); }
  return [...c].sort((a, b) => b[1] - a[1]);
}
export function storeSummarize(res, topMid = 15, topSmall = 20) {
  const rows = res.rows;
  return { total: rows.reduce((s, r) => s + r[8], 0), big: countBy(rows, (r) => r[4]),
    mid: countBy(rows, (r) => r[4] + "\u0000" + r[5]).slice(0, topMid).map(([k, v]) => [k.split("\u0000"), v]),
    small: countBy(rows, (r) => r[4] + "\u0000" + r[5] + "\u0000" + r[6]).slice(0, topSmall).map(([k, v]) => [k.split("\u0000"), v]) };
}
export const storeSource = (ym) => `${STORE_ORG} · ${STORE_DATASET} · 기준일 ${ym.slice(0, 4)}-${ym.slice(4, 6)}`;

// ───────── 인구 CSV 자료 (pop_stats.py) — data/pop/<시도>.json ─────────
export const POP_ORG = "행정안전부", POP_DATASET = "지역별(행정동) 성별 연령별 주민등록 인구수";
export const popSource = (asof) => `${POP_ORG} · ${POP_DATASET} · 기준일 ${asof}`;
export async function popCollect(query, bjd, loadPop, storeRes = null) {
  const reg = bjd.find(query);
  let names = [], how = "", codes = [];
  if (storeRes) {
    const c = new Map(), cc = new Map();
    // 행정동 이름은 상가 집계의 3번 칸, 행정동코드(8자리)는 7번 칸이다
    for (const r of storeRes.rows) {
      if (r[3]) c.set(r[3], (c.get(r[3]) || 0) + r[8]);
      if (r[7]) cc.set(r[7], (cc.get(r[7]) || 0) + r[8]);
    }
    names = [...c].sort((a, b) => b[1] - a[1]).map(([n]) => n);
    codes = [...cc].sort((a, b) => b[1] - a[1]).map(([k]) => k);
    how = `상가(상권)정보의 (법정동, 행정동) 짝 — 가게 ${[...c.values()].reduce((s, v) => s + v, 0)}곳에서 확인`;
  }
  const pd = await loadPop(reg.sido);
  if (!names.length) {
    const base = reg.emd.endsWith("동") ? reg.emd.slice(0, -1) : reg.emd;
    names = [...new Set(pd.rows.filter((r) => r[0] === reg.sgg && r[1].startsWith(base)).map((r) => r[1]))].sort();
    how = "행정동 이름이 법정동 이름으로 시작하는 곳";
  }
  // 이름이 아니라 행정동 코드로 먼저 잇는다 — 상가 자료 '좌1동' = 인구 자료 '좌제1동' 처럼 이름이 다른 곳이 전국에 364곳 있다.
  // 인구 파일의 행정기관코드 10자리 = 행정동코드 8자리 + '00'
  let sel = [];
  if (codes.length) {
    const cs = new Set(codes);
    sel = pd.rows.filter((r) => cs.has((r[6] || "").slice(0, 8)));
    if (sel.length) how = `상가(상권)정보의 (법정동, 행정동코드) 짝 — 행정동 코드 ${cs.size}개로 이음`;
  }
  if (!sel.length) sel = pd.rows.filter((r) => r[0] === reg.sgg && names.includes(r[1]));
  if (!sel.length) sel = pd.rows.filter((r) => names.includes(r[1]));
  if (!sel.length) throw new Error("인구 파일에서 이 지역의 행정동을 찾지 못했습니다: " + query);
  const age = Array.from({ length: 111 }, () => [0, 0]);
  for (const r of sel) for (let a = 0; a < 111; a++) { age[a][0] += r[5][2 * a]; age[a][1] += r[5][2 * a + 1]; }
  const per = sel.map((r) => ({ name: r[1], total: r[2], male: r[3], female: r[4] }));
  const sum = (k) => per.reduce((s, p) => s + p[k], 0);
  return { region: reg, dongs: per.map((p) => p.name), per, total: sum("total"), male: sum("male"), female: sum("female"), age, asof: pd.asof, how, sgg_used: sel[0][0] };
}
export function popBands(age) {
  const tot = age.map(([m, f]) => m + f);
  const sm = (a, b) => tot.slice(a, b).reduce((s, v) => s + v, 0);
  const y = sm(0, 15), w = sm(15, 65), o = sm(65, 111);
  const n = sm(0, 111) || 1;
  return [y, w, o, tot.reduce((s, t, i) => s + i * t, 0) / n];
}
