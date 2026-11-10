// Gera site/<PAGE_KEY>/index.html com gráficos de evolução dos exames,
// a partir da base "📈 Marcadores de exames" do Notion.
//
// Variáveis de ambiente:
//   NOTION_TOKEN    token da integração do Notion (segredo do GitHub)
//   NOTION_DB_ID    id da base Marcadores (padrão abaixo)
//   PAGE_KEY        pasta "secreta" onde a página é publicada (segredo do GitHub)
//   DATA_FILE       (opcional, para teste local) JSON com as linhas já prontas
//
// Sem dependências: Node 20+.

import { mkdir, readFile, writeFile } from "node:fs/promises";

const DB_ID = process.env.NOTION_DB_ID || "79ceb9d31d8c44eb8e9e0431674552a3";
const PAGE_KEY = (process.env.PAGE_KEY || "preview").replace(/[^a-zA-Z0-9_-]/g, "");
const GROUP_ORDER = ["Vitaminas", "Ferro", "Hemograma", "Glicemia", "Lipídios", "Tireoide", "Fígado / Rim"];

// ---------- leitura do Notion ----------
const txt = (p) => (p?.title || p?.rich_text || []).map((t) => t.plain_text).join("");

async function fetchRows() {
  if (process.env.DATA_FILE) return JSON.parse(await readFile(process.env.DATA_FILE, "utf8"));
  const token = process.env.NOTION_TOKEN;
  if (!token) throw new Error("Falta NOTION_TOKEN");
  const rows = [];
  let cursor;
  do {
    const res = await fetch(`https://api.notion.com/v1/databases/${DB_ID}/query`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Notion-Version": "2022-06-28",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ page_size: 100, start_cursor: cursor }),
    });
    if (!res.ok) throw new Error(`Notion ${res.status}: ${await res.text()}`);
    const data = await res.json();
    for (const page of data.results) {
      const p = page.properties;
      rows.push({
        marcador: p["Marcador"]?.select?.name,
        grupo: p["Grupo"]?.select?.name || "Outros",
        valor: p["Valor"]?.number,
        unidade: txt(p["Unidade"]),
        data: p["Data"]?.date?.start,
        refMin: p["Ref. mín"]?.number ?? null,
        refMax: p["Ref. máx"]?.number ?? null,
      });
    }
    cursor = data.has_more ? data.next_cursor : undefined;
  } while (cursor);
  return rows;
}

// ---------- utilidades ----------
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const fmt = (n) => (n == null ? "" : n.toLocaleString("pt-BR", { maximumFractionDigits: 2 }));
const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const fmtData = (iso) => { const [y, m] = iso.split("-"); return `${MESES[+m - 1]}/${y.slice(2)}`; };
const fmtDataLonga = (iso) => { const [y, m, d] = iso.split("-"); return `${d}/${m}/${y}`; };

function status(v, min, max) {
  if (min != null && v < min) return "low";
  if (max != null && v > max) return "high";
  if (min == null && max == null) return "none";
  return "ok";
}

// ---------- gráfico SVG ----------
function chartSvg(pts, refMin, refMax) {
  const W = 320, H = 140, L = 8, R = 8, T = 18, B = 22;
  const vals = pts.map((p) => p.valor);
  let lo = Math.min(...vals, refMin ?? Infinity);
  let hi = Math.max(...vals, refMax ?? -Infinity);
  // Não deixar a faixa de referência esmagar a linha (ex.: ref. muito larga)
  if (refMax != null && refMax > Math.max(...vals) * 3) hi = Math.max(...vals) * 1.4;
  if (refMin != null && refMin < Math.min(...vals) / 3) lo = Math.min(...vals) * 0.6;
  if (hi === lo) { hi += 1; lo -= 1; }
  const pad = (hi - lo) * 0.12; lo -= pad; hi += pad;

  const t0 = Date.parse(pts[0].data), t1 = Date.parse(pts.at(-1).data);
  const x = (d) => (pts.length === 1 ? (L + W - R) / 2 : L + ((Date.parse(d) - t0) / (t1 - t0)) * (W - L - R));
  const y = (v) => T + (1 - (v - lo) / (hi - lo)) * (H - T - B);
  const clampY = (v) => Math.max(T, Math.min(H - B, y(v)));

  let band = "";
  if (refMin != null || refMax != null) {
    const yTop = refMax != null ? clampY(refMax) : T;
    const yBot = refMin != null ? clampY(refMin) : H - B;
    band = `<rect class="band" x="${L}" y="${yTop}" width="${W - L - R}" height="${Math.max(0, yBot - yTop)}" rx="3"/>`;
  }
  const path = pts.map((p, i) => `${i ? "L" : "M"}${x(p.data).toFixed(1)},${y(p.valor).toFixed(1)}`).join(" ");
  // Rótulos sem sobreposição: escolhe por prioridade (último, primeiro, máx., mín., depois do
  // mais recente ao mais antigo) e pula o que encostaria num rótulo já colocado.
  const n = pts.length;
  const P = pts.map((p, i) => ({ p, i, cx: x(p.data), cy: y(p.valor) }));
  const order = [n - 1, 0];
  const byVal = [...P].sort((a, b) => a.p.valor - b.p.valor);
  order.push(byVal.at(-1).i, byVal[0].i);
  for (let i = n - 2; i > 0; i--) order.push(i);
  const seen = new Set(), prio = order.filter((i) => !seen.has(i) && seen.add(i));
  const CW = 5.6; // largura média de um caractere a 10px
  const box = (cx, w, anchor, top, h) => {
    const x0 = anchor === "start" ? cx : anchor === "end" ? cx - w : cx - w / 2;
    return { x0: x0 - 2, x1: x0 + w + 2, y0: top, y1: top + h };
  };
  const hit = (a, b) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
  const anchorOf = (i, cx, w) => (n === 1 ? "middle" : cx - w / 2 < 0 ? "start" : cx + w / 2 > W ? "end" : "middle");
  const valBoxes = [], dateBoxes = [], valShow = new Map(), dateShow = new Map();
  // pontos também contam como obstáculo para os rótulos de valor
  const dotBoxes = P.map((q) => ({ x0: q.cx - 4, x1: q.cx + 4, y0: q.cy - 4, y1: q.cy + 4 }));
  for (const i of prio) {
    const q = P[i], t = fmt(q.p.valor), w = t.length * CW;
    const a = anchorOf(i, q.cx, w);
    // tenta acima; se não couber, abaixo do ponto
    for (const top of [q.cy - 17, q.cy + 6]) {
      if (top < 0 || top + 10 > H - B + 2) continue;
      const b = box(q.cx, w, a, top, 10);
      if (valBoxes.some((o) => hit(o, b)) || dotBoxes.some((o, j) => j !== i && hit(o, b))) continue;
      valBoxes.push(b); valShow.set(i, { a, yText: top + 8.5 }); break;
    }
    const d = fmtData(q.p.data), dw = d.length * CW;
    const da = anchorOf(i, q.cx, dw);
    const db = box(q.cx, dw, da, H - 15, 10);
    if (!dateBoxes.some((o) => hit(o, db))) { dateBoxes.push(db); dateShow.set(i, da); }
  }
  const dots = P.map(({ p, i, cx, cy }) => {
    const st = status(p.valor, refMin, refMax);
    const last = i === n - 1;
    const v = valShow.get(i), da = dateShow.get(i);
    return `<circle class="pt ${st}${last ? " last" : ""}" cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${last ? 4.5 : 3.5}"><title>${fmtDataLonga(p.data)}: ${fmt(p.valor)}</title></circle>` +
      (v ? `<text class="val${last ? " strong" : ""}" x="${cx.toFixed(1)}" y="${v.yText.toFixed(1)}" text-anchor="${v.a}">${fmt(p.valor)}</text>` : "") +
      (da ? `<text class="date" x="${cx.toFixed(1)}" y="${H - 6}" text-anchor="${da}">${fmtData(p.data)}</text>` : "");
  }).join("");
  return `<svg viewBox="0 0 ${W} ${H}" role="img" preserveAspectRatio="xMidYMid meet">${band}<path class="line" d="${path}"/>${dots}</svg>`;
}

// ---------- página ----------
// Explicação curta de cada marcador (aparece abaixo do nome no card)
const DESC = {
  "Hemoglobina": "Proteína dos glóbulos vermelhos que leva oxigênio; baixa indica anemia",
  "Hematócrito": "Porcentagem do sangue ocupada pelos glóbulos vermelhos",
  "VCM": "Volume Corpuscular Médio: tamanho médio dos glóbulos vermelhos",
  "HCM": "Hemoglobina Corpuscular Média: quantidade de hemoglobina em cada glóbulo vermelho",
  "CHCM": "Concentração de Hemoglobina Corpuscular Média",
  "RDW": "Variação de tamanho entre os glóbulos vermelhos",
  "Leucócitos": "Glóbulos brancos, células de defesa do corpo",
  "Plaquetas": "Células que ajudam na coagulação do sangue",
  "Glicose": "Açúcar no sangue em jejum",
  "Hemoglobina glicada": "HbA1c: média do açúcar no sangue nos últimos 3 meses",
  "Colesterol total": "Soma de todas as frações de colesterol",
  "LDL": "Lipoproteína de baixa densidade: o colesterol \"ruim\"",
  "HDL": "Lipoproteína de alta densidade: o colesterol \"bom\"",
  "Triglicérides": "Gordura no sangue que vem da alimentação e do fígado",
  "Ferro": "Ferro circulando no sangue",
  "Ferritina": "Estoque de ferro do corpo",
  "Vitamina B12": "Vitamina importante para os nervos e a produção de sangue",
  "Vitamina D": "Vitamina dos ossos e da imunidade, produzida com o sol",
  "Vitamina C": "Vitamina antioxidante, importante para a imunidade",
  "TSH": "Hormônio Tireoestimulante: comando do cérebro para a tireoide",
  "T3": "Tri-iodotironina: hormônio ativo da tireoide",
  "T4 livre": "Tiroxina livre: hormônio da tireoide disponível para uso",
  "T4 total": "Tiroxina total: todo o hormônio T4 no sangue",
  "TGO": "Transaminase Glutâmico-Oxalacética (AST): enzima do fígado e músculos",
  "TGP": "Transaminase Glutâmico-Pirúvica (ALT): enzima do fígado",
  "GGT": "Gama-Glutamil Transferase: enzima do fígado e vias biliares",
  "Creatinina": "Resíduo dos músculos filtrado pelos rins; mostra a função renal",
  "Ureia": "Resíduo de proteínas filtrado pelos rins",
};

function card(nome, pts) {
  pts.sort((a, b) => a.data.localeCompare(b.data));
  const last = pts.at(-1), prev = pts.at(-2);
  // Usa a referência mais recente que existir
  const ref = [...pts].reverse().find((p) => p.refMin != null || p.refMax != null) || {};
  const refMin = ref.refMin ?? null, refMax = ref.refMax ?? null;
  const st = status(last.valor, refMin, refMax);
  const stLabel = { low: "Abaixo da referência", high: "Acima da referência", ok: "Dentro da referência", none: "Sem referência no laudo" }[st];
  let trend = "Primeiro resultado";
  if (prev) {
    const d = last.valor - prev.valor;
    const pct = prev.valor ? Math.round((d / prev.valor) * 100) : 0;
    trend = d > 0 ? `⬆ subiu ${pct}% desde ${fmtData(prev.data)}` : d < 0 ? `⬇ desceu ${Math.abs(pct)}% desde ${fmtData(prev.data)}` : `➡ manteve desde ${fmtData(prev.data)}`;
  }
  const refTxt = refMin != null && refMax != null ? `ref. ${fmt(refMin)}–${fmt(refMax)}` : refMin != null ? `ref. ≥ ${fmt(refMin)}` : refMax != null ? `ref. < ${fmt(refMax)}` : "";
  return `<article class="card" data-m="${esc(nome)}">
  <header><h3>${esc(nome)}</h3><span class="badge ${st}">${stLabel}</span></header>
  ${DESC[nome] ? `<p class="desc">${esc(DESC[nome])}</p>` : ""}
  <p class="now"><strong>${fmt(last.valor)}</strong> <span>${esc(last.unidade)}</span></p>
  <p class="meta">${esc(trend)}${refTxt ? ` · ${esc(refTxt)}` : ""}</p>
  ${chartSvg(pts, refMin, refMax)}
</article>`;
}

function page(rows, geradoEm) {
  const valid = rows.filter((r) => r.marcador && r.valor != null && r.data);
  const byMarker = new Map();
  for (const r of valid) {
    if (!byMarker.has(r.marcador)) byMarker.set(r.marcador, []);
    byMarker.get(r.marcador).push(r);
  }
  const groups = new Map();
  for (const [m, pts] of byMarker) {
    const g = pts[0].grupo;
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push([m, pts]);
  }
  const ordered = [...groups.keys()].sort((a, b) => (GROUP_ORDER.indexOf(a) + 1 || 99) - (GROUP_ORDER.indexOf(b) + 1 || 99));
  const sections = ordered.map((g) => `<section data-g="${esc(g)}"><h2>${esc(g)}</h2><div class="grid">${groups.get(g).map(([m, pts]) => card(m, pts)).join("")}</div></section>`).join("");
  const chips = ["Todos", ...ordered].map((g, i) => `<button class="chip" aria-pressed="${i === 0}" data-g="${esc(g)}">${esc(g)}</button>`).join("");

  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>Evolução dos exames</title>
<style>
:root{--bg:#ffffff;--card:#f7f7f5;--ink:#37352f;--muted:#787774;--line:#2f6fde;--band:rgba(68,131,97,.13);--ok:#448361;--low:#d44c47;--high:#cb7b37;--none:#9b9a97;--border:#e9e9e7}
@media (prefers-color-scheme: dark){:root:not([data-theme="light"]){--bg:#191919;--card:#252525;--ink:#e6e6e4;--muted:#9b9b9b;--line:#5e9cf5;--band:rgba(80,180,120,.16);--border:#333}}
:root[data-theme="dark"]{--bg:#191919;--card:#252525;--ink:#e6e6e4;--muted:#9b9b9b;--line:#5e9cf5;--band:rgba(80,180,120,.16);--border:#333}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font:14px/1.45 ui-sans-serif,-apple-system,"Segoe UI",Roboto,sans-serif;padding:16px}
h1{font-size:18px;margin:0 0 4px}
.sub{color:var(--muted);margin:0 0 12px;font-size:12px}
.chips{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:12px}
.chip{border:1px solid var(--border);background:var(--card);color:var(--ink);border-radius:999px;padding:4px 10px;font:inherit;font-size:12px;cursor:pointer}
.chip[aria-pressed="true"]{background:var(--line);border-color:var(--line);color:#fff}
h2{font-size:13px;text-transform:uppercase;letter-spacing:.04em;color:var(--muted);margin:18px 0 8px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:10px}
.card{background:var(--card);border:1px solid var(--border);border-radius:10px;padding:12px}
.card header{display:flex;justify-content:space-between;align-items:center;gap:8px}
h3{font-size:14px;margin:0}
.badge{font-size:11px;padding:2px 8px;border-radius:999px;white-space:nowrap;color:#fff}
.badge.ok{background:var(--ok)}.badge.low{background:var(--low)}.badge.high{background:var(--high)}.badge.none{background:var(--none)}
.now{margin:6px 0 0}.now strong{font-size:22px}.now span{color:var(--muted)}
.desc{margin:2px 0 0;color:var(--muted);font-size:11px;line-height:1.35}
.meta{margin:0 0 4px;color:var(--muted);font-size:12px}
svg{width:100%;height:auto;display:block;overflow:visible}
.band{fill:var(--band)}
.line{fill:none;stroke:var(--line);stroke-width:2;stroke-linejoin:round;stroke-linecap:round}
.pt{stroke:var(--card);stroke-width:1.5}.pt.ok{fill:var(--ok)}.pt.low{fill:var(--low)}.pt.high{fill:var(--high)}.pt.none{fill:var(--line)}
.val{font-size:10px;fill:var(--ink)}.val.strong{font-weight:600}.date{font-size:10px;fill:var(--muted)}
.legend{color:var(--muted);font-size:12px;margin-top:16px}
.hidden{display:none}
</style>
</head>
<body>
<h1>Evolução dos exames</h1>
<p class="sub">Atualizado em ${esc(geradoEm)} · faixa verde = referência do laudo</p>
<div class="chips" role="group" aria-label="Filtrar por grupo">${chips}</div>
${sections || "<p>Nenhum dado encontrado.</p>"}
<p class="legend">● verde dentro da referência · ● vermelho abaixo · ● laranja acima</p>
<script>
(function(){
  var q = new URLSearchParams(location.search);
  var only = q.get("m"), grp = q.get("g");
  var chips = document.querySelectorAll(".chip");
  function show(g){
    chips.forEach(function(c){c.setAttribute("aria-pressed", c.dataset.g===g)});
    document.querySelectorAll("section").forEach(function(s){s.classList.toggle("hidden", g!=="Todos" && s.dataset.g!==g)});
  }
  chips.forEach(function(c){c.addEventListener("click",function(){show(c.dataset.g)})});
  if (grp) show(grp);
  if (only) {
    var wanted = only.split(",");
    document.querySelectorAll(".card").forEach(function(c){c.classList.toggle("hidden", wanted.indexOf(c.dataset.m)<0)});
    document.querySelectorAll("section").forEach(function(s){s.classList.toggle("hidden", !s.querySelector(".card:not(.hidden)"))});
    document.querySelector(".chips").classList.add("hidden");
  }
})();
</script>
</body>
</html>`;
}

const rows = await fetchRows();
const geradoEm = new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" });
await mkdir(`site/${PAGE_KEY}`, { recursive: true });
await writeFile(`site/${PAGE_KEY}/index.html`, page(rows, geradoEm));
// Raiz vazia, para não expor o endereço da página
await writeFile("site/index.html", '<!doctype html><meta charset="utf-8"><meta name="robots" content="noindex"><title>.</title>');
console.log(`OK: ${rows.length} linhas → site/${PAGE_KEY}/index.html`);
