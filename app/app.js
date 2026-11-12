// ENEM Azul — app de estudo "fazer todas as questões e voltar nas que errei".
// Tudo roda no navegador; o progresso fica no localStorage.

// rede de segurança: se algo quebrar (ao abrir o app ou uma tela), mostra o erro e oferece uma cópia do progresso,
// em vez de deixar a tela em branco. Não usa nada declarado mais abaixo (pode rodar antes de o app terminar de carregar).
function mostrarFalha(err) {
  console.error(err);
  const el = document.getElementById('app');
  if (!el) return;
  const msg = String(err?.stack || err?.message || err).split('\n').slice(0, 4).join('\n').replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  document.body.classList.remove('sem-conta', 'foco');
  el.innerHTML = `<section class="card" style="border-color:var(--verm)">
    <h2>Algo deu errado ao abrir esta tela</h2>
    <p class="small">Seu progresso continua salvo neste navegador. Se recarregar não resolver, mande esta mensagem para quem cuida do app:</p>
    <pre class="falha">${msg}</pre>
    <div class="linha-btns"><button class="btn primario" type="button" id="falha-recarregar">Recarregar</button>
      <button class="btn" type="button" id="falha-backup">Baixar cópia do progresso</button><a class="btn" href="#/">Ir para o início</a></div>
  </section>`;
  document.getElementById('falha-recarregar').onclick = () => location.reload();
  document.getElementById('falha-backup').onclick = () => {
    let estado = {};
    try { estado = JSON.parse(localStorage.getItem('enem.v1')) || {}; } catch { /* ilegível: vai vazio */ }
    if (estado.cfg) for (const k of ['apiKey', 'chaveGoogle', 'chaveOpenai']) estado.cfg[k] = '';
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify({ versao: 1, exportado: new Date().toISOString(), estado })], { type: 'application/json' }));
    a.download = 'enem-progresso.json';
    a.click();
  };
}
window.addEventListener('error', e => { if (!e.filename || e.filename.includes('app.js')) mostrarFalha(e.error || e.message); });

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
// Caixas de revisão (sistema Leitner): errou → caixa 1; cada acerto numa revisão sobe uma caixa. A volta é bem espaçada
// para dar tempo de esquecer a alternativa que você marcou (texto de Linguagens/Humanas gruda mais na memória, então
// espera mais). Enquanto a errada espera, o reforço traz questões NOVAS do mesmo tema.
const INTERVALOS = { hum: { 1: 14, 2: 21, 3: 30, 4: 45 }, exa: { 1: 7, 2: 14, 3: 30, 4: 45 } };
const CAIXA_MAX = 4;
// dias até a próxima revisão de uma questão na caixa N; perto da prova encolhe para as revisões que faltam caberem antes dela
function intervalo(id, caixa) {
  const a = BYID[id]?.area;
  const base = INTERVALOS[a === 'LC' || a === 'CH' ? 'hum' : 'exa'][caixa] || 1;
  const ate = diffDias(hoje(), st.cfg.prova);
  return Math.max(1, Math.min(base, Math.floor(ate / (CAIXA_MAX - caixa + 2))));
}
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
      trilha: true,   // trilha de focos: um tema em foco por área (ver ordemTrilha)
      redacao: true,   // dias de redação no cronograma
      apiKey: '',          // chave da Anthropic (Claude)
      ia: 'anthropic',     // qual IA explica: anthropic | google | openai
      chaveGoogle: '', modeloGoogle: '',
      chaveOpenai: '', modeloOpenai: '',
    },
    simulado: null,   // simulado em andamento ou recém-entregue
    simulados: [],    // histórico: { data, n, ok, seg, limite }
    q: {},      // id -> { s: 'dom'|'rev'|'rec', caixa, prox, h: [[data, letra, ok, segundos, chute]], motivo, nota, video, pulou }
    log: {},    // 'AAAA-MM-DD' -> { n: novas, r: revisões, ok: acertos }
    sessao: null,     // bloco ativo
    pausadas: {},     // blocos guardados por tipo: { normal, rev } — um não apaga o outro
    reforco: [],      // erros esperando reforço: { id da errada, c: tema, d: data do erro }
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
function salvar() {
  st.mod = Date.now();   // hora da última mudança: na junção com a nuvem, os ajustes do lado mais novo valem
  localStorage.setItem(KEY, JSON.stringify(st));
  setTimeout(() => {
    if (st.ranking?.on) rankingAgendar();   // manda o placar da semana (com espera, sem pressa)
    syncAgendar();                          // e o progresso para a conta Google, se houver
  }, 0);
}
// revisões marcadas com os intervalos antigos (1, 3, 7, 21 dias): reespaça a partir da última resposta (só empurra para depois)
if (!st.intervalos2) {
  for (const [id, r] of Object.entries(st.q)) {
    if (r.s !== 'rev' || !r.h?.length) continue;
    const p = somaDias(r.h[r.h.length - 1][0], intervalo(id, r.caixa || 1));
    if (!r.prox || p > r.prox) r.prox = p;
  }
  st.intervalos2 = 1;
  salvar();
}

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
// respondida hoje: a memória ainda está fresca, então não volta no mesmo dia (nem adiantando revisões)
function respondidaHoje(id) { const h = reg(id)?.h; return !!h?.length && h[h.length - 1][0] === hoje(); }
// dá para adiantar a revisão? só depois de passada metade da espera — antes disso você ainda lembra a alternativa
function adiantavel(id) {
  const r = reg(id), h = r?.h;
  if (!h?.length || !r.prox) return !respondidaHoje(id);
  const u = h[h.length - 1][0];
  return diffDias(u, hoje()) * 2 >= diffDias(u, r.prox);
}
// revisões que dá para adiantar: do caderno de erros, já na segunda metade da espera, da que vence antes para a depois
function adiantaveis() { return emRevisao().filter(q => !respondidaHoje(q.id) && adiantavel(q.id)).sort((a, b) => reg(a.id).prox.localeCompare(reg(b.id).prox)); }

function filaNovas() {
  const areas = st.cfg.areas.length ? st.cfg.areas : ORDEM_AREAS;
  const cands = POOL().filter(q => !feita(q.id) && areas.includes(q.area));
  const pulou = q => (reg(q.id)?.pulou ? 1 : 0);
  if (st.cfg.ordem === 'prova') {
    return cands.sort((a, b) => pulou(a) - pulou(b) || b.ano - a.ano || a.num - b.num);
  }
  // intercalado: uma de cada área por vez, das provas mais recentes para as mais antigas
  // (com a trilha de focos: dentro de cada área, o tema em foco e os temas que já passaram — ver ordemTrilha)
  const ct = trilhaLigada() ? contagemTemas() : null;
  marcaTrilha = {};
  const porArea = areas.map(a => {
    const l = cands.filter(q => q.area === a).sort((x, y) => pulou(x) - pulou(y) || y.ano - x.ano || x.num - y.num);
    return ct ? ordemTrilha(a, l, ct) : l;
  });
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

// ---- reforço dos erros: cada erro pede UMA questão NOVA do mesmo tema (sem tema sobrando: da matéria; depois da
// área), para treinar o assunto enquanto a errada espera a revisão. Também avança as questões novas do banco.
// Qualquer questão nova do mesmo tema respondida em outro bloco cumpre o reforço; erro numa questão de reforço não pede outro.
const REFORCO_DIAS = 14;   // depois disso o reforço caduca (a revisão da errada já está chegando)
function pedirReforco(id) {
  const lim = somaDias(hoje(), -REFORCO_DIAS);
  st.reforco = (st.reforco || []).filter(e => e.d > lim && e.id !== id);
  st.reforco.push({ id, c: temaDe(id), d: hoje() });
}
function tirarReforco(id) { if (st.reforco) st.reforco = st.reforco.filter(e => e.id !== id); }
// respondeu a questão nova `id`: cumpre o reforço `ref` (bloco de reforço) ou o mais antigo do mesmo tema
function cumprirReforco(id, ref) {
  const lista = st.reforco || [], c = temaDe(id);
  const k = ref ? lista.findIndex(e => e.id === ref) : c ? lista.findIndex(e => e.c === c && e.id !== id) : -1;
  if (k < 0) return;
  lista.splice(k, 1);
  const lg = st.log[hoje()] || (st.log[hoje()] = { n: 0, r: 0, ok: 0 });
  lg.f = (lg.f || 0) + 1;
}
// reforços em aberto, cada um já com a sua questão nova (sem repetir); os que não têm mais questão ficam de fora
function reforcosPendentes() {
  const lim = somaDias(hoje(), -REFORCO_DIAS);
  const fila = filaNovas(), usadas = new Set(), out = [];
  const pega = f => { const q = fila.find(x => !usadas.has(x.id) && f(x)); if (q) usadas.add(q.id); return q; };
  for (const e of [...(st.reforco || [])].sort((x, y) => x.d.localeCompare(y.d))) {   // os mais antigos primeiro (os obrigatórios de hoje)
    if (e.d <= lim) continue;
    const mat = e.c?.split('.')[0], area = BYID[e.id]?.area;
    const q = (e.c && pega(x => temaDe(x.id) === e.c)) || (mat && pega(x => temaDe(x.id)?.split('.')[0] === mat)) || pega(x => x.area === area);
    if (q) out.push({ e, q });
  }
  return out;
}

// ---------------------------------------------------------------- trilha de focos
// Cada área tem UM tema em foco por vez (ex.: Natureza › Biologia › Citologia e bioquímica): 2 de cada 3 questões novas
// da área vêm dele, e a outra de um tema que já passou pelo foco (o que você viu há mais tempo primeiro). A etapa de
// foco usa só METADE das questões novas que faltam do tema, e as questões "de tema passado" nunca comem os últimos 30%
// de um tema: isso fica guardado para as etapas de revisão — uma depois de cada 3 temas (o tema mais antigo ainda não
// revisto) e, no fim do 1º giro, um giro só de revisões com o que sobrou de cada tema. Assim nenhum tema se esgota no
// primeiro mês e todos continuam aparecendo até o fim das questões novas.
// O andamento conta questões novas do tema feitas em qualquer lugar (blocos, treinos, simulados); não existe atraso.
const ORDEM_TEMAS = {   // por matéria, numa ordem de estudo (base → aplicação); as matérias da área se intercalam
  LC: [['POR.int', 'POR.gen', 'POR.fun', 'POR.var', 'POR.gra', 'POR.fig', 'POR.arg', 'POR.tec'], ['LIT.pro', 'LIT.poe', 'LIT.esc'],
    ['ART.vis', 'ART.mus', 'ART.cen', 'ART.pat'], ['EDF.cor'], ['LE.ing', 'LE.esp']],
  CH: [['HIS.ant', 'HIS.mod', 'HIS.col', 'HIS.con', 'HIS.imp', 'HIS.rep', 'HIS.afr'], ['GEO.car', 'GEO.nat', 'GEO.cli', 'GEO.agr', 'GEO.urb', 'GEO.eco', 'GEO.glo'],
    ['FIL.ant', 'FIL.mod', 'FIL.con', 'FIL.eti'], ['SOC.teo', 'SOC.cul', 'SOC.tra', 'SOC.cid']],
  CN: [['BIO.cel', 'BIO.gen', 'BIO.evo', 'BIO.fis', 'BIO.sau', 'BIO.ser', 'BIO.eco', 'BIO.tec'], ['QUI.ger', 'QUI.est', 'QUI.fqu', 'QUI.ele', 'QUI.org', 'QUI.amb'],
    ['FIS.mec', 'FIS.ene', 'FIS.hid', 'FIS.ter', 'FIS.opt', 'FIS.ond', 'FIS.ele', 'FIS.mod']],
  MT: [['ARI.ope', 'ARI.raz', 'ARI.por', 'ARI.med'], ['ALG.equ', 'ALG.fun', 'ALG.exp', 'ALG.seq'], ['GEM.pla', 'GEM.esp', 'GEM.tri', 'GEM.ana', 'GEM.vis'],
    ['EST.est', 'EST.gra', 'EST.pro', 'EST.com']],
};
const TRILHA = {
  foco: 0.5,      // fração das novas que faltam do tema usada na etapa de foco
  revisao: 0.5,   // idem nas revisões do 1º giro (nos giros só de revisão: tudo o que sobrou)
  cada: 3,        // uma etapa de revisão depois de cada 3 temas
  reserva: 0.3,   // parte de cada tema que as questões "de tema passado" não tocam
  min: 3,         // menor etapa (em questões)
  padrao: [1, 1, 0],   // 1 = foco, 0 = tema passado
};
function trilhaLigada() { return st.cfg.trilha !== false && st.cfg.ordem !== 'prova' && Object.keys(TEMAS.q).length > 0; }
// por tema: questões válidas, novas já feitas e a data da última resposta
function contagemTemas() {
  const total = {}, feitas = {}, ult = {};
  for (const q of POOL()) {
    const c = temaDe(q.id);
    if (!c) continue;
    total[c] = (total[c] || 0) + 1;
    const h = reg(q.id)?.h;
    if (!h?.length) continue;
    feitas[c] = (feitas[c] || 0) + 1;
    const d = h[h.length - 1][0];
    if (!ult[c] || d > ult[c]) ult[c] = d;
  }
  return { total, feitas, ult, resta: c => (total[c] || 0) - (feitas[c] || 0) };
}
// temas da área na ordem da trilha: cada matéria na sua ordem, as matérias espalhadas por igual ao longo do giro
function temasTrilha(a, ct) {
  const out = [];
  ORDEM_TEMAS[a].forEach((l, m) => { const v = l.filter(c => ct.total[c] > 0); v.forEach((c, i) => out.push({ c, p: (i + 0.5) / v.length, m })); });
  return out.sort((x, y) => x.p - y.p || x.m - y.m).map(x => x.c);
}
const seqCache = {};
function etapasTrilha(a, ct = contagemTemas()) {
  const chave = `${a}|${st.cfg.lingua}`;
  if (seqCache[chave]) return seqCache[chave];
  const temas = temasTrilha(a, ct), seq = [], revistos = new Set();
  temas.forEach((c, i) => {
    seq.push({ c, tipo: 'foco', giro: 1 });
    if ((i + 1) % TRILHA.cada) return;
    const r = temas.slice(0, i).find(x => !revistos.has(x));   // o tema mais antigo ainda não revisto
    if (r) { revistos.add(r); seq.push({ c: r, tipo: 'revisao', giro: 1 }); }
  });
  for (let g = 2; g <= 4; g++) temas.forEach(c => seq.push({ c, tipo: 'revisao', giro: g }));
  return (seqCache[chave] = seq);
}
// a etapa atual da área (avança sozinha quando a cota é cumprida ou o tema acaba); null = trilha concluída
function etapaAtual(a, ct = contagemTemas(), pular = false) {
  const seq = etapasTrilha(a, ct);
  const t = (st.trilha ||= {});
  let e = t[a], mudou = false;
  if (e && !e.fim && seq[e.k]?.c !== e.c) {   // a sequência mudou (outra língua estrangeira): acha a mesma etapa
    const k = seq.findIndex(s => s.c === e.c && s.tipo === e.tipo && s.giro === e.giro);
    e = k >= 0 ? { ...e, k } : null;
    mudou = true;
  }
  const comecar = k => {
    for (; k < seq.length; k++) {
      const s = seq[k], resta = ct.resta(s.c);
      if (resta <= 0) continue;
      const fr = s.tipo === 'foco' ? TRILHA.foco : TRILHA.revisao;
      const quota = s.giro > 1 ? resta : Math.min(resta, Math.max(TRILHA.min, Math.ceil(resta * fr)));
      return { k, c: s.c, tipo: s.tipo, giro: s.giro, base: ct.feitas[s.c] || 0, quota, ini: hoje() };
    }
    return { k: seq.length, fim: true };
  };
  if (!e) { e = comecar(0); mudou = true; }
  if (pular && !e.fim) { e = comecar(e.k + 1); mudou = true; }
  while (!e.fim && ((ct.feitas[e.c] || 0) - e.base >= e.quota || ct.resta(e.c) <= 0)) { e = comecar(e.k + 1); mudou = true; }
  if (mudou) { t[a] = e; salvar(); }
  if (e.fim) return null;
  const feitas = Math.max(0, Math.min(e.quota, (ct.feitas[e.c] || 0) - e.base));
  return { ...e, feitas, falta: e.quota - feitas, prox: seq.slice(e.k + 1).find(s => ct.resta(s.c) > 0) || null };
}
// marca de cada questão nova na última fila montada: 'foco' (tema da etapa) ou 'passada' (tema que já passou)
let marcaTrilha = {};
// ordena as novas de uma área seguindo a trilha: foco, foco, tema passado, foco, foco, …
function ordemTrilha(a, lista, ct) {
  const e = etapaAtual(a, ct);
  if (!e) return lista;
  const seq = etapasTrilha(a, ct);
  const passados = new Set(seq.slice(0, e.k).map(s => s.c));
  passados.delete(e.c);
  const porTema = {};
  for (const q of lista) (porTema[temaDe(q.id)] ||= []).push(q);
  const resta = {};
  for (const c in porTema) resta[c] = porTema[c].length;
  const ult = { ...ct.ult };
  let relogio = 0;
  const usado = new Set(), out = [];
  const tira = (q, marca) => { usado.add(q.id); out.push(q); resta[temaDe(q.id)]--; if (marca) marcaTrilha[q.id] = marca; };
  const doFoco = () => porTema[e.c]?.find(q => !usado.has(q.id));
  const dePassado = () => {
    const cs = [...passados].filter(c => (resta[c] || 0) > Math.ceil((ct.total[c] || 0) * TRILHA.reserva));
    if (!cs.length) return null;
    cs.sort((x, y) => (ult[x] || '').localeCompare(ult[y] || ''));   // o visto há mais tempo primeiro
    ult[cs[0]] = `~${String(relogio++).padStart(5, '0')}`;            // e vai para o fim da vez
    return porTema[cs[0]].find(q => !usado.has(q.id));
  };
  const qualquer = () => lista.find(q => !usado.has(q.id) && temaDe(q.id) !== e.c);
  for (let j = 0; out.length < lista.length; j++) {
    const querFoco = TRILHA.padrao[j % TRILHA.padrao.length];
    let q = querFoco ? doFoco() : dePassado(), marca = q ? (querFoco ? 'foco' : 'passada') : null;
    if (!q) { q = querFoco ? dePassado() || qualquer() : qualquer() || doFoco(); marca = q && temaDe(q.id) === e.c ? 'foco' : q && passados.has(temaDe(q.id)) ? 'passada' : null; }
    if (!q) q = lista.find(x => !usado.has(x.id));
    tira(q, marca);
  }
  return out;
}
// temas em etapa de revisão agora (as revisões adiantadas deles vêm primeiro)
function temasEmRevisao() {
  if (!trilhaLigada()) return new Set();
  const ct = contagemTemas();
  return new Set(ORDEM_AREAS.map(a => etapaAtual(a, ct)).filter(e => e?.tipo === 'revisao').map(e => e.c));
}

// ---------------------------------------------------------------- videoaulas
// Cada tema tem de 1 a 5 videoaulas do YouTube (data/aulas.js, links diretos), e a matemática básica tem as suas
// (frações, potências, regra de três…). O cronograma põe a aula do dia ANTES das questões novas, sempre de um tema
// cujas questões vêm a seguir — a aula prepara para as questões. Ordem da fila:
//   1. temas que você pediu (📌 na aba Aulas), na ordem em que pediu;
//   2. as aulas dos temas em foco na trilha — primeiro a 1ª aula de cada tema que acabou de entrar em foco, para ela vir
//      antes de as questões dele se acumularem —, alternando uma a uma com a matemática básica;
//   3. as aulas do próximo tema de cada área (adianta o que vem depois).
// Sem trilha (ou na reta final): matemática básica e os temas em que você mais erra.
const AULAS = window.AULAS || { base: [], temas: {} };
const AULA_INFO = {};   // id do vídeo -> { id, t, canal, min, c (tema ou grupo da matemática básica) }
for (const b of AULAS.base) for (const [id, t, canal, min] of b.v) AULA_INFO[id] = { id, t, canal, min, c: b.c };
for (const [c, l] of Object.entries(AULAS.temas)) for (const [id, t, canal, min] of l) AULA_INFO[id] ||= { id, t, canal, min, c };
const BASE_NOME = Object.fromEntries(AULAS.base.map(b => [b.c, b.nome]));
function aulasDoTema(c) { return (BASE_NOME[c] ? AULAS.base.find(b => b.c === c).v : AULAS.temas[c] || []).map(v => AULA_INFO[v[0]]); }
function rotuloAula(c) { return BASE_NOME[c] ? `Matemática básica › ${BASE_NOME[c]}` : rotuloTema(c); }
function urlAula(id) { return `https://www.youtube.com/watch?v=${id}`; }
function aulaVista(id) { return !!st.aulas?.[id]; }
function aulasPorDia() { return st.cfg.aulasDia ?? 1; }
function vistasHoje() { const h = hoje(); return Object.values(st.aulas || {}).filter(x => x.d === h && !x.p).length; }
// a fila das próximas aulas, cada uma com o motivo (por que ela vem agora)
function filaAulas() {
  const out = [], usado = new Set();
  const poe = (v, motivo) => { if (v && !usado.has(v.id) && !aulaVista(v.id)) { usado.add(v.id); out.push({ ...v, motivo }); } };
  for (const c of st.aulaFila || []) for (const v of aulasDoTema(c)) poe(v, '📌 você pediu');
  const base = AULAS.base.flatMap(b => b.v.map(v => AULA_INFO[v[0]]));
  const ct = contagemTemas();
  const areas = st.cfg.areas.length ? st.cfg.areas : ORDEM_AREAS;
  const etapas = trilhaLigada() && !plano().retaFinal ? areas.map(a => etapaAtual(a, ct)).filter(Boolean) : [];
  if (!etapas.length) {
    for (const v of base) poe(v, 'base de Matemática');
    const an = analisePontos();
    for (const x of an.pronto ? an.fracos : []) for (const v of aulasDoTema(x.c)) poe(v, 'tema em que você mais erra');
    return out;
  }
  // 2–3. aulas dos temas em foco — primeiro a 1ª aula dos temas que acabaram de entrar em foco (o que já tem mais
  // questões feitas antes), depois o resto — alternando uma a uma com a matemática básica
  const novos = etapas.filter(e => !aulasDoTema(e.c).some(v => aulaVista(v.id))).sort((x, y) => y.feitas - x.feitas);
  const focoResto = [...novos.map(e => aulasDoTema(e.c)[0]).filter(Boolean), ...etapas.flatMap(e => aulasDoTema(e.c))]
    .map(v => ({ v, m: 'tema em foco agora' }));
  const baseResto = base.map(v => ({ v, m: 'base de Matemática' }));
  let vezBase = st.aulaUlt !== 'base';
  while (focoResto.some(x => !usado.has(x.v.id) && !aulaVista(x.v.id)) || baseResto.some(x => !usado.has(x.v.id) && !aulaVista(x.v.id))) {
    const l = vezBase ? baseResto : focoResto, x = l.find(y => !usado.has(y.v.id) && !aulaVista(y.v.id)) || (vezBase ? focoResto : baseResto).find(y => !usado.has(y.v.id) && !aulaVista(y.v.id));
    poe(x.v, x.m);
    vezBase = !vezBase;
  }
  // 4. adianta o próximo tema de cada área
  for (const e of etapas) if (e.prox) for (const v of aulasDoTema(e.prox.c)) poe(v, 'próximo tema da trilha');
  return out;
}
function areaDoTema(c) { return TEMAS.nomes[c]?.[0]; }
// a aula da vez: fica a mesma o dia todo até você assistir ou pular (a fila pode mudar com as questões do dia)
function aulaDaVez() {
  const h = hoje(), d = st.aulaDia;
  if (d?.d === h && d.id && AULA_INFO[d.id] && !aulaVista(d.id)) {
    const f = filaAulas().find(x => x.id === d.id);
    return f || { ...AULA_INFO[d.id], motivo: d.m || '' };
  }
  const v = filaAulas()[0] || null;
  if (d?.d !== h || d.id !== v?.id) { st.aulaDia = { d: h, id: v?.id || null, m: v?.motivo || '' }; salvar(); }
  return v;
}
function marcarAula(id, pulou) {
  (st.aulas ||= {})[id] = pulou ? { d: hoje(), p: 1 } : { d: hoje() };
  st.aulaUlt = BASE_NOME[AULA_INFO[id]?.c] ? 'base' : 'tema';
  st.aulaFila = (st.aulaFila || []).filter(c => aulasDoTema(c).some(v => !aulaVista(v.id)));   // tema pedido e já visto sai da fila
  salvar();
}
// botão "aula do tema" na correção da questão: abre direto a próxima aula não vista do tema (ou a primeira)
function botaoAulaTema(q) {
  const c = temaDe(q.id), l = c ? aulasDoTema(c) : [];
  if (!l.length) return '';
  const v = l.find(x => !aulaVista(x.id)) || l[0];
  return `<a class="btn" href="${urlAula(v.id)}" target="_blank" rel="noopener" data-tocar="${v.id}" title="${esc(v.t)} · ${esc(v.canal)} · ${v.min} min">📺 Aula: ${esc(nomeTema(c))}</a>`;
}

// ---- player do YouTube dentro do site: qualquer link com data-tocar="id" abre o vídeo ali mesmo, embaixo de onde foi
// clicado (no cronograma, o cartão da aula ocupa a largura toda). Um player por vez. A posição fica guardada neste
// aparelho (volta de onde parou) e a aula é marcada como vista sozinha quando você passa de 90% do vídeo.
const KEY_AULA_POS = 'enem.aulaPos';
let ytApi = null, playerAtual = null, playerSeq = 0;
function carregarYT() {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  return (ytApi ||= new Promise((ok, erro) => {
    const antes = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => { antes?.(); ok(window.YT); };
    const s = document.createElement('script');
    s.src = 'https://www.youtube.com/iframe_api';
    s.onerror = () => { ytApi = null; erro(new Error('sem a API do YouTube')); };
    document.head.appendChild(s);
    setTimeout(() => { if (!window.YT?.Player) { ytApi = null; erro(new Error('a API do YouTube demorou')); } }, 15000);
  }));
}
function posAula(id, seg) {
  let p = {};
  try { p = JSON.parse(localStorage.getItem(KEY_AULA_POS)) || {}; } catch { /* sem posição */ }
  if (seg === undefined) return p[id] || 0;
  p[id] = Math.floor(seg);
  const ks = Object.keys(p);
  if (ks.length > 60) delete p[ks[0]];   // guarda só as mais recentes
  try { localStorage.setItem(KEY_AULA_POS, JSON.stringify(p)); } catch { /* cheio: tudo bem */ }
}
function fecharPlayer() {
  if (!playerAtual) return;
  const { yt, el, timer, host, id } = playerAtual;
  clearInterval(timer);
  try { const t = yt?.getCurrentTime?.(); if (t > 5) posAula(id, t); } catch { /* player já foi */ }
  try { yt?.destroy?.(); } catch { /* idem */ }
  el.remove();
  host?.classList.remove('tocando');
  playerAtual = null;
}
// onde o player entra: no cartão da agenda (por dentro), numa lista (logo depois do item) ou no fim do card
function lugarDoPlayer(btn) {
  const ag = btn.closest('.ag-item');
  if (ag) return { host: ag, por: el => ag.appendChild(el) };
  const li = btn.closest('li');
  if (li) return { host: null, por: el => { const x = document.createElement('li'); x.className = 'player-li'; x.appendChild(el); li.after(x); return x; } };
  const card = btn.closest('.card, section') || $app;
  return { host: null, por: el => card.appendChild(el) };
}
function tocarAula(id, btn) {
  const v = AULA_INFO[id];
  if (!v) return false;
  const jaAqui = playerAtual?.id === id;
  fecharPlayer();
  if (jaAqui) return true;   // clicar de novo no mesmo vídeo fecha o player
  const el = document.createElement('div');
  el.className = 'player-aula';
  const alvo = `yt-${++playerSeq}`;
  el.innerHTML = `<div class="player-topo"><div class="cresce"><b>${esc(v.t)}</b><span class="small muted">${esc(rotuloAula(v.c))} · ${esc(v.canal)} · ${v.min} min</span></div>
      <button class="btn fantasma mini" type="button" data-player="fechar" title="Fechar o vídeo">✕</button></div>
    <div class="player-video"><div id="${alvo}"></div></div>
    <div class="player-acoes"><button class="btn mini" type="button" data-player="vi">${aulaVista(id) ? '✓ Vista' : '✓ Já assisti'}</button>
      <a class="btn fantasma mini" href="${urlAula(id)}" target="_blank" rel="noopener">Abrir no YouTube</a>
      <span class="small muted" data-player="status">${aulaVista(id) ? '' : 'marca como vista sozinha quando você passar de 90% do vídeo'}</span></div>`;
  const { host, por } = lugarDoPlayer(btn);
  const caixa = por(el) || el;
  host?.classList.add('tocando');
  const status = t => { const s = el.querySelector('[data-player="status"]'); if (s) s.textContent = t; };
  const vista = auto => {
    if (!aulaVista(id)) marcarAula(id, false);
    el.querySelector('[data-player="vi"]').textContent = '✓ Vista';
    status(auto ? 'marcada como vista' : '');
  };
  playerAtual = { id, el: caixa, host, yt: null, timer: 0 };
  const eu = playerAtual;
  el.querySelector('[data-player="fechar"]').addEventListener('click', () => { const re = aulaVista(id) && host; fecharPlayer(); if (re) rota(); });
  el.querySelector('[data-player="vi"]').addEventListener('click', () => vista(false));
  const inicio = posAula(id);
  const comIframe = () => {   // sem a API (bloqueada ou offline): o vídeo toca do mesmo jeito, só não marca sozinho
    const f = document.createElement('iframe');
    f.src = `https://www.youtube-nocookie.com/embed/${id}?rel=0&autoplay=1${inicio > 10 ? `&start=${inicio}` : ''}`;
    f.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share';
    f.referrerPolicy = 'strict-origin-when-cross-origin';
    f.allowFullscreen = true;
    f.title = v.t;
    document.getElementById(alvo)?.replaceWith(f);
    status('');
  };
  carregarYT().then(YT => {
    if (playerAtual !== eu || !document.getElementById(alvo)) return;
    eu.yt = new YT.Player(alvo, {
      videoId: id, host: 'https://www.youtube-nocookie.com',
      playerVars: { rel: 0, autoplay: 1, playsinline: 1, start: inicio > 10 ? inicio : 0 },
      events: {
        onStateChange: e => {
          if (e.data === YT.PlayerState.ENDED) { posAula(id, 0); vista(true); }
        },
        onError: () => status('O YouTube não deixou tocar aqui — use “Abrir no YouTube”.'),
      },
    });
    eu.timer = setInterval(() => {
      if (!document.contains(eu.el)) { if (playerAtual === eu) fecharPlayer(); else clearInterval(eu.timer); return; }   // a tela foi redesenhada (ex.: próxima questão)
      try {
        const t = eu.yt.getCurrentTime(), d = eu.yt.getDuration();
        if (t > 5) posAula(id, d && t > d - 20 ? 0 : t);
        if (d > 0 && t / d >= 0.9 && !aulaVista(id)) vista(true);
      } catch { /* ainda carregando */ }
    }, 5000);
  }).catch(comIframe);
  caixa.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  return true;
}
document.addEventListener('click', e => {
  const b = e.target.closest('[data-tocar]');
  if (!b || e.ctrlKey || e.metaKey || e.shiftKey || e.button) return;   // ctrl+clique etc.: abre no YouTube, como link normal
  if (tocarAula(b.dataset.tocar, b)) e.preventDefault();
});

// ---------------------------------------------------------------- cronograma
// Ritmo de cada dia da semana: peso 0 = folga, 1 = dia normal. A meta de um dia é proporcional ao peso dele.
const NIVEIS = [[0, 'Folga'], [0.5, 'Leve'], [1, 'Normal'], [1.5, 'Puxado'], [2, 'Forte']];
function nomeNivel(p) { return (NIVEIS.find(n => n[0] === p) || [0, `${p}×`])[1]; }
function pesos() {
  const p = st.cfg.pesos;
  if (Array.isArray(p) && p.length === 7) return p;
  return [0, 1, 2, 3, 4, 5, 6].map(k => (st.cfg.dias.includes(k) ? 1 : 0));
}
function plano() {
  const h = hoje();
  const pool = POOL();
  const feitas = pool.filter(q => feita(q.id)).length;
  const restantes = pool.length - feitas;
  const fimNovas = somaDias(st.cfg.prova, -st.cfg.folgaFinal);
  const novasHoje = st.log[h]?.n || 0;
  const P = pesos();
  // ritmo das últimas 2 semanas (novas por dia corrido) e quando você termina nesse ritmo
  let n14 = 0;
  let ativos = 0;
  for (let k = 0; k < 14; k++) {
    const n = st.log[somaDias(h, -k)]?.n || 0;
    n14 += n;
    if (n) ativos++;
  }
  const ritmo = n14 / 14; // novas por dia corrido
  const previsao = ritmo > 0 && ativos >= 3 ? somaDias(h, Math.ceil(restantes / ritmo)) : null;
  // dias de redação tiram (dia cheio) ou dividem (dia híbrido) a meta de questões daquele dia
  const rdc = planoRedacao(h, fimNovas, P, previsao, ativos);
  const sims = planoSimulados(h, fimNovas, P, rdc);
  const pesoDe = d => P[diaSemana(d)] * rdc.fator(d) * sims.fator(d);
  const somaPesos = de => { let s = 0; for (let d = de; d <= fimNovas; d = somaDias(d, 1)) s += pesoDe(d); return s; };
  let diasEstudo = 0;
  for (let d = h; d <= fimNovas; d = somaDias(d, 1)) if (P[diaSemana(d)] > 0) diasEstudo++;
  const pesoHoje = pesoDe(h);
  const hojeEstuda = P[diaSemana(h)] > 0;
  // meta calculada como se o dia estivesse começando agora (não muda conforme você avança no dia)
  const sp = somaPesos(h);
  const unidade = sp > 0 ? (restantes + novasHoje) / sp : restantes + novasHoje;   // novas num dia "normal"
  const meta = Math.ceil(unidade * (hojeEstuda ? pesoHoje : 1));
  // meta de um dia futuro, se hoje você fizer `extra` novas além das que já fez
  const amanha = somaDias(h, 1);
  const spAmanha = somaPesos(amanha);
  const metaFutura = (d, extra = 0) => (d > fimNovas || !pesoDe(d) || spAmanha <= 0 ? 0
    : Math.ceil(Math.max(0, restantes - Math.max(0, meta - novasHoje) * (hojeEstuda ? 1 : 0) - extra) / spAmanha * pesoDe(d)));
  let proxEstudo = null;
  for (let k = 1; k <= 7; k++) { const d = somaDias(h, k); if (P[diaSemana(d)] > 0 && d <= fimNovas) { proxEstudo = d; break; } }
  const retaFinal = h > fimNovas;
  return {
    total: pool.length, feitas, restantes, fimNovas, diasEstudo, hojeEstuda,
    meta: hojeEstuda && !retaFinal ? meta : 0,
    ritmoMeta: retaFinal ? 0 : Math.ceil(unidade), unidade: retaFinal ? 0 : unidade,
    novasHoje, ritmo, previsao, retaFinal, pesos: P, metaFutura, proxEstudo,
    diasProva: diffDias(h, st.cfg.prova),
    vencidas: vencidas().length,
    redacao: rdc,
    simulados: sims,
  };
}

// Quando você termina, contando que os erros voltam para revisão.
// Cada erro precisa de 4 acertos seguidos nas revisões (caixas 1→4) para sair do caderno. Com taxa de
// acerto s nas revisões, o número esperado de tentativas até 4 acertos seguidos é (1 − s⁴) ÷ ((1 − s)·s⁴).
function previsaoTermino(p = plano()) {
  const h = hoje();
  let n = 0, ok = 0, rn = 0, rok = 0, emRev = 0;
  for (const q of POOL()) {
    const r = reg(q.id);
    if (!r?.h?.length) continue;
    n++; if (r.h[0][2] === 1 && !r.h[0][4]) ok++;
    for (const t of r.h.slice(1)) { rn++; if (t[2] === 1 && !t[4]) rok++; }
    if (r.s === 'rev') emRev++;
  }
  const temAcerto = n >= 10;
  const acerto = temAcerto ? ok / n : 0.6;
  const s = Math.min(0.95, Math.max(0.5, rn >= 10 ? rok / rn : 0.75));
  const tentativas = (1 - s ** 4) / ((1 - s) * s ** 4);
  const errosPrevistos = Math.round(p.restantes * (1 - acerto));
  const revisoes = Math.round(errosPrevistos * tentativas + emRev * tentativas * 0.6);
  // ritmo total (novas + revisões) dos últimos 14 dias corridos
  let tot = 0, novas = 0, ativos = 0;
  for (let k = 0; k < 14; k++) {
    const lg = st.log[somaDias(h, -k)];
    if (!lg) continue;
    tot += lg.n + lg.r; novas += lg.n;
    if (lg.n + lg.r) ativos++;
  }
  const real = ativos >= 3;
  // sem histórico, usa o plano: a meta de um dia normal × peso médio por dia corrido
  const pesoDia = p.pesos.reduce((a, b) => a + b, 0) / 7;
  const ritmoNovas = real ? novas / 14 : p.ritmoMeta * pesoDia;
  const ritmoTotal = real ? tot / 14 : ritmoNovas * (1 + (1 - acerto) * tentativas);
  const fimNovas = ritmoNovas > 0 ? somaDias(h, Math.ceil(p.restantes / ritmoNovas)) : null;
  let fimTudo = ritmoTotal > 0 ? somaDias(h, Math.ceil((p.restantes + revisoes) / ritmoTotal)) : null;
  // um erro feito no último dia ainda precisa de 1 + 3 + 7 + 21 dias de revisões
  if (fimTudo && fimNovas && fimTudo < somaDias(fimNovas, 32)) fimTudo = somaDias(fimNovas, 32);
  return { acerto, temAcerto, s, tentativas, errosPrevistos, revisoes, ritmoTotal, ritmoNovas, real, fimNovas, fimTudo, emRev };
}
function mesAno(d) { return parse(d).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' }); }
function dataCurta(d) { return d ? (d.slice(0, 4) === hoje().slice(0, 4) ? fmtCurto(d) : `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(2, 4)}`) : '—'; }

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
  'Precisei de ajuda': 'Refaça sozinho as questões em que pediu ajuda quando elas voltarem na revisão: elas já estão no caderno de erros.',
};

// ---------------------------------------------------------------- sessão
function embaralhar(l) {
  for (let i = l.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [l[i], l[j]] = [l[j], l[i]]; }
  return l;
}
// ---------------------------------------------------------------- blocos
// Cada bloco tem UM tipo, e cada tipo guarda o seu próprio andamento (dá para pausar um e começar outro):
//   novas → só questões nunca feitas (o "Questões novas" do cronograma)
//   rev   → só revisões do caderno de erros: as vencidas; sem vencidas, adianta as próximas
//   reforco → uma questão nova do mesmo tema para cada erro recente (ver reforcosPendentes)
//   misto → novas + revisões vencidas (o bloco livre da aba Questões)
//   tema / area → treino de um tema ou de uma área (revisões dele + novas dele)
// Antes de mostrar cada questão o bloco é conferido (podar): sai a questão nova que já foi respondida em outro
// lugar e a revisão que já foi feita hoje ou que saiu do caderno. Nada se repete, nem num bloco guardado há dias.
const NOME_BLOCO = { novas: 'questões novas', extras: 'extras', rev: 'revisões', reforco: 'reforço', misto: 'bloco', tema: 'treino de tema', area: 'treino de área' };
// itens candidatos de cada tipo (só monta; não muda o estado)
function montarItens(tipo, tam, alvo) {
  const revItem = q => ({ id: q.id, tipo: 'rev', ...(reg(q.id).prox > hoje() ? { adiantada: true } : {}) });
  const novaItem = (q, foco) => (foco ? { id: q.id, tipo: 'nova', foco } : { id: q.id, tipo: 'nova' });
  const daTrilha = q => (marcaTrilha[q.id] ? { ...novaItem(q), tr: marcaTrilha[q.id] } : novaItem(q));
  const intercalar = (R, N) => { const out = []; while (R.length || N.length) { if (N.length) out.push(N.shift()); if (R.length) out.push(R.shift()); } return out; };
  const venc = vencidas();
  if (tipo === 'rev') {
    if (venc.length) return venc.slice(0, tam).map(revItem);
    // sem vencidas: adianta primeiro as dos temas que estão em etapa de revisão na trilha
    const emRev = temasEmRevisao();
    const ad = adiantaveis();
    return ad.filter(q => emRev.has(temaDe(q.id))).concat(ad.filter(q => !emRev.has(temaDe(q.id)))).slice(0, tam).map(revItem);
  }
  if (tipo === 'reforco') return reforcosPendentes().slice(0, tam).map(({ e, q }) => ({ id: q.id, tipo: 'nova', ref: e.id }));
  if (tipo === 'tema' || tipo === 'area') {
    const doAlvo = q => (tipo === 'tema' ? noAlvo(temaDe(q.id), alvo) : q.area === alvo);
    let revs = venc.filter(doAlvo).slice(0, Math.floor(tam / 2));
    const novas = (tipo === 'tema' ? POOL().filter(q => !feita(q.id)).sort((x, y) => y.ano - x.ano || x.num - y.num) : filaNovas())
      .filter(doAlvo).slice(0, tam - revs.length);
    if (revs.length + novas.length < tam) {
      const ja = new Set(revs.map(q => q.id));
      revs = revs.concat(adiantaveis().filter(q => doAlvo(q) && !ja.has(q.id)).slice(0, tam - revs.length - novas.length));
    }
    return intercalar(revs.map(revItem), novas.map(q => (tipo === 'tema' ? novaItem(q, alvo) : daTrilha(q))));
  }
  // novas (com reforço: ~1 em cada 3 vem dos temas mais fracos) e misto (metade revisões vencidas)
  const revs = tipo === 'misto' ? venc.slice(0, Math.ceil(tam / 2)) : [];
  const nNovas = tam - revs.length;
  let cands = filaNovas();
  const reforco = [];
  const alvoFoco = st.cfg.foco ? temasFoco() : [];
  if (alvoFoco.length && nNovas >= 2) {
    // com a trilha de focos, os pontos fracos pegam menos vagas (~1 em 6) para o tema em foco continuar sendo a maioria
    for (let k = 0; k < Math.max(1, Math.round(nNovas / (trilhaLigada() ? 6 : 3))); k++) {
      const c = alvoFoco[k % alvoFoco.length].c;
      const q = cands.find(x => noAlvo(temaDe(x.id), c) && !reforco.some(r => r.q === x));
      if (q) reforco.push({ q, c });
    }
    cands = cands.filter(x => !reforco.some(r => r.q === x));
  }
  const novas = cands.slice(0, nNovas - reforco.length).map(daTrilha);
  reforco.forEach((r, k) => novas.splice(Math.min(novas.length, 1 + k * 3), 0, novaItem(r.q, r.c)));
  return intercalar(revs.map(revItem), novas);
}
// o item ainda vale? (só para os que ainda não foram respondidos neste bloco)
function itemValido(it) {
  const r = reg(it.id);
  if (!BYID[it.id]) return false;
  if (it.tipo === 'nova') return !feita(it.id) && (!it.ref || !!st.reforco?.some(e => e.id === it.ref));
  if (it.tipo === 'rev') return r?.s === 'rev' && !respondidaHoje(it.id) && (r.prox <= hoje() || (it.adiantada && adiantavel(it.id)));
  return true;
}
// quantas questões novas ainda faltam para a meta de hoje
function faltaMeta() { const p = plano(); return p.retaFinal ? 0 : Math.max(0, p.meta - p.novasHoje); }
// tira do bloco (da posição atual em diante) o que deixou de valer e as repetições. O bloco de novas da meta
// (sem "extra") também encolhe para o que falta da meta: acabou a meta, acabou o bloco — extras são outro bloco.
function podar(sess) {
  if (!sess || sess.avulsa) return sess;
  const vistos = new Set(sess.itens.slice(0, sess.i).map(it => it.id));
  const itens = sess.itens.slice(0, sess.i), res = sess.res.slice(0, sess.i);
  let vagas = tipoDe(sess) === 'novas' && !sess.extra ? faltaMeta() : Infinity;
  for (let k = sess.i; k < sess.itens.length; k++) {
    const it = sess.itens[k], feitoAqui = !!sess.res[k];
    if (feitoAqui) { itens.push(it); res.push(sess.res[k]); vistos.add(it.id); continue; }
    if (vagas > 0 && itemValido(it) && !vistos.has(it.id)) { itens.push(it); res.push(undefined); vistos.add(it.id); vagas--; }
  }
  sess.itens = itens; sess.res = res;
  return sess;
}
function aberta(sess) { return !!sess && !sess.avulsa && sess.i < sess.itens.length; }
// blocos salvos antes desta versão: "normal" vira misto
function tipoDe(sess) { return sess?.tipo || (sess?.origem === 'rev' || sess?.itens?.every(it => it.tipo === 'rev') ? 'rev' : 'misto'); }
// chave em que o bloco fica guardado: os extras de novas não ocupam o lugar do bloco da meta
function chaveDe(sess) { return tipoDe(sess) === 'novas' && sess.extra ? 'extras' : tipoDe(sess); }
// o bloco em andamento de um tipo (o ativo ou o guardado), já conferido
function sessaoDe(chave) {
  for (const sess of [st.sessao, st.pausadas?.[chave], chave === 'misto' ? st.pausadas?.normal : null]) {
    if (sess && !sess.avulsa && chaveDe(sess) === chave) { podar(sess); if (aberta(sess)) return sess; }
  }
  return null;
}
// blocos guardados (de qualquer tipo), para a aba Questões oferecer "Continuar"
function blocosAbertos() {
  return ['novas', 'extras', 'rev', 'reforco', 'misto', 'tema', 'area'].map(t => sessaoDe(t)).filter(Boolean);
}
function pausarAtiva() {
  const sess = st.sessao;
  if (aberta(sess)) (st.pausadas ||= {})[chaveDe(sess)] = sess;
}
function irEstudar() { if (location.hash === '#/estudar') rota(); else location.hash = '#/estudar'; }
function retomar(chave) {
  const sess = sessaoDe(chave);
  if (!sess) return;
  if (sess !== st.sessao) { pausarAtiva(); st.sessao = sess; }
  if (st.pausadas) { delete st.pausadas[chave]; if (chave === 'misto') delete st.pausadas.normal; }
  salvar();
  irEstudar();
}
// começa um bloco novo do tipo pedido (substitui o guardado do mesmo tipo)
function iniciar(tam, tipo = 'misto', alvo = null, opcoes = {}) {
  const de = location.hash === '#/estudar' ? st.sessao?.de || '#/' : location.hash || '#/';
  const itens = montarItens(tipo, tam, alvo);
  if (!itens.length) {
    alert(tipo === 'rev' ? 'Nenhuma revisão para fazer agora (as que você errou há pouco tempo ainda estão esperando, para você esquecer a resposta).'
      : tipo === 'reforco' ? 'Nenhum reforço em aberto agora.'
      : tipo === 'tema' ? 'Não há questões desse tema para agora.'
      : tipo === 'area' ? 'Não há questões dessa área para agora.'
      : 'Não há questões disponíveis com os filtros atuais. Confira as áreas em Ajustes.');
    return;
  }
  pausarAtiva();
  const chave = tipo === 'novas' && opcoes.extra ? 'extras' : tipo;
  if (st.pausadas) { delete st.pausadas[chave]; if (chave === 'misto') delete st.pausadas.normal; }
  st.sessao = { tipo, alvo, itens, i: 0, res: [], criada: hoje(), de, ...(opcoes.extra ? { extra: true } : {}) };
  if (tipo === 'novas' && !opcoes.extra) { podar(st.sessao); if (!st.sessao.itens.length) { st.sessao = null; salvar(); alert('A meta de questões novas de hoje já está batida. Use "Fazer extras" para continuar.'); return; } }
  salvar();
  irEstudar();
}
function abrirQuestaoAvulsa(id) {
  const r = reg(id);
  const tipo = r?.s === 'rev' ? 'rev' : (feita(id) ? 'pratica' : 'nova');
  const volta = st.sessao && st.sessao.i < st.sessao.itens.length ? st.sessao : null;
  st.sessao = { itens: [{ id, tipo }], i: 0, res: [], criada: hoje(), volta, avulsa: true };
  salvar();
  location.hash = '#/estudar';
}

// ref: id da questão errada que esta (nova) está reforçando, quando vem do bloco de reforço
function registrar(id, tipo, letra, segundos, ajuda = false, ref = null) {
  const q = BYID[id];
  const ok = letra === q.resp;
  const h = hoje();
  const r = st.q[id] || (st.q[id] = { h: [] });
  r.h.push([h, letra, ok ? 1 : 0, segundos, ajuda ? 2 : 0]);
  delete r.pulou;
  if (!ok || ajuda) delete r.motivo;   // erro novo: o motivo é escolhido de novo (o do erro antigo não vale)
  const lg = st.log[h] || (st.log[h] = { n: 0, r: 0, ok: 0 });
  if (tipo === 'nova') lg.n++; else lg.r++;
  if (ok) lg.ok++;

  if (ajuda) {
    // usou "ver como fazer": mesmo acertando, volta para refazer sozinho
    r.s = 'rev'; r.caixa = 1; r.prox = somaDias(h, intervalo(id, 1));
    if (!r.motivo) r.motivo = 'Precisei de ajuda';
  } else if (tipo === 'nova') {
    if (ok) r.s = 'dom';
    else { r.s = 'rev'; r.caixa = 1; r.prox = somaDias(h, intervalo(id, 1)); }
  } else if (tipo === 'rev') {
    if (ok) {
      r.caixa = (r.caixa || 1) + 1;
      if (r.caixa > CAIXA_MAX) { r.s = 'rec'; delete r.prox; }
      else r.prox = somaDias(h, intervalo(id, r.caixa));
    } else {
      r.caixa = 1; r.prox = somaDias(h, intervalo(id, 1));
    }
  } else if (tipo === 'simrev') {
    // revisão que apareceu num simulado antes da hora: acertar não adianta a caixa; errar volta para a 1
    if (!ok) { r.caixa = 1; r.prox = somaDias(h, intervalo(id, 1)); }
  } else if (tipo === 'pratica' && !ok) {
    // errou uma que já dominava: volta pro ciclo de revisão
    r.s = 'rev'; r.caixa = 1; r.prox = somaDias(h, intervalo(id, 1));
  }
  // reforço: questão nova cumpre um reforço em aberto; erro (fora do bloco de reforço) pede um
  if (tipo === 'nova') cumprirReforco(id, ref);
  if ((!ok || ajuda) && !ref) pedirReforco(id);
  salvar();
  return ok;
}
function marcarChute(id, chute, ref = null) {
  const r = st.q[id];
  if (!r) return;
  const ult = r.h[r.h.length - 1];
  if (chute) {
    ult[4] = 1;
    r._antes = { s: r.s, caixa: r.caixa, prox: r.prox };
    r.s = 'rev'; r.caixa = 1; r.prox = somaDias(hoje(), intervalo(id, 1));
    r.motivo = 'Chutei';
    if (!ref) pedirReforco(id);
  } else if (r._antes) {
    ult[4] = 0;
    tirarReforco(id);
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
  return `<div class="folha">${q.imgs.map((src, k) => `<img src="${src}" alt="Questão ${q.num}${q.imgs.length > 1 ? ` parte ${k + 1}` : ''}" data-w="${(q.w && q.w[k]) || 270}" style="width:${Math.round(((q.w && q.w[k]) || 270) * esc2)}px" ${k ? 'loading="lazy"' : ''}>`).join('')}</div><canvas class="tinta" aria-hidden="true"></canvas>`;
}

// ---------- caneta azul: rabiscar na folha da questão, como na prova de papel
// Dá para rabiscar na questão e na margem em volta. Os traços ficam salvos por questão, em coordenadas
// relativas à imagem da questão (x, y ÷ largura dela): acompanham o A−/A+ e a largura da tela.
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
// Mouse e caneta (stylus) escrevem direto: é só clicar e arrastar na folha. Com o dedo, a folha rola;
// para escrever com o dedo, liga-se o botão ✏️ (só aparece em telas de toque).
// Correção da linha: cada ponto novo é puxado para perto do anterior (estabilizador), pontos muito
// próximos são ignorados e o traço é desenhado com curvas passando pelos pontos médios.
const SUAVIZA = 0.4;   // 0..1: quanto o traço segue o ponteiro na hora (menor = mais suave)
// tentativa: número da tentativa que está na tela (as respostas registradas antes dela). Os rabiscos são de uma
// tentativa só: quando a questão volta para ser respondida de novo, a folha começa limpa. false = mostra os
// últimos rabiscos (tela "Rever").
function ligarTinta(id, tentativa) {
  const folha = $app.querySelector('.folha');
  const area = $app.querySelector('.questao-img');
  const cv = area?.querySelector('canvas.tinta');
  if (!cv || !folha) return;
  // posição da imagem dentro da área de desenho: (ox, oy) e largura w
  let ox = 0, oy = 0, w = 1;
  // medido a partir da própria tela de desenho (não da caixa em volta, que tem borda): o traço sai onde o ponteiro está
  const medir = () => { const a = cv.getBoundingClientRect(), f = folha.getBoundingClientRect(); ox = f.left - a.left; oy = f.top - a.top; w = f.width || 1; };
  const ctx = cv.getContext('2d');
  const salvo = tinta[id];
  // vale só o rascunho desta tentativa e de hoje (bloco largado e retomado outro dia também começa limpo)
  const vale = !!salvo && (tentativa === false || (salvo.d === hoje() && (typeof tentativa !== 'number' || salvo.k === tentativa)));
  const tracos = vale ? salvo.t : [];
  const k = typeof tentativa === 'number' ? tentativa : salvo?.k;
  const bCaneta = $app.querySelector('[data-tinta=caneta]');
  const bDesfazer = $app.querySelector('[data-tinta=desfazer]');
  const bLimpar = $app.querySelector('[data-tinta=limpar]');
  const bBorracha = $app.querySelector('[data-tinta=borracha]');
  let borracha = false;
  const estilo = () => { ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = COR_TINTA; ctx.lineWidth = Math.max(4, w * 0.0065); };
  const X = x => ox + x * w, Y = y => oy + y * w;
  const meio = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  // trecho k do traço (o mesmo desenho ao vivo e ao redesenhar): de meio(k-2,k-1) a meio(k-1,k), curvando em k-1
  const trecho = (t, k) => {
    ctx.beginPath();
    if (k === 0) { ctx.moveTo(X(t[0][0]), Y(t[0][1])); ctx.lineTo(X(t[0][0]) + 0.01, Y(t[0][1])); }
    else if (k === 1) { const m = meio(t[0], t[1]); ctx.moveTo(X(t[0][0]), Y(t[0][1])); ctx.lineTo(X(m[0]), Y(m[1])); }
    else { const a = meio(t[k - 2], t[k - 1]), b = meio(t[k - 1], t[k]); ctx.moveTo(X(a[0]), Y(a[1])); ctx.quadraticCurveTo(X(t[k - 1][0]), Y(t[k - 1][1]), X(b[0]), Y(b[1])); }
    ctx.stroke();
  };
  const final = t => {   // fecha o traço até o último ponto
    if (t.length < 2) return;
    const m = meio(t[t.length - 2], t[t.length - 1]), u = t[t.length - 1];
    ctx.beginPath(); ctx.moveTo(X(m[0]), Y(m[1])); ctx.lineTo(X(u[0]), Y(u[1])); ctx.stroke();
  };
  const traco = t => {
    ctx.beginPath();
    ctx.moveTo(X(t[0][0]), Y(t[0][1]));
    if (t.length === 1) ctx.lineTo(X(t[0][0]) + 0.01, Y(t[0][1]));
    else {
      const m = meio(t[0], t[1]);
      ctx.lineTo(X(m[0]), Y(m[1]));
      for (let k = 1; k < t.length - 1; k++) { const b = meio(t[k], t[k + 1]); ctx.quadraticCurveTo(X(t[k][0]), Y(t[k][1]), X(b[0]), Y(b[1])); }
      ctx.lineTo(X(t[t.length - 1][0]), Y(t[t.length - 1][1]));
    }
    ctx.stroke();
  };
  const desenhar = () => {
    medir();
    const dpr = window.devicePixelRatio || 1;
    cv.width = Math.round(cv.clientWidth * dpr); cv.height = Math.round(cv.clientHeight * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    estilo();
    tracos.forEach(traco);
  };
  // a tela de desenho mudou de tamanho (ex.: a área de rascunho cresce no 1º traço)? redesenha na hora,
  // senão o desenho antigo fica esticado e os traços parecem "descer" até o próximo redesenho
  const conferirTamanho = () => {
    const dpr = window.devicePixelRatio || 1;
    if (cv.width !== Math.round(cv.clientWidth * dpr) || cv.height !== Math.round(cv.clientHeight * dpr)) desenhar();
  };
  const botoes = () => {
    if (!tracos.length) borracha = false;
    $app.classList.toggle('caneta-on', canetaLigada || borracha);
    area.classList.toggle('borracha-on', borracha);
    bCaneta?.classList.toggle('on', canetaLigada);
    bCaneta?.setAttribute('aria-pressed', canetaLigada);
    bBorracha?.classList.toggle('on', borracha);
    bBorracha?.setAttribute('aria-pressed', borracha);
    if (bDesfazer) bDesfazer.hidden = !tracos.length;
    if (bLimpar) bLimpar.hidden = !tracos.length;
    if (bBorracha) bBorracha.hidden = !tracos.length;
    area.classList.toggle('tem-tinta', tracos.length > 0);
    conferirTamanho();
  };
  const guardar = () => { if (tracos.length) tinta[id] = { d: hoje(), t: tracos, ...(k !== undefined ? { k } : {}) }; else delete tinta[id]; salvarTinta(); botoes(); };
  const ro = new ResizeObserver(desenhar);
  ro.observe(folha);
  ro.observe(cv, { box: 'border-box' });   // a tela de desenho em si: pega também o crescimento da área de rascunho
  aoSair(() => ro.disconnect());
  let atual = null, liso = null, apagando = false, apagou = false;
  const pos = e => { const f = folha.getBoundingClientRect(); return [(e.clientX - f.left) / f.width, (e.clientY - f.top) / f.width]; };
  const arred = p => [+p[0].toFixed(4), +p[1].toFixed(4)];
  // borracha: apaga o traço inteiro que passar a menos de ~12px do ponteiro
  const apagarEm = p => {
    const raio = 12 / w;
    let mudou = false;
    for (let i = tracos.length - 1; i >= 0; i--) {
      if (tracos[i].some(q => Math.hypot(q[0] - p[0], q[1] - p[1]) < raio)) { tracos.splice(i, 1); mudou = true; }
    }
    if (mudou) { apagou = true; desenhar(); }
  };
  cv.addEventListener('pointerdown', e => {
    if (e.pointerType === 'touch' && !canetaLigada && !borracha) return;   // dedo: rola a página
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.preventDefault();
    try { cv.setPointerCapture(e.pointerId); } catch { /* sem captura: segue desenhando */ }
    medir(); estilo();
    if (borracha) { apagando = true; apagou = false; apagarEm(pos(e)); return; }
    liso = pos(e);
    atual = [arred(liso)];
    tracos.push(atual);
    trecho(atual, 0);
  });
  cv.addEventListener('pointermove', e => {
    if (apagando) { apagarEm(pos(e)); return; }
    if (!atual) return;
    const agrupados = e.getCoalescedEvents?.();
    for (const ev of (agrupados && agrupados.length ? agrupados : [e])) {
      const p = pos(ev);
      liso = [liso[0] + (p[0] - liso[0]) * SUAVIZA, liso[1] + (p[1] - liso[1]) * SUAVIZA];
      const u = atual[atual.length - 1];
      if (Math.hypot((liso[0] - u[0]) * w, (liso[1] - u[1]) * w) < 2) continue;   // menos de 2px: ignora
      atual.push(arred(liso));
      trecho(atual, atual.length - 1);
    }
  });
  const fim = e => {
    if (apagando) { apagando = false; if (apagou) guardar(); return; }
    if (!atual) return;
    if (e?.type === 'pointerup') {   // termina onde o ponteiro soltou
      const p = arred(pos(e)), u = atual[atual.length - 1];
      if (Math.hypot((p[0] - u[0]) * w, (p[1] - u[1]) * w) >= 2) atual.push(p);
    }
    final(atual);
    atual = null;
    guardar();
  };
  cv.addEventListener('pointerup', fim);
  cv.addEventListener('pointercancel', fim);
  // tablet: caneta (stylus) escreve sem rolar a página; o dedo continua rolando
  cv.addEventListener('touchstart', e => { if ([...e.touches].some(t => t.touchType === 'stylus')) e.preventDefault(); }, { passive: false });
  bCaneta?.addEventListener('click', () => { canetaLigada = !canetaLigada; if (canetaLigada) borracha = false; botoes(); });
  bBorracha?.addEventListener('click', () => { borracha = !borracha; botoes(); });
  const desfazer = () => { tracos.pop(); desenhar(); guardar(); };
  bDesfazer?.addEventListener('click', desfazer);
  bLimpar?.addEventListener('click', () => { tracos.length = 0; desenhar(); guardar(); });
  const teclas = e => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && tracos.length && !e.target.matches?.('input, textarea')) { e.preventDefault(); desfazer(); } };
  document.addEventListener('keydown', teclas);
  aoSair(() => { document.removeEventListener('keydown', teclas); $app.classList.remove('caneta-on'); });
  botoes();
}
function aplicarEscala() {
  document.querySelectorAll('.questao-img img').forEach(im => { im.style.width = Math.round(+im.dataset.w * st.cfg.escala) + 'px'; });
}
function controlesTamanho() {
  return `<span class="tamanho">
    <button class="btn mini" data-tinta="desfazer" title="Desfazer o último traço" hidden>↶</button>
    <button class="btn mini" data-tinta="limpar" title="Apagar os rabiscos" hidden>🗑</button>
    <button class="btn mini borracha" data-tinta="borracha" aria-pressed="false" title="Borracha: passe por cima de um traço para apagá-lo" hidden>🧽 Borracha</button>
    <button class="btn mini caneta" data-tinta="caneta" aria-pressed="false" title="Escrever com o dedo na folha">✏️ Escrever</button>
    <button class="btn mini" data-esc="-1" title="Diminuir">A−</button><button class="btn mini" data-esc="1" title="Aumentar">A+</button></span>`;
}
function ligarTamanho(id, tentativa = true) {
  if (id) ligarTinta(id, tentativa);
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
// ---------------------------------------------------------------- cronograma (tela inicial)
// Fases até a prova: base (questões novas + revisões) → ritmo de prova (últimos 90 dias de questões novas) →
// reta final (só revisão). Em toda semana há um simulado curto, que alterna entre "misto" e um desafio numa
// matéria em que você tem dificuldade; o tamanho cresce com a fase. O simulado ocupa o lugar das questões novas
// do dia (as dele contam como novas).
const SIM_TAM = { base: 15, ritmo: 20, reta: 30 };      // simulado misto
const SIM_FOCO = { base: 10, ritmo: 15, reta: 20 };     // desafio numa matéria difícil
const NOME_FASE = { base: 'Base', ritmo: 'Ritmo de prova', reta: 'Reta final' };
const fimBase = fimNovas => somaDias(fimNovas, -90);
function faseDe(d, fimNovas) { return d > fimNovas ? 'reta' : d > fimBase(fimNovas) ? 'ritmo' : 'base'; }
const fmtDur = min => (min >= 60 ? `${Math.floor(min / 60)}h${min % 60 ? String(Math.round(min % 60)).padStart(2, '0') : ''}` : `${Math.max(1, Math.round(min))} min`);
const nomeMateria = x => (x.materia ? x.nome : materiaDe(x.c));
function cfgSimulado(fase, k, fracos) {
  const areas = st.cfg.areas.length ? st.cfg.areas : [...ORDEM_AREAS];
  const origem = fase === 'reta' ? 'todas' : 'novas';
  // semanas pares: desafio numa das 3 matérias/temas mais fracos (em rodízio); ímpares: misto
  const foco = fracos.length && k % 2 === 0 ? fracos[(k / 2) % fracos.length] : null;
  if (foco) {
    const mat = nomeMateria(foco);
    return { n: SIM_FOCO[fase], tempo: 'enem', areas: [foco.area], materia: `${foco.area}|${mat}`, origem, rotulo: `Desafio de ${mat}`, foco: true, fase };
  }
  return { n: SIM_TAM[fase], tempo: 'enem', areas, materia: '', origem, rotulo: fase === 'reta' ? 'Simulado geral' : 'Simulado misto', foco: false, fase };
}
function planoSimulados(h, fimNovas, P, rdc) {
  const feitos = (st.simulados || []).map(x => x.data);
  const vazio = { ligado: false, dias: new Map(), fator: () => 1, hoje: null, proximo: null, feitos: feitos.length };
  if (st.cfg.simCrono === false) return vazio;
  const prova = st.cfg.prova;
  const adiados = new Set(st.simAdiados || []);
  const an = analisePontos();
  const fracos = an.pronto ? an.fracos.slice(0, 3) : [];
  const dias = new Map();
  const dom0 = somaDias(h, -diaSemana(h));
  // o simulado de hoje (já feito) conta como o da semana se foi o primeiro dela
  const daSemana = feitos.filter(d => d >= dom0 && d <= h).sort();
  const hojeFeito = daSemana[0] === h;
  for (let dom = dom0, k = 0; dom < prova && k < 80; dom = somaDias(dom, 7), k++) {
    if (k === 0 && daSemana.length) continue;   // já fez o desta semana
    const cands = Array.from({ length: 7 }, (_, i) => somaDias(dom, i))
      .filter(d => d >= h && d < prova && P[diaSemana(d)] > 0 && !rdc.dias.has(d) && !(d === h && rdc.hoje) && !adiados.has(d));
    if (!cands.length) continue;
    // o dia mais forte da semana (empate: o mais perto do fim de semana)
    const dia = cands.reduce((m, d) => (P[diaSemana(d)] >= P[diaSemana(m)] ? d : m));
    dias.set(dia, cfgSimulado(faseDe(dia, fimNovas), Math.floor(diffDias('2026-01-04', dom) / 7), fracos));
  }
  const ocupa = c => c.origem === 'novas';
  const hojeCfg = dias.get(h) || null;
  const proximo = [...dias.keys()].filter(d => d > h).sort()[0] || null;
  return {
    ligado: true, dias, feitos: feitos.length,
    fator: d => (d === h ? (hojeFeito || (hojeCfg && ocupa(hojeCfg)) ? 0 : 1) : dias.has(d) && ocupa(dias.get(d)) ? 0 : 1),
    hoje: hojeCfg ? { cfg: hojeCfg, feito: false } : hojeFeito ? { cfg: null, feito: true } : null,
    proximo: proximo ? { d: proximo, cfg: dias.get(proximo) } : null,
  };
}
// começa um simulado já configurado (pelo cronograma); sem questões novas suficientes, usa qualquer uma
function iniciarSimulado(c) {
  if (st.simulado && !st.simulado.fim) { location.hash = '#/simulado'; return; }
  let cands = candidatosSim(c);
  if (cands.length < c.n && c.origem === 'novas') cands = candidatosSim({ ...c, origem: 'todas' });
  const qs = embaralhar(cands).slice(0, c.n)
    .sort((a, b) => ORDEM_AREAS.indexOf(a.area) - ORDEM_AREAS.indexOf(b.area) || a.ano - b.ano || a.num - b.num);
  if (!qs.length) { alert('Não há questões para esse simulado.'); return; }
  st.simulado = { ids: qs.map(q => q.id), resp: {}, seg: {}, i: 0, inicio: Date.now(), fim: null, limite: qs.length * 180, rotulo: c.rotulo };
  salvar();
  if (location.hash === '#/simulado') rota(); else location.hash = '#/simulado';
}

// ---- quanto falta para um bom desempenho: acerto de primeira por área (últimos 90 dias, ou tudo se houver pouco)
const MIN_PRONTIDAO = 15;
function prontidao() {
  const corte = somaDias(hoje(), -90);
  const A = Object.fromEntries(ORDEM_AREAS.map(a => [a, { n: 0, ok: 0, n90: 0, ok90: 0 }]));
  for (const [id, r] of Object.entries(st.q)) {
    const q = BYID[id];
    if (!q || !r.h?.length || !A[q.area]) continue;
    const t = r.h[0], ok = t[2] === 1 && !t[4] ? 1 : 0, x = A[q.area];
    x.n++; x.ok += ok;
    if (t[0] >= corte) { x.n90++; x.ok90 += ok; }
  }
  const areas = ORDEM_AREAS.map(a => {
    const x = A[a], usa90 = x.n90 >= 30;
    const n = usa90 ? x.n90 : x.n, ok = usa90 ? x.ok90 : x.ok;
    return { area: a, n, taxa: n ? ok / n : null };
  });
  const ult = [...red.hist].slice(0, 3);
  const redacao = ult.length ? Math.round(ult.reduce((s, x) => s + notaMedia(x.res), 0) / ult.length / 20) * 20 : null;
  return { areas, redacao, nRed: ult.length };
}
function prontidaoHTML() {
  const pr = prontidao();
  const alvo = st.cfg.metaAcerto || 70;
  const linha = (rotulo, valor, meta, txtValor, dica) => {
    const pos = Math.min(100, Math.max(0, valor ?? 0));
    const ok = valor !== null && valor >= meta;
    return `<div class="pr-linha" title="${esc(dica)}"><span class="pr-nome">${rotulo}</span>
      <div class="pr-barra"><i class="${ok ? 'ok' : ''}" style="width:${pos}%"></i><b style="left:${meta}%"></b></div>
      <span class="pr-num">${txtValor}</span></div>`;
  };
  let noAlvo = 0, comDados = 0;
  const linhas = pr.areas.map(x => {
    if (x.n < MIN_PRONTIDAO) return linha(chipArea(x.area), null, alvo, `<span class="muted">${x.n}/${MIN_PRONTIDAO} questões</span>`, `Faça pelo menos ${MIN_PRONTIDAO} questões de ${AREAS[x.area]} para medir`);
    const v = Math.round(x.taxa * 100);
    comDados++; if (v >= alvo) noAlvo++;
    return linha(chipArea(x.area), v, alvo, v >= alvo ? `<b class="pr-ok">${v}% ✓</b>` : `<b>${v}%</b> <span class="muted">· faltam ${alvo - v}</span>`, `${AREAS[x.area]}: ${v}% de acerto de primeira em ${x.n} questões`);
  });
  // redação: escala 0–1000 → 0–100% da barra; meta 900
  if (pr.redacao === null) linhas.push(linha('<span class="chip">✍️ Redação</span>', null, 90, '<span class="muted">sem correção</span>', 'Corrija uma redação para medir'));
  else {
    comDados++; if (pr.redacao >= 900) noAlvo++;
    linhas.push(linha('<span class="chip">✍️ Redação</span>', pr.redacao / 10, 90, pr.redacao >= 900 ? `<b class="pr-ok">${pr.redacao} ✓</b>` : `<b>${pr.redacao}</b> <span class="muted">· faltam ${900 - pr.redacao}</span>`, `média das últimas ${pr.nRed} correções`));
  }
  return `<section class="card">
    <div class="titulo-linha"><h2>Quanto falta para um bom desempenho</h2><span class="small muted">${comDados ? `${noAlvo} de ${ORDEM_AREAS.length + 1} no alvo` : ''}</span></div>
    <p class="small muted" style="margin:0 0 12px">Acerto de primeira por área (alvo: <b>${alvo}%</b>, muda em Ajustes) e a média das suas últimas redações (alvo: <b>900</b>).</p>
    <div class="pr-lista">${linhas.join('')}</div>
  </section>`;
}

// ---- plano até a prova: fases na linha do tempo + o que falta
function planoAteProvaHTML(p) {
  const h = hoje(), prova = st.cfg.prova;
  if (p.diasProva <= 0) return '';
  const total = Math.max(1, diffDias(h, prova));
  const fb = fimBase(p.fimNovas);
  const seg = [
    ['base', h, fb < h ? h : fb],
    ['ritmo', fb < h ? h : fb, p.fimNovas < h ? h : p.fimNovas],
    ['reta', p.fimNovas < h ? h : p.fimNovas, prova],
  ].filter(([, a, b]) => b > a);
  const atual = faseDe(h, p.fimNovas);
  const sims = p.simulados;
  const pt = previsaoTermino(p);
  const desc = {
    base: `Questões novas + revisões do caderno de erros. Simulado curto toda semana (${SIM_TAM.base} questões ou desafio de ${SIM_FOCO.base} numa matéria difícil).`,
    ritmo: `Termina as questões novas. Simulados de ${SIM_TAM.ritmo} questões (ou ${SIM_FOCO.ritmo} na matéria mais difícil) no tempo de prova.`,
    reta: `Só revisão: caderno de erros, simulados de ${SIM_TAM.reta} questões e 1 redação por semana.`,
  };
  const pctQ = pct(p.feitas, p.total);
  return `<section class="card">
    <div class="titulo-linha"><h2>Plano até o ENEM</h2><span class="small muted">${fmt(prova)}</span></div>
    <div class="fases">${seg.map(([f, a, b]) => `<div class="fase ${f} ${f === atual ? 'atual' : ''}" style="flex:${Math.max(1, diffDias(a, b))}">
      <span class="fase-nome">${NOME_FASE[f]}</span><span class="fase-data">${dataCurta(a)} – ${dataCurta(b)}</span></div>`).join('')}</div>
    <p class="small" style="margin:10px 0 14px"><b>Agora: ${NOME_FASE[atual]}.</b> ${desc[atual]}</p>
    <div class="plano-metas">
      <div><span class="small muted">Questões novas</span><div class="barra"><i style="width:${Math.max(1, pctQ)}%"></i></div>
        <span class="small">${p.feitas} de ${p.total} · ${p.retaFinal ? 'fase de revisão' : pt.real && pt.fimNovas && pt.fimNovas <= p.fimNovas ? `no seu ritmo, termina em <b>${mesAno(pt.fimNovas)}</b> 💪` : `termina em <b>${mesAno(p.fimNovas)}</b> seguindo as metas`}</span></div>
      ${caminhoCaderno()}
      ${caminhoRedacao(p)}
      ${sims.ligado ? `<div><span class="small muted">Simulados</span><div class="barra"><i style="width:${Math.max(1, pct(sims.feitos, sims.feitos + sims.dias.size))}%"></i></div>
        <span class="small">${sims.feitos} feitos · ${sims.dias.size} até a prova${sims.proximo ? ` · próximo: <b>${DIAS_SEMANA[diaSemana(sims.proximo.d)].toLowerCase()}, ${fmtCurto(sims.proximo.d)}</b> (${esc(sims.proximo.cfg.rotulo)})` : ''}</span></div>` : ''}
    </div>
  </section>`;
}

// caderno de erros: quantas das questões que entraram nele já foram recuperadas (4 acertos seguidos)
function caminhoCaderno() {
  let rev = 0, rec = 0, caixas = 0;
  for (const q of POOL()) { const r = reg(q.id); if (r?.s === 'rev') { rev++; caixas += (r.caixa || 1) - 1; } else if (r?.s === 'rec') rec++; }
  const total = rev + rec;
  if (!total) return '';
  // progresso fino: cada acerto numa revisão sobe uma caixa (de 1 a 4); recuperada = 4 caixas
  const passos = rec * CAIXA_MAX + caixas + rev, max = total * CAIXA_MAX;
  return `<div><span class="small muted">Caderno de erros</span><div class="barra"><i style="width:${Math.max(1, pct(passos, max))}%"></i></div>
    <span class="small">${rec} de ${total} ${total === 1 ? 'recuperada' : 'recuperadas'} · ${rev} em revisão · cada acerto numa revisão avança a barra</span></div>`;
}

// ---- agenda de hoje: tudo o que o cronograma pede, com tempo e um botão para cada coisa
function agendaHoje(p, f) {
  const h = hoje();
  const itens = [];
  const novasAberta = sessaoDe('novas'), revAberta = sessaoDe('rev');
  const rdc = p.redacao, sim = p.simulados;
  if (sim.hoje) {
    const c = sim.hoje.cfg;
    itens.push({
      id: 'sim', icone: '📝', titulo: c ? `Simulado: ${c.rotulo}` : 'Simulado da semana',
      detalhe: c ? `${c.n} questões no tempo de prova${c.origem === 'novas' ? ' · conta como as questões novas de hoje' : ''}` : 'feito hoje',
      min: c ? c.n * 3 : 0, feito: sim.hoje.feito,
      botao: c && (st.simulado && !st.simulado.fim ? { rotulo: 'Continuar simulado', ir: () => { location.hash = '#/simulado'; } } : { rotulo: 'Começar', ir: () => iniciarSimulado(c) }),
      extra: c ? '<button class="btn fantasma mini" type="button" data-ag="sim-adiar">Adiar</button>' : '',
    });
  }
  if (rdc.hoje) {
    const tema = temaSugerido(), ano = anoDoTema(tema);
    itens.push({
      id: 'red', icone: '✍️', titulo: rdc.hoje.tipo === 'hibrida' ? 'Redação (dia híbrido)' : 'Redação',
      detalhe: rdc.hoje.feita ? 'feita' : `${ano ? `🏅 ENEM ${ano}: ` : ''}${esc(tema)}`,
      min: 75, feito: rdc.hoje.feita,
      botao: { rotulo: 'Escrever', ir: abrirRedacaoDoDia },
      extra: rdc.hoje.feita ? '' : '<button class="btn fantasma mini" type="button" data-ag="red-feita">Já fiz no papel</button><button class="btn fantasma mini" type="button" data-ag="red-adiar">Adiar</button>',
    });
  }
  if (f.revs + f.revFaltam > 0) {
    const mais = f.revFaltam === 0 && !revAberta ? adiantaveis().length : 0;
    itens.push({
      id: 'rev', icone: '↺', titulo: 'Revisões do caderno de erros',
      detalhe: f.revFaltam ? `${f.revs} de ${f.revs + f.revFaltam}` : `${f.revs} ${f.revs === 1 ? 'feita' : 'feitas'} hoje · caderno em dia`,
      min: f.revFaltam * 3, feito: f.revFaltam === 0, frac: f.revs / (f.revs + f.revFaltam),
      botao: revAberta ? { rotulo: `Continuar (${revAberta.i + 1}/${revAberta.itens.length})`, ir: () => retomar('rev') } : { rotulo: 'Fazer', ir: () => iniciar(p.vencidas, 'rev') },
      extra: mais ? `<button class="btn mini" type="button" data-ag="adiantar">Adiantar mais (${Math.min(mais, st.cfg.bloco)})</button>` : '',
    });
  }
  // videoaula do dia: antes das questões novas, de um tema cujas questões vêm a seguir (prepara para elas)
  const nAulas = aulasPorDia();
  if (nAulas > 0) {
    const v = aulaDaVez(), vistas = vistasHoje();
    if (v || vistas) {
      const feito = vistas >= nAulas || !v;
      const btns = v ? `${feito ? `<a class="btn mini" href="${urlAula(v.id)}" target="_blank" rel="noopener" data-tocar="${v.id}">▶ Assistir a próxima (${v.min} min)</a>` : ''}
        <button class="btn mini" type="button" data-ag="aula-vi" data-id="${v.id}">✓ Já assisti</button>
        ${feito ? '' : `<button class="btn fantasma mini" type="button" data-ag="aula-pular" data-id="${v.id}" title="Já sei este assunto: passa para a próxima aula">Pular esta aula</button>`}` : '';
      itens.push({
        id: 'aula', icone: '📺',
        titulo: feito ? (vistas === 1 ? 'Videoaula de hoje' : `${vistas} videoaulas hoje`) : v.t,
        detalhe: feito
          ? `${vistas ? `${vistas} ${vistas === 1 ? 'assistida' : 'assistidas'} hoje` : 'nenhuma aula na fila'}${v ? ` · próxima (opcional): <b>${esc(v.t)}</b> — ${esc(rotuloAula(v.c))}` : ''}`
          : `antes das questões novas · ${esc(rotuloAula(v.c))}${v.motivo ? ` (${esc(v.motivo)})` : ''} · ${esc(v.canal)}${nAulas > 1 ? ` · ${vistas + 1} de ${nAulas}` : ''}`,
        min: feito ? 0 : v.min, feito, opcional: !feito && !!(!p.hojeEstuda || rdc.hoje || sim.hoje),   // folga, ou dia de redação/simulado (já é pesado)
        frac: nAulas > 1 ? vistas / nAulas : undefined,
        botao: v && !feito ? { rotulo: `▶ Assistir aqui (${v.min} min)`, href: urlAula(v.id), fora: true, tocar: v.id } : null,
        extra: btns + '<a class="btn fantasma mini" href="#/aulas">Todas as aulas</a>',
      });
    }
  }
  if (!p.retaFinal && p.meta > 0) {
    const falta = Math.max(0, p.meta - p.novasHoje);
    itens.push({
      id: 'novas', icone: '➕', titulo: 'Questões novas', detalhe: `${p.novasHoje} de ${p.meta}${p.novasHoje > p.meta ? ` (+${p.novasHoje - p.meta})` : ''}`,
      min: falta * 3, feito: falta === 0, frac: p.novasHoje / p.meta,
      botao: novasAberta ? { rotulo: `Continuar (${novasAberta.i + 1}/${novasAberta.itens.length})`, ir: () => retomar('novas') }
        : { rotulo: `Fazer as ${falta}`, ir: () => iniciar(falta, 'novas') },
      extra: falta ? '' : sessaoDe('extras') ? `<button class="btn mini" type="button" data-ag="extras-cont">Continuar extras (${sessaoDe('extras').i + 1}/${sessaoDe('extras').itens.length})</button>`
        : `<button class="btn mini" type="button" data-ag="extras">+ ${st.cfg.bloco} extras</button>`,
    });
  }
  // reforço dos erros: uma questão nova do mesmo tema para cada erro recente (conta como questão nova).
  // Só os erros de dias anteriores são obrigatórios hoje: os de hoje entram no plano amanhã (dá para adiantar) —
  // senão errar nos extras, depois de bater o dia, "desfaria" o dia completo.
  const pend = reforcosPendentes();
  const refPend = pend.filter(x => x.e.d < h).length, refHoje = pend.length - refPend;
  const refFeitos = st.log[h]?.f || 0, refAberto = sessaoDe('reforco');
  const continuarRef = refAberto && { rotulo: `Continuar (${refAberto.i + 1}/${refAberto.itens.length})`, ir: () => retomar('reforco') };
  const deHoje = refHoje ? `${refHoje} ${refHoje === 1 ? 'erro' : 'erros'} de hoje ${refHoje === 1 ? 'entra' : 'entram'} no plano amanhã` : '';
  if (refPend + refFeitos > 0) {
    itens.push({
      id: 'reforco', icone: '🧩', titulo: 'Reforço dos erros',
      detalhe: refPend ? `${refFeitos} de ${refFeitos + refPend} · questões novas dos temas que você errou (as erradas voltam depois, quando você já esqueceu a resposta)${deHoje ? ` · +${deHoje}` : ''}`
        : `${refFeitos} ${refFeitos === 1 ? 'feito' : 'feitos'} hoje${deHoje ? ` · ${deHoje}` : ''}`,
      min: refPend * 3, feito: refPend === 0, frac: refFeitos / (refFeitos + refPend),
      botao: continuarRef || { rotulo: `Fazer ${refPend}`, ir: () => iniciar(refPend, 'reforco') },
      extra: !refPend && (refAberto || refHoje) ? `<button class="btn mini" type="button" data-ag="ref-adiantar">${refAberto ? `Continuar reforço (${refAberto.i + 1}/${refAberto.itens.length})` : `Adiantar ${refHoje}`}</button>` : '',
    });
  } else if (refHoje) {
    itens.push({
      id: 'reforco', icone: '🧩', titulo: 'Reforço dos erros de hoje',
      detalhe: `${deHoje} · dá para adiantar agora`,
      min: refHoje * 3, feito: false, opcional: true,
      botao: continuarRef || { rotulo: `Adiantar ${refHoje}`, ir: () => iniciar(refHoje, 'reforco') },
    });
  }
  // desafio do dia: opcional
  const { def, arg } = desafioHoje(p, f);
  const R = respostasHoje();
  const pr = def.prog(R, p, f, arg);
  if (pr.feito && !st.desafiosFeitos?.[h]) { (st.desafiosFeitos ||= {})[h] = 1; salvar(); }
  const dFeito = !!st.desafiosFeitos?.[h];
  const ac = dFeito ? null : def.acao(p, f, arg, R);
  itens.push({
    id: 'desafio', icone: '🎯', titulo: `Desafio: ${def.titulo}`, detalhe: `${def.texto(p, arg)} <span class="muted">· ${dFeito ? 'cumprido' : esc(pr.txt)}</span>`,
    min: 0, feito: dFeito, frac: pr.frac, opcional: true,
    botao: ac && (ac.href ? { rotulo: ac.rotulo, href: ac.href } : { rotulo: ac.rotulo, ir: ac.ir }),
  });
  return itens;
}
// o que já foi feito hoje (todas as respostas, de qualquer aba)
function resumoDia() {
  const lg = st.log[hoje()] || { n: 0, r: 0, ok: 0 };
  const tot = lg.n + lg.r;
  if (!tot) return '';
  return `<p class="small muted" style="margin:0 0 4px">Hoje: <b>${tot}</b> ${tot === 1 ? 'resposta' : 'respostas'} (${lg.n} ${lg.n === 1 ? 'nova' : 'novas'}, ${lg.r} ${lg.r === 1 ? 'revisão' : 'revisões'}) · ${pct(lg.ok, tot)}% de acerto</p>`;
}
function agendaHTML(p, f, itens) {
  const obrig = itens.filter(x => !x.opcional);
  const feitos = obrig.filter(x => x.feito).length;
  const falta = obrig.filter(x => !x.feito).reduce((s, x) => s + x.min, 0);
  const completo = obrig.length && feitos === obrig.length;
  const seq = seqDesafio();
  let cab;
  if (!p.hojeEstuda && !obrig.length) cab = 'Hoje é <b>folga</b> no seu cronograma. Se quiser, o desafio do dia e a aba Questões estão aí — sem culpa.';
  else if (completo) cab = `✓ <b>Dia completo!</b> ${p.novasHoje > p.meta && p.meta ? `E com +${p.novasHoje - p.meta} novas além da meta. ` : ''}Daqui para frente é lucro.`;
  else cab = `${feitos} de ${obrig.length} ${obrig.length === 1 ? 'tarefa' : 'tarefas'} · faltam <b>~${fmtDur(falta)}</b>`;
  // cada tipo de tarefa tem a sua cor (como no visual novo): ícone, barra e botão
  const COR = { novas: 'azul', rev: 'laranja', reforco: 'roxo', red: 'verde', sim: 'rosa', desafio: 'ouro', aula: 'verm' };
  return `<section class="card agenda">
    <div class="ag-topo">
      <div><h2>Hoje</h2><span class="ag-cab">${cab}</span></div>
      ${obrig.length ? `<div class="barra ag-barra"><i style="width:${Math.max(2, pct(feitos, obrig.length))}%"></i></div>` : ''}
    </div>
    ${resumoDia()}
    ${seq > 1 ? `<p class="small muted" style="margin:0 0 8px">🔥 ${seq} dias de desafio seguidos</p>` : ''}
    <ul class="ag-lista">${itens.map(x => `<li class="ag-item cor-${COR[x.id] || 'azul'} ${x.feito ? 'feito' : ''} ${x.opcional ? 'opcional' : ''}" data-item="${x.id}">
      <div class="ag-cabeca">
        <span class="ag-icone">${x.feito ? '✓' : x.icone}</span>
        <div class="ag-texto"><b>${esc(x.titulo)}</b>${x.opcional ? '<span class="chip">opcional</span>' : ''}<span class="small">${x.detalhe}${x.min && !x.feito ? ` · ~${fmtDur(x.min)}` : ''}</span></div>
      </div>
      ${x.frac !== undefined && !x.feito ? `<span class="barra fina"><i style="width:${Math.round(100 * Math.min(1, x.frac))}%"></i></span>` : ''}
      <div class="ag-acoes">
        ${x.botao && !x.feito ? (x.botao.href ? `<a class="btn ag-btn" href="${x.botao.href}"${x.botao.fora ? ' target="_blank" rel="noopener"' : ''}${x.botao.tocar ? ` data-tocar="${x.botao.tocar}"` : ''}>${esc(x.botao.rotulo)}</a>` : `<button class="btn ag-btn" type="button" data-ir="${x.id}">${esc(x.botao.rotulo)}</button>`) : ''}
        ${x.extra || ''}</div>
    </li>`).join('')}</ul>
    <p class="small muted" style="margin:14px 0 0">Quer só responder questões, sem plano? Use a aba <a href="#/questoes">Questões</a> — tudo conta no cronograma do mesmo jeito.</p>
  </section>`;
}

function telaInicio() {
  const p = plano();
  const h = hoje();
  if (p.meta && st.log[h]?.m === undefined) { (st.log[h] ||= { n: 0, r: 0, ok: 0 }).m = p.meta; salvar(); }
  // dia de redação/simulado: a meta guardada acompanha a troca (para a semana não marcar "faltou")
  if ((p.redacao.hoje || p.simulados.hoje) && st.log[h]?.m !== p.meta) { (st.log[h] ||= { n: 0, r: 0, ok: 0 }).m = p.meta; salvar(); }
  const f = diaHoje(p);
  const itens = agendaHoje(p, f);
  const P = p.pesos;
  let diasEstudo = 0;
  for (let d = h; d < st.cfg.prova; d = somaDias(d, 1)) if (P[diaSemana(d)] > 0) diasEstudo++;
  $app.innerHTML = `
    <div class="crono-topo">
      <div><div class="sobretitulo">${new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' })}</div>
        <h1>${saudacao()} ${p.diasProva > 0 ? 'Bora fechar o dia?' : ''}</h1>
        ${p.diasProva > 0 ? '' : '<p class="muted" style="margin:0">Configure a data da prova em Ajustes.</p>'}</div>
      ${p.diasProva > 0 ? `<div class="crono-nums">
        <span><b class="azul">${p.diasProva}</b> dias pro ENEM</span>
        <span><b>${pct(POOL().filter(q => feita(q.id)).length, POOL().length)}%</b> do banco</span>
        <span><b>${NOME_FASE[faseDe(h, p.fimNovas)]}</b> · ${diasEstudo} dias de estudo</span></div>` : ''}
    </div>
    ${cardFoco()}
    ${agendaHTML(p, f, itens)}
    ${cardRankingCrono()}
    ${cardTrilha(p)}
    ${cardSemanaMes(p)}
    ${semanasAteProvaHTML(p)}
    ${prontidaoHTML()}
    ${planoAteProvaHTML(p)}
    <p class="small muted" style="text-align:center">Como o cronograma é calculado? <a href="#/logica">Ver a lógica completa →</a></p>
  `;
  $app.querySelectorAll('[data-ir]').forEach(b => b.addEventListener('click', () => itens.find(x => x.id === b.dataset.ir)?.botao?.ir?.()));
  // semana | mês: troca só o card (a escolha fica guardada neste navegador)
  const trocaVista = e => {
    const b = e.target.closest('[data-vista]');
    if (!b) return;
    try { localStorage.setItem(VISTA_KEY, b.dataset.vista); } catch { /* vale só agora */ }
    const novo = document.createElement('div');
    novo.innerHTML = cardSemanaMes(p);
    document.getElementById('card-vista').replaceWith(novo.firstElementChild);
    document.getElementById('card-vista').addEventListener('click', trocaVista);
  };
  $app.querySelector('#card-vista')?.addEventListener('click', trocaVista);
  $app.querySelector('[data-ag=red-feita]')?.addEventListener('click', () => {
    if (!confirm('Marcar a redação de hoje como feita (sem mandar para a correção)?')) return;
    (red.feitas ||= []).push(h); salvarRed(); rota();
  });
  $app.querySelector('[data-ag=red-adiar]')?.addEventListener('click', () => { (red.adiadas ||= []).push(h); salvarRed(); rota(); });
  $app.querySelector('[data-ag=adiantar]')?.addEventListener('click', () => iniciar(st.cfg.bloco, 'rev'));
  $app.querySelector('[data-ag=extras]')?.addEventListener('click', () => iniciar(st.cfg.bloco, 'novas', null, { extra: true }));
  $app.querySelector('[data-ag=extras-cont]')?.addEventListener('click', () => retomar('extras'));
  $app.querySelector('[data-ag=ref-adiantar]')?.addEventListener('click', () => (sessaoDe('reforco') ? retomar('reforco') : iniciar(reforcosPendentes().length, 'reforco')));
  $app.querySelector('[data-ag=sim-adiar]')?.addEventListener('click', () => { (st.simAdiados ||= []).push(h); st.simAdiados = st.simAdiados.slice(-30); salvar(); rota(); });
  $app.querySelector('[data-ag=aula-vi]')?.addEventListener('click', e => { marcarAula(e.currentTarget.dataset.id, false); rota(); });
  $app.querySelector('[data-ag=aula-pular]')?.addEventListener('click', e => { marcarAula(e.currentTarget.dataset.id, true); rota(); });
  ligarTreinar();
  ligarTrilha();
  ligarRankingCrono();
}

// ---------------------------------------------------------------- questões (responder livremente)
function telaQuestoes() {
  const emAndamento = sessaoDe('misto'), revAberta = sessaoDe('rev');
  const outrosAbertos = blocosAbertos().filter(x => chaveDe(x) !== 'misto' && chaveDe(x) !== 'rev');
  const lg = st.log[hoje()] || { n: 0, r: 0, ok: 0 };
  const tot = lg.n + lg.r;
  const nVenc = vencidas().length;
  const areas = st.cfg.areas.length ? st.cfg.areas : ORDEM_AREAS;
  $app.innerHTML = `
    <div class="titulo-linha"><h1>Questões</h1><span class="small muted">${tot ? `hoje: ${tot} ${tot === 1 ? 'questão' : 'questões'} · ${pct(lg.ok, tot)}% de acerto` : 'nenhuma questão hoje ainda'}</span></div>
    <p class="muted" style="margin-top:0">Responda à vontade, sem plano. Tudo o que você fizer aqui conta no cronograma.</p>
    ${cardFoco()}
    <section class="card destaque">
      ${emAndamento ? `<button class="btn primario grande" data-q="continuar">Continuar bloco (${emAndamento.i + 1}/${emAndamento.itens.length})</button>` : ''}
      ${outrosAbertos.map(x => `<button class="btn grande" data-cont="${chaveDe(x)}" style="margin-top:8px">Continuar ${NOME_BLOCO[chaveDe(x)]} (${x.i + 1}/${x.itens.length})</button>`).join('')}
      <label class="campo" style="margin-top:${emAndamento || outrosAbertos.length ? 14 : 0}px">Bloco de questões (novas + revisões do dia)</label>
      <div class="opcoes">${[5, 10, 15, 20, 30].map(n => `<button class="op ${n === st.cfg.bloco ? 'on' : ''}" type="button" data-bloco="${n}">${n}</button>`).join('')}</div>
      <div class="linha-btns">
        <button class="btn ${emAndamento ? '' : 'primario'} grande" data-q="bloco">Começar bloco de ${st.cfg.bloco}</button>
      </div>
      <div class="linha-btns">
        <button class="btn" data-q="rapido">⚡ 5 rapidinhas</button>
        ${revAberta ? `<button class="btn" data-q="cont-rev">↺ Continuar correção (${revAberta.i + 1}/${revAberta.itens.length})</button>`
          : nVenc ? `<button class="btn" data-q="revisar">↺ Só revisões (${nVenc})</button>` : ''}
        <a class="btn" href="#/simulado">📝 Simulado</a>
      </div>
    </section>
    <section class="card">
      <h2>Por área</h2>
      <div class="q-areas">${areas.map(a => `<button class="btn" type="button" data-area-q="${a}">${chipArea(a)}<span class="small muted">${st.cfg.bloco} questões</span></button>`).join('')}</div>
    </section>
    ${cardPontosErros()}
  `;
  const q = s => $app.querySelector(`[data-q=${s}]`);
  q('continuar')?.addEventListener('click', () => retomar('misto'));
  $app.querySelectorAll('[data-cont]').forEach(b => b.addEventListener('click', () => retomar(b.dataset.cont)));
  q('bloco').addEventListener('click', () => iniciar(st.cfg.bloco, 'misto'));
  q('rapido').addEventListener('click', () => iniciar(5, 'misto'));
  q('cont-rev')?.addEventListener('click', () => retomar('rev'));
  q('revisar')?.addEventListener('click', () => iniciar(nVenc, 'rev'));
  $app.querySelectorAll('[data-bloco]').forEach(b => b.addEventListener('click', () => { st.cfg.bloco = +b.dataset.bloco; salvar(); rota(); }));
  $app.querySelectorAll('[data-area-q]').forEach(b => b.addEventListener('click', () => iniciar(st.cfg.bloco, 'area', b.dataset.areaQ)));
  ligarTreinar();
}

// ---- trilha de focos no cronograma: o tema em foco de cada área, quanto falta, o próximo e a trilha inteira
const COR_AREA = { LC: 'azul', CH: 'laranja', CN: 'verde', MT: 'roxo' };
function cardTrilha(p) {
  if (!trilhaLigada() || p.retaFinal) return '';
  const ct = contagemTemas();
  const areas = st.cfg.areas.length ? st.cfg.areas : ORDEM_AREAS;
  // questões do foco por dia corrido em cada área: novas de um dia normal × peso médio ÷ áreas × 2/3
  const pesoDia = p.pesos.reduce((s, x) => s + x, 0) / 7;
  const porDia = p.unidade * pesoDia / areas.length * (TRILHA.padrao.filter(Boolean).length / TRILHA.padrao.length);
  const linhas = areas.map(a => {
    const e = etapaAtual(a, ct);
    if (!e) return `<li class="tr-area ${a}">${chipArea(a)}<span class="small muted">Trilha concluída: as novas que sobrarem vêm na ordem normal.</span></li>`;
    const nDias = porDia > 0 ? Math.max(1, Math.ceil(e.falta / porDia)) : 0;
    return `<li class="tr-area ${a}">
      <div class="tr-topo">${chipArea(a)}${e.tipo === 'revisao' ? `<span class="chip tag-rev">${e.giro > 1 ? `🔁 Revisão · ${e.giro}º giro` : '🔁 Revisão'}</span>` : ''}</div>
      <div class="tr-tema"><span class="small muted">${esc(materiaDe(e.c))}</span><b>${esc(nomeTema(e.c))}</b></div>
      <span class="barra fina"><i style="width:${Math.max(3, pct(e.feitas, e.quota))}%"></i></span>
      <span class="small muted">${e.feitas} de ${e.quota} questões${nDias ? ` · ~${dias(nDias)}` : ''}</span>
      ${e.prox ? `<span class="small muted">Depois: ${e.prox.tipo === 'revisao' ? '🔁 revisão de ' : ''}${esc(rotuloTema(e.prox.c))}</span>` : ''}
      ${(() => { const l = aulasDoTema(e.c); return l.length ? `<a class="small" href="#/aulas/${e.c}">📺 ${l.filter(v => aulaVista(v.id)).length} de ${l.length} ${l.length === 1 ? 'aula vista' : 'aulas vistas'}</a>` : ''; })()}
      <div class="tr-acoes"><button class="btn mini" type="button" data-treinar="${e.c}" title="Bloco só deste tema (revisões dele + novas)">Treinar</button>
        <button class="btn fantasma mini" type="button" data-pular="${a}" title="Passa para o próximo tema (este volta nas revisões)">Pular</button></div>
    </li>`;
  }).join('');
  const toda = areas.map(a => {
    const seq = etapasTrilha(a, ct), e = etapaAtual(a, ct);
    const k = e ? e.k : seq.length, giro = e ? e.giro : 1;
    const doGiro = seq.map((s, i) => ({ ...s, i })).filter(s => s.giro === giro);
    const fase = (s) => (s.i < k ? 'feita' : s.i === k ? 'atual' : ct.resta(s.c) > 0 ? '' : 'vazia');
    return `<details class="tr-toda ${a}"><summary>${chipArea(a)} <span class="small muted">${giro > 1 ? `${giro}º giro (revisão) · ` : ''}etapa ${Math.min(doGiro.length, doGiro.filter(s => s.i < k).length + 1)} de ${doGiro.length}</span></summary>
      <ol>${doGiro.map(s => `<li class="${fase(s)}">${s.i < k ? '✓ ' : s.i === k ? '▶ ' : ''}${s.tipo === 'revisao' ? '🔁 Revisão: ' : ''}${esc(rotuloTema(s.c))}<span class="small muted"> · ${ct.resta(s.c)} novas</span></li>`).join('')}</ol>
      <p class="small muted">${giro < 4 ? 'Depois deste giro: um giro só de revisões, tema por tema, com as questões novas que sobrarem de cada um.' : ''}</p>
    </details>`;
  }).join('');
  return `<section class="card trilha">
    <div class="titulo-linha"><h2>📚 Foco do momento</h2></div>
    <p class="small muted" style="margin-top:0">Em cada área, <b>2 de cada 3</b> questões novas vêm do tema em foco; a outra, de um tema que já passou (o que você viu há mais tempo). Cada tema guarda questões para voltar nas revisões — a cada 3 temas, uma revisão de um antigo.</p>
    <ul class="tr-lista">${linhas}</ul>
    <details class="tr-mais"><summary class="small">Ver a trilha completa</summary>${toda}</details>
  </section>`;
}
function ligarTrilha() {
  $app.querySelectorAll('[data-pular]').forEach(b => b.addEventListener('click', () => {
    const a = b.dataset.pular, e = etapaAtual(a);
    if (!e || !confirm(`Pular "${rotuloTema(e.c)}" e ir para o próximo tema de ${AREAS[a]}? As questões que sobraram dele voltam nas etapas de revisão.`)) return;
    etapaAtual(a, contagemTemas(), true);
    rota();
  }));
}

// ---------------------------------------------------------------- aba Aulas: todas as videoaulas, por área e tema
function telaAulas(alvo) {
  const ct = trilhaLigada() ? contagemTemas() : null;
  const emFoco = new Set(ct ? ORDEM_AREAS.map(a => etapaAtual(a, ct)?.c).filter(Boolean) : []);
  const fila = filaAulas(), pedidos = new Set(st.aulaFila || []);
  const todas = Object.keys(AULA_INFO), vistas = todas.filter(aulaVista).length;
  const linhaVideo = v => `<li class="aula ${aulaVista(v.id) ? 'vista' : ''}">
      <button class="aula-ok" type="button" data-aula-ok="${v.id}" title="${aulaVista(v.id) ? 'Desmarcar' : 'Marcar como assistida'}">${aulaVista(v.id) ? (st.aulas[v.id].p ? '⏭' : '✓') : ''}</button>
      <a href="${urlAula(v.id)}" target="_blank" rel="noopener" class="cresce" data-tocar="${v.id}"><b>${esc(v.t)}</b><span class="small muted">${esc(v.canal)} · ${v.min} min${aulaVista(v.id) ? ` · ${st.aulas[v.id].p ? 'pulada' : 'vista'} em ${fmtCurto(st.aulas[v.id].d)}` : ''}</span></a>
    </li>`;
  const blocoTema = (c, nome, tag = '') => {
    const l = aulasDoTema(c);
    if (!l.length) return '';
    const n = l.filter(v => aulaVista(v.id)).length;
    return `<details class="aula-tema" id="aula-${c}" ${c === alvo || emFoco.has(c) ? 'open' : ''}>
      <summary><span class="cresce"><b>${esc(nome)}</b>${tag}</span><span class="small muted">${n}/${l.length}</span></summary>
      <ul class="aula-lista">${l.map(linhaVideo).join('')}</ul>
      ${n < l.length ? `<button class="btn mini" type="button" data-aula-pedir="${c}">${pedidos.has(c) ? '📌 Na frente da fila — tirar' : '📌 Pôr na frente do cronograma'}</button>` : ''}
    </details>`;
  };
  const areas = ORDEM_AREAS.map(a => `<section class="card">
      <h2>${chipArea(a)}</h2>
      ${ORDEM_TEMAS[a].map(l => `<h3 class="aula-materia">${esc(materiaDe(l[0]))}</h3>${l.map(c => blocoTema(c, nomeTema(c), emFoco.has(c) ? ' <span class="chip tag-trilha">📚 Em foco</span>' : pedidos.has(c) ? ' <span class="chip">📌 Pedido</span>' : '')).join('')}`).join('')}
    </section>`).join('');
  $app.innerHTML = `
    <div class="titulo-linha"><h1>📺 Videoaulas</h1><span class="small muted">${vistas} de ${todas.length} vistas</span></div>
    <p class="muted" style="margin-top:0">O cronograma põe ${aulasPorDia() === 1 ? 'uma aula por dia' : aulasPorDia() ? `${aulasPorDia()} aulas por dia` : 'aulas no dia (desligado em Ajustes)'} <b>antes das questões novas</b>, do tema cujas questões vêm a seguir. Aqui estão todas — dá para adiantar, marcar as que já viu ou pôr um tema na frente da fila.</p>
    <section class="card">
      <h2>Próximas no cronograma</h2>
      ${fila.length ? `<ol class="aula-prox">${fila.slice(0, 6).map(v => `<li><a href="${urlAula(v.id)}" target="_blank" rel="noopener" data-tocar="${v.id}"><b>${esc(v.t)}</b></a> <span class="small muted">· ${esc(rotuloAula(v.c))} · ${v.min} min — ${esc(v.motivo)}</span></li>`).join('')}</ol>` : '<p class="muted">Nenhuma aula na fila agora.</p>'}
    </section>
    <section class="card">
      <h2>🧮 Matemática básica</h2>
      <p class="small muted" style="margin-top:0">A base das contas do ENEM (frações, potências, regra de três…). Entra no cronograma desde o começo, alternando com as aulas dos temas em foco.</p>
      ${AULAS.base.map(b => blocoTema(b.c, b.nome, pedidos.has(b.c) ? ' <span class="chip">📌 Pedido</span>' : '')).join('')}
    </section>
    ${areas}`;
  $app.querySelectorAll('[data-aula-ok]').forEach(b => b.addEventListener('click', () => {
    const id = b.dataset.aulaOk;
    if (aulaVista(id)) { delete st.aulas[id]; salvar(); } else marcarAula(id, false);
    rota();
  }));
  $app.querySelectorAll('[data-aula-pedir]').forEach(b => b.addEventListener('click', () => {
    const c = b.dataset.aulaPedir, f = st.aulaFila || [];
    st.aulaFila = f.includes(c) ? f.filter(x => x !== c) : [...f, c];
    st.aulaDia = null;   // a aula da vez (ainda não vista) já passa a ser a do tema pedido
    salvar(); rota();
  }));
  if (alvo) document.getElementById(`aula-${alvo}`)?.scrollIntoView({ block: 'start' });
}

function cardFoco() {
  return st.simulado && !st.simulado.fim ? '<section class="card"><p class="aviso" style="margin:0">Você tem um <a href="#/simulado">simulado em andamento</a> — o relógio continua correndo.</p></section>' : '';
}
// pontos fracos no caderno de erros: os 3 piores temas, com botão de treinar
function cardPontosErros() {
  const an = analisePontos();
  if (!an.temOsTemas) return '';
  if (!an.pronto) return `<section class="card"><h2>🎯 Pontos fracos</h2><p class="small muted" style="margin:0">Aparecem depois de ${MIN_ANALISE} questões feitas (faltam ${MIN_ANALISE - an.n}).</p></section>`;
  return `<section class="card">
    <div class="titulo-linha"><h2>🎯 Onde você mais erra</h2><span class="small muted">média ${Math.round(an.media * 100)}%</span></div>
    ${an.fracos.length ? `<ul class="lista">${an.fracos.slice(0, 3).map(x => linhaTema(x, an.media)).join('')}</ul>` : '<p class="muted">Nenhum tema claramente abaixo da sua média por enquanto.</p>'}
    <a href="#/pontos">Ver a análise completa →</a>
  </section>`;
}
function saudacao() {
  const h = new Date().getHours();
  return h < 12 ? 'Bom dia!' : h < 18 ? 'Boa tarde!' : 'Boa noite!';
}
// semana atual: em cada dia, a meta de novas, o que foi feito e o acerto
function semanaHTML(p = plano()) {
  const h = hoje();
  const dom = somaDias(h, -diaSemana(h));
  let out = '<div class="semana semana-metas">';
  let sMeta = 0, sNovas = 0, sTot = 0, sOk = 0;
  for (let k = 0; k < 7; k++) {
    const d = somaDias(dom, k);
    const lg = st.log[d];
    const peso = p.pesos[k];
    const meta = d < h ? (lg?.m || 0) : d === h ? p.meta : p.metaFutura(d);
    const novas = lg?.n || 0, tot = lg ? lg.n + lg.r : 0;
    if (d <= h) { sMeta += meta; sNovas += novas; sTot += tot; sOk += lg?.ok || 0; } else sMeta += meta;
    let estado = '', cls = '';
    if (d > h) { estado = meta && peso === 1 ? 'meta' : nomeNivel(peso).toLowerCase(); cls = 'futuro'; }
    else if (meta && novas >= meta) { estado = novas > meta ? `★ +${novas - meta}` : '✓ meta'; cls = novas > meta ? 'superou' : 'bateu'; }
    else if (meta) { estado = d < h ? `faltou ${meta - novas}` : `faltam ${meta - novas}`; cls = d < h ? 'faltou' : ''; }
    else if (tot) { estado = `★ +${tot} extra`; cls = 'superou'; }
    else estado = peso ? '' : 'folga';
    const rs = p.redacao?.dias.get(d), rf = p.redacao?.feitas.has(d);
    if (rs && d >= h && !rf) { estado = rs === 'cheia' ? '✍️ redação' : '✍️ + ½'; cls += ' redacao'; }
    const ss = p.simulados?.dias.get(d), sf = (st.simulados || []).some(x => x.data === d);
    if (ss && d >= h) { estado = '📝 simulado'; cls += ' redacao'; }
    const larg = meta ? Math.min(100, pct(novas, meta)) : tot ? 100 : 0;
    out += `<div class="${d === h ? 'hoje' : ''} ${!peso ? 'folga' : ''} ${cls}" title="${fmt(d)} · ${nomeNivel(peso)}${meta ? ` · meta: ${meta} novas` : ''}${tot ? ` · ${novas} novas + ${tot - novas} revisões · ${pct(lg.ok, tot)}% de acerto` : ''}">
      <span class="dia">${DIAS_SEMANA[k]}</span>
      <b>${d > h ? (meta || (rs ? '✍️' : ss ? '📝' : '–')) : meta ? novas : tot || (d < h ? '·' : rs ? '✍️' : ss ? '📝' : '0')}</b>
      ${d <= h && (meta || tot) ? `<span class="mini-barra"><i style="width:${larg}%"></i></span>` : ''}
      <span class="est">${estado}</span>
      ${meta && lg?.r ? `<span class="ac">+${lg.r} rev.</span>` : ''}
      ${tot ? `<span class="ac">${pct(lg.ok, tot)}%</span>` : ''}
      ${rf && d <= h ? '<span class="ac" style="color:var(--ok)">✍️ feita</span>' : ''}
      ${sf && d <= h ? '<span class="ac" style="color:var(--ok)">📝 feito</span>' : ''}
    </div>`;
  }
  out += '</div>';
  if (sMeta) out += `<p class="small muted" style="margin:10px 0 0">Na semana: <b>${sNovas}</b> de ${sMeta} questões novas.</p>`;
  return out;
}
// ---- cronograma no visual novo: semana em linhas (novas, revisões, redação e simulado) ou o mês inteiro
const VISTA_KEY = 'enem.vista';
function vistaCrono() { try { return localStorage.getItem(VISTA_KEY) === 'mes' ? 'mes' : 'semana'; } catch { return 'semana'; } }
// uma célula: tipo (feito, alem, faltou, hoje, futuro, marca, marcaFeita, vazio), cor, número grande e legenda
function celula(tipo, cor, txt, sub = '', frac) {
  return `<div class="cel cel-${tipo} cor-${cor}"><b>${txt}</b>${sub ? `<span>${sub}</span>` : ''}${frac !== undefined ? `<i class="cel-barra"><i style="width:${Math.round(100 * Math.min(1, frac))}%"></i></i>` : ''}</div>`;
}
function celNovas(p, d, h) {
  const lg = st.log[d], peso = p.pesos[diaSemana(d)];
  const meta = d < h ? (lg?.m || 0) : d === h ? p.meta : p.metaFutura(d);
  const n = lg?.n || 0;
  if (d > h) return meta ? celula('futuro', 'azul', meta) : celula('vazio', 'azul', '–');
  if (meta && n > meta) return celula('alem', 'ouro', n, `+${n - meta}`);
  if (meta && n >= meta) return celula('feito', 'azul', n, '✓');
  if (d === h) return meta ? celula('hoje', 'azul', `${n}/${meta}`, '', n / meta) : n ? celula('alem', 'ouro', n, 'extra') : celula('vazio', 'azul', peso ? '–' : '☾');
  if (meta) return celula('faltou', 'verm', `${n}/${meta}`);
  return n ? celula('alem', 'ouro', n, 'extra') : celula('vazio', 'azul', peso ? '–' : '☾');
}
function celRevisoes(d, h, previstas) {
  const r = st.log[d]?.r || 0;
  if (d < h) return r ? celula('feito', 'laranja', r) : celula('vazio', 'laranja', '–');
  if (d === h) { const falta = vencidas().length; return r + falta ? celula('hoje', 'laranja', `${r}/${r + falta}`, '', r / (r + falta)) : celula('vazio', 'laranja', '–'); }
  return previstas[d] ? celula('futuro', 'laranja', previstas[d]) : celula('vazio', 'laranja', '–');
}
function celExtras(p, d, h) {
  const rf = p.redacao?.feitas.has(d), rs = p.redacao?.dias.get(d);
  const sf = (st.simulados || []).some(x => x.data === d), ss = p.simulados?.dias.get(d);
  if (rf && sf) return celula('marcaFeita', 'verde', '✍️📝', 'feitos');
  if (rf) return celula('marcaFeita', 'verde', '✍️', 'feita');
  if (sf) return celula('marcaFeita', 'rosa', '📝', 'feito');
  if (d >= h && rs) return celula('marca', 'verde', '✍️', 'redação');
  if (d >= h && ss) return celula('marca', 'rosa', '📝', 'simulado');
  return celula('vazio', 'verde', '–');
}
function semanaGradeHTML(p) {
  const h = hoje(), dom = somaDias(h, -diaSemana(h));
  const dias7 = Array.from({ length: 7 }, (_, k) => somaDias(dom, k));
  const previstas = {};
  for (const q of emRevisao()) { const d = reg(q.id).prox; if (d > h && d <= dias7[6]) previstas[d] = (previstas[d] || 0) + 1; }
  const linha = (nome, ic, cor, cel) => `<div class="gr-nome"><span class="gr-ic cor-${cor}">${ic}</span><b>${nome}</b></div>${dias7.map(cel).join('')}`;
  return `<div class="grade-rolagem"><div class="grade-semana">
    <span></span>${dias7.map((d, k) => `<div class="gr-dia ${d === h ? 'hoje' : ''}"><b>${DIAS_SEMANA[k]}</b><span>${parse(d).getDate()}</span></div>`).join('')}
    ${linha('Questões novas', '➕', 'azul', d => celNovas(p, d, h))}
    ${linha('Revisões', '↺', 'laranja', d => celRevisoes(d, h, previstas))}
    ${linha('Redação e simulado', '⭐', 'verde', d => celExtras(p, d, h))}
  </div></div>`;
}
function mesHTML(p) {
  const h = hoje(), ini = h.slice(0, 8) + '01';
  const dom = somaDias(ini, -diaSemana(ini));
  const mes = ini.slice(0, 7);
  let metas = 0, reds = 0, sims = 0;
  const cel = d => {
    const lg = st.log[d], peso = p.pesos[diaSemana(d)], n = lg?.n || 0;
    const fora = d.slice(0, 7) !== mes;
    const meta = d < h ? (lg?.m || 0) : d === h ? p.meta : p.metaFutura(d);
    const rf = p.redacao?.feitas.has(d), rs = p.redacao?.dias.get(d);
    const sf = (st.simulados || []).some(x => x.data === d), ss = p.simulados?.dias.get(d);
    if (!fora && d <= h) { if (meta && n >= meta) metas++; if (rf) reds++; if (sf) sims++; }
    let tipo, cor, v = '', sub = '', ic = '';
    if (d === h) { tipo = 'hoje'; cor = 'azul'; v = meta ? `${n}/${meta}` : n || ''; sub = 'hoje'; ic = '▶'; }
    else if (d < h && rf) { tipo = 'marcaFeita'; cor = 'verde'; v = '✍️'; sub = 'redação ✓'; }
    else if (d < h && meta && n > meta) { tipo = 'alem'; cor = 'ouro'; v = `${n}/${meta}`; sub = `★ +${n - meta}`; ic = '🔥'; }
    else if (d < h && meta && n >= meta) { tipo = 'feito'; cor = 'verde'; v = `${n}/${meta}`; sub = '✓ meta'; ic = '🔥'; }
    else if (d < h && meta) { tipo = 'faltou'; cor = 'verm'; v = `${n}/${meta}`; sub = `faltou ${meta - n}`; }
    else if (d < h && n) { tipo = 'alem'; cor = 'ouro'; v = n; sub = 'extra'; ic = '🔥'; }
    else if (d > h && ss) { tipo = 'marca'; cor = 'rosa'; v = '📝'; sub = 'simulado'; }
    else if (d > h && rs) { tipo = 'marca'; cor = 'verde'; v = '✍️'; sub = 'redação'; }
    else if (!peso) { tipo = 'folga'; cor = 'azul'; sub = 'folga'; ic = '☾'; }
    else if (d > h && meta) { tipo = 'futuro'; cor = 'azul'; v = meta; sub = 'meta'; }
    else { tipo = 'vazio'; cor = 'azul'; }
    return `<div class="cel-mes cel-${tipo} cor-${cor} ${fora ? 'fora' : ''}"><div><b>${parse(d).getDate()}</b><span>${ic}</span></div><div><b>${v}</b><span>${sub}</span></div></div>`;
  };
  const dias = [];
  for (let d = dom; dias.length < 42 && (dias.length < 35 || d.slice(0, 7) === mes); d = somaDias(d, 1)) dias.push(d);
  while (dias.length % 7) dias.push(somaDias(dias[dias.length - 1], 1));
  const corpo = dias.map(cel).join('');
  const nomeMes = parse(ini).toLocaleDateString('pt-BR', { month: 'long' });
  return `<div class="grade-rolagem"><div class="grade-mes">${DIAS_SEMANA.map(s => `<b class="gm-sem">${s}</b>`).join('')}${corpo}</div></div>
    <p class="small muted mes-rodape"><span>🔥 ${sequencia()} ${sequencia() === 1 ? 'dia seguido' : 'dias seguidos'}</span><span>✓ ${metas} ${metas === 1 ? 'meta batida' : 'metas batidas'} em ${nomeMes}</span><span>✍️ ${reds} ${reds === 1 ? 'redação' : 'redações'} · 📝 ${sims} ${sims === 1 ? 'simulado' : 'simulados'} no mês</span></p>`;
}
function cardSemanaMes(p) {
  const v = vistaCrono();
  const nomeMes = new Date().toLocaleDateString('pt-BR', { month: 'long' });
  return `<section class="card" id="card-vista">
    <div class="vista-topo">
      <div><h2>${v === 'mes' ? nomeMes[0].toUpperCase() + nomeMes.slice(1) : 'Esta semana'}</h2>
        <span class="small muted">${v === 'mes' ? 'O mês inteiro: metas batidas, redações e simulados' : '<a href="#/ajustes">Mudar dias e metas</a>'}</span></div>
      <div class="seg"><button type="button" data-vista="semana" class="${v === 'semana' ? 'on' : ''}">Semana</button><button type="button" data-vista="mes" class="${v === 'mes' ? 'on' : ''}">Mês</button></div>
    </div>
    ${v === 'mes' ? mesHTML(p) : semanaGradeHTML(p)}
  </section>`;
}
// até o ENEM: um quadrado por semana, da semana em que você começou até a da prova
function semanasAteProvaHTML(p) {
  const h = hoje(), prova = st.cfg.prova;
  if (p.diasProva <= 0) return '';
  const primeira = Object.keys(st.log).sort()[0] || h;
  const ini = somaDias(primeira, -diaSemana(primeira));
  const atual = Math.floor(diffDias(ini, h) / 7);
  const total = Math.min(160, Math.floor(diffDias(ini, prova) / 7) + 1);
  const fb = fimBase(p.fimNovas);
  const quad = [];
  for (let i = 0; i < total; i++) {
    const a = somaDias(ini, i * 7), b = somaDias(a, 6);
    if (i < atual) {
      let estudou = false;
      for (let d = a; d <= b; d = somaDias(d, 1)) if (st.log[d] && st.log[d].n + st.log[d].r > 0) { estudou = true; break; }
      quad.push(`<i class="${estudou ? 'sq-feita' : 'sq-vazia'}" title="Semana de ${fmtCurto(a)}${estudou ? ': estudou' : ''}"></i>`);
    } else quad.push(`<i class="sq-${i === atual ? 'atual' : faseDe(a, p.fimNovas)}" title="Semana de ${fmtCurto(a)} · ${NOME_FASE[faseDe(a, p.fimNovas)]}"></i>`);
  }
  const fases = [['base', 'Base', h, fb], ['ritmo', 'Ritmo', fb, p.fimNovas], ['reta', 'Reta', p.fimNovas, prova]]
    .map(([k, nome, a, b]) => [k, nome, a < h ? h : a, b]).filter(([, , a, b]) => b > a);
  const mesAno = d => parse(d).toLocaleDateString('pt-BR', { month: 'short' }).replace('.', '');
  return `<section class="card">
    <div class="titulo-linha"><h2>Até o ENEM</h2><span class="small muted">${fmt(prova)}</span></div>
    <p class="small muted" style="margin:0 0 14px">Cada quadrado é uma semana. Você está na ${atual + 1}ª de ${total}.</p>
    <div class="semanas-sq">${quad.join('')}</div>
    <div class="fases-sq" style="grid-template-columns:${fases.map(([, , a, b]) => `${Math.max(1, diffDias(a, b))}fr`).join(' ')}">
      ${fases.map(([k, nome, a, b]) => `<div class="fq-${k}"><b>${nome}</b><span>${k === 'reta' ? '' : `até ${mesAno(b)}`}</span></div>`).join('')}
    </div>
  </section>`;
}

// o que já foi feito hoje e o que falta para "fechar o dia" (novas da meta + revisões vencidas)
function diaHoje(p = plano()) {
  const lg = st.log[hoje()] || { n: 0, r: 0, ok: 0 };
  const novasFaltam = p.retaFinal ? 0 : Math.max(0, p.meta - p.novasHoje);
  const revFaltam = p.vencidas;
  return { novas: lg.n, revs: lg.r, total: lg.n + lg.r, novasFaltam, revFaltam, faltam: novasFaltam + revFaltam };
}
function textoFalta(f) {
  const partes = [];
  if (f.novasFaltam) partes.push(`${f.novasFaltam} ${f.novasFaltam === 1 ? 'nova' : 'novas'}`);
  if (f.revFaltam) partes.push(`${f.revFaltam} ${f.revFaltam === 1 ? 'revisão' : 'revisões'}`);
  return partes.join(' e ');
}
// ---------- tela de questão
function telaEstudar() {
  const s = st.sessao;
  if (!s || !s.itens.length) { location.hash = '#/'; return; }
  if (s.i >= s.itens.length) return telaFimSessao();
  // confere o bloco antes de mostrar: tira questões que deixaram de valer
  if (!s.avulsa && !s.res[s.i]) { podar(s); salvar(); if (s.i >= s.itens.length) return telaFimSessao(); }
  const item = s.itens[s.i];
  const q = BYID[item.id];
  if (!q) { s.i++; salvar(); return telaEstudar(); }
  const res = s.res[s.i];
  const r = reg(q.id);
  const inicio = Date.now();

  const rotulo = item.tipo === 'rev'
    ? `<span class="chip tag-rev">↺ Revisão · caixa ${r?.caixa || 1}</span>`
    : item.tipo === 'pratica' ? '<span class="chip">Prática</span>'
    : item.ref ? '<span class="chip tag-foco" title="Questão nova do mesmo assunto de uma que você errou">🧩 Reforço do erro</span>'
    : item.foco ? '<span class="chip tag-foco" title="Questão de um dos seus temas mais fracos">🎯 Reforço</span>'
    : item.tr === 'foco' ? `<span class="chip tag-trilha" title="Tema em foco: ${esc(rotuloTema(temaDe(q.id)))}">📚 Foco</span>`
    : item.tr === 'passada' ? '<span class="chip tag-trilha" title="Questão nova de um tema que já passou pelo foco">↩ Tema passado</span>' : '<span class="chip">Nova</span>';
  // voltar para a questão anterior do bloco: só para rever — a resposta já registrada não muda
  const anterior = !s.avulsa && s.i > 0 ? '<button class="btn fantasma" id="btn-ant" title="Rever a questão anterior (a resposta não muda) · tecla ←" aria-label="Questão anterior">←</button>' : '';

  $app.innerHTML = `
    <div class="q-prog"><i style="width:${pct(s.i, s.itens.length)}%"></i></div>
    <div class="q-topo">
      <div class="info">${chipArea(q.area)} ${rotulo}${res ? ' <span class="chip" title="Você já respondeu: dá para rever, não para mudar">🔒 Respondida</span>' : ''}</div>
      <div class="info"><span class="timer" id="timer">0:00</span>
        <span class="small muted">${s.avulsa ? '' : `${s.i + 1}/${s.itens.length}`}</span>
        <a class="btn mini" href="${s.de && s.de !== '#/estudar' ? s.de : '#/'}" title="Sair (o bloco fica salvo)">Sair</a></div>
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
          ${anterior}
          <button class="btn fantasma" data-acao="pular" title="Pular (ela volta outro dia)">Pular</button>
          <button class="btn fantasma" id="btn-dica">💡 Ver como fazer</button>
        </span>
        <button class="btn primario" id="btn-conf" disabled title="Escolha uma letra primeiro">Responder</button>
      </div>
    </div>
  `;
  ligarTamanho(q.id, (r?.h?.length || 0) - (res && !res.pulou ? 1 : 0));
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
    const ok = registrar(q.id, item.tipo, letra, seg, !!item.ajuda && letra !== '?', item.ref);
    s.res[s.i] = { letra, ok, seg };
    salvar();
    mostrarFeedback();
    // com uma imagem grande o resultado fica fora da tela: desce até ele (descontando o cabeçalho fixo)
    const fbEl = document.querySelector('#feedback .feedback');
    if (fbEl) {
      const topo = document.querySelector('.topo')?.offsetHeight || 0;
      const y = Math.max(0, fbEl.getBoundingClientRect().top + window.scrollY - topo - 12);
      const de = window.scrollY;
      window.scrollTo({ top: y, behavior: 'smooth' });
      // alguns navegadores ignoram a rolagem suave: se nada se mexeu, pula direto
      setTimeout(() => { if (window.scrollY === de && Math.abs(y - de) > 4) window.scrollTo(0, y); }, 400);
    }
  };
  const proxima = () => { s.i++; salvar(); window.scrollTo(0, 0); rota(); };
  const voltar = () => { if (s.avulsa || s.i <= 0) return; s.i--; salvar(); window.scrollTo(0, 0); rota(); };
  document.getElementById('acoes').addEventListener('click', e => { if (e.target.closest('#btn-ant')) voltar(); });

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
    // anotação escrita numa tentativa anterior: fica guardada, fechada, e a caixa começa vazia
    const notaAntiga = !!reg2.nota && reg2.notaK !== reg2.h.length - 1;
    // quando ela volta e o que acontece até lá
    const volta = reg2.prox ? `em ${dias(diffDias(hoje(), reg2.prox))}` : '';
    const ate = item.ref ? '' : ' Até lá, o reforço traz uma questão nova do mesmo tema.';
    if (naoSei) {
      estado = `Sem problema — ela foi para o caderno de erros. Veja a resolução agora e tente sozinho quando ela voltar, ${volta}.${ate}`;
    } else if (comAjuda) {
      estado = `Como você viu como fazer, ela volta ${volta} para você refazer sozinho.${ate}`;
    } else if (foiChute) {
      estado = `Marcada como chute: vai para o caderno de erros e volta ${volta}.${ate}`;
    } else if (item.tipo === 'rev') {
      estado = rr.ok
        ? (reg2.s === 'rec' ? 'Recuperada! Essa saiu do caderno de erros. 🎉' : `Subiu para a caixa ${reg2.caixa}: próxima revisão ${volta}.`)
        : `Voltou para a caixa 1: revisa de novo ${volta}.${ate}`;
    } else if (!rr.ok) estado = `Foi para o caderno de erros: volta ${volta}, quando você já não lembra a alternativa.${ate}`;
    const fb = document.getElementById('feedback');
    fb.innerHTML = `
      <div class="feedback ${rr.ok ? 'ok' : naoSei ? 'neutro' : 'erro'}">
        <h2>${rr.ok ? (comAjuda ? 'Acertou, com ajuda' : 'Mandou bem!') : naoSei ? `A resposta é ${q.resp}` : `A certa é a ${q.resp}`}${naoSei ? '' : lento}</h2>
        <p class="fb-xp">+${rr.ok ? XP.acerto : XP.erro} XP</p>
        ${estado ? `<p style="margin:0">${estado}</p>` : ''}
        ${temaDe(q.id) ? `<p class="small muted" style="margin:6px 0 0">Tema: ${esc(rotuloTema(temaDe(q.id)))}</p>` : ''}
        ${rr.ok && !comAjuda && item.tipo !== 'pratica' ? `<label style="display:flex;gap:8px;align-items:center;margin-top:8px"><input type="checkbox" id="chute" ${reg2.h[reg2.h.length - 1][4] ? 'checked' : ''}> Foi chute / não tinha certeza (mandar para revisão)</label>` : ''}
      </div>
      <section class="card">
        <div class="linha-btns" style="margin-top:0">
          <button class="btn" id="btn-exp">💡 Por que é ${q.resp}?</button>
          <a class="btn" href="${esc(linkVideo(q))}" target="_blank" rel="noopener">▶ Resolução no YouTube</a>
          ${botaoAulaTema(q)}
        </div>
        <div id="exp" class="explicacao" style="margin-top:12px"></div>
        <details style="margin-top:8px"><summary class="small muted">Salvar um vídeo específico para esta questão</summary>
          <input type="url" id="video" placeholder="https://www.youtube.com/watch?v=..." value="${esc(reg2.video || '')}" style="margin-top:6px">
        </details>
      </section>
      ${!rr.ok || comAjuda || foiChute ? `
      <section class="card">
        <h3>${naoSei ? 'O que faltou?' : 'Por que errei?'}</h3>
        ${notaAntiga ? `<details class="small" style="margin-bottom:8px"><summary class="muted">Sua anotação da vez passada</summary><p style="margin:6px 0 0">${esc(reg2.nota)}</p></details>` : ''}
        <div class="motivos">${MOTIVOS.map(m => `<button data-m="${esc(m)}" class="${reg2.motivo === m ? 'on' : ''}">${esc(m)}</button>`).join('')}</div>
        <label class="campo" for="nota">Anotação para a revisão (opcional)</label>
        <textarea id="nota" placeholder="Ex.: confundi mitose com meiose; lembrar que…">${notaAntiga ? '' : esc(reg2.nota || '')}</textarea>
      </section>` : ''}
    `;
    document.getElementById('acoes').innerHTML = `${anterior}<button class="btn primario" id="btn-prox">${s.i + 1 < s.itens.length ? 'Continuar' : 'Concluir'}</button>`;
    $app.querySelector('.respostas')?.classList.add(rr.ok && !comAjuda ? 'certo' : naoSei ? 'neutro' : 'errado');   // a barra fica verde ou vermelha
    document.getElementById('dica').innerHTML = '';
    document.getElementById('btn-prox').addEventListener('click', proxima);
    document.getElementById('chute')?.addEventListener('change', e => { marcarChute(q.id, e.target.checked, item.ref); mostrarFeedback(); });
    document.getElementById('btn-exp').addEventListener('click', () => { rr.exp = 1; salvar(); explicar(q, rr.letra, document.getElementById('exp')); });
    document.getElementById('video').addEventListener('change', e => { reg(q.id).video = e.target.value.trim(); salvar(); });
    fb.querySelectorAll('[data-m]').forEach(b => b.addEventListener('click', () => {
      const r3 = reg(q.id);
      r3.motivo = r3.motivo === b.dataset.m ? undefined : b.dataset.m;
      salvar();
      fb.querySelectorAll('[data-m]').forEach(x => x.classList.toggle('on', x.dataset.m === r3.motivo));
    }));
    document.getElementById('nota')?.addEventListener('input', e => {
      const r5 = reg(q.id);
      if (e.target.value.trim()) { r5.nota = e.target.value; r5.notaK = r5.h.length - 1; } else if (r5.notaK === r5.h.length - 1) { delete r5.nota; delete r5.notaK; }
      salvar();
    });
    if (rr.exp && explicacoes[chaveExp(q.id, rr.letra)]) document.getElementById('exp').innerHTML = `<p>${md(explicacoes[chaveExp(q.id, rr.letra)])}</p>`;
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
          ${botaoAulaTema(q)}
          <button class="btn" id="btn-ver-resp">Ver a resposta</button>
        </div>
        <p class="small muted" style="margin-bottom:0">Você ainda pode responder. Como pediu ajuda, ela vai para o caderno de erros e volta daqui a alguns dias para você refazer sozinho.</p>
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
    if (tinta[q.id]) { delete tinta[q.id]; salvarTinta(); }
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
    } else if (e.key === 'ArrowLeft') {
      voltar();
    } else if (e.key === 'ArrowRight') {
      document.getElementById('btn-prox')?.click();
    }
  };
  document.addEventListener('keydown', teclas);
  aoSair(() => document.removeEventListener('keydown', teclas));

  if (res) { clearInterval(timer); mostrarFeedback(); }
}

function telaFimSessao() {
  const s = st.sessao;
  const total = s.res.filter(Boolean).length;
  const acertos = s.res.filter(r => r && r.ok).length;
  const erros = s.itens.filter((it, k) => s.res[k] && !s.res[k].ok);
  if (s.avulsa) {
    st.sessao = s.volta;
    salvar();
    const alvo = s.volta ? '#/estudar' : '#/erros';
    if (location.hash === alvo) rota(); else location.hash = alvo;
    return;
  }
  const tipo = tipoDe(s);
  const daMeta = tipo === 'novas' && !s.extra;
  const falta = daMeta ? faltaMeta() : 0;
  // a próxima tarefa do cronograma de hoje que ainda falta (fora a deste bloco, que já tem o botão "mais")
  const p = plano();
  const prox = agendaHoje(p, diaHoje(p)).find(x => !x.opcional && !x.feito && x.botao?.ir
    && x.id !== tipo);
  const temMais = tipo !== 'reforco' || reforcosPendentes().length > 0;
  const outros = blocosAbertos().filter(x => x !== s && !(prox && chaveDe(x) === prox.id));
  const voltar = s.de && s.de !== '#/estudar' ? s.de : '#/';
  const segBloco = s.res.reduce((t, r) => t + (r ? Math.min(r.seg || 0, 600) : 0), 0);
  const xpBloco = acertos * XP.acerto + (total - acertos) * XP.erro;
  const comemora = total > 0 && (pct(acertos, total) >= 60 || (daMeta && !falta));
  $app.innerHTML = `
    <section class="fim-bloco">
      ${comemora ? `<div class="confete" aria-hidden="true">${Array.from({ length: 46 }, (_, i) => `<i style="left:${(i * 37) % 100}%;width:${10 + (i % 3) * 4}px;border-radius:${i % 2 ? 3 : 7}px;background:${['#1877e0', '#23a047', '#f59a1b', '#8f52e8', '#ffc531', '#e0468f'][i % 6]};animation-duration:${(2.4 + (i % 7) * 0.35).toFixed(2)}s;animation-delay:${((i % 9) * 0.18).toFixed(2)}s"></i>`).join('')}</div>` : ''}
      <div class="fim-emoji">${!total ? '🙂' : comemora ? '🎉' : '💪'}</div>
      <h1>${tipo === 'rev' ? 'Revisões concluídas!' : tipo === 'reforco' ? 'Reforço concluído!' : daMeta && !falta ? 'Meta de hoje batida!' : 'Bloco completo!'}</h1>
      <p class="fim-sub">${total ? (daMeta ? (falta ? `Faltam ${falta} para a meta de hoje.` : 'Daqui pra frente é extra — e adianta o cronograma.') : comemora ? 'Mandou muito.' : 'Cada erro agora é uma questão a menos pra errar na prova.') : 'Nenhuma questão respondida.'}</p>
      ${total ? `<div class="fim-caixas">
        <div class="cor-ouro"><b>XP ganho</b><span>⚡ ${xpBloco}</span></div>
        <div class="cor-verde"><b>Acerto</b><span>🎯 ${pct(acertos, total)}%</span></div>
        <div class="cor-azul"><b>Tempo</b><span>⏱ ${fmtTempo(segBloco)}</span></div>
      </div>
      <p class="small muted" style="margin:0">${acertos} de ${total} certas</p>` : ''}
      ${marcoDoBloco(total)}
      <div class="linha-btns" style="justify-content:center">
        ${prox ? `<button class="btn primario" data-acao="prox">Próxima tarefa: ${esc(prox.titulo)} →</button>` : ''}
        ${outros.length ? `<button class="btn ${prox ? '' : 'primario'}" data-acao="outro">Continuar ${NOME_BLOCO[chaveDe(outros[0])]} (${outros[0].i + 1}/${outros[0].itens.length})</button>` : ''}
        ${temMais ? `<button class="btn ${outros.length || prox ? '' : 'primario'}" data-acao="mais">${tipo === 'rev' ? 'Mais revisões' : tipo === 'reforco' ? 'Mais reforço' : daMeta ? (falta ? `Fazer as ${falta} que faltam` : `Fazer ${st.cfg.bloco} extras`) : `Mais ${st.cfg.bloco}`}</button>` : ''}
        <a class="btn ${outros.length || prox || temMais ? '' : 'primario'}" href="${voltar}">Voltar</a>
      </div>
    </section>
    ${erros.length ? `<section class="card"><h2>Erradas neste bloco</h2><p class="small muted">Elas vão para o caderno de erros e voltam daqui a 1–2 semanas, quando você já não lembra a alternativa que marcou.${tipo === 'reforco' ? '' : ' Até lá, o <b>reforço dos erros</b> traz uma questão nova do mesmo tema para cada uma.'}</p><ul class="lista">
      ${erros.map(it => { const q = BYID[it.id]; return `<li><div>${chipArea(q.area)} <span class="tit">${tituloQ(q)}</span></div><button class="btn" data-ver="${q.id}">Rever</button></li>`; }).join('')}
    </ul></section>` : ''}
  `;
  $app.querySelector('[data-acao=mais]')?.addEventListener('click', () => (daMeta
    ? (falta ? iniciar(falta, 'novas') : iniciar(st.cfg.bloco, 'novas', null, { extra: true }))
    : iniciar(st.cfg.bloco, tipo, s.alvo, { extra: !!s.extra })));
  $app.querySelector('[data-acao=prox]')?.addEventListener('click', () => prox.botao.ir());
  $app.querySelector('[data-acao=outro]')?.addEventListener('click', () => retomar(chaveDe(outros[0])));
  $app.querySelectorAll('[data-ver]').forEach(b => b.addEventListener('click', () => { location.hash = '#/ver/' + b.dataset.ver; }));
}

// visualizar uma questão já respondida (sem registrar nova tentativa)
function verQuestao(id) {
  const q = BYID[id];
  const r = reg(id);
  const ultR = r?.h?.[r.h.length - 1];
  const expUlt = explicacoes[chaveExp(id, ultR?.[1])] || explicacoes[id];
  $app.innerHTML = `
    <p><a href="javascript:history.back()">← Voltar</a></p>
    <div class="q-topo"><div class="info">${chipArea(q.area)}</div></div>
    <div class="q-titulo"><h2>${tituloQ(q)} — resposta: ${q.resp}</h2>${controlesTamanho()}</div>
    <div class="questao-img">${imgsHTML(q)}</div>
    <section class="card">
      <div class="linha-btns" style="margin-top:0">
        <button class="btn" id="btn-exp">💡 Por que é ${q.resp}?</button>
        <a class="btn" href="${esc(linkVideo(q))}" target="_blank" rel="noopener">▶ Resolução no YouTube</a>
          ${botaoAulaTema(q)}
        ${linkProva(q) ? `<a class="btn" href="${linkProva(q)}" target="_blank" rel="noopener">📄 Prova original</a>` : ''}
      </div>
      <div id="exp" class="explicacao" style="margin-top:12px">${expUlt ? `<p>${md(expUlt)}</p>` : ''}</div>
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
  const adiantar = adiantaveis();
  const rec = POOL().filter(q => reg(q.id)?.s === 'rec').length;
  const h = hoje();
  const tam = st.cfg.bloco;
  let msg;
  if (venc.length) msg = `Você tem <b>${venc.length} ${venc.length === 1 ? 'questão' : 'questões'}</b> para refazer hoje.`;
  else if (todas.length && !adiantar.length) msg = 'Nada vence hoje, e as que você errou há pouco ainda estão esperando — com a alternativa fresca na memória, refazer não conta. Enquanto isso, faça o reforço dos erros.';
  else if (todas.length) {
    const d = diffDias(h, reg(todas[0].id).prox);
    msg = `Nada vence hoje. A próxima revisão é ${d === 1 ? 'amanhã' : `em ${dias(d)}`} — se quiser, adiante (só as que já passaram da metade da espera).`;
  } else msg = 'Seu caderno de erros está vazio. Quando você errar ou pedir ajuda numa questão, ela aparece aqui.';
  let semana = '<div class="semana">';
  for (let k = 0; k < 7; k++) {
    const d = somaDias(h, k);
    const n = todas.filter(q => (k === 0 ? reg(q.id).prox <= d : reg(q.id).prox === d)).length;
    semana += `<div class="${k === 0 ? 'hoje' : ''}">${k === 0 ? 'Hoje' : DIAS_SEMANA[diaSemana(d)]}<b>${n || '·'}</b></div>`;
  }
  semana += '</div>';
  const n1 = Math.min(venc.length, tam);
  const revAberta = sessaoDe('rev');
  // as 4 caixas e as recuperadas, em colunas (a altura acompanha a quantidade)
  const porCaixa = [1, 2, 3, 4].map(c => todas.filter(q => (reg(q.id).caixa || 1) === c).length);
  const colunas = [
    ...porCaixa.map((n, i) => ({ n, nome: `Caixa ${i + 1}`, sub: i === 0 ? 'volta em 7–14 dias' : `${INTERVALOS.exa[i + 1]}–${INTERVALOS.hum[i + 1]} dias`.replace('30–30', '30').replace('45–45', '45'), cor: ['verm', 'laranja', 'ouro', 'azul'][i] })),
    { n: rec, nome: 'Recuperadas', sub: 'saíram do caderno', cor: 'verde' },
  ];
  const maior = Math.max(1, ...colunas.map(c => c.n));
  const caixasHTML = todas.length || rec ? `<section class="card"><div class="caixas">${colunas.map(c => `<div class="caixa cor-${c.cor}">
      <b class="caixa-n">${c.n}</b><div class="caixa-col" style="height:${Math.round(24 + 96 * c.n / maior)}px"></div>
      <b class="caixa-nome">${c.nome}</b><span>${c.sub}</span></div>`).join('')}</div></section>` : '';
  $app.innerHTML = `
    <div class="titulo-tela"><div><h1>Caderno de erros</h1>
      <p class="muted" style="margin:0">Cada acerto numa revisão sobe a questão uma caixa. Passou da 4ª, recuperou.</p></div>
      ${venc.length && !revAberta ? `<button class="btn btn-laranja" data-acao="rev-topo">Revisar ${venc.length} ${venc.length === 1 ? 'vencida' : 'vencidas'}</button>` : ''}</div>
    ${caixasHTML}
    <section class="card destaque">
      <h2>Refazer agora</h2>
      <p>${msg}</p>
      ${revAberta ? `<div class="linha-btns"><button class="btn primario grande" data-acao="cont-rev">Continuar correção (${revAberta.i + 1}/${revAberta.itens.length})</button></div>` : ''}
      ${venc.length || adiantar.length ? `
      <div class="linha-btns">
        ${revAberta ? '' : `<button class="btn primario grande" data-acao="bloco">${venc.length ? `Refazer ${n1} ${n1 === 1 ? 'questão' : 'questões'}` : `Adiantar ${Math.min(adiantar.length, tam)} revisões`}</button>`}
      </div>
      <div class="linha-btns"><button class="btn" data-acao="rapido">⚡ Só 5 rapidinhas</button></div>
      <p class="small muted" style="margin-bottom:0">Acertou → volta em 3, 7 e 21 dias. Acertou 4 vezes seguidas → sai do caderno.</p>` : ''}
    </section>
    ${cardPontosErros()}
    <section class="card">
      <h2>Próximos dias</h2>
      ${semana}
    </section>
  `;
  ligarTreinar();
  $app.querySelector('[data-acao=bloco]')?.addEventListener('click', () => iniciar(tam, 'rev'));
  $app.querySelector('[data-acao=rev-topo]')?.addEventListener('click', () => iniciar(tam, 'rev'));
  $app.querySelector('[data-acao=cont-rev]')?.addEventListener('click', () => retomar('rev'));
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
  $app.innerHTML = `<p><a href="#/erros">← Caderno de erros</a></p><h1>Pontos fracos</h1><p class="muted">${an.n} questões feitas · ${Math.round(an.media * 100)}% de acerto de primeira</p>${corpo}`;
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
    && (c.origem === 'todas' ? !respondidaHoje(q.id) : c.origem === 'erros' ? reg(q.id)?.s === 'rev' && !respondidaHoje(q.id) : !feita(q.id)));
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
  ligarTamanho(q.id, reg(q.id)?.h?.length || 0);
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

// desempenho por dia da semana nas últimas 8 semanas
function porDiaSemanaHTML() {
  const h = hoje();
  const P = pesos();
  const lin = DIAS_SEMANA.map((nome, k) => ({ nome, k, dias: 0, tot: 0, ok: 0, metas: 0, bateu: 0 }));
  for (let i = 0; i < 56; i++) {
    const d = somaDias(h, -i);
    const lg = st.log[d];
    const x = lin[diaSemana(d)];
    if (!lg) continue;
    const t = lg.n + lg.r;
    if (t) { x.dias++; x.tot += t; x.ok += lg.ok; }
    if (lg.m) { x.metas++; if (lg.n >= lg.m) x.bateu++; }
  }
  const max = Math.max(1, ...lin.map(x => (x.dias ? x.tot / x.dias : 0)));
  return `<table class="tabela-dias"><tr><th></th><th>Ritmo</th><th>Estudou</th><th>Média/dia</th><th>Acerto</th><th>Metas</th></tr>
    ${lin.map(x => { const media = x.dias ? Math.round(x.tot / x.dias) : 0; return `<tr class="${x.k === diaSemana(h) ? 'hoje' : ''}">
      <th>${x.nome}</th><td class="muted">${nomeNivel(P[x.k])}</td><td>${x.dias}/8</td>
      <td><span class="barrinha"><i style="width:${(100 * media) / max}%"></i></span> ${media || '–'}</td>
      <td>${x.tot ? pct(x.ok, x.tot) + '%' : '–'}</td><td>${x.metas ? `${x.bateu}/${x.metas}` : '–'}</td></tr>`; }).join('')}
  </table>`;
}

// ---------- progresso
// ---------- números grandes: tudo o que já foi feito, contado desde a primeira questão (inclusive antes deste card existir)
const MARCOS = [10, 50, 100, 250, 500, 750, 1000, 1500, 2000, 2500, 3000, 4000, 5000, 6000, 7500, 10000, 12500, 15000, 20000, 25000, 30000, 40000, 50000];
function proximoMarco(n) { return MARCOS.find(m => m > n) || (Math.floor(n / 10000) + 1) * 10000; }
function marcoAnterior(n) { return [...MARCOS].reverse().find(m => m <= n) || 0; }
function totalRespondidas() { let n = 0; for (const r of Object.values(st.q)) n += r.h?.length || 0; return n; }
function numerosGrandes() {
  let n = 0, ok = 0, seg = 0, desde = null;
  const primeiras = [];   // 1ª tentativa de cada questão: [data, acertou de primeira, segundos]
  for (const r of Object.values(st.q)) {
    for (const x of r.h || []) {
      n++;
      if (x[2] === 1) ok++;
      seg += Math.min(x[3] || 0, 600);   // até 10 min por questão: app aberto e esquecido não conta como estudo
      if (!desde || x[0] < desde) desde = x[0];
    }
    const p = r.h?.[0];
    if (p) primeiras.push([p[0], p[2] === 1 && !p[4], p[3] || 0]);
  }
  // antes × agora: as primeiras questões novas contra as mais recentes (até 100 de cada lado, sem sobrepor)
  primeiras.sort((a, b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0);
  let evolucao = null;
  if (primeiras.length >= 40) {
    const k = Math.min(100, Math.floor(primeiras.length / 2));
    const resumo = xs => {
      const t = xs.filter(x => x[2] > 0 && x[2] <= 600);
      return { acerto: pct(xs.filter(x => x[1]).length, xs.length), seg: t.length >= xs.length / 2 ? t.reduce((s, x) => s + x[2], 0) / t.length : 0 };
    };
    evolucao = { k, antes: resumo(primeiras.slice(0, k)), agora: resumo(primeiras.slice(-k)) };
  }
  const redacoes = (red.cont?.n || 0) + (red.feitas?.length || 0);
  return { n, ok, seg, desde, evolucao, redacoes, palavras: red.cont?.palavras || 0 };
}
function fmtHoras(seg) {
  const m = Math.round(seg / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  return h < 10 && m % 60 ? `${h} h ${m % 60} min` : `${h.toLocaleString('pt-BR')} h`;
}
const milhar = n => Math.round(n).toLocaleString('pt-BR');
function cardNumerosGrandes() {
  const g = numerosGrandes();
  if (!g.n) return `<section class="card ng"><div class="ng-num">0</div><div class="ng-rot">questões respondidas</div>
    <p class="small muted" style="margin:8px 0 0">Responda a primeira e este número começa a crescer — cada revisão e cada simulado contam.</p></section>`;
  const prox = proximoMarco(g.n), ant = marcoAnterior(g.n);
  const enem = g.n / 180;
  const ev = g.evolucao;
  const seta = (a, b, maiorMelhor) => (maiorMelhor ? b > a : b < a) ? 'ng-sobe' : b === a ? '' : 'ng-desce';
  return `
    <section class="card ng">
      <div class="ng-num" data-conta="${g.n}">${milhar(g.n)}</div>
      <div class="ng-rot">questões respondidas${g.desde ? ` desde ${fmt(g.desde)}` : ''}</div>
      <div class="ng-marco">
        <div class="barra"><i style="width:${pct(g.n - ant, prox - ant)}%;background:var(--azul)"></i></div>
        <span class="small muted">faltam <b>${milhar(prox - g.n)}</b> para ${milhar(prox)}</span>
      </div>
      <div class="grid2 ng-grid">
        <div class="stat"><b>${fmtHoras(g.seg)}</b><span>resolvendo questões</span></div>
        <div class="stat"><b>${milhar(g.ok)}</b><span>acertos</span></div>
        <div class="stat"><b>${enem >= 10 ? milhar(enem) : enem.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}</b><span>${enem >= 1 && enem < 2 ? 'ENEM inteiro' : 'ENEMs inteiros'} (180 questões cada)</span></div>
        <div class="stat"><b>${g.palavras ? milhar(g.palavras) : g.redacoes}</b><span>${g.palavras ? `palavras em ${g.redacoes} ${g.redacoes === 1 ? 'redação' : 'redações'}` : g.redacoes === 1 ? 'redação' : 'redações'}</span></div>
      </div>
      ${ev ? `<div class="ng-ev">
        <div class="small muted">Suas ${ev.k} primeiras questões novas → as ${ev.k} mais recentes</div>
        <div class="ng-ev-linha"><span>Acerto de primeira</span><b>${ev.antes.acerto}% → <span class="${seta(ev.antes.acerto, ev.agora.acerto, true)}">${ev.agora.acerto}%</span></b></div>
        ${ev.antes.seg && ev.agora.seg ? `<div class="ng-ev-linha"><span>Tempo por questão</span><b>${fmtTempo(ev.antes.seg)} → <span class="${seta(Math.round(ev.antes.seg), Math.round(ev.agora.seg), false)}">${fmtTempo(ev.agora.seg)}</span></b></div>` : ''}
      </div>` : ''}
    </section>`;
}
// fim de bloco: avisa quando o bloco cruzou um marco (100, 250, 500, 1.000…)
function marcoDoBloco(noBloco) {
  const agora = totalRespondidas(), antes = agora - noBloco;
  const m = marcoAnterior(agora);
  if (!noBloco || m < 50 || antes >= m) return '';
  return `<p class="marco-bloco">🎉 Você passou de <b>${milhar(m)}</b> questões respondidas! <a href="#/progresso">Ver progresso</a></p>`;
}
// o número grande sobe de 0 até o total ao abrir a tela
function animarContagem(el) {
  const fim = +el.dataset.conta;
  if (!fim || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const dur = 1100, t0 = performance.now();
  const passo = t => {
    if (!el.isConnected) return;
    const p = Math.min(1, (t - t0) / dur);
    el.textContent = milhar(fim * (1 - (1 - p) ** 3));
    if (p < 1) requestAnimationFrame(passo);
  };
  el.textContent = '0';
  requestAnimationFrame(passo);
}

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
    ${cardNumerosGrandes()}
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
      <h2>Por dia da semana</h2>
      <p class="small muted">Últimas 8 semanas.</p>
      ${porDiaSemanaHTML()}
    </section>
    <section class="card">
      <h2>Últimas 12 semanas</h2>
      <div class="calor">${calor}</div>
    </section>
  `;
  const num = $app.querySelector('.ng-num[data-conta]');
  if (num) animarContagem(num);
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
      <label class="campo">Meta de cada dia da semana</label>
      <p class="small muted" style="margin:0 0 8px">Toque num dia para mudar: Folga → Leve (½) → Normal → Puxado (1½×) → Forte (2×). A meta de cada dia é proporcional.</p>
      <div class="pesos" id="pesos"></div>
      <label class="campo" for="bloco">Tamanho do bloco</label>
      <select id="bloco">${[5, 10, 15, 20, 30].map(n => `<option value="${n}" ${c.bloco === n ? 'selected' : ''}>${n} questões (~${n * 3} min)</option>`).join('')}</select>
      <div class="dias" style="margin-top:12px"><label><input type="checkbox" id="red-crono" ${c.redacao !== false ? 'checked' : ''}> ✍️ Redação no cronograma</label></div>
      <label class="campo" for="aulas-dia">📺 Videoaulas no cronograma</label>
      <select id="aulas-dia">${[[0, 'Desligado'], [1, '1 aula por dia (antes das questões novas)'], [2, '2 aulas por dia']].map(([n, t]) => `<option value="${n}" ${aulasPorDia() === n ? 'selected' : ''}>${t}</option>`).join('')}</select>
      <p class="small muted">A aula é do tema cujas questões vêm a seguir na trilha de focos (primeiro a 1ª aula de cada tema novo), alternando com a matemática básica. Dá para pular uma aula e ver todas na aba <a href="#/aulas">Aulas</a>.</p>
      <div class="dias" style="margin-top:12px"><label><input type="checkbox" id="sim-crono" ${c.simCrono !== false ? 'checked' : ''}> 📝 Simulados no cronograma</label></div>
      <p class="small muted">Ligado: um simulado curto por semana (de 10 a 30 questões, crescendo com a fase), alternando um misto e um desafio numa matéria em que você tem dificuldade. Ele ocupa o lugar das questões novas do dia.</p>
      <label class="campo" for="meta-acerto">Alvo de acerto por área (“bom desempenho”)</label>
      <select id="meta-acerto">${[60, 65, 70, 75, 80, 85].map(n => `<option value="${n}" ${(c.metaAcerto || 70) === n ? 'selected' : ''}>${n}% de acerto de primeira</option>`).join('')}</select>
      <p class="small muted">Ligado (redação): as redações necessárias para tirar 900+ nos temas de todos os ENEM desde 2011 em até 1 ano (Desafio dos anos, ~2 por mês no começo), no lugar das questões do dia; +1 por mês se você estiver adiantado; dia híbrido (redação + metade da meta) se estiver atrasado; pelo menos 1 por semana na reta final.</p>
    </section>
    <section class="card">
      <h2>Questões</h2>
      <label class="campo" for="lingua">Língua estrangeira</label>
      <select id="lingua"><option value="ING" ${c.lingua === 'ING' ? 'selected' : ''}>Inglês</option><option value="ESP" ${c.lingua === 'ESP' ? 'selected' : ''}>Espanhol</option></select>
      <label class="campo" for="ordem">Ordem das questões novas</label>
      <select id="ordem">
        <option value="intercalado" ${c.ordem === 'intercalado' ? 'selected' : ''}>Intercalado — uma de cada área por vez${c.trilha !== false ? ', seguindo a trilha de focos' : ', das provas mais recentes às mais antigas'}</option>
        <option value="prova" ${c.ordem === 'prova' ? 'selected' : ''}>Prova por prova — termina 2025 inteira, depois 2024…</option>
      </select>
      <label class="campo">Áreas</label>
      <div class="dias">${ORDEM_AREAS.map(a => `<label><input type="checkbox" data-area="${a}" ${c.areas.includes(a) ? 'checked' : ''}> ${AREAS[a]}</label>`).join('')}</div>
      <p class="small muted">Desmarcar uma área só muda o que aparece nos blocos; o cronograma continua contando todas.</p>
      <div class="dias" style="margin-top:12px"><label><input type="checkbox" id="trilha" ${c.trilha !== false ? 'checked' : ''}> 📚 Trilha de focos</label></div>
      <p class="small muted">Ligado (com a ordem intercalada): cada área tem um tema em foco por vez — 2 de cada 3 questões novas da área vêm dele, a outra de um tema que já passou. O foco usa metade das questões do tema; o resto fica para as revisões (uma a cada 3 temas e um giro só de revisões no fim). Veja no Cronograma, em “Foco do momento”.</p>
      <div class="dias" style="margin-top:12px"><label><input type="checkbox" id="foco" ${c.foco ? 'checked' : ''}> 🎯 Reforçar pontos fracos</label></div>
      <p class="small muted">Ligado: cerca de 1 em cada 3 questões novas dos blocos (1 em cada 6 com a trilha de focos) vem dos seus 3 temas mais fracos (veja em Erros › Onde você mais erra).</p>
    </section>
    <section class="card">
      <h2>Explicações com IA (opcional)</h2>
      <p class="small muted">Os botões “Por que é X?” e “Ver como fazer” mandam a imagem da questão para a IA que você escolher e mostram um resumo curto. Use a sua chave de API: cada explicação custa centavos (ou nada, no plano gratuito do Gemini) e fica salva no app, então só é gerada uma vez. As chaves ficam guardadas só neste navegador.</p>
      <label class="campo" for="ia">Qual IA explica</label>
      <select id="ia">${Object.entries(IAS).map(([k, x]) => `<option value="${k}" ${iaAtual() === k ? 'selected' : ''}>${x.nome}</option>`).join('')}</select>
      <div id="ia-campos"></div>
    </section>
    ${cardConta()}
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
  g('trilha').addEventListener('change', e => { c.trilha = e.target.checked; salvar(); rota(); });
  g('red-crono').addEventListener('change', e => { c.redacao = e.target.checked; if (st.log[hoje()]) delete st.log[hoje()].m; salvar(); });
  g('sim-crono').addEventListener('change', e => { c.simCrono = e.target.checked; if (st.log[hoje()]) delete st.log[hoje()].m; salvar(); });
  g('meta-acerto').addEventListener('change', e => { c.metaAcerto = +e.target.value; salvar(); });
  g('aulas-dia').addEventListener('change', e => { c.aulasDia = +e.target.value; salvar(); });
  const camposIA = () => {
    const k = iaAtual(), x = IAS[k];
    g('ia-campos').innerHTML = `
      <label class="campo" for="ia-chave">Chave da API — ${x.nome}</label>
      <input type="password" id="ia-chave" placeholder="${x.ph}" value="${esc(c[x.chave] || '')}" autocomplete="off">
      <p class="small muted" style="margin:4px 0 0">Crie a chave em <a href="${x.link}" target="_blank" rel="noopener">${x.link.replace('https://', '')}</a>.</p>
      ${x.modelo ? `<label class="campo" for="ia-modelo">Modelo</label>
        <select id="ia-modelo"><option value="${esc(c[x.modelo] || '')}">${esc(c[x.modelo] || 'coloque a chave para ver os modelos')}</option></select>
        <p class="small muted" id="ia-status" style="margin:4px 0 0"></p>`
      : `<p class="small muted" style="margin:6px 0 0">Modelo: ${MODELO}.</p>`}
      <div class="linha-btns"><button class="btn mini" type="button" id="ia-testar">Testar a IA</button></div>
      <div id="ia-teste" class="explicacao" style="margin-top:8px"></div>`;
    g('ia-testar').addEventListener('click', () => {
      if (!c[x.chave]) { g('ia-teste').innerHTML = '<p class="aviso">Coloque a chave primeiro.</p>'; return; }
      testarIA(g('ia-teste'));
    });
    g('ia-chave').addEventListener('change', e => { c[x.chave] = e.target.value.trim(); salvar(); if (x.modelo) carregarModelos(); });
    g('ia-modelo')?.addEventListener('change', e => { c[x.modelo] = e.target.value; salvar(); });
    if (x.modelo && c[x.chave]) carregarModelos();
  };
  const carregarModelos = async () => {
    const k = iaAtual(), x = IAS[k], sel = g('ia-modelo'), status = g('ia-status');
    if (!sel || !c[x.chave]) return;
    status.textContent = 'Conferindo a chave…';
    try {
      const lista = await listarModelos(k, c[x.chave]);
      if (iaAtual() !== k || !g('ia-modelo')) return;
      if (!lista.length) throw new Error('nenhum modelo disponível para essa chave');
      if (!lista.includes(c[x.modelo])) { c[x.modelo] = modeloPadrao(k, lista); salvar(); }
      sel.innerHTML = lista.map(m => `<option value="${esc(m)}" ${m === c[x.modelo] ? 'selected' : ''}>${esc(m)}</option>`).join('');
      status.innerHTML = `✓ Chave funcionando · ${lista.length} modelos`;
    } catch (err) {
      if (g('ia-status')) status.innerHTML = `<span style="color:var(--erro)">${esc(err.message)}</span>`;
    }
  };
  g('ia').addEventListener('change', e => { c.ia = e.target.value; salvar(); camposIA(); });
  camposIA();
  const desenharPesos = () => {
    const P = pesos();
    const pl = plano();
    g('pesos').innerHTML = DIAS_SEMANA.map((d, k) => `<button class="peso n${String(P[k]).replace('.', '_')}" data-peso="${k}">
      <span>${d}</span><b>${P[k] ? Math.ceil(pl.unidade * P[k]) : '–'}</b><small>${nomeNivel(P[k])}</small></button>`).join('');
    g('pesos').querySelectorAll('[data-peso]').forEach(b => b.addEventListener('click', () => {
      const k = +b.dataset.peso;
      const P2 = [...pesos()];
      const i = NIVEIS.findIndex(n => n[0] === P2[k]);
      P2[k] = NIVEIS[(i + 1) % NIVEIS.length][0];
      if (!P2.some(x => x > 0)) P2[k] = 1;   // pelo menos um dia de estudo
      c.pesos = P2;
      c.dias = P2.map((x, j) => (x > 0 ? j : -1)).filter(j => j >= 0);
      // a meta de hoje já registrada vale a nova configuração
      if (st.log[hoje()]) delete st.log[hoje()].m;
      salvar();
      desenharPesos();
    }));
  };
  desenharPesos();
  $app.querySelectorAll('[data-area]').forEach(i => i.addEventListener('change', () => {
    c.areas = [...$app.querySelectorAll('[data-area]:checked')].map(x => x.dataset.area); salvar();
  }));
  $app.querySelector('[data-acao=exportar]').addEventListener('click', baixarBackup);
  g('importar').addEventListener('change', async e => {
    const f = e.target.files[0];
    if (!f) return;
    try {
      const d = JSON.parse(await f.text());
      if (!d.estado || !d.estado.q) throw new Error('arquivo inválido');
      if (!confirm('Substituir o progresso atual pelo do arquivo?')) return;
      const chaves = { apiKey: st.cfg.apiKey, chaveGoogle: st.cfg.chaveGoogle, chaveOpenai: st.cfg.chaveOpenai };
      st = { ...padrao(), ...d.estado, cfg: { ...padrao().cfg, ...d.estado.cfg, ...chaves } };
      explicacoes = { ...explicacoes, ...(d.explicacoes || {}) };
      salvar(); salvarExplicacoes();
      syncSubstituir();   // conectado: o arquivo substitui o que está na conta (não junta)
      alert('Progresso importado!');
      rota();
    } catch (err) { alert('Não consegui ler o arquivo: ' + err.message); }
  });
  $app.querySelector('[data-acao=zerar]').addEventListener('click', () => {
    if (!confirm(`Apagar TODO o progresso${conta ? ', também o salvo na sua conta Google' : ''}? Isso não pode ser desfeito (a não ser que você tenha um backup).`)) return;
    const { apiKey, ia, chaveGoogle, modeloGoogle, chaveOpenai, modeloOpenai } = st.cfg;
    st = padrao(); Object.assign(st.cfg, { apiKey, ia, chaveGoogle, modeloGoogle, chaveOpenai, modeloOpenai }); salvar();
    syncSubstituir();
    rota();
  });
  ligarCardConta();
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
      <h2>📚 Trilha de focos</h2>
      <p>Cada área tem <b>um tema em foco por vez</b> (ex.: Biologia › Citologia e bioquímica, Matemática › Geometria plana). Em cada área, <b>2 de cada 3 questões novas</b> vêm desse tema, de provas de vários anos; a outra vem de um tema que <b>já passou</b> pelo foco — o que você viu há mais tempo —, para ele não sumir da cabeça.</p>
      <p>A etapa de foco usa só <b>metade</b> das questões novas que faltam do tema, e as questões de tema passado nunca usam os últimos 30% de um tema. Isso fica para as <b>revisões</b>: depois de cada 3 temas, uma etapa de revisão do tema mais antigo; e, no fim do primeiro giro, um giro só de revisões, tema por tema, com tudo o que sobrou. Assim nenhum tema se esgota no começo e todos continuam aparecendo até o fim das questões novas.</p>
      <p class="small muted">As matérias de cada área se alternam (Biologia → Física → Química → Biologia…). A etapa avança quando você faz as questões dela, em qualquer lugar; dá para pular um tema no cronograma. Desliga em Ajustes.</p>
    </section>
    <section class="card">
      <h2>📺 Videoaulas antes das questões</h2>
      <p>Cada tema tem de 1 a 5 videoaulas do YouTube (links diretos, de canais como Professor Noslen, Gis com Giz, Dicasdemat, Débora Aladim, Parabólica, Samuel Cunha, Professor Boaro e Descomplica), e a <b>matemática básica</b> (frações, potências, MMC, regra de três…) tem as suas. O cronograma põe <b>uma aula por dia antes das questões novas</b>, sempre de um tema cujas questões vêm a seguir: as aulas dos temas em foco na trilha (primeiro a 1ª aula de cada tema que acabou de entrar em foco) se alternam com as de matemática básica; quando acabam, adianta o próximo tema da trilha.</p>
      <p class="small muted">Dá para pular uma aula (já sei o assunto), ver todas na aba Aulas, pôr um tema na frente da fila (📌) e mudar para 2 aulas por dia ou desligar em Ajustes. O vídeo toca dentro do próprio site (no cronograma, na aba Aulas e na correção de cada questão, pelo botão “📺 Aula”), volta de onde você parou e é marcado como visto sozinho quando você passa de 90%. Sem trilha de focos, vêm a matemática básica e os temas em que você mais erra.</p>
    </section>
    <section class="card">
      <h2>2. Errou? Volta até você dominar</h2>
      <p>Errou, ou acertou no chute → a questão entra no <b>caderno de erros</b> e reaparece em intervalos crescentes:</p>
      <p>Linguagens e Humanas: <b>14 → 21 → 30 → 45 dias</b>. Natureza e Matemática: <b>7 → 14 → 30 → 45 dias</b>. Acertou as 4 revisões seguidas → <b>recuperada</b>. Errou numa revisão → volta pro começo. Perto da prova os intervalos encolhem para tudo caber antes dela.</p>
      <p class="small muted">Por que tanto tempo? Logo depois de ver a resposta você acerta por memória da alternativa, não por entendimento — e texto longo (português, humanas) gruda mais. Esperar testa se você aprendeu de verdade.</p>
      <p><b>🧩 Reforço dos erros:</b> enquanto a errada espera, cada erro pede <b>uma questão nova do mesmo tema</b> (sem tema sobrando, da matéria; depois, da área). Treina o assunto sem decorar a questão e ainda adianta as questões novas. Aparece no cronograma depois das questões novas; uma questão nova do mesmo tema feita em qualquer bloco também cumpre o reforço.</p>
    </section>
    <section class="card">
      <h2>3. Quando você erra</h2>
      <ul>
        <li>Travou numa questão? <b>🤷 Não sei — ver resolução</b> mostra a resposta, a explicação e o vídeo. Ela entra no caderno de erros, para você tentar sozinho quando ela voltar.</li>
        <li>O app mostra a <b>alternativa certa</b> na hora.</li>
        <li><b>💡 Por que é X?</b> — um resumo curto do raciocínio (gerado pela IA que você escolher em Ajustes: Claude, Gemini ou ChatGPT).</li>
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

// ---------------------------------------------------------------- explicação com IA
// Claude (Anthropic, pelo SDK), Gemini (Google) ou ChatGPT (OpenAI), com a chave de API do próprio estudante.
const IAS = {
  anthropic: { nome: 'Claude (Anthropic)', chave: 'apiKey', ph: 'sk-ant-...', link: 'https://console.anthropic.com/settings/keys' },
  google: { nome: 'Gemini (Google)', chave: 'chaveGoogle', modelo: 'modeloGoogle', ph: 'AIza...', link: 'https://aistudio.google.com/apikey' },
  openai: { nome: 'ChatGPT (OpenAI)', chave: 'chaveOpenai', modelo: 'modeloOpenai', ph: 'sk-...', link: 'https://platform.openai.com/api-keys' },
};
function iaAtual() { return IAS[st.cfg.ia] ? st.cfg.ia : 'anthropic'; }
function chaveIA() { return st.cfg[IAS[iaAtual()].chave] || ''; }
async function erroHTTP(r) {
  let m = '';
  try { const j = await r.json(); m = j.error?.message || j.message || ''; } catch { /* sem corpo */ }
  const e = new Error(m || `erro ${r.status}`);
  e.status = r.status;
  return e;
}
// modelos que leem imagem e escrevem texto, do mais novo para o mais antigo
async function listarModelos(ia, chave) {
  if (ia === 'google') {
    const r = await fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=200', { headers: { 'x-goog-api-key': chave } });
    if (!r.ok) throw await erroHTTP(r);
    const j = await r.json();
    return (j.models || [])
      .filter(m => (m.supportedGenerationMethods || []).includes('generateContent') && /^models\/gemini/.test(m.name) && !/(embedding|tts|audio|image|live|aqa)/.test(m.name))
      .map(m => m.name.replace('models/', ''))
      .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
  }
  const r = await fetch('https://api.openai.com/v1/models', { headers: { Authorization: `Bearer ${chave}` } });
  if (!r.ok) throw await erroHTTP(r);
  const j = await r.json();
  return (j.data || []).map(m => m.id)
    .filter(id => /^(gpt-|o\d|chatgpt)/.test(id) && !/(audio|realtime|tts|transcribe|search|image|embedding|instruct|codex|moderation|-\d{4}-\d{2}-\d{2}$)/.test(id))
    .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
}
function modeloPadrao(ia, lista) {
  const pref = ia === 'google'
    ? [/^gemini-flash-latest$/, /^gemini-[\d.]+-flash$/, /flash$/, /flash/]
    : [/^gpt-[\d.]+-mini$/, /^gpt-4o-mini$/, /^gpt-[\d.]+$/, /^gpt-/];
  for (const re of pref) { const m = lista.find(x => re.test(x)); if (m) return m; }
  return lista[0];
}
// Um pedido ao Gemini em streaming. Pede pensamento curto e que o raciocínio venha junto (includeThoughts):
// assim a conexão não fica muda enquanto o modelo pensa. Se o modelo não aceitar essas opções, repete sem elas.
const ESPERA_GEMINI = 40;   // segundos sem receber nada até desistir desse modelo
async function geminiStream(modelo, chave, sistema, pedido, imgs, ctx) {
  const v = parseFloat((modelo.match(/gemini-(\d+(?:\.\d+)?)/) || [])[1]) || 0;
  const pensar = v >= 3 ? { thinkingLevel: 'low', includeThoughts: true }
    : v >= 2.5 ? { thinkingBudget: 1024, includeThoughts: true }
    : /latest/.test(modelo) ? { includeThoughts: true } : null;
  const enviar = async comPensar => {
    const ctrl = new AbortController();
    const repassa = () => ctrl.abort();
    ctx.signal.addEventListener('abort', repassa, { once: true });
    let mudo = false;
    const espera = setTimeout(() => { mudo = true; ctrl.abort(); }, ESPERA_GEMINI * 1000);
    let texto = '', motivo = '', recusa = false, pensando = false;
    try {
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modelo)}:streamGenerateContent?alt=sse`, {
        method: 'POST',
        signal: ctrl.signal,
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': chave },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: sistema }] },
          contents: [{ role: 'user', parts: [...imgs.map(i => ({ inline_data: { mime_type: imgTipo(i), data: imgDados(i) } })), { text: pedido }] }],
          generationConfig: { maxOutputTokens: ctx.max || 8000, ...(ctx.json ? { responseMimeType: 'application/json' } : {}), ...(comPensar ? { thinkingConfig: comPensar } : {}) },
        }),
      });
      if (!r.ok) throw await erroHTTP(r);
      ctx.etapa(`O Gemini (${modelo}) está pensando`);
      await lerSSE(r, j => {
        clearTimeout(espera);   // chegou alguma coisa: o modelo está vivo
        if (j.error) { const e = new Error(j.error.message || 'erro no meio da resposta'); e.status = j.error.code; throw e; }
        if (j.promptFeedback?.blockReason) { recusa = true; motivo = j.promptFeedback.blockReason; }
        const c0 = j.candidates?.[0];
        if (!c0) return;
        if (c0.finishReason) motivo = c0.finishReason;
        const partes = c0.content?.parts || [];
        if (!pensando && !texto && partes.some(p => p.thought)) { pensando = true; ctx.etapa(`O Gemini (${modelo}) está raciocinando`); }
        const novo = partes.filter(p => p.text && !p.thought).map(p => p.text).join('');
        if (novo) { texto += novo; ctx.texto(texto); }
      });
    } catch (err) {
      if (mudo && !ctx.signal.aborted) { const e = new Error(`${modelo} não mandou nada em ${ESPERA_GEMINI} s`); e.semResposta = true; throw e; }
      throw err;
    } finally {
      clearTimeout(espera);
      ctx.signal.removeEventListener('abort', repassa);
    }
    if (!texto && ['SAFETY', 'RECITATION', 'PROHIBITED_CONTENT', 'BLOCKLIST', 'SPII', 'OTHER'].includes(motivo)) recusa = true;
    if (!texto && !recusa && motivo === 'MAX_TOKENS') throw new Error(`o ${modelo} gastou o limite pensando e não escreveu nada`);
    return { texto, motivo, recusa };
  };
  try {
    return await enviar(pensar);
  } catch (err) {
    // modelo que não aceita as opções de pensamento: repete sem elas
    if (pensar && err.status === 400 && /think/i.test(err.message)) return await enviar(null);
    throw err;
  }
}
// lê uma resposta em streaming (Server-Sent Events): chama onDados com cada "data: {...}"
async function lerSSE(r, onDados) {
  const leitor = r.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  for (;;) {
    const { value, done } = await leitor.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const linha = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!linha.startsWith('data:')) continue;
      const d = linha.slice(5).trim();
      if (!d || d === '[DONE]') continue;
      let j;
      try { j = JSON.parse(d); } catch { continue; }
      onDados(j);
    }
  }
}
// imagem para a IA: texto base64 (webp, das questões) ou { data, mime } (fotos)
const imgTipo = i => (typeof i === 'string' ? 'image/webp' : i.mime);
const imgDados = i => (typeof i === 'string' ? i : i.data);
function modeloIA(ia) { return ia === 'anthropic' ? MODELO : st.cfg[IAS[ia].modelo] || ''; }
// Chama a IA escolhida. ctx: { signal, etapa(txt), texto(parcial) }. Devolve o texto, ou null se a IA se recusou.
async function chamarIA(ia, sistema, pedido, imgs, ctx) {
  const x = IAS[ia], chave = st.cfg[x.chave];
  if (ia === 'anthropic') {
    ctx.etapa('Carregando a biblioteca da Anthropic');
    let Anthropic;
    try { ({ default: Anthropic } = await import(SDK_URL)); } catch { const e = new Error('não consegui baixar a biblioteca da Anthropic (sem internet?)'); throw e; }
    const client = new Anthropic({ apiKey: chave, dangerouslyAllowBrowser: true });
    ctx.etapa('Enviando para o Claude');
    let texto = '';
    try {
      const stream = client.beta.messages.stream({
        model: MODELO,
        max_tokens: ctx.max || 8000,
        output_config: { effort: ctx.esforco || 'medium' },
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        system: sistema,
        messages: [{ role: 'user', content: [...imgs.map(i => ({ type: 'image', source: { type: 'base64', media_type: imgTipo(i), data: imgDados(i) } })), { type: 'text', text: pedido }] }],
      }, { signal: ctx.signal });
      stream.on('connect', () => ctx.etapa('O Claude está pensando'));
      stream.on('text', t => { texto += t; ctx.texto(texto); });
      const final = await stream.finalMessage();
      if (final.stop_reason === 'refusal') return null;
      return final.content.filter(b => b.type === 'text').map(b => b.text).join('');
    } catch (err) {
      if (Anthropic.APIError && err instanceof Anthropic.APIError && !(Anthropic.APIUserAbortError && err instanceof Anthropic.APIUserAbortError)) {
        const e = new Error(err.error?.error?.message || err.message);
        e.status = err.status;
        throw e;
      }
      throw err;
    }
  }
  let modelo = st.cfg[x.modelo];
  if (!modelo) {
    ctx.etapa('Escolhendo o modelo');
    modelo = modeloPadrao(ia, await listarModelos(ia, chave));
    if (!modelo) throw new Error('nenhum modelo disponível para essa chave');
    st.cfg[x.modelo] = modelo; salvar();
  }
  ctx.etapa(`Enviando para ${x.nome.split(' ')[0]}`);
  let texto = '', motivo = '', recusa = false;
  if (ia === 'google') {
    // tenta o modelo escolhido; se ele não mandar nada em ESPERA_GEMINI s (ou estiver fora/sobrecarregado),
    // tenta outros "flash" estáveis — no máximo 3 modelos
    const tentar = [modelo];
    let lista = null;
    for (let k = 0; ; k++) {
      const m = tentar[k];
      try {
        ({ texto, motivo, recusa } = await geminiStream(m, chave, sistema, pedido, imgs, ctx));
        if (m !== modelo) {
          st.cfg.modeloGoogle = m; salvar();
          ctx.nota(`O ${modelo} não respondeu, então usei o ${m} e deixei ele como padrão (dá para trocar em Ajustes).`);
        }
        break;
      } catch (err) {
        const trocavel = err.semResposta || err.status >= 500 || err.status === 429 || err.status === 404;
        if (ctx.signal.aborted || !trocavel) throw err;
        if (!lista) {
          try { lista = await listarModelos('google', chave); } catch { lista = []; }
          for (const r of ['gemini-flash-latest', 'gemini-2.5-flash', 'gemini-2.0-flash']) if (lista.includes(r) && !tentar.includes(r)) tentar.push(r);
        }
        if (k + 1 >= Math.min(tentar.length, 3)) throw err;
        ctx.etapa(`${m} não respondeu; tentando ${tentar[k + 1]}`);
      }
    }
  } else {
    const raciocina = /^(gpt-5|o\d)/.test(modelo);
    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      signal: ctx.signal,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${chave}` },
      body: JSON.stringify({
        model: modelo,
        stream: true,
        max_completion_tokens: ctx.max || 8000,
        ...(raciocina ? { reasoning_effort: 'low' } : {}),
        ...(ctx.json ? { response_format: { type: 'json_object' } } : {}),
        messages: [
          { role: 'system', content: sistema },
          { role: 'user', content: [...imgs.map(i => ({ type: 'image_url', image_url: { url: `data:${imgTipo(i)};base64,${imgDados(i)}` } })), { type: 'text', text: pedido }] },
        ],
      }),
    });
    if (!r.ok) throw await erroHTTP(r);
    ctx.etapa('O ChatGPT está pensando');
    await lerSSE(r, j => {
      if (j.error) { const e = new Error(j.error.message || 'erro no meio da resposta'); throw e; }
      const c0 = j.choices?.[0];
      if (!c0) return;
      if (c0.delta?.refusal) recusa = true;
      if (c0.finish_reason) motivo = c0.finish_reason;
      if (c0.delta?.content) { texto += c0.delta.content; ctx.texto(texto); }
    });
    if (!texto && motivo === 'content_filter') recusa = true;
    if (!texto && motivo === 'length') throw new Error('o modelo gastou o limite pensando e não escreveu nada — escolha um modelo "mini" em Ajustes');
  }
  if (recusa && !texto) return null;
  if (!texto) throw new Error(`a IA terminou sem escrever nada${motivo ? ` (motivo: ${motivo})` : ''}`);
  return texto;
}
async function imagemBase64(src) {
  const blob = await (await fetch(src)).blob();
  return await new Promise((ok, falha) => {
    const fr = new FileReader();
    fr.onload = () => ok(String(fr.result).split(',')[1]);
    fr.onerror = falha;
    fr.readAsDataURL(blob);
  });
}

// Mostra o andamento (etapa + segundos + Cancelar), o texto chegando e, se der errado, o que aconteceu.
const LIMITE_IA = 150;   // segundos (dá tempo de trocar de modelo se o primeiro não responder)
const SISTEMA_IA = 'Você é um professor experiente de cursinho pré-ENEM. Responde em português do Brasil, de forma curta, clara e correta. Confie no gabarito oficial informado.';
const pedidosIA = new Map();   // chave da explicação -> AbortController
// opções extras (redação): limite (s), max (tokens), esforco, json, etapa0, parcial(texto) -> html do andamento,
// processar(texto) -> resultado (pode lançar erro de formato), mostrar(resultado, el, nota) desenha o resultado
async function rodarIA(el, { sistema, pedido, imgsDe, aoTerminar, tentarDeNovo, limite = LIMITE_IA, max, esforco, json, etapa0, parcial, processar, mostrar }) {
  const ia = iaAtual();
  const nome = IAS[ia].nome;
  const ctrl = new AbortController();
  const t0 = Date.now();
  let etapa = etapa0 || 'Preparando a imagem da questão', texto = '', motivoAbort = '', nota = '';
  el.innerHTML = `<div class="ia-andamento"><span class="ia-etapa"></span> <button class="btn mini" type="button">Cancelar</button></div><div class="ia-texto"></div>`;
  const elEtapa = el.querySelector('.ia-etapa'), elTexto = el.querySelector('.ia-texto');
  const seg = () => Math.round((Date.now() - t0) / 1000);
  const pinta = () => { if (elEtapa.isConnected) elEtapa.textContent = `${etapa}… ${seg()} s`; };
  pinta();
  const relogio = setInterval(() => {
    pinta();
    if (seg() >= limite) { motivoAbort = 'tempo'; ctrl.abort(); }
  }, 1000);
  el.querySelector('.ia-andamento .btn').addEventListener('click', () => { motivoAbort = 'cancelado'; ctrl.abort(); });
  const ctx = {
    signal: ctrl.signal, max, esforco, json,
    etapa: t => { etapa = t; pinta(); },
    texto: t => { texto = t; etapa = 'Escrevendo'; pinta(); if (elTexto.isConnected) elTexto.innerHTML = parcial ? parcial(t) : `<p>${md(t)}</p>`; },
    nota: t => { nota = t; },
  };
  try {
    const imgs = await imgsDe();
    const final = await chamarIA(ia, sistema, pedido, imgs, ctx);
    clearInterval(relogio);
    if (final === null) { el.innerHTML = `<p class="aviso">${esc(nome)} preferiu não responder ${processar ? 'esse pedido. Tente outra IA em Ajustes.' : 'essa questão. Tente o vídeo do YouTube ou outra IA em Ajustes.'}</p>`; return null; }
    if (processar) {
      etapa = 'Lendo a resposta';
      const res = processar(final);
      aoTerminar?.(res, final);
      mostrar(res, el, nota);
      return res;
    }
    el.innerHTML = `<p>${md(final)}</p>` + (nota ? `<p class="small muted" style="margin:0">${esc(nota)}</p>` : '');
    aoTerminar?.(final);
    return final;
  } catch (err) {
    clearInterval(relogio);
    if (motivoAbort === 'cancelado') { el.innerHTML = '<p class="small muted">Cancelado. <button class="btn mini" type="button" data-de-novo>Tentar de novo</button></p>'; el.querySelector('[data-de-novo]').addEventListener('click', tentarDeNovo); return null; }
    const cod = err.status;
    let msg;
    if (motivoAbort === 'tempo') msg = `${nome} não respondeu em ${limite} s. Tente de novo ou escolha um modelo mais rápido (“flash” ou “mini”) em Ajustes.`;
    else if (cod === 401 || cod === 403 || (cod === 400 && /api.?key/i.test(err.message))) msg = `A chave do ${nome} foi recusada. Confira em Ajustes.`;
    else if (cod === 429) msg = 'Limite da sua chave atingido (muitas requisições seguidas ou sem crédito). Tente de novo daqui a pouco.';
    else if (cod === 404) msg = `O modelo “${modeloIA(ia)}” não foi encontrado para a sua chave. Escolha outro em Ajustes.`;
    else if (cod >= 500) msg = `O servidor do ${nome} falhou agora. Tente de novo em alguns segundos.`;
    else if (err.formato) msg = 'A IA respondeu num formato que não consegui ler. Tente de novo (às vezes a resposta vem cortada).';
    else if (err instanceof TypeError && !cod) msg = 'Não consegui falar com o servidor da IA (sem internet ou bloqueado pela rede).';
    else msg = 'Não consegui gerar a explicação.';
    // detalhes para corrigir — nunca inclui a chave
    const detalhes = [
      `Quando: ${new Date().toLocaleString('pt-BR')}`,
      `IA: ${nome}`,
      `Modelo: ${modeloIA(ia) || '(não escolhido)'}`,
      `Parou em: ${etapa} (${seg()} s)`,
      cod ? `Código HTTP: ${cod}` : '',
      `Mensagem: ${motivoAbort === 'tempo' ? `sem resposta em ${limite} s` : (err.message || String(err))}`,
      texto ? `Texto recebido até parar: ${texto.length} caracteres` : 'Nenhum texto chegou',
      `Navegador: ${navigator.userAgent.replace(/^Mozilla\/5\.0 /, '').slice(0, 120)}`,
    ].filter(Boolean).join('\n');
    // sem espaços entre as tags: a área da explicação preserva quebras de linha
    el.innerHTML = `<div class="aviso"><p style="margin:0 0 6px"><b>${esc(msg)}</b></p>`
      + `<pre class="ia-detalhes">${esc(detalhes)}</pre>`
      + '<div class="linha-btns" style="margin-top:6px"><button class="btn mini" type="button" data-de-novo>Tentar de novo</button><button class="btn mini" type="button" data-copiar>Copiar detalhes</button></div></div>'
      + (texto && !processar ? `<div class="ia-texto"><p>${md(texto)}</p></div>` : '');
    el.querySelector('[data-de-novo]').addEventListener('click', tentarDeNovo);
    el.querySelector('[data-copiar]').addEventListener('click', e => {
      navigator.clipboard?.writeText(detalhes).then(() => { e.target.textContent = 'Copiado ✓'; }, () => { e.target.textContent = 'Selecione o texto acima'; });
    });
    return null;
  }
}

// a explicação depende da letra marcada ("por que a B está errada"): guardada por questão + letra
function chaveExp(id, marcada) { return `${id}:${marcada && marcada !== '?' && marcada !== BYID[id]?.resp ? marcada : 'ok'}`; }
async function explicar(q, marcada, el, modo = 'porque') {
  const chave = modo === 'dica' ? `${q.id}:dica` : chaveExp(q.id, marcada);
  if (explicacoes[chave]) { el.innerHTML = `<p>${md(explicacoes[chave])}</p>`; return; }
  if (!chaveIA()) {
    el.innerHTML = `<p class="aviso">Para ver a explicação escrita, escolha a IA e coloque sua chave de API em <a href="#/ajustes">Ajustes</a> (Claude, Gemini ou ChatGPT). Enquanto isso, o vídeo do YouTube resolve!</p>`;
    return;
  }
  if (location.protocol === 'file:') {
    el.innerHTML = `<p class="aviso">Abra o app pelo <b>INICIAR.bat</b> (servidor local) para usar as explicações.</p>`;
    return;
  }
  // a mesma explicação já está sendo gerada (clique duplo): não pede de novo
  if (pedidosIA.has(chave) && el.querySelector('.ia-andamento')) return;
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
  pedidosIA.set(chave, true);
  try {
    await rodarIA(el, {
      sistema: SISTEMA_IA,
      pedido,
      imgsDe: () => Promise.all(q.imgs.map(imagemBase64)),
      aoTerminar: texto => { explicacoes[chave] = texto; salvarExplicacoes(); },
      tentarDeNovo: () => explicar(q, marcada, el, modo),
    });
  } finally {
    pedidosIA.delete(chave);
  }
}
// botão "Testar" em Ajustes: um pedido curto, sem imagem, com o mesmo relatório de erro
function testarIA(el) {
  return rodarIA(el, {
    sistema: 'Responda em português do Brasil.',
    pedido: 'Responda apenas: "Funcionando! Pode usar nas explicações."',
    imgsDe: async () => [],
    tentarDeNovo: () => testarIA(el),
  });
}

// ---------------------------------------------------------------- redação com correção por IA
// O texto (digitado ou fotografado) vai para a IA com a matriz do INEP e as lições das redações nota 1000
// (data/redacao.js). A IA devolve JSON: trechos marcados por nível (verde → vermelho), notas por competência
// num cenário pessimista e num otimista, o que estudar (busca no YouTube) e dicas de português.
const KEY_RED = 'enem.redacoes';
const GUIA = window.REDACAO || { competencias: [], zeram: [], licoes: [], criterio: () => '' };
let red = { rascunho: { tema: '', texto: '', modo: 'folha' }, hist: [] };
try { red = { ...red, ...(JSON.parse(localStorage.getItem(KEY_RED)) || {}) }; } catch { /* recomeça */ }
// modos: folha (30 linhas, padrão) | foto | livre (caixa de texto solta, para passar a limpo do papel)
if (!['folha', 'foto', 'livre'].includes(red.rascunho.modo)) red.rascunho.modo = 'folha';
function salvarRed() {
  red.mod = Date.now();
  setTimeout(() => syncAgendar(), 0);
  for (;;) {
    try { localStorage.setItem(KEY_RED, JSON.stringify(red)); return; } catch {
      if (red.hist.length <= 1) return;   // cheio: descarta as correções mais antigas
      red.hist.pop();
    }
  }
}
// contador permanente de redações corrigidas e palavras (o histórico guarda só as últimas 40 correções)
function contaPalavras(t) { return (String(t || '').match(/\S+/g) || []).length; }
try {
  if (!Array.isArray(red.hist)) red.hist = [];
  red.hist = red.hist.filter(x => x && typeof x === 'object');   // registros vazios de versões antigas
  if (!red.cont) red.cont = { n: red.hist.length, palavras: red.hist.reduce((s, x) => s + contaPalavras(x.texto), 0) };
} catch { red.cont = { n: 0, palavras: 0 }; }
let fotosRed = [];   // fotos da folha (só na memória): { data, mime, url }
// níveis das marcações: 1 (melhor) a 5 (pior); 0 = leitura duvidosa da foto
const NIVEIS_RED = {
  1: ['Excelente', 'trecho no nível nota 1000 — continue fazendo assim'],
  2: ['Bom', 'funciona bem'],
  3: ['Pode melhorar', 'não está errado, mas outra forma renderia mais'],
  4: ['Problema', 'deve custar pontos'],
  5: ['Erro grave', 'custa pontos com certeza'],
  0: ['Leitura duvidosa', 'a IA não tem certeza se leu certo a sua letra'],
};
const TIPOS_RED = {
  ortografia: 'Ortografia', acentuacao: 'Acentuação', gramatica: 'Gramática', pontuacao: 'Pontuação', crase: 'Crase',
  concordancia: 'Concordância', regencia: 'Regência', coesao: 'Coesão', repertorio: 'Repertório', argumentacao: 'Argumentação',
  tese: 'Tese', proposta: 'Proposta', estrutura: 'Estrutura', vocabulario: 'Vocabulário', tema: 'Tema', leitura: 'Leitura da foto',
};
const TEMAS_ENEM = [
  [2025, 'Perspectivas acerca do envelhecimento na sociedade brasileira'],
  [2024, 'Desafios para a valorização da herança africana no Brasil'],
  [2023, 'Desafios para o enfrentamento da invisibilidade do trabalho de cuidado realizado pela mulher no Brasil'],
  [2022, 'Desafios para a valorização de comunidades e povos tradicionais no Brasil'],
  [2021, 'Invisibilidade e registro civil: garantia de acesso à cidadania no Brasil'],
  [2020, 'O estigma associado às doenças mentais na sociedade brasileira'],
  [2019, 'Democratização do acesso ao cinema no Brasil'],
  [2018, 'Manipulação do comportamento do usuário pelo controle de dados na internet'],
  [2017, 'Desafios para a formação educacional de surdos no Brasil'],
  [2016, 'Caminhos para combater a intolerância religiosa no Brasil'],
  [2015, 'A persistência da violência contra a mulher na sociedade brasileira'],
  [2014, 'Publicidade infantil em questão no Brasil'],
  [2013, 'Efeitos da implantação da Lei Seca no Brasil'],
  [2012, 'O movimento imigratório para o Brasil no século XXI'],
  [2011, 'Viver em rede no século XXI: os limites entre o público e o privado'],
];
// ---- desafio dos anos: uma redação 900+ no tema de cada ENEM desde 2011.
// Referências: redações reais com nota 980–1000 em cada tema (data/referencias.js: autor, nota, link e análise).
const REFS = window.REFERENCIAS || { anos: [] };
const normTema = t => String(t || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
function anoDoTema(tema) {
  const n = normTema(tema);
  if (!n) return null;
  const x = TEMAS_ENEM.find(([, t]) => normTema(t) === n);
  return x ? x[0] : null;
}
// nota de uma correção para o desafio: média dos dois cenários (como a média de dois corretores, em degraus de 20)
const notaMedia = res => Math.round((notaTotal(res, 'pessimista') + notaTotal(res, 'otimista')) / 40) * 20;
function placarAnos() {
  const melhor = {};
  for (const x of red.hist) {
    const a = anoDoTema(x.tema);
    if (a && !(melhor[a] >= notaMedia(x.res))) melhor[a] = notaMedia(x.res);
  }
  return melhor;
}
function desafioAnosHTML() {
  const m = placarAnos();
  const feitos = TEMAS_ENEM.filter(([a]) => m[a] >= 900).length;
  return `<section class="card" id="anos">
    <div class="titulo-linha"><h2>🏅 Desafio dos anos</h2><span class="small muted">${feitos} de ${TEMAS_ENEM.length} com 900+</span></div>
    <p class="small muted" style="margin:0 0 10px">900+ no tema de cada ENEM desde 2011. Toque num ano para ver redações reais nota 980–1000.</p>
    <div class="barra" style="margin-bottom:12px"><i style="width:${Math.max(1, pct(feitos, TEMAS_ENEM.length))}%"></i></div>
    <div class="anos-grade">${TEMAS_ENEM.map(([a, t]) => {
      const n = m[a];
      return `<button class="ano ${n >= 900 ? 'ok' : n ? 'tentou' : ''}" type="button" data-ano="${a}" title="${esc(t)}"><b>${a}</b><span>${n >= 900 ? `🏅 ${n}` : n || '—'}</span></button>`;
    }).join('')}</div>
    <div id="ano-detalhe"></div>
  </section>`;
}
function anoDetalheHTML(a) {
  const tema = TEMAS_ENEM.find(x => x[0] === a)[1];
  const ref = REFS.anos.find(x => x.ano === a);
  const n = placarAnos()[a];
  const refs = ref?.redacoes || [];
  return `<div class="ano-detalhe">
    <h3>ENEM ${a}: ${esc(tema)}</h3>
    <p class="small" style="margin:4px 0 10px">${n ? (n >= 900 ? `🏅 Conquistado com ${n}.` : `Sua melhor: <b>${n}</b> — faltam ${900 - n} para 900.`) : 'Você ainda não escreveu sobre este tema.'}</p>
    <button class="btn primario" type="button" data-escrever="${a}">✍️ Escrever sobre este tema</button>
    ${refs.length ? `<p class="small muted" style="margin:14px 0 6px">${refs.length} ${refs.length === 1 ? 'redação real' : 'redações reais'} com nota máxima neste tema. Abra para ver o que cada uma fez e leia o texto completo na fonte:</p>
      <div class="refs">${refs.map(r => `<details class="ref"><summary><b>${esc(r.autor)}</b> · ${esc(r.nota)} <span class="small muted">· ${esc(r.fonte)}</span></summary>
        <ul class="small">${r.introducao ? `<li><b>Introdução:</b> ${esc(r.introducao)}</li>` : ''}${(r.argumentos || []).map((x, i) => `<li><b>D${i + 1}:</b> ${esc(x)}</li>`).join('')}${r.proposta ? `<li><b>Proposta:</b> ${esc(r.proposta)}</li>` : ''}${r.destaque ? `<li><b>Por que funciona:</b> ${esc(r.destaque)}</li>` : ''}</ul>
        ${r.url ? `<a class="btn mini" href="${esc(r.url)}" target="_blank" rel="noopener">Ler a redação completa ↗</a>` : ''}</details>`).join('')}</div>`
      : `<p class="small muted" style="margin:14px 0 0">${esc(ref?.aviso || 'Ainda não há redações de referência para este ano.')}</p>`}
  </div>`;
}
const linkYT = termo => 'https://www.youtube.com/results?search_query=' + encodeURIComponent(termo);
// ---- folha de 30 linhas
// Cada linha comporta o texto médio de uma linha das redações nota 1000 (GUIA.media.caracteresPorLinha):
// a fonte é calculada para caber essa quantidade de caracteres na largura da folha.
const RECUO = '\u2003\u2003';   // recuo de parágrafo (dois espaços "eme")
const CAP_LINHA = GUIA.media?.caracteresPorLinha || 112;
const FONTE_RED = '"Iowan Old Style", "Palatino Linotype", Georgia, serif';
const AMOSTRA_RED = 'A educação pública no Brasil enfrenta desafios históricos, como a desigualdade regional e a falta de investimento, que comprometem a formação dos jovens e, por conseguinte, o desenvolvimento do país.';
let kFonteRed = 0;   // largura média de um caractere por px de fonte
function larguraCaractere() {
  if (!kFonteRed) {
    const cv = document.createElement('canvas').getContext('2d');
    cv.font = `100px ${FONTE_RED}`;
    kFonteRed = cv.measureText(AMOSTRA_RED).width / AMOSTRA_RED.length / 100 || 0.45;
  }
  return kFonteRed;
}
const paragrafos = t => String(t || '').split(/\n+/).map(p => p.trim()).filter(Boolean);
const paraFolha = t => paragrafos(t).map(p => RECUO + p).join('\n');
const paraLivre = t => paragrafos(t).join('\n\n');
// linhas que o texto ocupa na folha do ENEM (medido numa folha invisível com as proporções da folha)
let espelhoRed = null;
function linhasNaFolha(textoFolha) {
  if (!String(textoFolha).trim()) return 0;
  if (!espelhoRed) {
    espelhoRed = document.createElement('div');
    espelhoRed.setAttribute('aria-hidden', 'true');
    Object.assign(espelhoRed.style, { position: 'absolute', left: '-9999px', top: '0', visibility: 'hidden', whiteSpace: 'pre-wrap', overflowWrap: 'break-word', fontFamily: FONTE_RED, fontSize: '16px', lineHeight: '24px' });
    document.body.appendChild(espelhoRed);
  }
  espelhoRed.style.width = `${CAP_LINHA * larguraCaractere() * 16}px`;
  espelhoRed.textContent = textoFolha + '\u200b';
  return Math.round(espelhoRed.scrollHeight / 24);
}
function contarRed(t) {
  const pars = paragrafos(t);
  return { palavras: (t.match(/\S+/g) || []).length, pars: pars.length, linhas: linhasNaFolha(paraFolha(t)) };
}
function notaTotal(res, lado) { return res.anulada ? 0 : res.competencias.reduce((s, c) => s + c[lado], 0); }

// foto -> JPEG de até 1800 px no lado maior (bom para ler a letra e leve para enviar)
async function prepararFoto(arquivo) {
  const url = URL.createObjectURL(arquivo);
  const img = await new Promise((ok, falha) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => falha(new Error('não consegui abrir essa imagem')); i.src = url; });
  const k = Math.min(1, 1800 / Math.max(img.naturalWidth, img.naturalHeight));
  const cv = document.createElement('canvas');
  cv.width = Math.round(img.naturalWidth * k); cv.height = Math.round(img.naturalHeight * k);
  cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
  return { data: cv.toDataURL('image/jpeg', 0.85).split(',')[1], mime: 'image/jpeg', url };
}

function telaRedacao(arg) {
  if (arg) { const r = red.hist.find(x => x.id === arg); if (r) return verCorrecao(r); }
  const R = red.rascunho;
  const M = GUIA.media || {};
  $app.classList.add('larga');
  $app.innerHTML = `<div class="red-pagina">
    <div class="titulo-linha red-topo"><h1>Redação</h1><button class="btn mini" type="button" data-logica>📖 Como a correção funciona</button></div>
    <section class="card destaque">
      <label class="campo" for="red-tema" style="margin-top:0">Tema da proposta</label>
      <input type="text" id="red-tema" list="red-temas" placeholder="Ex.: Desafios para a valorização da herança africana no Brasil" value="${esc(R.tema)}">
      <datalist id="red-temas">${TEMAS_ENEM.map(([a, t]) => `<option value="${esc(t)}">ENEM ${a}</option>`).join('')}</datalist>
      <div class="seletor" role="tablist" style="margin-top:14px">
        <button class="op ${R.modo !== 'foto' ? 'on' : ''}" data-modo="folha" type="button">📝 Folha de redação</button>
        <button class="op ${R.modo === 'foto' ? 'on' : ''}" data-modo="foto" type="button">📷 Foto da folha</button>
      </div>
      <div data-painel="folha" ${R.modo === 'folha' ? '' : 'hidden'}>
        <div class="vivo-linha" style="margin-top:12px">
          <label class="vivo-chave"><input type="checkbox" id="red-vivo" ${red.vivo ? 'checked' : ''}> ⚡ Correção em tempo real</label>
          <span class="small muted" id="vivo-status"></span>
        </div>
        <div class="folha-red ${red.vivo ? 'vivo' : ''}" id="folha-red">
          <div class="folha-nums" id="folha-nums" aria-hidden="true"></div>
          <div class="folha-corpo">
            <div class="folha-fundo" id="folha-fundo" aria-hidden="true"></div>
            <textarea id="red-folha" class="folha-area" spellcheck="false" autocorrect="off" autocapitalize="sentences" aria-label="Folha de redação, 30 linhas">${esc(R.modo === 'folha' ? R.texto : paraFolha(R.texto))}</textarea>
            <div class="vivo-painel" id="vivo-painel" role="dialog" aria-label="Comentário da IA" hidden></div>
          </div>
        </div>
        <p class="small" id="folha-conta" style="margin:6px 0 0"></p>
        <p class="small muted" style="margin:6px 0 0">Só passando a limpo do papel? <a href="#" data-livre="1">Texto livre</a></p>
      </div>
      <div data-painel="livre" ${R.modo === 'livre' ? '' : 'hidden'}>
        <p class="small muted" style="margin:10px 0 0"><a href="#" data-livre="0">← Voltar para a folha de 30 linhas</a></p>
        <textarea id="red-texto" class="red-area" placeholder="Cole ou digite sua redação aqui. Deixe uma linha entre os parágrafos.">${esc(R.modo === 'livre' ? R.texto : paraLivre(R.texto))}</textarea>
        <p class="small muted" id="red-conta" style="margin:4px 0 0"></p>
      </div>
      <div data-painel="foto" ${R.modo === 'foto' ? '' : 'hidden'}>
        <p class="small muted" style="margin:10px 0">A IA pode ler alguma palavra errado: o que ela não tiver certeza fica em <span class="m n0">cinza tracejado</span>, e dá para conferir a transcrição depois.</p>
        <div class="red-fotos" id="red-fotos"></div>
        <label class="btn" style="margin-top:8px">📷 Tirar ou escolher foto<input type="file" accept="image/*" capture="environment" id="red-foto" hidden multiple></label>
        <p class="small muted" style="margin:8px 0 0">Folha reta e inteira, luz de frente, até 3 fotos.</p>
      </div>
      <div class="linha-btns"><button class="btn primario grande" id="red-enviar" type="button">Corrigir redação</button></div>
      <div id="red-ia" class="explicacao red-andamento"></div>
    </section>
    ${desafioAnosHTML()}
    ${red.hist.length ? `<section class="card"><h2>Suas correções</h2><ul class="lista">${red.hist.map(h => `<li><div><span class="tit">${esc(h.tema || h.res.tema_usado || 'Sem tema')}</span>
      <div class="small muted">${new Date(h.data).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })} · ${h.modo === 'foto' ? 'foto' : 'texto'} · nota ${faixaNota(h.res)}</div></div>
      <a class="btn mini" href="#/redacao/${h.id}">Ver</a></li>`).join('')}</ul></section>` : ''}
    ${guiaHTML()}
  </div>`;
  const g = id => document.getElementById(id);
  const avisoLinhas = n => (n && n <= 7 ? ' <b style="color:var(--erro)">— até 7 linhas zera a redação</b>'
    : n > 30 ? ' <b style="color:var(--erro)">— passou da folha: na prova não cabe</b>' : n >= 25 ? ' <span style="color:var(--ok)">✓ bom tamanho</span>' : '');
  const conta = () => {
    const c = contarRed(g('red-texto').value);
    g('red-conta').innerHTML = c.palavras
      ? `${c.palavras} palavras · ${c.pars} ${c.pars === 1 ? 'parágrafo' : 'parágrafos'} · ≈ ${c.linhas} de 30 linhas na folha${avisoLinhas(c.linhas)}`
      : 'A folha do ENEM tem 30 linhas; o ideal é escrever de 25 a 30.';
  };
  conta();
  // folha: a fonte acompanha a largura para cada linha comportar CAP_LINHA caracteres; no celular (folha estreita)
  // a fonte não diminui além do legível e a contagem passa a ser a das linhas equivalentes na folha de papel
  const folha = g('folha-red'), area = g('red-folha'), nums = g('folha-nums');
  const medirFolha = () => {
    if (!folha.isConnected || folha.offsetParent === null) return;
    const cs = getComputedStyle(area);
    const padY = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
    const util = area.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    const fPapel = util / (CAP_LINHA * larguraCaractere());
    const exata = fPapel >= 13;
    const f = exata ? fPapel : 17;
    const lh = Math.round(f * 1.75 * 100) / 100;
    folha.style.setProperty('--f', `${f}px`);
    folha.style.setProperty('--lh', `${lh}px`);
    folha.classList.toggle('aproximada', !exata);
    area.style.height = '0px';
    const vis = Math.max(1, Math.round((area.scrollHeight - padY) / lh));
    const linhas = Math.max(exata ? 30 : 16, vis);
    area.style.height = `${linhas * lh + padY}px`;
    if (exata && nums.childElementCount !== linhas) nums.innerHTML = Array.from({ length: linhas }, (_, i) => `<span class="${i >= 30 ? 'fora' : ''}">${i + 1}</span>`).join('');
    const usadas = !area.value.trim() ? 0 : exata ? vis : linhasNaFolha(area.value);
    const palavras = (area.value.match(/\S+/g) || []).length;
    g('folha-conta').innerHTML = `<b>${usadas}</b> de 30 linhas${exata ? '' : ' (equivalente na folha de papel)'} · ${palavras} palavras${avisoLinhas(usadas)}`;
  };
  area.addEventListener('focus', () => { if (!area.value) { area.value = RECUO; R.texto = RECUO; } });
  area.addEventListener('blur', () => { if (!area.value.trim()) { area.value = ''; R.texto = ''; salvarRed(); medirFolha(); } });
  area.addEventListener('keydown', e => {
    if (e.key !== 'Enter' || e.shiftKey || e.ctrlKey || e.metaKey || e.isComposing) return;
    e.preventDefault();
    // insertText mantém o Ctrl+Z funcionando; setRangeText é a reserva
    if (!document.execCommand('insertText', false, '\n' + RECUO)) {
      area.setRangeText('\n' + RECUO, area.selectionStart, area.selectionEnd, 'end');
      area.dispatchEvent(new Event('input'));
    }
  });
  // ---- correção em tempo real: a IA lê o que você já escreveu e grifa trechos na própria folha (camada atrás do
  // texto, com a mesma fonte e as mesmas linhas). Clicar num trecho colorido mostra o comentário e a sugestão.
  const fundo = g('folha-fundo'), painelVivo = g('vivo-painel'), statusVivo = g('vivo-status');
  let vivoMarcas = Array.isArray(red.vivoMarcas) ? red.vivoMarcas : [];
  let vivoTimer = 0, vivoCtrl = null, vivoUltimo = red.vivoTexto || '', vivoQuando = 0, vivoErro = '';
  const desenharFundo = () => {
    fundo.innerHTML = red.vivo && vivoMarcas.length ? textoMarcado(area.value, vivoMarcas, false) + '\u200b' : '';
  };
  const pintarStatus = () => {
    if (!red.vivo) statusVivo.innerHTML = '';
    else if (!chaveIA()) statusVivo.innerHTML = 'precisa da chave de API em <a href="#/ajustes">Ajustes</a>';
    else if (vivoCtrl) statusVivo.textContent = 'a IA está lendo o que você escreveu…';
    else if (vivoErro) statusVivo.textContent = `não consegui analisar agora (${vivoErro}) — tento de novo no próximo trecho`;
    else if (!vivoQuando && !vivoMarcas.length) statusVivo.textContent = 'a IA começa a ler depois das primeiras frases';
    else {
      const n = vivoMarcas.filter(m => m.pos).length;
      const seg = vivoQuando ? Math.round((Date.now() - vivoQuando) / 1000) : 0;
      statusVivo.textContent = `${n} ${n === 1 ? 'trecho marcado' : 'trechos marcados'}${vivoQuando ? ` · lido há ${seg < 60 ? `${seg} s` : `${Math.round(seg / 60)} min`}` : ''} · clique num trecho colorido`;
    }
  };
  const VIVO_PAUSA = 5000, VIVO_INTERVALO = 40000;   // espera você parar 5 s; no máximo uma leitura a cada 40 s
  const agendarVivo = () => {
    clearTimeout(vivoTimer);
    if (!red.vivo || !chaveIA() || location.protocol === 'file:' || vivoCtrl) return;
    const t = paraLivre(area.value);
    if ((t.match(/\S+/g) || []).length < 25 || t === vivoUltimo) return;
    // só vale ler de novo quando terminou uma frase ou mudou um pedaço razoável
    if (!/[.!?:]["”]?$/.test(t) && Math.abs(t.length - vivoUltimo.length) < 60) return;
    vivoTimer = setTimeout(analisarVivo, Math.max(VIVO_PAUSA, vivoQuando + VIVO_INTERVALO - Date.now()));
  };
  const analisarVivo = async () => {
    if (vivoCtrl || !folha.isConnected) return;
    const t = paraLivre(area.value);
    vivoCtrl = new AbortController();
    vivoErro = '';
    pintarStatus();
    const ctrl = vivoCtrl;
    const limite = setTimeout(() => ctrl.abort(), 90000);
    try {
      const txt = await chamarIA(iaAtual(), SISTEMA_VIVO(), pedidoVivo(R.tema, t), [], { signal: ctrl.signal, max: 5000, esforco: 'low', json: true, etapa() {}, texto() {}, nota() {} });
      if (txt === null) throw new Error('a IA preferiu não responder');
      vivoMarcas = lerMarcasVivo(txt);
      red.vivoMarcas = vivoMarcas.map(({ pos, ...m }) => m);
      red.vivoTexto = t;
      salvarRed();
    } catch (e) {
      vivoErro = ctrl.signal.aborted ? 'demorou demais' : String(e.message || e).slice(0, 80);
    } finally {
      clearTimeout(limite);
      vivoCtrl = null;
      vivoUltimo = t;
      vivoQuando = Date.now();
    }
    if (!folha.isConnected) return;
    desenharFundo();
    pintarStatus();
    agendarVivo();   // o texto pode ter mudado enquanto a IA lia
  };
  // comentário do trecho onde está o cursor (ao clicar ou andar com as setas)
  const mostrarVivo = () => {
    fundo.querySelectorAll('mark.sel').forEach(x => x.classList.remove('sel'));
    if (!red.vivo) { painelVivo.hidden = true; return; }
    const c = area.selectionStart;
    const ks = vivoMarcas.map((m, k) => (m.pos && m.pos[0] <= c && c <= m.pos[1] ? k : -1)).filter(k => k >= 0);
    if (!ks.length) { painelVivo.hidden = true; return; }
    fundo.querySelectorAll('mark.m').forEach(x => { if (x.dataset.ms.split(',').some(k => ks.includes(+k))) x.classList.add('sel'); });
    painelVivo.innerHTML = '<button class="vivo-fechar" type="button" aria-label="Fechar">✕</button><i class="vivo-seta"></i>' + ks.map(k => {
      const m = vivoMarcas[k];
      const aplica = m.sugestao && m.nivel >= 3 ? `<button class="btn mini" type="button" data-aplicar="${k}">Aplicar sugestão</button>` : '';
      return cartaoMarca(m, k).replace(/<\/div>\s*$/, `${aplica}</div>`);
    }).join('');
    painelVivo.hidden = false;
    painelVivo.querySelector('.vivo-fechar').addEventListener('click', fecharVivo);
    // janelinha logo acima do trecho (ou logo abaixo, se não couber acima na tela), com a setinha apontando para ele
    const alvo = fundo.querySelector('mark.m.sel');
    if (alvo) {
      const corpo = painelVivo.parentElement.getBoundingClientRect();
      const r = alvo.getBoundingClientRect();
      const pw = painelVivo.offsetWidth, ph = painelVivo.offsetHeight;
      const centro = r.left - corpo.left + r.width / 2;
      const left = Math.max(4, Math.min(corpo.width - pw - 4, centro - pw / 2));
      const topo = document.querySelector('.topo')?.offsetHeight || 0;
      const acima = r.top - ph - 12 >= topo + 4;
      painelVivo.classList.toggle('embaixo', !acima);
      painelVivo.style.left = `${left}px`;
      painelVivo.style.top = `${acima ? r.top - corpo.top - ph - 10 : r.bottom - corpo.top + 10}px`;
      painelVivo.querySelector('.vivo-seta').style.left = `${Math.max(14, Math.min(pw - 14, centro - left))}px`;
    }
    painelVivo.querySelectorAll('[data-aplicar]').forEach(b => b.addEventListener('click', () => {
      const m = vivoMarcas[+b.dataset.aplicar];
      if (!m?.pos) return;
      area.focus();
      area.setSelectionRange(m.pos[0], m.pos[1]);
      if (!document.execCommand('insertText', false, m.sugestao)) {
        area.setRangeText(m.sugestao, m.pos[0], m.pos[1], 'end');
        area.dispatchEvent(new Event('input'));
      }
      vivoMarcas = vivoMarcas.filter(x => x !== m);
      red.vivoMarcas = vivoMarcas.map(({ pos, ...x }) => x);
      salvarRed();
      desenharFundo();
      pintarStatus();
    }));
  };
  function fecharVivo() {
    painelVivo.hidden = true;
    fundo.querySelectorAll('mark.sel').forEach(x => x.classList.remove('sel'));
  }
  area.addEventListener('click', mostrarVivo);
  area.addEventListener('keyup', e => { if (e.key.startsWith('Arrow') || e.key === 'Home' || e.key === 'End') mostrarVivo(); });
  area.addEventListener('keydown', e => { if (e.key === 'Escape' && !painelVivo.hidden) fecharVivo(); });
  // clicar fora da janelinha (e fora da folha) fecha
  const foraVivo = e => { if (!painelVivo.hidden && !painelVivo.contains(e.target) && e.target !== area) fecharVivo(); };
  document.addEventListener('pointerdown', foraVivo);
  aoSair(() => document.removeEventListener('pointerdown', foraVivo));
  g('red-vivo').addEventListener('change', e => {
    red.vivo = e.target.checked;
    salvarRed();
    folha.classList.toggle('vivo', red.vivo);
    painelVivo.hidden = true;
    if (red.vivo) { vivoUltimo = ''; agendarVivo(); } else { clearTimeout(vivoTimer); vivoCtrl?.abort(); }
    desenharFundo();
    pintarStatus();
  });
  const relogioVivo = setInterval(() => { if (red.vivo && vivoQuando && !vivoCtrl) pintarStatus(); }, 10000);
  area.addEventListener('input', () => {
    R.texto = area.value; salvarRed(); medirFolha();
    desenharFundo();
    painelVivo.hidden = true;
    agendarVivo();
  });
  const ro = new ResizeObserver(() => medirFolha());
  ro.observe(folha);
  aoSair(() => { ro.disconnect(); clearTimeout(vivoTimer); clearInterval(relogioVivo); vivoCtrl?.abort(); });
  medirFolha();
  desenharFundo();
  pintarStatus();
  agendarVivo();
  g('red-tema').addEventListener('input', e => { R.tema = e.target.value; salvarRed(); });
  g('red-texto').addEventListener('input', e => { R.texto = e.target.value; salvarRed(); conta(); });
  const mudarModo = modo => {
    if (modo === R.modo) return;
    if (modo === 'folha' && R.modo === 'livre') area.value = paraFolha(g('red-texto').value);
    if (modo === 'livre' && R.modo === 'folha') g('red-texto').value = paraLivre(area.value);
    if (modo !== 'foto') R.texto = modo === 'folha' ? area.value : g('red-texto').value;
    R.modo = modo; salvarRed();
    $app.querySelectorAll('[data-modo]').forEach(x => x.classList.toggle('on', (x.dataset.modo === 'foto') === (modo === 'foto')));
    $app.querySelectorAll('[data-painel]').forEach(p => { p.hidden = p.dataset.painel !== modo; });
    if (modo === 'folha') medirFolha(); else if (modo === 'livre') conta();
  };
  $app.querySelectorAll('[data-modo]').forEach(b => b.addEventListener('click', () => mudarModo(b.dataset.modo)));
  $app.querySelectorAll('[data-livre]').forEach(a => a.addEventListener('click', e => { e.preventDefault(); mudarModo(a.dataset.livre === '1' ? 'livre' : 'folha'); }));
  // lógica da correção numa janela
  const dlg = g('red-logica');
  $app.querySelector('[data-logica]').addEventListener('click', () => dlg.showModal());
  dlg.querySelector('[data-fechar-logica]').addEventListener('click', () => dlg.close());
  dlg.addEventListener('click', e => { if (e.target === dlg) dlg.close(); });   // clique fora fecha
  // desafio dos anos: tocar num ano abre o tema e as referências; "Escrever" leva o tema para a folha
  const abrirAno = a => {
    $app.querySelectorAll('.ano').forEach(b => b.classList.toggle('sel', +b.dataset.ano === a));
    g('ano-detalhe').innerHTML = anoDetalheHTML(a);
    g('ano-detalhe').querySelector('[data-escrever]').addEventListener('click', () => {
      const tema = TEMAS_ENEM.find(x => x[0] === a)[1];
      if (paragrafos(R.texto).length && normTema(R.tema) !== normTema(tema) && !confirm('Trocar o tema? O texto que está na folha continua lá.')) return;
      R.tema = tema; g('red-tema').value = tema; salvarRed();
      mudarModo(R.modo === 'foto' ? 'foto' : 'folha');
      g('red-tema').closest('.card').scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  };
  $app.querySelectorAll('.ano').forEach(b => b.addEventListener('click', () => abrirAno(+b.dataset.ano)));
  { const a = anoDoTema(R.tema); if (a) abrirAno(a); }
  const desenharFotos = () => {
    g('red-fotos').innerHTML = fotosRed.map((f, k) => `<div class="red-foto"><img src="${f.url}" alt="Foto ${k + 1} da redação"><button class="btn mini" type="button" data-tirar="${k}">Remover</button></div>`).join('');
    g('red-fotos').querySelectorAll('[data-tirar]').forEach(b => b.addEventListener('click', () => { URL.revokeObjectURL(fotosRed[+b.dataset.tirar].url); fotosRed.splice(+b.dataset.tirar, 1); desenharFotos(); }));
  };
  desenharFotos();
  g('red-foto').addEventListener('change', async e => {
    for (const f of [...e.target.files].slice(0, 3 - fotosRed.length)) {
      try { fotosRed.push(await prepararFoto(f)); } catch (err) { alert(err.message); }
    }
    e.target.value = '';
    desenharFotos();
  });
  g('red-enviar').addEventListener('click', () => corrigirRedacao(g('red-ia'), g('red-enviar')));
}

function faixaNota(res) {
  const a = notaTotal(res, 'pessimista'), b = notaTotal(res, 'otimista');
  return a === b ? `${a}` : `${a}–${b}`;
}

function guiaHTML() {
  const sec = (titulo, corpo, aberta = false) => `<details class="logica-sec" ${aberta ? 'open' : ''}><summary>${titulo}</summary><div class="logica-corpo">${corpo}</div></details>`;
  return `<dialog class="logica-red" id="red-logica" aria-label="Como a correção funciona">
    <div class="logica-topo"><h2>Como a correção funciona</h2><button class="btn mini" type="button" data-fechar-logica>Fechar ✕</button></div>
    ${sec('A nota', `<p>Cinco competências de 0 a 200, em degraus de 40; a nota é a soma (até 1000). A IA dá um <b>cenário pessimista</b> (corretor rigoroso) e um <b>otimista</b> (corretor generoso) — a nota real costuma ficar entre os dois. Sem tema informado, a IA deduz pelo texto, mas aí não dá para saber se você tangenciou.</p>`, true)}
    ${sec('As cores dos trechos', `<p>${[1, 2, 3, 4, 5, 0].map(n => `<span class="m n${n}">${NIVEIS_RED[n][0]}</span> ${esc(NIVEIS_RED[n][1])}`).join('<br>')}</p><p>Erros de ortografia, acentuação, crase, concordância e pontuação são grifados no ponto exato, junto com o resto. Cada trecho tem a explicação e, quando dá, como ficaria melhor.</p>`)}
    ${sec('As 5 competências', `<ul class="lista red-comps">${GUIA.competencias.map(c => `<li><details><summary><span class="tit">C${c.n} · ${esc(c.nome)}</span></summary>
      <p class="small" style="margin:6px 0">${esc(c.o_que)}</p>
      <table class="tabela-dias red-niveis">${Object.entries(c.niveis).sort((x, y) => y[0] - x[0]).map(([k, v]) => `<tr><th>${k}</th><td>${esc(v)}</td></tr>`).join('')}</table></details></li>`).join('')}</ul>`)}
    ${sec('O que zera a redação', `<ul class="red-zeram">${GUIA.zeram.map(z => `<li>${esc(z)}</li>`).join('')}</ul>`)}
    ${sec('O que as notas 1000 têm em comum', `<ul class="lista red-comps">${GUIA.licoes.map(l => `<li><details><summary><span class="tit">${esc(l.titulo)}</span></summary><p class="small" style="margin:6px 0">${esc(l.texto)}</p></details></li>`).join('')}</ul><p>A IA usa essas lições como régua do que é “excelente”; nos temas do Desafio dos anos, usa também as redações reais nota 980–1000 daquele tema.</p>`)}
    ${sec('Folha, foto e tempo real', `<p><b>Folha:</b> 30 linhas como a oficial; cada linha comporta o mesmo que uma linha das redações nota 1000 (em média ${GUIA.media?.palavras || 466} palavras no texto todo). Enter começa parágrafo com recuo; sem corretor ortográfico, como na prova.</p><p><b>Foto:</b> a IA transcreve sua letra; leituras duvidosas só contam como erro no cenário pessimista.</p><p><b>Tempo real:</b> enquanto você escreve, a IA grifa trechos na folha (no máximo uma leitura a cada 40 s). Clique num trecho colorido para ver o comentário.</p>`)}
    ${sec('Desafio dos anos e cronograma', `<p>Meta: 900+ (média dos dois cenários) no tema de cada ENEM desde 2011. O cronograma marca as redações necessárias para fechar os ${TEMAS_ENEM.length} temas em até 1 ano (hoje ~2 por mês), no lugar das questões do dia — ou num dia híbrido, se você estiver atrasado nas questões.</p>`)}
  </dialog>`;
}

const SISTEMA_RED = () => `Você é um corretor experiente da banca de redação do ENEM, treinado na matriz do INEP. Corrige com rigor e com a didática de um bom professor de cursinho: diz o que está bom, o que está errado, por quê e como ficaria melhor. Escreve em português do Brasil, falando direto com o estudante ("você").

${GUIA.criterio()}`;

// redações reais nota 980–1000 do mesmo tema, como régua do que é excelente naquele tema
function refsDoTema(tema) {
  const a = anoDoTema(tema);
  const refs = REFS.anos.find(x => x.ano === a)?.redacoes || [];
  if (!refs.length) return '';
  return `REFERÊNCIA: redações reais que tiraram 980–1000 neste mesmo tema (ENEM ${a}), resumidas. Use como régua do que é excelente aqui — o estudante não precisa usar os mesmos repertórios nem a mesma estrutura:\n`
    + refs.map(r => `- ${r.nota}: introdução: ${r.introducao}; argumentos: ${(r.argumentos || []).join(' / ')}; proposta: ${r.proposta}`).join('\n') + '\n';
}
function pedidoRed(tema, modo) {
  return [
    refsDoTema(tema),
    tema ? `TEMA DA PROPOSTA: "${tema}"` : 'TEMA: o estudante não informou. Deduza o tema provável pelo texto, diga qual foi em "tema_usado" e avise no "resumo" que a C2 depende do tema real.',
    modo === 'foto'
      ? 'A redação está na(s) FOTO(S) anexada(s), escrita à mão. Primeiro transcreva o texto EXATAMENTE como está escrito (inclusive com os erros do estudante — não corrija nada na transcrição), separando parágrafos com \\n. Onde não tiver certeza da leitura de uma palavra, escreva a leitura mais provável e crie uma marcação com nivel 0 e tipo "leitura" para ela. Se uma palavra parece errada mas pode ser só a letra difícil de ler, marque como nivel 0 (não como erro).'
      : 'A redação foi digitada pelo estudante e está abaixo, entre <redacao> e </redacao>. Não a repita: deixe "transcricao" como "".',
    '',
    'Devolva SOMENTE um objeto JSON válido (sem ``` e sem texto fora dele), neste formato:',
    `{
  "transcricao": "texto completo transcrito da foto, ou \\"\\" se foi digitado",
  "tema_usado": "tema considerado na correção",
  "anulada": null,
  "marcacoes": [
    { "trecho": "cópia EXATA de um pedaço do texto", "nivel": 1, "tipo": "repertorio", "comp": 2,
      "titulo": "rótulo curto, até 6 palavras", "explicacao": "por que esse trecho funciona ou por que é um problema (1 a 3 frases)",
      "sugestao": "como o trecho ficaria melhor reescrito (vazio se nivel 1 ou 2)", "busca": "termo de busca para uma aula no YouTube sobre isso (vazio se não precisar)" }
  ],
  "competencias": [ { "n": 1, "pessimista": 120, "otimista": 160, "comentario": "2 a 3 frases justificando a faixa" } ],
  "resumo": "3 a 4 frases: o retrato geral da redação e o que mais faria a nota subir",
  "fortes": ["pontos fortes, frases curtas"],
  "estudar": [ { "titulo": "o que estudar", "porque": "por que isso é prioridade para você", "busca": "termo de busca no YouTube" } ],
  "portugues": [ { "regra": "a regra de português, explicada em 1 frase", "errado": "como você escreveu", "certo": "como fica certo", "busca": "termo de busca no YouTube" } ]
}`,
    '',
    'REGRAS DAS MARCAÇÕES:',
    '- "trecho" tem que ser uma cópia literal (mesmas letras, acentos e pontuação) de um pedaço do texto, para eu conseguir grifar. Prefira trechos curtos: de uma palavra até uma frase. Se a palavra se repete no texto, inclua 2 ou 3 palavras vizinhas para identificar o lugar certo.',
    '- "nivel": 1 = excelente (nível nota 1000), 2 = bom, 3 = pode melhorar (não é erro, mas outra forma renderia mais pontos), 4 = problema (provavelmente custa ponto), 5 = erro grave (custa ponto com certeza)' + (modo === 'foto' ? ', 0 = leitura duvidosa da foto.' : '.'),
    '- "tipo": ortografia, acentuacao, gramatica, pontuacao, crase, concordancia, regencia, coesao, repertorio, argumentacao, tese, proposta, estrutura, vocabulario, tema' + (modo === 'foto' ? ', leitura.' : '.'),
    '- "comp": a competência (1 a 5) afetada.',
    '- TODO erro de ortografia, acentuação, crase, concordância, regência e pontuação vira uma marcação própria no ponto exato em que acontece (trecho = a palavra ou expressão errada), com a forma correta em "sugestao".',
    '- Marque também o que está bom (níveis 1 e 2): tese, repertório bem usado, conectivos, proposta. Uma redação boa deve ter várias marcações verdes.',
    '- Para os trechos que podem melhorar (3, 4, 5), a "sugestao" é a reescrita completa do trecho, e a "explicacao" diz por que a nova versão funciona melhor.',
    '- Avalie a proposta de intervenção apontando quais dos 5 elementos (agente, ação, meio, finalidade, detalhamento) aparecem e quais faltam.',
    '- Faça de 12 a 35 marcações, na ordem em que aparecem no texto.',
    '',
    'REGRAS DA NOTA:',
    '- Cada competência só pode valer 0, 40, 80, 120, 160 ou 200. Dê as 5 competências, sempre com pessimista <= otimista.',
    '- Pessimista = um corretor rigoroso; otimista = um corretor generoso. A diferença costuma ser de 0 a 40 por competência (80 se houver dúvida real).' + (modo === 'foto' ? ' As leituras duvidosas (nivel 0) só contam como erro no cenário pessimista.' : ''),
    '- Se algo zera a redação inteira (fuga total ao tema, não ser dissertativo-argumentativo, até 7 linhas, parte desconectada), coloque o motivo em "anulada" e notas 0.',
    '',
    'REGRAS DO QUE ESTUDAR:',
    '- "estudar": 3 a 5 itens, do que mais aumenta a nota para o que menos. "portugues": uma dica para cada tipo de erro de português que apareceu (até 6). Pode ficar vazio se não houver erros.',
    '- "busca": termo curto e específico em português para achar uma aula boa no YouTube (ex.: "crase antes de palavra feminina regra", "proposta de intervenção 5 elementos ENEM", "repertório sociocultural produtivo redação ENEM"). Não invente links nem nomes de vídeos.',
  ].join('\n');
}

// correção em tempo real: pedido curto, só marcações, sobre um texto que ainda está sendo escrito
const SISTEMA_VIVO = () => `Você é um corretor da redação do ENEM acompanhando um estudante ENQUANTO ele escreve, como um professor olhando por cima do ombro. Aponta erros de português na hora, sugere formas melhores e reconhece o que está bom. Escreve em português do Brasil, falando com o estudante ("você"), em frases curtas.

COMPETÊNCIAS:
${GUIA.competencias.map(c => `C${c.n} ${c.nome}: ${c.o_que}`).join('\n')}`;
function pedidoVivo(tema, texto) {
  return [
    tema ? `TEMA: "${tema}"` : 'TEMA: não informado.',
    'O estudante AINDA ESTÁ ESCREVENDO. Texto até agora:',
    `<redacao>\n${texto}\n</redacao>`,
    '',
    'Devolva SOMENTE um JSON válido: {"marcacoes": [ { "trecho": "...", "nivel": 3, "tipo": "...", "comp": 1, "titulo": "...", "explicacao": "...", "sugestao": "..." } ]}',
    '- "trecho": cópia literal (mesmas letras, acentos e pontuação) de um pedaço do texto; curto (de uma palavra a uma frase). Se a palavra se repete, inclua as vizinhas para achar o lugar certo.',
    '- "nivel": 1 = excelente, 2 = bom, 3 = pode melhorar, 4 = problema, 5 = erro grave.',
    '- "tipo": ortografia, acentuacao, gramatica, pontuacao, crase, concordancia, regencia, coesao, repertorio, argumentacao, tese, proposta, estrutura, vocabulario ou tema. "comp": a competência (1 a 5).',
    '- "titulo": até 5 palavras. "explicacao": 1 ou 2 frases. "sugestao": como o trecho fica melhor, pronto para substituir o trecho (vazio nos níveis 1 e 2).',
    '- No máximo 15 marcações, na ordem do texto. TODO erro de ortografia, acentuação, crase, concordância, regência e pontuação vira marcação. Depois: frases confusas, repetições, conectivos, informalidade, repertório sem explicação, tese. Inclua 1 a 3 trechos bons (níveis 1 ou 2).',
    '- Ignore a última frase se ela parecer incompleta. Não aponte o que ainda não foi escrito (por exemplo, a falta de conclusão).',
  ].join('\n');
}
function lerMarcasVivo(txt) {
  let j;
  try { j = JSON.parse(txt.slice(txt.indexOf('{'), txt.lastIndexOf('}') + 1)); } catch { throw new Error('resposta em formato inesperado'); }
  return (Array.isArray(j.marcacoes) ? j.marcacoes : []).filter(m => m && m.trecho).slice(0, 20).map(m => ({
    trecho: String(m.trecho), nivel: Math.max(1, Math.min(5, Math.round(+m.nivel || 3))), tipo: String(m.tipo || ''), comp: +m.comp || 0,
    titulo: String(m.titulo || ''), explicacao: String(m.explicacao || ''), sugestao: String(m.sugestao || ''), busca: '',
  }));
}

// tira o JSON da resposta (às vezes vem com ``` ou texto em volta) e confere os campos
function lerCorrecao(txt, modo) {
  let j;
  try {
    const a = txt.indexOf('{'), b = txt.lastIndexOf('}');
    j = JSON.parse(txt.slice(a, b + 1));
  } catch { const e = new Error('a resposta não é um JSON válido'); e.formato = true; throw e; }
  if (!Array.isArray(j.competencias) || !Array.isArray(j.marcacoes)) { const e = new Error('faltam "competencias" ou "marcacoes" na resposta'); e.formato = true; throw e; }
  const degrau = v => Math.max(0, Math.min(200, Math.round((+v || 0) / 40) * 40));
  const comps = [1, 2, 3, 4, 5].map(n => {
    const c = j.competencias.find(x => +x.n === n) || {};
    let p = degrau(c.pessimista), o = degrau(c.otimista ?? c.pessimista);
    if (p > o) [p, o] = [o, p];
    return { n, pessimista: p, otimista: o, comentario: String(c.comentario || '') };
  });
  const lista = x => (Array.isArray(x) ? x : []);
  return {
    transcricao: modo === 'foto' ? String(j.transcricao || '').replace(/\r\n?/g, '\n').replace(/\\n/g, '\n') : '',
    tema_usado: String(j.tema_usado || ''),
    anulada: j.anulada ? String(j.anulada) : null,
    marcacoes: lista(j.marcacoes).filter(m => m && m.trecho).map(m => ({
      trecho: String(m.trecho), nivel: Math.max(0, Math.min(5, Math.round(+m.nivel || 0))) || (m.tipo === 'leitura' ? 0 : 3),
      tipo: String(m.tipo || ''), comp: +m.comp || 0, titulo: String(m.titulo || ''), explicacao: String(m.explicacao || ''),
      sugestao: String(m.sugestao || ''), busca: String(m.busca || ''),
    })),
    competencias: comps,
    resumo: String(j.resumo || ''),
    fortes: lista(j.fortes).map(String),
    estudar: lista(j.estudar).filter(x => x && x.titulo).map(x => ({ titulo: String(x.titulo), porque: String(x.porque || ''), busca: String(x.busca || x.titulo) })),
    portugues: lista(j.portugues).filter(x => x && x.regra).map(x => ({ regra: String(x.regra), errado: String(x.errado || ''), certo: String(x.certo || ''), busca: String(x.busca || x.regra) })),
  };
}

let corrigindo = false;
async function corrigirRedacao(el, botao) {
  const R = red.rascunho;
  const modo = R.modo === 'foto' ? 'foto' : 'texto';
  const texto = paraLivre((R.texto || '').replace(/\r\n?/g, '\n'));
  if (!chaveIA()) { el.innerHTML = '<p class="aviso">Para corrigir, escolha a IA e coloque sua chave de API em <a href="#/ajustes">Ajustes</a> (Claude, Gemini ou ChatGPT).</p>'; return; }
  if (location.protocol === 'file:') { el.innerHTML = '<p class="aviso">Abra o app pelo <b>INICIAR.bat</b> (servidor local) para usar a correção.</p>'; return; }
  if (modo === 'texto' && contarRed(texto).palavras < 30) { el.innerHTML = '<p class="aviso">Escreva a redação primeiro (o texto está muito curto para corrigir).</p>'; return; }
  if (modo === 'foto' && !fotosRed.length) { el.innerHTML = '<p class="aviso">Tire ou escolha a foto da folha primeiro.</p>'; return; }
  if (corrigindo) return;
  corrigindo = true;
  botao.disabled = true;
  const tema = (R.tema || '').trim();
  const fotos = modo === 'foto' ? fotosRed.map(({ data, mime }) => ({ data, mime })) : [];
  try {
    await rodarIA(el, {
      sistema: SISTEMA_RED(),
      pedido: pedidoRed(tema, modo) + (modo === 'texto' ? `\n\n<redacao>\n${texto}\n</redacao>` : ''),
      imgsDe: async () => fotos,
      etapa0: modo === 'foto' ? 'Preparando as fotos' : 'Preparando o texto',
      limite: 300, max: 20000, json: true,
      parcial: t => `<p class="small muted">Escrevendo a correção… ${(t.match(/"trecho"/g) || []).length} trechos analisados até agora.</p>`,
      processar: t => lerCorrecao(t, modo),
      aoTerminar: res => {
        const item = { id: Date.now().toString(36), data: new Date().toISOString(), tema: tema || res.tema_usado, modo, texto: modo === 'foto' ? res.transcricao : texto, res };
        red.hist.unshift(item);
        red.cont.n++; red.cont.palavras += contaPalavras(item.texto);
        red.hist = red.hist.slice(0, 40);
        salvarRed();
        el.dataset.id = item.id;
      },
      mostrar: () => { location.hash = '#/redacao/' + el.dataset.id; },
      tentarDeNovo: () => corrigirRedacao(el, botao),
    });
  } finally {
    corrigindo = false;
    if (botao.isConnected) botao.disabled = false;
  }
}

// acha o trecho no texto a partir de "desde"; tolera espaços, aspas e travessões diferentes e maiúsculas
function acharTrecho(texto, trecho, desde) {
  const t = trecho.trim();
  if (!t) return null;
  let i = texto.indexOf(t, desde);
  if (i < 0) i = texto.indexOf(t);
  if (i >= 0) return [i, i + t.length];
  const fonte = t.split(/\s+/).map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    .replace(/["“”]/g, '["“”]').replace(/['‘’]/g, "['‘’]").replace(/[-–—]/g, '[-–—]')).join('\\s+');
  for (const de of [desde, 0]) {
    const re = new RegExp(fonte, 'giu');
    re.lastIndex = de;
    const m = re.exec(texto);
    if (m) return [m.index, m.index + m[0].length];
  }
  return null;
}

// texto com os trechos grifados. Marcações podem se sobrepor (uma palavra errada dentro de uma frase boa):
// o texto é cortado em pedaços e cada pedaço leva a cor da marcação mais interna (a mais curta).
function textoMarcado(texto, marcas, numeros = true) {
  const spans = [];
  let desde = 0;
  marcas.forEach((m, k) => {
    const p = acharTrecho(texto, m.trecho, desde);
    m.pos = p;
    if (p) { spans.push({ a: p[0], b: p[1], k }); desde = p[0]; }
  });
  const cortes = [...new Set([0, texto.length, ...spans.flatMap(s => [s.a, s.b])])].sort((x, y) => x - y);
  let html = '';
  for (let c = 0; c < cortes.length - 1; c++) {
    const a = cortes[c], b = cortes[c + 1];
    const pedaco = esc(texto.slice(a, b));
    const cobre = spans.filter(s => s.a <= a && s.b >= b);
    if (!cobre.length) { html += pedaco; continue; }
    cobre.sort((x, y) => (x.b - x.a) - (y.b - y.a));
    const ks = cobre.map(s => s.k);
    const fim = numeros ? spans.filter(s => s.b === b && cobre.includes(s)).map(s => `<sup>${s.k + 1}</sup>`).join('') : '';
    html += `<mark class="m n${marcas[ks[0]].nivel}" data-ms="${ks.join(',')}"${numeros ? ' tabindex="0"' : ''}>${pedaco}${fim}</mark>`;
  }
  return html;
}

function cartaoMarca(m, k) {
  const [nome] = NIVEIS_RED[m.nivel] || NIVEIS_RED[3];
  return `<div class="red-marca n${m.nivel}" data-k="${k}">
    <div class="red-marca-topo"><span class="red-num">${k + 1}</span><span class="red-nivel n${m.nivel}">${nome}</span>
      <span class="small muted">${esc(TIPOS_RED[m.tipo] || m.tipo)}${m.comp ? ` · C${m.comp}` : ''}</span></div>
    ${m.titulo ? `<b>${esc(m.titulo)}</b>` : ''}
    <p class="red-trecho">“${esc(m.trecho)}”${m.pos ? '' : ' <span class="small muted">(não achei esse trecho exato no texto)</span>'}</p>
    ${m.explicacao ? `<p>${esc(m.explicacao)}</p>` : ''}
    ${m.sugestao && m.nivel !== 1 && m.nivel !== 2 ? `<p class="red-sugestao"><span class="small muted">${m.nivel === 0 ? 'Talvez seja' : 'Melhor assim'}:</span> ${esc(m.sugestao)}</p>` : ''}
    ${m.busca ? `<a class="btn mini" href="${linkYT(m.busca)}" target="_blank" rel="noopener">▶ Aula: ${esc(m.busca)}</a>` : ''}
  </div>`;
}

function verCorrecao(item) {
  const res = item.res;
  const texto = item.texto || '';
  const marcas = res.marcacoes;
  const pess = notaTotal(res, 'pessimista'), otim = notaTotal(res, 'otimista');
  const corpo = textoMarcado(texto, marcas);
  const contagem = [5, 4, 3, 2, 1, 0].map(n => [n, marcas.filter(m => m.nivel === n).length]).filter(([, q]) => q);
  $app.classList.add('larga');
  $app.innerHTML = `
    <p><a href="#/redacao">← Redação</a></p>
    <h1>${esc(item.tema || res.tema_usado || 'Redação')}</h1>
    <p class="muted small">${new Date(item.data).toLocaleString('pt-BR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })} · ${item.modo === 'foto' ? 'enviada por foto' : 'enviada como texto'} · ${contarRed(texto).linhas} linhas aprox.</p>
    <div class="red-layout">
      <div class="red-principal">
        <section class="card destaque red-nota">
          ${res.anulada ? `<p class="aviso"><b>Redação zerada:</b> ${esc(res.anulada)}</p>` : ''}
          <div class="red-nota-topo">
            <div><span class="small muted">Cenário pessimista</span><b class="n-pess">${pess}</b></div>
            <div class="red-faixa" title="de ${pess} a ${otim}"><i style="left:${pess / 10}%;width:${Math.max(0.8, (otim - pess) / 10)}%"></i><span style="left:0">0</span><span style="left:50%">500</span><span style="left:100%">1000</span></div>
            <div><span class="small muted">Cenário otimista</span><b class="n-otim">${otim}</b></div>
          </div>
          <p class="small muted" style="margin:6px 0 10px">Pessimista = corretor rigoroso${item.modo === 'foto' ? ', contando como erro as leituras duvidosas da foto' : ''}. Otimista = corretor generoso. Na prova, a nota final é a média de dois corretores.</p>
          <table class="red-comps-tab">${res.competencias.map(c => {
            const nome = GUIA.competencias[c.n - 1]?.nome || '';
            return `<tr><th>C${c.n}<span class="small muted"> ${esc(nome)}</span></th>
              <td class="red-mini"><span class="barra"><i style="margin-left:${c.pessimista / 2}%;width:${Math.max(1.5, (c.otimista - c.pessimista) / 2)}%"></i></span></td>
              <td class="num">${c.pessimista === c.otimista ? c.pessimista : `${c.pessimista}–${c.otimista}`}</td></tr>
              ${c.comentario ? `<tr class="coment"><td colspan="3">${esc(c.comentario)}</td></tr>` : ''}`;
          }).join('')}</table>
          ${res.resumo ? `<p style="margin:12px 0 0">${esc(res.resumo)}</p>` : ''}
          ${anoDoTema(item.tema) ? `<p class="small" style="margin:12px 0 0">🏅 Desafio dos anos — ENEM ${anoDoTema(item.tema)}: esta redação vale <b>${notaMedia(res)}</b> (média dos cenários). ${notaMedia(res) >= 900 ? 'Ano conquistado!' : `Faltam ${900 - notaMedia(res)} para 900.`} <a href="#/redacao">Ver referências do tema</a></p>` : ''}
        </section>

        <section class="card">
          <div class="titulo-linha"><h2>Seu texto corrigido</h2><span class="small muted">toque num trecho grifado</span></div>
          <div class="red-legenda">${contagem.map(([n, q]) => `<button class="red-filtro on" data-nivel="${n}" type="button"><span class="m n${n}">${NIVEIS_RED[n][0]}</span> ${q}</button>`).join('')}</div>
          ${item.modo === 'foto' ? '<p class="small muted" style="margin:0 0 8px">Este é o texto que a IA leu na foto. Se ela leu alguma palavra errado, use “Conferir a transcrição” lá embaixo, arrume e reenvie.</p>' : ''}
          <div class="red-texto" id="red-corpo">${corpo || '<p class="muted">(texto vazio)</p>'}</div>
        </section>

        <section class="card"><h2>Todas as marcações</h2><div class="red-lista" id="red-lista">${marcas.map(cartaoMarca).join('') || '<p class="muted">Nenhuma marcação.</p>'}</div></section>

        ${res.fortes.length ? `<section class="card"><h2>Pontos fortes</h2><ul class="red-pontos">${res.fortes.map(f => `<li>${esc(f)}</li>`).join('')}</ul></section>` : ''}

        ${res.estudar.length ? `<section class="card"><h2>O que estudar para subir a nota</h2><ol class="red-estudar">${res.estudar.map(x => `<li><b>${esc(x.titulo)}</b>
          ${x.porque ? `<p class="small" style="margin:2px 0 6px">${esc(x.porque)}</p>` : ''}
          <a class="btn mini" href="${linkYT(x.busca)}" target="_blank" rel="noopener">▶ Aulas no YouTube: ${esc(x.busca)}</a></li>`).join('')}</ol></section>` : ''}

        ${res.portugues.length ? `<section class="card"><h2>Dicas de português</h2><div class="red-port">${res.portugues.map(x => `<div class="red-dica">
          <p style="margin:0 0 6px">${esc(x.regra)}</p>
          ${x.errado || x.certo ? `<p class="small" style="margin:0 0 8px">${x.errado ? `<span class="red-errado">${esc(x.errado)}</span>` : ''}${x.errado && x.certo ? ' → ' : ''}${x.certo ? `<span class="red-certo">${esc(x.certo)}</span>` : ''}</p>` : ''}
          <a class="btn mini" href="${linkYT(x.busca)}" target="_blank" rel="noopener">▶ ${esc(x.busca)}</a></div>`).join('')}</div></section>` : ''}

        <section class="card">
          <div class="linha-btns" style="margin-top:0">
            <button class="btn" data-acao="reescrever" type="button">${item.modo === 'foto' ? '✍️ Conferir a transcrição e reenviar' : '✍️ Reescrever e corrigir de novo'}</button>
            <button class="btn perigo" data-acao="apagar" type="button">Apagar esta correção</button>
          </div>
          <p class="small muted" style="margin:8px 0 0">A nota é uma estimativa da IA, não a nota oficial. Use as faixas para ver a tendência entre uma redação e outra.</p>
        </section>
      </div>
      <aside class="red-painel" id="red-painel" hidden></aside>
    </div>
  `;
  const painel = document.getElementById('red-painel');
  const abrir = ks => {
    $app.querySelectorAll('mark.m.sel').forEach(x => x.classList.remove('sel'));
    $app.querySelectorAll(`mark.m[data-ms="${ks.join(',')}"]`).forEach(x => x.classList.add('sel'));
    painel.innerHTML = `<div class="red-painel-topo"><b>${ks.length > 1 ? `${ks.length} comentários neste trecho` : 'Comentário'}</b><button class="btn mini" type="button" data-fechar>Fechar ✕</button></div>${ks.map(k => cartaoMarca(marcas[k], k)).join('')}`;
    painel.hidden = false;
    painel.querySelector('[data-fechar]').addEventListener('click', () => { painel.hidden = true; $app.querySelectorAll('mark.m.sel').forEach(x => x.classList.remove('sel')); });
  };
  $app.querySelectorAll('#red-corpo mark.m').forEach(mk => {
    const ks = mk.dataset.ms.split(',').map(Number);
    mk.addEventListener('click', () => abrir(ks));
    mk.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); abrir(ks); } });
  });
  // da lista para o texto
  $app.querySelectorAll('#red-lista .red-marca').forEach(c => c.addEventListener('click', e => {
    if (e.target.closest('a')) return;
    const k = c.dataset.k;
    const mk = [...$app.querySelectorAll('#red-corpo mark.m')].find(x => x.dataset.ms.split(',').includes(k));
    if (!mk) return;
    mk.scrollIntoView({ behavior: 'smooth', block: 'center' });
    abrir(mk.dataset.ms.split(',').map(Number));
  }));
  // filtros por nível: esconde a cor dos níveis desligados
  $app.querySelectorAll('.red-filtro').forEach(b => b.addEventListener('click', () => {
    b.classList.toggle('on');
    document.getElementById('red-corpo').classList.toggle('sem-n' + b.dataset.nivel, !b.classList.contains('on'));
    document.getElementById('red-lista').classList.toggle('sem-n' + b.dataset.nivel, !b.classList.contains('on'));
  }));
  $app.querySelector('[data-acao=reescrever]').addEventListener('click', () => {
    red.rascunho = { tema: item.tema || '', texto: paraFolha(texto), modo: 'folha' };
    salvarRed();
    location.hash = '#/redacao';
  });
  $app.querySelector('[data-acao=apagar]').addEventListener('click', () => {
    if (!confirm('Apagar esta correção do histórico?')) return;
    red.hist = red.hist.filter(x => x.id !== item.id);
    salvarRed();
    location.hash = '#/redacao';
  });
}

// ---------------------------------------------------------------- redação no cronograma
// Quantas redações por mês: o necessário para tirar 900+ em todos os temas do desafio dos anos em até 1 ano
// (ritmoAnos). A situação nas questões (ritmo das últimas 2 semanas × prazo para terminar) ajusta:
//   adiantado (termina 2+ semanas antes) → +1 redação por mês, no lugar das questões do dia
//   em dia (ou ainda sem histórico)       → no lugar das questões do dia
//   atrasado                              → dia híbrido: redação + metade da meta de questões
//   reta final (só revisão)               → pelo menos 1 por semana
// As redações do mês se espalham igualmente pelo mês (no mês atual, pelos dias que restam), num dia de estudo. Redação perdida passa para o próximo
// dia de estudo; "Adiar" pula o dia; redação feita antes conta para a próxima âncora do mês. A meta de questões
// do cronograma é redistribuída: dia cheio de redação pesa 0 e dia híbrido pesa metade.
const FATOR_RED = { cheia: 0, hibrida: 0.5 };
red.feitas ||= [];
red.adiadas ||= [];
delete red.desafios;   // versão antiga guardava desafios de redação aqui
red.adiadas = red.adiadas.filter(d => d >= somaDias(hoje(), -90));
function situacaoQuestoes(h, fimNovas, previsao, ativos) {
  if (h > fimNovas) return 'reta';
  if (ativos < 3 || !previsao) return 'em dia';
  if (previsao <= somaDias(fimNovas, -14)) return 'adiantado';
  if (previsao > fimNovas) return 'atrasado';
  return 'em dia';
}
// dias (AAAA-MM-DD) em que houve redação: correções feitas no app + "já fiz no papel"
function diasComRedacao() {
  const s = new Set(red.feitas);
  for (const x of red.hist) s.add(iso(new Date(x.data)));
  return s;
}
// Redações por mês para conquistar 900+ em todos os temas do desafio dos anos em até 1 ano (ou até a prova):
// temas que faltam × tentativas esperadas por tema ÷ meses até o prazo. Adiantado nas questões: +1 por mês.
const TENTATIVAS_900 = 1.5;   // redações esperadas por tema até passar de 900, contando reescritas
function ritmoAnos(h, sit) {
  const m = placarAnos();
  const pend = TEMAS_ENEM.filter(([a]) => !(m[a] >= 900)).length;
  const prazo = [somaDias(h, 365), somaDias(st.cfg.prova, -7)].sort()[0];
  const meses = Math.max(1, diffDias(h, prazo) / 30.4);
  // arredonda para o mais perto: se ficar para trás, os meses seguintes recalculam com os temas que faltam
  let n = pend ? Math.round((pend * TENTATIVAS_900) / meses) : 1;
  if (sit === 'adiantado') n += 1;
  return { n: Math.min(6, Math.max(1, n)), pend, prazo };
}
function planoRedacao(h, fimNovas, P, previsao, ativos) {
  const sit = situacaoQuestoes(h, fimNovas, previsao, ativos);
  const feitas = diasComRedacao();
  const mesH = h.slice(0, 7);
  const feitasMes = [...feitas].filter(d => d.startsWith(mesH)).length;
  if (st.cfg.redacao === false) return { sit, ligado: false, dias: new Map(), feitas, feitasMes, metaMes: 0, fator: () => 1, hoje: null, proxima: null, ritmo: null };
  const prova = st.cfg.prova;
  const adiadas = new Set(red.adiadas);
  const ritmo = ritmoAnos(h, sit);
  const nMes = mes => (`${mes}-15` > fimNovas ? Math.max(ritmo.n, 4) : ritmo.n);   // reta final: pelo menos 1 por semana
  const tipoDe = d => (d <= fimNovas && sit === 'atrasado' ? 'hibrida' : 'cheia');
  const metaMes = nMes(mesH);
  const dias = new Map();
  for (let ini = `${mesH}-01`, k = 0; ini < prova && k < 36; k++) {
    const mes = ini.slice(0, 7);
    const [a, m] = mes.split('-').map(Number);
    const ultimo = iso(new Date(a, m, 0));
    const q = nMes(mes);
    let anc;
    if (mes === mesH) {
      // mês atual: as que faltam se espalham pelos dias que restam do mês
      const faltam = Math.max(0, q - feitasMes), resto = diffDias(h, ultimo) + 1;
      anc = Array.from({ length: faltam }, (_, i) => somaDias(h, Math.floor(((i + 0.5) * resto) / faltam)));
    } else {
      const dim = Number(ultimo.slice(8));
      anc = Array.from({ length: q }, (_, i) => `${mes}-${String(Math.max(1, Math.round(((i + 0.5) * dim) / q))).padStart(2, '0')}`);
    }
    let ant = '';
    for (const a0 of anc) {
      let d = a0 < h ? h : a0;   // âncora que já passou sem redação: vai para hoje (ou o próximo dia de estudo)
      if (d === h && feitas.has(h)) d = somaDias(h, 1);   // já fez uma hoje: a próxima não cai hoje
      if (ant && d < somaDias(ant, 3)) d = somaDias(ant, 3);   // pelo menos 3 dias entre duas redações
      while (d <= ultimo && d < prova && (!P[diaSemana(d)] || adiadas.has(d) || dias.has(d))) d = somaDias(d, 1);
      if (d > ultimo || d >= prova) continue;
      dias.set(d, tipoDe(d));
      ant = d;
    }
    ini = somaDias(ultimo, 1);
  }
  // redação feita hoje que conta para a meta do mês: hoje vira dia de redação (as questões não voltam para hoje)
  const hojeTipo = dias.get(h) || (feitas.has(h) && feitasMes <= metaMes ? tipoDe(h) : null);
  const proxima = [...dias.keys()].filter(d => d > h).sort()[0] || null;
  return {
    sit, ligado: true, dias, feitas, feitasMes, metaMes, ritmo,
    fator: d => (d === h ? (hojeTipo ? FATOR_RED[hojeTipo] : 1) : dias.has(d) ? FATOR_RED[dias.get(d)] : 1),
    hoje: hojeTipo ? { tipo: hojeTipo, feita: feitas.has(h) } : null,
    proxima: proxima ? { d: proxima, tipo: dias.get(proxima) } : null,
  };
}
// tema para a redação do dia: o primeiro (de um rodízio mensal) que você ainda não usou
// tema do dia de redação: primeiro os anos do desafio nunca tentados (do mais recente ao mais antigo), depois os
// que ainda não passaram de 900 (do mais perto de 900); com o desafio completo, temas de treino
function temaSugerido() {
  const m = placarAnos();
  const tentou = new Set(red.hist.map(x => anoDoTema(x.tema)).filter(Boolean));
  const nunca = TEMAS_ENEM.find(([a]) => !tentou.has(a));
  if (nunca) return nunca[1];
  const falta = TEMAS_ENEM.filter(([a]) => !(m[a] >= 900)).sort((x, y) => (m[y[0]] || 0) - (m[x[0]] || 0));
  if (falta.length) return falta[0][1];
  const usados = new Set(red.hist.map(x => (x.tema || '').toLowerCase()));
  const lista = [...(GUIA.temasTreino || []), ...TEMAS_ENEM.map(t => t[1])];
  const k0 = Number(hoje().slice(5, 7)) * 3;
  for (let i = 0; i < lista.length; i++) { const t = lista[(k0 + i) % lista.length]; if (!usados.has(t.toLowerCase())) return t; }
  return lista[k0 % lista.length] || '';
}
function abrirRedacaoDoDia() {
  const R = red.rascunho;
  if (!paragrafos(R.texto).length) { R.tema = temaSugerido(); if (R.modo === 'foto' && !fotosRed.length) R.modo = 'folha'; }
  salvarRed();
  location.hash = '#/redacao';
}

// meta das redações no cronograma (card "Seu caminho"): 900+ em todos os temas do desafio dos anos
function caminhoRedacao(p) {
  const rdc = p.redacao;
  if (!rdc.ligado) return '';
  const m = placarAnos();
  const total = TEMAS_ENEM.length;
  const feitos = TEMAS_ENEM.filter(([a]) => m[a] >= 900).length;
  const rt = rdc.ritmo;
  // no ritmo do cronograma: temas que faltam × tentativas por tema ÷ redações por mês
  const fim = rt.pend ? somaDias(hoje(), Math.ceil(((rt.pend * TENTATIVAS_900) / rt.n) * 30.4)) : null;
  return `<div><span class="small muted">Redação — <a href="#/redacao">Desafio dos anos</a></span><div class="barra"><i style="width:${Math.max(1, pct(feitos, total))}%"></i></div>
    <span class="small">${feitos} de ${total} temas com 900+ · ${rt.pend ? `${rt.n} ${rt.n === 1 ? 'redação' : 'redações'} por mês, fecha todos por volta de <b>${mesAno(fim)}</b>` : '🏅 todos conquistados'}</span></div>`;
}

// ---------------------------------------------------------------- desafio do dia (estudo)
// Um desafio por dia, escolhido no primeiro acesso do dia (em rodízio) entre os que fazem sentido hoje. O progresso
// sai das questões respondidas hoje; quando é cumprido fica marcado e conta na sequência de desafios.
function respostasHoje() {
  const h = hoje(), out = [];
  for (const [id, r] of Object.entries(st.q)) {
    if (!BYID[id]) continue;
    for (const t of r.h || []) if (t[0] === h) out.push({ q: BYID[id], letra: t[1], ok: t[2] === 1, seg: t[3] || 0, chute: !!t[4] });
  }
  return out;
}
const fmtMin = seg => (seg >= 60 ? `${Math.floor(seg / 60)}min${String(Math.round(seg % 60)).padStart(2, '0')}` : `${Math.round(seg)} s`);
// acao(p, f, arg, R) -> { rotulo, ir() } ou { rotulo, href }: o botão do card leva direto para o desafio
const faltaN = (alvo, feito) => Math.max(1, alvo - feito);
const DESAFIOS = [
  { id: 'alem', titulo: 'Passar da meta', se: p => p.hojeEstuda && !p.retaFinal && p.meta > 0,
    texto: p => `faça ${p.meta + 5} questões novas hoje, 5 além da meta.`,
    prog: (R, p) => ({ feito: p.novasHoje >= p.meta + 5, frac: p.novasHoje / (p.meta + 5), txt: `${p.novasHoje}/${p.meta + 5}` }),
    acao: p => { const n = Math.min(30, faltaN(p.meta + 5, p.novasHoje)); return { rotulo: `Fazer ${n} ${n === 1 ? 'nova' : 'novas'}`, ir: () => (faltaMeta() ? iniciar(Math.min(faltaMeta(), n), 'novas') : iniciar(n, 'novas', null, { extra: true })) }; } },
  { id: 'pontaria', titulo: 'Pontaria', se: () => true,
    texto: () => 'termine o dia com <b>70% de acerto</b> ou mais, em pelo menos 10 questões.',
    prog: R => {
      const n = R.length, a = pct(R.filter(x => x.ok).length, n);
      return { feito: n >= 10 && a >= 70, frac: Math.min(1, n / 10) * Math.min(1, a / 70), txt: n ? `${a}% em ${n}${n < 10 ? `/10` : ''}` : '0/10' };
    },
    acao: (p, f, a, R) => { const n = R.length < 10 ? 10 - R.length : st.cfg.bloco; return { rotulo: `Fazer ${n} questões`, ir: () => iniciar(n, 'misto') }; } },
  { id: 'area', titulo: 'Volta pelas áreas', se: () => true,
    arg: (p, n) => { const L = st.cfg.areas.length ? st.cfg.areas : ORDEM_AREAS; return L[n % L.length]; },
    texto: (p, a) => `responda <b>5 questões de ${AREAS[a]}</b> hoje (novas ou revisões).`,
    prog: (R, p, f, a) => { const n = R.filter(x => x.q.area === a).length; return { feito: n >= 5, frac: n / 5, txt: `${n}/5` }; },
    acao: (p, f, a, R) => { const n = faltaN(5, R.filter(x => x.q.area === a).length); return { rotulo: `Fazer ${n} de ${AREAS[a]}`, ir: () => iniciar(n, 'area', a) }; } },
  { id: 'fraco', titulo: 'Ataque ao ponto fraco', se: () => temasFoco().length > 0,
    arg: () => temasFoco()[0].c,
    texto: (p, c) => `responda <b>5 questões de ${esc(nomeAlvo(c))}</b>, um dos temas em que você mais erra.`,
    prog: (R, p, f, c) => { const n = R.filter(x => noAlvo(temaDe(x.q.id), c)).length; return { feito: n >= 5, frac: n / 5, txt: `${n}/5` }; },
    acao: (p, f, c, R) => { const n = faltaN(5, R.filter(x => noAlvo(temaDe(x.q.id), c)).length); return { rotulo: `Treinar ${nomeAlvo(c)}`, ir: () => iniciar(n, 'tema', c) }; } },
  { id: 'revisoes', titulo: 'Caderno em dia', se: (p, f) => f.revs + f.revFaltam >= 3,
    texto: () => 'zere as <b>revisões do dia</b> no caderno de erros.',
    prog: (R, p, f) => ({ feito: f.revFaltam === 0, frac: f.revs / Math.max(1, f.revs + f.revFaltam), txt: `${f.revs}/${f.revs + f.revFaltam}` }),
    acao: p => ({ rotulo: `Fazer as ${p.vencidas} ${p.vencidas === 1 ? 'revisão' : 'revisões'}`, ir: () => (sessaoDe('rev') ? retomar('rev') : iniciar(p.vencidas, 'rev')) }) },
  { id: 'ritmo', titulo: 'Ritmo de prova', se: () => true,
    texto: () => 'responda 10 questões hoje com <b>média de até 3 min</b> por questão (o tempo da prova).',
    prog: R => {
      const n = R.length, media = n ? R.reduce((s, x) => s + x.seg, 0) / n : 0;
      return { feito: n >= 10 && media <= 180, frac: Math.min(1, n / 10) * (media > 180 ? 180 / media : 1), txt: n ? `${Math.min(n, 10)}/10 · média ${fmtMin(media)}` : '0/10' };
    },
    acao: (p, f, a, R) => { const n = R.length < 10 ? 10 - R.length : st.cfg.bloco; return { rotulo: `Fazer ${n} no tempo de prova`, ir: () => iniciar(n, 'misto') }; } },
  { id: 'certeza', titulo: 'Sem chutar', se: () => true,
    texto: () => 'responda <b>10 questões sem chute</b> e sem “não sei” — só o que você sabe resolver.',
    prog: R => { const n = R.filter(x => !x.chute && x.letra !== '?').length; return { feito: n >= 10, frac: n / 10, txt: `${n}/10` }; },
    acao: (p, f, a, R) => { const n = faltaN(10, R.filter(x => !x.chute && x.letra !== '?').length); return { rotulo: `Fazer ${n} questões`, ir: () => iniciar(n, 'misto') }; } },
  { id: 'simulado', titulo: 'Mini simulado', se: () => !st.simulado || !!st.simulado.fim,
    texto: () => 'faça um <b>simulado</b> hoje, de qualquer tamanho, com o relógio ligado.',
    prog: () => { const ok = (st.simulados || []).some(x => x.data === hoje()); return { feito: ok, frac: ok ? 1 : 0, txt: ok ? '1/1' : '0/1' }; },
    acao: () => ({ rotulo: 'Montar o simulado', href: '#/simulado' }) },
];
function desafioHoje(p, f) {
  const h = hoje();
  let d = st.desafio;
  if (!d || d.d !== h || !DESAFIOS.some(x => x.id === d.id)) {
    const n = Math.max(0, diffDias('2026-01-05', h));
    const ok = DESAFIOS.filter(x => x.se(p, f));
    const x = ok[n % ok.length];
    d = st.desafio = { d: h, id: x.id, arg: x.arg ? x.arg(p, n) : null };
    salvar();
  }
  return { def: DESAFIOS.find(x => x.id === d.id), arg: d.arg };
}
function seqDesafio() {
  const F = st.desafiosFeitos || {};
  let d = hoje(), n = 0;
  if (!F[d]) d = somaDias(d, -1);
  while (F[d]) { n++; d = somaDias(d, -1); }
  return n;
}

// ---------------------------------------------------------------- ranking (opcional, Firebase)
// Placar da semana (questões respondidas, novas + revisões, de segunda a domingo), geral e por liga.
// Login anônimo: sem e-mail, só um apelido. O SDK do Firebase só é baixado por quem entra no ranking.
// Config: Console do Firebase › Configurações do projeto › Seus apps › Web. Não é segredo — quem protege
// os dados são as regras em tools/firestore.rules. Enquanto for null, o ranking fica escondido.
const FIREBASE = {
  apiKey: 'AIzaSyBwz63CUTUiWkh9gdZd4u9HcRUuRf7ptnM',
  authDomain: 'enem-2483a.firebaseapp.com',
  projectId: 'enem-2483a',
  storageBucket: 'enem-2483a.firebasestorage.app',
  messagingSenderId: '499670109099',
  appId: '1:499670109099:web:cc652f67856b7a954160ee',
};
const FB_VER = '10.14.1';
const RK_ESPERA = 15000;   // no máximo uma escrita a cada 15 s (as regras recusam menos de 10 s)
let fbP = null, rkEnviado = '', rkUltimo = 0, rkTimer = null, rkAba = null;

function segundaDaSemana(d = hoje()) { return somaDias(d, -((diaSemana(d) + 6) % 7)); }
function placarLocal() {
  const semana = segundaDaSemana(), dom = somaDias(semana, 6);
  let n = 0, ok = 0, total = 0;
  for (const [d, lg] of Object.entries(st.log)) {
    const x = (lg.n || 0) + (lg.r || 0);
    total += x;
    if (d >= semana && d <= dom) { n += x; ok += lg.ok || 0; }
  }
  return { semana, n, ok: Math.min(ok, n), total };
}
// baixa o SDK e espera o login salvo (Google ou anônimo) voltar; não entra em conta nenhuma
function carregarFirebase() {
  fbP ||= (async () => {
    const base = `https://www.gstatic.com/firebasejs/${FB_VER}/`;
    const [app, auth, fs] = await Promise.all(['firebase-app', 'firebase-auth', 'firebase-firestore'].map(x => import(base + x + '.js')));
    const a = app.initializeApp(FIREBASE);
    const au = auth.getAuth(a);
    await au.authStateReady();
    return { au, auth, fs, db: fs.getFirestore(a) };
  })().catch(e => { fbP = null; throw e; });
  return fbP;
}
// para o ranking: precisa da conta Google (o app inteiro pede o login antes de abrir)
async function conectarFirebase() {
  const f = await carregarFirebase();
  const u = f.au.currentUser;
  if (!u || u.isAnonymous) throw Object.assign(new Error('entre com a sua conta Google'), { code: 'sem-conta' });
  return { db: f.db, uid: u.uid, fs: f.fs };
}
function docMeu(fb, semana) { return fb.fs.doc(fb.db, 'semanas', semana, 'jogadores', fb.uid); }
async function rankingEnviar() {
  if (!FIREBASE || !st.ranking?.on) return;
  const p = placarLocal(), r = st.ranking;
  const chave = JSON.stringify([p, r.apelido, r.liga]);
  if (chave === rkEnviado) return;
  if (Date.now() - rkUltimo < RK_ESPERA) return rankingAgendar();
  const fb = await conectarFirebase();
  rkUltimo = Date.now();
  await fb.fs.setDoc(docMeu(fb, p.semana), { apelido: r.apelido, liga: r.liga || '', n: p.n, ok: p.ok, total: p.total, t: fb.fs.serverTimestamp() });
  rkEnviado = chave;
}
function rankingAgendar() {
  if (!FIREBASE || !st.ranking?.on || rkTimer) return;
  rkTimer = setTimeout(() => { rkTimer = null; rankingEnviar().catch(() => { /* sem rede: tenta no próximo salvar */ }); },
    Math.max(3000, RK_ESPERA - (Date.now() - rkUltimo)));
}
async function rankingLer(liga) {
  const fb = await conectarFirebase(), { fs, db, uid } = fb;
  const col = fs.collection(db, 'semanas', segundaDaSemana(), 'jogadores');
  // liga: filtra por igualdade e ordena aqui (as ligas são pequenas); geral: os 50 primeiros. Nenhuma das duas pede índice composto.
  const q = liga ? fs.query(col, fs.where('liga', '==', liga), fs.limit(300)) : fs.query(col, fs.orderBy('n', 'desc'), fs.limit(50));
  const lista = (await fs.getDocs(q)).docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => b.n - a.n);
  lista.forEach((x, i) => { x.pos = i && lista[i - 1].n === x.n ? lista[i - 1].pos : i + 1; });
  let fora = null;   // sua posição quando você não está entre os 50 do geral
  if (!liga && st.ranking?.on && !lista.some(x => x.id === uid)) {
    const meu = placarLocal().n;
    fora = { pos: (await fs.getCountFromServer(fs.query(col, fs.where('n', '>', meu)))).data().count + 1, n: meu };
  }
  return { lista, uid, fora };
}
function novaLiga() {
  const L = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';   // sem 0/O e 1/I, para ditar o código sem confusão
  return Array.from(crypto.getRandomValues(new Uint8Array(6)), b => L[b % L.length]).join('');
}
function limparLiga(s) { return String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12); }
function linkLiga(liga) { return `${location.origin}${location.pathname}#/ranking/${liga}`; }

function telaRanking(arg) {
  const r = st.ranking || {};
  const convite = limparLiga(arg);
  if (!FIREBASE) {
    $app.innerHTML = `<h1>Ranking</h1><section class="card"><p class="muted">O ranking ainda não foi configurado neste site.</p></section>`;
    return;
  }
  const semana = segundaDaSemana();
  if (!r.on) {
    $app.innerHTML = `
      <h1>Ranking</h1>
      <section class="card destaque">
        <h2>🏆 Ranking da semana</h2>
        <p>Quem respondeu mais questões de segunda a domingo (novas e revisões). Zera toda segunda, então dá para ganhar mesmo começando agora.</p>
        <p class="small muted">Aparece só o seu apelido, quantas questões você fez na semana e o acerto. Não use seu nome completo. Dá para sair quando quiser.</p>
        <label class="campo" for="rk-apelido">Apelido</label>
        <input type="text" id="rk-apelido" maxlength="20" placeholder="ex.: estudante42" value="${esc(r.apelido || '')}" autocomplete="off">
        <label class="campo" for="rk-liga">Código da liga (opcional)</label>
        <input type="text" id="rk-liga" maxlength="12" placeholder="para competir só com seus amigos" value="${esc(convite || r.liga || '')}" autocomplete="off" style="text-transform:uppercase">
        <p class="small muted">Sem liga você aparece só no ranking geral. Para criar uma, toque em “Criar liga” e mande o convite para a turma.</p>
        <p class="small" id="rk-erro" style="color:var(--erro)" hidden></p>
        <div class="linha-btns">
          <button class="btn primario" id="rk-entrar">Entrar no ranking</button>
          <button class="btn" id="rk-criar">Criar liga</button>
        </div>
      </section>`;
    const g = id => document.getElementById(id);
    g('rk-criar').addEventListener('click', () => { g('rk-liga').value = novaLiga(); });
    g('rk-entrar').addEventListener('click', async () => {
      const apelido = g('rk-apelido').value.trim().replace(/\s+/g, ' ');
      const liga = limparLiga(g('rk-liga').value);
      const erro = msg => { g('rk-erro').textContent = msg; g('rk-erro').hidden = false; };
      if (apelido.length < 2) return erro('O apelido precisa de pelo menos 2 letras.');
      const b = g('rk-entrar'); b.disabled = true; b.textContent = 'Entrando…';
      st.ranking = { on: true, apelido, liga };
      rkEnviado = '';
      salvar();
      try { await rankingEnviar(); rkAba = 'geral'; if (location.hash === '#/ranking') rota(); else location.hash = '#/ranking'; }
      catch (e) { st.ranking.on = false; salvar(); b.disabled = false; b.textContent = 'Entrar no ranking'; erro(e.code === 'auth/network-request-failed' || !navigator.onLine ? 'Sem conexão. Confira a internet e tente de novo.' : `Não deu para entrar (${e.code || e.message}).`); }
    });
    return;
  }
  if (!rkAba || (rkAba === 'liga' && !r.liga)) rkAba = 'geral';   // a tabela principal é a geral, de todo mundo; a liga é a aba extra
  const p = placarLocal();
  $app.innerHTML = `
    <h1>Ranking</h1>
    ${convite && convite !== r.liga ? `<section class="card destaque"><h2>Convite para a liga ${esc(convite)}</h2>
      <p class="small muted">${r.liga ? `Você está na liga ${esc(r.liga)}. Dá para estar em uma liga por vez.` : 'Você continua no ranking geral também.'}</p>
      <div class="linha-btns"><button class="btn primario" id="rk-aceitar">Entrar na liga ${esc(convite)}</button><a class="btn" href="#/ranking">Agora não</a></div></section>` : ''}
    <section class="card">
      <div class="titulo-linha"><h2>Semana de ${fmtCurto(semana)} a ${fmtCurto(somaDias(semana, 6))}</h2><span class="small muted">zera na segunda</span></div>
      <div class="grid2">
        <div class="stat"><b>${p.n}</b><span>questões suas nesta semana</span></div>
        <div class="stat"><b id="rk-pos">…</b><span id="rk-pos-txt">sua posição</span></div>
      </div>
      <div class="linha-btns">
        <button class="btn mini ${rkAba === 'geral' ? 'primario' : ''}" data-aba="geral">Geral</button>
        ${r.liga ? `<button class="btn mini ${rkAba === 'liga' ? 'primario' : ''}" data-aba="liga">Liga ${esc(r.liga)}</button>` : ''}
      </div>
      <div class="podio" id="rk-podio"></div>
      <ul class="lista rk-lista" id="rk-lista"><li class="muted">Carregando…</li></ul>
    </section>
    <section class="card">
      <h2>Você no ranking</h2>
      <p class="small muted">Apelido <b>${esc(r.apelido)}</b>${r.liga ? ` · liga <b>${esc(r.liga)}</b>` : ' · sem liga'}. O placar é enviado sozinho enquanto você estuda.</p>
      <div class="linha-btns">
        ${r.liga ? '<button class="btn" id="rk-convite">Copiar convite da liga</button>' : ''}
        <button class="btn" id="rk-mudar">Mudar apelido ou liga</button>
        <button class="btn perigo" id="rk-sair">Sair do ranking</button>
      </div>
      <p class="small muted" id="rk-copiado" hidden>Convite copiado — mande para a turma.</p>
    </section>`;
  const g = id => document.getElementById(id);
  g('rk-aceitar')?.addEventListener('click', () => { r.liga = convite; rkAba = 'liga'; salvar(); location.hash = '#/ranking'; });
  document.querySelectorAll('[data-aba]').forEach(b => b.addEventListener('click', () => { rkAba = b.dataset.aba; telaRanking(arg); }));
  g('rk-convite')?.addEventListener('click', async () => {
    const txt = `Entra na minha liga do ENEM Azul: ${linkLiga(r.liga)}`;
    try { await navigator.clipboard.writeText(txt); g('rk-copiado').hidden = false; } catch { prompt('Copie o convite:', txt); }
  });
  g('rk-mudar').addEventListener('click', () => { r.on = false; salvar(); telaRanking(arg); });
  g('rk-sair').addEventListener('click', async () => {
    if (!confirm('Sair do ranking? Seu placar desta semana é apagado do ranking (o seu progresso no app continua).')) return;
    try { const fb = await conectarFirebase(); await fb.fs.deleteDoc(docMeu(fb, semana)); } catch { /* sem rede: o placar some na segunda */ }
    st.ranking = { on: false, apelido: r.apelido, liga: '' };
    rkEnviado = '';
    salvar();
    telaRanking();
  });
  (async () => {
    try { await rankingEnviar(); } catch { /* lê mesmo assim */ }
    const d = await rankingLer(rkAba === 'liga' ? r.liga : '');
    if (rkAba !== 'liga') rkCache = { ...d, semana, quando: Date.now() };   // o cronograma e o trilho aproveitam
    const { lista, uid, fora } = d;
    const ul = g('rk-lista');
    if (!ul || !ul.isConnected) return;
    const medalha = n => ['🥇', '🥈', '🥉'][n - 1] || `${n}º`;
    const CORES = ['azul', 'rosa', 'verde', 'laranja', 'roxo'];
    const corDe = x => CORES[[...String(x.apelido || '')].reduce((s, c) => s + c.charCodeAt(0), 0) % CORES.length];
    const ini = x => esc((x.apelido || '?')[0].toUpperCase());
    // pódio: os 3 primeiros (2º, 1º, 3º, como num pódio de verdade); a lista segue do 4º
    const top = lista.slice(0, 3);
    const podio = g('rk-podio');
    if (podio) podio.innerHTML = top.length ? [top[1], top[0], top[2]].filter(Boolean).map(x => `<div class="podio-lugar cor-${corDe(x)} ${x.id === uid ? 'eu' : ''}">
        <span class="podio-medalha">${medalha(x.pos)}</span><span class="podio-ini">${ini(x)}</span>
        <b>${esc(x.apelido)}${x.id === uid ? ' (você)' : ''}</b>
        <div class="podio-degrau" style="height:${[130, 96, 72][Math.min(2, x.pos - 1)]}px">${x.n}</div></div>`).join('') : '';
    const resto = lista.slice(3);
    ul.hidden = !resto.length && top.length > 0;
    ul.innerHTML = resto.length ? resto.map(x => `<li class="${x.id === uid ? 'rk-eu' : ''}">
        <div class="rk-nome"><span class="rk-pos">${x.pos}</span><span class="rk-ini cor-${corDe(x)}">${ini(x)}</span><span class="tit">${esc(x.apelido)}${x.id === uid ? ' (você)' : ''}</span></div>
        <div class="rk-dir"><b class="rk-n">${x.n}</b><span class="small muted">${x.n ? `${pct(x.ok, x.n)}%` : ''}</span></div></li>`).join('')
      : top.length ? '' : '<li class="muted">Ninguém fez questões nesta semana ainda. Seja o primeiro!</li>';
    const eu = lista.find(x => x.id === uid);
    const pos = eu ? eu.pos : fora?.pos;
    g('rk-pos').textContent = pos ? `${pos}º` : '—';
    g('rk-pos-txt').textContent = rkAba === 'liga' ? `na liga, de ${lista.length}` : 'no ranking geral';
  })().catch(e => {
    const ul = g('rk-lista');
    if (!ul?.isConnected) return;
    ul.innerHTML = `<li class="muted">Não deu para carregar o ranking${navigator.onLine ? ` (${esc(e.code || e.message)})` : ': sem conexão'}.</li>`;
    g('rk-pos').textContent = '—';
  });
}

// ---------------------------------------------------------------- conta Google: progresso na nuvem (opcional)
// usuarios/{uid}                  → { rev, z, dados: estado (st) compactado, t }
// usuarios/{uid}/partes/redacoes  → { z, dados: redações (red) compactadas, t }
// Cada envio é uma transação: se a nuvem mudou desde a última sincronização deste aparelho (rev diferente),
// junta os dois lados antes de gravar. Juntar nunca perde tentativas: o histórico das questões é a união dos dois.
const KEY_CONTA = 'enem.conta';
const CHAVES_LOCAIS = ['apiKey', 'chaveGoogle', 'chaveOpenai'];      // chaves de API nunca saem do aparelho
const RED_LOCAL = ['rascunho', 'vivo', 'vivoMarcas', 'vivoTexto'];   // rascunho e correção ao vivo: só deste aparelho
const SYNC_ESPERA = 20000;
let conta = null;   // { uid, email, rev (versão da nuvem na última sincronização), enviado, quando, substituir }
try { conta = JSON.parse(localStorage.getItem(KEY_CONTA)); } catch { conta = null; }
let syncTimer = null, syncP = null, syncDeNovo = false, syncLido = 0, syncMsg = '';
function salvarConta() { if (conta) localStorage.setItem(KEY_CONTA, JSON.stringify(conta)); else localStorage.removeItem(KEY_CONTA); }
function gravarLocal() {   // grava sem marcar como mudança nova (não dispara outra sincronização)
  localStorage.setItem(KEY, JSON.stringify(st));
  try { localStorage.setItem(KEY_RED, JSON.stringify(red)); } catch { /* cheio: fica para o próximo salvarRed */ }
}
const chaveEnvio = (s, r) => `${s.mod || 0}|${r.mod || 0}`;

// ---- juntar dois progressos
function uniao(a = [], b = [], chave = x => JSON.stringify(x)) {
  const m = new Map();
  for (const x of [...(a || []), ...(b || [])]) if (!m.has(chave(x))) m.set(chave(x), x);
  return [...m.values()];
}
const porData = (x, y) => (x < y ? -1 : x > y ? 1 : 0);
function tentativasDe(s) { let n = 0; for (const r of Object.values(s.q || {})) n += r.h?.length || 0; return n; }
function mesclarQ(a, b) {
  const out = { ...a };
  const ult = r => r.h?.length ? r.h[r.h.length - 1][0] : '';
  for (const [id, rb] of Object.entries(b)) {
    const ra = a[id];
    if (!ra) { out[id] = rb; continue; }
    // estado (caixa, próxima revisão, motivo…) de quem respondeu por último; histórico: as tentativas dos dois
    const base = ult(rb) > ult(ra) || (ult(rb) === ult(ra) && (rb.h?.length || 0) > (ra.h?.length || 0)) ? rb : ra;
    const h = uniao(ra.h, rb.h).sort((x, y) => porData(x[0], y[0]));
    out[id] = { ...base, h };
  }
  return out;
}
function mesclarLog(a, b) {
  const out = { ...a };
  for (const [d, lb] of Object.entries(b)) {
    const la = a[d];
    if (!la) { out[d] = lb; continue; }
    const x = { ...lb, ...la };
    for (const k of Object.keys(lb)) if (typeof lb[k] === 'number' && typeof la[k] === 'number') x[k] = Math.max(la[k], lb[k]);
    out[d] = x;
  }
  return out;
}
// primeira: primeira sincronização deste aparelho — os ajustes vêm de quem tem mais questões feitas (um aparelho novo
// tem "mod" recente só por ter sido aberto, e não deve trocar a data da prova e os dias de estudo da conta pelos padrões)
function mesclarEstado(loc, rem, primeira) {
  const remNovo = primeira ? tentativasDe(rem) > tentativasDe(loc) : (rem.mod || 0) > (loc.mod || 0);
  const novo = remNovo ? rem : loc;
  const out = { ...loc, ...rem, ...novo };
  out.cfg = { ...padrao().cfg, ...novo.cfg };
  for (const k of CHAVES_LOCAIS) out.cfg[k] = loc.cfg?.[k] || '';
  if (/^#\/(estudar|simulado)/.test(location.hash)) {   // no meio de um bloco ou prova: não troca o bloco debaixo da pessoa
    out.sessao = loc.sessao; out.pausadas = loc.pausadas; out.simulado = loc.simulado;
  }
  out.q = mesclarQ(loc.q || {}, rem.q || {});
  out.log = mesclarLog(loc.log || {}, rem.log || {});
  out.simulados = uniao(loc.simulados, rem.simulados).sort((x, y) => porData(x.data, y.data));
  out.simAdiados = uniao(loc.simAdiados, rem.simAdiados);
  out.desafiosFeitos = { ...(rem.desafiosFeitos || {}), ...(loc.desafiosFeitos || {}) };
  // trilha de focos: em cada área, a etapa mais adiantada dos dois lados
  out.trilha = { ...(loc.trilha || {}) };
  for (const [a, e] of Object.entries(rem.trilha || {})) if (!out.trilha[a] || (e?.k || 0) > (out.trilha[a].k || 0)) out.trilha[a] = e;
  out.aulas = { ...(rem.aulas || {}), ...(loc.aulas || {}) };   // videoaulas vistas: união dos dois lados
  out.mod = Math.max(loc.mod || 0, rem.mod || 0);
  return out;
}
function mesclarRed(loc, rem) {
  const out = { ...rem, ...loc };
  out.hist = uniao(loc.hist, rem.hist, x => x.id).sort((x, y) => porData(y.data, x.data)).slice(0, 40);
  out.feitas = uniao(loc.feitas, rem.feitas);
  out.adiadas = uniao(loc.adiadas, rem.adiadas);
  out.cont = { n: Math.max(loc.cont?.n || 0, rem.cont?.n || 0), palavras: Math.max(loc.cont?.palavras || 0, rem.cont?.palavras || 0) };
  out.mod = Math.max(loc.mod || 0, rem.mod || 0);
  return out;
}

// ---- compactar (gzip) para caber folgado no limite de 1 MB por documento
async function empacotar(obj, fs) {
  const txt = JSON.stringify(obj);
  if (typeof CompressionStream === 'undefined') return { z: 0, dados: txt };
  const buf = await new Response(new Blob([txt]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer();
  return { z: 1, dados: fs.Bytes.fromUint8Array(new Uint8Array(buf)) };
}
async function desempacotar(d) {
  if (!d.z) return JSON.parse(d.dados);
  if (typeof DecompressionStream === 'undefined') throw new Error('navegador antigo demais para ler o progresso da nuvem');
  return JSON.parse(await new Response(new Blob([d.dados.toUint8Array()]).stream().pipeThrough(new DecompressionStream('gzip'))).text());
}
function semLocais(s) { const c = { ...s, cfg: { ...s.cfg } }; for (const k of CHAVES_LOCAIS) delete c.cfg[k]; return c; }
function redSemLocais(r) { const c = { ...r }; for (const k of RED_LOCAL) delete c[k]; return c; }
function trocarConteudo(alvo, novo) { for (const k of Object.keys(alvo)) delete alvo[k]; Object.assign(alvo, novo); }

// ---- sincronizar: lê a nuvem, junta se ela mudou, grava se algo mudou
function sincronizar() {
  if (!FIREBASE || !conta) return Promise.resolve();
  if (syncP) { syncDeNovo = true; return syncP; }
  syncP = (async () => {
    const f = await carregarFirebase();
    const u = f.au.currentUser;
    if (!u || u.isAnonymous || u.uid !== conta.uid) {
      // sessão do Google perdida (ex.: dados do site apagados em parte): pede o login de novo; o progresso daqui
      // continua no aparelho e é juntado com a conta quando a pessoa entrar
      conta = null; salvarConta(); rota();
      return;
    }
    const { fs, db } = f;
    // primeira sincronização deste aparelho: guarda antes uma cópia do progresso de convidado, por garantia
    if (conta.rev == null && Object.keys(st.q).length) {
      try { localStorage.setItem('enem.antes-da-conta', JSON.stringify({ quando: new Date().toISOString(), st, red })); } catch { /* cheio */ }
    }
    const dEst = fs.doc(db, 'usuarios', u.uid), dRed = fs.doc(db, 'usuarios', u.uid, 'partes', 'redacoes');
    const stIni = st, redIni = red, chaveIni = chaveEnvio(st, red);
    let res = null;
    await fs.runTransaction(db, async tx => {
      const sE = await tx.get(dEst), sR = await tx.get(dRed);
      const revNuvem = sE.exists() ? sE.data().rev || 0 : 0;
      let nSt = stIni, nRed = redIni, veio = false;
      if (sE.exists() && revNuvem !== conta.rev && !conta.substituir) {
        nSt = mesclarEstado(stIni, await desempacotar(sE.data()), conta.rev == null);
        if (sR.exists()) nRed = mesclarRed(redIni, await desempacotar(sR.data()));
        veio = true;
      }
      const grava = veio || revNuvem !== conta.rev || conta.substituir || chaveIni !== conta.enviado;
      if (grava) {
        tx.set(dEst, { rev: revNuvem + 1, ...(await empacotar(semLocais(nSt), fs)), t: fs.serverTimestamp() });
        tx.set(dRed, { ...(await empacotar(redSemLocais(nRed), fs)), t: fs.serverTimestamp() });
      }
      res = { nSt, nRed, veio, rev: grava ? revNuvem + 1 : revNuvem, enviado: chaveEnvio(nSt, nRed) };
    });
    if (res.veio) {
      // o que mudou aqui durante a transação também entra (st pode ter avançado enquanto a nuvem respondia)
      const finalSt = st === stIni && chaveEnvio(st, red) === chaveIni ? res.nSt : mesclarEstado(st, res.nSt, false);
      const finalRed = mesclarRed(red, res.nRed);
      trocarConteudo(st, finalSt);
      trocarConteudo(red, finalRed);
      gravarLocal();
    }
    Object.assign(conta, { rev: res.rev, enviado: res.enviado, quando: new Date().toISOString() });
    delete conta.substituir;
    salvarConta();
    syncLido = Date.now();
    syncMsg = '';
    if (chaveEnvio(st, red) !== conta.enviado) syncAgendar();
    if (res.veio && !playerAtual && !/^#\/(estudar|simulado)/.test(location.hash)) rota();   // mostra o que chegou do outro aparelho (não no meio de um vídeo)
  })().catch(e => {
    syncMsg = !navigator.onLine ? 'Sem internet — sincroniza quando voltar.' : `Não deu para sincronizar (${e.code || e.message}).`;
  }).finally(() => {
    syncP = null;
    atualizarSyncNaTela();
    if (syncDeNovo) { syncDeNovo = false; syncAgendar(); }
  });
  return syncP;
}
function syncAgendar(ms = SYNC_ESPERA) {
  if (!FIREBASE || !conta || syncTimer) return;
  syncTimer = setTimeout(() => { syncTimer = null; sincronizar(); }, ms);
}
function syncJa() { clearTimeout(syncTimer); syncTimer = null; return sincronizar(); }
function syncSubstituir() { if (!conta) return; conta.substituir = true; salvarConta(); syncJa(); }
// saiu do app (trocou de aba, bloqueou o celular): envia o que falta; voltou depois de 1 min: busca o que mudou
document.addEventListener('visibilitychange', () => {
  if (!conta) return;
  if (document.visibilityState === 'hidden') { if (syncTimer || chaveEnvio(st, red) !== conta.enviado) syncJa(); }
  else if (Date.now() - syncLido > 60000) syncJa();
});

// ---- entrar e sair
async function entrarGoogle() {
  const f = await carregarFirebase();
  const prov = new f.auth.GoogleAuthProvider();
  prov.setCustomParameters({ prompt: 'select_account' });
  const u = f.au.currentUser;
  let cred;
  if (u?.isAnonymous) {
    // promove o login anônimo do ranking para a conta Google (mesmo uid: o placar da semana continua)
    try { cred = await f.auth.linkWithPopup(u, prov); }
    catch (e) {
      if (e.code !== 'auth/credential-already-in-use') throw e;
      // essa conta Google já entrou em outro aparelho: troca para ela e apaga o placar do anônimo desta semana
      const c = f.auth.GoogleAuthProvider.credentialFromError(e);
      if (st.ranking?.on) { try { await f.fs.deleteDoc(f.fs.doc(f.db, 'semanas', segundaDaSemana(), 'jogadores', u.uid)); } catch { /* fica até segunda */ } }
      cred = await f.auth.signInWithCredential(f.au, c);
    }
  } else cred = await f.auth.signInWithPopup(f.au, prov);
  conta = { uid: cred.user.uid, email: cred.user.email || '', rev: null };
  salvarConta();
  rkEnviado = '';
  await syncJa();
  if (st.ranking?.on) rankingEnviar().catch(() => { /* vai no próximo salvar */ });
}
async function sairDaConta(f) {
  await f.auth.signOut(f.au);
  conta = null; salvarConta(); rkEnviado = '';
  clearTimeout(syncTimer); syncTimer = null; syncMsg = '';
}
// o aparelho pode ser compartilhado (computador da escola): ao sair, o progresso sai daqui — ele já está na conta
function limparAparelho() {
  st = padrao();
  trocarConteudo(red, { rascunho: { tema: '', texto: '', modo: 'folha' }, hist: [], cont: { n: 0, palavras: 0 } });
  gravarLocal();
  tinta = {};
  for (const k of [KEY_TINTA, 'enem.antes-da-conta']) localStorage.removeItem(k);
}
async function sairGoogle() {
  await syncJa();
  if (syncMsg || chaveEnvio(st, red) !== conta?.enviado) {
    throw Object.assign(new Error('não deu para salvar as últimas mudanças na nuvem'), { code: 'nao-salvou' });
  }
  await sairDaConta(await carregarFirebase());
  limparAparelho();
}
// apaga a conta: progresso e redações na nuvem, o placar da semana, o login e o progresso deste aparelho
async function apagarConta() {
  const f = await carregarFirebase();
  const u = f.au.currentUser;
  if (u) {
    await f.fs.deleteDoc(f.fs.doc(f.db, 'usuarios', u.uid, 'partes', 'redacoes'));
    await f.fs.deleteDoc(f.fs.doc(f.db, 'usuarios', u.uid));
    try { await f.fs.deleteDoc(f.fs.doc(f.db, 'semanas', segundaDaSemana(), 'jogadores', u.uid)); } catch { /* não estava no ranking */ }
    try { await f.auth.deleteUser(u); } catch { /* login antigo demais para apagar o usuário: os dados já foram */ }
  }
  await sairDaConta(f);
  limparAparelho();
}

// backup em .json (Ajustes › Exportar, e na tela de entrada antes do primeiro login); sem as chaves de API
function baixarBackup() {
  const dados = { versao: 1, exportado: new Date().toISOString(), estado: { ...st, cfg: { ...st.cfg, apiKey: '', chaveGoogle: '', chaveOpenai: '' } }, explicacoes };
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(dados)], { type: 'application/json' }));
  a.download = `enem-progresso-${hoje()}.json`;
  a.click();
}

// ---- tela de entrada (todo mundo entra com o Google antes de usar o app)
function telaEntrar() {
  const temProgresso = Object.keys(st.q).length > 0;
  $app.innerHTML = `
    <div class="entrar">
      <div class="entrar-hero">
        <div class="entrar-marca"><span class="logo">E</span><span>enem azul</span></div>
        <div>
          <h1>Todas as questões do ENEM. Um plano que se ajusta a você.</h1>
          <p>${milhar(POOL().length)} questões das provas azuis de 2010 a 2025. Errou? Ela volta no caderno de erros até você dominar.</p>
        </div>
        <div class="entrar-tags"><span>📅 Cronograma diário</span><span>✍️ Redação corrigida</span><span>🏆 Liga com amigos</span></div>
      </div>
      <div class="entrar-lado"><div class="entrar-caixa">
        <h2>${temProgresso ? 'Bem-vindo de volta!' : 'Bora começar?'}</h2>
        ${temProgresso ? `<p class="entrar-aviso"><b>Achamos ${milhar(tentativasDe(st))} ${tentativasDe(st) === 1 ? 'questão respondida' : 'questões respondidas'} neste navegador.</b> Ao entrar, esse progresso vai junto para a sua conta — nada se perde.</p>` : ''}
        <button class="btn entrar-google" id="entrar-google"><b aria-hidden="true">G</b>Continuar com Google</button>
        ${temProgresso ? '<button class="btn fantasma" id="entrar-backup" type="button">⬇ Baixar uma cópia do meu progresso antes</button>' : ''}
        <p class="small" id="entrar-erro" style="color:var(--erro);margin:0" hidden></p>
        <p class="small muted" style="margin:0">Com a conta, o progresso fica salvo na nuvem e abre igual no celular e no computador. No ranking aparece só o apelido que você escolher — nunca o seu nome ou e-mail. As chaves de API das IAs ficam só no seu aparelho.</p>
      </div></div>
    </div>`;
  carregarFirebase().catch(() => { /* sem rede: o botão tenta de novo */ });   // o popup do Google abre direto no clique
  document.getElementById('entrar-backup')?.addEventListener('click', baixarBackup);
  const b = document.getElementById('entrar-google');
  b.addEventListener('click', async () => {
    b.disabled = true; b.lastChild.textContent = 'Entrando…';
    try { await entrarGoogle(); rota(); }
    catch (e) {
      b.disabled = false; b.lastChild.textContent = 'Continuar com Google';
      if (['auth/popup-closed-by-user', 'auth/cancelled-popup-request'].includes(e.code)) return;
      const el = document.getElementById('entrar-erro');
      el.hidden = false;
      el.textContent = msgErroLogin(e);
    }
  });
}
function msgErroLogin(e) {
  return e.code === 'auth/popup-blocked' ? 'O navegador bloqueou a janela do Google. Permita pop-ups para este site e tente de novo.'
    : e.code === 'auth/network-request-failed' || !navigator.onLine ? 'Sem conexão. Confira a internet e tente de novo.'
    : `Não deu para entrar (${e.code || e.message}).`;
}

// ---- card em Ajustes
function quandoSync() {
  if (!conta?.quando) return 'ainda não sincronizado';
  const d = new Date(conta.quando), h = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  return iso(d) === hoje() ? `sincronizado hoje às ${h}` : `sincronizado em ${fmt(iso(d))} às ${h}`;
}
function cardConta() {
  if (!FIREBASE || !conta) return '';
  return `
    <section class="card" id="card-conta">
      <h2>Conta Google</h2>
      <p class="small">Conectado como <b>${esc(conta.email || 'sua conta Google')}</b>.</p>
      <p class="small muted" id="sync-estado">${esc(syncMsg || quandoSync())}</p>
      <p class="small muted">Na nuvem: questões, cronograma, ajustes e redações. Só neste aparelho: as chaves de API das IAs e os rabiscos.</p>
      <div class="linha-btns">
        <button class="btn" data-conta="agora">Sincronizar agora</button>
        <button class="btn" data-conta="sair">Sair da conta</button>
        <button class="btn perigo" data-conta="apagar">Apagar minha conta</button>
      </div>
      <p class="small muted">Sair guarda tudo na conta e limpa este aparelho (bom para computador compartilhado). Apagar remove o seu progresso da nuvem, deste aparelho e do ranking — exporte um backup antes se quiser guardar.</p>
    </section>`;
}
function atualizarSyncNaTela() {
  const el = document.getElementById('sync-estado');
  if (el) el.textContent = syncMsg || (syncP ? 'Sincronizando…' : quandoSync());
}
function ligarCardConta() {
  const card = document.getElementById('card-conta');
  if (!card) return;
  card.querySelectorAll('[data-conta]').forEach(b => b.addEventListener('click', async () => {
    const acao = b.dataset.conta;
    if (acao === 'sair' && !confirm('Sair da conta? O progresso fica salvo na sua conta e sai deste aparelho.')) return;
    if (acao === 'apagar' && !confirm('Apagar a sua conta? Todo o progresso some da nuvem, deste aparelho e do ranking. Não dá para desfazer.')) return;
    b.disabled = true;
    try {
      if (acao === 'agora') { const p = syncJa(); atualizarSyncNaTela(); await p; }
      else if (acao === 'sair') { await sairGoogle(); rota(); }
      else if (acao === 'apagar') { await apagarConta(); rota(); }
    } catch (e) {
      syncMsg = e.code === 'nao-salvou' ? 'Não deu para salvar as últimas mudanças na nuvem. Conecte-se à internet e tente sair de novo (assim nada se perde).'
        : msgErroLogin(e);
      atualizarSyncNaTela();
    }
    b.disabled = false;
  }));
}
if (conta && FIREBASE) setTimeout(() => syncJa(), 500);   // ao abrir: busca o que mudou em outro aparelho
// ---------------------------------------------------------------- trilho (coluna da direita, em telas largas)
// XP: tudo o que já foi feito, contado desde a primeira questão — 10 por acerto, 2 por erro (o esforço conta),
// 50 por desafio do dia cumprido, 100 por redação corrigida e 30 por simulado
const XP = { acerto: 10, erro: 2, desafio: 50, redacao: 100, simulado: 30 };
function xpTotal() {
  let x = 0;
  for (const r of Object.values(st.q)) for (const t of r.h || []) x += t[2] === 1 ? XP.acerto : XP.erro;
  return x + Object.keys(st.desafiosFeitos || {}).length * XP.desafio + (red.cont?.n || 0) * XP.redacao + (st.simulados || []).length * XP.simulado;
}
let rkCache = null;   // última leitura do ranking geral (trilho e cronograma): { quando, semana, lista, uid, fora }
function falaDoDia(pagina, itens) {
  const obrig = itens.filter(x => !x.opcional), falta = obrig.filter(x => !x.feito).reduce((s, x) => s + x.min, 0);
  const prox = obrig.find(x => !x.feito);
  return {
    '': !obrig.length ? 'Hoje é folga no plano. Quer fazer o desafio do dia mesmo assim?'
      : falta ? `Faltam ~${fmtDur(falta)} pra fechar o dia.${prox ? ` Começa por ${prox.titulo.toLowerCase()}?` : ''}` : 'Dia completo! Daqui pra frente é lucro. 🎉',
    questoes: 'Questão livre também conta no cronograma, viu?',
    simulado: 'Simulado no tempo de prova treina o ritmo do dia do ENEM.',
    redacao: 'Cada tema do Desafio dos anos acima de 900 vira medalha. Bora?',
    erros: 'Errar aqui é melhor que errar na prova.',
    pontos: 'Treinar o tema mais fraco é o que mais sobe a nota.',
    progresso: 'Olha o tanto que você já andou!',
    ranking: 'Cada questão da semana conta no placar.',
    ajustes: 'O cronograma recalcula sozinho quando você muda algo aqui.',
  }[pagina] || '';
}
function renderTrilho(pagina) {
  const el = document.getElementById('trilho');
  if (!el) return;
  if (document.body.classList.contains('foco') || document.body.classList.contains('sem-conta')) { el.innerHTML = ''; return; }
  const p = plano(), itens = agendaHoje(p, diaHoje(p));
  const des = itens.find(x => x.id === 'desafio');
  const r = st.ranking;
  const eu = minhaPosGeral();
  el.innerHTML = `
    <div class="tr-nums">
      <span class="tr-fogo" title="dias seguidos estudando">🔥 ${sequencia()}</span>
      <span class="tr-xp" title="XP: 10 por acerto, 2 por erro, 50 por desafio, 100 por redação, 30 por simulado">⚡ ${milhar(xpTotal())}</span>
      ${r?.on ? `<a class="tr-rk" href="#/ranking" title="sua posição no ranking da semana">🏆 ${eu ? `#${eu}` : '—'}</a>` : ''}
    </div>
    ${falaDoDia(pagina, itens) ? `<div class="tr-fala">💬 ${esc(falaDoDia(pagina, itens))}</div>` : ''}
    ${des ? `<section class="tr-card ${des.feito ? 'feito' : ''}">
      <div class="tr-card-topo"><b>🎯 Desafio do dia</b><span>+${XP.desafio} XP</span></div>
      <p>${esc(des.titulo.replace(/^Desafio: /, ''))}${des.feito ? ' — cumprido!' : ''}</p>
      <div class="tr-prog"><div class="barra"><i style="width:${des.feito ? 100 : Math.round(100 * Math.min(1, des.frac || 0))}%"></i></div></div>
    </section>` : ''}
    ${FIREBASE && r?.on && pagina ? `<section class="tr-card"><div class="tr-card-topo"><b>Ranking da semana</b><a href="#/ranking">ver tudo</a></div>
      <div id="tr-liga"><p class="small muted" style="margin:6px 0 0">Carregando…</p></div></section>` : ''}`;
  if (!(FIREBASE && r?.on)) return;
  // no cronograma o ranking geral já está no meio da tela: o trilho só mostra a sua posição
  rankingGeral().then(d => {
    const box = document.getElementById('tr-liga');
    if (box) box.innerHTML = linhasRanking(d, 5);
    const t = document.querySelector('.tr-rk'), pos = minhaPosGeral();
    if (t && pos) t.textContent = `🏆 #${pos}`;
  }).catch(() => { const box = document.getElementById('tr-liga'); if (box) box.innerHTML = '<p class="small muted" style="margin:6px 0 0">Sem conexão com o ranking agora.</p>'; });
}
// ranking geral da semana (todo mundo), guardado por 2 min: o trilho e o cronograma usam a mesma leitura
function rankingGeral() {
  const semana = segundaDaSemana();
  if (rkCache && rkCache.semana === semana && Date.now() - rkCache.quando < 120000) return Promise.resolve(rkCache);
  return rankingLer('').then(d => (rkCache = { ...d, semana, quando: Date.now() }));
}
function minhaPosGeral() {
  if (!st.ranking?.on || !rkCache) return null;
  return rkCache.lista.find(x => x.id === rkCache.uid)?.pos || rkCache.fora?.pos || null;
}
// os n primeiros do geral; se você ficou de fora, aparece embaixo com a sua posição
function linhasRanking(d, n) {
  const on = st.ranking?.on, top = d.lista.slice(0, n);
  if (!top.length) return '<p class="small muted" style="margin:6px 0 0">Ninguém pontuou nesta semana ainda. Seja o primeiro!</p>';
  const linha = (x, eu) => `<div class="tr-linha ${eu ? 'eu' : ''}"><b>${x.pos}</b><span class="tr-ini">${esc((x.apelido || '?')[0].toUpperCase())}</span><span class="tr-nome">${eu ? 'Você' : esc(x.apelido)}</span><span class="tr-n">${x.n}</span></div>`;
  let h = top.map(x => linha(x, on && x.id === d.uid)).join('');
  if (on && !top.some(x => x.id === d.uid)) {
    const eu = d.lista.find(x => x.id === d.uid) || (d.fora && { pos: d.fora.pos, n: d.fora.n, apelido: st.ranking.apelido });
    if (eu) h += `<div class="tr-sep">⋯</div>${linha(eu, true)}`;
  }
  return h;
}
// card do ranking geral no cronograma (quem ainda não entrou vê a tabela e o convite)
function cardRankingCrono() {
  if (!FIREBASE) return '';
  const on = st.ranking?.on, sem = segundaDaSemana();
  return `<section class="card">
    <div class="titulo-linha"><h2>🏆 Ranking da semana</h2><a class="small" href="#/ranking">${on ? 'ver tudo' : 'entrar'}</a></div>
    <p class="small muted" style="margin-top:0">Todo mundo que estuda pelo app · questões de ${fmtCurto(sem)} a ${fmtCurto(somaDias(sem, 6))} · zera na segunda</p>
    <div class="rk-crono" id="crono-rk"><p class="small muted">Carregando…</p></div>
    ${on ? '' : '<div class="linha-btns"><a class="btn primario" href="#/ranking">Entrar no ranking</a></div>'}
  </section>`;
}
function ligarRankingCrono() {
  if (!FIREBASE) return;
  const box = () => document.getElementById('crono-rk');
  rankingGeral().then(d => { const b = box(); if (b) b.innerHTML = linhasRanking(d, 10); })
    .catch(() => { const b = box(); if (b) b.innerHTML = '<p class="small muted">Sem conexão com o ranking agora.</p>'; });
}

// ---------------------------------------------------------------- rotas
function rota() {
  fecharPlayer();   // trocar de tela (ou redesenhar) fecha o vídeo — a posição fica guardada
  limpar.forEach(f => f());
  limpar = [];
  if (!QUESTOES.length) {
    $app.innerHTML = '<div class="card"><h2>Sem questões</h2><p>Rode <code>py tools/extrair.py</code> para gerar <code>app/data/questoes.js</code> a partir dos PDFs.</p></div>';
    return;
  }
  const semConta = !!FIREBASE && !conta;
  document.body.classList.toggle('sem-conta', semConta);
  if (semConta) { telaEntrar(); return; }
  const [, pagina = '', arg] = location.hash.split('/');
  const emProva = pagina === 'simulado' && st.simulado && !st.simulado.fim;
  $app.classList.toggle('larga', pagina === 'estudar' || pagina === 'ver' || emProva);
  document.body.classList.toggle('foco', pagina === 'estudar' || emProva);   // questão e prova: sem lateral nem trilho
  document.querySelectorAll('[data-nav]').forEach(a => a.classList.toggle('ativo',
    a.dataset.nav === ({ pontos: 'erros' }[pagina] || pagina || 'inicio')));
  try {
    if (pagina === 'estudar') telaEstudar();
    else if (pagina === 'simulado') telaSimulado();
    else if (pagina === 'pontos') telaPontos();
    else if (pagina === 'erros') telaErros();
    else if (pagina === 'progresso') telaProgresso();
    else if (pagina === 'ajustes') telaAjustes();
    else if (pagina === 'logica') telaLogica();
    else if (pagina === 'redacao') telaRedacao(arg);
    else if (pagina === 'questoes') telaQuestoes();
    else if (pagina === 'aulas') telaAulas(arg);
    else if (pagina === 'ranking') telaRanking(arg);
    else if (pagina === 'ver' && BYID[arg]) verQuestao(arg);
    else telaInicio();
  } catch (e) { mostrarFalha(e); return; }
  try { renderTrilho(pagina); } catch (e) { console.error(e); document.getElementById('trilho').innerHTML = ''; }   // o trilho é extra: se falhar, some
}
document.querySelector('[data-nav="ranking"]')?.toggleAttribute('hidden', !FIREBASE);
// tema claro/escuro: escolhido no <head> (salvo ou o do sistema); o botão da lateral troca e guarda
function rotuloBotaoTema() {
  const b = document.getElementById('troca-tema');
  if (b) b.innerHTML = document.documentElement.dataset.tema === 'escuro'
    ? '<span class="ic">☀️</span><span>Modo claro</span>' : '<span class="ic">🌙</span><span>Modo escuro</span>';
}
document.getElementById('troca-tema')?.addEventListener('click', () => {
  const t = document.documentElement.dataset.tema === 'escuro' ? 'claro' : 'escuro';
  document.documentElement.dataset.tema = t;
  try { localStorage.setItem('enem.tema', t); } catch { /* sem armazenamento: vale só nesta visita */ }
  rotuloBotaoTema();
});
rotuloBotaoTema();
window.addEventListener('hashchange', () => { window.scrollTo(0, 0); rota(); });
rota();
