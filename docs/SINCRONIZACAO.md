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

No painel do Supabase, vá em **Settings → API** e copie:

- **Project URL** (ex.: `https://abcdefgh.supabase.co`)
- **anon public key** (um texto longo começando com `eyJ…`)

## Passo 4 — Configurar no app

No Levantamento de Obra, clique no botão **☁** (nuvem) na barra superior,
cole a URL e a chave, e salve. Pronto:

- **Enviar para a nuvem** grava o projeto atual (com as plantas PDF) no banco;
- **Baixar da nuvem** lista os projetos salvos e importa o que você escolher;
- Enviar de novo o mesmo projeto **atualiza** a versão na nuvem.

## Segurança — leia antes de usar

A chave *anon* dá acesso de leitura e escrita à tabela `projetos` para quem
a possuir. Para uso pessoal/da equipe isso é aceitável (a chave fica só nos
seus aparelhos), mas **não publique a chave** em lugares públicos.
Se precisar de contas com login e permissões por usuário, o caminho é
ativar o Supabase Auth e trocar a policy acima por uma baseada em
`auth.uid()` — evolução natural desta base.
