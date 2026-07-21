// Análise de planta por visão (IA) — para PDFs escaneados/sem camada de texto.
// Chama a API da Anthropic diretamente do navegador com a chave do usuário
// (armazenada só neste aparelho). Modelo: claude-opus-4-8 com saída
// estruturada (JSON Schema), imagem da prancha em PNG base64.

const CHAVE_IA = 'levantamento:ia';

export function lerChaveIA() {
  try { return JSON.parse(localStorage.getItem(CHAVE_IA))?.chave || null; }
  catch { return null; }
}

export function salvarChaveIA(chave) {
  if (chave) localStorage.setItem(CHAVE_IA, JSON.stringify({ chave: chave.trim() }));
  else localStorage.removeItem(CHAVE_IA);
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

// Retorna ambientes [{nome, area, pd, x, y}] com x/y em coordenadas base do PDF
export async function analisarComIA(page, larguraBase, alturaBase) {
  const chave = lerChaveIA();
  if (!chave) throw new Error('Chave de API não configurada.');

  const png = await paginaParaPNG(page);

  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': chave,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: 'claude-opus-4-8',
      max_tokens: 8192,
      output_config: { format: { type: 'json_schema', schema: ESQUEMA } },
      system: 'Você analisa plantas baixas de arquitetura brasileiras. Identifique cada ambiente (cômodo) visível na planta. Para cada um, extraia o nome como escrito, a área em m² e o pé-direito (PD) se estiverem anotados, e a posição do centro do ambiente como frações da imagem. Ignore textos de carimbo, cotas e notas — liste apenas ambientes.',
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: 'image/png', data: png } },
          { type: 'text', text: 'Liste os ambientes desta planta baixa.' },
        ],
      }],
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

  const { ambientes } = JSON.parse(texto);
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
