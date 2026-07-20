// Sincronização com banco de dados na nuvem (Supabase) — opcional.
// O usuário informa a URL do projeto Supabase e a chave anon; os projetos
// são enviados/baixados como pacote completo (JSON com PDFs embutidos).
// Instruções de criação do banco: docs/SINCRONIZACAO.md

import { state, exportarProjetoJSON, importarProjetoJSON } from './store.js';

const CHAVE_CONFIG = 'levantamento:nuvem';

export function lerConfig() {
  try { return JSON.parse(localStorage.getItem(CHAVE_CONFIG)) || null; }
  catch { return null; }
}

export function salvarConfig(url, anonKey) {
  const atual = lerConfig() || {};
  const limpo = { ...atual, url: url.replace(/\/+$/, ''), anonKey: anonKey.trim() };
  localStorage.setItem(CHAVE_CONFIG, JSON.stringify(limpo));
  return limpo;
}

export function configurado() {
  const c = lerConfig();
  return !!(c?.url && c?.anonKey);
}

/* ---------- Conta (Supabase Auth, e-mail + senha) ---------- */

const CHAVE_SESSAO = 'levantamento:sessao';

export function lerSessao() {
  try { return JSON.parse(localStorage.getItem(CHAVE_SESSAO)) || null; }
  catch { return null; }
}

function gravarSessao(dados) {
  if (!dados) { localStorage.removeItem(CHAVE_SESSAO); return null; }
  const sessao = {
    access_token: dados.access_token,
    refresh_token: dados.refresh_token,
    expira_em: Date.now() + (dados.expires_in ?? 3600) * 1000,
    email: dados.user?.email || lerSessao()?.email || '',
  };
  localStorage.setItem(CHAVE_SESSAO, JSON.stringify(sessao));
  return sessao;
}

async function authFetch(caminho, corpo) {
  const c = lerConfig();
  if (!c) throw new Error('Configure a URL e a chave primeiro.');
  const resp = await fetch(`${c.url}/auth/v1/${caminho}`, {
    method: 'POST',
    headers: { apikey: c.anonKey, 'Content-Type': 'application/json' },
    body: JSON.stringify(corpo),
  });
  const dados = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    const msg = dados.msg || dados.error_description || dados.message || `erro ${resp.status}`;
    throw new Error(msg);
  }
  return dados;
}

export async function entrar(email, senha) {
  const dados = await authFetch('token?grant_type=password', { email, password: senha });
  return gravarSessao(dados);
}

export async function cadastrar(email, senha) {
  const dados = await authFetch('signup', { email, password: senha });
  if (dados.access_token) return gravarSessao(dados);
  return null; // confirmação por e-mail pendente
}

export function sair() { gravarSessao(null); }

async function tokenValido() {
  let s = lerSessao();
  if (!s) return null;
  if (Date.now() > s.expira_em - 60_000) {
    try {
      const dados = await authFetch('token?grant_type=refresh_token', { refresh_token: s.refresh_token });
      s = gravarSessao(dados);
    } catch {
      gravarSessao(null);
      throw new Error('Sessão expirou — entre novamente.');
    }
  }
  return s.access_token;
}

async function api(caminho, opcoes = {}) {
  const c = lerConfig();
  if (!c) throw new Error('Nuvem não configurada.');
  const headers = {
    apikey: c.anonKey,
    'Content-Type': 'application/json',
    ...(opcoes.headers || {}),
  };
  // Logado: o token do usuário autentica (RLS por dono). Sem login:
  // modo legado — chave JWT antiga vai no Authorization; sb_publishable_ não.
  const token = await tokenValido();
  if (token) headers.Authorization = `Bearer ${token}`;
  else if (c.anonKey.startsWith('eyJ')) headers.Authorization = `Bearer ${c.anonKey}`;
  const resp = await fetch(`${c.url}/rest/v1/${caminho}`, { ...opcoes, headers });
  if (!resp.ok) {
    const corpo = await resp.text().catch(() => '');
    throw new Error(`Servidor respondeu ${resp.status}: ${corpo.slice(0, 200)}`);
  }
  return resp;
}

// Testa credenciais e existência da tabela, com diagnóstico amigável
export async function testarConexao() {
  const c = lerConfig();
  if (!c?.url || !c?.anonKey) return { ok: false, msg: 'Preencha a URL e a chave.' };
  if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(c.url)) {
    return { ok: false, msg: `URL fora do padrão esperado (https://xxxx.supabase.co): "${c.url}"` };
  }
  let resp;
  try {
    resp = await fetch(`${c.url}/rest/v1/projetos?select=id&limit=1`, {
      headers: {
        apikey: c.anonKey,
        ...(c.anonKey.startsWith('eyJ') ? { Authorization: `Bearer ${c.anonKey}` } : {}),
      },
    });
  } catch {
    return { ok: false, msg: 'Não consegui conectar — confira a URL e sua internet.' };
  }
  if (resp.ok) {
    const linhas = await resp.json().catch(() => []);
    return { ok: true, msg: `Conexão OK — tabela "projetos" encontrada (${linhas.length ? 'já há projeto salvo' : 'vazia, pronta para uso'}).` };
  }
  const corpo = await resp.text().catch(() => '');
  if (resp.status === 401 || resp.status === 403) {
    return { ok: false, msg: 'Chave recusada pelo servidor — confira se copiou a Publishable key (sb_publishable_…) inteira.' };
  }
  if (resp.status === 404 || corpo.includes('PGRST205') || corpo.includes('does not exist')) {
    return { ok: false, msg: 'Conectou, mas a tabela "projetos" não existe — rode o script SQL do guia (passo 2) no SQL Editor.' };
  }
  return { ok: false, msg: `Servidor respondeu ${resp.status}: ${corpo.slice(0, 160)}` };
}

// Envia (cria ou atualiza) o projeto atual
export async function enviarProjeto() {
  const proj = state.projeto;
  const pacote = await exportarProjetoJSON(proj);
  await api('projetos', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates' },
    body: JSON.stringify({
      id: proj.id,
      nome: proj.nome,
      atualizado_em: new Date().toISOString(),
      pacote: JSON.parse(pacote),
    }),
  });
}

// Lista os projetos salvos na nuvem (sem baixar os pacotes)
export async function listarNuvem() {
  const resp = await api('projetos?select=id,nome,atualizado_em&order=atualizado_em.desc');
  return resp.json();
}

// Baixa um projeto da nuvem e importa como projeto local (novo id)
export async function baixarProjeto(id) {
  const resp = await api(`projetos?id=eq.${encodeURIComponent(id)}&select=pacote`);
  const linhas = await resp.json();
  if (!linhas.length) throw new Error('Projeto não encontrado na nuvem.');
  return importarProjetoJSON(JSON.stringify(linhas[0].pacote));
}

// Remove um projeto da nuvem
export async function apagarNuvem(id) {
  await api(`projetos?id=eq.${encodeURIComponent(id)}`, { method: 'DELETE' });
}

/* ---------- Sincronização automática (push com debounce) ---------- */

let timerSync = null;
let notificarEstado = () => {};

export function autoSyncAtivo() {
  return !!lerConfig()?.autoSync && !!lerSessao();
}

export function definirAutoSync(ligado) {
  const c = lerConfig() || {};
  c.autoSync = !!ligado;
  localStorage.setItem(CHAVE_CONFIG, JSON.stringify(c));
}

export function iniciarAutoSync(aoMudarEstado) {
  notificarEstado = aoMudarEstado || (() => {});
}

// Chamado a cada salvamento local; agrupa mudanças e envia após 3 s de pausa
export function agendarSync() {
  if (!autoSyncAtivo()) return;
  clearTimeout(timerSync);
  notificarEstado('pendente');
  timerSync = setTimeout(async () => {
    notificarEstado('enviando');
    try {
      await enviarProjeto();
      notificarEstado('ok');
    } catch (e) {
      notificarEstado('erro', e.message);
    }
  }, 3000);
}
