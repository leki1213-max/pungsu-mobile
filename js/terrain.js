// 풍수 지형분석 (QGIS 메뉴 4·5번이 쓰는 GDAL 계산을 자바스크립트로 옮김)
//   음영기복도(gdaldem hillshade -z 2 -az 315 -alt 45) · 경사도(도) · 향(Aspect, 방위각) · 능선·계곡(30 m 로 줄여 TPI, ±3) · 등고선(간격 m)
// 격자: {W, H, arr(Float32Array, 위에서 아래로 한 줄씩), xres, yres(칸 크기, 양수), nodata}. 노트북과 같이 칸 크기를 그대로 쓴다(웹 메르카토르 m).
// 가장자리 한 줄은 값을 만들지 않는다(GDAL 기본과 같음: 경사·향·TPI 는 nodata, 음영기복은 0).
export const NODATA = -9999;
const D2R = Math.PI / 180, R2D = 180 / Math.PI;

export function gridFromDem(dem) { return { W: dem.W, H: dem.H, arr: dem.arr, xres: dem.px, yres: dem.px, nodata: -9999, ox: dem.ox, oy: dem.oy }; }

function win(g, r, c, w) {
  const W = g.W, a = g.arr;
  for (let k = 0, dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++, k++) {
    const v = a[(r + dr) * W + c + dc];
    if (v === g.nodata || v !== v) return false;
    w[k] = v;
  }
  return true;
}
function eachInner(g, fn, fill, dtype) {
  const out = new dtype(g.W * g.H).fill(fill), w = new Float64Array(9);
  for (let r = 1; r < g.H - 1; r++) for (let c = 1; c < g.W - 1; c++) if (win(g, r, c, w)) out[r * g.W + c] = fn(w);
  return out;
}

// 음영기복도: 0 = 값 없음, 1~255 = 밝기
export function hillshade(g, { z = 2, scale = 1, azimuth = 315, altitude = 45 } = {}) {
  const az = azimuth * D2R, sinAlt = Math.sin(altitude * D2R), cosAlt = Math.cos(altitude * D2R), zs = z / (8 * scale);
  return eachInner(g, (w) => {
    const x = ((w[0] + w[3] + w[3] + w[6]) - (w[2] + w[5] + w[5] + w[8])) / g.xres;
    const y = -((w[6] + w[7] + w[7] + w[8]) - (w[0] + w[1] + w[1] + w[2])) / g.yres;      // GDAL 은 위아래 칸 크기를 음수로 쓴다(격자 위쪽이 북쪽) — 실제 GDAL 결과와 맞춰 확인한 부호
    const xx = x * x + y * y, aspect = Math.atan2(y, x);
    let cang = (sinAlt - cosAlt * zs * Math.sqrt(xx) * Math.sin(aspect - az)) / Math.sqrt(1 + zs * zs * xx);
    cang = cang <= 0 ? 1 : 1 + 254 * cang;
    return Math.round(cang);
  }, 0, Uint8Array);
}
// 경사도(도)
export function slope(g, { scale = 1 } = {}) {
  return eachInner(g, (w) => {
    const dx = ((w[2] + w[5] + w[5] + w[8]) - (w[0] + w[3] + w[3] + w[6])) / (8 * g.xres * scale);
    const dy = ((w[6] + w[7] + w[7] + w[8]) - (w[0] + w[1] + w[1] + w[2])) / (8 * g.yres * scale);
    return Math.atan(Math.sqrt(dx * dx + dy * dy)) * R2D;
  }, NODATA, Float32Array);
}
// 향(사면이 바라보는 방위각, 북 0°·시계방향). 평평한 곳은 값 없음(-9999).
export function aspect(g) {
  return eachInner(g, (w) => {
    const dx = (w[2] + w[5] + w[5] + w[8]) - (w[0] + w[3] + w[3] + w[6]);
    const dy = (w[6] + w[7] + w[7] + w[8]) - (w[0] + w[1] + w[1] + w[2]);
    if (dx === 0 && dy === 0) return NODATA;
    let a = Math.atan2(dy, -dx) * R2D;
    a = a > 90 ? 450 - a : 90 - a;
    return a === 360 ? 0 : a;
  }, NODATA, Float32Array);
}
// 지형 위치 지수: 가운데 높이 - 둘레 8칸 평균
export function tpi(g) {
  return eachInner(g, (w) => w[4] - (w[0] + w[1] + w[2] + w[3] + w[5] + w[6] + w[7] + w[8]) / 8, NODATA, Float32Array);
}
// 칸 크기를 res m 로 키우거나 줄인다(gdalwarp -r bilinear 와 같은 삼각 가중 평균). 가장자리 칸 수는 gdalwarp 처럼 반올림.
export function resample(g, res) {
  const W = Math.trunc((g.W * g.xres + res / 2) / res), H = Math.trunc((g.H * g.yres + res / 2) / res);
  const sx = res / g.xres, sy = res / g.yres;                               // 원본 칸 수 / 새 칸
  const out = new Float32Array(W * H).fill(NODATA);
  // gdalwarp -r bilinear 는 새 칸 가운데 둘레의 원본 4칸을 거리 비례로 섞는다(실제 GDAL 결과와 맞춰 확인). 가장자리는 가까운 칸으로 대신한다.
  const at = (j, i) => g.arr[Math.min(g.H - 1, Math.max(0, j)) * g.W + Math.min(g.W - 1, Math.max(0, i))];
  for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) {
    const fx = (c + 0.5) * sx - 0.5, fy = (r + 0.5) * sy - 0.5;
    const i0 = Math.floor(fx), j0 = Math.floor(fy), tx = fx - i0, ty = fy - j0;
    const v = [at(j0, i0), at(j0, i0 + 1), at(j0 + 1, i0), at(j0 + 1, i0 + 1)];
    if (v.some((x) => x === g.nodata)) continue;
    out[r * W + c] = v[0] * (1 - tx) * (1 - ty) + v[1] * tx * (1 - ty) + v[2] * (1 - tx) * ty + v[3] * tx * ty;
  }
  return { W, H, arr: out, xres: res, yres: res, nodata: NODATA };
}
// 능선·계곡: 0 = 평지·사면, 1 = 계곡(산곡수살처 후보), 2 = 능선(용맥).  30 m 로 줄인 격자에서 TPI > 3 능선, < -3 계곡
export function ridgeValley(g, { res = 30, limit = 3 } = {}) {
  const c = resample(g, res), t = tpi(c);
  const cls = new Uint8Array(c.W * c.H);
  for (let i = 0; i < t.length; i++) cls[i] = t[i] === NODATA ? 0 : (t[i] > limit ? 2 : 0) + (t[i] < -limit ? 1 : 0);
  return { W: c.W, H: c.H, xres: res, yres: res, tpi: t, cls };
}
// 등고선: interval m 간격 선분 목록 {level: [[x1,y1,x2,y2],...]} (좌표는 격자 칸 가운데 기준, 단위 m, 위쪽이 y 감소). 값이 선 위에 정확히 있으면 아주 조금 올려 본다.
export function contours(g, interval = 5, base = 0) {
  const out = {}, W = g.W, H = g.H, a = g.arr, EPS = 1e-9;
  const val = (r, c) => a[r * W + c];
  for (let r = 0; r < H - 1; r++) for (let c = 0; c < W - 1; c++) {
    const v = [val(r, c), val(r, c + 1), val(r + 1, c + 1), val(r + 1, c)];       // 왼위, 오른위, 오른아래, 왼아래
    if (v.some((x) => x === g.nodata || x !== x)) continue;
    const lo = Math.min(...v), hi = Math.max(...v);
    const k0 = Math.floor((lo - base) / interval) + 1, k1 = Math.floor((hi - base) / interval + 1e-12);
    for (let k = k0; k <= k1; k++) {
      let L = base + k * interval;
      const vv = v.map((x) => (x === L ? x + EPS : x));
      const above = vv.map((x) => x > L);
      const idx = (above[0] ? 8 : 0) | (above[1] ? 4 : 0) | (above[2] ? 2 : 0) | (above[3] ? 1 : 0);
      if (idx === 0 || idx === 15) continue;
      const px = [c, c + 1, c + 1, c], py = [r, r, r + 1, r + 1];
      const edge = (e) => {                                                         // 0 위, 1 오른, 2 아래, 3 왼
        const [p, q] = [[0, 1], [1, 2], [3, 2], [0, 3]][e];
        const t = (L - vv[p]) / (vv[q] - vv[p]);
        return [(px[p] + (px[q] - px[p]) * t) * g.xres, (py[p] + (py[q] - py[p]) * t) * g.yres];
      };
      const segs = {
        1: [[3, 2]], 2: [[2, 1]], 3: [[3, 1]], 4: [[0, 1]], 6: [[0, 2]], 7: [[3, 0]], 8: [[3, 0]], 9: [[0, 2]], 11: [[0, 1]], 12: [[3, 1]], 13: [[2, 1]], 14: [[3, 2]],
        5: null, 10: null,
      }[idx];
      let list = segs;
      if (!list) {                                                                  // 안장: 가운데 평균으로 연결 방향을 정한다
        const mid = (vv[0] + vv[1] + vv[2] + vv[3]) / 4 > L;
        list = idx === 5 ? (mid ? [[0, 3], [2, 1]] : [[0, 1], [3, 2]]) : (mid ? [[0, 1], [3, 2]] : [[0, 3], [2, 1]]);
      }
      for (const [e1, e2] of list) { const p1 = edge(e1), p2 = edge(e2); (out[L] ||= []).push([p1[0], p1[1], p2[0], p2[1]]); }
    }
  }
  return out;
}
export function contourLength(segs) { return segs.reduce((s, [a, b, c, d]) => s + Math.hypot(c - a, d - b), 0); }
