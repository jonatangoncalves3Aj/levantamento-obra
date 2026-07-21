// Regras de cálculo do levantamento (as do vídeo):
// parede bruta = perímetro × PD osso; parede acab. = perímetro × PD acab.
// porta/correr desconta sempre; janela só desconta se o vão unitário > 2,00 m²
// parede líq. = parede acab. − desconto de vãos

export const LIMITE_JANELA_M2 = 2.0;

export function num(v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  let s = String(v).trim();
  // Padrão brasileiro: se há vírgula decimal, os pontos são separador de milhar
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : null;
}

export function fmt(n, casas = 2) {
  if (n === null || n === undefined || !Number.isFinite(n)) return '';
  return n.toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas });
}

export function calcAmbiente(a) {
  const per = num(a.perimetro);
  const pdOsso = num(a.pdOsso);
  const pdAcab = num(a.pdAcab);
  const pdBruta = pdOsso ?? pdAcab;
  const pdFina = pdAcab ?? pdOsso;
  const qtd = num(a.qtd) ?? 1;

  const paredeBruta = per !== null && pdBruta !== null ? per * pdBruta : null;
  const paredeAcab = per !== null && pdFina !== null ? per * pdFina : null;

  let nVaos = 0, descVaos = 0;
  for (const v of a.vaos || []) {
    const larg = num(v.largura), alt = num(v.altura), q = num(v.qtd) ?? 1;
    if (larg === null || alt === null) continue;
    nVaos += q;
    const areaUnit = larg * alt;
    const desconta = v.tipo === 'janela' ? areaUnit > LIMITE_JANELA_M2 : true;
    if (desconta) descVaos += areaUnit * q;
  }

  const paredeLiq = paredeAcab !== null ? Math.max(paredeAcab - descVaos, 0) : null;

  return { area: num(a.area), paredeBruta, paredeAcab, nVaos, descVaos: descVaos || null, paredeLiq, qtd };
}

// Distância entre 2 pontos {x,y} em unidades base do PDF
export function dist(p1, p2) {
  return Math.hypot(p2.x - p1.x, p2.y - p1.y);
}

export function comprimentoPolilinha(pts) {
  let c = 0;
  for (let i = 1; i < pts.length; i++) c += dist(pts[i - 1], pts[i]);
  return c;
}

export function perimetroPoligono(pts) {
  if (pts.length < 3) return 0;
  return comprimentoPolilinha(pts) + dist(pts[pts.length - 1], pts[0]);
}

// Shoelace — área do polígono em unidades base²
export function areaPoligono(pts) {
  let s = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    s += a.x * b.y - b.x * a.y;
  }
  return Math.abs(s) / 2;
}

// Escala de carimbo 1:N → pontos PDF por metro real (1 pt = 1/72", papel em escala 1:N)
export const PT_POR_METRO_PAPEL = 72 / 0.0254;
export const pxPorMetroDeEscala = (N) => PT_POR_METRO_PAPEL / N;
