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
  const limpo = { url: url.replace(/\/+$/, ''), anonKey: anonKey.trim() };
  localStorage.setItem(CHAVE_CONFIG, JSON.stringify(limpo));
  return limpo;
}

export function configurado() {
  const c = lerConfig();
  return !!(c?.url && c?.anonKey);
}

async function api(caminho, opcoes = {}) {
  const c = lerConfig();
  if (!c) throw new Error('Nuvem não configurada.');
  // Chaves legadas (JWT, "eyJ…") vão também no Authorization; as novas
  // "sb_publishable_…" usam apenas o cabeçalho apikey
  const headers = {
    apikey: c.anonKey,
    'Content-Type': 'application/json',
    ...(opcoes.headers || {}),
  };
  if (c.anonKey.startsWith('eyJ')) headers.Authorization = `Bearer ${c.anonKey}`;
  const resp = await fetch(`${c.url}/rest/v1/${caminho}`, { ...opcoes, headers });
  if (!resp.ok) {
    const corpo = await resp.text().catch(() => '');
    throw new Error(`Servidor respondeu ${resp.status}: ${corpo.slice(0, 200)}`);
  }
  return resp;
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
