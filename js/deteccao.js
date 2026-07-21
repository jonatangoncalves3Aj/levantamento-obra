// Passo 0 — "Analisar planta": heurística sobre a camada de texto do PDF.
// Plantas vetoriais de arquitetura trazem nome do ambiente, área (m²) e
// pé-direito como texto selecionável; agrupamos tokens próximos.

const RE_AREA = /(\d{1,3}(?:\.\d{3})*,\d{1,2}|\d+[.,]\d{1,2}|\d{1,4})\s*m\s*(?:²|2(?!\d))/i;
const RE_PD = /P\.?\s*D\.?\s*[.:=]?\s*(\d+[.,]\d{1,2})/i;
const RE_ESCALA = /(?:^|[^\d])1\s*[:\/]\s*(20|25|30|40|50|75|100|125|150|175|200|250|500)(?:[^\d]|$)/;

const parseBR = (s) => parseFloat(s.replace(/\./g, '').replace(',', '.'));

function pareceNome(s) {
  const t = s.trim();
  if (t.length < 3 || t.length > 42) return false;
  if (RE_AREA.test(t) || RE_PD.test(t)) return false;
  if (/\d{2,}/.test(t)) return false;                       // cotas, códigos
  const letras = (t.match(/[A-ZÀ-ÜÇ]/g) || []).length;
  return letras >= 3 && t === t.toUpperCase() && /^[A-ZÀ-ÜÇ0-9 .ºª'|\/\-–&()]+$/.test(t);
}

export async function analisarPlanta(page) {
  const vp = page.getViewport({ scale: 1 });
  const conteudo = await page.getTextContent();

  const tokens = conteudo.items
    .filter(it => it.str && it.str.trim())
    .map(it => {
      const [x, y] = vp.convertToViewportPoint(it.transform[4], it.transform[5]);
      return { str: it.str.trim(), x, y, largura: it.width || 0 };
    });

  const ambientes = [];
  const nomesUsados = new Set();

  for (const tk of tokens) {
    const mArea = tk.str.match(RE_AREA);
    if (!mArea) continue;
    const area = parseBR(mArea[1]);
    if (!(area > 0.3 && area < 100000)) continue;

    // Nome no mesmo token ("LAVANDERIA 24,75 m²") ou no token mais próximo acima
    let nome = tk.str.slice(0, tk.str.indexOf(mArea[0])).trim().replace(/[-–—:]+$/, '').trim();
    if (!pareceNome(nome)) {
      nome = '';
      let melhor = Infinity;
      for (const outro of tokens) {
        if (outro === tk || !pareceNome(outro.str)) continue;
        const dx = Math.abs(outro.x - tk.x), dy = tk.y - outro.y;   // acima = y menor
        if (dx < 90 && dy > -8 && dy < 40) {
          const d = dx + Math.abs(dy) * 1.5;
          if (d < melhor) { melhor = d; nome = outro.str; }
        }
      }
    }
    if (!nome) continue;

    // Pé-direito próximo (ex.: "PD 2,50")
    let pd = null, melhorPd = Infinity;
    for (const outro of tokens) {
      const mPd = outro.str.match(RE_PD);
      if (!mPd) continue;
      const d = Math.abs(outro.x - tk.x) + Math.abs(outro.y - tk.y);
      if (d < 110 && d < melhorPd) { melhorPd = d; pd = parseBR(mPd[1]); }
    }

    // Dedup: mesmo nome+área muito próximos
    const chave = `${nome}|${area.toFixed(2)}`;
    if (nomesUsados.has(chave)) continue;
    nomesUsados.add(chave);

    ambientes.push({ nome, area, pd, x: tk.x + tk.largura / 2, y: tk.y - 6 });
  }

  return ambientes;
}

// Procura "1:50" etc. no texto da prancha (prioriza tokens perto de "ESC")
export async function detectarEscalaCarimbo(page) {
  const conteudo = await page.getTextContent();
  const strs = conteudo.items.map(it => it.str);
  const texto = strs.join(' ');

  const votos = new Map();
  for (let i = 0; i < strs.length; i++) {
    const m = strs[i].match(RE_ESCALA);
    if (!m) continue;
    const N = parseInt(m[1], 10);
    const vizinho = strs.slice(Math.max(0, i - 3), i + 4).join(' ').toUpperCase();
    const peso = /ESC/.test(vizinho) ? 10 : 1;
    votos.set(N, (votos.get(N) || 0) + peso);
  }
  if (!votos.size) {
    const m = texto.match(RE_ESCALA);
    return m ? parseInt(m[1], 10) : null;
  }
  return [...votos.entries()].sort((a, b) => b[1] - a[1])[0][0];
}
