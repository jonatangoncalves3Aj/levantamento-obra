// Renderização do PDF (pdf.js) + overlay SVG de pins e medições

import * as pdfjsLib from '../vendor/pdf.min.mjs';
import { state, pranchaAtual, lerPdf } from './store.js';
import { fmt, num, dist, comprimentoPolilinha, perimetroPoligono } from './calc.js';
import { linhasCache } from './linhas.js';

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL('../vendor/pdf.worker.min.mjs', import.meta.url).href;

const canvas = document.getElementById('canvas-pdf');
const canvasSob = document.getElementById('canvas-sobrepor');
const overlay = document.getElementById('overlay');
const palco = document.getElementById('palco');
const vazio = document.getElementById('vazio');
const viewport = document.getElementById('viewport');

const SVG = 'http://www.w3.org/2000/svg';
const cachePaginas = new Map(); // pranchaId -> { page, largura, altura }
let tokenRender = 0;
let tarefaRender = null;    // render em andamento do pdf.js (para cancelar)
let tarefaRenderSob = null; // idem, do canvas de sobreposição

export async function obterPagina(prancha) {
  if (cachePaginas.has(prancha.id)) return cachePaginas.get(prancha.id);
  const buf = await lerPdf(prancha.id);
  if (!buf) throw new Error('PDF da prancha não encontrado no armazenamento.');
  const doc = await pdfjsLib.getDocument({ data: buf.slice(0) }).promise;
  const page = await doc.getPage(prancha.pagina);
  const vp = page.getViewport({ scale: 1 });
  const info = { page, largura: vp.width, altura: vp.height };
  cachePaginas.set(prancha.id, info);
  return info;
}

export function esquecerPagina(pranchaId) { cachePaginas.delete(pranchaId); }

export async function contarPaginas(buf) {
  const doc = await pdfjsLib.getDocument({ data: buf.slice(0) }).promise;
  const n = doc.numPages;
  await doc.destroy();
  return n;
}

export async function renderizar() {
  const prancha = pranchaAtual();
  if (!prancha) {
    palco.classList.remove('visivel');
    vazio.style.display = '';
    canvasSob.hidden = true;
    return;
  }
  vazio.style.display = 'none';
  palco.classList.add('visivel');

  const meuToken = ++tokenRender;
  const { page, largura, altura } = await obterPagina(prancha);
  if (meuToken !== tokenRender) return;

  if (tarefaRender) {
    tarefaRender.cancel();
    await tarefaRender.promise.catch(() => {});
    if (meuToken !== tokenRender) return;
  }

  const escala = state.zoom * (window.devicePixelRatio || 1);
  const vp = page.getViewport({ scale: escala });
  canvas.width = vp.width;
  canvas.height = vp.height;
  canvas.style.width = `${largura * state.zoom}px`;
  canvas.style.height = `${altura * state.zoom}px`;
  tarefaRender = page.render({ canvasContext: canvas.getContext('2d'), viewport: vp });
  try {
    await tarefaRender.promise;
  } catch (e) {
    if (e?.name === 'RenderingCancelledException') return;
    throw e;
  } finally {
    tarefaRender = null;
  }
  if (meuToken !== tokenRender) return;

  overlay.setAttribute('viewBox', `0 0 ${largura} ${altura}`);
  desenharOverlay();
  await renderizarSobreposicao(meuToken).catch(() => { canvasSob.hidden = true; });
}

// Renderiza outra prancha (disciplina) translúcida por cima da atual,
// alinhando as larguras das folhas — modo "mesa de luz" para conferir
// interferências entre disciplinas.
async function renderizarSobreposicao(meuToken) {
  const prancha = pranchaAtual();
  const id = state.sobreposicao?.pranchaId;
  const alvo = id && id !== prancha.id
    ? state.projeto.pranchas.find(p => p.id === id) : null;
  if (!alvo) { canvasSob.hidden = true; return; }

  const { page, largura } = await obterPagina(alvo);
  if (meuToken !== tokenRender) return;
  if (tarefaRenderSob) {
    tarefaRenderSob.cancel();
    await tarefaRenderSob.promise.catch(() => {});
    if (meuToken !== tokenRender) return;
  }

  const base = cachePaginas.get(prancha.id);
  const fator = base ? base.largura / largura : 1;
  const dpr = window.devicePixelRatio || 1;
  const vp = page.getViewport({ scale: state.zoom * fator * dpr });
  canvasSob.width = vp.width;
  canvasSob.height = vp.height;
  canvasSob.style.width = `${vp.width / dpr}px`;
  canvasSob.style.height = `${vp.height / dpr}px`;
  canvasSob.style.opacity = state.sobreposicao.opacidade;
  canvasSob.hidden = false;
  tarefaRenderSob = page.render({ canvasContext: canvasSob.getContext('2d'), viewport: vp });
  try {
    await tarefaRenderSob.promise;
  } catch (e) {
    if (e?.name !== 'RenderingCancelledException') throw e;
  } finally {
    tarefaRenderSob = null;
  }
}

export function ajustar() {
  const prancha = pranchaAtual();
  if (!prancha || !cachePaginas.has(prancha.id)) return;
  const { largura, altura } = cachePaginas.get(prancha.id);
  const zx = (viewport.clientWidth - 48) / largura;
  const zy = (viewport.clientHeight - 48) / altura;
  state.zoom = Math.max(0.05, Math.min(zx, zy));
}

// Converte evento do mouse em coordenadas base do PDF
export function pontoDoEvento(e) {
  const r = overlay.getBoundingClientRect();
  return { x: (e.clientX - r.left) / state.zoom, y: (e.clientY - r.top) / state.zoom };
}

function el(tag, attrs, texto) {
  const n = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  if (texto !== undefined) n.textContent = texto;
  return n;
}

function metros(comprimentoBase, prancha) {
  const ppm = prancha.escala?.pxPorMetro;
  return ppm ? comprimentoBase / ppm : null;
}

export function desenharOverlay() {
  const prancha = pranchaAtual();
  overlay.innerHTML = '';
  if (!prancha) return;

  const f = 12 / state.zoom;            // fonte com tamanho constante na tela
  const traco = 1.6 / state.zoom;

  // Destaque das linhas do CAD (por baixo de tudo): linhas longas em ciano
  if (state.destacarLinhas) {
    const info = linhasCache(prancha.id);
    if (info) {
      const g = el('g', { stroke: '#06b6d4', 'stroke-width': traco * 0.9, opacity: 0.55 });
      for (const s of info.longos) {
        g.appendChild(el('line', { x1: s.ax, y1: s.ay, x2: s.bx, y2: s.by }));
      }
      overlay.appendChild(g);
    }
  }

  // Medições avulsas salvas (linear / contagem)
  for (const m of prancha.medicoes) {
    if (m.tipo === 'linear' && m.pontos.length > 1) {
      overlay.appendChild(el('polyline', {
        class: 'medida-linha', 'stroke-width': traco,
        points: m.pontos.map(p => `${p.x},${p.y}`).join(' '),
      }));
      const fim = m.pontos[m.pontos.length - 1];
      const compM = metros(comprimentoPolilinha(m.pontos), prancha);
      overlay.appendChild(el('text', {
        class: 'medida-rotulo', x: fim.x + f * .4, y: fim.y - f * .4, 'font-size': f,
      }, `${m.nome} ${compM !== null ? fmt(compM) + ' m' : ''}`));
    }
    if (m.tipo === 'parede' && m.pontos.length > 1) {
      const cor = m.classe === 'externa' ? '#ef4444' : '#3b82f6';
      overlay.appendChild(el('polyline', {
        'stroke-width': traco * 2.4, stroke: cor, fill: 'none', 'stroke-linecap': 'round',
        opacity: 0.75, points: m.pontos.map(p => `${p.x},${p.y}`).join(' '),
      }));
      const fim = m.pontos[m.pontos.length - 1];
      const compM = metros(comprimentoPolilinha(m.pontos), prancha);
      const areaM = compM !== null ? compM * (m.pd || 0) : null;
      overlay.appendChild(el('text', {
        class: 'medida-rotulo', x: fim.x + f * .4, y: fim.y - f * .4, 'font-size': f,
      }, `${m.classe === 'externa' ? 'Ext' : 'Int'} ${areaM !== null ? fmt(areaM) + ' m²' : ''}`));
      // Alças de edição: arraste um vértice para corrigir o traçado
      // (só sem ferramenta ativa, para não competir com os cliques de medir)
      if (!state.tool) {
        m.pontos.forEach((p, i) => {
          overlay.appendChild(el('circle', {
            'data-vertice': `${m.id}:${i}`, cx: p.x, cy: p.y, r: 5 / state.zoom,
            fill: '#fff', stroke: cor, 'stroke-width': 2 / state.zoom,
            cursor: 'move', opacity: 0.9,
          }));
        });
      }
    }
    if (m.tipo === 'contagem') {
      for (const p of m.pontos) {
        overlay.appendChild(el('circle', {
          class: 'ponto-contagem', cx: p.x, cy: p.y, r: 5 / state.zoom, 'stroke-width': traco,
        }));
      }
      if (m.pontos.length) {
        const p0 = m.pontos[0];
        overlay.appendChild(el('text', {
          class: 'medida-rotulo', x: p0.x + f * .6, y: p0.y - f * .6, 'font-size': f,
        }, `${m.nome}: ${m.pontos.length}`));
      }
    }
  }

  // Polígonos de perímetro medidos dos ambientes
  for (const a of prancha.ambientes) {
    if (a.poligono?.length > 2) {
      overlay.appendChild(el('polygon', {
        class: 'medida-poly', 'stroke-width': traco,
        points: a.poligono.map(p => `${p.x},${p.y}`).join(' '),
      }));
    }
  }

  // Região de contagem por IA (persistida): retângulo verde tracejado
  if (prancha.regiaoIA) {
    const r = prancha.regiaoIA;
    overlay.appendChild(el('rect', {
      x: Math.min(r.x1, r.x2), y: Math.min(r.y1, r.y2),
      width: Math.abs(r.x2 - r.x1), height: Math.abs(r.y2 - r.y1),
      fill: 'rgba(34, 197, 94, .06)', stroke: '#22c55e', 'fill-opacity': 1,
      'stroke-width': traco * 1.4, 'stroke-dasharray': `${8 / state.zoom} ${5 / state.zoom}`,
    }));
    overlay.appendChild(el('text', {
      class: 'medida-rotulo', fill: '#22c55e',
      x: Math.min(r.x1, r.x2) + f * .4, y: Math.min(r.y1, r.y2) - f * .4, 'font-size': f,
    }, '▦ região de contagem (IA)'));
  }

  // Desenho em curso (ferramenta ativa)
  if (state.desenho?.pontos?.length) {
    const pts = state.desenho.pontos;
    if ((state.tool === 'pavzona' || state.tool === 'regiaoia') && pts.length === 2) {
      // Região de separação de pavimentos: retângulo tracejado
      const [a, b] = pts;
      overlay.appendChild(el('rect', {
        x: Math.min(a.x, b.x), y: Math.min(a.y, b.y),
        width: Math.abs(b.x - a.x), height: Math.abs(b.y - a.y),
        class: 'medida-linha', fill: 'rgba(249, 115, 22, .07)',
        'stroke-width': traco * 1.3, 'stroke-dasharray': `${6 / state.zoom} ${4 / state.zoom}`,
      }));
    } else {
      const cls = state.tool === 'calibrar' ? 'calibra-linha' : 'medida-linha';
      overlay.appendChild(el('polyline', {
        class: cls, 'stroke-width': traco * 1.3, fill: 'none',
        points: pts.map(p => `${p.x},${p.y}`).join(' '),
      }));
    }
    for (const p of pts) {
      overlay.appendChild(el('circle', { cx: p.x, cy: p.y, r: 3.4 / state.zoom, fill: '#ef4444' }));
    }
  }

  // Indicador de snap (prévia de onde o clique vai grudar)
  if (state.destacarLinhas && state.snapHover) {
    const s = state.snapHover;
    if (s.tipo === 'canto') {
      const r = 5 / state.zoom;
      overlay.appendChild(el('rect', {
        x: s.x - r, y: s.y - r, width: r * 2, height: r * 2,
        fill: 'none', stroke: '#ec4899', 'stroke-width': 2 / state.zoom,
      }));
    } else {
      overlay.appendChild(el('circle', {
        cx: s.x, cy: s.y, r: 4.5 / state.zoom,
        fill: 'none', stroke: '#ec4899', 'stroke-width': 2 / state.zoom,
      }));
    }
  }

  // Pins de pendências (losango; laranja = aberta, verde = resolvida)
  for (const pd of prancha.pendencias || []) {
    const cor = pd.status === 'resolvida' ? '#22c55e' : '#ef4444';
    const r = 9 / state.zoom;
    const g = el('g', { 'data-pendencia': pd.id, cursor: 'pointer' });
    g.appendChild(el('path', {
      d: `M ${pd.x} ${pd.y - r} L ${pd.x + r} ${pd.y} L ${pd.x} ${pd.y + r} L ${pd.x - r} ${pd.y} Z`,
      fill: cor, stroke: '#fff', 'stroke-width': 1.6 / state.zoom,
    }));
    g.appendChild(el('text', {
      x: pd.x, y: pd.y + f * 0.32, 'font-size': f * 0.85, 'text-anchor': 'middle',
      fill: '#fff', 'font-weight': '700',
    }, '!'));
    if (state.mostrarNomes) {
      g.appendChild(el('text', {
        class: 'medida-rotulo', x: pd.x + r + f * 0.3, y: pd.y + f * 0.32, 'font-size': f * 0.9,
      }, pd.titulo));
    }
    overlay.appendChild(g);
  }

  // Pins de ambientes
  if (state.mostrarNomes) {
    for (const a of prancha.ambientes) {
      const sel = a.id === state.ambienteSelId;
      const linhas = [a.nome || 'Ambiente'];
      if (num(a.area) !== null) linhas.push(`${fmt(num(a.area))} m²`);
      const largTexto = Math.max(...linhas.map(t => t.length)) * f * 0.58 + f;
      const altTexto = linhas.length * f * 1.3 + f * 0.5;

      const g = el('g', { class: `pin-label${sel ? ' sel' : ''}`, 'data-ambiente': a.id, cursor: 'pointer' });
      g.appendChild(el('rect', {
        x: a.pin.x - largTexto / 2, y: a.pin.y - altTexto / 2,
        width: largTexto, height: altTexto, rx: 3 / state.zoom,
      }));
      linhas.forEach((t, i) => {
        g.appendChild(el('text', {
          x: a.pin.x, y: a.pin.y - altTexto / 2 + f * 1.15 * (i + 1),
          'font-size': i === 0 ? f : f * 0.9, 'text-anchor': 'middle',
          'font-weight': i === 0 ? '700' : '400',
        }, t));
      });
      // Faixa de avanço físico na base do pin (verde = concluído)
      const avanco = num(a.avanco) ?? 0;
      if (avanco > 0) {
        g.appendChild(el('rect', {
          x: a.pin.x - largTexto / 2, y: a.pin.y + altTexto / 2 - 2.6 / state.zoom,
          width: largTexto * Math.min(avanco, 100) / 100, height: 2.6 / state.zoom,
          fill: avanco >= 100 ? '#22c55e' : '#d97706',
        }));
      }
      overlay.appendChild(g);
    }
  }
}

export { dist };
