// RDO — Relatório Diário de Obra: clima, efetivo e atividades por dia,
// com exportação individual em PDF (jsPDF global)

import { state, uid, salvar } from './store.js';
import { fmt, num } from './calc.js';
import { avancoGlobal } from './avanco.js';

const scroll = document.getElementById('rdo-scroll');
const CLIMAS = { bom: '☀️ Bom', parcial: '⛅ Parcial', chuva: '🌧️ Chuva' };
const dataBR = (iso) => new Date(iso + 'T12:00:00').toLocaleDateString('pt-BR');

export function novoRDO() {
  const hoje = new Date().toISOString().slice(0, 10);
  if (state.projeto.rdos.some(r => r.data === hoje)) {
    alert('Já existe um RDO de hoje — edite-o na lista.');
    return;
  }
  state.projeto.rdos.push({
    id: uid(), data: hoje, clima: 'bom', efetivo: '',
    atividades: '', observacoes: '',
    avanco: +avancoGlobal(state.projeto).toFixed(1),
  });
  salvar();
  renderRDO();
}

function campo(rotulo, el) {
  const wrap = document.createElement('div');
  const lab = document.createElement('label');
  lab.className = 'campo-label';
  lab.textContent = rotulo;
  wrap.appendChild(lab);
  wrap.appendChild(el);
  return wrap;
}

export function renderRDO() {
  const proj = state.projeto;
  if (!scroll || !proj) return;
  scroll.innerHTML = '';
  if (!proj.rdos.length) {
    scroll.innerHTML = '<p class="dica" style="padding:20px">Nenhum di&aacute;rio ainda — clique em "+ RDO de hoje" para registrar o primeiro dia.</p>';
    return;
  }

  const ordenados = [...proj.rdos].sort((a, b) => b.data.localeCompare(a.data));
  for (const r of ordenados) {
    const card = document.createElement('div');
    card.className = 'card rdo-card';

    const topo = document.createElement('div');
    topo.className = 'card-topo';
    topo.innerHTML = `<strong>${dataBR(r.data)}</strong>&nbsp;<span class="dica" style="margin:0">avan&ccedil;o ${fmt(r.avanco, 1)}%</span>`;
    const btnPdf = document.createElement('button');
    btnPdf.className = 'btn-mini';
    btnPdf.style.marginTop = '0';
    btnPdf.textContent = 'PDF';
    btnPdf.title = 'Gerar PDF deste RDO';
    btnPdf.addEventListener('click', () => gerarRdoPDF(r));
    const del = document.createElement('button');
    del.innerHTML = '&times;';
    del.title = 'Excluir RDO';
    del.addEventListener('click', () => {
      if (!confirm(`Excluir o RDO de ${dataBR(r.data)}?`)) return;
      proj.rdos = proj.rdos.filter(x => x.id !== r.id);
      salvar(); renderRDO();
    });
    topo.appendChild(btnPdf);
    topo.appendChild(del);
    card.appendChild(topo);

    const grade = document.createElement('div');
    grade.className = 'rdo-grade';

    const selClima = document.createElement('select');
    for (const [v, rot] of Object.entries(CLIMAS)) selClima.appendChild(new Option(rot, v, false, r.clima === v));
    selClima.addEventListener('change', () => { r.clima = selClima.value; salvar(); });
    grade.appendChild(campo('Clima', selClima));

    const inpEfetivo = document.createElement('input');
    inpEfetivo.inputMode = 'numeric';
    inpEfetivo.placeholder = 'nº de pessoas';
    inpEfetivo.value = r.efetivo ?? '';
    inpEfetivo.addEventListener('change', () => { r.efetivo = inpEfetivo.value.trim(); salvar(); });
    grade.appendChild(campo('Efetivo', inpEfetivo));
    card.appendChild(grade);

    const txtAtiv = document.createElement('textarea');
    txtAtiv.rows = 3;
    txtAtiv.placeholder = 'Serviços executados no dia (um por linha)…';
    txtAtiv.value = r.atividades || '';
    txtAtiv.addEventListener('change', () => { r.atividades = txtAtiv.value; salvar(); });
    card.appendChild(campo('Atividades do dia', txtAtiv));

    const txtObs = document.createElement('textarea');
    txtObs.rows = 2;
    txtObs.placeholder = 'Ocorrências, visitas, paralisações…';
    txtObs.value = r.observacoes || '';
    txtObs.addEventListener('change', () => { r.observacoes = txtObs.value; salvar(); });
    card.appendChild(campo('Observações', txtObs));

    scroll.appendChild(card);
  }
}

export function gerarRdoPDF(r) {
  const proj = state.projeto;
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const largura = doc.internal.pageSize.getWidth();

  doc.setFillColor(20, 20, 22);
  doc.rect(0, 0, largura, 34, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.text('RDO — Relatório Diário de Obra', 14, 15);
  doc.setFontSize(11);
  doc.setTextColor(234, 88, 12);
  doc.text(`${proj.nome} — ${dataBR(r.data)}`, 14, 25);

  doc.setTextColor(40, 40, 40);
  doc.autoTable({
    startY: 42,
    theme: 'plain',
    styles: { fontSize: 10, cellPadding: 1.6 },
    body: [
      ['Clima', CLIMAS[r.clima] ? CLIMAS[r.clima].replace(/^\S+\s/, '') : r.clima,
        'Efetivo', r.efetivo ? `${r.efetivo} pessoa(s)` : '—'],
      ['Avanço físico global', `${fmt(num(r.avanco), 1)}%`, '', ''],
    ],
    columnStyles: { 0: { fontStyle: 'bold' }, 2: { fontStyle: 'bold' } },
  });

  let y = doc.lastAutoTable.finalY + 8;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.text('Atividades do dia', 14, y);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  const ativ = doc.splitTextToSize(r.atividades || '—', largura - 28);
  doc.text(ativ, 14, y + 6);
  y += 6 + ativ.length * 4.6 + 8;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.text('Observações', 14, y);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.text(doc.splitTextToSize(r.observacoes || '—', largura - 28), 14, y + 6);

  doc.setFontSize(8);
  doc.setTextColor(90, 90, 96);
  doc.text('Gerado pelo app Levantamento de Obra', 14, 290);
  doc.text('Assinatura do responsável: ______________________________', largura - 14, 290, { align: 'right' });

  doc.save(`rdo-${r.data}-${proj.nome.toLowerCase().replace(/\s+/g, '-')}.pdf`);
}
