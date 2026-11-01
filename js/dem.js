// 지도 가운데 주변의 높이(DEM)를 그때그때 받아온다 — 노트북 fengshui_getdem.py 와 같은 방식(같은 타일 주소·같은 계산).
// 타일: AWS Terrain Tiles (Terrarium 형식, 전 세계 무료)  https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png
// 높이(m) = R*256 + G + B/256 - 32768.   z=13, 가운데에서 반경 4000 m 를 덮는 타일들을 이어 붙인다.
export const Z = 13;
export const RAD = 4000.0;
export const URL = (z, x, y) => `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`;
const WORLD = 40075016.685578488;           // 웹 메르카토르 한 바퀴(m)
const NODATA = -9999.0;

export function tileXY(lon, lat, z) {
  const n = 2 ** z;
  const x = ((lon + 180.0) / 360.0) * n;
  const y = ((1.0 - Math.asinh(Math.tan(lat * (Math.PI / 180))) / Math.PI) / 2.0) * n;
  return [x, y];
}
export function mercator(lon, lat) {
  const x = (lon / 360.0) * WORLD;
  const y = (Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)) / Math.PI) * (WORLD / 2.0);
  return [x, y];
}

// getTile(z,x,y) -> {r,g,b 각 Uint8Array(65536)} 또는 null(받지 못함). 브라우저용 기본 구현은 browserTile.
export async function fetchDem(lon, lat, getTile, { z = Z, rad = RAD } = {}) {
  const dlat = rad / 111320.0;
  const dlon = rad / (111320.0 * Math.cos(lat * (Math.PI / 180)));
  const [xa, ya] = tileXY(lon - dlon, lat + dlat, z);
  const [xb, yb] = tileXY(lon + dlon, lat - dlat, z);
  const x0 = Math.floor(xa), x1 = Math.floor(xb), y0 = Math.floor(ya), y1 = Math.floor(yb);
  const W = x1 - x0 + 1, H = y1 - y0 + 1;
  const arr = new Float32Array(H * 256 * W * 256).fill(NODATA);
  const jobs = [];
  for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) jobs.push([tx, ty]);
  let ok = 0;
  await Promise.all(jobs.map(async ([tx, ty]) => {
    const t = await getTile(z, tx, ty);
    if (!t) return;
    const oy = (ty - y0) * 256, ox = (tx - x0) * 256;
    for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) {
      const i = y * 256 + x;
      arr[(oy + y) * (W * 256) + ox + x] = t.r[i] * 256.0 + t.g[i] + t.b[i] / 256.0 - 32768.0;
    }
    ok++;
  }));
  if (!ok) throw new Error("높이 타일을 한 장도 받지 못했습니다. 인터넷 연결을 확인하세요.");
  const n = 2 ** z, ts = WORLD / n, px = ts / 256.0;
  const dem = { W: W * 256, H: H * 256, x0, y0, z, px, ox: -WORLD / 2.0 + x0 * ts, oy: WORLD / 2.0 - y0 * ts, arr, tiles: ok, tilesTotal: W * H, rad };
  dem.sample = (lo, la) => sample(dem, lo, la);
  return dem;
}
// QGIS 래스터 sample 과 같이 그 점이 들어 있는 칸의 값. 범위 밖이거나 값이 없으면 null.
export function sample(dem, lon, lat) {
  const [X, Y] = mercator(lon, lat);
  const c = Math.floor((X - dem.ox) / dem.px), r = Math.floor((dem.oy - Y) / dem.px);
  if (c < 0 || r < 0 || c >= dem.W || r >= dem.H) return null;
  const v = dem.arr[r * dem.W + c];
  return v === NODATA ? null : v;
}
// 가운데에서 방위각 az(°, 북 0 시계방향)로 d m 떨어진 점 (fengshui_dem._dest 와 같음)
export function dest(lon, lat, az, d) {
  const t = az * (Math.PI / 180);
  const dlat = (d * Math.cos(t)) / 111320.0;
  const dlon = (d * Math.sin(t)) / (111320.0 * Math.max(0.2, Math.cos(lat * (Math.PI / 180))));
  return [lon + dlon, lat + dlat];
}

// 브라우저용 타일 읽기: 이미지로 불러와 캔버스에서 색(RGB)을 읽는다. 받지 못하면 null.
export async function browserTile(z, x, y) {
  try {
    const r = await fetch(URL(z, x, y), { mode: "cors" });
    if (!r.ok) return null;
    const bmp = await createImageBitmap(await r.blob());
    if (bmp.width !== 256 || bmp.height !== 256) return null;
    const cv = typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(256, 256) : Object.assign(document.createElement("canvas"), { width: 256, height: 256 });
    const cx = cv.getContext("2d", { willReadFrequently: true });
    cx.drawImage(bmp, 0, 0);
    const d = cx.getImageData(0, 0, 256, 256).data;
    const R = new Uint8Array(65536), G = new Uint8Array(65536), B = new Uint8Array(65536);
    for (let i = 0; i < 65536; i++) { R[i] = d[4 * i]; G[i] = d[4 * i + 1]; B[i] = d[4 * i + 2]; }
    return { r: R, g: G, b: B };
  } catch { return null; }
}
