// Vista Avanço — % executado por ambiente/pavimento e curva S (planejado × real)
// Cores das séries validadas p/ superfície escura: Real #ea580c, Planejado #3b82f6

import { state, salvar, ordenarPavimentos, ambientesPorPavimento } from './store.js';
import { fmt, num } from './calc.js';

const scroll = document.getElementById('avanco-scroll');
const COR_REAL = '#ea580c';
const COR_PLAN = '#3b82f6';

function pesoAmbiente(a) {
  return (num(a.area) ?? 1) * (num(a.qtd) ?? 1);
}

export function avancoGlobal(proj) {
  let soma = 0, pesos = 0;
  for (const p of proj.pranchas) {
    for (const a of p.ambientes) {
      const w = pesoAmbiente(a);
      soma += (num(a.avanco) ?? 0) * w;
      pesos += w;
    }
  }
  return pesos > 0 ? soma / pesos : 0;
}

// Guarda um snapshot por dia (substitui o do mesmo dia)
export function registrarSnapshot(proj) {
  const hoje = new Date().toISOString().slice(0, 10);
  const valor = +avancoGlobal(proj).toFixed(1);
  const existente = proj.snapshots.find(s => s.data === hoje);
  if (existente) existente.avanco = valor;
  else proj.snapshots.push({ data: hoje, avanco: valor });
  proj.snapshots.sort((a, b) => a.data.localeCompare(b.data));
}

function barra(avanco, larg = '140px') {
  const wrap = document.createElement('div');
  wrap.className = 'barra-avanco';
  wrap.style.width = larg;
  const fill = document.createElement('div');
  fill.style.width = `${Math.min(100, Math.max(0, avanco))}%`;
  fill.className = avanco >= 100 ? 'cheia' : '';
  wrap.appendChild(fill);
  return wrap;
}

export function renderAvanco() {
  const proj = state.projeto;
  if (!scroll || !proj) return;
  scroll.innerHTML = '';

  document.getElementById('inp-data-inicio').value = proj.dataInicio || '';
  document.getElementById('inp-data-fim').value = proj.dataFim || '';
  const global = avancoGlobal(proj);
  document.getElementById('avanco-global').textContent = `Avanço global: ${fmt(global, 1)}%`;

  if (!proj.pranchas.some(p => p.ambientes.length)) {
    scroll.innerHTML = '<p class="dica" style="padding:20px">Nenhum ambiente levantado ainda — importe pranchas e analise a planta primeiro.</p>';
    return;
  }

  // Por pavimento (efetivo — ambientes podem ter pavimento separado da prancha)
  const porPav = ambientesPorPavimento(proj);

  for (const pavimento of ordenarPavimentos(proj, [...porPav.keys()])) {
    const ambientes = porPav.get(pavimento);
    if (!ambientes.length) continue;
    let soma = 0, pesos = 0;
    for (const a of ambientes) { const w = pesoAmbiente(a); soma += (num(a.avanco) ?? 0) * w; pesos += w; }
    const media = pesos ? soma / pesos : 0;

    const h = document.createElement('h3');
    h.className = 'tabela-sub';
    h.textContent = `${pavimento} — ${fmt(media, 1)}%`;
    scroll.appendChild(h);

    for (const a of ambientes) {
      const linha = document.createElement('div');
      linha.className = 'avanco-linha';
      const nome = document.createElement('span');
      nome.className = 'avanco-nome';
      nome.textContent = a.nome;
      const slider = document.createElement('input');
      slider.type = 'range';
      slider.min = 0; slider.max = 100; slider.step = 5;
      slider.value = num(a.avanco) ?? 0;
      const rotulo = document.createElement('strong');
      rotulo.className = 'avanco-pct';
      rotulo.textContent = `${fmt(num(a.avanco) ?? 0, 0)}%`;
      slider.addEventListener('input', () => { rotulo.textContent = `${slider.value}%`; });
      slider.addEventListener('change', () => {
        a.avanco = +slider.value;
        registrarSnapshot(proj);
        salvar(); renderAvanco();
      });
      linha.appendChild(nome);
      linha.appendChild(slider);
      linha.appendChild(barra(num(a.avanco) ?? 0));
      linha.appendChild(rotulo);
      scroll.appendChild(linha);
    }
  }

  scroll.appendChild(curvaS(proj));
}

/* ---------- Curva S (SVG) ---------- */

function curvaS(proj) {
  const cont = document.createElement('div');
  cont.className = 'curva-s';
  const h = document.createElement('h3');
  h.className = 'tabela-sub';
  h.textContent = 'Curva S — avanço físico (%)';
  cont.appendChild(h);

  const inicio = proj.dataInicio ? new Date(proj.dataInicio) : null;
  const fim = proj.dataFim ? new Date(proj.dataFim) : null;
  const snaps = proj.snapshots || [];

  if ((!inicio || !fim || fim <= inicio) && snaps.length < 2) {
    const p = document.createElement('p');
    p.className = 'dica';
    p.textContent = 'Defina as datas de início e término para ver a curva planejada; o avanço real é registrado automaticamente a cada atualização.';
    cont.appendChild(p);
    if (!snaps.length) return cont;
  }

  const W = 720, H = 260, mE = 40, mD = 86, mT = 14, mB = 30;
  const x0 = mE, x1 = W - mD, y0 = H - mB, y1 = mT;

  let t0 = inicio, t1 = fim;
  if (!t0 || !t1 || t1 <= t0) {
    t0 = new Date(snaps[0].data);
    t1 = new Date(snaps[snaps.length - 1].data);
    if (+t1 === +t0) t1 = new Date(+t0 + 86400000);
  }
  const X = (d) => x0 + (x1 - x0) * Math.min(1, Math.max(0, (d - t0) / (t1 - t0)));
  const Y = (v) => y0 - (y0 - y1) * (v / 100);

  const partes = [];
  partes.push(`<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Curva S de avanço físico">`);

  // Grade recessiva + eixo Y
  for (const v of [0, 25, 50, 75, 100]) {
    partes.push(`<line x1="${x0}" y1="${Y(v)}" x2="${x1}" y2="${Y(v)}" class="grade"/>`);
    partes.push(`<text x="${x0 - 6}" y="${Y(v) + 3.5}" class="eixo" text-anchor="end">${v}</text>`);
  }
  // Eixo X: início, meio, fim
  const dataBR = (d) => d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' });
  for (const [d, anc] of [[t0, 'start'], [new Date((+t0 + +t1) / 2), 'middle'], [t1, 'end']]) {
    partes.push(`<text x="${X(d)}" y="${H - 8}" class="eixo" text-anchor="${anc}">${dataBR(d)}</text>`);
  }

  // Planejado: S-curve suave p(t) = 3t² − 2t³ (só com datas definidas)
  const temPlano = inicio && fim && fim > inicio;
  if (temPlano) {
    const pts = [];
    for (let i = 0; i <= 40; i++) {
      const t = i / 40;
      const d = new Date(+t0 + t * (t1 - t0));
      pts.push(`${X(d).toFixed(1)},${Y((3 * t * t - 2 * t * t * t) * 100).toFixed(1)}`);
    }
    partes.push(`<polyline points="${pts.join(' ')}" fill="none" stroke="${COR_PLAN}" stroke-width="2"/>`);
    partes.push(`<circle cx="${x1 + 8}" cy="${Y(100)}" r="4" fill="${COR_PLAN}"/>`);
    partes.push(`<text x="${x1 + 15}" y="${Y(100) + 4}" class="rotulo-serie">Planejado</text>`);
  }

  // Real: snapshots
  if (snaps.length) {
    const pts = snaps.map(s => `${X(new Date(s.data)).toFixed(1)},${Y(s.avanco).toFixed(1)}`);
    if (snaps.length > 1) {
      partes.push(`<polyline points="${pts.join(' ')}" fill="none" stroke="${COR_REAL}" stroke-width="2"/>`);
    }
    for (const s of snaps) {
      partes.push(`<circle cx="${X(new Date(s.data)).toFixed(1)}" cy="${Y(s.avanco).toFixed(1)}" r="4" fill="${COR_REAL}" stroke="var(--fundo-2)" stroke-width="2"><title>${dataBR(new Date(s.data))} — ${fmt(s.avanco, 1)}%</title></circle>`);
    }
    const ultimo = snaps[snaps.length - 1];
    partes.push(`<text x="${X(new Date(ultimo.data)) + 10}" y="${Y(ultimo.avanco) + 4}" class="rotulo-serie">Real ${fmt(ultimo.avanco, 1)}%</text>`);
  }

  partes.push('</svg>');

  const wrap = document.createElement('div');
  wrap.className = 'curva-s-svg';
  wrap.innerHTML = partes.join('');
  cont.appendChild(wrap);

  // Legenda (2 séries)
  const leg = document.createElement('p');
  leg.className = 'legenda';
  leg.innerHTML = `<span><i style="background:${COR_PLAN}"></i> Planejado</span>` +
    `<span><i style="background:${COR_REAL}"></i> Real (pontos = registros diários)</span>`;
  cont.appendChild(leg);
  return cont;
}
