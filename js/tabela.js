// Vista Tabela — quantitativos por pavimento, subtotais, CSV e impressão

import { state, salvar, ordenarPavimentos } from './store.js';
import { calcAmbiente, fmt, num } from './calc.js';
import { comprimentoPolilinha } from './calc.js';

const scroll = document.getElementById('tabela-scroll');

const COLS = [
  'Ambiente', 'Área (m²)', 'Lado (m)', 'Perímetro (m)', 'PD osso', 'PD acab.',
  'Parede bruta (m²)', 'nº vãos', 'desc. vãos (m²)', 'Parede acab. (m²)', 'Parede líq. (m²)', 'Qtd.',
];

function grupos() {
  const porPav = new Map();
  for (const p of state.projeto?.pranchas || []) {
    if (!porPav.has(p.pavimento)) porPav.set(p.pavimento, []);
    porPav.get(p.pavimento).push(p);
  }
  const ordenado = new Map();
  for (const nome of ordenarPavimentos(state.projeto, [...porPav.keys()])) {
    ordenado.set(nome, porPav.get(nome));
  }
  return ordenado;
}

const valorBR = (v) => (typeof v === 'number' ? String(v).replace('.', ',') : v ?? '');

function inputCel(valor, aoMudar, textoLivre = false) {
  const td = document.createElement('td');
  const inp = document.createElement('input');
  inp.value = textoLivre ? (valor ?? '') : valorBR(valor);
  if (!textoLivre) inp.inputMode = 'decimal';
  inp.addEventListener('change', () => { aoMudar(inp.value.trim()); salvar(); renderTabela(); });
  td.appendChild(inp);
  return td;
}

const celTexto = (t, cls) => {
  const td = document.createElement('td');
  td.textContent = t ?? '';
  if (cls) td.className = cls;
  return td;
};

export function renderTabela() {
  if (!scroll) return;
  scroll.innerHTML = '';
  if (!state.projeto?.pranchas.length) {
    scroll.innerHTML = '<p class="dica" style="padding:20px">Nenhuma prancha importada ainda.</p>';
    return;
  }

  const tabela = document.createElement('table');
  tabela.className = 'quant';
  const thead = document.createElement('thead');
  const trh = document.createElement('tr');
  for (const c of COLS) trh.appendChild(Object.assign(document.createElement('th'), { textContent: c }));
  thead.appendChild(trh);
  tabela.appendChild(thead);
  const tbody = document.createElement('tbody');

  const totalGeral = { area: 0, bruta: 0, desc: 0, acab: 0, liq: 0, vaos: 0 };

  for (const [pavimento, pranchas] of grupos()) {
    const trg = document.createElement('tr');
    trg.className = 'grupo';
    const tdg = document.createElement('td');
    tdg.colSpan = COLS.length;
    tdg.textContent = pavimento;
    trg.appendChild(tdg);
    tbody.appendChild(trg);

    const sub = { area: 0, bruta: 0, desc: 0, acab: 0, liq: 0, vaos: 0 };

    for (const prancha of pranchas) {
      for (const a of prancha.ambientes) {
        const c = calcAmbiente(a);
        const tr = document.createElement('tr');
        tr.appendChild(inputCel(a.nome, v => { a.nome = v; }, true));
        tr.appendChild(inputCel(a.area, v => { a.area = v; a.areaOrigem = 'manual'; }));
        tr.appendChild(inputCel(a.lado, v => { a.lado = v; }, true));
        tr.appendChild(inputCel(a.perimetro, v => { a.perimetro = v; }));
        tr.appendChild(inputCel(a.pdOsso, v => { a.pdOsso = v; }));
        tr.appendChild(inputCel(a.pdAcab, v => { a.pdAcab = v; }));
        tr.appendChild(celTexto(fmt(c.paredeBruta)));
        tr.appendChild(celTexto(c.nVaos || ''));
        tr.appendChild(celTexto(fmt(c.descVaos)));
        tr.appendChild(celTexto(fmt(c.paredeAcab)));
        tr.appendChild(celTexto(fmt(c.paredeLiq)));
        tr.appendChild(inputCel(a.qtd, v => { a.qtd = v; }));
        tbody.appendChild(tr);

        const q = c.qtd ?? 1;
        if (c.area !== null) sub.area += c.area * q;
        if (c.paredeBruta !== null) sub.bruta += c.paredeBruta * q;
        if (c.descVaos !== null) sub.desc += c.descVaos * q;
        if (c.paredeAcab !== null) sub.acab += c.paredeAcab * q;
        if (c.paredeLiq !== null) sub.liq += c.paredeLiq * q;
        sub.vaos += c.nVaos * q;
      }
    }

    const trs = document.createElement('tr');
    trs.className = 'subtotal';
    trs.appendChild(celTexto(`Subtotal — ${pavimento}`));
    trs.appendChild(celTexto(fmt(sub.area)));
    trs.appendChild(celTexto('')); trs.appendChild(celTexto(''));
    trs.appendChild(celTexto('')); trs.appendChild(celTexto(''));
    trs.appendChild(celTexto(fmt(sub.bruta)));
    trs.appendChild(celTexto(sub.vaos || ''));
    trs.appendChild(celTexto(fmt(sub.desc)));
    trs.appendChild(celTexto(fmt(sub.acab)));
    trs.appendChild(celTexto(fmt(sub.liq)));
    trs.appendChild(celTexto(''));
    tbody.appendChild(trs);

    for (const k of Object.keys(totalGeral)) totalGeral[k] += sub[k];
  }

  const trt = document.createElement('tr');
  trt.className = 'total';
  trt.appendChild(celTexto('Total geral'));
  trt.appendChild(celTexto(fmt(totalGeral.area)));
  trt.appendChild(celTexto('')); trt.appendChild(celTexto(''));
  trt.appendChild(celTexto('')); trt.appendChild(celTexto(''));
  trt.appendChild(celTexto(fmt(totalGeral.bruta)));
  trt.appendChild(celTexto(totalGeral.vaos || ''));
  trt.appendChild(celTexto(fmt(totalGeral.desc)));
  trt.appendChild(celTexto(fmt(totalGeral.acab)));
  trt.appendChild(celTexto(fmt(totalGeral.liq)));
  trt.appendChild(celTexto(''));
  tbody.appendChild(trt);

  tabela.appendChild(tbody);
  scroll.appendChild(tabela);

  renderMedicoesAvulsas();
}

function renderMedicoesAvulsas() {
  const linhas = [];
  for (const p of state.projeto.pranchas) {
    for (const m of p.medicoes) {
      if (m.tipo === 'linear') {
        const ppm = p.escala?.pxPorMetro;
        const compr = ppm ? comprimentoPolilinha(m.pontos) / ppm : null;
        linhas.push([p.pavimento, m.nome, 'Linear', compr !== null ? `${fmt(compr)} m` : '—']);
      } else if (m.tipo === 'contagem') {
        linhas.push([p.pavimento, m.nome, 'Contagem', `${m.pontos.length} un`]);
      }
    }
  }
  if (!linhas.length) return;

  const h = document.createElement('h3');
  h.className = 'tabela-sub';
  h.textContent = 'Medições avulsas (lineares e contagens)';
  scroll.appendChild(h);

  const t = document.createElement('table');
  t.className = 'quant';
  t.style.minWidth = '0';
  t.innerHTML = '<thead><tr><th>Pavimento</th><th>Nome</th><th>Tipo</th><th>Valor</th></tr></thead>';
  const tb = document.createElement('tbody');
  for (const l of linhas) {
    const tr = document.createElement('tr');
    l.forEach((v, i) => tr.appendChild(celTexto(v, i === 0 ? undefined : undefined)));
    tr.querySelectorAll('td').forEach(td => td.style.textAlign = 'left');
    tb.appendChild(tr);
  }
  t.appendChild(tb);
  scroll.appendChild(t);
}

/* ---------- Exportar CSV (padrão BR: ; e vírgula decimal) ---------- */
export function exportarCSV() {
  const linhas = [COLS.join(';')];
  for (const [pavimento, pranchas] of grupos()) {
    for (const prancha of pranchas) {
      for (const a of prancha.ambientes) {
        const c = calcAmbiente(a);
        linhas.push([
          `${pavimento} — ${a.nome}`, fmt(c.area), a.lado || '', fmt(num(a.perimetro)),
          fmt(num(a.pdOsso)), fmt(num(a.pdAcab)), fmt(c.paredeBruta), c.nVaos || 0,
          fmt(c.descVaos), fmt(c.paredeAcab), fmt(c.paredeLiq), c.qtd ?? 1,
        ].join(';'));
      }
    }
  }
  const blob = new Blob(['﻿' + linhas.join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'levantamento-de-obra.csv';
  a.click();
  URL.revokeObjectURL(a.href);
}
