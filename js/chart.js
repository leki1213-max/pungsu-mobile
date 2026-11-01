// 비성반(책 모양) 그림과 패철 좌표 계산. 화면은 위쪽이 남쪽이다(풍수 책과 같음): 줄 순서 巽離坤 / 震中兌 / 艮坎乾
import { MOUNTAINS, PALACE_NAME } from "./xuankong.js";
const ROWS = [[4, 9, 2], [3, 5, 7], [8, 1, 6]];
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;");

// chart: {mountain, water, yun} (xuankong.makeChart) 또는 {mtn, wat, yun} (xuankong.xkChart).  sitPal/facePal: 앉은 궁/향 궁 번호
export function chartSvg(chart, { sitPal, facePal, period }) {
  const M = chart.mountain || chart.mtn, W = chart.water || chart.wat, Y = chart.yun;
  const S = 120, pad = 6, size = S * 3 + pad * 2;
  const good = (n) => n === period;
  let g = "";
  ROWS.forEach((row, r) => row.forEach((p, c) => {
    const x = pad + c * S, y = pad + r * S;
    const tag = p === sitPal ? "좌(등진 쪽)" : p === facePal ? "향(바라보는 쪽)" : "";
    const fill = p === facePal ? "#1f6f5c33" : p === sitPal ? "#b88a1c33" : "none";
    g += `<rect x="${x}" y="${y}" width="${S}" height="${S}" fill="${fill}" stroke="currentColor" stroke-width="1.5"/>`;
    g += `<text x="${x + 10}" y="${y + 38}" font-size="30" font-weight="700" fill="${good(M[p]) ? "#b3402b" : "currentColor"}">${M[p]}</text>`;
    g += `<text x="${x + S - 10}" y="${y + 38}" font-size="30" font-weight="700" text-anchor="end" fill="${good(W[p]) ? "#b3402b" : "currentColor"}">${W[p]}</text>`;
    g += `<text x="${x + S / 2}" y="${y + 82}" font-size="22" text-anchor="middle" opacity=".7">${Y[p]}</text>`;
    g += `<text x="${x + S / 2}" y="${y + 106}" font-size="12" text-anchor="middle" opacity=".7">${esc(PALACE_NAME[p])}${tag ? " · " + tag : ""}</text>`;
  }));
  return `<svg class="chart" viewBox="0 0 ${size} ${size}" role="img" aria-label="비성반" fill="currentColor">${g}</svg><p class="hint">왼쪽 위 = 산성(사람), 오른쪽 위 = 향성(재물), 가운데 = 운반. 붉은 숫자는 그 운의 당령성이에요. 위쪽이 남쪽.</p>`;
}

// 패철 선 계산: 중심(lat,lon)에서 24산 경계선(7.5°+15k)과 이름 위치. declination = 자북 편각(°, 서쪽 −). 자북 각도 → 지도(진북) 각도 = 자북 + 편각
const D = Math.PI / 180;
export function dest(lat, lon, bearingDeg, m) {
  const t = bearingDeg * D;
  return [lat + (m * Math.cos(t)) / 110540.0, lon + (m * Math.sin(t)) / (111320.0 * Math.max(0.2, Math.cos(lat * D)))];
}
export function compassLines(lat, lon, decl, { kind = 24, radius = 300 } = {}) {
  const step = kind === 24 ? 15 : 45, lines = [], labels = [];
  for (let k = 0; k < 360 / step; k++) {
    const mag = k * step;                                              // 이름 위치(자북 기준 각도)
    labels.push({ at: dest(lat, lon, mag + decl, radius * 1.08), text: kind === 24 ? MOUNTAINS[k] : ["北", "東北", "東", "東南", "南", "西南", "西", "西北"][k], bearing: mag });
    const edge = mag + step / 2;                                       // 경계선
    lines.push([[lat, lon], dest(lat, lon, edge + decl, radius)]);
  }
  return { lines, labels };
}
