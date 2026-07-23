// Geometria vetorial real do PDF: reconstrói os segmentos de reta do desenho
// (a partir da lista de operadores do pdf.js) para dois usos:
//   1) DESTACAR as linhas das paredes na tela;
//   2) o "snap" das ferramentas de medição gruda nos CANTOS e LINHAS exatos
//      do CAD, deixando o perímetro preciso.
// Só faz sentido em PDF vetorial (planta escaneada não tem geometria).

import * as pdfjs from '../vendor/pdf.min.mjs';

const OPS = pdfjs.OPS;
const cache = new Map(); // pranchaId -> { segs, longos, grid, cell }

const CELL = 24;      // célula do índice espacial de cantos (coords base)
const MIN_SEG = 3;    // ignora micro-segmentos (hachura/texto) no snap de canto
const MIN_LONGO = 28; // segmentos "longos": destaque na tela e snap de linha

function mul(a, b) {
  return [
    a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5],
  ];
}
const aplicar = (m, x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];

// Reconstrói segmentos [{ax,ay,bx,by,len}] em coords base (topo-esquerda).
function reconstruir(ol, vp) {
  let ctm = [1, 0, 0, 1, 0, 0];
  const pilha = [];
  const segs = [];
  const push = (ux, uy, vx, vy) => {
    const [ax, ay] = aplicar(ctm, ux, uy);
    const [bx, by] = aplicar(ctm, vx, vy);
    const [pax, pay] = vp.convertToViewportPoint(ax, ay);
    const [pbx, pby] = vp.convertToViewportPoint(bx, by);
    const len = Math.hypot(pbx - pax, pby - pay);
    if (len > 0.5) segs.push({ ax: pax, ay: pay, bx: pbx, by: pby, len });
  };

  for (let i = 0; i < ol.fnArray.length; i++) {
    const fn = ol.fnArray[i], args = ol.argsArray[i];
    if (fn === OPS.save) pilha.push(ctm.slice());
    else if (fn === OPS.restore) ctm = pilha.pop() || ctm;
    else if (fn === OPS.transform) ctm = mul(ctm, args);
    else if (fn === OPS.constructPath) {
      const ops = args[0], coords = args[1];
      let ci = 0, cur = null, inicio = null;
      // IMPORTANTE: cada operador consome um nº fixo de coordenadas. Se algum
      // não for tratado (curveTo2/curveTo3/closePath), o índice desalinha e os
      // pontos seguintes viram lixo — daí linhas diagonais atravessando o
      // desenho. Por isso tratamos TODOS e só desenhamos os trechos retos.
      for (const op of ops) {
        if (op === OPS.moveTo) {
          cur = [coords[ci], coords[ci + 1]]; ci += 2; inicio = cur;
        } else if (op === OPS.lineTo) {
          const nx = coords[ci], ny = coords[ci + 1]; ci += 2;
          if (cur) push(cur[0], cur[1], nx, ny);
          cur = [nx, ny];
        } else if (op === OPS.curveTo) {          // c — 6 coords (2 controles + fim)
          ci += 6; cur = [coords[ci - 2], coords[ci - 1]];
        } else if (op === OPS.curveTo2 || op === OPS.curveTo3) { // v / y — 4 coords
          ci += 4; cur = [coords[ci - 2], coords[ci - 1]];
        } else if (op === OPS.closePath) {        // fecha o subpath (0 coords)
          if (cur && inicio) push(cur[0], cur[1], inicio[0], inicio[1]);
          cur = inicio;
        } else if (op === OPS.rectangle) {        // 4 coords
          const x = coords[ci], y = coords[ci + 1], w = coords[ci + 2], h = coords[ci + 3];
          ci += 4;
          push(x, y, x + w, y); push(x + w, y, x + w, y + h);
          push(x + w, y + h, x, y + h); push(x, y + h, x, y);
          cur = null; inicio = null;
        }
      }
    }
  }
  return segs;
}

// Extrai (uma vez por prancha) e monta o índice espacial de cantos.
export async function extrairSegmentos(page, pranchaId) {
  if (cache.has(pranchaId)) return cache.get(pranchaId);
  const vp = page.getViewport({ scale: 1 });
  const ol = await page.getOperatorList();
  const segs = reconstruir(ol, vp);

  const grid = new Map();
  const addPt = (x, y) => {
    const chave = `${Math.floor(x / CELL)},${Math.floor(y / CELL)}`;
    let arr = grid.get(chave);
    if (!arr) grid.set(chave, arr = []);
    arr.push([x, y]);
  };
  for (const s of segs) {
    if (s.len < MIN_SEG) continue;
    addPt(s.ax, s.ay); addPt(s.bx, s.by);
  }
  const longos = segs.filter(s => s.len >= MIN_LONGO);
  const info = { segs, longos, grid, cell: CELL };
  cache.set(pranchaId, info);
  return info;
}

export function linhasCache(pranchaId) { return cache.get(pranchaId) || null; }
export function esquecerLinhas(pranchaId) { cache.delete(pranchaId); }

// Projeção de um ponto no segmento (clampada às extremidades).
function projetar(pt, s) {
  const vx = s.bx - s.ax, vy = s.by - s.ay;
  const l2 = vx * vx + vy * vy;
  if (!l2) return null;
  let t = ((pt.x - s.ax) * vx + (pt.y - s.ay) * vy) / l2;
  t = Math.max(0, Math.min(1, t));
  return { x: s.ax + t * vx, y: s.ay + t * vy };
}

// Ponto de encaixe mais próximo dentro do raio (coords base): primeiro tenta
// um CANTO (extremidade de segmento); se não houver, projeta na LINHA longa
// mais próxima. Retorna {x, y, tipo:'canto'|'linha'} ou null.
export function snapPonto(pranchaId, pt, raio) {
  const info = cache.get(pranchaId);
  if (!info) return null;
  const r2 = raio * raio;

  const cx = Math.floor(pt.x / info.cell), cy = Math.floor(pt.y / info.cell);
  let canto = null, md = r2;
  for (let gx = cx - 1; gx <= cx + 1; gx++) {
    for (let gy = cy - 1; gy <= cy + 1; gy++) {
      const arr = info.grid.get(`${gx},${gy}`);
      if (!arr) continue;
      for (const [x, y] of arr) {
        const d = (x - pt.x) ** 2 + (y - pt.y) ** 2;
        if (d < md) { md = d; canto = { x, y, tipo: 'canto' }; }
      }
    }
  }
  if (canto) return canto;

  let linha = null, mdl = r2;
  for (const s of info.longos) {
    const p = projetar(pt, s);
    if (!p) continue;
    const d = (p.x - pt.x) ** 2 + (p.y - pt.y) ** 2;
    if (d < mdl) { mdl = d; linha = { x: p.x, y: p.y, tipo: 'linha' }; }
  }
  return linha;
}
