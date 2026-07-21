// Exportação XLSX — pasta de trabalho com abas Quantitativos, Orçamento e Avanço
// Usa SheetJS (vendor/xlsx.full.min.js, carregado como script global XLSX)

import { state, ordenarPavimentos, ambientesPorPavimento, totaisParedes } from './store.js';
import { calcAmbiente, num } from './calc.js';
import { FONTES, quantidadeServico } from './orcamento.js';
import { avancoGlobal } from './avanco.js';
import {
  ITENS_INSTALACAO, TIPOS_AMBIENTE, classificarAmbiente, regrasAmbiente,
  totaisInstalacoes, totaisRevestimento,
} from './instalacoes.js';

const rd = (v, casas = 2) => (v === null || v === undefined ? null : +(+v).toFixed(casas));

function abaQuantitativos(proj) {
  const linhas = [[
    'Pavimento', 'Ambiente', 'Área (m²)', 'Lado (m)', 'Perímetro (m)', 'PD osso (m)', 'PD acab. (m)',
    'Parede bruta (m²)', 'nº vãos', 'Desc. vãos (m²)', 'Parede acab. (m²)', 'Parede líq. (m²)', 'Qtd.',
  ]];
  const porPav = ambientesPorPavimento(proj);
  for (const pav of ordenarPavimentos(proj, [...porPav.keys()])) {
    const sub = { area: 0, bruta: 0, desc: 0, acab: 0, liq: 0, vaos: 0 };
    for (const a of porPav.get(pav)) {
      const c = calcAmbiente(a);
      const q = c.qtd ?? 1;
      linhas.push([
        pav, a.nome, rd(c.area), a.lado || null, rd(num(a.perimetro)), rd(num(a.pdOsso)), rd(num(a.pdAcab)),
        rd(c.paredeBruta), c.nVaos || null, rd(c.descVaos), rd(c.paredeAcab), rd(c.paredeLiq), q,
      ]);
      if (c.area !== null) sub.area += c.area * q;
      if (c.paredeBruta !== null) sub.bruta += c.paredeBruta * q;
      if (c.descVaos !== null) sub.desc += c.descVaos * q;
      if (c.paredeAcab !== null) sub.acab += c.paredeAcab * q;
      if (c.paredeLiq !== null) sub.liq += c.paredeLiq * q;
      sub.vaos += c.nVaos * q;
    }
    linhas.push([`Subtotal — ${pav}`, null, rd(sub.area), null, null, null, null,
      rd(sub.bruta), sub.vaos || null, rd(sub.desc), rd(sub.acab), rd(sub.liq), null]);
  }

  // Paredes medidas (comprimento × PD) — interna × externa
  const par = totaisParedes(proj);
  if (par.interna || par.externa) {
    linhas.push([]);
    linhas.push(['PAREDES MEDIDAS (comprimento × pé-direito)']);
    linhas.push(['Pavimento', 'Interna (m²)', 'Externa (m²)', 'Total (m²)']);
    for (const pav of ordenarPavimentos(proj, [...par.porPav.keys()])) {
      const v = par.porPav.get(pav);
      linhas.push([pav, rd(v.interna), rd(v.externa), rd(v.interna + v.externa)]);
    }
    linhas.push(['Total', rd(par.interna), rd(par.externa), rd(par.interna + par.externa)]);
  }

  const ws = XLSX.utils.aoa_to_sheet(linhas);
  ws['!cols'] = [{ wch: 18 }, { wch: 26 }, ...Array(11).fill({ wch: 13 })];
  return ws;
}

function abaOrcamento(proj) {
  const linhas = [['Serviço', 'Un', 'Fonte da quantidade', 'Quant.', 'Preço unit. (R$)', 'Total (R$)']];
  const dados = proj.catalogo.map(s => ({
    s, qtd: quantidadeServico(proj, s), preco: num(s.preco) ?? 0,
  })).sort((a, b) => b.qtd * b.preco - a.qtd * a.preco);

  // Fórmulas precisam vir acompanhadas do valor calculado (o SheetJS
  // descarta células com 'f' sem 'v')
  let custo = 0;
  dados.forEach((d, i) => {
    const lin = i + 2; // linha na planilha (1-based, após cabeçalho)
    const total = d.qtd * d.preco;
    custo += total;
    linhas.push([d.s.nome, d.s.un, FONTES[d.s.fonte] || d.s.fonte, rd(d.qtd), rd(d.preco),
      { f: `D${lin}*E${lin}`, t: 'n', v: rd(total) }]);
  });
  const primeira = 2, ultima = dados.length + 1;
  const lCusto = ultima + 1, lBdi = ultima + 2;
  const bdi = num(proj.bdi) ?? 0;
  linhas.push(['Custo direto', null, null, null, null,
    { f: `SUM(F${primeira}:F${ultima})`, t: 'n', v: rd(custo) }]);
  linhas.push(['BDI (%)', null, null, null, rd(bdi),
    { f: `F${lCusto}*E${lBdi}/100`, t: 'n', v: rd(custo * bdi / 100) }]);
  linhas.push(['Total com BDI', null, null, null, null,
    { f: `F${lCusto}+F${lBdi}`, t: 'n', v: rd(custo * (1 + bdi / 100)) }]);

  const ws = XLSX.utils.aoa_to_sheet(linhas);
  ws['!cols'] = [{ wch: 32 }, { wch: 6 }, { wch: 22 }, { wch: 12 }, { wch: 14 }, { wch: 14 }];
  return ws;
}

function abaAvanco(proj) {
  const linhas = [['Pavimento', 'Ambiente', 'Área (m²)', 'Avanço (%)']];
  const porPav = ambientesPorPavimento(proj);
  for (const pav of ordenarPavimentos(proj, [...porPav.keys()])) {
    for (const a of porPav.get(pav)) {
      linhas.push([pav, a.nome, rd(num(a.area)), rd(num(a.avanco) ?? 0, 0)]);
    }
  }
  linhas.push([]);
  linhas.push(['Avanço global (ponderado pela área)', null, null, rd(avancoGlobal(proj), 1)]);
  linhas.push([]);
  linhas.push(['Histórico (curva S real)']);
  linhas.push(['Data', 'Avanço (%)']);
  for (const s of proj.snapshots || []) linhas.push([s.data, s.avanco]);

  const ws = XLSX.utils.aoa_to_sheet(linhas);
  ws['!cols'] = [{ wch: 30 }, { wch: 26 }, { wch: 12 }, { wch: 12 }];
  return ws;
}

function abaInstalacoes(proj) {
  const chaves = Object.keys(ITENS_INSTALACAO);
  const linhas = [['CONTAGENS NAS PRANCHAS (pela legenda da planta — IA e manuais)']];
  linhas.push(['Pavimento', 'Disciplina', 'Item', 'Quantidade']);
  let temContagem = false;
  for (const p of proj.pranchas) {
    for (const m of p.medicoes) {
      if (m.tipo !== 'contagem') continue;
      temContagem = true;
      linhas.push([m.pavimento || p.pavimento, p.disciplina, m.nome, m.pontos.length]);
    }
  }
  if (!temContagem) {
    linhas.push(['(nenhuma contagem ainda — use a IA na prancha de Elétrica/Hidráulica ou a ferramenta Contagem)']);
  }

  linhas.push([]);
  linhas.push(['ESTIMATIVA PARAMÉTRICA (pelos ambientes levantados)']);
  linhas.push(['Pavimento', 'Ambiente', 'Tipo', ...Object.values(ITENS_INSTALACAO), 'Qtd.']);
  const porPav = ambientesPorPavimento(proj);
  for (const pav of ordenarPavimentos(proj, [...porPav.keys()])) {
    for (const a of porPav.get(pav)) {
      const tipo = classificarAmbiente(a);
      const q = regrasAmbiente(a, tipo);
      linhas.push([pav, a.nome, TIPOS_AMBIENTE[tipo],
        ...chaves.map(k => q[k] || null), num(a.qtd) ?? 1]);
    }
  }
  const tot = totaisInstalacoes(proj);
  linhas.push(['Total', null, null, ...chaves.map(k => tot[k] || null), null]);

  linhas.push([]);
  linhas.push(['REVESTIMENTOS POR TIPO DE ÁREA']);
  const rev = totaisRevestimento(proj);
  linhas.push(['Piso — áreas molhadas (cerâmica)', 'm²', rd(rev.pisoMolhado)]);
  linhas.push(['Piso — áreas secas', 'm²', rd(rev.pisoSeco)]);
  linhas.push(['Parede — áreas molhadas (azulejo)', 'm²', rd(rev.paredeMolhada)]);
  linhas.push(['Parede — áreas secas (pintura)', 'm²', rd(rev.paredeSeca)]);

  const ws = XLSX.utils.aoa_to_sheet(linhas);
  ws['!cols'] = [{ wch: 30 }, { wch: 24 }, { wch: 16 }, ...Array(chaves.length).fill({ wch: 12 })];
  return ws;
}

export function exportarXLSX() {
  const proj = state.projeto;
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, abaQuantitativos(proj), 'Quantitativos');
  XLSX.utils.book_append_sheet(wb, abaOrcamento(proj), 'Orçamento');
  XLSX.utils.book_append_sheet(wb, abaInstalacoes(proj), 'Instalações');
  XLSX.utils.book_append_sheet(wb, abaAvanco(proj), 'Avanço');
  XLSX.writeFile(wb, `${proj.nome.toLowerCase().replace(/\s+/g, '-')}-levantamento.xlsx`);
}
