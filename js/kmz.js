// KMZ 내보내기: 지금 지도 가운데를 중심으로 패철(24산 경계선·이름), 문향선·좌선을 구글 어스용 KML 로 만들어 KMZ(zip)로 묶는다. JSZip 은 index.html 에서 불러온다.
import { MOUNTAINS } from "./xuankong.js";
import { dest } from "./chart.js";
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const coord = ([lat, lon]) => `${lon.toFixed(7)},${lat.toFixed(7)},0`;
const line = (name, pts, color, width) => `<Placemark><name>${esc(name)}</name><Style><LineStyle><color>${color}</color><width>${width}</width></LineStyle></Style><LineString><tessellate>1</tessellate><coordinates>${pts.map(coord).join(" ")}</coordinates></LineString></Placemark>`;

export function buildKml({ lat, lon, decl, deg, name, radius = 150 }) {
  let k = `<?xml version="1.0" encoding="UTF-8"?><kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>${esc(name)}</name>`;
  k += `<Placemark><name>${esc(name)}</name><Point><coordinates>${coord([lat, lon])}</coordinates></Point></Placemark>`;
  for (let i = 0; i < 24; i++) {
    k += line(`${MOUNTAINS[i]} 경계`, [[lat, lon], dest(lat, lon, i * 15 + 7.5 + decl, radius)], "ff2fa8c9", 1);
    k += `<Placemark><name>${MOUNTAINS[i]}</name><Point><coordinates>${coord(dest(lat, lon, i * 15 + decl, radius * 1.1))}</coordinates></Point></Placemark>`;
  }
  k += line(`문향 ${deg}° (향)`, [[lat, lon], dest(lat, lon, deg + decl, radius * 1.4)], "ff4aa31f", 4);
  k += line(`좌(등진 쪽) ${((deg + 180) % 360).toFixed(1)}°`, [[lat, lon], dest(lat, lon, deg + 180 + decl, radius * 1.4)], "ff1c8fb8", 3);
  return k + "</Document></kml>";
}
export async function buildKmz(opt) {
  if (typeof JSZip === "undefined") throw new Error("압축 도구를 불러오지 못했어요(인터넷 연결 확인)");
  const z = new JSZip(); z.file("doc.kml", buildKml(opt));
  return await z.generateAsync({ type: "blob", mimeType: "application/vnd.google-earth.kmz" });
}
