// Vista Orçamento — serviços com quantidades vindas do levantamento,
// curva ABC (A ≤ 80% acum., B ≤ 95%, C acima) e BDI

import { state, uid, salvar, totaisParedes } from './store.js';
import { calcAmbiente, fmt, num } from './calc.js';
import {
  ITENS_INSTALACAO, totaisInstalacoes, totaisRevestimento, FONTES_REVESTIMENTO,
} from './instalacoes.js';

const scroll = document.getElementById('orc-scroll');

export const FONTES = {
  paredeLiq: 'Parede líq. — por ambiente (m²)',
  paredeInterna: 'Parede interna medida (m²)',
  paredeExterna: 'Parede externa medida (m²)',
  areaPiso: 'Área de piso (m²)',
  areaTeto: 'Área de teto (m²)',
  perimetro: 'Perímetro/rodapé (m)',
  ...FONTES_REVESTIMENTO,
  ...Object.fromEntries(Object.entries(ITENS_INSTALACAO).map(([k, v]) => [`inst:${k}`, `${v} (un)`])),
  manual: 'Manual',
};

export function quantidadeServico(proj, s) {
  if (s.fonte === 'manual') return num(s.qtdManual) ?? 0;
  if (s.fonte === 'paredeInterna') return totaisParedes(proj).interna;
  if (s.fonte === 'paredeExterna') return totaisParedes(proj).externa;
  if (s.fonte?.startsWith('inst:')) return totaisInstalacoes(proj)[s.fonte.slice(5)] ?? 0;
  if (s.fonte in FONTES_REVESTIMENTO) return totaisRevestimento(proj)[s.fonte] ?? 0;
  let total = 0;
  for (const prancha of proj.pranchas) {
    for (const a of prancha.ambientes) {
      const c = calcAmbiente(a);
      const q = c.qtd ?? 1;
      if (s.fonte === 'paredeLiq' && c.paredeLiq !== null) total += c.paredeLiq * q;
      if ((s.fonte === 'areaPiso' || s.fonte === 'areaTeto') && c.area !== null) total += c.area * q;
      if (s.fonte === 'perimetro' && num(a.perimetro) !== null) total += num(a.perimetro) * q;
    }
  }
  return total;
}

function linhasOrcamento(proj) {
  const linhas = proj.catalogo.map(s => {
    const qtd = quantidadeServico(proj, s);
    const preco = num(s.preco) ?? 0;
    return { s, qtd, preco, total: qtd * preco };
  });
  linhas.sort((a, b) => b.total - a.total);
  const custoDireto = linhas.reduce((soma, l) => soma + l.total, 0);
  let acum = 0;
  for (const l of linhas) {
    l.pct = custoDireto > 0 ? (l.total / custoDireto) * 100 : 0;
    acum += l.pct;
    l.acum = acum;
    l.classe = l.total === 0 ? '—' : acum <= 80 ? 'A' : acum <= 95 ? 'B' : 'C';
  }
  return { linhas, custoDireto };
}

function inputCel(valor, aoMudar, opts = {}) {
  const td = document.createElement('td');
  const inp = document.createElement('input');
  inp.value = typeof valor === 'number' ? String(valor).replace('.', ',') : (valor ?? '');
  if (!opts.texto) inp.inputMode = 'decimal';
  if (opts.larg) inp.style.width = opts.larg;
  inp.addEventListener('change', () => { aoMudar(inp.value.trim()); salvar(); renderOrcamento(); });
  td.appendChild(inp);
  return td;
}

const celTexto = (t, cls) => {
  const td = document.createElement('td');
  td.textContent = t ?? '';
  if (cls) td.className = cls;
  return td;
};

export function renderOrcamento() {
  const proj = state.projeto;
  if (!scroll || !proj) return;
  scroll.innerHTML = '';
  document.getElementById('inp-bdi').value = String(proj.bdi ?? 25).replace('.', ',');

  const { linhas, custoDireto } = linhasOrcamento(proj);

  const tabela = document.createElement('table');
  tabela.className = 'quant';
  tabela.innerHTML = '<thead><tr><th>Serviço</th><th>Un</th><th>Fonte da quantidade</th>' +
    '<th>Quant.</th><th>Preço unit. (R$)</th><th>Total (R$)</th><th>%</th><th>% acum.</th><th>ABC</th><th></th></tr></thead>';
  const tbody = document.createElement('tbody');

  for (const l of linhas) {
    const s = l.s;
    const tr = document.createElement('tr');
    tr.appendChild(inputCel(s.nome, v => { s.nome = v; }, { texto: true, larg: '190px' }));
    tr.appendChild(inputCel(s.un, v => { s.un = v; }, { texto: true, larg: '44px' }));

    const tdFonte = document.createElement('td');
    const sel = document.createElement('select');
    for (const [val, rot] of Object.entries(FONTES)) {
      sel.appendChild(new Option(rot, val, false, s.fonte === val));
    }
    sel.addEventListener('change', () => { s.fonte = sel.value; salvar(); renderOrcamento(); });
    tdFonte.appendChild(sel);
    tr.appendChild(tdFonte);

    if (s.fonte === 'manual') {
      tr.appendChild(inputCel(s.qtdManual, v => { s.qtdManual = v; }, { larg: '70px' }));
    } else {
      tr.appendChild(celTexto(fmt(l.qtd)));
    }
    tr.appendChild(inputCel(s.preco, v => { s.preco = v; }, { larg: '80px' }));
    tr.appendChild(celTexto(fmt(l.total)));
    tr.appendChild(celTexto(fmt(l.pct, 1)));
    tr.appendChild(celTexto(fmt(l.acum, 1)));
    tr.appendChild(celTexto(l.classe, `abc abc-${l.classe}`));

    const tdDel = document.createElement('td');
    const del = document.createElement('button');
    del.className = 'btn-excluir';
    del.textContent = '×';
    del.title = 'Excluir serviço';
    del.addEventListener('click', () => {
      proj.catalogo = proj.catalogo.filter(x => x.id !== s.id);
      salvar(); renderOrcamento();
    });
    tdDel.appendChild(del);
    tr.appendChild(tdDel);
    tbody.appendChild(tr);
  }

  const bdi = num(proj.bdi) ?? 0;
  const valorBdi = custoDireto * bdi / 100;
  const rodape = [
    ['Custo direto', custoDireto],
    [`BDI (${fmt(bdi, 1)}%)`, valorBdi],
    ['Total com BDI', custoDireto + valorBdi],
  ];
  for (const [rotulo, valor] of rodape) {
    const tr = document.createElement('tr');
    tr.className = rotulo.startsWith('Total') ? 'total' : 'subtotal';
    const td1 = celTexto(rotulo);
    td1.colSpan = 5;
    tr.appendChild(td1);
    const td2 = celTexto(fmt(valor));
    tr.appendChild(td2);
    const td3 = celTexto('');
    td3.colSpan = 4;
    tr.appendChild(td3);
    tbody.appendChild(tr);
  }

  tabela.appendChild(tbody);
  scroll.appendChild(tabela);
}

export function adicionarServico() {
  state.projeto.catalogo.push({ id: uid(), nome: 'Novo serviço', un: 'm²', fonte: 'manual', qtdManual: 0, preco: 0 });
  salvar(); renderOrcamento();
}

// Importa serviços de um CSV "nome;un;preço[;fonte]" (aceita , ou ; e vírgula decimal)
export function importarPrecosCSV(texto) {
  const linhas = texto.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  let novos = 0, atualizados = 0;
  for (const linha of linhas) {
    const sep = linha.includes(';') ? ';' : ',';
    const partes = linha.split(sep).map(x => x.trim().replace(/^"|"$/g, ''));
    if (partes.length < 3) continue;
    const [nome, un, precoBruto, fonteBruta] = partes;
    const preco = num(precoBruto);
    if (!nome || preco === null) continue;                 // cabeçalho/linha inválida
    const fonte = Object.keys(FONTES).includes(fonteBruta) ? fonteBruta : 'manual';
    const existente = state.projeto.catalogo.find(s => s.nome.toLowerCase() === nome.toLowerCase());
    if (existente) { existente.preco = preco; if (un) existente.un = un; atualizados++; }
    else { state.projeto.catalogo.push({ id: uid(), nome, un: un || 'un', fonte, qtdManual: 0, preco }); novos++; }
  }
  salvar(); renderOrcamento();
  return { novos, atualizados };
}

export function exportarOrcamentoCSV() {
  const proj = state.projeto;
  const { linhas, custoDireto } = linhasOrcamento(proj);
  const out = ['Serviço;Un;Fonte;Quant.;Preço unit.;Total;%;% acum.;ABC'];
  for (const l of linhas) {
    out.push([l.s.nome, l.s.un, FONTES[l.s.fonte] || l.s.fonte, fmt(l.qtd), fmt(l.preco),
      fmt(l.total), fmt(l.pct, 1), fmt(l.acum, 1), l.classe].join(';'));
  }
  const bdi = num(proj.bdi) ?? 0;
  out.push(`Custo direto;;;;;${fmt(custoDireto)}`);
  out.push(`BDI (${fmt(bdi, 1)}%);;;;;${fmt(custoDireto * bdi / 100)}`);
  out.push(`Total com BDI;;;;;${fmt(custoDireto * (1 + bdi / 100))}`);
  const blob = new Blob(['﻿' + out.join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `orcamento-${proj.nome.toLowerCase().replace(/\s+/g, '-')}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}
