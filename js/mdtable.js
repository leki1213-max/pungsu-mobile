// 노트북이 만드는 표(마크다운 줄)를 화면용 HTML 로 바꾼다. 모든 글자는 먼저 특수문자를 막아 둔다.
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const inline = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, "<b>$1</b>");
export function mdToHtml(lines) {
  const out = []; let tbl = null;
  const flush = () => { if (tbl) { out.push(tbl + "</tbody></table>"); tbl = null; } };
  for (const raw of lines) {
    const l = String(raw);
    if (l.startsWith("|")) {
      const cells = l.split("|").slice(1, -1).map((c) => c.trim());
      if (cells.every((c) => /^-+$/.test(c))) continue;
      if (!tbl) tbl = "<table><thead><tr>" + cells.map((c) => `<th>${inline(c)}</th>`).join("") + "</tr></thead><tbody>";
      else tbl += "<tr>" + cells.map((c) => `<td>${inline(c)}</td>`).join("") + "</tr>";
      continue;
    }
    flush();
    if (l.startsWith("### ")) out.push(`<h3>${inline(l.slice(4))}</h3>`);
    else if (l.startsWith("## ")) out.push(`<h3>${inline(l.slice(3))}</h3>`);
    else if (l.startsWith("# ")) out.push(`<h3>${inline(l.slice(2))}</h3>`);
    else if (l.trim()) out.push(`<p>${inline(l)}</p>`);
  }
  flush();
  return out.join("\n");
}
