// Camada de planos / assinatura (entitlement).
//
// Enquanto a monetização não está ligada (MONETIZACAO_ATIVA = false), TODO
// mundo tem acesso total — nada muda para os usuários atuais. Quando o
// pagamento existir (Fase 1 do plano de monetização), vire a chave para true:
// aí o plano passa a vir do backend (Supabase) e os recursos pagos são
// bloqueados para o plano grátis, abrindo o modal de upsell.
//
// Para testar/demonstrar sem backend, dá para forçar o plano localmente:
//   localStorage.setItem('levantamento:plano', 'pro')   // ou 'free' / 'empresa'

export const MONETIZACAO_ATIVA = false;

const CHAVE_PLANO = 'levantamento:plano';   // override local (dev/teste)
let planoCache = null;                       // preenchido por carregarPlano()

// Rótulos dos recursos pagos (aparecem no modal de upsell)
const RECURSOS = {
  ia: 'Análise por IA (visão, símbolos e paredes)',
  nuvem: 'Sincronização e backup na nuvem',
  export: 'Exportar sem marca d’água',
  obras: 'Mais de uma obra ao mesmo tempo',
};

export function planoAtual() {
  if (!MONETIZACAO_ATIVA) return 'pro';                 // ninguém bloqueado hoje
  const local = localStorage.getItem(CHAVE_PLANO);
  if (local === 'free' || local === 'pro' || local === 'empresa') return local;
  return planoCache || 'free';
}

export function ehPro() {
  const p = planoAtual();
  return p === 'pro' || p === 'empresa';
}

// Executa a ação se o recurso estiver liberado; senão abre o upsell.
// Uso: botao.addEventListener('click', () => recursoPro('ia', analisarPorVisao))
export function recursoPro(recurso, aoLiberar) {
  if (!MONETIZACAO_ATIVA || ehPro()) return aoLiberar();
  abrirUpsell(recurso);
}

export function abrirUpsell(recurso) {
  const dlg = document.getElementById('dlg-upsell');
  if (!dlg) return;
  const msg = document.getElementById('dlg-upsell-recurso');
  if (msg) {
    msg.textContent = RECURSOS[recurso]
      ? `“${RECURSOS[recurso]}” faz parte do plano Pro.`
      : 'Esse recurso faz parte do plano Pro.';
  }
  dlg.showModal();
}

// (Fase 1) Carrega o plano real do usuário logado a partir do Supabase.
// Deixado como gancho: quando a tabela `perfis` existir, faça aqui o
// GET perfis?select=plano,validade com o token do usuário e preencha planoCache.
export async function carregarPlano() {
  if (!MONETIZACAO_ATIVA) return;
  // TODO: buscar em `perfis` (Supabase) com o JWT; por ora mantém o cache.
}

// Atualiza o selo de plano na barra lateral (se existir).
export function atualizarSeloPlano() {
  const el = document.getElementById('selo-plano');
  if (!el) return;
  if (!MONETIZACAO_ATIVA) { el.hidden = true; return; }
  el.hidden = false;
  el.textContent = ehPro() ? 'Plano Pro' : 'Plano Grátis';
  el.classList.toggle('selo-pro', ehPro());
}
