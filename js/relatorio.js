// Relatório PDF — capa, resumo, quantitativos, orçamento (curva ABC),
// avanço físico e curva S. Usa jsPDF + autotable (vendor, globais).

import { state, ordenarPavimentos } from './store.js';
import { calcAmbiente, fmt, num } from './calc.js';
import { FONTES, quantidadeServico } from './orcamento.js';
import { avancoGlobal } from './avanco.js';

const LARANJA = [234, 88, 12];
const AZUL = [59, 130, 246];
const CINZA = [90, 90, 96];
const dataBR = (d = new Date()) => d.toLocaleDateString('pt-BR');

function porPavimento(proj) {
  const m = new Map();
  for (const p of proj.pranchas) {
    if (!m.has(p.pavimento)) m.set(p.pavimento, []);
    m.get(p.pavimento).push(...p.ambientes);
  }
  return ordenarPavimentos(proj, [...m.keys()]).map(pav => [pav, m.get(pav)]);
}

function linhasOrc(proj) {
  const dados = proj.catalogo.map(s => {
    const qtd = quantidadeServico(proj, s);
    const preco = num(s.preco) ?? 0;
    return { s, qtd, preco, total: qtd * preco };
  }).sort((a, b) => b.total - a.total);
  const custo = dados.reduce((soma, d) => soma + d.total, 0);
  let acum = 0;
  for (const d of dados) {
    d.pct = custo > 0 ? d.total / custo * 100 : 0;
    acum += d.pct;
    d.classe = d.total === 0 ? '—' : acum <= 80 ? 'A' : acum <= 95 ? 'B' : 'C';
  }
  return { dados, custo };
}

// Curva S em SVG com cores claras (para o PDF), rasterizada em PNG
async function curvaSImagem(proj) {
  const snaps = proj.snapshots || [];
  const temPlano = proj.dataInicio && proj.dataFim && proj.dataFim > proj.dataInicio;
  if (!temPlano && snaps.length < 2) return null;

  const W = 720, H = 260, x0 = 42, x1 = W - 92, y0 = H - 32, y1 = 16;
  let t0 = temPlano ? new Date(proj.dataInicio) : new Date(snaps[0].data);
  let t1 = temPlano ? new Date(proj.dataFim) : new Date(snaps[snaps.length - 1].data);
  if (+t1 <= +t0) t1 = new Date(+t0 + 86400000);
  const X = (d) => x0 + (x1 - x0) * Math.min(1, Math.max(0, (d - t0) / (t1 - t0)));
  const Y = (v) => y0 - (y0 - y1) * (v / 100);
  const dBR = (d) => d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' });

  let s = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">`;
  s += `<rect width="${W}" height="${H}" fill="#ffffff"/>`;
  for (const v of [0, 25, 50, 75, 100]) {
    s += `<line x1="${x0}" y1="${Y(v)}" x2="${x1}" y2="${Y(v)}" stroke="#dddddd" stroke-width="1"/>`;
    s += `<text x="${x0 - 6}" y="${Y(v) + 4}" font-size="11" fill="#666" text-anchor="end" font-family="Helvetica">${v}</text>`;
  }
  for (const [d, anc] of [[t0, 'start'], [new Date((+t0 + +t1) / 2), 'middle'], [t1, 'end']]) {
    s += `<text x="${X(d)}" y="${H - 8}" font-size="11" fill="#666" text-anchor="${anc}" font-family="Helvetica">${dBR(d)}</text>`;
  }
  if (temPlano) {
    const pts = [];
    for (let i = 0; i <= 40; i++) {
      const t = i / 40;
      pts.push(`${X(new Date(+t0 + t * (t1 - t0))).toFixed(1)},${Y((3 * t * t - 2 * t * t * t) * 100).toFixed(1)}`);
    }
    s += `<polyline points="${pts.join(' ')}" fill="none" stroke="rgb(${AZUL})" stroke-width="2"/>`;
    s += `<circle cx="${x1 + 8}" cy="${Y(100)}" r="4" fill="rgb(${AZUL})"/>`;
    s += `<text x="${x1 + 15}" y="${Y(100) + 4}" font-size="12" font-weight="bold" fill="#333" font-family="Helvetica">Planejado</text>`;
  }
  if (snaps.length) {
    const pts = snaps.map(sn => `${X(new Date(sn.data)).toFixed(1)},${Y(sn.avanco).toFixed(1)}`);
    if (snaps.length > 1) s += `<polyline points="${pts.join(' ')}" fill="none" stroke="rgb(${LARANJA})" stroke-width="2"/>`;
    for (const sn of snaps) {
      s += `<circle cx="${X(new Date(sn.data)).toFixed(1)}" cy="${Y(sn.avanco).toFixed(1)}" r="4" fill="rgb(${LARANJA})" stroke="#fff" stroke-width="2"/>`;
    }
    const ult = snaps[snaps.length - 1];
    s += `<text x="${X(new Date(ult.data)) + 10}" y="${Y(ult.avanco) + 4}" font-size="12" font-weight="bold" fill="#333" font-family="Helvetica">Real ${fmt(ult.avanco, 1)}%</text>`;
  }
  s += '</svg>';

  const img = new Image();
  const url = URL.createObjectURL(new Blob([s], { type: 'image/svg+xml' }));
  await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = url; });
  const canvas = document.createElement('canvas');
  canvas.width = W * 2; canvas.height = H * 2;
  canvas.getContext('2d').drawImage(img, 0, 0, W * 2, H * 2);
  URL.revokeObjectURL(url);
  return canvas.toDataURL('image/png');
}

export async function gerarRelatorioPDF() {
  const proj = state.projeto;
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const largura = doc.internal.pageSize.getWidth();
  const { dados: orc, custo } = linhasOrc(proj);
  const bdi = num(proj.bdi) ?? 0;
  const pavs = porPavimento(proj);
  const totalAmb = pavs.reduce((n, [, ambs]) => n + ambs.length, 0);
  const areaTotal = pavs.reduce((soma, [, ambs]) =>
    soma + ambs.reduce((x, a) => x + (num(a.area) ?? 0) * (num(a.qtd) ?? 1), 0), 0);

  // ---- Capa ----
  doc.setFillColor(20, 20, 22);
  doc.rect(0, 0, largura, 70, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(24);
  doc.setFont('helvetica', 'bold');
  doc.text('Relatório de Levantamento de Obra', 14, 30);
  doc.setFontSize(15);
  doc.setTextColor(...LARANJA);
  doc.text(proj.nome, 14, 42);
  doc.setFontSize(10);
  doc.setTextColor(200, 200, 200);
  doc.setFont('helvetica', 'normal');
  doc.text(`Emitido em ${dataBR()} — Levantamento de Obra (app)`, 14, 52);

  doc.setTextColor(40, 40, 40);
  doc.setFontSize(13);
  doc.setFont('helvetica', 'bold');
  doc.text('Resumo executivo', 14, 84);
  doc.autoTable({
    startY: 88,
    theme: 'plain',
    styles: { fontSize: 10, cellPadding: 1.6 },
    body: [
      ['Pranchas', String(proj.pranchas.length), 'Ambientes', String(totalAmb)],
      ['Área total levantada', `${fmt(areaTotal)} m²`, 'Avanço físico global', `${fmt(avancoGlobal(proj), 1)}%`],
      ['Custo direto', `R$ ${fmt(custo)}`, `Total com BDI (${fmt(bdi, 1)}%)`, `R$ ${fmt(custo * (1 + bdi / 100))}`],
      ['Início planejado', proj.dataInicio ? dataBR(new Date(proj.dataInicio + 'T12:00:00')) : '—',
        'Término planejado', proj.dataFim ? dataBR(new Date(proj.dataFim + 'T12:00:00')) : '—'],
    ],
    columnStyles: { 0: { fontStyle: 'bold' }, 2: { fontStyle: 'bold' } },
  });

  // ---- Quantitativos ----
  doc.addPage();
  doc.setFontSize(13);
  doc.setFont('helvetica', 'bold');
  doc.text('Quantitativos por pavimento', 14, 16);
  let y = 20;
  for (const [pav, ambs] of pavs) {
    if (!ambs.length) continue;
    const corpo = ambs.map(a => {
      const c = calcAmbiente(a);
      return [a.nome, fmt(c.area), fmt(num(a.perimetro)), fmt(num(a.pdAcab) ?? num(a.pdOsso)),
        fmt(c.paredeBruta), fmt(c.descVaos), fmt(c.paredeLiq), c.qtd ?? 1];
    });
    doc.autoTable({
      startY: y,
      head: [[{ content: pav, colSpan: 8, styles: { fillColor: LARANJA, textColor: 255 } }],
        ['Ambiente', 'Área (m²)', 'Perím. (m)', 'PD (m)', 'Par. bruta', 'Desc. vãos', 'Par. líq.', 'Qtd.']],
      body: corpo,
      styles: { fontSize: 8.5, cellPadding: 1.4 },
      headStyles: { fillColor: [45, 45, 50] },
      columnStyles: { 0: { cellWidth: 52 } },
    });
    y = doc.lastAutoTable.finalY + 6;
  }

  // ---- Orçamento ----
  doc.addPage();
  doc.setFontSize(13);
  doc.text('Orçamento sintético — curva ABC', 14, 16);
  doc.autoTable({
    startY: 20,
    head: [['Serviço', 'Un', 'Fonte', 'Quant.', 'Preço unit.', 'Total (R$)', '%', 'ABC']],
    body: orc.map(d => [d.s.nome, d.s.un, FONTES[d.s.fonte] || d.s.fonte, fmt(d.qtd),
      fmt(d.preco), fmt(d.total), fmt(d.pct, 1), d.classe]),
    foot: [
      ['Custo direto', '', '', '', '', fmt(custo), '', ''],
      [`BDI (${fmt(bdi, 1)}%)`, '', '', '', '', fmt(custo * bdi / 100), '', ''],
      ['Total com BDI', '', '', '', '', fmt(custo * (1 + bdi / 100)), '', ''],
    ],
    styles: { fontSize: 8.5, cellPadding: 1.4 },
    headStyles: { fillColor: [45, 45, 50] },
    footStyles: { fillColor: [240, 240, 240], textColor: [40, 40, 40], fontStyle: 'bold' },
  });

  // ---- Avanço + curva S ----
  doc.addPage();
  doc.setFontSize(13);
  doc.text('Avanço físico', 14, 16);
  doc.autoTable({
    startY: 20,
    head: [['Pavimento', 'Ambiente', 'Área (m²)', 'Avanço (%)']],
    body: pavs.flatMap(([pav, ambs]) => ambs.map(a => [pav, a.nome, fmt(num(a.area)), fmt(num(a.avanco) ?? 0, 0)])),
    styles: { fontSize: 8.5, cellPadding: 1.4 },
    headStyles: { fillColor: [45, 45, 50] },
  });
  // Pendências abertas
  const pendencias = proj.pranchas.flatMap(p =>
    (p.pendencias || []).filter(x => x.status === 'aberta')
      .map(x => [p.pavimento, x.titulo, x.responsavel || '—',
        x.prazo ? new Date(x.prazo + 'T12:00:00').toLocaleDateString('pt-BR') : '—']));
  if (pendencias.length) {
    doc.autoTable({
      startY: doc.lastAutoTable.finalY + 8,
      head: [[{ content: `Pendências abertas (${pendencias.length})`, colSpan: 4, styles: { fillColor: [239, 68, 68], textColor: 255 } }],
        ['Pavimento', 'Pendência', 'Responsável', 'Prazo']],
      body: pendencias,
      styles: { fontSize: 8.5, cellPadding: 1.4 },
      headStyles: { fillColor: [45, 45, 50] },
    });
  }

  const imagem = await curvaSImagem(proj).catch(() => null);
  if (imagem) {
    const yImg = doc.lastAutoTable.finalY + 8;
    doc.setFontSize(11);
    doc.text('Curva S — planejado × real', 14, yImg);
    doc.addImage(imagem, 'PNG', 14, yImg + 3, 180, 65);
  }

  // Rodapé com paginação
  const paginas = doc.getNumberOfPages();
  for (let i = 1; i <= paginas; i++) {
    doc.setPage(i);
    doc.setFontSize(8);
    doc.setTextColor(...CINZA);
    doc.text(`${proj.nome} — ${dataBR()}`, 14, 290);
    doc.text(`${i} / ${paginas}`, largura - 14, 290, { align: 'right' });
  }

  doc.save(`relatorio-${proj.nome.toLowerCase().replace(/\s+/g, '-')}.pdf`);
}
