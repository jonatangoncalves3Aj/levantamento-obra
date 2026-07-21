// Levantamento de Obra — módulo principal (abas, importação, ferramentas, cards)

import {
  state, uid, novoProjeto, novaPrancha, novoAmbiente,
  pranchaAtual, ambienteSel, salvar, carregarProjeto, aoSalvar,
  salvarPdf, limparPdfsOrfaos, iniciarHistorico, desfazer, refazer,
  listarProjetos, lerProjeto, excluirProjeto, idsPranchasTodosProjetos,
  exportarProjetoJSON, importarProjetoJSON,
} from './store.js';
import { renderOrcamento, adicionarServico, exportarOrcamentoCSV, importarPrecosCSV } from './orcamento.js';
import { renderAvanco, registrarSnapshot } from './avanco.js';
import { renderRDO, novoRDO } from './rdo.js';
import { exportarXLSX } from './exportar-xlsx.js';
import { gerarRelatorioPDF } from './relatorio.js';
import * as nuvem from './nuvem.js';
import {
  renderizar, ajustar, pontoDoEvento, desenharOverlay,
  obterPagina, esquecerPagina, contarPaginas,
} from './viewer.js';
import { analisarPlanta, detectarEscalaCarimbo } from './deteccao.js';
import {
  analisarComIA, analisarSimbolosIA, disciplinaTemSimbolos,
  iaConfigurada, lerChaveIA, salvarChaveIA,
  MODELOS_IA, lerModeloIA, salvarModeloIA, nomeModeloIA,
} from './ia.js';
import { renderInstalacoes, enviarParaOrcamento } from './instalacoes.js';
import { renderTabela, exportarCSV } from './tabela.js';
import { fmt, num, dist, comprimentoPolilinha, perimetroPoligono, areaPoligono, pxPorMetroDeEscala } from './calc.js';

const $ = (id) => document.getElementById(id);
const overlay = $('overlay');

/* =============== Inicialização =============== */

state.projeto = carregarProjeto() || novoProjeto();
salvar();
if (state.projeto.pranchas.length) state.pranchaAtualId = state.projeto.pranchas[0].id;
iniciarHistorico();
limparPdfsOrfaos(idsPranchasTodosProjetos()).catch(() => {});

atualizarTudo();

function atualizarTudo() {
  renderProjetos();
  renderAbas();
  renderSidebar();
  renderizar().catch(err => console.error(err));
  if (state.view === 'tabela') renderTabela();
  if (state.view === 'orcamento') renderOrcamento();
  if (state.view === 'instalacoes') renderInstalacoes();
  if (state.view === 'avanco') renderAvanco();
  if (state.view === 'rdo') renderRDO();
}

/* =============== Projetos (multi-projeto + JSON) =============== */

function renderProjetos() {
  const sel = $('sel-projeto');
  sel.innerHTML = '';
  for (const { id, nome } of listarProjetos()) {
    sel.appendChild(new Option(nome, id, false, id === state.projeto.id));
  }
}

function trocarProjeto(proj) {
  state.projeto = proj;
  state.pranchaAtualId = proj.pranchas[0]?.id || null;
  state.ambienteSelId = null;
  state.sobreposicao.pranchaId = null;
  setTool(null);
  salvar();
  iniciarHistorico();
  atualizarTudo();
}

$('sel-projeto').addEventListener('change', () => {
  const proj = lerProjeto($('sel-projeto').value);
  if (proj) trocarProjeto(proj);
});

$('btn-proj-novo').addEventListener('click', () => {
  const nome = prompt('Nome do novo projeto:', 'Nova obra');
  if (!nome) return;
  trocarProjeto(novoProjeto(nome));
});

$('btn-proj-renomear').addEventListener('click', () => {
  const nome = prompt('Novo nome do projeto:', state.projeto.nome);
  if (!nome) return;
  state.projeto.nome = nome;
  salvar(); renderProjetos();
});

$('btn-proj-excluir').addEventListener('click', () => {
  if (!confirm(`Excluir o projeto "${state.projeto.nome}" e todas as suas pranchas?`)) return;
  excluirProjeto(state.projeto.id);
  limparPdfsOrfaos(idsPranchasTodosProjetos()).catch(() => {});
  const resto = listarProjetos();
  trocarProjeto(resto.length ? lerProjeto(resto[0].id) : novoProjeto());
});

$('btn-proj-exportar').addEventListener('click', async () => {
  const json = await exportarProjetoJSON(state.projeto);
  const blob = new Blob([json], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${state.projeto.nome.toLowerCase().replace(/\s+/g, '-')}.levantamento.json`;
  a.click();
  URL.revokeObjectURL(a.href);
});

$('btn-proj-importar').addEventListener('click', () => $('inp-json').click());
$('inp-json').addEventListener('change', async (e) => {
  const arq = e.target.files[0];
  e.target.value = '';
  if (!arq) return;
  try {
    const proj = await importarProjetoJSON(await arq.text());
    trocarProjeto(proj);
  } catch (err) {
    alert('Falha ao importar: ' + err.message);
  }
});

/* =============== Abas de pranchas =============== */

function renderAbas() {
  const nav = $('abas');
  nav.innerHTML = '';
  for (const p of state.projeto.pranchas) {
    const aba = document.createElement('button');
    aba.className = 'aba' + (p.id === state.pranchaAtualId ? ' ativa' : '');
    const rotuloAba = document.createElement('span');
    rotuloAba.textContent = p.pavimento + (p.ambientes.length ? ' · ' + p.ambientes.length : '');
    aba.append('🏠 ', rotuloAba);
    const fechar = document.createElement('button');
    fechar.className = 'fechar';
    fechar.innerHTML = '&times;';
    fechar.title = 'Fechar prancha';
    fechar.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!confirm(`Remover a prancha "${p.pavimento}" e suas medições?`)) return;
      state.projeto.pranchas = state.projeto.pranchas.filter(x => x.id !== p.id);
      esquecerPagina(p.id);
      if (state.pranchaAtualId === p.id) state.pranchaAtualId = state.projeto.pranchas[0]?.id || null;
      salvar(); atualizarTudo();
    });
    aba.appendChild(fechar);
    aba.addEventListener('click', () => {
      state.pranchaAtualId = p.id;
      state.ambienteSelId = null;
      cancelarDesenho();
      atualizarTudo();
    });
    nav.appendChild(aba);
  }
}

/* =============== Importação de pranchas =============== */

$('btn-pranchas').addEventListener('click', () => $('inp-arquivos').click());
$('btn-pranchas-vazio').addEventListener('click', () => $('inp-arquivos').click());

// Select de pavimento alimentado pela lista do projeto, com "+ Novo pavimento…"
function selPavimento(valorAtual, aoMudar) {
  const sel = document.createElement('select');
  const preencher = () => {
    sel.innerHTML = '';
    for (const p of state.projeto.pavimentos) {
      sel.appendChild(new Option(p, p, false, p === valorAtual));
    }
    sel.appendChild(new Option('+ Novo pavimento…', '__novo__'));
  };
  preencher();
  sel.addEventListener('change', () => {
    if (sel.value === '__novo__') {
      const nome = prompt('Nome do novo pavimento (ex.: 2º Pavimento, Mezanino, Ático):');
      if (!nome || !nome.trim()) { sel.value = valorAtual; return; }
      const limpo = nome.trim();
      if (!state.projeto.pavimentos.includes(limpo)) state.projeto.pavimentos.push(limpo);
      salvar();
      valorAtual = limpo;
      preencher();
      document.querySelectorAll('select[data-pavimentos]').forEach(s => {
        if (s !== sel) s.dispatchEvent(new CustomEvent('pavimentos-mudaram'));
      });
    } else {
      valorAtual = sel.value;
    }
    aoMudar(valorAtual);
  });
  sel.dataset.pavimentos = '1';
  sel.addEventListener('pavimentos-mudaram', preencher);
  return sel;
}

function chutarPavimento(nomeArq) {
  const n = nomeArq.toUpperCase();
  if (/SUB|INF|-SS/.test(n)) return 'Subsolo';
  if (/TER|-TR/.test(n)) return 'Térreo';
  if (/SUP|PAV\s*2|1º\s*ANDAR/.test(n)) return 'Superior';
  if (/COB/.test(n)) return 'Cobertura';
  return 'Térreo';
}

$('inp-arquivos').addEventListener('change', async (e) => {
  const arquivos = [...e.target.files];
  e.target.value = '';
  if (!arquivos.length) return;

  // Lê os PDFs e monta a lista do diálogo (1 linha por página)
  const pendentes = [];
  for (const arq of arquivos) {
    try {
      const buf = await arq.arrayBuffer();
      const paginas = await contarPaginas(buf);
      for (let pg = 1; pg <= paginas; pg++) {
        pendentes.push({
          buf, arquivoNome: arq.name, pagina: pg,
          rotulo: paginas > 1 ? `${arq.name} — p. ${pg}` : arq.name,
          pavimento: chutarPavimento(arq.name), disciplina: 'Arquitetura',
        });
      }
    } catch (err) {
      alert(`Não consegui ler "${arq.name}": ${err.message}`);
    }
  }
  if (!pendentes.length) return;

  const lista = $('dlg-importar-lista');
  lista.innerHTML = '';
  pendentes.forEach((pd, i) => {
    const linha = document.createElement('div');
    linha.className = 'dlg-prancha';
    const nomeArq = document.createElement('span');
    nomeArq.className = 'nome-arq';
    nomeArq.title = pd.rotulo;
    nomeArq.textContent = pd.rotulo;
    linha.appendChild(nomeArq);
    if (!state.projeto.pavimentos.includes(pd.pavimento)) pd.pavimento = state.projeto.pavimentos[0] || 'Térreo';
    const inpPav = selPavimento(pd.pavimento, v => { pd.pavimento = v; });
    const selDisc = document.createElement('select');
    for (const d of ['Arquitetura', 'Estrutura', 'Fundação', 'Hidráulica', 'Elétrica', 'Climatização']) {
      selDisc.appendChild(new Option(d, d));
    }
    selDisc.addEventListener('change', () => { pd.disciplina = selDisc.value; });
    linha.appendChild(inpPav);
    linha.appendChild(selDisc);
    lista.appendChild(linha);
  });

  const dlg = $('dlg-importar');
  dlg.showModal();
  $('dlg-importar-ok').onclick = async () => {
    dlg.close();
    for (const pd of pendentes) {
      const prancha = novaPrancha(pd.arquivoNome, pd.pagina, pd.pavimento || 'Térreo', pd.disciplina);
      await salvarPdf(prancha.id, pd.buf);
      state.projeto.pranchas.push(prancha);
      state.pranchaAtualId = prancha.id;
    }
    salvar(); atualizarTudo();
  };
  $('dlg-importar-cancelar').onclick = () => dlg.close();
});

/* =============== Passo 0 — Analisar planta =============== */

$('sel-disciplina').addEventListener('change', () => {
  const p = pranchaAtual();
  if (p) { p.disciplina = $('sel-disciplina').value; salvar(); }
});

// Incorpora ambientes achados (pela leitura de texto ou pela IA) sem duplicar
function incorporarAchados(p, achados, origem = 'planta') {
  let novos = 0, total = 0, comPd = 0;
  for (const a of achados) {
    if (a.area) total += a.area;
    if (a.pd) comPd++;
    const jaExiste = p.ambientes.some(x =>
      x.nome === a.nome &&
      (a.area == null || Math.abs((num(x.area) ?? -1) - a.area) < 0.01));
    if (jaExiste) continue;
    const amb = novoAmbiente(a.nome, a.x, a.y);
    if (a.area != null) { amb.area = a.area; amb.areaOrigem = origem; }
    if (a.pd) amb.pdAcab = a.pd;
    p.ambientes.push(amb);
    novos++;
  }
  return { novos, total, comPd };
}

$('btn-analisar').addEventListener('click', async () => {
  const p = pranchaAtual();
  if (!p) return alert('Abra uma prancha primeiro.');
  const res = $('resultado-analise');
  res.hidden = false;
  res.textContent = 'Analisando a planta…';
  try {
    const { page } = await obterPagina(p);
    const achados = await analisarPlanta(page);
    if (!achados.length) {
      res.innerHTML = 'Nenhum ambiente encontrado no texto do PDF — a planta deve ser escaneada (imagem). ';
      const btn = document.createElement('button');
      btn.className = 'btn-mini';
      btn.textContent = '🤖 Analisar com IA (visão)';
      btn.addEventListener('click', analisarPorVisao);
      res.appendChild(btn);
      return;
    }
    const { novos, total, comPd } = incorporarAchados(p, achados);
    res.innerHTML = `&check; Li <strong>${achados.length} ambiente(s)</strong> — nome, área${comPd ? ' e pé-direito' : ''} preenchidos. ` +
      `Total = <strong>${fmt(total)} m²</strong>. Confira os pins azuis, ajuste nomes e apague o que não for ambiente.` +
      (novos < achados.length ? ` (${achados.length - novos} já existiam.)` : '');
    salvar(); atualizarTudo();
  } catch (err) {
    res.textContent = 'Falha ao analisar: ' + err.message;
  }
});

/* ----- IA por visão (plantas escaneadas) ----- */

function abrirConfigIA(depois) {
  $('inp-ia-chave').value = lerChaveIA() || '';
  const sel = $('sel-ia-modelo');
  sel.innerHTML = '';
  for (const m of MODELOS_IA) sel.appendChild(new Option(m.nome, m.id));
  sel.value = lerModeloIA();
  const mostrarCusto = () => {
    const m = MODELOS_IA.find(x => x.id === sel.value);
    $('ia-modelo-custo').textContent = m ? `Preço Anthropic: ${m.custo} (entrada / saída).` : '';
  };
  sel.onchange = mostrarCusto;
  mostrarCusto();
  const dlg = $('dlg-ia');
  dlg.showModal();
  $('dlg-ia-ok').onclick = () => {
    const chave = $('inp-ia-chave').value.trim();
    salvarModeloIA(sel.value);            // o modelo pode ser trocado sozinho
    if (!chave) return;
    salvarChaveIA(chave);
    dlg.close();
    depois?.();
  };
  $('dlg-ia-cancelar').onclick = () => dlg.close();
  $('dlg-ia-remover').onclick = () => {
    salvarChaveIA(null);
    $('inp-ia-chave').value = '';
  };
}

async function analisarPorVisao() {
  const p = pranchaAtual();
  if (!p) return alert('Abra uma prancha primeiro.');
  if (!iaConfigurada()) return abrirConfigIA(analisarPorVisao);
  // Prancha de instalações: a IA conta os símbolos em vez de ler ambientes
  if (disciplinaTemSimbolos(p.disciplina)) return analisarSimbolosPorVisao(p);
  const res = $('resultado-analise');
  res.hidden = false;
  res.textContent = `🤖 Analisando a planta com ${nomeModeloIA()} — pode levar até 1 minuto…`;
  try {
    const { page, largura, altura } = await obterPagina(p);
    const achados = await analisarComIA(page, largura, altura);
    if (!achados.length) {
      res.textContent = 'A IA não identificou ambientes nesta prancha.';
      return;
    }
    const { novos, total } = incorporarAchados(p, achados, 'ia');
    const comArea = achados.filter(a => a.area != null).length;
    res.innerHTML = `🤖 A IA identificou <strong>${achados.length} ambiente(s)</strong>` +
      (comArea ? ` — ${comArea} com área anotada (total ${fmt(total)} m²)` : '') +
      '. Confira os pins, ajuste posições e nomes e apague o que não for ambiente.' +
      (novos < achados.length ? ` (${achados.length - novos} já existiam.)` : '');
    salvar(); atualizarTudo();
  } catch (err) {
    res.textContent = 'Falha na análise por IA: ' + err.message;
  }
}

// Conta símbolos (tomadas, pontos de luz, água, esgoto…) em pranchas de
// Elétrica/Hidráulica e cria uma medição de contagem por tipo, com pins.
async function analisarSimbolosPorVisao(p) {
  const res = $('resultado-analise');
  res.hidden = false;
  res.textContent = `🤖 Contando símbolos de ${p.disciplina.toLowerCase()} com ${nomeModeloIA()} — pode levar até 1 minuto…`;
  try {
    const { page, largura, altura } = await obterPagina(p);
    const { legenda, itens } = await analisarSimbolosIA(page, largura, altura, p.disciplina);
    if (!itens.length) {
      res.textContent = 'A IA não encontrou símbolos de instalação nesta prancha.';
      return;
    }
    const porTipo = new Map();
    for (const it of itens) {
      if (!porTipo.has(it.rotulo)) porTipo.set(it.rotulo, []);
      porTipo.get(it.rotulo).push({ x: it.x, y: it.y });
    }
    const resumo = [];
    for (const [rotulo, pontos] of porTipo) {
      const nome = `${rotulo} (IA)`;
      p.medicoes = p.medicoes.filter(m => m.nome !== nome); // reanálise substitui
      p.medicoes.push({ id: uid(), tipo: 'contagem', nome, pontos });
      resumo.push(`${pontos.length}× ${rotulo}`);
    }
    res.textContent = (legenda.length ? `🤖 Legenda lida (${legenda.length} itens). ` : '🤖 ') +
      `Contagem: ${resumo.join(' · ')}. Criei medições de contagem com pins na planta — confira e ajuste. ` +
      'Elas entram na Tabela (medições avulsas) e na aba Instalações do XLSX.';
    salvar(); atualizarTudo();
  } catch (err) {
    res.textContent = 'Falha na análise por IA: ' + err.message;
  }
}

$('btn-analisar-ia').addEventListener('click', analisarPorVisao);
$('lnk-ia-chave').addEventListener('click', (e) => { e.preventDefault(); abrirConfigIA(); });

$('btn-inst-xlsx').addEventListener('click', exportarXLSX);
$('btn-inst-orcamento').addEventListener('click', () => {
  const novos = enviarParaOrcamento();
  alert(novos
    ? `${novos} serviço(s) de instalações/revestimentos adicionados ao orçamento com preços de referência — edite com os seus.`
    : 'Os serviços de instalações já estão no orçamento — as quantidades se atualizam sozinhas.');
  trocarVista('orcamento');
});

/* =============== Passo 1 — Escala =============== */

function statusEscala() {
  const p = pranchaAtual();
  const elS = $('status-escala');
  if (!p || !p.escala) {
    elS.innerHTML = 'Escala <strong class="alerta">não definida</strong> — calibre sobre uma cota conhecida.';
  } else {
    const origem = p.escala.origem === 'carimbo' ? `carimbo 1:${p.escala.N}` : 'cota calibrada';
    elS.innerHTML = `Escala <strong class="ok">definida</strong> (${origem}).`;
  }
}

$('btn-carimbo').addEventListener('click', async () => {
  const p = pranchaAtual();
  if (!p) return alert('Abra uma prancha primeiro.');
  let N = null;
  try {
    const { page } = await obterPagina(p);
    N = await detectarEscalaCarimbo(page);
  } catch { /* segue para entrada manual */ }
  $('dlg-carimbo-msg').innerHTML = N
    ? `Encontrei <strong>1:${N}</strong> no carimbo. Confirme ou corrija:`
    : 'Não encontrei a escala no carimbo. Informe manualmente:';
  $('inp-carimbo').value = N || '';
  const dlg = $('dlg-carimbo');
  dlg.showModal();
  $('dlg-carimbo-ok').onclick = () => {
    const n = parseInt($('inp-carimbo').value, 10);
    if (!(n > 0)) return;
    dlg.close();
    p.escala = { pxPorMetro: pxPorMetroDeEscala(n), origem: 'carimbo', N: n };
    salvar(); statusEscala(); renderSidebar();
  };
  $('dlg-carimbo-cancelar').onclick = () => dlg.close();
});

/* =============== Ferramentas de desenho =============== */

const botoesTool = [...document.querySelectorAll('[data-tool]')];

function setTool(tool) {
  state.tool = state.tool === tool ? null : tool;
  cancelarDesenho(false);
  botoesTool.forEach(b => b.classList.toggle('ativo', b.dataset.tool === state.tool));
  overlay.classList.toggle('medindo', !!state.tool);
  desenharOverlay();
}

botoesTool.forEach(b => b.addEventListener('click', () => {
  const t = b.dataset.tool;
  const p = pranchaAtual();
  if (!p) return alert('Abra uma prancha primeiro.');
  if (['lado', 'perimetro', 'linear', 'parede'].includes(t) && !p.escala) {
    return alert('Para medir em metros, defina a escala primeiro (passo 1):\n\n' +
      '• "Calibrar escala": clique nos DOIS extremos de uma cota conhecida da planta e informe o valor real; ou\n' +
      '• "Pela escala do carimbo": informe o 1:N da prancha.');
  }
  setTool(t);
}));

function cancelarDesenho(redesenhar = true) {
  state.desenho = null;
  if (redesenhar) desenharOverlay();
}

function digitando(e) {
  return ['INPUT', 'SELECT', 'TEXTAREA'].includes(e.target.tagName) ||
    document.querySelector('dialog[open]');
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { setTool(null); return; }
  if (e.key === 'Enter' && state.desenho && !digitando(e)) { finalizarDesenho(); return; }

  // Desfazer / refazer
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !digitando(e)) {
    e.preventDefault();
    const ok = e.shiftKey ? refazer() : desfazer();
    if (ok) { setTool(null); atualizarTudo(); }
    return;
  }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y' && !digitando(e)) {
    e.preventDefault();
    if (refazer()) { setTool(null); atualizarTudo(); }
    return;
  }

  if (digitando(e) || e.ctrlKey || e.metaKey || e.altKey) return;

  // Excluir o ambiente selecionado (selecione pelo card ou pelo pin na planta)
  if (e.key === 'Delete' || e.key === 'Backspace') {
    const amb = ambienteSel();
    if (amb) { e.preventDefault(); excluirAmbiente(pranchaAtual(), amb); }
    return;
  }

  // Atalhos de uma tecla
  const atalhos = {
    '1': 'lado', '2': 'perimetro', '3': 'linear', '4': 'contagem',
    'a': 'ambiente', 'c': 'calibrar',
  };
  const k = e.key.toLowerCase();
  if (atalhos[k]) {
    document.querySelector(`[data-tool="${atalhos[k]}"]`)?.click();
  } else if (k === '+' || k === '=') setZoom(state.zoom * 1.25);
  else if (k === '-') setZoom(state.zoom / 1.25);
  else if (k === '0') { ajustar(); setZoom(state.zoom); }
  else if (k === 'n') $('btn-nomes').click();
  else if (k === 't') trocarVista(state.view === 'planta' ? 'tabela' : 'planta');
});

overlay.addEventListener('dblclick', (e) => {
  if (state.desenho && ['perimetro', 'linear', 'parede'].includes(state.tool)) {
    e.preventDefault();
    finalizarDesenho();
  }
});

/* Arrastar para navegar (pan) quando nenhuma ferramenta está ativa */
const vpEl = $('viewport');
let pan = null; // { x, y, sl, st }

vpEl.addEventListener('pointerdown', (e) => {
  if (state.tool || e.target.closest('[data-ambiente]') || e.button !== 0) return;
  pan = { x: e.clientX, y: e.clientY, sl: vpEl.scrollLeft, st: vpEl.scrollTop };
  vpEl.style.cursor = 'grabbing';
});
vpEl.addEventListener('pointermove', (e) => {
  if (!pan) return;
  vpEl.scrollLeft = pan.sl - (e.clientX - pan.x);
  vpEl.scrollTop = pan.st - (e.clientY - pan.y);
});
const fimPan = () => { pan = null; vpEl.style.cursor = ''; };
vpEl.addEventListener('pointerup', fimPan);
vpEl.addEventListener('pointerleave', fimPan);

/* Clique / arraste no overlay */
let arrasto = null; // { ambiente, dx, dy, moveu }

overlay.addEventListener('pointerdown', (e) => {
  const alvo = e.target.closest('[data-ambiente]');
  if (alvo && !state.tool) {
    const p = pranchaAtual();
    const amb = p.ambientes.find(a => a.id === alvo.dataset.ambiente);
    if (!amb) return;
    const pt = pontoDoEvento(e);
    arrasto = { ambiente: amb, dx: amb.pin.x - pt.x, dy: amb.pin.y - pt.y, moveu: false };
    overlay.setPointerCapture(e.pointerId);
  }
});

overlay.addEventListener('pointermove', (e) => {
  if (!arrasto) return;
  const pt = pontoDoEvento(e);
  arrasto.ambiente.pin.x = pt.x + arrasto.dx;
  arrasto.ambiente.pin.y = pt.y + arrasto.dy;
  arrasto.moveu = true;
  desenharOverlay();
});

overlay.addEventListener('pointerup', (e) => {
  if (!arrasto) return;
  if (arrasto.moveu) salvar();
  else selecionarAmbiente(arrasto.ambiente.id);
  arrasto = null;
});

overlay.addEventListener('click', (e) => {
  if (!state.tool || arrasto) return;
  const p = pranchaAtual();
  if (!p) return;
  const pt = pontoDoEvento(e);

  if (state.tool === 'ambiente') {
    const nome = prompt('Nome do ambiente:');
    if (!nome) return;
    p.ambientes.push(novoAmbiente(nome.toUpperCase(), pt.x, pt.y));
    salvar(); atualizarTudo();
    return;
  }

  if (state.tool === 'pendencia') {
    abrirPendencia(pt);
    return;
  }

  if (state.tool === 'contagem') {
    if (!state.desenho) {
      const nomeC = prompt('O que você está contando? (ex.: Portas, Luminárias)');
      if (!nomeC) { setTool(null); return; }
      const m = { id: uid(), tipo: 'contagem', nome: nomeC, pontos: [] };
      p.medicoes.push(m);
      state.desenho = { medicaoId: m.id, pontos: [] };
    }
    const m = p.medicoes.find(x => x.id === state.desenho.medicaoId);
    m.pontos.push(pt);
    salvar(); desenharOverlay(); renderSidebar();
    return;
  }

  // calibrar / lado / perimetro / linear acumulam pontos
  if (!state.desenho) state.desenho = { pontos: [] };
  // Snap ortogonal: quase-horizontal/vertical em relação ao ponto anterior
  // (ou sempre, com Shift pressionado)
  const ant = state.desenho.pontos[state.desenho.pontos.length - 1];
  if (ant && ['perimetro', 'linear', 'calibrar', 'parede'].includes(state.tool)) {
    const dx = pt.x - ant.x, dy = pt.y - ant.y;
    const forcar = e.shiftKey;
    if (Math.abs(dy) < (forcar ? Math.abs(dx) : Math.abs(dx) * 0.12)) pt.y = ant.y;
    else if (Math.abs(dx) < (forcar ? Math.abs(dy) : Math.abs(dy) * 0.12)) pt.x = ant.x;
  }
  state.desenho.pontos.push(pt);
  desenharOverlay();

  if (state.tool === 'calibrar' && state.desenho.pontos.length === 2) abrirCalibrar();
  if (state.tool === 'lado' && state.desenho.pontos.length === 2) medirLado();
  if (state.tool === 'pavzona' && state.desenho.pontos.length === 2) abrirZonaPavimento();
});

// Reatribui a outro pavimento o que estiver dentro do retângulo marcado
// (folhas com mais de um pavimento desenhado lado a lado): ambientes pelo
// pin, e medições de contagem ponto a ponto.
function abrirZonaPavimento() {
  const p = pranchaAtual();
  const [a, b] = state.desenho.pontos;
  const x1 = Math.min(a.x, b.x), x2 = Math.max(a.x, b.x);
  const y1 = Math.min(a.y, b.y), y2 = Math.max(a.y, b.y);
  const dentroPt = (pt) => pt.x >= x1 && pt.x <= x2 && pt.y >= y1 && pt.y <= y2;

  const dentro = p.ambientes.filter(am => dentroPt(am.pin));
  const pontosContagem = p.medicoes.reduce((n, m) =>
    n + (m.tipo === 'contagem' ? m.pontos.filter(dentroPt).length : 0), 0);
  if (!dentro.length && !pontosContagem) {
    alert('Nada dentro da região marcada.\n\nPrimeiro crie os ambientes (meça com Lado/Perímetro ou use Analisar planta / IA); depois marque os dois cantos opostos em volta da planta do outro pavimento — os pins precisam ficar dentro da região.');
    setTool(null);
    return;
  }

  const partes = [];
  if (dentro.length) partes.push(`${dentro.length} ambiente(s): ${dentro.map(x => x.nome).join(', ').slice(0, 100)}`);
  if (pontosContagem) partes.push(`${pontosContagem} ponto(s) de contagem`);
  $('dlg-zona-msg').textContent = `Na região — ${partes.join(' · ')}`;

  const cont = $('dlg-zona-pav');
  cont.innerHTML = '';
  let escolhido = p.pavimento;
  cont.appendChild(selPavimento(escolhido, v => { escolhido = v; }));
  const dlg = $('dlg-zona');
  dlg.showModal();
  $('dlg-zona-ok').onclick = () => {
    dlg.close();
    // Mesmo pavimento da prancha = volta a herdar (null), para acompanhar
    // uma eventual renomeação da prancha depois
    const pav = escolhido === p.pavimento ? null : escolhido;
    for (const am of dentro) am.pavimento = pav;

    // Medições: inteiramente dentro da região mudam de pavimento;
    // contagens parcialmente dentro são divididas ponto a ponto
    for (const m of [...p.medicoes]) {
      if (!m.pontos.length) continue;
      if (m.pontos.every(dentroPt)) { m.pavimento = pav; continue; }
      if (m.tipo !== 'contagem') continue;
      const dentroPts = m.pontos.filter(dentroPt);
      if (!dentroPts.length) continue;
      m.pontos = m.pontos.filter(pt => !dentroPt(pt));
      const alvo = p.medicoes.find(x => x !== m && x.tipo === 'contagem' &&
        x.nome === m.nome && (x.pavimento ?? null) === pav);
      if (alvo) alvo.pontos.push(...dentroPts);
      else p.medicoes.push({ id: uid(), tipo: 'contagem', nome: m.nome, pavimento: pav, pontos: dentroPts });
    }
    p.medicoes = p.medicoes.filter(m => m.tipo !== 'contagem' || m.pontos.length);

    setTool(null);
    salvar(); atualizarTudo();
  };
  $('dlg-zona-cancelar').onclick = () => { dlg.close(); setTool(null); };
}

function abrirPendencia(pt) {
  const dlg = $('dlg-pendencia');
  $('inp-pend-titulo').value = '';
  $('inp-pend-resp').value = '';
  $('inp-pend-prazo').value = '';
  dlg.showModal();
  $('dlg-pend-ok').onclick = () => {
    const titulo = $('inp-pend-titulo').value.trim();
    if (!titulo) return;
    dlg.close();
    pranchaAtual().pendencias.push({
      id: uid(), x: pt.x, y: pt.y, titulo,
      responsavel: $('inp-pend-resp').value.trim(),
      prazo: $('inp-pend-prazo').value || null,
      status: 'aberta',
    });
    setTool(null);
    salvar(); renderSidebar(); desenharOverlay();
  };
  $('dlg-pend-cancelar').onclick = () => dlg.close();
}

function abrirCalibrar() {
  const dlg = $('dlg-calibrar');
  $('inp-calibrar').value = '';
  dlg.showModal();
  $('dlg-calibrar-ok').onclick = () => {
    const metros = num($('inp-calibrar').value);
    if (!metros || metros <= 0) return;
    dlg.close();
    const p = pranchaAtual();
    const [a, b] = state.desenho.pontos;
    p.escala = { pxPorMetro: dist(a, b) / metros, origem: 'cota' };
    setTool(null);
    salvar(); statusEscala(); renderSidebar();
  };
  $('dlg-calibrar-cancelar').onclick = () => { dlg.close(); cancelarDesenho(); };
}

// Ambiente que vai receber a medida: o selecionado, ou um novo criado na
// hora (medir primeiro, nomear depois) — o pin nasce no centro do desenho.
// Não fixa a seleção no novo ambiente, para que medições em sequência criem
// cada uma o seu (só medições com um ambiente já selecionado vão para ele).
function ambienteParaMedida(centro) {
  const jaSel = ambienteSel();
  if (jaSel) return jaSel;
  const nome = prompt('Nome do ambiente que você está medindo:', 'Ambiente');
  if (nome === null) return null;              // cancelou
  const amb = novoAmbiente((nome.trim() || 'Ambiente').toUpperCase(), centro.x, centro.y);
  pranchaAtual().ambientes.push(amb);
  return amb;
}

function medirLado() {
  const p = pranchaAtual();
  const [a, b] = state.desenho.pontos;
  const amb = ambienteParaMedida({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  if (!amb) { setTool(null); return; }
  const ppm = p.escala.pxPorMetro;
  const w = Math.abs(b.x - a.x) / ppm;
  const h = Math.abs(b.y - a.y) / ppm;
  amb.lado = `${fmt(Math.min(w, h))} × ${fmt(Math.max(w, h))}`;
  amb.perimetro = +(2 * (w + h)).toFixed(2);
  if (amb.areaOrigem !== 'planta') {
    amb.area = +(w * h).toFixed(2);
    amb.areaOrigem = 'medida';
  }
  setTool(null);
  salvar(); atualizarTudo();
}

function finalizarDesenho() {
  const p = pranchaAtual();
  const pts = state.desenho?.pontos || [];

  if (state.tool === 'perimetro') {
    if (pts.length < 3) return alert('Marque pelo menos 3 pontos do contorno.');
    const centro = {
      x: pts.reduce((s, q) => s + q.x, 0) / pts.length,
      y: pts.reduce((s, q) => s + q.y, 0) / pts.length,
    };
    const amb = ambienteParaMedida(centro);
    if (!amb) { setTool(null); return; }
    const ppm = p.escala.pxPorMetro;
    amb.perimetro = +(perimetroPoligono(pts) / ppm).toFixed(2);
    amb.poligono = pts;
    if (amb.areaOrigem !== 'planta') {
      amb.area = +(areaPoligono(pts) / (ppm * ppm)).toFixed(2);
      amb.areaOrigem = 'medida';
    }
    setTool(null);
    salvar(); atualizarTudo();
    return;
  }

  if (state.tool === 'linear') {
    if (pts.length < 2) return;
    const nome = prompt('Nome desta medição linear (ex.: Rodapé, Tubulação):') || 'Linear';
    p.medicoes.push({ id: uid(), tipo: 'linear', nome, pontos: pts });
    setTool(null);
    salvar(); renderSidebar(); desenharOverlay();
  }

  if (state.tool === 'parede') {
    if (pts.length < 2) return;
    abrirParede(pts);
  }
}

// Adiciona um trecho de parede (comprimento medido × pé-direito), classificado
// como interna ou externa. Área = comprimento × PD.
function abrirParede(pts) {
  const p = pranchaAtual();
  const compr = comprimentoPolilinha(pts) / p.escala.pxPorMetro;
  $('dlg-parede-msg').textContent = `Trecho traçado: ${fmt(compr)} m de comprimento.`;
  $('inp-parede-pd').value = String(num(state.projeto.peDireitoPadrao) ?? 2.8).replace('.', ',');
  const dlg = $('dlg-parede');
  dlg.showModal();
  $('dlg-parede-ok').onclick = () => {
    const pd = num($('inp-parede-pd').value);
    if (!pd || pd <= 0) return;
    dlg.close();
    const classe = $('sel-parede-classe').value === 'externa' ? 'externa' : 'interna';
    state.projeto.peDireitoPadrao = pd;   // memoriza para os próximos trechos
    p.medicoes.push({ id: uid(), tipo: 'parede', classe, pd, pontos: pts });
    setTool(null);
    salvar(); atualizarTudo();
  };
  $('dlg-parede-cancelar').onclick = () => { dlg.close(); cancelarDesenho(); setTool(null); };
}

/* =============== Sidebar: cards de ambientes e medições =============== */

function selecionarAmbiente(id) {
  state.ambienteSelId = state.ambienteSelId === id ? null : id;
  renderSidebar(); desenharOverlay();
}

function renderSidebar() {
  const p = pranchaAtual();
  statusEscala();
  if (p) $('sel-disciplina').value = p.disciplina;

  // Sobreposição: outra prancha do projeto por cima da atual
  if (state.sobreposicao.pranchaId &&
      !state.projeto.pranchas.some(x => x.id === state.sobreposicao.pranchaId)) {
    state.sobreposicao.pranchaId = null;
  }
  const outras = p ? state.projeto.pranchas.filter(x => x.id !== p.id) : [];
  $('secao-sobrepor').hidden = !outras.length;
  const selS = $('sel-sobrepor');
  selS.innerHTML = '';
  selS.appendChild(new Option('Nenhuma', ''));
  for (const x of outras) {
    selS.appendChild(new Option(`${x.pavimento} · ${x.disciplina}`, x.id, false,
      x.id === state.sobreposicao.pranchaId));
  }
  $('inp-sobrepor-op').value = Math.round(state.sobreposicao.opacidade * 100);

  const contPav = $('pavimento-prancha');
  contPav.innerHTML = '';
  if (p) {
    contPav.appendChild(selPavimento(p.pavimento, v => {
      p.pavimento = v;
      salvar(); renderAbas();
    }));
  }
  contPav.closest('.passo').hidden = !p;

  const secA = $('secao-ambientes');
  const lista = $('lista-ambientes');
  lista.innerHTML = '';
  secA.hidden = !p || !p.ambientes.length;
  $('qtd-ambientes').textContent = p?.ambientes.length ? `(${p.ambientes.length})` : '';

  if (p) {
    for (const a of p.ambientes) lista.appendChild(cardAmbiente(p, a));
  }

  const secP = $('secao-pendencias');
  const listaP = $('lista-pendencias');
  listaP.innerHTML = '';
  secP.hidden = !p || !p.pendencias.length;
  $('qtd-pendencias').textContent = p?.pendencias.length
    ? `(${p.pendencias.filter(x => x.status === 'aberta').length} abertas)` : '';
  if (p) {
    for (const pd of p.pendencias) listaP.appendChild(cardPendencia(p, pd));
  }

  const secM = $('secao-medicoes');
  const listaM = $('lista-medicoes');
  listaM.innerHTML = '';
  secM.hidden = !p || !p.medicoes.length;
  if (p) {
    for (const m of p.medicoes) {
      const linha = document.createElement('div');
      linha.className = 'medicao-linha';
      const compr = p.escala && m.pontos.length > 1
        ? comprimentoPolilinha(m.pontos) / p.escala.pxPorMetro : null;
      let icone = '╱', nome = m.nome, valor = '';
      if (m.tipo === 'contagem') { icone = '⌾'; valor = `${m.pontos.length} un`; }
      else if (m.tipo === 'parede') {
        icone = '▮';
        nome = `Parede ${m.classe === 'externa' ? 'externa' : 'interna'}`;
        valor = compr !== null ? `${fmt(compr * (num(m.pd) ?? 0))} m² (${fmt(compr)}×${fmt(num(m.pd) ?? 0)})` : '';
      } else if (compr !== null) valor = `${fmt(compr)} m`;
      const rotuloMed = document.createElement('span');
      rotuloMed.textContent = `${icone} ${nome}` + (m.pavimento ? ` · ${m.pavimento}` : '');
      const valorMed = document.createElement('strong');
      valorMed.textContent = valor;
      linha.append(rotuloMed, valorMed);
      const del = document.createElement('button');
      del.textContent = '×';
      del.title = 'Excluir medição';
      del.addEventListener('click', () => {
        p.medicoes = p.medicoes.filter(x => x.id !== m.id);
        salvar(); renderSidebar(); desenharOverlay();
      });
      linha.appendChild(del);
      listaM.appendChild(linha);
    }
  }
}

function cardPendencia(p, pd) {
  const card = document.createElement('div');
  card.className = 'card' + (pd.status === 'resolvida' ? ' pendencia-ok' : '');

  const topo = document.createElement('div');
  topo.className = 'card-topo';
  const cor = document.createElement('span');
  cor.className = 'pin-cor';
  cor.style.background = pd.status === 'resolvida' ? '#22c55e' : '#ef4444';
  const nome = document.createElement('input');
  nome.className = 'nome';
  nome.value = pd.titulo;
  nome.addEventListener('change', () => { pd.titulo = nome.value; salvar(); desenharOverlay(); });
  const del = document.createElement('button');
  del.innerHTML = '&times;';
  del.title = 'Excluir pendência';
  del.addEventListener('click', () => {
    p.pendencias = p.pendencias.filter(x => x.id !== pd.id);
    salvar(); renderSidebar(); desenharOverlay();
  });
  topo.appendChild(cor); topo.appendChild(nome); topo.appendChild(del);
  card.appendChild(topo);

  const grade = document.createElement('div');
  grade.className = 'card-grade';
  const mk = (rotulo, el2) => {
    const w = document.createElement('div');
    const l = document.createElement('label');
    l.textContent = rotulo;
    w.appendChild(l); w.appendChild(el2);
    return w;
  };
  const inpResp = document.createElement('input');
  inpResp.value = pd.responsavel || '';
  inpResp.placeholder = 'quem resolve';
  inpResp.addEventListener('change', () => { pd.responsavel = inpResp.value.trim(); salvar(); });
  grade.appendChild(mk('Responsável', inpResp));
  const inpPrazo = document.createElement('input');
  inpPrazo.type = 'date';
  inpPrazo.value = pd.prazo || '';
  inpPrazo.addEventListener('change', () => { pd.prazo = inpPrazo.value || null; salvar(); });
  grade.appendChild(mk('Prazo', inpPrazo));
  const selSt = document.createElement('select');
  selSt.appendChild(new Option('Aberta', 'aberta', false, pd.status === 'aberta'));
  selSt.appendChild(new Option('Resolvida', 'resolvida', false, pd.status === 'resolvida'));
  selSt.addEventListener('change', () => { pd.status = selSt.value; salvar(); renderSidebar(); desenharOverlay(); });
  grade.appendChild(mk('Status', selSt));
  card.appendChild(grade);
  return card;
}

function campoNum(rotulo, valor, aoMudar) {
  const wrap = document.createElement('div');
  const lab = document.createElement('label');
  lab.textContent = rotulo;
  const inp = document.createElement('input');
  inp.inputMode = 'decimal';
  inp.value = typeof valor === 'number' ? String(valor).replace('.', ',') : (valor ?? '');
  inp.addEventListener('change', () => { aoMudar(inp.value.trim()); salvar(); renderSidebar(); desenharOverlay(); });
  wrap.appendChild(lab); wrap.appendChild(inp);
  return wrap;
}

function excluirAmbiente(p, a, confirmar = true) {
  if (confirmar && !confirm(`Excluir o ambiente "${a.nome}" e suas medidas?`)) return false;
  p.ambientes = p.ambientes.filter(x => x.id !== a.id);
  if (state.ambienteSelId === a.id) state.ambienteSelId = null;
  salvar(); atualizarTudo();
  return true;
}

// Zera a medida (área/lados/perímetro) mantendo o ambiente, para remedir
function limparMedidaAmbiente(a) {
  a.area = null; a.areaOrigem = null;
  a.lado = ''; a.perimetro = null; a.poligono = null;
  salvar(); atualizarTudo();
}

function cardAmbiente(p, a) {
  const card = document.createElement('div');
  card.className = 'card' + (a.id === state.ambienteSelId ? ' selecionado' : '');
  card.addEventListener('click', (e) => {
    if (['INPUT', 'SELECT', 'BUTTON'].includes(e.target.tagName)) return;
    selecionarAmbiente(a.id);
  });

  const topo = document.createElement('div');
  topo.className = 'card-topo';
  topo.innerHTML = '<span class="pin-cor"></span>';
  const nome = document.createElement('input');
  nome.className = 'nome';
  nome.value = a.nome;
  nome.addEventListener('change', () => { a.nome = nome.value; salvar(); desenharOverlay(); });
  const del = document.createElement('button');
  del.innerHTML = '&times;';
  del.title = 'Excluir ambiente';
  del.addEventListener('click', () => excluirAmbiente(p, a));
  topo.appendChild(nome); topo.appendChild(del);
  card.appendChild(topo);

  if (num(a.area) !== null) {
    const origem = document.createElement('p');
    origem.className = 'card-origem';
    const rotOrigem = { planta: 'da planta', medida: 'medida', manual: 'manual', ia: 'IA — confira' }[a.areaOrigem] || '';
    origem.textContent = `◆ ${rotOrigem} — Área ${fmt(num(a.area))} m²`;
    if (a.areaOrigem === 'ia') origem.style.color = 'var(--laranja-2)';
    card.appendChild(origem);
  }

  const grade = document.createElement('div');
  grade.className = 'card-grade';
  grade.appendChild(campoNum('Área (m²)', a.area, v => { a.area = v; a.areaOrigem = 'manual'; }));
  grade.appendChild(campoNum('Perím. (m)', a.perimetro, v => { a.perimetro = v; }));
  grade.appendChild(campoNum('PD osso (m)', a.pdOsso, v => { a.pdOsso = v; }));
  grade.appendChild(campoNum('PD acab. (m)', a.pdAcab, v => { a.pdAcab = v; }));

  // Pavimento do ambiente (para folhas com mais de um pavimento desenhado)
  const wrapPav = document.createElement('div');
  const labPav = document.createElement('label');
  labPav.textContent = 'Pavimento';
  const selPavAmb = document.createElement('select');
  selPavAmb.appendChild(new Option(`(da prancha: ${p.pavimento})`, '', false, !a.pavimento));
  for (const pv of state.projeto.pavimentos) {
    selPavAmb.appendChild(new Option(pv, pv, false, a.pavimento === pv));
  }
  selPavAmb.addEventListener('change', () => {
    a.pavimento = selPavAmb.value || null;
    salvar();
  });
  wrapPav.appendChild(labPav);
  wrapPav.appendChild(selPavAmb);
  grade.appendChild(wrapPav);
  card.appendChild(grade);

  // Avanço físico
  const av = document.createElement('div');
  av.className = 'card-avanco';
  const avLab = document.createElement('label');
  avLab.textContent = 'Avanço';
  const avSlider = document.createElement('input');
  avSlider.type = 'range';
  avSlider.min = 0; avSlider.max = 100; avSlider.step = 5;
  avSlider.value = num(a.avanco) ?? 0;
  const avPct = document.createElement('strong');
  avPct.textContent = `${fmt(num(a.avanco) ?? 0, 0)}%`;
  avSlider.addEventListener('input', () => { avPct.textContent = `${avSlider.value}%`; });
  avSlider.addEventListener('change', () => {
    a.avanco = +avSlider.value;
    registrarSnapshot(state.projeto);
    salvar(); desenharOverlay();
  });
  av.appendChild(avLab); av.appendChild(avSlider); av.appendChild(avPct);
  card.appendChild(av);

  // Vãos
  const vaos = document.createElement('div');
  vaos.className = 'card-vaos';
  for (const v of a.vaos) {
    const linha = document.createElement('div');
    linha.className = 'vao';
    const sel = document.createElement('select');
    for (const [val, rot] of [['porta', 'Porta'], ['correr', 'Correr'], ['janela', 'Janela']]) {
      sel.appendChild(new Option(rot, val, false, v.tipo === val));
    }
    sel.addEventListener('change', () => { v.tipo = sel.value; salvar(); renderSidebar(); });
    const mkInp = (chave, ph) => {
      const i = document.createElement('input');
      i.placeholder = ph; i.inputMode = 'decimal'; i.value = v[chave] ?? '';
      i.addEventListener('change', () => { v[chave] = i.value.trim(); salvar(); });
      return i;
    };
    const del2 = document.createElement('button');
    del2.textContent = '×';
    del2.addEventListener('click', () => {
      a.vaos = a.vaos.filter(x => x !== v);
      salvar(); renderSidebar();
    });
    linha.appendChild(sel);
    linha.appendChild(mkInp('largura', 'larg.'));
    linha.appendChild(mkInp('altura', 'alt.'));
    linha.appendChild(mkInp('qtd', 'qtd'));
    linha.appendChild(del2);
    vaos.appendChild(linha);
  }
  const addVao = document.createElement('button');
  addVao.className = 'btn-mini';
  addVao.textContent = '+ vão';
  addVao.addEventListener('click', () => {
    a.vaos.push({ tipo: 'porta', largura: '', altura: '', qtd: 1 });
    salvar(); renderSidebar();
  });
  vaos.appendChild(addVao);
  const regra = document.createElement('p');
  regra.className = 'regra-vaos';
  regra.textContent = 'Porta/correr desconta sempre — janela só desconta se > 2,00 m².';
  vaos.appendChild(regra);
  card.appendChild(vaos);

  // Ações do ambiente: remedir (limpar medida) e excluir
  const acoes = document.createElement('div');
  acoes.className = 'card-acoes';
  const btnLimpar = document.createElement('button');
  btnLimpar.className = 'btn-mini';
  btnLimpar.textContent = '↺ Limpar medida';
  btnLimpar.title = 'Zera área, lado e perímetro para medir de novo (mantém o ambiente)';
  btnLimpar.addEventListener('click', () => {
    if (num(a.area) === null && !a.perimetro && !a.lado) return;
    if (!confirm(`Limpar a medida de "${a.nome}"? O ambiente continua; só a área/lado/perímetro são zerados para você medir de novo.`)) return;
    limparMedidaAmbiente(a);
  });
  const btnExcluir = document.createElement('button');
  btnExcluir.className = 'btn-mini btn-excluir-amb';
  btnExcluir.textContent = '🗑 Excluir ambiente';
  btnExcluir.addEventListener('click', () => excluirAmbiente(p, a));
  acoes.appendChild(btnLimpar);
  acoes.appendChild(btnExcluir);
  card.appendChild(acoes);

  return card;
}

/* =============== Topbar: vistas, zoom, nomes =============== */

const VISTAS = ['planta', 'tabela', 'orcamento', 'instalacoes', 'avanco', 'rdo'];
for (const v of VISTAS) {
  $(`btn-view-${v}`).addEventListener('click', () => trocarVista(v));
}

function trocarVista(v) {
  state.view = v;
  for (const x of VISTAS) {
    $(`btn-view-${x}`).classList.toggle('ativo', x === v);
    $(`vista-${x}`).hidden = x !== v;
  }
  $('zoom-ctrl').style.visibility = v === 'planta' ? '' : 'hidden';
  if (v === 'tabela') renderTabela();
  else if (v === 'orcamento') renderOrcamento();
  else if (v === 'instalacoes') renderInstalacoes();
  else if (v === 'avanco') renderAvanco();
  else if (v === 'rdo') renderRDO();
  else renderizar();
}

function setZoom(z) {
  state.zoom = Math.min(8, Math.max(0.05, z));
  $('zoom-label').textContent = `${Math.round(state.zoom * 100)} %`;
  renderizar();
}
$('btn-zoom-in').addEventListener('click', () => setZoom(state.zoom * 1.25));
$('btn-zoom-out').addEventListener('click', () => setZoom(state.zoom / 1.25));
$('btn-ajustar').addEventListener('click', () => { ajustar(); setZoom(state.zoom); });
$('viewport').addEventListener('wheel', (e) => {
  if (!e.ctrlKey) return;
  e.preventDefault();
  setZoom(state.zoom * (e.deltaY < 0 ? 1.15 : 1 / 1.15));
}, { passive: false });

$('btn-nomes').addEventListener('click', () => {
  state.mostrarNomes = !state.mostrarNomes;
  $('btn-nomes').classList.toggle('ativo', state.mostrarNomes);
  desenharOverlay();
});

$('sel-sobrepor').addEventListener('change', () => {
  state.sobreposicao.pranchaId = $('sel-sobrepor').value || null;
  renderizar();
});

$('inp-sobrepor-op').addEventListener('input', () => {
  state.sobreposicao.opacidade = $('inp-sobrepor-op').value / 100;
  const c = $('canvas-sobrepor');
  if (!c.hidden) c.style.opacity = state.sobreposicao.opacidade;
});

/* =============== Instalação (PWA) =============== */

// Registro do service worker (fora do HTML para a CSP não permitir script inline)
if ('serviceWorker' in navigator) {
  const registrarSW = () => navigator.serviceWorker.register('sw.js').catch(() => {});
  if (document.readyState === 'complete') registrarSW();
  else window.addEventListener('load', registrarSW);
}

let promptInstalacao = null;
const emAppInstalado = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone;

if (!emAppInstalado) $('btn-instalar').hidden = false;

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  promptInstalacao = e;
  $('btn-instalar').hidden = false;
});

window.addEventListener('appinstalled', () => { $('btn-instalar').hidden = true; });

$('btn-instalar').addEventListener('click', async () => {
  if (promptInstalacao) {
    promptInstalacao.prompt();
    const { outcome } = await promptInstalacao.userChoice;
    if (outcome === 'accepted') $('btn-instalar').hidden = true;
    promptInstalacao = null;
  } else {
    $('dlg-instalar').showModal();
  }
});
$('dlg-instalar-fechar').addEventListener('click', () => $('dlg-instalar').close());

/* =============== Tabela: exportações =============== */

$('btn-csv').addEventListener('click', exportarCSV);
$('btn-xlsx').addEventListener('click', exportarXLSX);
$('btn-orc-xlsx').addEventListener('click', exportarXLSX);
$('btn-imprimir').addEventListener('click', () => window.print());

async function relatorio(botao) {
  botao.disabled = true;
  botao.textContent = 'Gerando…';
  try { await gerarRelatorioPDF(); }
  catch (e) { alert('Falha ao gerar relatório: ' + e.message); }
  botao.disabled = false;
  botao.textContent = 'Relatório PDF';
}
$('btn-relatorio').addEventListener('click', () => relatorio($('btn-relatorio')));
$('btn-orc-relatorio').addEventListener('click', () => relatorio($('btn-orc-relatorio')));

/* =============== Nuvem (banco de dados) =============== */

// Sempre textContent: mensagens podem conter dados do usuário ou do servidor
function nuvemStatus(msg, ok = true) {
  const el = $('nuvem-status');
  el.hidden = false;
  el.textContent = msg;
  el.classList.toggle('alerta', !ok);
}

function renderConta() {
  const cont = $('nuvem-conta');
  cont.innerHTML = '';
  const sessao = nuvem.lerSessao();
  if (sessao) {
    const p = document.createElement('p');
    p.className = 'dica';
    const emailEl = document.createElement('strong');
    emailEl.textContent = sessao.email;
    p.append('Conectado como ', emailEl, ' ');
    const btnSair = document.createElement('button');
    btnSair.className = 'btn-mini';
    btnSair.textContent = 'Sair';
    btnSair.addEventListener('click', () => {
      nuvem.sair(); renderConta(); atualizarIndicadorSync();
      if (nuvem.exigeLogin()) { $('dlg-nuvem').close(); mostrarLogin(); }
    });
    p.appendChild(btnSair);
    cont.appendChild(p);
    return;
  }
  cont.innerHTML = `
    <label class="campo-label" style="margin-top:8px">Conta (e-mail)</label>
    <input id="inp-conta-email" type="email" placeholder="voce@empresa.com" />
    <label class="campo-label" style="margin-top:8px">Senha</label>
    <input id="inp-conta-senha" type="password" placeholder="mínimo 6 caracteres" />
    <div class="dlg-botoes" style="justify-content:flex-start;margin-top:8px">
      <button id="btn-conta-entrar" class="btn-laranja">Entrar</button>
      <button id="btn-conta-cadastrar" class="btn-ghost">Criar conta</button>
    </div>`;
  const credenciais = () => {
    if (!salvarConfigNuvem()) return null;
    const email = $('inp-conta-email').value.trim();
    const senha = $('inp-conta-senha').value;
    if (!email || senha.length < 6) { nuvemStatus('Informe e-mail e senha (mínimo 6 caracteres).', false); return null; }
    return { email, senha };
  };
  $('btn-conta-entrar').addEventListener('click', async () => {
    const c = credenciais();
    if (!c) return;
    nuvemStatus('Entrando…');
    try {
      await nuvem.entrar(c.email, c.senha);
      nuvemStatus('✓ Conectado.');
      renderConta(); atualizarIndicadorSync();
    } catch (e) { nuvemStatus('Falha ao entrar: ' + e.message, false); }
  });
  $('btn-conta-cadastrar').addEventListener('click', async () => {
    const c = credenciais();
    if (!c) return;
    nuvemStatus('Criando conta…');
    try {
      const sessao = await nuvem.cadastrar(c.email, c.senha);
      if (sessao) { nuvemStatus('✓ Conta criada e conectada.'); renderConta(); atualizarIndicadorSync(); }
      else nuvemStatus('Conta criada — confirme pelo link enviado ao seu e-mail e depois clique em Entrar.');
    } catch (e) { nuvemStatus('Falha ao criar conta: ' + e.message, false); }
  });
}

$('btn-nuvem').addEventListener('click', () => {
  const c = nuvem.lerConfig();
  $('inp-nuvem-url').value = c?.url || '';
  $('inp-nuvem-key').value = c?.anonKey || '';
  $('chk-autosync').checked = !!c?.autoSync;
  $('chk-exige-login').checked = nuvem.exigeLogin();
  $('nuvem-status').hidden = true;
  $('nuvem-lista').innerHTML = '';
  renderConta();
  $('dlg-nuvem').showModal();
});

$('chk-exige-login').addEventListener('change', () => {
  // Guarda a conexão já preenchida, senão a trava apareceria sem URL/chave
  const url = $('inp-nuvem-url').value.trim();
  const key = $('inp-nuvem-key').value.trim();
  if (url && key) nuvem.salvarConfig(url, key);
  const ligar = $('chk-exige-login').checked;
  nuvem.definirExigeLogin(ligar);
  if (ligar && !nuvem.lerSessao()) {
    nuvemStatus('Trava ativada. Ao recarregar, o app pedirá login — entre acima antes para não se trancar fora.', false);
  } else if (ligar) {
    nuvemStatus('Trava ativada — o app pedirá login ao abrir neste e nos outros aparelhos.');
  } else {
    nuvemStatus('Trava desligada — o app abre sem pedir login.');
  }
});

$('chk-autosync').addEventListener('change', () => {
  nuvem.definirAutoSync($('chk-autosync').checked);
  if ($('chk-autosync').checked && !nuvem.lerSessao()) {
    nuvemStatus('A sincronização automática só funciona com login — entre ou crie uma conta acima.', false);
  }
  atualizarIndicadorSync();
});

function atualizarIndicadorSync(estado) {
  const b = $('btn-nuvem');
  if (estado === 'pendente' || estado === 'enviando') { b.textContent = '☁…'; b.title = 'Sincronizando…'; }
  else if (estado === 'erro') { b.textContent = '☁!'; b.title = 'Falha na sincronização — abra para ver'; }
  else if (nuvem.autoSyncAtivo()) { b.textContent = '☁✓'; b.title = 'Sincronização automática ativa'; }
  else { b.textContent = '☁'; b.title = 'Nuvem — salvar/baixar do banco de dados'; }
}

nuvem.iniciarAutoSync((estado) => atualizarIndicadorSync(estado));
aoSalvar(() => nuvem.agendarSync());
atualizarIndicadorSync();
$('dlg-nuvem-fechar').addEventListener('click', () => $('dlg-nuvem').close());

/* =============== Trava de login (opcional) =============== */

function loginStatus(msg, ok = true) {
  const el = $('login-status');
  el.hidden = false;
  el.textContent = msg;
  el.classList.toggle('alerta', !ok);
}

function mostrarLogin() {
  const c = nuvem.lerConfig();
  $('login-url').value = c?.url || '';
  $('login-key').value = c?.anonKey || '';
  $('login-conexao').open = !nuvem.configurado();
  $('login-status').hidden = true;
  $('tela-login').hidden = false;
}

function salvarConexaoLogin() {
  const url = $('login-url').value.trim();
  const key = $('login-key').value.trim();
  if (url && key) nuvem.salvarConfig(url, key);
  if (!nuvem.configurado()) {
    loginStatus('Informe a URL e a chave do banco em "Configurar conexão".', false);
    $('login-conexao').open = true;
    return false;
  }
  return true;
}

$('login-entrar').addEventListener('click', async () => {
  if (!salvarConexaoLogin()) return;
  const email = $('login-email').value.trim();
  const senha = $('login-senha').value;
  if (!email || !senha) return loginStatus('Informe e-mail e senha.', false);
  loginStatus('Entrando…');
  try {
    await nuvem.entrar(email, senha);
    $('tela-login').hidden = true;
    renderConta(); atualizarIndicadorSync();
  } catch (e) { loginStatus('Falha ao entrar: ' + e.message, false); }
});

$('login-criar').addEventListener('click', async () => {
  if (!salvarConexaoLogin()) return;
  const email = $('login-email').value.trim();
  const senha = $('login-senha').value;
  if (!email || senha.length < 6) return loginStatus('Informe e-mail e senha (mínimo 6 caracteres).', false);
  loginStatus('Criando conta…');
  try {
    const sessao = await nuvem.cadastrar(email, senha);
    if (sessao) { $('tela-login').hidden = true; renderConta(); atualizarIndicadorSync(); }
    else loginStatus('Conta criada — confirme pelo link enviado ao seu e-mail e depois clique em Entrar.');
  } catch (e) { loginStatus('Falha ao criar conta: ' + e.message, false); }
});

// Na abertura: se a trava estiver ligada e não houver sessão válida, bloqueia
(async () => {
  if (!nuvem.exigeLogin()) return;
  if (await nuvem.sessaoAtiva()) return;
  mostrarLogin();
})();

function salvarConfigNuvem() {
  const url = $('inp-nuvem-url').value.trim();
  const key = $('inp-nuvem-key').value.trim();
  if (!url || !key) { nuvemStatus('Preencha a URL e a chave anon (veja o guia de configuração).', false); return false; }
  nuvem.salvarConfig(url, key);
  return true;
}

$('btn-nuvem-testar').addEventListener('click', async () => {
  if (!salvarConfigNuvem()) return;
  nuvemStatus('Testando conexão…');
  const r = await nuvem.testarConexao();
  nuvemStatus((r.ok ? '✓ ' : '') + r.msg, r.ok);
});

$('btn-nuvem-enviar').addEventListener('click', async () => {
  if (!salvarConfigNuvem()) return;
  nuvemStatus('Enviando projeto (com as plantas)…');
  try {
    await nuvem.enviarProjeto();
    nuvemStatus(`✓ Projeto "${state.projeto.nome}" salvo na nuvem.`);
  } catch (e) {
    if (e.conflito) {
      if (confirm(`Atenção: ${e.message}\n\nSobrescrever a nuvem com a versão deste aparelho?`)) {
        try {
          await nuvem.enviarProjeto(true);
          nuvemStatus(`✓ Projeto "${state.projeto.nome}" salvo na nuvem (versão deste aparelho).`);
        } catch (e2) { nuvemStatus('Falha ao enviar: ' + e2.message, false); }
      } else {
        nuvemStatus('Envio cancelado — use "Baixar da nuvem" para ver a versão mais recente.', false);
      }
      return;
    }
    nuvemStatus('Falha ao enviar: ' + e.message, false);
  }
});

$('btn-nuvem-baixar').addEventListener('click', async () => {
  if (!salvarConfigNuvem()) return;
  nuvemStatus('Buscando projetos na nuvem…');
  const lista = $('nuvem-lista');
  lista.innerHTML = '';
  try {
    const projetos = await nuvem.listarNuvem();
    if (!projetos.length) { nuvemStatus('Nenhum projeto na nuvem ainda — envie um primeiro.'); return; }
    nuvemStatus(`${projetos.length} projeto(s) na nuvem — clique para baixar:`);
    for (const p of projetos) {
      const linha = document.createElement('div');
      linha.className = 'medicao-linha';
      const quando = new Date(p.atualizado_em).toLocaleString('pt-BR');
      const nomeProj = document.createElement('span');
      nomeProj.textContent = p.nome;
      const quandoEl = document.createElement('small');
      quandoEl.style.color = 'var(--texto-2)';
      quandoEl.textContent = quando;
      linha.append(nomeProj, quandoEl);
      const btn = document.createElement('button');
      btn.className = 'btn-mini';
      btn.style.marginTop = '0';
      btn.textContent = 'Baixar';
      btn.addEventListener('click', async () => {
        btn.textContent = '…';
        try {
          const proj = await nuvem.baixarProjeto(p.id);
          $('dlg-nuvem').close();
          trocarProjeto(proj);
        } catch (e) { nuvemStatus('Falha ao baixar: ' + e.message, false); btn.textContent = 'Baixar'; }
      });
      linha.appendChild(btn);
      lista.appendChild(linha);
    }
  } catch (e) { nuvemStatus('Falha ao listar: ' + e.message, false); }
});

/* =============== Orçamento e Avanço: controles =============== */

$('btn-orc-add').addEventListener('click', adicionarServico);
$('btn-rdo-novo').addEventListener('click', novoRDO);
$('btn-orc-importar').addEventListener('click', () => $('inp-csv-precos').click());
$('inp-csv-precos').addEventListener('change', async (e) => {
  const arq = e.target.files[0];
  e.target.value = '';
  if (!arq) return;
  const { novos, atualizados } = importarPrecosCSV(await arq.text());
  alert(`Importação concluída: ${novos} serviço(s) novo(s), ${atualizados} preço(s) atualizado(s).`);
});
$('btn-orc-csv').addEventListener('click', exportarOrcamentoCSV);
$('btn-orc-imprimir').addEventListener('click', () => window.print());
$('inp-bdi').addEventListener('change', () => {
  state.projeto.bdi = num($('inp-bdi').value) ?? 0;
  salvar(); renderOrcamento();
});
$('inp-data-inicio').addEventListener('change', () => {
  state.projeto.dataInicio = $('inp-data-inicio').value || null;
  salvar(); renderAvanco();
});
$('inp-data-fim').addEventListener('change', () => {
  state.projeto.dataFim = $('inp-data-fim').value || null;
  salvar(); renderAvanco();
});

/* Primeira renderização com ajuste de zoom quando já há prancha */
if (state.pranchaAtualId) {
  obterPagina(pranchaAtual()).then(() => { ajustar(); setZoom(state.zoom); }).catch(() => {});
}
