// Instalações complementares — quantificação paramétrica por ambiente
// (elétrica, hidrossanitária e revestimentos por tipo de área).
// Regras simplificadas inspiradas na prática usual/NBR 5410; a classificação
// de cada ambiente pode ser ajustada na própria tabela (fica salva no projeto).

import { state, salvar, uid, ordenarPavimentos, ambientesPorPavimento } from './store.js';
import { calcAmbiente, fmt, num } from './calc.js';

const scroll = document.getElementById('inst-scroll');

export const TIPOS_AMBIENTE = {
  banheiro: 'Banheiro/WC',
  cozinha: 'Cozinha/Copa',
  servico: 'Área de serviço',
  dormitorio: 'Dormitório',
  sala: 'Sala/Estar',
  circulacao: 'Circulação',
  externa: 'Externa/Garagem',
  outro: 'Outro',
};

const CLASSIFICACAO = [
  ['banheiro', /BANH|W\.?C|LAVABO|SANIT/],
  ['cozinha', /COZ|COPA/],
  ['servico', /SERVI|LAVAND/],
  ['dormitorio', /QUARTO|DORM|SU[IÍ]TE/],
  ['sala', /SALA|ESTAR|JANTAR|HOME|ESCRIT/],
  ['circulacao', /CIRCUL|CORREDOR|HALL|ESCADA/],
  ['externa', /VARANDA|SACADA|TERRA[CÇ]O|GARAG|QUINTAL|EXTERN|CHURRASQ/],
];

export function classificarAmbiente(a) {
  if (a.tipoInst && TIPOS_AMBIENTE[a.tipoInst]) return a.tipoInst;
  const n = (a.nome || '').toUpperCase();
  for (const [tipo, re] of CLASSIFICACAO) if (re.test(n)) return tipo;
  return 'outro';
}

export const ITENS_INSTALACAO = {
  pontoLuz: 'Ponto de luz',
  interruptor: 'Interruptor',
  tomada: 'Tomada comum',
  tomadaEspecial: 'Tomada uso específico',
  aguaFria: 'Ponto de água fria',
  aguaQuente: 'Ponto de água quente',
  esgoto: 'Ponto de esgoto',
  ralo: 'Ralo',
  vaso: 'Vaso sanitário',
  lavatorio: 'Lavatório',
  chuveiro: 'Chuveiro',
  pia: 'Pia de cozinha',
  tanque: 'Tanque',
};

// Preços de referência para o orçamento (o usuário edita)
const PRECOS_REF = {
  pontoLuz: 90, interruptor: 45, tomada: 65, tomadaEspecial: 95,
  aguaFria: 130, aguaQuente: 160, esgoto: 120, ralo: 60,
  vaso: 380, lavatorio: 300, chuveiro: 130, pia: 320, tanque: 260,
};

// Quantidades por UNIDADE de ambiente, segundo o tipo.
// Sem perímetro medido, estima-se pelo quadrado equivalente (4·√área).
export function regrasAmbiente(a, tipo) {
  const area = num(a.area) ?? 0;
  const per = num(a.perimetro) ?? (area > 0 ? 4 * Math.sqrt(area) : 0);
  const q = {};
  for (const k of Object.keys(ITENS_INSTALACAO)) q[k] = 0;
  if (area <= 0 && per <= 0) return q;

  q.pontoLuz = Math.max(1, Math.ceil(area / 20));
  q.interruptor = 1;

  switch (tipo) {
    case 'sala':
    case 'dormitorio':
      q.tomada = Math.max(1, Math.ceil(per / 5));
      break;
    case 'cozinha':
      q.tomada = Math.max(2, Math.ceil(per / 3.5));
      q.tomadaEspecial = 1;
      q.aguaFria = 1; q.esgoto = 2; q.pia = 1;
      break;
    case 'servico':
      q.tomada = Math.max(1, Math.ceil(per / 3.5));
      q.tomadaEspecial = 1;
      q.aguaFria = 2; q.esgoto = 2; q.ralo = 1; q.tanque = 1;
      break;
    case 'banheiro':
      q.tomada = 1; q.tomadaEspecial = 1;      // chuveiro elétrico
      q.aguaFria = 3; q.aguaQuente = 1; q.esgoto = 3; q.ralo = 1;
      q.vaso = 1; q.lavatorio = 1; q.chuveiro = 1;
      break;
    case 'circulacao':
      q.tomada = area >= 2.25 ? 1 : 0;
      break;
    case 'externa':
      q.tomada = 1; q.aguaFria = 1; q.ralo = 1;
      break;
    default:
      q.tomada = Math.max(1, Math.ceil(per / 5));
  }
  return q;
}

// Totais do projeto { chaveItem: quantidade } (multiplicados pela Qtd. do ambiente)
export function totaisInstalacoes(proj) {
  const tot = {};
  for (const k of Object.keys(ITENS_INSTALACAO)) tot[k] = 0;
  for (const p of proj.pranchas) {
    for (const a of p.ambientes) {
      const q = regrasAmbiente(a, classificarAmbiente(a));
      const mult = num(a.qtd) ?? 1;
      for (const k of Object.keys(q)) tot[k] += q[k] * mult;
    }
  }
  return tot;
}

const MOLHADAS = new Set(['banheiro', 'cozinha', 'servico']);

// Piso e parede separados em áreas molhadas (cerâmica/azulejo) e secas (pintura)
export function totaisRevestimento(proj) {
  const t = { pisoMolhado: 0, pisoSeco: 0, paredeMolhada: 0, paredeSeca: 0 };
  for (const p of proj.pranchas) {
    for (const a of p.ambientes) {
      const c = calcAmbiente(a);
      const mult = c.qtd ?? 1;
      const molhada = MOLHADAS.has(classificarAmbiente(a));
      if (c.area !== null) t[molhada ? 'pisoMolhado' : 'pisoSeco'] += c.area * mult;
      if (c.paredeLiq !== null) t[molhada ? 'paredeMolhada' : 'paredeSeca'] += c.paredeLiq * mult;
    }
  }
  return t;
}

export const FONTES_REVESTIMENTO = {
  pisoMolhado: 'Piso áreas molhadas (m²)',
  pisoSeco: 'Piso áreas secas (m²)',
  paredeMolhada: 'Parede áreas molhadas (m²)',
  paredeSeca: 'Parede áreas secas (m²)',
};

// Cria no orçamento os serviços de instalações/revestimentos que faltarem
export function enviarParaOrcamento() {
  const cat = state.projeto.catalogo;
  const sugestoes = [
    ...Object.entries(ITENS_INSTALACAO).map(([k, nome]) => ({
      nome, un: 'un', fonte: 'inst:' + k, preco: PRECOS_REF[k] ?? 0,
    })),
    { nome: 'Azulejo/cerâmica de parede — áreas molhadas', un: 'm²', fonte: 'paredeMolhada', preco: 70 },
    { nome: 'Pintura de parede — áreas secas', un: 'm²', fonte: 'paredeSeca', preco: 38 },
    { nome: 'Piso cerâmico — áreas molhadas', un: 'm²', fonte: 'pisoMolhado', preco: 80 },
  ];
  let novos = 0;
  for (const s of sugestoes) {
    const jaTem = cat.some(x => x.fonte === s.fonte ||
      x.nome.toLowerCase() === s.nome.toLowerCase());
    if (jaTem) continue;
    cat.push({ id: uid(), qtdManual: 0, ...s });
    novos++;
  }
  if (novos) salvar();
  return novos;
}

/* ---------- Vista Instalações ---------- */

const celTexto = (t, cls) => {
  const td = document.createElement('td');
  td.textContent = t ?? '';
  if (cls) td.className = cls;
  return td;
};

export function renderInstalacoes() {
  const proj = state.projeto;
  if (!scroll || !proj) return;
  scroll.innerHTML = '';

  if (!proj.pranchas.some(p => p.ambientes.length)) {
    const p = document.createElement('p');
    p.className = 'dica';
    p.style.padding = '20px';
    p.textContent = 'Nenhum ambiente levantado ainda — importe pranchas e analise a planta primeiro.';
    scroll.appendChild(p);
    return;
  }

  const chaves = Object.keys(ITENS_INSTALACAO);
  const tabela = document.createElement('table');
  tabela.className = 'quant';
  const thead = document.createElement('thead');
  const trh = document.createElement('tr');
  for (const c of ['Ambiente', 'Tipo', ...Object.values(ITENS_INSTALACAO), 'Qtd.']) {
    trh.appendChild(Object.assign(document.createElement('th'), { textContent: c }));
  }
  thead.appendChild(trh);
  tabela.appendChild(thead);
  const tbody = document.createElement('tbody');

  const porPav = ambientesPorPavimento(proj);

  for (const pavimento of ordenarPavimentos(proj, [...porPav.keys()])) {
    const ambientes = porPav.get(pavimento);
    if (!ambientes.length) continue;
    const trg = document.createElement('tr');
    trg.className = 'grupo';
    const tdg = document.createElement('td');
    tdg.colSpan = chaves.length + 3;
    tdg.textContent = pavimento;
    trg.appendChild(tdg);
    tbody.appendChild(trg);

    for (const a of ambientes) {
      const tipo = classificarAmbiente(a);
      const q = regrasAmbiente(a, tipo);
      const tr = document.createElement('tr');
      const tdNome = celTexto(a.nome);
      tdNome.style.textAlign = 'left';
      tr.appendChild(tdNome);

      const tdTipo = document.createElement('td');
      const sel = document.createElement('select');
      for (const [val, rot] of Object.entries(TIPOS_AMBIENTE)) {
        sel.appendChild(new Option(rot, val, false, tipo === val));
      }
      sel.addEventListener('change', () => {
        a.tipoInst = sel.value;
        salvar(); renderInstalacoes();
      });
      tdTipo.appendChild(sel);
      tr.appendChild(tdTipo);

      for (const k of chaves) tr.appendChild(celTexto(q[k] || ''));
      tr.appendChild(celTexto(num(a.qtd) ?? 1));
      tbody.appendChild(tr);
    }
  }

  const tot = totaisInstalacoes(proj);
  const trt = document.createElement('tr');
  trt.className = 'total';
  const tdT = celTexto('Total');
  tdT.colSpan = 2;
  trt.appendChild(tdT);
  for (const k of chaves) trt.appendChild(celTexto(tot[k] || ''));
  trt.appendChild(celTexto(''));
  tbody.appendChild(trt);

  tabela.appendChild(tbody);
  scroll.appendChild(tabela);

  // Revestimentos por tipo de área
  const h = document.createElement('h3');
  h.className = 'tabela-sub';
  h.textContent = 'Revestimentos por tipo de área';
  scroll.appendChild(h);

  const rev = totaisRevestimento(proj);
  const t2 = document.createElement('table');
  t2.className = 'quant';
  t2.style.minWidth = '0';
  t2.style.maxWidth = '560px';
  const tb2 = document.createElement('tbody');
  const linhasRev = [
    ['Piso — áreas molhadas (cerâmica)', rev.pisoMolhado],
    ['Piso — áreas secas', rev.pisoSeco],
    ['Parede — áreas molhadas (azulejo)', rev.paredeMolhada],
    ['Parede — áreas secas (pintura)', rev.paredeSeca],
  ];
  for (const [rot, val] of linhasRev) {
    const tr = document.createElement('tr');
    const td1 = celTexto(rot);
    td1.style.textAlign = 'left';
    tr.appendChild(td1);
    tr.appendChild(celTexto(`${fmt(val)} m²`));
    tb2.appendChild(tr);
  }
  t2.appendChild(tb2);
  scroll.appendChild(t2);

  const dica = document.createElement('p');
  dica.className = 'dica';
  dica.style.margin = '14px 2px';
  dica.textContent = 'Estimativa paramétrica pelas regras usuais (banheiro: 3 pontos de água fria, vaso, lavatório, chuveiro; tomadas pelo perímetro conforme o tipo; etc.). Corrija o Tipo de cada ambiente se a classificação pelo nome errar — a escolha fica salva. Molhadas = banheiro, cozinha e área de serviço. Sem perímetro medido, ele é estimado pela área.';
  scroll.appendChild(dica);
}
