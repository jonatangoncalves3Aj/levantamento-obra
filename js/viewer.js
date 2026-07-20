// Renderização do PDF (pdf.js) + overlay SVG de pins e medições

import * as pdfjsLib from '../vendor/pdf.min.mjs';
import { state, pranchaAtual, lerPdf } from './store.js';
import { fmt, num, dist, comprimentoPolilinha, perimetroPoligono } from './calc.js';

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL('../vendor/pdf.worker.min.mjs', import.meta.url).href;

const canvas = document.getElementById('canvas-pdf');
const overlay = document.getElementById('overlay');
const palco = document.getElementById('palco');
const vazio = document.getElementById('vazio');
const viewport = document.getElementById('viewport');

const SVG = 'http://www.w3.org/2000/svg';
const cachePaginas = new Map(); // pranchaId -> { page, largura, altura }
let tokenRender = 0;
let tarefaRender = null; // render em andamento do pdf.js (para cancelar)

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

  // Desenho em curso (ferramenta ativa)
  if (state.desenho?.pontos?.length) {
    const pts = state.desenho.pontos;
    const cls = state.tool === 'calibrar' ? 'calibra-linha' : 'medida-linha';
    overlay.appendChild(el('polyline', {
      class: cls, 'stroke-width': traco * 1.3, fill: 'none',
      points: pts.map(p => `${p.x},${p.y}`).join(' '),
    }));
    for (const p of pts) {
      overlay.appendChild(el('circle', { cx: p.x, cy: p.y, r: 3.4 / state.zoom, fill: '#ef4444' }));
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
