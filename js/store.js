// Estado do levantamento + persistência (localStorage p/ dados, IndexedDB p/ PDFs)

export const state = {
  projeto: null,
  pranchaAtualId: null,
  ambienteSelId: null,
  zoom: 1,
  mostrarNomes: true,
  view: 'planta',
  tool: null,          // 'calibrar' | 'lado' | 'perimetro' | 'linear' | 'contagem' | 'ambiente'
  desenho: null,       // pontos em curso da ferramenta ativa
};

const CHAVE_LEGADA = 'levantamento:projeto';
const CHAVE_INDICE = 'levantamento:v2:indice';
const CHAVE_ATIVO = 'levantamento:v2:ativo';
const prefixoProj = (id) => `levantamento:v2:proj:${id}`;

export function uid() {
  return Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4);
}

// Catálogo inicial de serviços (preços de referência — o usuário edita)
export function catalogoPadrao() {
  return [
    { id: uid(), nome: 'Emboço/reboco interno', un: 'm²', fonte: 'paredeLiq', preco: 45 },
    { id: uid(), nome: 'Pintura interna (massa + tinta)', un: 'm²', fonte: 'paredeLiq', preco: 38 },
    { id: uid(), nome: 'Contrapiso', un: 'm²', fonte: 'areaPiso', preco: 42 },
    { id: uid(), nome: 'Revestimento cerâmico de piso', un: 'm²', fonte: 'areaPiso', preco: 75 },
    { id: uid(), nome: 'Forro de gesso', un: 'm²', fonte: 'areaTeto', preco: 55 },
    { id: uid(), nome: 'Rodapé', un: 'm', fonte: 'perimetro', preco: 18 },
  ];
}

export const PAVIMENTOS_PADRAO = ['Subsolo', 'Térreo', 'Superior', 'Cobertura'];

export function novoProjeto(nome = 'Levantamento') {
  return {
    id: uid(), nome, criadoEm: new Date().toISOString(), pranchas: [],
    pavimentos: [...PAVIMENTOS_PADRAO],
    catalogo: catalogoPadrao(), bdi: 25,
    dataInicio: null, dataFim: null, snapshots: [], rdos: [],
  };
}

// Preenche campos que versões anteriores do app não tinham
export function garantirCampos(proj) {
  proj.catalogo ??= catalogoPadrao();
  proj.bdi ??= 25;
  proj.dataInicio ??= null;
  proj.dataFim ??= null;
  proj.snapshots ??= [];
  proj.pavimentos ??= [...PAVIMENTOS_PADRAO];
  proj.rdos ??= [];
  for (const p of proj.pranchas) {
    p.pendencias ??= [];
    if (p.pavimento && !proj.pavimentos.includes(p.pavimento)) proj.pavimentos.push(p.pavimento);
    for (const a of p.ambientes) a.avanco ??= 0;
  }
  return proj;
}

// Ordena nomes de pavimento pela ordem definida no projeto (desconhecidos ao fim)
export function ordenarPavimentos(proj, nomes) {
  const idx = (n) => {
    const i = proj.pavimentos.indexOf(n);
    return i === -1 ? proj.pavimentos.length : i;
  };
  return [...nomes].sort((a, b) => idx(a) - idx(b));
}

export function novaPrancha(arquivoNome, pagina, pavimento, disciplina) {
  return {
    id: uid(), arquivoNome, pagina, pavimento, disciplina,
    escala: null,                 // { pxPorMetro (unid. base pt/m), origem: 'cota'|'carimbo' }
    ambientes: [], medicoes: [],  // medições avulsas: linear / contagem
    pendencias: [],               // pins de compatibilização/pendência
  };
}

export function novoAmbiente(nome, x, y) {
  return {
    id: uid(), nome, pin: { x, y },
    area: null, areaOrigem: null,   // 'planta' | 'medida' | 'manual'
    lado: '', perimetro: null,
    pdOsso: null, pdAcab: null,
    vaos: [], qtd: 1,
  };
}

export function pranchaAtual() {
  if (!state.projeto || !state.pranchaAtualId) return null;
  return state.projeto.pranchas.find(p => p.id === state.pranchaAtualId) || null;
}

export function ambienteSel() {
  const p = pranchaAtual();
  if (!p || !state.ambienteSelId) return null;
  return p.ambientes.find(a => a.id === state.ambienteSelId) || null;
}

/* ---------- Histórico (desfazer/refazer) ---------- */

const LIMITE_HISTORICO = 50;
const pilhaDesfazer = [];
const pilhaRefazer = [];
let fotoAtual = null; // JSON do último estado salvo

export function iniciarHistorico() {
  fotoAtual = JSON.stringify(state.projeto);
  pilhaDesfazer.length = 0;
  pilhaRefazer.length = 0;
}

let cbAposSalvar = null;
export function aoSalvar(cb) { cbAposSalvar = cb; }

export function salvar() {
  try {
    const json = JSON.stringify(state.projeto);
    if (json !== fotoAtual) {
      if (fotoAtual !== null) {
        pilhaDesfazer.push(fotoAtual);
        if (pilhaDesfazer.length > LIMITE_HISTORICO) pilhaDesfazer.shift();
        pilhaRefazer.length = 0;
      }
      fotoAtual = json;
    }
    localStorage.setItem(prefixoProj(state.projeto.id), json);
    atualizarIndice(state.projeto);
    localStorage.setItem(CHAVE_ATIVO, state.projeto.id);
    cbAposSalvar?.();
  } catch (e) { console.warn('Falha ao salvar projeto', e); }
}

function restaurar(json) {
  state.projeto = garantirCampos(JSON.parse(json));
  fotoAtual = json;
  try { localStorage.setItem(prefixoProj(state.projeto.id), json); } catch { /* segue */ }
  atualizarIndice(state.projeto);
  if (!state.projeto.pranchas.some(p => p.id === state.pranchaAtualId)) {
    state.pranchaAtualId = state.projeto.pranchas[0]?.id || null;
  }
  state.ambienteSelId = null;
}

export function desfazer() {
  if (!pilhaDesfazer.length) return false;
  pilhaRefazer.push(fotoAtual);
  restaurar(pilhaDesfazer.pop());
  return true;
}

export function refazer() {
  if (!pilhaRefazer.length) return false;
  pilhaDesfazer.push(fotoAtual);
  restaurar(pilhaRefazer.pop());
  return true;
}

/* ---------- Multi-projeto ---------- */

export function listarProjetos() {
  try { return JSON.parse(localStorage.getItem(CHAVE_INDICE)) || []; }
  catch { return []; }
}

function gravarIndice(indice) {
  localStorage.setItem(CHAVE_INDICE, JSON.stringify(indice));
}

function atualizarIndice(proj) {
  const indice = listarProjetos();
  const item = indice.find(i => i.id === proj.id);
  if (item) item.nome = proj.nome;
  else indice.push({ id: proj.id, nome: proj.nome });
  gravarIndice(indice);
}

export function lerProjeto(id) {
  try {
    const bruto = localStorage.getItem(prefixoProj(id));
    return bruto ? garantirCampos(JSON.parse(bruto)) : null;
  } catch { return null; }
}

export function excluirProjeto(id) {
  localStorage.removeItem(prefixoProj(id));
  gravarIndice(listarProjetos().filter(i => i.id !== id));
}

// Carrega o projeto ativo, migrando dados da versão mono-projeto se existirem
export function carregarProjeto() {
  try {
    const legado = localStorage.getItem(CHAVE_LEGADA);
    if (legado) {
      const proj = garantirCampos(JSON.parse(legado));
      localStorage.setItem(prefixoProj(proj.id), JSON.stringify(proj));
      atualizarIndice(proj);
      localStorage.setItem(CHAVE_ATIVO, proj.id);
      localStorage.removeItem(CHAVE_LEGADA);
    }
    const ativo = localStorage.getItem(CHAVE_ATIVO);
    if (ativo) {
      const proj = lerProjeto(ativo);
      if (proj) return proj;
    }
    const indice = listarProjetos();
    if (indice.length) return lerProjeto(indice[0].id);
  } catch (e) { console.warn('Falha ao carregar projeto', e); }
  return null;
}

// IDs de pranchas de TODOS os projetos (para não apagar PDFs de outros projetos)
export function idsPranchasTodosProjetos() {
  const ids = [];
  for (const { id } of listarProjetos()) {
    const proj = lerProjeto(id);
    if (proj) for (const p of proj.pranchas) ids.push(p.id);
  }
  return ids;
}

/* ---------- IndexedDB: bytes dos PDFs (chave = prancha.id) ---------- */

function abrirDB() {
  return new Promise((res, rej) => {
    const req = indexedDB.open('levantamento', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('pdfs');
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });
}

async function opPdf(modo, fn) {
  const db = await abrirDB();
  try {
    return await new Promise((res, rej) => {
      const tx = db.transaction('pdfs', modo);
      const req = fn(tx.objectStore('pdfs'));
      req.onsuccess = () => res(req.result);
      req.onerror = () => rej(req.error);
    });
  } finally { db.close(); }
}

export const salvarPdf = (id, buf) => opPdf('readwrite', s => s.put(buf, id));
export const lerPdf = (id) => opPdf('readonly', s => s.get(id));
export const apagarPdf = (id) => opPdf('readwrite', s => s.delete(id));

/* ---------- Exportar / importar projeto (.json com PDFs embutidos) ---------- */

function bufParaBase64(buf) {
  const bytes = new Uint8Array(buf);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin);
}

function base64ParaBuf(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

export async function exportarProjetoJSON(proj) {
  const pdfs = {};
  for (const p of proj.pranchas) {
    const buf = await lerPdf(p.id).catch(() => null);
    if (buf) pdfs[p.id] = bufParaBase64(buf);
  }
  return JSON.stringify({ formato: 'levantamento-obra/v1', projeto: proj, pdfs });
}

// Importa como um projeto NOVO (ids de projeto e pranchas são regenerados)
export async function importarProjetoJSON(texto) {
  const pacote = JSON.parse(texto);
  if (pacote.formato !== 'levantamento-obra/v1' || !pacote.projeto) {
    throw new Error('Arquivo não é um projeto do Levantamento de Obra.');
  }
  const proj = garantirCampos(pacote.projeto);
  proj.id = uid();
  const nomes = new Set(listarProjetos().map(i => i.nome));
  if (nomes.has(proj.nome)) proj.nome += ' (importado)';
  for (const p of proj.pranchas) {
    const idAntigo = p.id;
    p.id = uid();
    const b64 = pacote.pdfs?.[idAntigo];
    if (b64) await salvarPdf(p.id, base64ParaBuf(b64));
  }
  localStorage.setItem(prefixoProj(proj.id), JSON.stringify(proj));
  atualizarIndice(proj);
  return proj;
}

// PDFs sem prancha correspondente (ex.: prancha removida na sessão anterior —
// a remoção não apaga na hora para o desfazer continuar funcionando)
export async function limparPdfsOrfaos(idsValidos) {
  const chaves = await opPdf('readonly', s => s.getAllKeys());
  const validos = new Set(idsValidos);
  for (const k of chaves) {
    if (!validos.has(k)) await apagarPdf(k).catch(() => {});
  }
}
