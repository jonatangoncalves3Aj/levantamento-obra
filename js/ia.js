// Análise de planta por visão (IA) — para PDFs escaneados/sem camada de texto.
// Chama a API da Anthropic diretamente do navegador com a chave do usuário
// (armazenada só neste aparelho). Modelo escolhido pelo usuário, com saída
// estruturada (JSON Schema), imagem da prancha em PNG base64.

const CHAVE_IA = 'levantamento:ia';

// Modelos com visão, do mais barato ao mais caro (preços por 1M tokens).
export const MODELOS_IA = [
  { id: 'claude-haiku-4-5', nome: 'Haiku 4.5 — mais barato', custo: 'US$ 1 / 5 por 1M' },
  { id: 'claude-sonnet-5', nome: 'Sonnet 5 — equilíbrio', custo: 'US$ 3 / 15 por 1M' },
  { id: 'claude-opus-4-8', nome: 'Opus 4.8 — máxima precisão', custo: 'US$ 5 / 25 por 1M' },
];
const MODELO_PADRAO = 'claude-haiku-4-5';

function lerConfigIA() {
  try { return JSON.parse(localStorage.getItem(CHAVE_IA)) || {}; }
  catch { return {}; }
}

function gravarConfigIA(c) {
  if (c.chave || c.modelo) localStorage.setItem(CHAVE_IA, JSON.stringify(c));
  else localStorage.removeItem(CHAVE_IA);
}

export function lerChaveIA() { return lerConfigIA().chave || null; }

export function salvarChaveIA(chave) {
  const c = lerConfigIA();
  if (chave) c.chave = chave.trim(); else delete c.chave;
  gravarConfigIA(c);
}

export function lerModeloIA() {
  const m = lerConfigIA().modelo;
  return MODELOS_IA.some(x => x.id === m) ? m : MODELO_PADRAO;
}

export function salvarModeloIA(modelo) {
  const c = lerConfigIA();
  c.modelo = modelo;
  gravarConfigIA(c);
}

export function nomeModeloIA(id = lerModeloIA()) {
  return MODELOS_IA.find(x => x.id === id)?.nome || id;
}

export function iaConfigurada() { return !!lerChaveIA(); }

const ESQUEMA = {
  type: 'object',
  properties: {
    ambientes: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          nome: { type: 'string', description: 'Nome do ambiente em maiúsculas, como escrito na planta' },
          area: { type: ['number', 'null'], description: 'Área em m² se estiver escrita na planta; null se não houver' },
          pd: { type: ['number', 'null'], description: 'Pé-direito em metros se escrito; null se não houver' },
          x: { type: 'number', description: 'Posição horizontal do centro do ambiente, fração 0 a 1 da largura da imagem' },
          y: { type: 'number', description: 'Posição vertical do centro do ambiente, fração 0 a 1 da altura da imagem (0 = topo)' },
        },
        required: ['nome', 'area', 'pd', 'x', 'y'],
        additionalProperties: false,
      },
    },
  },
  required: ['ambientes'],
  additionalProperties: false,
};

// Rasteriza a página do PDF em PNG (limitando o lado maior)
async function paginaParaPNG(page, ladoMax = 2200) {
  const vp1 = page.getViewport({ scale: 1 });
  const escala = Math.min(ladoMax / Math.max(vp1.width, vp1.height), 4);
  const vp = page.getViewport({ scale: escala });
  const canvas = document.createElement('canvas');
  canvas.width = vp.width;
  canvas.height = vp.height;
  await page.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise;
  return canvas.toDataURL('image/png').split(',')[1];
}

// Rasteriza SÓ um retângulo da página (coords base do PDF) em alta resolução.
// Usa transform para deslocar a região até a origem do canvas do recorte.
async function regiaoParaPNG(page, regiao, ladoMax = 2000) {
  const x1 = Math.min(regiao.x1, regiao.x2), y1 = Math.min(regiao.y1, regiao.y2);
  const larg = Math.abs(regiao.x2 - regiao.x1), alt = Math.abs(regiao.y2 - regiao.y1);
  const escala = Math.min(ladoMax / Math.max(larg, alt), 4);
  const vp = page.getViewport({ scale: escala });
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(larg * escala);
  canvas.height = Math.round(alt * escala);
  await page.render({
    canvasContext: canvas.getContext('2d'),
    viewport: vp,
    transform: [1, 0, 0, 1, -x1 * escala, -y1 * escala],
  }).promise;
  return canvas.toDataURL('image/png').split(',')[1];
}

// Chamada comum à API (uma ou mais imagens + esquema de saída estruturada)
async function chamarIA(esquema, sistema, pedido, imagens) {
  const chave = lerChaveIA();
  if (!chave) throw new Error('Chave de API não configurada.');

  const pngs = Array.isArray(imagens) ? imagens : [imagens];
  const content = pngs.map(data => ({
    type: 'image', source: { type: 'base64', media_type: 'image/png', data },
  }));
  content.push({ type: 'text', text: pedido });

  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': chave,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: lerModeloIA(),
      max_tokens: 8192,
      output_config: { format: { type: 'json_schema', schema: esquema } },
      system: sistema,
      messages: [{ role: 'user', content }],
    }),
  });

  if (!resp.ok) {
    const corpo = await resp.text().catch(() => '');
    if (resp.status === 401) throw new Error('Chave de API recusada — confira em console.anthropic.com.');
    throw new Error(`API respondeu ${resp.status}: ${corpo.slice(0, 160)}`);
  }

  const dados = await resp.json();
  if (dados.stop_reason === 'refusal') throw new Error('A análise foi recusada pelo modelo.');
  const texto = dados.content?.find(b => b.type === 'text')?.text;
  if (!texto) throw new Error('Resposta sem conteúdo.');
  return JSON.parse(texto);
}

// Retorna ambientes [{nome, area, pd, x, y}] com x/y em coordenadas base do PDF
export async function analisarComIA(page, larguraBase, alturaBase) {
  const png = await paginaParaPNG(page);
  const { ambientes } = await chamarIA(
    ESQUEMA,
    'Você analisa plantas baixas de arquitetura brasileiras. Identifique cada ambiente (cômodo) visível na planta. Para cada um, extraia o nome como escrito, a área em m² e o pé-direito (PD) se estiverem anotados, e a posição do centro do ambiente como frações da imagem. Ignore textos de carimbo, cotas e notas — liste apenas ambientes.',
    'Liste os ambientes desta planta baixa.',
    png,
  );
  return ambientes
    .filter(a => a.nome && a.x >= 0 && a.x <= 1 && a.y >= 0 && a.y <= 1)
    .map(a => ({
      nome: a.nome.toUpperCase(),
      area: a.area ?? null,
      pd: a.pd ?? null,
      x: a.x * larguraBase,
      y: a.y * alturaBase,
    }));
}

/* ---------- Traçado das paredes por visão (rascunho, refinado por snap) ---------- */

// A IA devolve as paredes como polilinhas (eixo de cada parede). É um
// rascunho: as coordenadas de visão não são exatas — no app cada vértice é
// grudado no canto real do CAD (snap) quando a prancha é vetorial.
export async function tracarParedesIA(page, larguraBase, alturaBase, regiao = null) {
  const esquema = {
    type: 'object',
    properties: {
      paredes: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            classe: { type: 'string', enum: ['interna', 'externa'], description: 'externa se for parede de fachada/perímetro externo; interna nas divisórias' },
            pontos: {
              type: 'array',
              description: 'Vértices do eixo da parede, em ordem, como frações 0–1 da imagem',
              items: {
                type: 'object',
                properties: {
                  x: { type: 'number', description: 'fração 0–1 da largura' },
                  y: { type: 'number', description: 'fração 0–1 da altura (0 = topo)' },
                },
                required: ['x', 'y'],
                additionalProperties: false,
              },
            },
          },
          required: ['classe', 'pontos'],
          additionalProperties: false,
        },
      },
    },
    required: ['paredes'],
    additionalProperties: false,
  };

  let imagens, pedido;
  const sistema =
    'Você analisa plantas baixas de arquitetura brasileiras e traça o EIXO de cada parede.\n' +
    'Trace as paredes como polilinhas seguindo o meio de cada parede (linha de centro). ' +
    'Marque como "externa" as paredes do contorno externo (fachada) e "interna" as divisórias. ' +
    'Priorize as paredes principais; não trace móveis, cotas, textos nem esquadrias. ' +
    'Dê os vértices em ordem, como frações 0–1 da imagem.';

  if (regiao) {
    const pngFolha = await paginaParaPNG(page, 1600);
    const pngRegiao = await regiaoParaPNG(page, regiao);
    imagens = [pngFolha, pngRegiao];
    pedido = 'A PRIMEIRA imagem é a prancha inteira (contexto). A SEGUNDA é o recorte a traçar. ' +
      'Trace as paredes SOMENTE da segunda imagem, com coordenadas em frações 0–1 dela.';
  } else {
    imagens = await paginaParaPNG(page);
    pedido = 'Trace o eixo de cada parede desta planta baixa.';
  }

  const dados = await chamarIA(esquema, sistema, pedido, imagens);

  const rx1 = regiao ? Math.min(regiao.x1, regiao.x2) : 0;
  const ry1 = regiao ? Math.min(regiao.y1, regiao.y2) : 0;
  const rw = regiao ? Math.abs(regiao.x2 - regiao.x1) : larguraBase;
  const rh = regiao ? Math.abs(regiao.y2 - regiao.y1) : alturaBase;

  return (dados.paredes || [])
    .map(p => ({
      classe: p.classe === 'externa' ? 'externa' : 'interna',
      pontos: (p.pontos || [])
        .filter(v => v.x >= 0 && v.x <= 1 && v.y >= 0 && v.y <= 1)
        .map(v => ({ x: rx1 + v.x * rw, y: ry1 + v.y * rh })),
    }))
    .filter(p => p.pontos.length >= 2);
}

/* ---------- Contagem de símbolos pela LEGENDA (pranchas de instalações) ---------- */

const DISCIPLINAS_SIMBOLOS = {
  'Elétrica': 'elétricas (tomadas, interruptores, pontos de luz, quadros)',
  'Hidráulica': 'hidrossanitárias (pontos de água fria/quente, esgoto, ralos, registros, louças)',
  'Climatização': 'de climatização (evaporadoras, condensadoras, grelhas, dutos)',
};

export function disciplinaTemSimbolos(disciplina) {
  return disciplina in DISCIPLINAS_SIMBOLOS;
}

// Lê a legenda da prancha e conta cada ocorrência de cada símbolo.
// Retorna { legenda: [nomes], itens: [{rotulo, x, y}] } em coordenadas base.
// `regiao` (opcional, {x1,y1,x2,y2} em coords base) restringe a CONTAGEM a
// só aquele retângulo (ex.: só a planta baixa, sem o diagrama unifilar) —
// a legenda ainda é lida da folha inteira.
export async function analisarSimbolosIA(page, larguraBase, alturaBase, disciplina, regiao = null) {
  const contexto = DISCIPLINAS_SIMBOLOS[disciplina];
  if (!contexto) throw new Error('Sem análise de símbolos para esta disciplina.');

  const esquema = {
    type: 'object',
    properties: {
      legenda: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            item: { type: 'string', description: 'Nome do item exatamente como escrito na legenda da prancha' },
          },
          required: ['item'],
          additionalProperties: false,
        },
      },
      itens: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            item: { type: 'string', description: 'Nome do item — igual ao da legenda, quando houver legenda' },
            x: { type: 'number', description: 'Centro do símbolo, fração 0 a 1 da largura' },
            y: { type: 'number', description: 'Centro do símbolo, fração 0 a 1 da altura (0 = topo)' },
          },
          required: ['item', 'x', 'y'],
          additionalProperties: false,
        },
      },
    },
    required: ['legenda', 'itens'],
    additionalProperties: false,
  };

  let imagens, pedido, sistema;
  sistema =
    `Você analisa plantas de instalações ${contexto} brasileiras.\n` +
    '1) Primeiro localize a LEGENDA (quadro de símbolos/convenções) da prancha e liste cada item com o nome EXATAMENTE como escrito nela.\n' +
    '2) Depois localize CADA ocorrência de cada símbolo na área desenhada da planta — um item por ocorrência, com o centro em frações 0–1 da imagem, usando o MESMO nome da legenda.\n' +
    'Se a prancha não tiver legenda, retorne legenda vazia e use nomes curtos e descritivos (ex.: "Tomada baixa", "Ponto de luz no teto").\n' +
    'Não conte os símbolos desenhados dentro da própria legenda; ignore carimbo, notas e cotas.';

  if (regiao) {
    // Duas imagens: folha inteira (para a legenda) + recorte só da região a contar.
    const pngFolha = await paginaParaPNG(page, 1600);
    const pngRegiao = await regiaoParaPNG(page, regiao);
    imagens = [pngFolha, pngRegiao];
    pedido =
      'A PRIMEIRA imagem é a prancha inteira — use-a APENAS para ler a legenda.\n' +
      'A SEGUNDA imagem é um recorte ampliado da área que você deve contar (a planta baixa). ' +
      'Conte os símbolos SOMENTE nesta segunda imagem, ignorando qualquer coisa fora dela ' +
      '(diagrama unifilar, detalhes, legenda). As coordenadas x/y devem ser frações 0–1 ' +
      'em relação à SEGUNDA imagem (o recorte).';
  } else {
    imagens = await paginaParaPNG(page);
    pedido = 'Leia a legenda e conte todos os símbolos de instalação desta prancha.';
  }

  const dados = await chamarIA(esquema, sistema, pedido, imagens);

  // Em modo região, as frações são relativas ao recorte → mapeia p/ coords base.
  const rx1 = regiao ? Math.min(regiao.x1, regiao.x2) : 0;
  const ry1 = regiao ? Math.min(regiao.y1, regiao.y2) : 0;
  const rw = regiao ? Math.abs(regiao.x2 - regiao.x1) : larguraBase;
  const rh = regiao ? Math.abs(regiao.y2 - regiao.y1) : alturaBase;

  return {
    legenda: (dados.legenda || []).map(l => l.item?.trim()).filter(Boolean),
    itens: (dados.itens || [])
      .filter(i => i.item && i.x >= 0 && i.x <= 1 && i.y >= 0 && i.y <= 1)
      .map(i => ({
        rotulo: i.item.trim(),
        x: rx1 + i.x * rw,
        y: ry1 + i.y * rh,
      })),
  };
}
