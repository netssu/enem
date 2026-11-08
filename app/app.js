// ENEM Azul — app de estudo "fazer todas as questões e voltar nas que errei".
// Tudo roda no navegador; o progresso fica no localStorage.

const QUESTOES = window.QUESTOES || [];
const BYID = Object.fromEntries(QUESTOES.map(q => [q.id, q]));
const AREAS = {
  LC: 'Linguagens',
  CH: 'Humanas',
  CN: 'Natureza',
  MT: 'Matemática',
};
const ORDEM_AREAS = ['LC', 'CH', 'CN', 'MT'];
// matéria e tema de cada questão (data/temas.js, gerado por tools/temas.py)
const TEMAS = window.TEMAS || { nomes: {}, q: {} };
function temaDe(id) { return TEMAS.q[id] || null; }
function nomeTema(c) { return TEMAS.nomes[c]?.[2] || ''; }
function materiaDe(c) { return TEMAS.nomes[c]?.[1] || ''; }
function rotuloTema(c) { return c ? `${materiaDe(c)} › ${nomeTema(c)}` : ''; }
// um "alvo" de treino é um tema ("QUI.est") ou uma matéria inteira ("QUI")
function noAlvo(c, alvo) { return !!c && (alvo.includes('.') ? c === alvo : c.startsWith(alvo + '.')); }
function nomeAlvo(alvo) { return alvo.includes('.') ? nomeTema(alvo) : materiaDe(Object.keys(TEMAS.nomes).find(c => noAlvo(c, alvo))); }
// Caixas de revisão (sistema Leitner): depois de acertar na caixa N, a próxima revisão é em INTERVALO[N] dias.
const INTERVALO = { 1: 1, 2: 3, 3: 7, 4: 21 };
const CAIXA_MAX = 4;
const MOTIVOS = ['Precisei de ajuda', 'Não sabia o conteúdo', 'Interpretação', 'Desatenção', 'Conta/cálculo', 'Chutei', 'Faltou tempo'];
const DIAS_SEMANA = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const SDK_URL = 'https://cdn.jsdelivr.net/npm/@anthropic-ai/sdk@1.3.0/+esm';
const MODELO = 'claude-opus-5-5';

const KEY = 'enem.v1';
const KEY_EXP = 'enem.explicacoes';

// ---------------------------------------------------------------- estado
function padrao() {
  return {
    cfg: {
      lingua: 'ING',
      prova: proximoEnem(),
      folgaFinal: 30,
      dias: [1, 2, 3, 4, 5, 6],
      bloco: 10,
      escala: 1.75,
      ordem: 'intercalado',
      areas: [...ORDEM_AREAS],
      foco: true,   // reforçar pontos fracos nos blocos
      apiKey: '',
    },
    simulado: null,   // simulado em andamento ou recém-entregue
    simulados: [],    // histórico: { data, n, ok, seg, limite }
    q: {},      // id -> { s: 'dom'|'rev'|'rec', caixa, prox, h: [[data, letra, ok, segundos, chute]], motivo, nota, video, pulou }
    log: {},    // 'AAAA-MM-DD' -> { n: novas, r: revisões, ok: acertos }
    sessao: null,
  };
}
function carregar() {
  try {
    const s = JSON.parse(localStorage.getItem(KEY));
    if (s) {
      const p = padrao();
      return { ...p, ...s, cfg: { ...p.cfg, ...s.cfg } };
    }
  } catch { /* estado corrompido: recomeça */ }
  return padrao();
}
let st = carregar();
function salvar() { localStorage.setItem(KEY, JSON.stringify(st)); }

let explicacoes = {};
try { explicacoes = JSON.parse(localStorage.getItem(KEY_EXP)) || {}; } catch { explicacoes = {}; }
function salvarExplicacoes() { try { localStorage.setItem(KEY_EXP, JSON.stringify(explicacoes)); } catch { /* cheio */ } }

// ---------------------------------------------------------------- datas
function iso(d) {
  const z = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`;
}
function hoje() { return iso(new Date()); }
function parse(s) { const [a, m, d] = s.split('-').map(Number); return new Date(a, m - 1, d); }
function somaDias(s, n) { const d = parse(s); d.setDate(d.getDate() + n); return iso(d); }
function diffDias(a, b) { return Math.round((parse(b) - parse(a)) / 86400000); }
function diaSemana(s) { return parse(s).getDay(); }
function fmt(s) { const d = parse(s); return d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' }); }
function dias(n) { return n === 1 ? '1 dia' : `${n} dias`; }
function fmtCurto(s) { const d = parse(s); return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }); }
function proximoEnem() {
  // ENEM costuma ser nos dois primeiros domingos de novembro. Se já passou neste ano, mira o ano que vem.
  const agora = new Date();
  let ano = agora.getFullYear();
  if (agora.getMonth() >= 10) ano += 1;
  const d = new Date(ano, 10, 1);
  while (d.getDay() !== 0) d.setDate(d.getDate() + 1);
  return iso(d);
}

// ---------------------------------------------------------------- questões
function valida(q) {
  return q.resp && q.resp !== 'X' && q.resp !== '?' && (!q.lingua || q.lingua === st.cfg.lingua);
}
function POOL() { return QUESTOES.filter(valida); }
function reg(id) { return st.q[id]; }
function feita(id) { return !!(st.q[id] && st.q[id].h && st.q[id].h.length); }
function vencidas() {
  const h = hoje();
  return POOL()
    .filter(q => { const r = reg(q.id); return r && r.s === 'rev' && r.prox <= h; })
    .sort((a, b) => reg(a.id).prox.localeCompare(reg(b.id).prox) || reg(a.id).caixa - reg(b.id).caixa);
}
function emRevisao() { return POOL().filter(q => reg(q.id)?.s === 'rev'); }

function filaNovas() {
  const areas = st.cfg.areas.length ? st.cfg.areas : ORDEM_AREAS;
  const cands = POOL().filter(q => !feita(q.id) && areas.includes(q.area));
  const pulou = q => (reg(q.id)?.pulou ? 1 : 0);
  if (st.cfg.ordem === 'prova') {
    return cands.sort((a, b) => pulou(a) - pulou(b) || b.ano - a.ano || a.num - b.num);
  }
  // intercalado: uma de cada área por vez, das provas mais recentes para as mais antigas
  const porArea = areas.map(a => cands.filter(q => q.area === a)
    .sort((x, y) => pulou(x) - pulou(y) || y.ano - x.ano || x.num - y.num));
  const feitasTotal = Object.keys(st.q).length;
  const fila = [];
  let i = feitasTotal % areas.length;
  while (porArea.some(l => l.length)) {
    const l = porArea[i % areas.length];
    if (l.length) fila.push(l.shift());
    i++;
  }
  return fila;
}

// ---------------------------------------------------------------- cronograma
function plano() {
  const h = hoje();
  const pool = POOL();
  const feitas = pool.filter(q => feita(q.id)).length;
  const restantes = pool.length - feitas;
  const fimNovas = somaDias(st.cfg.prova, -st.cfg.folgaFinal);
  const novasHoje = st.log[h]?.n || 0;
  let diasEstudo = 0;
  for (let d = h; d <= fimNovas; d = somaDias(d, 1)) if (st.cfg.dias.includes(diaSemana(d))) diasEstudo++;
  const hojeEstuda = st.cfg.dias.includes(diaSemana(h));
  // meta calculada como se o dia estivesse começando agora (não muda conforme você avança no dia)
  const meta = diasEstudo > 0 ? Math.ceil((restantes + novasHoje) / diasEstudo) : restantes + novasHoje;
  let n14 = 0;
  let ativos = 0;
  for (let k = 0; k < 14; k++) {
    const n = st.log[somaDias(h, -k)]?.n || 0;
    n14 += n;
    if (n) ativos++;
  }
  const ritmo = n14 / 14; // novas por dia corrido
  const previsao = ritmo > 0 && ativos >= 3 ? somaDias(h, Math.ceil(restantes / ritmo)) : null;
  const retaFinal = h > fimNovas;
  return {
    total: pool.length, feitas, restantes, fimNovas, diasEstudo, hojeEstuda,
    meta: hojeEstuda && !retaFinal ? meta : 0,
    ritmoMeta: retaFinal ? 0 : meta,
    novasHoje, ritmo, previsao, retaFinal,
    diasProva: diffDias(h, st.cfg.prova),
    vencidas: vencidas().length,
  };
}

function sequencia() {
  let d = hoje();
  if (!st.log[d]) d = somaDias(d, -1);
  let n = 0;
  while (st.log[d] && (st.log[d].n + st.log[d].r) > 0) { n++; d = somaDias(d, -1); }
  return n;
}

// ---------------------------------------------------------------- pontos fracos
// Acerto "de primeira": a 1ª tentativa, sem chute e sem ter pedido ajuda.
// Para não exagerar com poucas questões, a taxa de cada tema é puxada para a sua média geral
// (média bayesiana com peso K): 1 erro em 1 questão não vira "0% de acerto".
const K_FOCO = 4;
const MIN_FOCO = 3;          // questões feitas num tema para ele poder ser apontado como fraco
const MIN_ANALISE = 15;      // questões feitas no total para começar a análise
function analisePontos() {
  const temas = {};
  const materias = {};
  const areas = {};
  let n = 0, ok = 0;
  for (const q of POOL()) {
    const r = reg(q.id);
    if (!r?.h?.length) continue;
    const h0 = r.h[0];
    const acerto = h0[2] === 1 && !h0[4] ? 1 : 0;
    n++; ok += acerto;
    const soma = (obj, k, extra) => {
      const x = obj[k] || (obj[k] = { n: 0, ok: 0, seg: 0, rev: 0, ...extra });
      x.n++; x.ok += acerto; x.seg += h0[3] || 0; if (r.s === 'rev') x.rev++;
    };
    soma(areas, q.area, { area: q.area });
    const c = temaDe(q.id);
    if (!c) continue;
    soma(temas, c, { c, area: q.area });
    soma(materias, `${q.area}|${materiaDe(c)}`, { area: q.area, nome: materiaDe(c), c: c.split('.')[0], materia: true });
  }
  const media = n ? ok / n : 0;
  const nota = x => (x.ok + K_FOCO * media) / (x.n + K_FOCO);
  const lista = o => Object.values(o).map(x => ({ ...x, taxa: x.ok / x.n, nota: nota(x), tempo: x.seg / x.n }));
  const T = lista(temas);
  const M = lista(materias);
  const abaixo = x => x.n >= MIN_FOCO && x.nota < media - 0.03;
  // temas fracos; e matérias fracas cujos temas ainda têm poucas questões para aparecer sozinhos
  const fracosT = T.filter(abaixo);
  const fracos = fracosT.concat(M.filter(m => abaixo(m) && !fracosT.some(t => noAlvo(t.c, m.c))))
    .sort((a, b) => a.nota - b.nota);
  const fortes = T.filter(x => x.n >= MIN_FOCO && x.nota > media + 0.03).sort((a, b) => b.nota - a.nota);
  // motivos de erro mais comuns
  const motivos = {};
  for (const id in st.q) { const m = st.q[id].motivo; if (m) motivos[m] = (motivos[m] || 0) + 1; }
  return {
    n, ok, media, pronto: n >= MIN_ANALISE, temOsTemas: Object.keys(TEMAS.q).length > 0,
    temas: T, materias: M.sort((a, b) => ORDEM_AREAS.indexOf(a.area) - ORDEM_AREAS.indexOf(b.area) || a.nota - b.nota),
    areas: lista(areas), fracos, fortes,
    motivos: Object.entries(motivos).sort((a, b) => b[1] - a[1]),
  };
}
// os temas em que o app vai insistir (os 3 mais fracos que ainda têm questão nova nas áreas escolhidas)
function temasFoco(an = analisePontos()) {
  if (!an.pronto) return [];
  const areas = st.cfg.areas.length ? st.cfg.areas : ORDEM_AREAS;
  const comNovas = new Set(POOL().filter(q => !feita(q.id) && areas.includes(q.area)).map(q => temaDe(q.id)));
  return an.fracos.filter(x => [...comNovas].some(c => noAlvo(c, x.c))).slice(0, 3);
}
const DICA_MOTIVO = {
  'Interpretação': 'Leia o comando da questão antes do texto e sublinhe o que ela pede.',
  'Desatenção': 'Antes de marcar, releia o comando: “correta”, “incorreta”, “exceto”…',
  'Conta/cálculo': 'Confira a conta de trás para frente e estime a ordem de grandeza da resposta.',
  'Faltou tempo': 'Treine simulados com tempo: ~3 min por questão.',
  'Não sabia o conteúdo': 'Revise a teoria dos seus temas mais fracos (lista acima) antes de fazer mais questões deles.',
  'Chutei': 'Chute é sinal de conteúdo frágil: os temas mais fracos acima são um bom lugar para começar.',
  'Precisei de ajuda': 'Refaça amanhã sozinho as questões em que pediu ajuda: elas já estão no caderno de erros.',
};

// ---------------------------------------------------------------- sessão
function embaralhar(l) {
  for (let i = l.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [l[i], l[j]] = [l[j], l[i]]; }
  return l;
}
function montarSessao(tam, tipo = 'misto', tema = null) {
  const venc = vencidas();
  let revs = [];
  let novas = [];
  const foco = {};
  if (tipo === 'tema') {
    // treinar um tema: revisões vencidas do tema primeiro, depois questões novas dele
    revs = venc.filter(q => noAlvo(temaDe(q.id), tema)).slice(0, Math.ceil(tam / 2));
    novas = POOL().filter(q => !feita(q.id) && noAlvo(temaDe(q.id), tema))
      .sort((a, b) => b.ano - a.ano || a.num - b.num).slice(0, tam - revs.length);
    if (novas.length + revs.length < tam) {
      const ja = new Set(revs.map(q => q.id));
      revs = revs.concat(emRevisao().filter(q => noAlvo(temaDe(q.id), tema) && !ja.has(q.id)).slice(0, tam - novas.length - revs.length));
    }
    novas.forEach(q => { foco[q.id] = tema; });
  } else if (tipo === 'rev') {
    const base = venc.length ? venc : emRevisao().sort((a, b) => reg(a.id).prox.localeCompare(reg(b.id).prox));
    revs = base.slice(0, tam);
  } else {
    let cands = filaNovas();
    const maxRev = cands.length ? Math.ceil(tam / 2) : tam;
    revs = venc.slice(0, maxRev);
    const nNovas = tam - revs.length;
    // reforço: ~1 em cada 3 novas vem dos temas mais fracos
    const alvo = st.cfg.foco ? temasFoco() : [];
    if (alvo.length && nNovas >= 2) {
      const vagas = Math.max(1, Math.round(nNovas / 3));
      const escolhidas = [];
      for (let k = 0; k < vagas; k++) {
        const c = alvo[k % alvo.length].c;
        const q = cands.find(x => noAlvo(temaDe(x.id), c) && !escolhidas.includes(x));
        if (q) { escolhidas.push(q); foco[q.id] = c; }
      }
      cands = cands.filter(x => !escolhidas.includes(x));
      novas = cands.slice(0, nNovas - escolhidas.length);
      // espalha as de reforço no meio das outras
      escolhidas.forEach((q, k) => novas.splice(Math.min(novas.length, 1 + k * 3), 0, q));
    } else {
      novas = cands.slice(0, nNovas);
    }
  }
  const itens = [];
  const R = revs.map(q => ({ id: q.id, tipo: 'rev' }));
  const N = novas.map(q => (foco[q.id] ? { id: q.id, tipo: 'nova', foco: foco[q.id] } : { id: q.id, tipo: 'nova' }));
  while (R.length || N.length) {
    if (N.length) itens.push(N.shift());
    if (R.length) itens.push(R.shift());
  }
  if (!itens.length) return false;
  st.sessao = { itens, i: 0, res: [], criada: hoje(), volta: null };
  salvar();
  return true;
}
function abrirQuestaoAvulsa(id) {
  const r = reg(id);
  const tipo = r?.s === 'rev' ? 'rev' : (feita(id) ? 'pratica' : 'nova');
  const volta = st.sessao && st.sessao.i < st.sessao.itens.length ? st.sessao : null;
  st.sessao = { itens: [{ id, tipo }], i: 0, res: [], criada: hoje(), volta, avulsa: true };
  salvar();
  location.hash = '#/estudar';
}

function registrar(id, tipo, letra, segundos, ajuda = false) {
  const q = BYID[id];
  const ok = letra === q.resp;
  const h = hoje();
  const r = st.q[id] || (st.q[id] = { h: [] });
  r.h.push([h, letra, ok ? 1 : 0, segundos, ajuda ? 2 : 0]);
  delete r.pulou;
  const lg = st.log[h] || (st.log[h] = { n: 0, r: 0, ok: 0 });
  if (tipo === 'nova') lg.n++; else lg.r++;
  if (ok) lg.ok++;

  if (ajuda) {
    // usou "ver como fazer": mesmo acertando, volta para refazer sozinho
    r.s = 'rev'; r.caixa = 1; r.prox = somaDias(h, INTERVALO[1]);
    if (!r.motivo) r.motivo = 'Precisei de ajuda';
  } else if (tipo === 'nova') {
    if (ok) r.s = 'dom';
    else { r.s = 'rev'; r.caixa = 1; r.prox = somaDias(h, INTERVALO[1]); }
  } else if (tipo === 'rev') {
    if (ok) {
      r.caixa = (r.caixa || 1) + 1;
      if (r.caixa > CAIXA_MAX) { r.s = 'rec'; delete r.prox; }
      else r.prox = somaDias(h, INTERVALO[r.caixa]);
    } else {
      r.caixa = 1; r.prox = somaDias(h, INTERVALO[1]);
    }
  } else if (tipo === 'simrev') {
    // revisão que apareceu num simulado antes da hora: acertar não adianta a caixa; errar volta para a 1
    if (!ok) { r.caixa = 1; r.prox = somaDias(h, INTERVALO[1]); }
  } else if (tipo === 'pratica' && !ok) {
    // errou uma que já dominava: volta pro ciclo de revisão
    r.s = 'rev'; r.caixa = 1; r.prox = somaDias(h, INTERVALO[1]);
  }
  salvar();
  return ok;
}
function marcarChute(id, chute) {
  const r = st.q[id];
  if (!r) return;
  const ult = r.h[r.h.length - 1];
  if (chute) {
    ult[4] = 1;
    r._antes = { s: r.s, caixa: r.caixa, prox: r.prox };
    r.s = 'rev'; r.caixa = 1; r.prox = somaDias(hoje(), INTERVALO[1]);
    r.motivo = 'Chutei';
  } else if (r._antes) {
    ult[4] = 0;
    Object.assign(r, r._antes);
    if (!r.prox) delete r.prox;
    delete r._antes;
    if (r.motivo === 'Chutei') delete r.motivo;
  }
  salvar();
}

// ---------------------------------------------------------------- utilidades de UI
const $app = document.getElementById('app');
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pct = (a, b) => (b ? Math.round((100 * a) / b) : 0);
function chipArea(a) { return `<span class="chip ${a}"><span class="dot ${a}"></span>${AREAS[a]}</span>`; }
function tituloQ(q) { return `ENEM ${q.ano} · Questão ${q.num}${q.lingua ? (q.lingua === 'ING' ? ' (Inglês)' : ' (Espanhol)') : ''}`; }
function linkVideo(q) {
  const r = reg(q.id);
  if (r?.video) return r.video;
  const termo = `ENEM ${q.ano} questão ${q.num} caderno azul ${q.lingua === 'ESP' ? 'espanhol ' : q.lingua === 'ING' ? 'inglês ' : ''}resolução`;
  return 'https://www.youtube.com/results?search_query=' + encodeURIComponent(termo);
}
function linkProva(q) {
  const url = (window.PROVAS || {})[`${q.ano}-${q.dia}`];
  return url ? `${url}#page=${q.pag}` : null;
}
function imgsHTML(q) {
  const esc2 = st.cfg.escala || 1.75;
  return `<div class="folha">${q.imgs.map((src, k) => `<img src="${src}" alt="Questão ${q.num}${q.imgs.length > 1 ? ` parte ${k + 1}` : ''}" data-w="${(q.w && q.w[k]) || 270}" style="width:${Math.round(((q.w && q.w[k]) || 270) * esc2)}px" ${k ? 'loading="lazy"' : ''}>`).join('')}<canvas class="tinta" aria-hidden="true"></canvas></div>`;
}

// ---------- caneta azul: rabiscar na folha da questão, como na prova de papel
// Os traços ficam salvos por questão, em coordenadas relativas à largura da folha (acompanham o A−/A+).
// Numa tentativa nova (outro dia), a folha começa limpa — o rascunho velho entregaria a resposta.
const KEY_TINTA = 'enem.tinta';
const COR_TINTA = '#1f4fc4';
let tinta = {};
try { tinta = JSON.parse(localStorage.getItem(KEY_TINTA)) || {}; } catch { tinta = {}; }
let canetaLigada = false;
function salvarTinta() {
  const ks = Object.keys(tinta);
  for (const k of ks.slice(0, Math.max(0, ks.length - 80))) delete tinta[k];   // guarda só as 80 últimas
  try { localStorage.setItem(KEY_TINTA, JSON.stringify(tinta)); } catch { /* cheio */ }
}
function ligarTinta(id, limpaAntiga) {
  const folha = $app.querySelector('.folha');
  const cv = folha?.querySelector('canvas.tinta');
  if (!cv) return;
  const ctx = cv.getContext('2d');
  const salvo = tinta[id];
  const tracos = salvo && (!limpaAntiga || salvo.d === hoje()) ? salvo.t : [];
  const bCaneta = $app.querySelector('[data-tinta=caneta]');
  const bDesfazer = $app.querySelector('[data-tinta=desfazer]');
  const bLimpar = $app.querySelector('[data-tinta=limpar]');
  const estilo = w => { ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = COR_TINTA; ctx.lineWidth = Math.max(1.6, w * 0.0035); };
  const traco = (t, w) => {
    ctx.beginPath();
    t.forEach(([x, y], k) => (k ? ctx.lineTo(x * w, y * w) : ctx.moveTo(x * w, y * w)));
    if (t.length === 1) ctx.lineTo(t[0][0] * w + 0.5, t[0][1] * w);
    ctx.stroke();
  };
  const desenhar = () => {
    const w = folha.clientWidth, h = folha.clientHeight, dpr = window.devicePixelRatio || 1;
    cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    estilo(w);
    tracos.forEach(t => traco(t, w));
  };
  const botoes = () => {
    $app.classList.toggle('caneta-on', canetaLigada);
    bCaneta?.classList.toggle('on', canetaLigada);
    bCaneta?.setAttribute('aria-pressed', canetaLigada);
    if (bDesfazer) bDesfazer.hidden = !tracos.length;
    if (bLimpar) bLimpar.hidden = !tracos.length;
  };
  const guardar = () => { if (tracos.length) tinta[id] = { d: hoje(), t: tracos }; else delete tinta[id]; salvarTinta(); botoes(); };
  const ro = new ResizeObserver(desenhar);
  ro.observe(folha);
  aoSair(() => ro.disconnect());
  let atual = null;
  const pos = e => { const r = cv.getBoundingClientRect(); return [+((e.clientX - r.left) / r.width).toFixed(4), +((e.clientY - r.top) / r.width).toFixed(4)]; };
  cv.addEventListener('pointerdown', e => {
    if (!canetaLigada || (e.pointerType === 'mouse' && e.button !== 0)) return;
    e.preventDefault();
    try { cv.setPointerCapture(e.pointerId); } catch { /* sem captura: segue desenhando */ }
    atual = [pos(e)];
    tracos.push(atual);
    traco(atual, folha.clientWidth);
  });
  cv.addEventListener('pointermove', e => {
    if (!atual) return;
    const w = folha.clientWidth;
    const agrupados = e.getCoalescedEvents?.();
    for (const ev of (agrupados && agrupados.length ? agrupados : [e])) {
      const p = pos(ev);
      const u = atual[atual.length - 1];
      ctx.beginPath(); ctx.moveTo(u[0] * w, u[1] * w); ctx.lineTo(p[0] * w, p[1] * w); ctx.stroke();
      atual.push(p);
    }
  });
  const fim = () => { if (!atual) return; atual = null; guardar(); };
  cv.addEventListener('pointerup', fim);
  cv.addEventListener('pointercancel', fim);
  bCaneta?.addEventListener('click', () => { canetaLigada = !canetaLigada; botoes(); });
  bDesfazer?.addEventListener('click', () => { tracos.pop(); desenhar(); guardar(); });
  bLimpar?.addEventListener('click', () => { tracos.length = 0; desenhar(); guardar(); });
  aoSair(() => $app.classList.remove('caneta-on'));
  botoes();
}
function aplicarEscala() {
  document.querySelectorAll('.questao-img img').forEach(im => { im.style.width = Math.round(+im.dataset.w * st.cfg.escala) + 'px'; });
}
function controlesTamanho() {
  return `<span class="tamanho">
    <button class="btn mini" data-tinta="desfazer" title="Desfazer o último traço" hidden>↶</button>
    <button class="btn mini" data-tinta="limpar" title="Apagar os rabiscos" hidden>🗑</button>
    <button class="btn mini caneta" data-tinta="caneta" aria-pressed="false" title="Caneta azul: rabiscar na folha">✏️ Caneta</button>
    <button class="btn mini" data-esc="-1" title="Diminuir">A−</button><button class="btn mini" data-esc="1" title="Aumentar">A+</button></span>`;
}
function ligarTamanho(id, limpaAntiga = true) {
  if (id) ligarTinta(id, limpaAntiga);
  document.querySelectorAll('[data-esc]').forEach(b => b.addEventListener('click', () => {
    st.cfg.escala = Math.min(3.2, Math.max(1, Math.round(((st.cfg.escala || 1.75) + 0.2 * +b.dataset.esc) * 100) / 100));
    salvar();
    aplicarEscala();
  }));
}
function md(t) {
  return esc(t).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/\n{2,}/g, '</p><p>').replace(/\n/g, '<br>');
}
let limpar = [];
function aoSair(fn) { limpar.push(fn); }

// ---------------------------------------------------------------- telas
function telaInicio() {
  const p = plano();
  const s = st.sessao;
  const emAndamento = s && s.i < s.itens.length;
  const pctTotal = pct(p.feitas, p.total);
  const faltaHoje = Math.max(0, p.meta - p.novasHoje);
  let mensagem;
  if (p.retaFinal) mensagem = `Reta final! Faltam ${p.diasProva} dias para a prova: o foco agora é o <b>caderno de erros</b>.`;
  else if (!p.hojeEstuda) mensagem = 'Hoje é dia de folga no seu cronograma. Se sobrar um tempinho, um bloco rápido ajuda — mas sem culpa.';
  else if (faltaHoje === 0 && p.meta > 0) mensagem = `Meta de hoje cumprida (${p.novasHoje} novas). Se quiser adiantar, faça mais um bloco — a meta dos próximos dias diminui sozinha.`;
  else mensagem = `Meta de hoje: <b>${p.meta} questões novas</b> (${p.novasHoje} feitas)${p.vencidas ? ` + <b>${p.vencidas} revisões</b>` : ''}.`;

  $app.innerHTML = `
    <h1>${saudacao()}</h1>
    <p class="muted">${p.diasProva > 0 ? `Faltam <b>${p.diasProva} dias</b> para o ENEM (${fmt(st.cfg.prova)}).` : 'Configure a data da prova em Ajustes.'}</p>

    <section class="card destaque">
      <h2>Estudar agora</h2>
      <p>${mensagem}</p>
      ${p.meta > 0 && !p.retaFinal ? `<div class="barra" title="novas hoje"><i style="width:${Math.min(100, pct(p.novasHoje, p.meta))}%"></i></div>` : ''}
      <div class="linha-btns">
        ${emAndamento
          ? `<a class="btn primario grande" href="#/estudar">Continuar bloco (${s.i + 1}/${s.itens.length})</a>`
          : `<button class="btn primario grande" data-acao="bloco">Fazer um bloco de ${st.cfg.bloco} questões</button>`}
      </div>
      <div class="linha-btns">
        <button class="btn" data-acao="rapido">⚡ Só 5 rapidinhas</button>
        ${p.vencidas ? `<button class="btn" data-acao="revisar">↺ Só revisões (${p.vencidas})</button>` : ''}
      </div>
      <p class="small muted" style="margin-bottom:0">Um bloco de ${st.cfg.bloco} leva ~${st.cfg.bloco * 3} min. Pode parar no meio: o app guarda onde você parou.</p>
    </section>

    ${cardFoco()}

    <section class="card">
      <h2>Seu cronograma</h2>
      <div class="grid2">
        <div class="stat"><b>${p.feitas.toLocaleString('pt-BR')}</b><span>de ${p.total.toLocaleString('pt-BR')} questões feitas (${pctTotal}%)</span></div>
        <div class="stat"><b>${p.retaFinal ? '—' : p.ritmoMeta}</b><span>novas por dia de estudo para terminar até ${fmtCurto(p.fimNovas)}</span></div>
        <div class="stat"><b>${p.previsao ? (p.previsao.slice(0, 4) === hoje().slice(0, 4) ? fmtCurto(p.previsao) : p.previsao.slice(8, 10) + '/' + p.previsao.slice(5, 7) + '/' + p.previsao.slice(2, 4)) : '—'}</b><span>${p.previsao ? `previsão no seu ritmo atual (${(p.ritmo * 7).toFixed(0)}/semana)` : 'previsão de término aparece depois de 3 dias de estudo'}</span></div>
        <div class="stat"><b>${sequencia()}</b><span>dias seguidos estudando</span></div>
      </div>
      ${p.previsao && p.previsao > p.fimNovas && !p.retaFinal ? `<p class="aviso" style="margin-top:12px">No ritmo atual você termina as questões novas depois da data-alvo. Tudo bem: a meta diária já foi recalculada — ou ajuste os dias em <a href="#/ajustes">Ajustes</a>.</p>` : ''}
      <h3 style="margin-top:16px">Esta semana</h3>
      ${semanaHTML()}
    </section>

    <section class="card">
      <h2>Como funciona?</h2>
      <p class="small muted">Você faz todas as questões de 2010 a 2025, uma vez. Acertou → sai da fila. Errou (ou chutou) → vai pro caderno de erros e volta em 1, 3, 7 e 21 dias até você acertar 4 vezes seguidas.</p>
      <a href="#/logica">Ver a lógica completa →</a>
    </section>
  `;
  $app.querySelector('[data-acao=bloco]')?.addEventListener('click', () => iniciar(st.cfg.bloco));
  $app.querySelector('[data-acao=rapido]')?.addEventListener('click', () => iniciar(5));
  $app.querySelector('[data-acao=revisar]')?.addEventListener('click', () => iniciar(p.vencidas, 'rev'));
  ligarTreinar();
}
function cardFoco() {
  const an = analisePontos();
  if (!an.temOsTemas) return '';
  const sim = st.simulado && !st.simulado.fim ? '<p class="aviso">Você tem um <a href="#/simulado">simulado em andamento</a> — o relógio continua correndo.</p>' : '';
  if (!an.pronto) return sim ? `<section class="card">${sim}</section>` : '';
  const f = an.fracos[0];
  return `<section class="card">
    ${sim}
    <h2>Seu ponto mais fraco</h2>
    ${f ? `<ul class="lista">${linhaTema(f, an.media)}</ul>` : '<p class="muted">Nenhum tema claramente abaixo da sua média por enquanto.</p>'}
    <a href="#/pontos">Ver todos os pontos fracos →</a>
  </section>`;
}
function saudacao() {
  const h = new Date().getHours();
  return h < 12 ? 'Bom dia!' : h < 18 ? 'Boa tarde!' : 'Boa noite!';
}
function semanaHTML() {
  const h = hoje();
  const dom = somaDias(h, -diaSemana(h));
  let out = '<div class="semana">';
  for (let k = 0; k < 7; k++) {
    const d = somaDias(dom, k);
    const lg = st.log[d];
    const folga = !st.cfg.dias.includes(k);
    out += `<div class="${d === h ? 'hoje' : ''} ${folga ? 'folga' : ''}" title="${fmt(d)}">${DIAS_SEMANA[k]}<b>${lg ? lg.n + lg.r : (d < h ? '·' : '')}</b><span class="small muted">${folga ? 'folga' : ''}</span></div>`;
  }
  return out + '</div>';
}
function iniciar(tam, tipo, tema) {
  if (!montarSessao(tam, tipo, tema)) {
    alert(tipo === 'rev' ? 'Nenhuma revisão pendente agora.' : tipo === 'tema' ? 'Você já fez todas as questões desse tema!' : 'Não há questões disponíveis com os filtros atuais. Confira as áreas em Ajustes.');
    return;
  }
  location.hash = '#/estudar';
}

// ---------- tela de questão
function telaEstudar() {
  const s = st.sessao;
  if (!s || !s.itens.length) { location.hash = '#/'; return; }
  if (s.i >= s.itens.length) return telaFimSessao();
  const item = s.itens[s.i];
  const q = BYID[item.id];
  if (!q) { s.i++; salvar(); return telaEstudar(); }
  const res = s.res[s.i];
  const r = reg(q.id);
  const inicio = Date.now();

  const rotulo = item.tipo === 'rev'
    ? `<span class="chip tag-rev">↺ Revisão · caixa ${r?.caixa || 1}</span>`
    : item.tipo === 'pratica' ? '<span class="chip">Prática</span>'
    : item.foco ? '<span class="chip tag-foco" title="Questão de um dos seus temas mais fracos">🎯 Reforço</span>' : '<span class="chip">Nova</span>';

  $app.innerHTML = `
    <div class="q-prog"><i style="width:${pct(s.i, s.itens.length)}%"></i></div>
    <div class="q-topo">
      <div class="info">${chipArea(q.area)} ${rotulo}</div>
      <div class="info"><span class="timer" id="timer">0:00</span>
        <span class="small muted">${s.avulsa ? '' : `${s.i + 1}/${s.itens.length}`}</span>
        <a class="btn mini" href="#/" title="Sair (o bloco fica salvo)">Sair</a></div>
    </div>
    <div class="q-titulo"><h2>${tituloQ(q)}</h2>
      <span class="ferramentas">${linkProva(q) ? `<a class="btn mini" href="${linkProva(q)}" target="_blank" rel="noopener" title="Abrir a página ${q.pag} da prova original">📄 Prova</a>` : ''}${controlesTamanho()}</span></div>
    <div class="questao-img">${imgsHTML(q)}</div>
    <div id="dica"></div>
    <div id="feedback"></div>
    <div class="respostas">
      <div class="alts" role="radiogroup" aria-label="Alternativas">${'ABCDE'.split('').map(l => `<button class="alt" role="radio" aria-checked="false" data-l="${l}">${l}</button>`).join('')}</div>
      <div class="acoes" id="acoes">
        <span class="secundarias">
          <button class="btn fantasma" data-acao="pular" title="Pular (ela volta outro dia)">Pular</button>
          <button class="btn fantasma" id="btn-dica">💡 Ver como fazer</button>
        </span>
        <button class="btn primario" id="btn-conf" disabled title="Escolha uma letra primeiro">Responder</button>
      </div>
    </div>
  `;
  ligarTamanho(q.id);
  // pré-carrega a próxima
  const prox = s.itens[s.i + 1];
  if (prox && BYID[prox.id]) BYID[prox.id].imgs.forEach(src => { const im = new Image(); im.src = src; });

  const timerEl = document.getElementById('timer');
  const tick = () => { const t = Math.floor((Date.now() - inicio) / 1000); timerEl.textContent = `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`; };
  const timer = setInterval(tick, 1000);
  aoSair(() => clearInterval(timer));

  const responder = letra => {
    if (s.res[s.i]) return;
    clearInterval(timer);
    const seg = Math.round((Date.now() - inicio) / 1000);
    const ok = registrar(q.id, item.tipo, letra, seg, !!item.ajuda && letra !== '?');
    s.res[s.i] = { letra, ok, seg };
    salvar();
    mostrarFeedback();
  };
  const proxima = () => { s.i++; salvar(); window.scrollTo(0, 0); rota(); };

  function mostrarFeedback() {
    const rr = s.res[s.i];
    const reg2 = reg(q.id);
    $app.querySelector('[data-acao=pular]')?.remove();
    timerEl.textContent = `${Math.floor(rr.seg / 60)}:${String(rr.seg % 60).padStart(2, '0')}`;
    $app.querySelectorAll('.alt').forEach(b => {
      b.disabled = true;
      b.classList.remove('sel');
      if (b.dataset.l === q.resp) b.classList.add('certa');
      else if (b.dataset.l === rr.letra) b.classList.add('errada');
    });
    const lento = rr.seg > 300 ? ` <span class="small">(${Math.round(rr.seg / 60)} min — no ENEM a média é ~3 min por questão)</span>` : '';
    let estado = '';
    const foiChute = reg2.h[reg2.h.length - 1][4];
    const naoSei = rr.letra === '?';
    const comAjuda = !!item.ajuda && !naoSei;
    if (naoSei) {
      estado = 'Sem problema — ela foi para o caderno de erros. Veja a resolução agora e tente sozinho amanhã.';
    } else if (comAjuda) {
      estado = 'Como você viu como fazer, ela volta amanhã para você refazer sozinho.';
    } else if (foiChute) {
      estado = 'Marcada como chute: vai para o caderno de erros e volta amanhã.';
    } else if (item.tipo === 'rev') {
      estado = rr.ok
        ? (reg2.s === 'rec' ? 'Recuperada! Essa saiu do caderno de erros. 🎉' : `Subiu para a caixa ${reg2.caixa}: próxima revisão em ${dias(INTERVALO[reg2.caixa])}.`)
        : 'Voltou para a caixa 1: revisa de novo amanhã.';
    } else if (!rr.ok) estado = 'Foi para o caderno de erros: você revisa amanhã.';
    const fb = document.getElementById('feedback');
    fb.innerHTML = `
      <div class="feedback ${rr.ok ? 'ok' : naoSei ? 'neutro' : 'erro'}">
        <h2>${rr.ok ? (comAjuda ? 'Acertou, com ajuda' : 'Acertou!') : naoSei ? `A resposta é ${q.resp}` : `Errou — a resposta é ${q.resp}`}${naoSei ? '' : lento}</h2>
        ${estado ? `<p style="margin:0">${estado}</p>` : ''}
        ${temaDe(q.id) ? `<p class="small muted" style="margin:6px 0 0">Tema: ${esc(rotuloTema(temaDe(q.id)))}</p>` : ''}
        ${rr.ok && !comAjuda && item.tipo !== 'pratica' ? `<label style="display:flex;gap:8px;align-items:center;margin-top:8px"><input type="checkbox" id="chute" ${reg2.h[reg2.h.length - 1][4] ? 'checked' : ''}> Foi chute / não tinha certeza (mandar para revisão)</label>` : ''}
      </div>
      <section class="card">
        <div class="linha-btns" style="margin-top:0">
          <button class="btn" id="btn-exp">💡 Por que é ${q.resp}?</button>
          <a class="btn" href="${esc(linkVideo(q))}" target="_blank" rel="noopener">▶ Resolução no YouTube</a>
        </div>
        <div id="exp" class="explicacao" style="margin-top:12px"></div>
        <details style="margin-top:8px"><summary class="small muted">Salvar um vídeo específico para esta questão</summary>
          <input type="url" id="video" placeholder="https://www.youtube.com/watch?v=..." value="${esc(reg2.video || '')}" style="margin-top:6px">
        </details>
      </section>
      ${!rr.ok || reg2.s === 'rev' ? `
      <section class="card">
        <h3>${naoSei ? 'O que faltou?' : 'Por que errei?'}</h3>
        <div class="motivos">${MOTIVOS.map(m => `<button data-m="${esc(m)}" class="${reg2.motivo === m ? 'on' : ''}">${esc(m)}</button>`).join('')}</div>
        <label class="campo" for="nota">Anotação para a revisão (opcional)</label>
        <textarea id="nota" placeholder="Ex.: confundi mitose com meiose; lembrar que…">${esc(reg2.nota || '')}</textarea>
      </section>` : ''}
    `;
    document.getElementById('acoes').innerHTML = `<button class="btn primario" id="btn-prox">${s.i + 1 < s.itens.length ? 'Próxima →' : 'Concluir'}</button>`;
    document.getElementById('dica').innerHTML = '';
    document.getElementById('btn-prox').addEventListener('click', proxima);
    document.getElementById('chute')?.addEventListener('change', e => { marcarChute(q.id, e.target.checked); mostrarFeedback(); });
    document.getElementById('btn-exp').addEventListener('click', () => explicar(q, rr.letra, document.getElementById('exp')));
    document.getElementById('video').addEventListener('change', e => { reg(q.id).video = e.target.value.trim(); salvar(); });
    fb.querySelectorAll('[data-m]').forEach(b => b.addEventListener('click', () => {
      const r3 = reg(q.id);
      r3.motivo = r3.motivo === b.dataset.m ? undefined : b.dataset.m;
      salvar();
      fb.querySelectorAll('[data-m]').forEach(x => x.classList.toggle('on', x.dataset.m === r3.motivo));
    }));
    document.getElementById('nota')?.addEventListener('input', e => { reg(q.id).nota = e.target.value; salvar(); });
    if (explicacoes[q.id]) document.getElementById('exp').innerHTML = `<p>${md(explicacoes[q.id])}</p>`;
  }

  let escolhida = null;
  const btnConf = document.getElementById('btn-conf');
  $app.querySelectorAll('.alt').forEach(b => b.addEventListener('click', () => {
    if (s.res[s.i]) return;
    // um toque seleciona; "Responder" (ou tocar de novo na mesma letra) confirma
    if (escolhida === b.dataset.l) return responder(escolhida);
    escolhida = b.dataset.l;
    $app.querySelectorAll('.alt').forEach(x => { x.classList.toggle('sel', x === b); x.setAttribute('aria-checked', x === b); });
    btnConf.textContent = `Responder ${escolhida}`;
    btnConf.disabled = false;
  }));
  btnConf.addEventListener('click', () => {
    if (escolhida) responder(escolhida);
  });
  function mostrarDica() {
    if (s.res[s.i]) return;
    item.ajuda = true;
    salvar();
    document.getElementById('btn-dica').hidden = true;
    const el = document.getElementById('dica');
    el.innerHTML = `
      <section class="card dica">
        <h3>Como fazer</h3>
        <div id="dica-txt" class="explicacao"></div>
        <div class="linha-btns">
          <a class="btn" href="${esc(linkVideo(q))}" target="_blank" rel="noopener">▶ Resolução no YouTube</a>
          <button class="btn" id="btn-ver-resp">Ver a resposta</button>
        </div>
        <p class="small muted" style="margin-bottom:0">Você ainda pode responder. Como pediu ajuda, ela volta amanhã para você refazer sozinho.</p>
      </section>`;
    explicar(q, null, document.getElementById('dica-txt'), 'dica');
    document.getElementById('btn-ver-resp').addEventListener('click', () => {
      responder('?');
      const r4 = reg(q.id);
      if (!r4.motivo) { r4.motivo = 'Não sabia o conteúdo'; salvar(); mostrarFeedback(); }
    });
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  document.getElementById('btn-dica').addEventListener('click', mostrarDica);
  if (item.ajuda && !res) mostrarDica();
  $app.querySelector('[data-acao=pular]')?.addEventListener('click', e => {
    e.preventDefault();
    if (item.tipo === 'nova') { (st.q[q.id] ||= { h: [] }).pulou = hoje(); }
    s.itens.splice(s.i, 1);
    s.res.splice(s.i, 1);
    salvar();
    rota();
  });
  const teclas = e => {
    if (e.target.matches?.('input, textarea, select')) return;
    const k = e.key.toUpperCase();
    if (!s.res[s.i] && 'ABCDE'.includes(k) && k.length === 1) {
      const b = $app.querySelector(`.alt[data-l="${k}"]`);
      b?.click();
    } else if (e.key === 'Enter') {
      document.getElementById('btn-prox')?.click() || document.getElementById('btn-conf')?.click();
    }
  };
  document.addEventListener('keydown', teclas);
  aoSair(() => document.removeEventListener('keydown', teclas));

  if (res) mostrarFeedback();
}

function telaFimSessao() {
  const s = st.sessao;
  const total = s.res.filter(Boolean).length;
  const acertos = s.res.filter(r => r && r.ok).length;
  const erros = s.itens.filter((it, k) => s.res[k] && !s.res[k].ok);
  const p = plano();
  if (s.avulsa) {
    st.sessao = s.volta;
    salvar();
    const alvo = s.volta ? '#/estudar' : '#/erros';
    if (location.hash === alvo) rota(); else location.hash = alvo;
    return;
  }
  $app.innerHTML = `
    <section class="card destaque" style="text-align:center">
      <h1>Bloco concluído!</h1>
      <p style="font-size:40px;margin:8px 0;font-weight:800">${acertos}/${total}</p>
      <p class="muted">${total ? `${pct(acertos, total)}% de acerto.` : ''} ${p.meta ? `Hoje: ${p.novasHoje}/${p.meta} novas.` : ''}</p>
      <div class="linha-btns" style="justify-content:center">
        <button class="btn primario" data-acao="mais">Mais um bloco</button>
        <a class="btn" href="#/">Voltar ao início</a>
      </div>
    </section>
    ${erros.length ? `<section class="card"><h2>Erradas neste bloco</h2><p class="small muted">Elas voltam automaticamente amanhã.</p><ul class="lista">
      ${erros.map(it => { const q = BYID[it.id]; return `<li><div>${chipArea(q.area)} <span class="tit">${tituloQ(q)}</span></div><button class="btn" data-ver="${q.id}">Rever</button></li>`; }).join('')}
    </ul></section>` : ''}
  `;
  $app.querySelector('[data-acao=mais]').addEventListener('click', () => iniciar(st.cfg.bloco));
  $app.querySelectorAll('[data-ver]').forEach(b => b.addEventListener('click', () => { location.hash = '#/ver/' + b.dataset.ver; }));
}

// visualizar uma questão já respondida (sem registrar nova tentativa)
function verQuestao(id) {
  const q = BYID[id];
  const r = reg(id);
  $app.innerHTML = `
    <p><a href="javascript:history.back()">← Voltar</a></p>
    <div class="q-topo"><div class="info">${chipArea(q.area)}</div></div>
    <div class="q-titulo"><h2>${tituloQ(q)} — resposta: ${q.resp}</h2>${controlesTamanho()}</div>
    <div class="questao-img">${imgsHTML(q)}</div>
    <section class="card">
      <div class="linha-btns" style="margin-top:0">
        <button class="btn" id="btn-exp">💡 Por que é ${q.resp}?</button>
        <a class="btn" href="${esc(linkVideo(q))}" target="_blank" rel="noopener">▶ Resolução no YouTube</a>
        ${linkProva(q) ? `<a class="btn" href="${linkProva(q)}" target="_blank" rel="noopener">📄 Prova original</a>` : ''}
      </div>
      <div id="exp" class="explicacao" style="margin-top:12px">${explicacoes[id] ? `<p>${md(explicacoes[id])}</p>` : ''}</div>
      ${r?.nota ? `<h3 style="margin-top:12px">Sua anotação</h3><p>${esc(r.nota)}</p>` : ''}
    </section>
  `;
  const ult = r?.h?.[r.h.length - 1];
  document.getElementById('btn-exp').addEventListener('click', () => explicar(q, ult?.[1], document.getElementById('exp')));
  ligarTamanho(id, false);
  window.scrollTo(0, 0);
}

// ---------- caderno de erros
function telaErros() {
  const venc = vencidas();
  const todas = emRevisao().sort((a, b) => reg(a.id).prox.localeCompare(reg(b.id).prox));
  const rec = POOL().filter(q => reg(q.id)?.s === 'rec').length;
  const h = hoje();
  const tam = st.cfg.bloco;
  let msg;
  if (venc.length) msg = `Você tem <b>${venc.length} ${venc.length === 1 ? 'questão' : 'questões'}</b> para refazer hoje.`;
  else if (todas.length) {
    const d = diffDias(h, reg(todas[0].id).prox);
    msg = `Nada vence hoje. A próxima revisão é ${d === 1 ? 'amanhã' : `em ${dias(d)}`} — se quiser, adiante.`;
  } else msg = 'Seu caderno de erros está vazio. Quando você errar ou pedir ajuda numa questão, ela aparece aqui.';
  let semana = '<div class="semana">';
  for (let k = 0; k < 7; k++) {
    const d = somaDias(h, k);
    const n = todas.filter(q => (k === 0 ? reg(q.id).prox <= d : reg(q.id).prox === d)).length;
    semana += `<div class="${k === 0 ? 'hoje' : ''}">${k === 0 ? 'Hoje' : DIAS_SEMANA[diaSemana(d)]}<b>${n || '·'}</b></div>`;
  }
  semana += '</div>';
  const n1 = Math.min(venc.length, tam);
  $app.innerHTML = `
    <h1>Caderno de erros</h1>
    <p class="muted">${todas.length} em revisão · ${rec} recuperadas</p>
    <section class="card destaque">
      <h2>Refazer agora</h2>
      <p>${msg}</p>
      ${todas.length ? `
      <div class="linha-btns">
        <button class="btn primario grande" data-acao="bloco">${venc.length ? `Refazer ${n1} ${n1 === 1 ? 'questão' : 'questões'}` : `Adiantar ${Math.min(todas.length, tam)} revisões`}</button>
      </div>
      <div class="linha-btns"><button class="btn" data-acao="rapido">⚡ Só 5 rapidinhas</button></div>
      <p class="small muted" style="margin-bottom:0">Acertou → volta em 3, 7 e 21 dias. Acertou 4 vezes seguidas → sai do caderno.</p>` : ''}
    </section>
    <section class="card">
      <h2>Próximos dias</h2>
      ${semana}
    </section>
  `;
  $app.querySelector('[data-acao=bloco]')?.addEventListener('click', () => iniciar(tam, 'rev'));
  $app.querySelector('[data-acao=rapido]')?.addEventListener('click', () => iniciar(5, 'rev'));
}

// ---------- pontos fracos
function barraTaxa(x, media) {
  const p = Math.round(x.taxa * 100);
  const cor = x.nota < media - 0.03 ? 'var(--erro)' : x.nota > media + 0.03 ? 'var(--ok)' : 'var(--muted)';
  return `<div class="taxa"><div class="barra fina"><i style="width:${p}%;background:${cor}"></i><b style="left:${Math.round(media * 100)}%" title="sua média: ${Math.round(media * 100)}%"></b></div><span>${p}%</span></div>`;
}
function linhaTema(x, media, botao = true) {
  return `<li>
    <div class="cresce">
      <div class="tit">${esc(nomeAlvo(x.c))}</div>
      <div class="small muted">${chipArea(x.area)} ${x.materia ? 'matéria toda' : esc(materiaDe(x.c))} · ${x.ok}/${x.n} de primeira${x.rev ? ` · ${x.rev} em revisão` : ''}</div>
      ${barraTaxa(x, media)}
    </div>
    ${botao ? `<button class="btn" data-treinar="${x.c}">Treinar</button>` : ''}
  </li>`;
}
function ligarTreinar() {
  $app.querySelectorAll('[data-treinar]').forEach(b => b.addEventListener('click', () => iniciar(st.cfg.bloco, 'tema', b.dataset.treinar)));
}
function telaPontos() {
  const an = analisePontos();
  const foco = temasFoco(an);
  let corpo;
  if (!an.temOsTemas) {
    corpo = '<section class="card"><p>Os temas das questões ainda não foram carregados (falta <code>data/temas.js</code>).</p></section>';
  } else if (!an.pronto) {
    corpo = `<section class="card destaque"><h2>Ainda é cedo</h2>
      <p>Faça pelo menos <b>${MIN_ANALISE} questões</b> para o app começar a apontar seus pontos fracos (faltam ${MIN_ANALISE - an.n}).</p>
      <div class="barra"><i style="width:${pct(an.n, MIN_ANALISE)}%"></i></div></section>`;
  } else {
    const porArea = ORDEM_AREAS.map(a => {
      const ms = an.materias.filter(m => m.area === a);
      if (!ms.length) return '';
      return `<h3 style="margin-top:14px">${chipArea(a)}</h3><ul class="lista">${ms.map(m => {
        const ts = an.temas.filter(t => t.area === a && materiaDe(t.c) === m.nome).sort((x, y) => x.nota - y.nota);
        return `<li class="bloco-materia"><details><summary><span class="cresce"><span class="tit">${esc(m.nome)}</span> <span class="small muted">${m.ok}/${m.n}</span>${barraTaxa(m, an.media)}</span></summary>
          <ul class="lista">${ts.map(t => linhaTema(t, an.media, t.n >= 1)).join('')}</ul></details></li>`;
      }).join('')}</ul>`;
    }).join('');
    const lentas = an.areas.filter(x => x.n >= 5 && x.tempo > 200).sort((a, b) => b.tempo - a.tempo);
    const motivo = an.motivos[0];
    corpo = `
      <section class="card destaque">
        <h2>Onde você mais erra</h2>
        <p class="small muted">Acerto de primeira (sem chute nem ajuda). A risca na barra é a sua média geral: <b>${Math.round(an.media * 100)}%</b>. Temas com poucas questões ficam perto da média até você fazer mais delas.</p>
        ${an.fracos.length ? `<ul class="lista">${an.fracos.slice(0, 6).map(x => linhaTema(x, an.media)).join('')}</ul>`
          : '<p>Nenhum tema está claramente abaixo da sua média ainda. Continue fazendo questões!</p>'}
      </section>
      ${foco.length && st.cfg.foco ? `<section class="card"><h2>🎯 O que muda nos seus blocos</h2>
        <p>Cerca de <b>1 em cada 3 questões novas</b> dos blocos vem destes temas, até eles subirem para a sua média:</p>
        <p>${foco.map(x => `<span class="chip tag-foco">${esc(nomeAlvo(x.c))}</span>`).join(' ')}</p>
        <p class="small muted" style="margin-bottom:0">Dá para desligar em <a href="#/ajustes">Ajustes</a>. Também dá para treinar um tema direto no botão “Treinar”.</p></section>` : ''}
      ${an.fortes.length ? `<section class="card"><h2>Seus pontos fortes</h2><ul class="lista">${an.fortes.slice(0, 4).map(x => linhaTema(x, an.media, false)).join('')}</ul></section>` : ''}
      ${motivo || lentas.length ? `<section class="card"><h2>Padrões</h2>
        ${motivo ? `<p>Motivo de erro mais comum: <b>${esc(motivo[0])}</b> (${motivo[1]}×). ${DICA_MOTIVO[motivo[0]] || ''}</p>` : ''}
        ${lentas.map(x => `<p>${chipArea(x.area)} você leva em média <b>${Math.round(x.tempo / 60 * 10) / 10} min</b> por questão — no ENEM o ritmo é ~3 min. Experimente um <a href="#/simulado">simulado com tempo</a>.</p>`).join('')}
      </section>` : ''}
      <section class="card"><h2>Todas as matérias</h2><p class="small muted">Toque numa matéria para ver os temas.</p>${porArea}</section>`;
  }
  $app.innerHTML = `<h1>Pontos fracos</h1><p class="muted">${an.n} questões feitas · ${Math.round(an.media * 100)}% de acerto de primeira</p>${corpo}`;
  ligarTreinar();
}

// ---------- simulado
// Prova com N questões e tempo: sem correção no meio, dá para pular e voltar, e no fim (ou quando o
// tempo acaba) mostra o resultado. As respostas entram no histórico: errou → caderno de erros.
const SIM_PADRAO = { n: 20, tempo: 'enem', minutos: 60, areas: [...ORDEM_AREAS], materia: '', origem: 'novas' };
function simCfg() { return { ...SIM_PADRAO, ...(st.cfg.sim || {}) }; }
function fmtTempo(s) {
  s = Math.max(0, Math.round(s));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(x).padStart(2, '0')}` : `${m}:${String(x).padStart(2, '0')}`;
}
function candidatosSim(c) {
  return POOL().filter(q => c.areas.includes(q.area)
    && (!c.materia || `${q.area}|${materiaDe(temaDe(q.id))}` === c.materia)
    && (c.origem === 'todas' || (c.origem === 'erros' ? reg(q.id)?.s === 'rev' : !feita(q.id))));
}
function telaSimulado() {
  const sim = st.simulado;
  if (sim && !sim.fim) return provaSimulado();
  if (sim && sim.fim) return resultadoSimulado();
  const c = simCfg();
  const materias = [...new Set(Object.values(TEMAS.nomes).map(([a, m]) => `${a}|${m}`))];
  const desenhar = () => {
    const disp = candidatosSim(c).length;
    const n = Math.min(c.n, disp);
    const lim = c.tempo === 'enem' ? n * 180 : c.tempo === 'livre' ? null : c.minutos * 60;
    document.getElementById('sim-resumo').innerHTML = disp
      ? `<b>${n} questões</b> · ${lim ? `<b>${fmtTempo(lim)}</b> de prova` : 'sem limite de tempo'}${disp < c.n ? ` <span class="small muted">(só há ${disp} com esses filtros)</span>` : ''}`
      : '<span class="aviso">Nenhuma questão com esses filtros.</span>';
    document.getElementById('sim-ir').disabled = !disp;
  };
  const hist = (st.simulados || []).slice(-6).reverse();
  $app.innerHTML = `
    <h1>Simulado</h1>
    <p class="muted">Responda tudo no seu ritmo, com o relógio correndo. A correção vem só no final.</p>
    <section class="card destaque">
      <label class="campo">Quantas questões?</label>
      <div class="opcoes" id="sim-n">${[5, 10, 20, 45, 90].map(n => `<button class="op ${c.n === n ? 'on' : ''}" data-n="${n}">${n}</button>`).join('')}
        <input type="number" id="sim-n-livre" min="1" max="180" value="${[5, 10, 20, 45, 90].includes(c.n) ? '' : c.n}" placeholder="outro" aria-label="Outra quantidade"></div>
      <label class="campo">Tempo</label>
      <div class="opcoes" id="sim-t">
        <button class="op ${c.tempo === 'enem' ? 'on' : ''}" data-t="enem">Ritmo ENEM (3 min/questão)</button>
        <button class="op ${c.tempo === 'fixo' ? 'on' : ''}" data-t="fixo">Escolher</button>
        <button class="op ${c.tempo === 'livre' ? 'on' : ''}" data-t="livre">Sem limite</button>
      </div>
      <div id="sim-min-box" ${c.tempo === 'fixo' ? '' : 'hidden'} style="margin-top:8px"><input type="number" id="sim-min" min="1" max="600" value="${c.minutos}" style="width:110px"> minutos</div>
      <label class="campo">Áreas</label>
      <div class="dias">${ORDEM_AREAS.map(a => `<label><input type="checkbox" data-sim-area="${a}" ${c.areas.includes(a) ? 'checked' : ''}> ${AREAS[a]}</label>`).join('')}</div>
      ${materias.length ? `<label class="campo" for="sim-mat">Matéria</label>
      <select id="sim-mat"><option value="">Todas as matérias das áreas marcadas</option>${ORDEM_AREAS.map(a => `<optgroup label="${AREAS[a]}">${materias.filter(m => m.startsWith(a + '|')).map(m => `<option value="${esc(m)}" ${c.materia === m ? 'selected' : ''}>${esc(m.split('|')[1])}</option>`).join('')}</optgroup>`).join('')}</select>` : ''}
      <label class="campo" for="sim-origem">Quais questões?</label>
      <select id="sim-origem">
        <option value="novas" ${c.origem === 'novas' ? 'selected' : ''}>Só as que você ainda não fez</option>
        <option value="todas" ${c.origem === 'todas' ? 'selected' : ''}>Qualquer uma (inclui as já feitas)</option>
        <option value="erros" ${c.origem === 'erros' ? 'selected' : ''}>Só do caderno de erros</option>
      </select>
      <p id="sim-resumo" style="margin:16px 0 0"></p>
      <div class="linha-btns"><button class="btn primario grande" id="sim-ir">Começar simulado</button></div>
    </section>
    ${hist.length ? `<section class="card"><h2>Seus últimos simulados</h2><ul class="lista">${hist.map(h => `<li><div><span class="tit">${h.ok}/${h.n} (${pct(h.ok, h.n)}%)</span><div class="small muted">${fmt(h.data)} · ${fmtTempo(h.seg)}${h.limite ? ` de ${fmtTempo(h.limite)}` : ''}</div></div></li>`).join('')}</ul></section>` : ''}
  `;
  const guardar = () => { st.cfg.sim = c; salvar(); desenhar(); };
  $app.querySelectorAll('[data-n]').forEach(b => b.addEventListener('click', () => {
    c.n = +b.dataset.n; document.getElementById('sim-n-livre').value = '';
    $app.querySelectorAll('[data-n]').forEach(x => x.classList.toggle('on', x === b)); guardar();
  }));
  document.getElementById('sim-n-livre').addEventListener('input', e => {
    const v = Math.min(180, Math.max(1, Math.round(+e.target.value || 0)));
    if (!e.target.value) return;
    c.n = v; $app.querySelectorAll('[data-n]').forEach(x => x.classList.remove('on')); guardar();
  });
  $app.querySelectorAll('[data-t]').forEach(b => b.addEventListener('click', () => {
    c.tempo = b.dataset.t;
    $app.querySelectorAll('[data-t]').forEach(x => x.classList.toggle('on', x === b));
    document.getElementById('sim-min-box').hidden = c.tempo !== 'fixo'; guardar();
  }));
  document.getElementById('sim-min').addEventListener('input', e => { c.minutos = Math.min(600, Math.max(1, Math.round(+e.target.value || 1))); guardar(); });
  $app.querySelectorAll('[data-sim-area]').forEach(i => i.addEventListener('change', () => {
    c.areas = [...$app.querySelectorAll('[data-sim-area]:checked')].map(x => x.dataset.simArea);
    if (c.materia && !c.areas.includes(c.materia.split('|')[0])) { c.materia = ''; document.getElementById('sim-mat').value = ''; }
    guardar();
  }));
  document.getElementById('sim-mat')?.addEventListener('change', e => {
    c.materia = e.target.value;
    if (c.materia) { const a = c.materia.split('|')[0]; if (!c.areas.includes(a)) { c.areas.push(a); $app.querySelector(`[data-sim-area="${a}"]`).checked = true; } }
    guardar();
  });
  document.getElementById('sim-origem').addEventListener('change', e => { c.origem = e.target.value; guardar(); });
  document.getElementById('sim-ir').addEventListener('click', () => {
    const qs = embaralhar(candidatosSim(c)).slice(0, c.n)
      .sort((a, b) => ORDEM_AREAS.indexOf(a.area) - ORDEM_AREAS.indexOf(b.area) || a.ano - b.ano || a.num - b.num);
    if (!qs.length) return;
    st.simulado = {
      ids: qs.map(q => q.id), resp: {}, seg: {}, i: 0, inicio: Date.now(), fim: null,
      limite: c.tempo === 'enem' ? qs.length * 180 : c.tempo === 'livre' ? null : c.minutos * 60,
    };
    salvar();
    rota();
  });
  desenhar();
}
function provaSimulado() {
  const sim = st.simulado;
  const q = BYID[sim.ids[sim.i]];
  const total = sim.ids.length;
  const respondidas = () => sim.ids.filter(id => sim.resp[id]).length;
  const entrada = Date.now();
  let saiu = false;
  const contarTempo = () => { if (saiu) return; saiu = true; sim.seg[q.id] = (sim.seg[q.id] || 0) + Math.round((Date.now() - entrada) / 1000); salvar(); };
  $app.innerHTML = `
    <div class="q-prog"><i style="width:${pct(respondidas(), total)}%"></i></div>
    <div class="q-topo">
      <div class="info">${chipArea(q.area)} <span class="chip">Simulado</span></div>
      <div class="info"><span class="relogio" id="relogio">—</span>
        <button class="btn mini" id="sim-grade-btn" aria-expanded="false">${sim.i + 1}/${total} ▾</button>
        <button class="btn mini" id="sim-entregar">Entregar</button></div>
    </div>
    <div class="sim-grade" id="sim-grade" hidden>${sim.ids.map((id, k) => `<button class="${sim.resp[id] ? 'feita' : ''} ${k === sim.i ? 'atual' : ''}" data-ir="${k}" title="Questão ${k + 1}${sim.resp[id] ? ': ' + sim.resp[id] : ''}">${k + 1}</button>`).join('')}</div>
    <div class="q-titulo"><h2>${tituloQ(q)}</h2><span class="ferramentas">${controlesTamanho()}</span></div>
    <div class="questao-img">${imgsHTML(q)}</div>
    <div class="respostas">
      <div class="alts" role="radiogroup" aria-label="Alternativas">${'ABCDE'.split('').map(l => `<button class="alt ${sim.resp[q.id] === l ? 'sel' : ''}" role="radio" aria-checked="${sim.resp[q.id] === l}" data-l="${l}">${l}</button>`).join('')}</div>
      <div class="acoes">
        <span class="secundarias"><button class="btn fantasma" id="sim-ant" ${sim.i ? '' : 'disabled'}>← Anterior</button></span>
        <button class="btn primario" id="sim-prox">${sim.i + 1 < total ? 'Próxima →' : 'Revisar e entregar'}</button>
      </div>
    </div>
  `;
  ligarTamanho(q.id);
  const prox = sim.ids[sim.i + 1];
  if (prox) BYID[prox].imgs.forEach(src => { const im = new Image(); im.src = src; });
  const ir = k => { contarTempo(); sim.i = Math.max(0, Math.min(total - 1, k)); salvar(); window.scrollTo(0, 0); rota(); };
  const relogio = document.getElementById('relogio');
  const tick = () => {
    const passou = (Date.now() - sim.inicio) / 1000;
    if (sim.limite) {
      const resta = sim.limite - passou;
      relogio.textContent = '⏱ ' + fmtTempo(resta);
      relogio.classList.toggle('acabando', resta < 300);
      if (resta <= 0) { clearInterval(timer); contarTempo(); setTimeout(() => entregarSimulado(true)); }
    } else relogio.textContent = '⏱ ' + fmtTempo(passou);
  };
  const timer = setInterval(tick, 1000);
  tick();
  aoSair(() => { clearInterval(timer); contarTempo(); });
  $app.querySelectorAll('.alt').forEach(b => b.addEventListener('click', () => {
    const l = b.dataset.l;
    if (sim.resp[q.id] === l) delete sim.resp[q.id]; else sim.resp[q.id] = l;   // tocar de novo desmarca
    salvar();
    $app.querySelectorAll('.alt').forEach(x => { const on = sim.resp[q.id] === x.dataset.l; x.classList.toggle('sel', on); x.setAttribute('aria-checked', on); });
    $app.querySelector(`[data-ir="${sim.i}"]`).classList.toggle('feita', !!sim.resp[q.id]);
    $app.querySelector('.q-prog > i').style.width = pct(respondidas(), total) + '%';
  }));
  document.getElementById('sim-ant').addEventListener('click', () => ir(sim.i - 1));
  document.getElementById('sim-prox').addEventListener('click', () => {
    if (sim.i + 1 < total) return ir(sim.i + 1);
    abrirGrade(true);
  });
  const grade = document.getElementById('sim-grade');
  const gbtn = document.getElementById('sim-grade-btn');
  const abrirGrade = (forcar) => {
    grade.hidden = forcar ? false : !grade.hidden;
    gbtn.setAttribute('aria-expanded', !grade.hidden);
    if (!grade.hidden) grade.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  };
  gbtn.addEventListener('click', () => abrirGrade());
  grade.querySelectorAll('[data-ir]').forEach(b => b.addEventListener('click', () => ir(+b.dataset.ir)));
  document.getElementById('sim-entregar').addEventListener('click', () => {
    const faltam = total - respondidas();
    if (!confirm(faltam ? `Ainda faltam ${faltam} ${faltam === 1 ? 'questão' : 'questões'} sem resposta. Entregar mesmo assim?` : 'Entregar o simulado?')) return;
    contarTempo();
    entregarSimulado(false);
  });
  const teclas = e => {
    if (e.target.matches?.('input, textarea, select')) return;
    const k = e.key.toUpperCase();
    if ('ABCDE'.includes(k) && k.length === 1) $app.querySelector(`.alt[data-l="${k}"]`)?.click();
    else if (e.key === 'ArrowRight' || e.key === 'Enter') document.getElementById('sim-prox').click();
    else if (e.key === 'ArrowLeft' && sim.i) ir(sim.i - 1);
  };
  document.addEventListener('keydown', teclas);
  aoSair(() => document.removeEventListener('keydown', teclas));
}
function entregarSimulado(acabouTempo) {
  const sim = st.simulado;
  if (!sim || sim.fim) return;
  const h = hoje();
  sim.fim = Date.now();
  sim.acabouTempo = acabouTempo;
  sim.ok = 0;
  for (const id of sim.ids) {
    const letra = sim.resp[id];
    if (!letra) continue;   // em branco: a questão continua como estava
    const r = reg(id);
    const tipo = r?.s === 'rev' ? (r.prox <= h ? 'rev' : 'simrev') : feita(id) ? 'pratica' : 'nova';
    if (registrar(id, tipo, letra, sim.seg[id] || 0)) sim.ok++;
  }
  const seg = Math.round((sim.fim - sim.inicio) / 1000);
  (st.simulados ||= []).push({ data: h, n: sim.ids.length, ok: sim.ok, seg: sim.limite ? Math.min(seg, sim.limite) : seg, limite: sim.limite });
  salvar();
  if (location.hash === '#/simulado') rota(); else location.hash = '#/simulado';
}
function resultadoSimulado() {
  const sim = st.simulado;
  const n = sim.ids.length;
  const brancos = sim.ids.filter(id => !sim.resp[id]).length;
  const seg = Math.round((sim.fim - sim.inicio) / 1000);
  const usado = sim.limite ? Math.min(seg, sim.limite) : seg;
  const grupos = {};
  for (const id of sim.ids) {
    const q = BYID[id];
    const c = temaDe(id);
    const k = c ? `${q.area}|${materiaDe(c)}` : `${q.area}|${AREAS[q.area]}`;
    const g = grupos[k] || (grupos[k] = { area: q.area, nome: k.split('|')[1], n: 0, ok: 0 });
    g.n++; if (sim.resp[id] === q.resp) g.ok++;
  }
  const G = Object.values(grupos).sort((a, b) => ORDEM_AREAS.indexOf(a.area) - ORDEM_AREAS.indexOf(b.area) || a.ok / a.n - b.ok / b.n);
  const erradas = sim.ids.filter(id => sim.resp[id] !== BYID[id].resp);
  $app.innerHTML = `
    <section class="card destaque" style="text-align:center">
      <h1>${sim.acabouTempo ? 'Acabou o tempo!' : 'Simulado entregue'}</h1>
      <p style="font-size:40px;margin:8px 0;font-weight:800">${sim.ok}/${n}</p>
      <p class="muted">${pct(sim.ok, n)}% de acerto · ${fmtTempo(usado)}${sim.limite ? ` de ${fmtTempo(sim.limite)}` : ''} · ${fmtTempo(usado / n)} por questão${brancos ? ` · ${brancos} em branco` : ''}</p>
      <p class="small muted">As erradas já foram para o caderno de erros${brancos ? ' (as em branco continuam como novas)' : ''}.</p>
      <div class="linha-btns" style="justify-content:center">
        <button class="btn primario" id="sim-novo">Novo simulado</button>
        <a class="btn" href="#/pontos">Ver pontos fracos</a>
      </div>
    </section>
    <section class="card"><h2>Por matéria</h2><ul class="lista">${G.map(g => `<li><div class="cresce"><div>${chipArea(g.area)} <span class="tit">${esc(g.nome)}</span> <span class="small muted">${g.ok}/${g.n}</span></div>
      <div class="taxa"><div class="barra fina"><i style="width:${pct(g.ok, g.n)}%;background:${g.ok / g.n >= 0.6 ? 'var(--ok)' : g.ok / g.n >= 0.4 ? 'var(--aviso)' : 'var(--erro)'}"></i></div><span>${pct(g.ok, g.n)}%</span></div></div></li>`).join('')}</ul></section>
    <section class="card"><h2>Gabarito</h2>
      <div class="sim-gabarito">${sim.ids.map((id, k) => { const q = BYID[id]; const r = sim.resp[id]; const cls = !r ? 'branco' : r === q.resp ? 'certa' : 'errada';
        return `<button class="${cls}" data-ver="${id}" title="${esc(tituloQ(q))}${temaDe(id) ? ' — ' + esc(rotuloTema(temaDe(id))) : ''}"><b>${k + 1}</b><span>${r || '–'}${r === q.resp ? '' : ` → ${q.resp}`}</span></button>`; }).join('')}</div>
      <p class="small muted">Toque numa questão para rever com a explicação.</p>
    </section>
    ${erradas.length ? `<section class="card"><h2>Erradas</h2><ul class="lista">${erradas.map(id => { const q = BYID[id];
      return `<li><div><div class="tit">${tituloQ(q)}</div><div class="small muted">${chipArea(q.area)} ${esc(rotuloTema(temaDe(id)))} · você: ${sim.resp[id] || 'em branco'} · certa: ${q.resp}</div></div><button class="btn" data-ver="${id}">Rever</button></li>`; }).join('')}</ul></section>` : ''}
  `;
  $app.querySelectorAll('[data-ver]').forEach(b => b.addEventListener('click', () => { location.hash = '#/ver/' + b.dataset.ver; }));
  document.getElementById('sim-novo').addEventListener('click', () => { st.simulado = null; salvar(); rota(); });
}

// ---------- progresso
function telaProgresso() {
  const pool = POOL();
  const anos = [...new Set(pool.map(q => q.ano))].sort((a, b) => b - a);
  const porArea = ORDEM_AREAS.map(a => {
    const qs = pool.filter(q => q.area === a);
    const f = qs.filter(q => feita(q.id));
    const primeira = f.filter(q => reg(q.id).h[0][2] === 1 && !reg(q.id).h[0][4]).length;
    const rev = qs.filter(q => reg(q.id)?.s === 'rev').length;
    return { a, total: qs.length, feitas: f.length, primeira, rev };
  });
  const celula = (ano, a) => {
    const qs = pool.filter(q => q.ano === ano && q.area === a);
    const f = qs.filter(q => feita(q.id));
    const ok = f.filter(q => reg(q.id).h[0][2] === 1).length;
    const p = pct(f.length, qs.length);
    const cor = `color-mix(in srgb, var(--${a.toLowerCase()}) ${Math.round(p * 0.6)}%, var(--bg))`;
    return `<td style="background:${cor}" title="${AREAS[a]} ${ano}: ${f.length}/${qs.length} feitas, ${pct(ok, f.length)}% de acerto">${f.length ? `${f.length}/${qs.length}` : '·'}</td>`;
  };
  const h = hoje();
  let calor = '';
  for (let k = 83; k >= 0; k--) {
    const d = somaDias(h, -k);
    const lg = st.log[d];
    const n = lg ? lg.n + lg.r : 0;
    const a = n === 0 ? 0 : n < 5 ? 25 : n < 10 ? 50 : n < 20 ? 75 : 100;
    calor += `<i title="${fmt(d)}: ${n}" style="${n ? `background:color-mix(in srgb, var(--azul) ${a}%, var(--line))` : ''}"></i>`;
  }
  const tot = porArea.reduce((s, x) => s + x.feitas, 0);
  const totOk = porArea.reduce((s, x) => s + x.primeira, 0);
  $app.innerHTML = `
    <h1>Progresso</h1>
    <a class="btn grande" href="#/pontos" style="margin-top:8px">🎯 Ver meus pontos fracos</a>
    <section class="card">
      <div class="grid2">
        <div class="stat"><b>${tot}</b><span>questões feitas de ${pool.length}</span></div>
        <div class="stat"><b>${pct(totOk, tot)}%</b><span>acerto de primeira</span></div>
        <div class="stat"><b>${emRevisao().length}</b><span>no caderno de erros</span></div>
        <div class="stat"><b>${pool.filter(q => reg(q.id)?.s === 'rec').length}</b><span>erros recuperados</span></div>
      </div>
    </section>
    <section class="card">
      <h2>Por área</h2>
      ${porArea.map(x => `
        <div style="margin:12px 0">
          <div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap">${chipArea(x.a)}<span class="small muted">${x.feitas}/${x.total} · ${pct(x.primeira, x.feitas)}% de acerto · ${x.rev} em revisão</span></div>
          <div class="barra" style="margin-top:6px"><i style="width:${pct(x.feitas, x.total)}%;background:var(--${x.a.toLowerCase()})"></i></div>
        </div>`).join('')}
    </section>
    <section class="card">
      <h2>Por prova</h2>
      <div style="overflow-x:auto"><table class="tabela-anos">
        <tr><th></th>${ORDEM_AREAS.map(a => `<th>${AREAS[a]}</th>`).join('')}</tr>
        ${anos.map(ano => `<tr><th>${ano}</th>${ORDEM_AREAS.map(a => celula(ano, a)).join('')}</tr>`).join('')}
      </table></div>
    </section>
    <section class="card">
      <h2>Últimas 12 semanas</h2>
      <div class="calor">${calor}</div>
    </section>
  `;
}

// ---------- ajustes
function telaAjustes() {
  const c = st.cfg;
  $app.innerHTML = `
    <h1>Ajustes</h1>
    <section class="card">
      <h2>Cronograma</h2>
      <label class="campo" for="prova">Data do ENEM (1º dia)</label>
      <input type="date" id="prova" value="${c.prova}">
      <label class="campo" for="folga">Terminar as questões novas quantos dias antes da prova?</label>
      <select id="folga">${[0, 15, 30, 45, 60].map(n => `<option value="${n}" ${c.folgaFinal === n ? 'selected' : ''}>${n ? `${n} dias antes (reta final só de revisão)` : 'Até a véspera'}</option>`).join('')}</select>
      <label class="campo">Dias que você estuda</label>
      <div class="dias">${DIAS_SEMANA.map((d, k) => `<label><input type="checkbox" data-dia="${k}" ${c.dias.includes(k) ? 'checked' : ''}> ${d}</label>`).join('')}</div>
      <label class="campo" for="bloco">Tamanho do bloco</label>
      <select id="bloco">${[5, 10, 15, 20, 30].map(n => `<option value="${n}" ${c.bloco === n ? 'selected' : ''}>${n} questões (~${n * 3} min)</option>`).join('')}</select>
    </section>
    <section class="card">
      <h2>Questões</h2>
      <label class="campo" for="lingua">Língua estrangeira</label>
      <select id="lingua"><option value="ING" ${c.lingua === 'ING' ? 'selected' : ''}>Inglês</option><option value="ESP" ${c.lingua === 'ESP' ? 'selected' : ''}>Espanhol</option></select>
      <label class="campo" for="ordem">Ordem das questões novas</label>
      <select id="ordem">
        <option value="intercalado" ${c.ordem === 'intercalado' ? 'selected' : ''}>Intercalado — uma de cada área, das provas mais recentes às mais antigas</option>
        <option value="prova" ${c.ordem === 'prova' ? 'selected' : ''}>Prova por prova — termina 2025 inteira, depois 2024…</option>
      </select>
      <label class="campo">Áreas</label>
      <div class="dias">${ORDEM_AREAS.map(a => `<label><input type="checkbox" data-area="${a}" ${c.areas.includes(a) ? 'checked' : ''}> ${AREAS[a]}</label>`).join('')}</div>
      <p class="small muted">Desmarcar uma área só muda o que aparece nos blocos; o cronograma continua contando todas.</p>
      <div class="dias" style="margin-top:12px"><label><input type="checkbox" id="foco" ${c.foco ? 'checked' : ''}> 🎯 Reforçar pontos fracos</label></div>
      <p class="small muted">Ligado: cerca de 1 em cada 3 questões novas dos blocos vem dos seus 3 temas mais fracos (veja em Progresso › Pontos fracos).</p>
    </section>
    <section class="card">
      <h2>Explicações com IA (opcional)</h2>
      <p class="small muted">O botão “Por que é X?” manda a imagem da questão para o Claude (${MODELO}) e mostra um resumo curto. Precisa de uma chave da API da Anthropic (console.anthropic.com) — cada explicação custa uns poucos centavos e fica salva no app, então só é paga uma vez. A chave fica guardada apenas neste navegador.</p>
      <label class="campo" for="apikey">Chave da API</label>
      <input type="password" id="apikey" placeholder="sk-ant-..." value="${esc(c.apiKey)}" autocomplete="off">
    </section>
    <section class="card">
      <h2>Backup</h2>
      <p class="small muted">O progresso fica salvo só neste navegador. Exporte de vez em quando (ou para levar para outro aparelho).</p>
      <div class="linha-btns">
        <button class="btn" data-acao="exportar">Exportar progresso</button>
        <label class="btn">Importar progresso<input type="file" accept="application/json" id="importar" hidden></label>
        <button class="btn perigo" data-acao="zerar">Apagar tudo</button>
      </div>
    </section>
    <p class="small muted">${QUESTOES.length} questões carregadas (2010–2025, caderno azul).</p>
  `;
  const g = id => document.getElementById(id);
  g('prova').addEventListener('change', e => { if (e.target.value) { c.prova = e.target.value; salvar(); } });
  g('folga').addEventListener('change', e => { c.folgaFinal = +e.target.value; salvar(); });
  g('bloco').addEventListener('change', e => { c.bloco = +e.target.value; salvar(); });
  g('lingua').addEventListener('change', e => { c.lingua = e.target.value; salvar(); });
  g('ordem').addEventListener('change', e => { c.ordem = e.target.value; salvar(); });
  g('foco').addEventListener('change', e => { c.foco = e.target.checked; salvar(); });
  g('apikey').addEventListener('change', e => { c.apiKey = e.target.value.trim(); salvar(); });
  $app.querySelectorAll('[data-dia]').forEach(i => i.addEventListener('change', () => {
    c.dias = [...$app.querySelectorAll('[data-dia]:checked')].map(x => +x.dataset.dia); salvar();
  }));
  $app.querySelectorAll('[data-area]').forEach(i => i.addEventListener('change', () => {
    c.areas = [...$app.querySelectorAll('[data-area]:checked')].map(x => x.dataset.area); salvar();
  }));
  $app.querySelector('[data-acao=exportar]').addEventListener('click', () => {
    const dados = { versao: 1, exportado: new Date().toISOString(), estado: { ...st, cfg: { ...st.cfg, apiKey: '' } }, explicacoes };
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(dados)], { type: 'application/json' }));
    a.download = `enem-progresso-${hoje()}.json`;
    a.click();
  });
  g('importar').addEventListener('change', async e => {
    const f = e.target.files[0];
    if (!f) return;
    try {
      const d = JSON.parse(await f.text());
      if (!d.estado || !d.estado.q) throw new Error('arquivo inválido');
      if (!confirm('Substituir o progresso atual pelo do arquivo?')) return;
      const chave = st.cfg.apiKey;
      st = { ...padrao(), ...d.estado, cfg: { ...padrao().cfg, ...d.estado.cfg, apiKey: chave } };
      explicacoes = { ...explicacoes, ...(d.explicacoes || {}) };
      salvar(); salvarExplicacoes();
      alert('Progresso importado!');
      rota();
    } catch (err) { alert('Não consegui ler o arquivo: ' + err.message); }
  });
  $app.querySelector('[data-acao=zerar]').addEventListener('click', () => {
    if (!confirm('Apagar TODO o progresso? Isso não pode ser desfeito (a não ser que você tenha um backup).')) return;
    const chave = st.cfg.apiKey;
    st = padrao(); st.cfg.apiKey = chave; salvar(); rota();
  });
}

// ---------- lógica
function telaLogica() {
  $app.innerHTML = `
    <h1>A lógica do app</h1>
    <section class="card">
      <h2>1. Uma passada por todas as questões</h2>
      <p>São todas as provas azuis de 2010 a 2025 (~2.800 questões, sem as anuladas). Cada questão nova aparece <b>uma vez</b>.
      Por padrão elas vêm <b>intercaladas</b> (uma de cada área), começando pelas provas mais recentes — que são as mais parecidas com a prova que você vai fazer.</p>
    </section>
    <section class="card">
      <h2>2. Errou? Volta até você dominar</h2>
      <p>Errou, ou acertou no chute → a questão entra no <b>caderno de erros</b> e reaparece em intervalos crescentes:</p>
      <p><b>amanhã → 3 dias → 7 dias → 21 dias</b>. Acertou as 4 revisões seguidas → <b>recuperada</b>. Errou numa revisão → volta pro começo (amanhã).</p>
      <p class="small muted">Por que não refazer na hora? Logo depois de ver a resposta você acerta por memória, não por entendimento. Esperar um dia testa se você aprendeu de verdade.</p>
    </section>
    <section class="card">
      <h2>3. Quando você erra</h2>
      <ul>
        <li>Travou numa questão? <b>🤷 Não sei — ver resolução</b> mostra a resposta, a explicação e o vídeo. Ela entra no caderno de erros, para você tentar sozinho amanhã.</li>
        <li>O app mostra a <b>alternativa certa</b> na hora.</li>
        <li><b>💡 Por que é X?</b> — um resumo curto do raciocínio (gerado pelo Claude, se você configurar a chave).</li>
        <li><b>▶ Resolução no YouTube</b> — já abre a busca da questão exata; se achar um vídeo bom, salve o link e o botão passa a abrir direto nele.</li>
        <li><b>Por que errei?</b> — marque o motivo. Com o tempo você vê seu padrão (ex.: muito erro de desatenção = ler o comando com mais calma).</li>
      </ul>
    </section>
    <section class="card">
      <h2>4. Cronograma leve</h2>
      <p>Você escolhe a data da prova e os dias em que estuda. O app divide as questões que faltam pelos dias de estudo até <b>30 dias antes da prova</b> e mostra a <b>meta de novas do dia</b>.</p>
      <p>Não existe “atrasado”: se um dia você não estuda, a meta dos próximos dias é recalculada sozinha (sobe um pouquinho). Se adiantar, ela cai.</p>
      <p>O estudo é em <b>blocos de ${st.cfg.bloco} questões</b> (~${st.cfg.bloco * 3} min) — dá pra fazer um no ônibus, outro no intervalo. Pode sair no meio: o bloco fica salvo.
      Em cada bloco, até metade das vagas vai para as revisões do dia, misturadas com as novas.</p>
      <p>Nos últimos 30 dias não entram questões novas: é a <b>reta final</b>, só caderno de erros.</p>
    </section>
    <section class="card">
      <h2>Ordem de prioridade de cada dia</h2>
      <ol>
        <li>Revisões vencidas (o que você errou e está na hora de rever).</li>
        <li>Questões novas até a meta do dia.</li>
        <li>Sobrou tempo? Mais um bloco — adianta o cronograma.</li>
      </ol>
    </section>
  `;
}

// ---------------------------------------------------------------- explicação com Claude
async function imagemBase64(src) {
  const blob = await (await fetch(src)).blob();
  return await new Promise((ok, falha) => {
    const fr = new FileReader();
    fr.onload = () => ok(String(fr.result).split(',')[1]);
    fr.onerror = falha;
    fr.readAsDataURL(blob);
  });
}

let explicando = false;
async function explicar(q, marcada, el, modo = 'porque') {
  const chave = modo === 'dica' ? `${q.id}:dica` : q.id;
  if (explicacoes[chave]) { el.innerHTML = `<p>${md(explicacoes[chave])}</p>`; return; }
  if (!st.cfg.apiKey) {
    el.innerHTML = `<p class="aviso">Para ver a explicação escrita, coloque sua chave da API da Anthropic em <a href="#/ajustes">Ajustes</a>. Enquanto isso, o vídeo do YouTube resolve!</p>`;
    return;
  }
  if (location.protocol === 'file:') {
    el.innerHTML = `<p class="aviso">Abra o app pelo <b>INICIAR.bat</b> (servidor local) para usar as explicações.</p>`;
    return;
  }
  if (explicando) return;
  explicando = true;
  el.innerHTML = '<p class="muted">Pensando na explicação…</p>';
  let Anthropic;
  try {
    ({ default: Anthropic } = await import(SDK_URL));
    const client = new Anthropic({ apiKey: st.cfg.apiKey, dangerouslyAllowBrowser: true });
    const imgs = await Promise.all(q.imgs.map(imagemBase64));
    const errou = marcada && marcada !== q.resp && marcada !== '?';
    const pedido = modo === 'dica' ? [
      `Questão ${q.num} do ENEM ${q.ano} (caderno azul, área de ${AREAS[q.area]}). Para sua referência, o gabarito oficial é ${q.resp}, mas o estudante AINDA NÃO respondeu.`,
      'Em no máximo 130 palavras, mostre o caminho para resolver: o que a questão pede, o conceito ou a fórmula que resolve e os passos do raciocínio.',
      'NÃO diga qual alternativa é a correta, não cite a letra, não faça a conta até o valor final e não elimine alternativas até sobrar uma. Pare um passo antes da resposta.',
      'Use **negrito** só em termos importantes. Sem títulos, sem repetir o enunciado.',
    ].join('\n') : [
      `Questão ${q.num} do ENEM ${q.ano} (caderno azul, área de ${AREAS[q.area]}). O gabarito oficial é a alternativa ${q.resp}.`,
      errou ? `O estudante marcou ${marcada}.` : '',
      'Em no máximo 130 palavras, para um estudante que vai revisar essa questão:',
      `1. Explique por que a alternativa ${q.resp} está correta (o raciocínio ou a conta essencial).`,
      errou ? `2. Explique por que a ${marcada} está errada — qual a confusão ou pegadinha.` : '2. Aponte a pegadinha principal entre as outras alternativas.',
      '3. Termine com uma linha "Conceito-chave: ..." com o assunto que ele deve revisar.',
      'Use **negrito** só em termos importantes. Sem títulos, sem repetir o enunciado.',
    ].filter(Boolean).join('\n');
    const stream = client.beta.messages.stream({
      model: MODELO,
      max_tokens: 8000,
      output_config: { effort: 'medium' },
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      system: 'Você é um professor experiente de cursinho pré-ENEM. Responde em português do Brasil, de forma curta, clara e correta. Confie no gabarito oficial informado.',
      messages: [{
        role: 'user',
        content: [
          ...imgs.map(data => ({ type: 'image', source: { type: 'base64', media_type: 'image/webp', data } })),
          { type: 'text', text: pedido },
        ],
      }],
    });
    let texto = '';
    stream.on('text', t => { texto += t; el.innerHTML = `<p>${md(texto)}</p>`; });
    const final = await stream.finalMessage();
    if (final.stop_reason === 'refusal') {
      el.innerHTML = '<p class="aviso">O modelo não respondeu essa. Tente o vídeo do YouTube.</p>';
      return;
    }
    texto = final.content.filter(b => b.type === 'text').map(b => b.text).join('');
    explicacoes[chave] = texto;
    salvarExplicacoes();
    el.innerHTML = `<p>${md(texto)}</p>`;
  } catch (err) {
    let msg = 'Não consegui gerar a explicação agora.';
    if (Anthropic && err instanceof Anthropic.AuthenticationError) msg = 'Chave da API inválida. Confira em Ajustes.';
    else if (Anthropic && err instanceof Anthropic.RateLimitError) msg = 'Muitas requisições seguidas — tente de novo em alguns segundos.';
    else if (Anthropic && err instanceof Anthropic.APIConnectionError) msg = 'Sem conexão com a internet.';
    else if (Anthropic && err instanceof Anthropic.APIError) msg += ` (${err.status ?? ''} ${esc(err.message)})`;
    else if (!Anthropic) msg = 'Não consegui carregar a biblioteca (sem internet?).';
    el.innerHTML = `<p class="aviso">${msg}</p>`;
  } finally {
    explicando = false;
  }
}

// ---------------------------------------------------------------- rotas
function rota() {
  limpar.forEach(f => f());
  limpar = [];
  if (!QUESTOES.length) {
    $app.innerHTML = '<div class="card"><h2>Sem questões</h2><p>Rode <code>py tools/extrair.py</code> para gerar <code>app/data/questoes.js</code> a partir dos PDFs.</p></div>';
    return;
  }
  const [, pagina = '', arg] = location.hash.split('/');
  const emProva = pagina === 'simulado' && st.simulado && !st.simulado.fim;
  $app.classList.toggle('larga', pagina === 'estudar' || pagina === 'ver' || emProva);
  document.querySelectorAll('[data-nav]').forEach(a => a.classList.toggle('ativo',
    a.dataset.nav === ({ pontos: 'progresso' }[pagina] || pagina || 'inicio')));
  if (pagina === 'estudar') telaEstudar();
  else if (pagina === 'simulado') telaSimulado();
  else if (pagina === 'pontos') telaPontos();
  else if (pagina === 'erros') telaErros();
  else if (pagina === 'progresso') telaProgresso();
  else if (pagina === 'ajustes') telaAjustes();
  else if (pagina === 'logica') telaLogica();
  else if (pagina === 'ver' && BYID[arg]) verQuestao(arg);
  else telaInicio();
}
window.addEventListener('hashchange', () => { window.scrollTo(0, 0); rota(); });
rota();
