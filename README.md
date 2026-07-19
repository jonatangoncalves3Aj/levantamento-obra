# Levantamento de Obra

App web para **levantamento de quantitativos de obra a partir de plantas em PDF** — 100% no navegador, offline-first (PWA), sem enviar nenhum arquivo para servidor.

**Acesse:** https://jonatangoncalves3aj.github.io/levantamento-obra/

## Funcionalidades

- **Pranchas PDF**: importe as plantas do projeto, classifique por pavimento e disciplina (Arquitetura, Estrutura, Fundação, Hidráulica, Elétrica, Climatização)
- **Analisar planta**: detecção automática de ambientes (nome, área e pé-direito) pela camada de texto do PDF, com pins editáveis sobre a planta
- **Escala**: calibração por cota conhecida ou pela escala do carimbo (detecção automática de "1:N")
- **Medição**: lado retangular, perímetro por polígono, linear e contagem
- **Quantitativos**: paredes bruta/acabada/líquida com desconto de vãos (porta/correr desconta sempre; janela só se > 2,00 m²), subtotais por pavimento, exportação CSV
- **Orçamento**: catálogo de serviços com quantidades derivadas do levantamento, curva ABC, BDI e totais
- **Avanço físico**: % executado por ambiente marcado na planta, avanço ponderado por área e curva S (real × planejado)
- **Multi-projeto** com exportação/importação em JSON (plantas incluídas) para backup e compartilhamento
- Desfazer/refazer, atalhos de teclado, instalável no celular (PWA)

## Desenvolvimento

App estático em HTML + CSS + JavaScript puro, com [pdf.js](https://mozilla.github.io/pdf.js/) vendorizado. Sem build: basta servir a pasta (`python3 -m http.server`) e abrir no navegador.

O planejamento completo está em [`docs/PLANO-LEVANTAMENTO-OBRA.md`](docs/PLANO-LEVANTAMENTO-OBRA.md).

## Veja também

- [Dimensionamento de Saneamento](https://jonatangoncalves3aj.github.io/dimensionamento-saneamento/) — ferramenta de cálculo para engenharia sanitária (NBR 5626, 9649, 10844, 7229, 13969, 8160)
