# Plano de App — "Levantamento de Obra" (quantitativos a partir de plantas em PDF)

> Planejamento baseado na análise do reel do Instagram enviado pelo usuário
> (vídeo "Engenheiro: o Claude vai aposentar o CAD"). O vídeo demonstra um
> app web de levantamento de quantitativos de obra que lê plantas em PDF,
> detecta ambientes automaticamente com IA, permite calibrar escala e medir
> sobre a planta, e consolida tudo numa tabela de quantitativos com
> subtotais por pavimento.

---

## 1. O que o vídeo mostra (funcionalidades observadas)

O engenheiro do vídeo pede ao Claude: *"Me ajuda no levantamento da minha
obra com essas plantas — e cria um sistema replicável pra qualquer obra"*,
anexando 2 PDFs de projeto (ex.: `FCA-160-PE-1101-CIV-INF-00.pdf` e
`FCA-160-PE-1102-CIV-TER-00.pdf`). O resultado é um app chamado
**"Levantamento de Obra"** com o seguinte fluxo:

### 1.1 Gestão de pranchas (folhas de projeto)
- Botão **"+ Pranchas"** para abrir PDFs do projeto (várias de uma vez).
- Cada prancha vira uma **aba** (ex.: "Subsolo · 19", "Térreo") com contador
  de ambientes.
- Ao importar, um diálogo pede para classificar cada prancha:
  - **Pavimento** (Subsolo, Térreo, …)
  - **Disciplina**: Arquitetura, Estrutura, Fundação, Hidráulica, Elétrica,
    Climatização.

### 1.2 Passo 0 — Automático (beta): "Analisar planta"
- A IA lê a prancha de Arquitetura e detecta os **ambientes**: nome, área e
  pé-direito escritos na planta.
- Feedback exibido no vídeo: *"Li 19 ambiente(s) — nome, área e pé-direito
  preenchidos. Total = 549,50 m². Confira os pins azuis, ajuste nomes e
  apague o que não for ambiente."*
- Cada ambiente vira um **pin/etiqueta azul** sobre a planta (ex.: "ESPELHO
  D'ÁGUA | TANQUE 30,80 m²", "WC DE APOIO 4,55 m²", "PÁTIO DE SERVIÇOS
  46,05 m²", "DEPÓSITO GARAGEM 23,30 m²"…), editável e removível.

### 1.3 Passo 1 — Escala (calibrar)
- **Calibrar escala**: o usuário desenha uma linha sobre uma cota conhecida
  da planta e o app pergunta *"Qual o comprimento real da linha que você
  acabou de marcar?"* (ex.: 12,00 m) → calcula px/m.
- Alternativa: **"Pela escala do carimbo"** (lê a escala declarada no
  carimbo da prancha, ex. 1:50).
- Aviso persistente enquanto não calibrado: *"Escala não definida — calibre
  sobre uma cota conhecida."*

### 1.4 Passo 2 — Medir
Ferramentas de medição sobre a planta (após selecionar um ambiente pelo
card ou pin):
- **Lado (retâng.)** — mede lados de ambiente retangular;
- **Perímetro** — traça polígono e obtém perímetro;
- **Linear** — medição linear avulsa;
- **Contagem** — contador de itens (portas, luminárias, pontos etc.).
- Zoom (−/+/percentual), **Ajustar** (fit), toggle **Nomes**.

### 1.5 Painel de ambientes (cards laterais)
Cada ambiente tem um card com campos:
- Nome (ex.: LAVANDERIA), origem da área ("da planta — Área 24,75 m²");
- **Lado (m)**, **Perímetro (m)**;
- **PD osso** e **PD acab.** (pé-direito bruto e acabado, ex. 2,5 m);
- **Parede acab.**;
- **Vãos** (botão "+ vão") com regra de desconto exibida no card:
  *"Porta/correr desconta sempre — janela só desconta se > 2,00 m²"*.

### 1.6 Visão Tabela (planilha de quantitativos)
- Alternância **Planta | Tabela** no topo.
- Colunas observadas: Ambiente, Área (m²), Lado (m), Perímetro (m),
  PD osso, PD acab., Parede bruta (m²), nº vãos, desc. vãos (m²),
  Parede acab. (m²), Parede líq. (m²), Qtd.
- Cálculo automático: parede bruta = perímetro × pé-direito; o app
  **desconta os vãos automaticamente** conforme a regra acima.
- **Subtotal por pavimento** (ex.: "Subtotal — Subsolo: 540,50 m²") e
  totais gerais.

---

## 2. Objetivo do app a construir

Replicar esse fluxo como um módulo/app web **"Levantamento de Obra"**:
levantamento de quantitativos (áreas, perímetros, paredes, contagens) a
partir de plantas em PDF, com detecção automática de ambientes por IA
(opcional), medição manual calibrada e exportação de planilha — 100%
client-side, seguindo o padrão do repositório atual (HTML + CSS + JS puro,
PWA, pt-BR, offline-first).

**Público**: engenheiros e orçamentistas que hoje fazem levantamento no
AutoCAD ou manualmente sobre PDF impresso.

---

## 3. Arquitetura proposta

### 3.1 Stack (alinhada ao repositório existente)
| Camada | Escolha | Justificativa |
|---|---|---|
| UI | HTML + CSS + JS vanilla (sem framework) | mesmo padrão do app de saneamento; PWA instalável |
| Render de PDF | **pdf.js** (Mozilla) via CDN/local | renderiza cada página num `<canvas>`; extrai texto com coordenadas |
| Overlay de medição | `<canvas>`/SVG sobreposto ao canvas do PDF | pins, polígonos, linhas de calibração |
| Detecção automática de ambientes | 1º estágio: **camada de texto do pdf.js** (heurística local, sem IA); 2º estágio (opcional): API Claude (`claude-sonnet-5`) com visão para plantas rasterizadas | o texto vetorial do PDF já traz nome/área/PD na maioria das plantas de arquitetura; IA só quando o PDF é imagem |
| Persistência | `localStorage`/IndexedDB (projetos, pranchas, medições) | offline-first, como o app atual |
| Exportação | CSV e XLSX (SheetJS) + impressão/​PDF via CSS print | entrega a planilha final do levantamento |

### 3.2 Modelo de dados
```js
Projeto {
  id, nome, criadoEm,
  pranchas: [Prancha],
}
Prancha {
  id, arquivoNome, pagina,
  pavimento,            // "Subsolo", "Térreo", ...
  disciplina,           // "Arquitetura" | "Estrutura" | "Fundação" |
                        // "Hidráulica" | "Elétrica" | "Climatização"
  escala: { pxPorMetro, origem: "cota" | "carimbo" | null },
  ambientes: [Ambiente],
  medicoesAvulsas: [Medicao],   // lineares e contagens sem ambiente
}
Ambiente {
  id, nome,
  area,  areaOrigem,     // "planta" (lida) | "medida" | "manual"
  pin: {x, y},
  lado, perimetro,
  pdOsso, pdAcab,
  vaos: [{ tipo: "porta" | "janela" | "correr", largura, altura, qtd }],
  qtd,                   // multiplicador (ambientes repetidos)
}
```

### 3.3 Regras de cálculo (as do vídeo)
- `paredeBruta = perimetro × pdAcab`
- Desconto de vãos: **porta e porta de correr descontam sempre**;
  **janela só desconta se área > 2,00 m²** (regra configurável).
- `descVaos = Σ (vãos que descontam: largura × altura × qtd)`
- `paredeLiq = paredeBruta − descVaos`
- Subtotais por pavimento e total geral (áreas e paredes).

---

## 4. Telas e fluxo de uso

1. **Início / Projetos** — lista de projetos salvos, "Novo levantamento".
2. **Tela principal** (a do vídeo):
   - Topbar: título "Levantamento de Obra", alternância **Planta | Tabela**,
     zoom (− % +), **Ajustar**, toggle **Nomes**, botão laranja
     **"+ Pranchas"**.
   - Abas de pranchas com contagem de ambientes e botão fechar.
   - **Viewport da planta** (pdf.js + overlay) ocupando o centro.
   - **Sidebar direita** com o passo-a-passo:
     - `0 · AUTOMÁTICO (BETA)`: seletor de disciplina + botão
       **Analisar planta** + resumo do resultado;
     - `1 · ESCALA (CALIBRAR)`: **Calibrar escala** | **Pela escala do
       carimbo** + status;
     - `2 · MEDIR`: botões **Lado (retâng.)**, **Perímetro**, **Linear**,
       **Contagem**;
     - Cards dos ambientes (nome, área, campos PD, vãos, "+ vão").
3. **Diálogo de importação** — para cada PDF: pavimento + disciplina.
4. **Diálogo de calibração** — "Qual o comprimento real da linha…?" com
   campo em metros, Cancelar/Confirmar.
5. **Visão Tabela** — planilha editável com as colunas do §1.6, subtotais
   por pavimento, total geral e botões **Exportar CSV/XLSX/Imprimir**.

---

## 5. Roadmap de implementação

### Fase 1 — MVP de medição (sem IA) — ~1 semana
- [x] Shell da tela principal (topbar, abas, sidebar, viewport).
- [x] Importação de PDFs com pdf.js + diálogo pavimento/disciplina.
- [x] Calibração de escala por cota conhecida (linha de 2 cliques + diálogo).
- [x] Ferramentas: Linear, Perímetro (polígono), Lado retâng., Contagem.
- [x] Cards de ambientes criados manualmente; pins arrastáveis.
- [x] Persistência em IndexedDB; zoom/pan e "Ajustar".

### Fase 2 — Tabela e cálculos — ~3-4 dias
- [x] Visão Tabela com todas as colunas, edição inline.
- [x] Cálculo de parede bruta/líquida com regra de vãos.
- [x] Subtotais por pavimento e total geral.
- [x] Exportar CSV/XLSX e impressão.

### Fase 3 — "Analisar planta" (automático) — ~1 semana
- [x] Extração da camada de texto do PDF (pdf.js `getTextContent()` traz
      string + posição): heurística que agrupa `NOME` + `xx,xx m²` +
      `PD x,xx` próximos → cria ambientes com pin na posição do texto.
- [x] Leitura da escala do carimbo (busca "1:50", "ESC.", etc.).
- [ ] (Opcional, requer chave de API) fallback com visão IA: rasteriza a
      prancha e envia à API Claude para plantas escaneadas/sem texto.

### Fase 4 — Polimento / PWA — ~2-3 dias
- [x] Manifest + service worker (padrão do repo), ícones.
- [x] Atalhos de teclado, undo/redo de medições.
- [x] Multiplicador "Qtd." para ambientes repetidos.

---

## 6. Decisões e limites

- **Client-side primeiro**: nenhum upload de planta para servidor; PDFs
  ficam no navegador (privacidade de projeto + funciona offline). A única
  chamada externa (opcional) é a análise por IA.
- **A heurística de texto resolve a maioria dos casos** sem custo de API,
  pois plantas de arquitetura em PDF vetorial trazem nome/área/PD como
  texto selecionável — mesma informação que a IA do vídeo "leu".
- **Onde este app vive**: repositório próprio (ex.
  `levantamento-obra`), reutilizando o padrão visual/PWA deste repo. Não
  será misturado aos módulos de saneamento — são produtos diferentes —
  mas poderá, no futuro, alimentar o app de saneamento com áreas reais
  (ex.: área de telhado para drenagem pluvial NBR 10844).

---

## 7. Referência rápida do vídeo (frames-chave)

| Momento | O que aparece |
|---|---|
| 0:00–0:10 | Gancho: "Engenheiro — o Claude vai aposentar o CAD" (logo AutoCAD) |
| 0:10–0:15 | Prompt no Claude (Opus 4.8) com 2 PDFs anexados pedindo o sistema |
| 0:15–0:25 | App "Levantamento de Obra" vazio: "Abra o PDF do projeto…"; sidebar com passos 0/1/2 |
| 0:20 | Seletor de arquivos com ~15 PDFs de projeto (INF, TER, SUP, COB, ACA, LAY, CRT, DET) |
| 0:22 | Diálogo de classificação: pavimento + disciplina por prancha |
| 0:27 | "Analisar planta": 19 ambientes detectados, pins azuis, total 549,50 m² |
| 0:33 | Diálogo "Calibrar escala" sobre cota da planta |
| 0:39–0:45 | Visão Tabela com colunas de parede bruta/vãos/parede líquida |
| 0:45 | Cards LAVANDERIA (24,75 m²) e DORMITÓRIO DE APOIO (12,80 m²) com regra de vãos |
| 0:48–0:52 | Desconto automático de vãos; subtotal Subsolo 540,50 m² |
| 0:55–1:18 | Encerramento: "não gastei dias", "praticamente pronto", CTA de seguir o perfil |

---

## 8. Extensões para coordenação e planejamento (implementadas)

Sequência aprovada pelo usuário e implementada sobre o app base:

1. **Multi-projeto + portabilidade** — seletor de projetos na topbar (criar,
   renomear, excluir), exportar/importar `.levantamento.json` com os PDFs
   embutidos em base64; migração automática dos dados da versão
   mono-projeto.
2. **Orçamento** — catálogo de serviços editável (semeado com serviços de
   referência), quantidade de cada serviço derivada do levantamento
   (parede líquida, área de piso/teto, perímetro ou manual), preço
   unitário, curva ABC (A ≤ 80% acumulado, B ≤ 95%, C acima), BDI e total,
   com exportação CSV e impressão.
3. **Avanço físico** — % executado por ambiente (slider no card, na vista
   Avanço e faixa colorida no pin da planta), avanço global e por
   pavimento ponderado pela área, registro automático de um snapshot por
   dia e **curva S** (real × planejada `3t²−2t³` entre as datas de início
   e término). Cores das séries validadas para daltonismo e contraste
   sobre o fundo escuro (#ea580c real, #3b82f6 planejado).

Próximas extensões sugeridas (não implementadas): RDO com fotos, pins de
pendência/compatibilização entre disciplinas, integração com horas de OP/
ponto (planejado × executado) e colaboração multiusuário via backend.
