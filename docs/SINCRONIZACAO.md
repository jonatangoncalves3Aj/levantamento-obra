# Sincronização com banco de dados na nuvem (Supabase)

O app funciona 100% offline, mas pode **enviar e baixar projetos de um banco
de dados na nuvem**, para acessar as mesmas obras de qualquer aparelho
(computador do escritório, notebook, celular na obra).

Usamos o [Supabase](https://supabase.com) — plano gratuito é suficiente.
A configuração leva ~5 minutos e é feita uma única vez.

## Passo 1 — Criar o projeto no Supabase

1. Acesse https://supabase.com e crie uma conta (pode entrar com GitHub).
2. Clique em **New project**, dê um nome (ex.: `levantamento-obra`), defina
   uma senha de banco qualquer e escolha a região `South America (São Paulo)`.
3. Aguarde ~1 minuto até o projeto ficar pronto.

## Passo 2 — Criar a tabela

No painel do Supabase, abra **SQL Editor** → **New query**, cole o script
abaixo e clique em **Run**:

```sql
create table public.projetos (
  id text primary key,
  nome text not null,
  atualizado_em timestamptz not null default now(),
  pacote jsonb not null
);

alter table public.projetos enable row level security;

create policy "acesso via anon key"
  on public.projetos
  for all
  using (true)
  with check (true);
```

## Passo 3 — Copiar as credenciais

No painel do Supabase, vá em **Settings** e copie:

- **Project URL** — na seção **Data API** (ex.: `https://abcdefgh.supabase.co`).
  Dica: o código na barra de endereço do navegador
  (`supabase.com/dashboard/project/abcdefgh`) é o mesmo da URL.
- **A chave pública** — na seção **API Keys**:
  - painel novo: a **Publishable key** (começa com `sb_publishable_…`);
  - painel antigo: a **anon public key** (começa com `eyJ…`).
  As duas funcionam no app.

## Passo 4 — Configurar no app

No Levantamento de Obra, clique no botão **☁** (nuvem) na barra superior,
cole a URL e a chave, e salve. Pronto:

- **Enviar para a nuvem** grava o projeto atual (com as plantas PDF) no banco;
- **Baixar da nuvem** lista os projetos salvos e importa o que você escolher;
- Enviar de novo o mesmo projeto **atualiza** a versão na nuvem.

## Segurança — leia antes de usar

A chave pública (*publishable*/*anon*) dá acesso de leitura e escrita à
tabela `projetos` para quem a possuir. Para uso pessoal/da equipe isso é aceitável (a chave fica só nos
seus aparelhos), mas **não publique a chave** em lugares públicos.
Se precisar de contas com login e permissões por usuário, o caminho é
ativar o Supabase Auth e trocar a policy acima por uma baseada em
`auth.uid()` — evolução natural desta base.

---

## Contas por usuário (login) — recomendado

Com login, cada pessoa vê **apenas os próprios projetos**, a chave pública
deixa de dar acesso aos dados, e a **sincronização automática** pode ser
ligada (o app envia o projeto para a nuvem sozinho a cada mudança).

### 1. Habilitar e-mail/senha no Supabase

Painel → **Authentication → Sign In / Providers → Email**: deixe habilitado.
Para dispensar o clique de confirmação no e-mail, desative **"Confirm email"**
(opcional, recomendado para uso interno da equipe).

### 2. Trocar as regras de acesso (SQL Editor → Run)

```sql
alter table public.projetos
  add column if not exists dono uuid default auth.uid();

drop policy if exists "acesso via anon key" on public.projetos;

create policy "dono seleciona" on public.projetos
  for select using (auth.uid() = dono);
create policy "dono insere" on public.projetos
  for insert with check (auth.uid() = dono);
create policy "dono atualiza" on public.projetos
  for update using (auth.uid() = dono);
create policy "dono apaga" on public.projetos
  for delete using (auth.uid() = dono);
```

### 3. No app

Botão **☁** → informe e-mail e senha → **Criar conta** (primeira vez) ou
**Entrar**. Depois marque **"Sincronização automática"** — o ícone vira ☁✓
e cada mudança é enviada à nuvem ~3 segundos depois de você parar de editar
(☁… enquanto envia; ☁! se falhar).

> Projetos enviados **antes** do login ficam sem dono e deixam de aparecer
> na listagem — basta abri-los localmente e clicar em "Enviar projeto
> atual" de novo depois de logado.
