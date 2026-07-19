// Levantamento de Obra — módulo principal (abas, importação, ferramentas, cards)

import {
  state, uid, novoProjeto, novaPrancha, novoAmbiente,
  pranchaAtual, ambienteSel, salvar, carregarProjeto,
  salvarPdf, limparPdfsOrfaos, iniciarHistorico, desfazer, refazer,
  listarProjetos, lerProjeto, excluirProjeto, idsPranchasTodosProjetos,
  exportarProjetoJSON, importarProjetoJSON,
} from './store.js';
import { renderOrcamento, adicionarServico, exportarOrcamentoCSV } from './orcamento.js';
import { renderAvanco, registrarSnapshot } from './avanco.js';
import {
  renderizar, ajustar, pontoDoEvento, desenharOverlay,
  obterPagina, esquecerPagina, contarPaginas,
} from './viewer.js';
import { analisarPlanta, detectarEscalaCarimbo } from './deteccao.js';
import { renderTabela, exportarCSV } from './tabela.js';
import { fmt, num, dist, perimetroPoligono, areaPoligono, pxPorMetroDeEscala } from './calc.js';

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
  if (state.view === 'avanco') renderAvanco();
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
    aba.innerHTML = `&#127968; <span>${p.pavimento}${p.ambientes.length ? ' · ' + p.ambientes.length : ''}</span>`;
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
    linha.innerHTML = `<span class="nome-arq" title="${pd.rotulo}">${pd.rotulo}</span>`;
    const inpPav = document.createElement('input');
    inpPav.value = pd.pavimento;
    inpPav.setAttribute('list', 'lista-pavimentos');
    inpPav.addEventListener('input', () => { pd.pavimento = inpPav.value; });
    const selDisc = document.createElement('select');
    for (const d of ['Arquitetura', 'Estrutura', 'Fundação', 'Hidráulica', 'Elétrica', 'Climatização']) {
      selDisc.appendChild(new Option(d, d));
    }
    selDisc.addEventListener('change', () => { pd.disciplina = selDisc.value; });
    linha.appendChild(inpPav);
    linha.appendChild(selDisc);
    lista.appendChild(linha);
  });
  if (!$('lista-pavimentos')) {
    const dl = document.createElement('datalist');
    dl.id = 'lista-pavimentos';
    for (const p of ['Subsolo', 'Térreo', 'Superior', 'Cobertura']) dl.appendChild(new Option(p));
    document.body.appendChild(dl);
  }

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

$('btn-analisar').addEventListener('click', async () => {
  const p = pranchaAtual();
  if (!p) return alert('Abra uma prancha primeiro.');
  const res = $('resultado-analise');
  res.hidden = false;
  res.textContent = 'Analisando a planta…';
  try {
    const { page } = await obterPagina(p);
    const achados = await analisarPlanta(page);
    let novos = 0, total = 0, comPd = 0;
    for (const a of achados) {
      total += a.area;
      if (a.pd) comPd++;
      const jaExiste = p.ambientes.some(x => x.nome === a.nome && Math.abs((num(x.area) ?? -1) - a.area) < 0.01);
      if (jaExiste) continue;
      const amb = novoAmbiente(a.nome, a.x, a.y);
      amb.area = a.area;
      amb.areaOrigem = 'planta';
      if (a.pd) amb.pdAcab = a.pd;
      p.ambientes.push(amb);
      novos++;
    }
    if (!achados.length) {
      res.innerHTML = 'Nenhum ambiente encontrado no texto do PDF. Se a planta for escaneada (imagem), crie os ambientes manualmente com <strong>+ Ambiente</strong>.';
    } else {
      res.innerHTML = `&check; Li <strong>${achados.length} ambiente(s)</strong> — nome, área${comPd ? ' e pé-direito' : ''} preenchidos. ` +
        `Total = <strong>${fmt(total)} m²</strong>. Confira os pins azuis, ajuste nomes e apague o que não for ambiente.` +
        (novos < achados.length ? ` (${achados.length - novos} já existiam.)` : '');
    }
    salvar(); atualizarTudo();
  } catch (err) {
    res.textContent = 'Falha ao analisar: ' + err.message;
  }
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
  if (['lado', 'perimetro', 'linear'].includes(t) && !p.escala) {
    return alert('Defina a escala primeiro (passo 1) para medir em metros.');
  }
  if (['lado', 'perimetro'].includes(t) && !ambienteSel()) {
    return alert('Selecione um ambiente (clique no card ou no pin) antes de medir.');
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
  if (state.desenho && ['perimetro', 'linear'].includes(state.tool)) {
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
  state.desenho.pontos.push(pt);
  desenharOverlay();

  if (state.tool === 'calibrar' && state.desenho.pontos.length === 2) abrirCalibrar();
  if (state.tool === 'lado' && state.desenho.pontos.length === 2) medirLado();
});

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

function medirLado() {
  const p = pranchaAtual();
  const amb = ambienteSel();
  const [a, b] = state.desenho.pontos;
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
  salvar(); renderSidebar(); desenharOverlay();
}

function finalizarDesenho() {
  const p = pranchaAtual();
  const pts = state.desenho?.pontos || [];

  if (state.tool === 'perimetro') {
    if (pts.length < 3) return alert('Marque pelo menos 3 pontos do contorno.');
    const amb = ambienteSel();
    const ppm = p.escala.pxPorMetro;
    amb.perimetro = +(perimetroPoligono(pts) / ppm).toFixed(2);
    amb.poligono = pts;
    if (amb.areaOrigem !== 'planta') {
      amb.area = +(areaPoligono(pts) / (ppm * ppm)).toFixed(2);
      amb.areaOrigem = 'medida';
    }
    setTool(null);
    salvar(); renderSidebar(); desenharOverlay();
    return;
  }

  if (state.tool === 'linear') {
    if (pts.length < 2) return;
    const nome = prompt('Nome desta medição linear (ex.: Rodapé, Tubulação):') || 'Linear';
    p.medicoes.push({ id: uid(), tipo: 'linear', nome, pontos: pts });
    setTool(null);
    salvar(); renderSidebar(); desenharOverlay();
  }
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

  const secA = $('secao-ambientes');
  const lista = $('lista-ambientes');
  lista.innerHTML = '';
  secA.hidden = !p || !p.ambientes.length;
  $('qtd-ambientes').textContent = p?.ambientes.length ? `(${p.ambientes.length})` : '';

  if (p) {
    for (const a of p.ambientes) lista.appendChild(cardAmbiente(p, a));
  }

  const secM = $('secao-medicoes');
  const listaM = $('lista-medicoes');
  listaM.innerHTML = '';
  secM.hidden = !p || !p.medicoes.length;
  if (p) {
    for (const m of p.medicoes) {
      const linha = document.createElement('div');
      linha.className = 'medicao-linha';
      let valor = '';
      if (m.tipo === 'contagem') valor = `${m.pontos.length} un`;
      else if (p.escala) {
        let c = 0;
        for (let i = 1; i < m.pontos.length; i++) c += dist(m.pontos[i - 1], m.pontos[i]);
        valor = `${fmt(c / p.escala.pxPorMetro)} m`;
      }
      linha.innerHTML = `<span>${m.tipo === 'contagem' ? '⌾' : '╱'} ${m.nome}</span><strong>${valor}</strong>`;
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
  del.addEventListener('click', () => {
    if (!confirm(`Excluir o ambiente "${a.nome}"?`)) return;
    p.ambientes = p.ambientes.filter(x => x.id !== a.id);
    if (state.ambienteSelId === a.id) state.ambienteSelId = null;
    salvar(); atualizarTudo();
  });
  topo.appendChild(nome); topo.appendChild(del);
  card.appendChild(topo);

  if (num(a.area) !== null) {
    const origem = document.createElement('p');
    origem.className = 'card-origem';
    const rotOrigem = { planta: 'da planta', medida: 'medida', manual: 'manual' }[a.areaOrigem] || '';
    origem.innerHTML = `&#9670; ${rotOrigem} — Área ${fmt(num(a.area))} m²`;
    card.appendChild(origem);
  }

  const grade = document.createElement('div');
  grade.className = 'card-grade';
  grade.appendChild(campoNum('Área (m²)', a.area, v => { a.area = v; a.areaOrigem = 'manual'; }));
  grade.appendChild(campoNum('Perím. (m)', a.perimetro, v => { a.perimetro = v; }));
  grade.appendChild(campoNum('PD osso (m)', a.pdOsso, v => { a.pdOsso = v; }));
  grade.appendChild(campoNum('PD acab. (m)', a.pdAcab, v => { a.pdAcab = v; }));
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

  return card;
}

/* =============== Topbar: vistas, zoom, nomes =============== */

const VISTAS = ['planta', 'tabela', 'orcamento', 'avanco'];
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
  else if (v === 'avanco') renderAvanco();
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

/* =============== Tabela: exportações =============== */

$('btn-csv').addEventListener('click', exportarCSV);
$('btn-imprimir').addEventListener('click', () => window.print());

/* =============== Orçamento e Avanço: controles =============== */

$('btn-orc-add').addEventListener('click', adicionarServico);
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
