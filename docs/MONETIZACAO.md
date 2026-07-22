# Monetização — passo a passo (Stripe + Cloudflare)

Guia para você (solo) deixar as contas prontas. Não precisa saber programar:
é só criar as contas, copiar alguns valores e me entregar (a parte final tem a
lista do que copiar). Faça **tudo primeiro no modo de teste** — nada cobra de
verdade até você virar para produção.

Ordem recomendada: **1) Stripe** → **2) Cloudflare** → me enviar os valores →
eu escrevo o Worker e ligo tudo no app.

---

## Parte A — Stripe (cobrança da assinatura)

### A1. Criar a conta
1. Acesse **https://dashboard.stripe.com/register**.
2. Cadastre com seu e-mail e crie a senha.
3. Em "País da empresa" escolha **Brasil**.
4. Confirme o e-mail que a Stripe enviar.

> Você já cai no **modo de teste** (há uma chavinha "Modo de teste"/"Test mode"
> no topo). Deixe **ligado** por enquanto — dá para montar tudo sem CNPJ.

### A2. (Depois) Ativar a conta para receber de verdade
Só é necessário quando for cobrar valendo. Vai pedir:
- **CNPJ** (MEI serve) e dados da empresa;
- seus dados pessoais (responsável);
- **conta bancária** PJ para receber os repasses.
Faça isso quando o teste estiver aprovado. Até lá, siga no modo de teste.

### A3. Criar o produto e o preço (a assinatura Pro)
1. Menu lateral → **Catálogo de produtos** (Product catalog) → **+ Adicionar
   produto**.
2. Nome: `Pro` · Descrição: `Levantamento de Obra — plano Pro`.
3. Em **Preço**: modelo **Recorrente** (Recurring), valor **R$ 49,00**,
   período **Mensal**.
4. Salvar. Abra o preço criado e **copie o "ID do preço"** — começa com
   `price_...`. **Guarde** (vou precisar).

### A4. Pegar as chaves de API (modo teste)
1. Menu → **Desenvolvedores** (Developers) → **Chaves de API** (API keys).
2. Copie:
   - **Chave publicável** (Publishable key): `pk_test_...`
   - **Chave secreta** (Secret key): `sk_test_...` (clique em "Revelar").
3. **Guarde as duas.** A secreta é sigilosa — nunca cole em lugar público nem
   me mande por canal aberto (veja a Parte C).

### A5. Configurar o webhook (a Stripe avisa o servidor quando alguém paga)
> Você só consegue terminar este passo **depois** de ter a URL do Cloudflare
> (Parte B). Deixe anotado para voltar aqui.
1. Menu → **Desenvolvedores** → **Webhooks** → **+ Adicionar endpoint**.
2. Em "URL do endpoint" cole: `https://SEU-WORKER.workers.dev/api/webhook`
   (a URL sai na Parte B; se usar domínio próprio, `https://api.seusite.com.br/api/webhook`).
3. Em "Eventos a escutar" selecione:
   - `checkout.session.completed`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
4. Salvar. Abra o endpoint e copie o **"Signing secret"** — começa com
   `whsec_...`. **Guarde.**

### A6. Ligar o Portal do Cliente (cancelar/trocar cartão)
1. Menu → **Configurações** (Settings) → **Faturamento** → **Portal do
   cliente** (Customer portal).
2. Ative e permita "cancelar assinatura" e "atualizar forma de pagamento".
3. Salvar. (Não precisa copiar nada — o Worker gera o link.)

> **Pix:** a Stripe aceita Pix para pagamento avulso, mas **assinatura
> recorrente** funciona melhor no **cartão**. Recomendo começar só com cartão
> e, se quiser Pix recorrente depois, avaliamos o Mercado Pago como alternativa.

---

## Parte B — Cloudflare (o servidor que protege as chaves)

O "servidor" é um **Worker** (função na borda, tem plano grátis). Duas formas:
pelo **site** (mais simples) ou pelo **terminal** (Wrangler). Descrevo as duas;
escolha uma.

### B1. Criar a conta
1. Acesse **https://dash.cloudflare.com/sign-up**.
2. Cadastre com e-mail e senha, confirme o e-mail.
3. Não precisa comprar domínio agora (dá para usar o endereço grátis
   `*.workers.dev`).

### B2a. Caminho SITE (sem terminal) — recomendado para começar
1. No painel, menu lateral → **Workers e Pages** (Workers & Pages) →
   **Criar aplicativo** → **Criar Worker**.
2. Dê um nome, ex.: `levantamento-api`. Ele já sugere a URL final:
   `https://levantamento-api.SEU-USUARIO.workers.dev` — **anote essa URL**
   (é a que vai no webhook da Stripe, passo A5).
3. Clique **Implantar** (Deploy) para criar o esqueleto. Depois eu te mando o
   código para você **colar** em "Editar código" (Edit code) e reimplantar.
4. **Segredos (variáveis):** abra o Worker → **Configurações** (Settings) →
   **Variáveis e segredos** (Variables and Secrets) → adicione como **Secret**
   (tipo "Encrypt"): 
   - `STRIPE_SECRET_KEY` = `sk_test_...`
   - `STRIPE_WEBHOOK_SECRET` = `whsec_...`
   - `STRIPE_PRICE_ID` = `price_...`
   - `SUPABASE_URL` = `https://xxxx.supabase.co`
   - `SUPABASE_SERVICE_ROLE` = (chave "service_role" do Supabase — veja B3)
   - `ANTHROPIC_KEY` = `sk-ant-...` (sua chave mestra da IA — só na Fase 2)
   - Salvar.

### B2b. Caminho TERMINAL (Wrangler) — para quem prefere
1. Instale o Node.js (https://nodejs.org, versão LTS).
2. No terminal: `npm install -g wrangler` e depois `wrangler login` (abre o
   navegador para autorizar).
3. Quando eu te entregar a pasta `worker/`, você roda dentro dela:
   - `wrangler secret put STRIPE_SECRET_KEY` (cola o valor quando pedir) — e
     idem para os outros segredos da lista acima;
   - `wrangler deploy` (publica e mostra a URL `*.workers.dev`).

### B3. Pegar a chave "service_role" do Supabase
(O Worker precisa dela para gravar o plano do usuário com segurança.)
1. No painel do **Supabase** → seu projeto → **Project Settings** → **API**.
2. Em "Project API keys", copie a **`service_role`** (a secreta, não a `anon`).
   **Guarde** — é sigilosa, fica **só** no Worker, **nunca** no app/navegador.

### B4. (Opcional) Domínio próprio
Se comprar um domínio (ex.: na Registro.br), dá para apontar
`api.seusite.com.br` para o Worker (mais confiança que `workers.dev`). Passo:
Worker → **Configurações** → **Domínios e rotas** (Domains & Routes) → adicionar
domínio. Podemos deixar para depois.

---

## Parte C — o que me entregar (checklist)

Quando terminar, junte estes valores. **Os marcados com 🔒 são secretos** —
me passe por um canal privado (mensagem direta), nunca em print público nem
commitado no repositório:

| Valor | De onde | Exemplo |
|---|---|---|
| Chave publicável Stripe | A4 | `pk_test_...` |
| 🔒 Chave secreta Stripe | A4 | `sk_test_...` |
| ID do preço Pro | A3 | `price_...` |
| 🔒 Signing secret do webhook | A5 | `whsec_...` |
| URL do Worker | B2a passo 2 | `https://...workers.dev` |
| URL do Supabase | já tem | `https://xxxx.supabase.co` |
| 🔒 service_role do Supabase | B3 | `eyJ...` (longa) |
| 🔒 Chave mestra Anthropic (Fase 2) | console.anthropic.com | `sk-ant-...` |

Com isso eu: escrevo o Worker (`/api/checkout`, `/api/webhook` e, na Fase 2,
`/api/ia`), crio a tabela `perfis` no Supabase, troco o botão "Assinar Pro"
pela chamada real, ligo a flag `MONETIZACAO_ATIVA` e testo de ponta a ponta no
sandbox da Stripe (cartão de teste `4242 4242 4242 4242`).

---

## Segurança (importante)
- As chaves **secretas** (🔒) ficam **só no Worker** (Cloudflare) como
  *secrets* — nunca no código do app, nunca no navegador, nunca no Git.
- A chave `anon`/`publishable` do Supabase e a `pk_test_` da Stripe **podem**
  ficar no app (são públicas por design).
- Enquanto estiver no **modo de teste**, ninguém é cobrado; use os cartões de
  teste da Stripe. Só vire para produção depois de validar o fluxo inteiro.
