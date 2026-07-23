# Prumo IA — guia do projeto

**Prumo IA** (antes "Levantamento de Obra") — app web (PWA) de levantamento de
quantitativos de obra a partir de plantas em PDF, inspirado num app visto em
reel do Instagram e expandido para coordenação de obra completa. Interface
100% em pt-BR. O nome só mudou na marca (título, manifest, ícone); o
repositório e a URL do GitHub Pages continuam `levantamento-obra`.
Identidade: acento **dourado** (`--laranja*` guardam o dourado da marca) e
fundo **azul-marinho**; slogan "Inteligência que constrói precisão". Ícone é
PNG (`icons/icon-192/512`, sem mais `icon.svg`); fontes da marca em
`docs/marca/`.

- **App no ar:** https://jonatangoncalves3aj.github.io/levantamento-obra/
- **Repositório:** jonatangoncalves3Aj/levantamento-obra (branch `main`)
- **App irmão:** jonatangoncalves3Aj/dimensionamento-saneamento (dimensionamento
  de saneamento — projeto separado, não misturar)
- **Versão atual:** 4.8 (o rodapé da sidebar mostra a versão — atualize a cada release)

## O que o app faz

1. **Planta**: importa PDFs (multi-página → uma prancha por página, com
   pavimento e disciplina), lê ambientes da camada de texto (nome, área, PD),
   ou por **IA de visão** quando escaneada; calibra escala (cota ou carimbo);
   mede lado/perímetro/linear/contagem com snap ortogonal; pins arrastáveis;
   **destaca as linhas reais do CAD** e faz as ferramentas grudarem (snap) nos
   cantos/linhas exatos (`linhas.js`) — perímetro preciso; a **IA traça as
   paredes** em rascunho, refinado pelo snap; pendências de compatibilização;
   **sobreposição** translúcida de outra disciplina (mesa de luz).
2. **Tabela**: quantitativos por pavimento (paredes com desconto de vãos:
   porta/correr desconta sempre, janela só se > 2,00 m²), CSV/XLSX/PDF.
3. **Orçamento**: serviços com quantidades vivas do levantamento, curva ABC,
   BDI, importação de preços por CSV.
4. **Instalações**: quantificação paramétrica de elétrica/hidrossanitária por
   ambiente (regras NBR 5410 simplificadas em `js/instalacoes.js`) +
   revestimentos por área molhada/seca; botão que alimenta o orçamento.
   Em pranchas de Elétrica/Hidráulica a IA **conta símbolos** e cria
   medições de contagem com pins.
5. **Avanço**: % físico por ambiente (ponderado por área), curva S
   planejado × real com snapshots diários.
6. **RDO**: diário de obra (clima, efetivo, atividades) com PDF por dia.
7. **Nuvem**: Supabase com login e-mail/senha, RLS por dono, auto-sync com
   debounce de 3 s e detecção de conflito entre aparelhos.

## Stack e decisões (mantenha!)

- **Vanilla HTML/CSS/JS com ES modules — sem framework, sem build, sem npm.**
  Tudo roda abrindo `index.html` num servidor estático.
- **Bibliotecas vendorizadas** em `vendor/` (nunca CDN em runtime): pdf.js
  4.6.82 (`pdf.min.mjs` + worker), SheetJS (`xlsx.full.min.js`), jsPDF +
  autotable, fonte Inter variável (`inter-latin.woff2`).
- **PWA offline-first**: `sw.js` com estratégia rede-primeiro (cache
  `levantamento-vN` — **incremente o N a cada release** e liste todo asset
  novo em `ASSETS`). Só intercepta GET da própria origem.
- **CSP** no `index.html`: `script-src 'self'`; `connect-src` só Supabase e
  Anthropic. Sem script inline (o registro do SW fica no fim de `app.js`).
- **Segurança**: dados de usuário/arquivo/nuvem entram no DOM **sempre via
  `textContent`** — nunca interpolar em `innerHTML` (as chaves de API ficam
  no localStorage; XSS = roubo de chave). `innerHTML` só para HTML estático.
- **Persistência**: projetos em `localStorage`
  (`levantamento:v2:proj:<id>`, índice `levantamento:v2:indice`, ativo
  `levantamento:v2:ativo`); bytes dos PDFs em IndexedDB (`levantamento`,
  store `pdfs`, chave = id da prancha). Config nuvem `levantamento:nuvem`,
  sessão `levantamento:sessao`, marcas de sync `levantamento:nuvem:marcas`,
  chave IA `levantamento:ia`.
- **Idioma**: código, comentários, UI e commits em pt-BR.
- **Números BR**: use `num()`/`fmt()` de `calc.js` (entendem "1.234,56").

## Mapa dos módulos (`js/`)

| Arquivo | Responsabilidade |
|---|---|
| `app.js` | módulo principal: inicialização, abas, importação, ferramentas de desenho, sidebar/cards, vistas, PWA, diálogos (nuvem, IA), atalhos |
| `store.js` | estado global, modelo de dados, persistência, histórico (undo), multi-projeto, export/import .json com PDFs embutidos |
| `viewer.js` | render do PDF (com cancelamento), overlay SVG (pins, medições, pendências), sobreposição de disciplina, zoom/ajuste |
| `deteccao.js` | heurística da camada de texto: ambientes (nome/área/PD) e escala do carimbo; `inspecionarTexto()` (tem texto? é instalação?) |
| `linhas.js` | geometria vetorial real do PDF (reconstruída da lista de operadores do pdf.js): destaque das linhas do CAD + **snap** das ferramentas de medição nos cantos/linhas exatos (`extrairSegmentos`/`snapPonto`, índice espacial de cantos, cache por prancha). Só PDF vetorial |
| `ia.js` | Anthropic API direto do navegador (modelo escolhido pelo usuário via `MODELOS_IA`/`lerModeloIA`, default `claude-haiku-4-5` = mais barato; saída JSON Schema, header `anthropic-dangerous-direct-browser-access`): ambientes por visão e contagem de símbolos por disciplina. Chave+modelo em `localStorage['levantamento:ia']` = `{chave, modelo}` |
| `calc.js` | `num`/`fmt` BR, distâncias, shoelace, escala (72/0,0254 pt por metro), `calcAmbiente` (paredes e desconto de vãos) |
| `conta.js` | camada de planos/assinatura (entitlement). `MONETIZACAO_ATIVA` (hoje `false` = todos têm acesso total, nada bloqueia); `ehPro()`/`recursoPro(recurso, fn)` gateiam recursos pagos (IA, nuvem…) abrindo o modal `#dlg-upsell`. Quando o pagamento existir, `carregarPlano()` lê o plano no Supabase e vira a flag. Override local p/ teste: `localStorage['levantamento:plano']` |
| `tabela.js` | vista Tabela + CSV |
| `orcamento.js` | vista Orçamento, `FONTES` de quantidade (inclui `inst:*` e revestimentos molhado/seco), ABC, BDI, CSV de preços |
| `instalacoes.js` | classificação de ambientes, regras paramétricas, totais, vista Instalações, envio ao orçamento |
| `avanco.js` | vista Avanço + curva S (cores validadas p/ fundo escuro: real `#ea580c`, planejado `#3b82f6`) |
| `rdo.js` | diário de obra + PDF |
| `exportar-xlsx.js` | XLSX 3 abas (células de fórmula precisam de `{f, t, v}` — SheetJS descarta fórmula sem valor) |
| `relatorio.js` | relatório PDF completo (capa, resumo, quantitativos, ABC, curva S, pendências) |
| `nuvem.js` | Supabase REST: auth (entrar/cadastrar/refresh), envio/baixa de projetos, auto-sync 3 s, **conflito** (marca `atualizado_em` por projeto; `enviarProjeto(forcar)`). Trava de login opcional (`exigeLogin`/`definirExigeLogin`/`sessaoAtiva`) — overlay `#tela-login` no `index.html`, gate no fim de `app.js`. NB: é gate client-side (soft) num site estático público; a proteção real dos dados é o RLS |

Modelo de dados: `projeto { pranchas[], pavimentos[], catalogo[], bdi,
dataInicio/Fim, snapshots[], rdos[] }` → `prancha { pavimento, disciplina,
escala{pxPorMetro}, ambientes[], medicoes[], pendencias[], regiaoIA? }` → `ambiente
{ nome, pin{x,y}, area, areaOrigem('planta'|'medida'|'manual'|'ia'), lado,
perimetro, pdOsso, pdAcab, vaos[], qtd, avanco, tipoInst?, pavimento? }`.
`ambiente.pavimento` e `medicao.pavimento` são overrides opcionais (folha
com vários pavimentos desenhados — ferramenta "Separar pavimentos"); o
efetivo vem de `pavimentoDoAmbiente()`/`ambientesPorPavimento()` no store —
**agrupe sempre por eles**, nunca direto por `prancha.pavimento`.
Medições (`prancha.medicoes[]`) têm tipos `linear`, `contagem` e `parede`
(`{tipo:'parede', classe:'interna'|'externa', pd, pontos[]}` — área =
comprimento×PD, somada por `totaisParedes()` no store; fontes de orçamento
`paredeInterna`/`paredeExterna`). Paredes **e** medições lineares são
editáveis na planta: alças `[data-vertice="id:i"]` nos vértices (renderizadas
sem ferramenta ativa; arraste com snap quando o destaque de linhas está
ligado). Pontos de **contagem** também são alças: arraste p/ mover, **Alt+
clique** exclui só aquele ponto (medição some quando fica sem pontos).
Paredes têm o botão ⇄ (alterna interna/externa) e, com 3+ vértices, o botão
⬠ `fecharParedeComoComodo()` que cria um ambiente com área (shoelace) e
perímetro do contorno fechado. `projeto.peDireitoPadrao` é o PD default.
`prancha.regiaoIA` (opcional, `{x1,y1,x2,y2}` em coords base) restringe
**toda** análise por IA a um retângulo — folha com planta baixa + unifilar +
detalhes junto (ferramenta "Região para a IA"). Vale para ambientes
(`analisarComIA`), símbolos (`analisarSimbolosIA`) e paredes
(`tracarParedesIA`); o helper `entradaComRegiao()` no `ia.js` manda a folha
inteira (contexto/legenda) + o recorte da região e devolve `mapa()` que
converte as frações do recorte de volta para coords base.
Campos novos: adicione migração em `garantirCampos()` no store.

## Integrações

- **Supabase**: tabela `public.projetos (id text pk, nome, atualizado_em,
  pacote jsonb, dono uuid default auth.uid())` com RLS por dono (guia
  completo com SQL em `docs/SINCRONIZACAO.md`). Chave `sb_publishable_` vai
  só no header `apikey`; chave legada `eyJ` também no `Authorization`.
  Logado, o token do usuário autentica.
- **Anthropic**: chave do usuário salva só no aparelho (diálogo
  "Configurar chave de IA"). Nunca commitar chaves. Modelo `claude-opus-4-8`.

## Como rodar e testar

```bash
# servir localmente
python3 -m http.server 8903   # na raiz do repo → http://localhost:8903/

# testes: Playwright + Chromium, padrão usado no projeto
# - PDFs sintéticos gerados com pdf-lib (planta com "LAVANDERIA 24,75 m²",
#   "WC DE APOIO 4,55 m²", cota de 5,00 m e carimbo ESC. 1:50 em folha 842×595;
#   versão "escaneada" = só retângulos, sem camada de texto)
# - launchPersistentContext com args ['--no-sandbox','--disable-web-security'],
#   serviceWorkers: 'block'
# - mocks via page.route: api.anthropic.com (responder pelo esquema pedido:
#   properties.itens → símbolos; senão → ambientes) e *.supabase.co
#   (headers CORS liberados, tratar OPTIONS)
# - handler de dialog para prompts/confirms
```

Fluxo de teste típico: importar PDF → confirmar diálogo → `#btn-analisar` →
escala pelo carimbo → verificar cards/tabelas. Sempre rodar o app inteiro no
navegador antes de commitar (sem `pageerror`).

## Deploy

Push na `main` → GitHub Actions (`.github/workflows/pages.yml`) publica no
GitHub Pages automaticamente (~1 min). Checklist de release:

1. Bump do cache no `sw.js` (`levantamento-vN`) + assets novos no `ASSETS`.
2. Bump da versão no rodapé (`#versao-app` no `index.html`).
3. Testes Playwright passando, sem erros de página.
4. Commit em pt-BR descrevendo o quê e por quê; push na `main`.

## Backlog / ideias já discutidas

- Regras paramétricas de instalações configuráveis pelo usuário (hoje fixas
  em `instalacoes.js` — o usuário pode querer os próprios índices).
- Cruzar escala do carimbo com uma cota calibrada e avisar divergência
  (pega PDF "ajustado à página").
- Aviso no diálogo da nuvem quando estiver no modo aberto (sem login).
- Detecção: catálogo de símbolos por legenda da prancha (a IA lê a legenda
  primeiro e usa como referência de contagem).
- Modo claro para uso sob sol de obra.
- Editar/excluir pontos individuais de uma contagem.

## Armadilhas conhecidas

- pdf.js: nunca dois `render()` no mesmo canvas — cancele `tarefaRender`
  antes (já implementado em `viewer.js`; siga o padrão).
- `beforeinstallprompt` não dispara em iOS/alguns Androids — o botão
  Instalar cai num diálogo de instruções.
- Projetos baixados da nuvem ganham **id novo** (import = projeto novo).
- A policy aberta do Supabase (passo 2 do guia) é só para teste — o modo
  real é com login e RLS por dono (seção final do guia).
