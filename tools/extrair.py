"""
Extrai as questões das provas azuis do ENEM (2010-2025) em imagens + gabarito.

Uso:
    py -P -E tools/extrair.py "C:/caminho/ENEM_AZUL_2010_2025_PDFs" app

Gera:
    app/data/questoes.js   (window.QUESTOES = [...])
    app/img/<ano>/<id>_<n>.jpg
"""
import json
import os
import re
import sys

import pymupdf
from PIL import Image

ZOOM = 2.8          # ~200 dpi: nítido mesmo ampliado
WEBP_QUALITY = 72

HDR = re.compile(r'^\s*QUEST[ÃA]O\s+(\d{1,3})\b', re.I)
PAGNUM = re.compile(r'^\s*\d{1,2}\s*$')
CHROME = re.compile(r'Caderno\s*\d|P[áa]gina\s*\d|\d\s*[º°ªo]?\s*dia\b|^\s*\*\w+\*\s*$|Exame Nacional|^\s*enem\s*\d{4}\s*$|(ENEM\d{4}){2,}', re.I)
SECTION = re.compile(r'TECNOLOGIAS|Quest[õo]es de \d+ a \d+|op[çc][ãa]o (ingl|espanhol)|^\s*\d{4}\s*$', re.I)
ALT = re.compile(r'^\s*([A-E])(?:\t|\s*$)')
SECTION2 = re.compile(r'^\s*(Rascunho\s*$|LINGUAGENS, C[ÓO]DIGOS|CI[ÊE]NCIAS DA NATUREZA|CI[ÊE]NCIAS HUMANAS|MATEM[ÁA]TICA E SUAS)')
TEXTO_BASE = re.compile(r'^\s*(?:Textos?|Imagem|Figura|Gr[áa]fico|Quadro|Tabela) (?:para|referente [àa]s) as quest[õo]es (?:de )?(\d+) (?:a|e) (\d+)', re.I)
STOP_PAGE = re.compile(r'PROPOSTA DE REDA|RASCUNHO DA REDA|INSTRU[ÇC][ÕO]ES|Transcreva a sua Reda')


def area_of(year, num):
    if year <= 2016:
        return ['CH', 'CN', 'LC', 'MT'][(num - 1) // 45]
    return ['LC', 'CH', 'CN', 'MT'][(num - 1) // 45]


def lang_range(year, day):
    # questões de língua estrangeira (duplicadas inglês/espanhol)
    if year <= 2016:
        return range(91, 96) if day == 2 else range(0)
    return range(1, 6) if day == 1 else range(0)


def page_lines(page):
    out = []
    for b in page.get_text('dict')['blocks']:
        if b.get('type') == 1:
            out.append(('IMG', pymupdf.Rect(b['bbox'])))
            continue
        for l in b.get('lines', []):
            t = ''.join(s['text'] for s in l['spans'])
            if t.strip():
                out.append((t, pymupdf.Rect(l['bbox'])))
    return out


def page_drawings(page):
    """Desenhos vetoriais (gráficos, figuras) como pseudo-linhas 'DRAW'."""
    H = page.rect.height
    out = []
    for d in page.get_drawings():
        r = d['rect']
        if r.height > 0.5 * H or r.width > 0.9 * page.rect.width:
            continue
        if r.width < 2.5 and r.height > 40:   # filete vertical entre colunas
            continue
        fill = d.get('fill')
        if d.get('color') is None and fill and min(fill) > 0.95:  # retângulo branco de fundo
            continue
        out.append(('DRAW', r))
    return out


def page_layout(page):
    """Retorna (linhas, topo_conteudo, base_conteudo)."""
    H = page.rect.height
    lines = page_lines(page)
    top, bottom = 18.0, H - 18.0
    for t, r in lines:
        if t == 'IMG':
            chrome = r.y1 < 0.08 * H
        else:
            chrome = CHROME.search(t) or (PAGNUM.match(t) and (r.y0 > 0.94 * H or r.y1 < 0.07 * H))
        if not chrome or len(t) > 70:
            continue
        if r.y1 < 0.11 * H and not HDR.match(t):
            top = max(top, r.y1 + 2)
        elif r.y0 > 0.92 * H:
            bottom = min(bottom, r.y0 - 2)
    draws = page_drawings(page)
    for _, r in draws:  # logotipos vetoriais no topo da página
        if r.y1 < 0.07 * H:
            top = max(top, r.y1 + 2)
    lines = lines + [d for d in draws if d[1].y0 >= top - 1 and d[1].y1 <= bottom + 1]
    return lines, top, bottom


def collect_headers(doc):
    heads = []
    for pi, page in enumerate(doc):
        W = page.rect.width
        for t, r in page_lines(page):
            if t == 'IMG':
                continue
            m = HDR.match(t)
            col = 0 if r.x0 < W / 2 - 20 else 1
            if m:
                heads.append(dict(num=int(m.group(1)), page=pi, col=col, y=r.y0, x=r.x0))
                continue
            b = TEXTO_BASE.match(t)
            if b:  # texto compartilhado por várias questões: vira um "cabeçalho" próprio
                heads.append(dict(num=None, base=(int(b.group(1)), int(b.group(2))), page=pi, col=col, y=r.y0, x=r.x0))
    heads.sort(key=lambda h: (h['page'], h['col'], h['y']))
    return heads


def col_rect(page, col, lx):
    W = page.rect.width
    if col == 0:
        return max(0, lx - 8), W / 2 - 3
    return W / 2 + 3, min(W, W - lx + 8)


def ignorar_linha(t):
    return t not in ('IMG', 'DRAW') and (SECTION.search(t) or SECTION2.search(t))


def shrink(lines, x0, x1, y0, y1, hard=None):
    """Ajusta o segmento ao conteúdo real. Retorna (y_fim, tem_alt_E, y_ini, x_ini, x_fim) ou None.

    Um elemento pertence ao segmento se o centro dele está na coluna e ele começa dentro da faixa
    vertical; o recorte final cresce para conter o elemento inteiro (nada fica cortado na borda)."""
    last = first = None
    lo, hi = x0, x1
    letras = set()
    for t, r in lines:
        cx = (r.x0 + r.x1) / 2
        if not (x0 - 4 <= cx <= x1 + 4):
            continue
        if r.y0 < y0 - 1 or r.y0 > y1 - 2:
            continue
        if t == 'DRAW' and (r.y1 > y1 + 1 or r.width > (x1 - x0) + 12):
            continue
        if ignorar_linha(t) or (t not in ('IMG', 'DRAW') and CHROME.search(t) and len(t) < 70 and r.y0 > y1 - 25):
            continue
        last = r.y1 if last is None else max(last, r.y1)
        first = r.y0 if first is None else min(first, r.y0)
        lo, hi = min(lo, r.x0 - 2), max(hi, r.x1 + 2)
        m = ALT.match(t) if t not in ('IMG', 'DRAW') else None
        if m:
            letras.add((m.group(1), round(r.x0), r.y0))
    if last is None:
        return None
    fim = min(last + 4, hard if hard is not None else y1 + 2)
    return fim, letras, max(y0, first - 4), max(0, lo), hi


def is_wide(lines, W, y0, y1):
    """True se a região tem conteúdo atravessando o meio da página (layout de coluna única)."""
    mid = W / 2
    for t, r in lines:
        if r.y0 < y0 - 1 or r.y1 > y1 + 1 or t == 'DRAW':
            continue
        if t != 'IMG' and (SECTION.search(t) or CHROME.search(t) or HDR.match(t)):
            continue
        if r.x0 < mid - 30 and r.x1 > mid + 30:
            return True
    return False


def alternativas_completas(marcas):
    """True se há marcadores C, D e E alinhados (mesmo x) e em ordem de cima para baixo."""
    for _, xe, ye in [m for m in marcas if m[0] == 'E']:
        ok = True
        prev = ye
        for letra in 'DC':
            cands = [y for l, x, y in marcas if l == letra and abs(x - xe) <= 4 and y < prev]
            if not cands:
                ok = False
                break
            prev = max(cands)
        if ok:
            return True
    return False


def build_segments(doc):
    heads = collect_headers(doc)
    layouts = [page_layout(p) for p in doc]
    lx = min(h['x'] for h in heads if h['col'] == 0)
    stop_pages = {i for i, p in enumerate(doc) if STOP_PAGE.search(p.get_text()[:3000])}
    result = []
    for i, h in enumerate(heads):
        nxt = heads[i + 1] if i + 1 < len(heads) else None
        p, c, ys = h['page'], h['col'], h['y'] - 4
        segs, letras, hops = [], set(), 0
        while True:
            page = doc[p]
            W = page.rect.width
            lines, top, bottom = layouts[p]
            lim = min([hh['y'] for hh in heads if hh['page'] == p and hh['y'] > ys + 8] + [bottom])
            wide = c == 0 and is_wide(lines, W, ys, lim)
            if wide:
                x0, x1 = max(0, lx - 8), min(W, W - lx + 8)
                same = nxt and nxt['page'] == p and nxt['y'] > ys + 8
            else:
                x0, x1 = col_rect(page, c, lx)
                same = nxt and nxt['page'] == p and nxt['col'] == c
            ye = (nxt['y'] - 3) if same else bottom
            s = shrink(lines, x0, x1, ys, ye, hard=(nxt['y'] - 0.5) if same else None)
            if s:
                segs.append((p, [s[3], ys if not segs else s[2], min(W, s[4]), s[0]]))
                letras |= {(l, x, y + 10000 * len(segs)) for l, x, y in s[1]}
            has_e = alternativas_completas(letras)   # as alternativas já apareceram: a questão acabou
            if same or has_e or hops >= 2:
                break
            # continua na próxima coluna/página?
            if c == 0 and not wide:
                c = 1
            else:
                p, c = p + 1, 0
            hops += 1
            if p >= len(doc) or p in stop_pages:
                break
            if nxt is None or (p, c) > (nxt['page'], nxt['col']):
                break
            ys = layouts[p][1]
            if nxt['page'] == p and nxt['col'] == c and nxt['y'] - ys < 35:
                break  # a próxima questão começa no topo dessa coluna
        result.append(dict(num=h['num'], base=h.get('base'), segs=segs))
    # textos-base: entram antes do enunciado de cada questão que os usa
    bases = [it for it in result if it['base']]
    out = [it for it in result if not it['base']]
    for b in bases:
        a, z = b['base']
        for it in out:
            if a <= it['num'] <= z:
                it['segs'] = b['segs'] + it['segs']
    return out


# ---------------- gabaritos ----------------
ANS = re.compile(r'^([A-E]|anulad[ao]|ANULAD[AO])$', re.I)


def parse_gabarito(path, day):
    doc = pymupdf.open(path)
    toks = ' '.join(p.get_text() for p in doc).split()
    lo, hi = (1, 90) if day == 1 else (91, 180)
    ans = {}
    i = 0
    while i < len(toks):
        t = toks[i]
        if t.isdigit() and lo <= int(t) <= hi and i + 1 < len(toks) and ANS.match(toks[i + 1]):
            n = int(t)
            a1 = toks[i + 1].upper()
            a1 = 'X' if a1.startswith('ANUL') else a1
            if i + 2 < len(toks) and ANS.match(toks[i + 2]) and not toks[i + 2].isdigit():
                a2 = toks[i + 2].upper()
                a2 = 'X' if a2.startswith('ANUL') else a2
                ans[n] = {'ING': a1, 'ESP': a2}
                i += 3
                continue
            ans.setdefault(n, a1)
            i += 2
            continue
        i += 1
    return ans


def parse_gabarito_2010(path):
    """Gabarito 2010 = prova com a alternativa correta circulada em verde."""
    doc = pymupdf.open(path)
    heads = collect_headers(doc)
    seen = {}
    for h in heads:
        k = seen.get(h['num'], 0)
        h['occ'] = k
        seen[h['num']] = k + 1
    ans = {}
    for pi, page in enumerate(doc):
        W = page.rect.width
        drs = page.get_drawings()
        greens = [d['rect'] for d in drs if d.get('color') and d['color'][1] >= 0.45
                  and d['color'][0] < 0.3 and d['rect'].width < 25]
        for g in greens:
            col = 0 if g.x0 < W / 2 - 20 else 1
            gy = (g.y0 + g.y1) / 2
            gx = (g.x0 + g.x1) / 2
            cand = [h for h in heads if (h['page'], h['col'], h['y']) <= (pi, col, gy)]
            if not cand:
                continue
            h = cand[-1]
            # marcadores das alternativas: pequenos círculos preenchidos alinhados ao círculo verde
            ys = sorted({round((d['rect'].y0 + d['rect'].y1) / 2) for d in drs
                         if d.get('fill') and max(d['fill']) < 0.3
                         and abs((d['rect'].x0 + d['rect'].x1) / 2 - gx) < 6
                         and 5 < d['rect'].width < 14})
            rows = []
            for y in ys:
                if not rows or y - rows[-1] > 4:
                    rows.append(y)
            same_col = h['page'] == pi and h['col'] == col
            if same_col:
                blk = [y for y in rows if y > h['y']][:5]
                offset = 0
            else:  # questão que começou na coluna anterior
                nh = [x['y'] for x in heads if x['page'] == pi and x['col'] == col]
                lim = min(nh) if nh else 1e9
                blk = [y for y in rows if y < lim]
                offset = 5 - len(blk)
            if not blk or not (blk[0] - 8 <= gy <= blk[-1] + 8):
                print('  ! 2010: não achei alternativas da questão', h['num'], 'pág', pi)
                continue
            idx = offset + min(range(len(blk)), key=lambda k: abs(blk[k] - gy))
            letter = 'ABCDE'[min(idx, 4)]
            if h['num'] in ans and isinstance(ans[h['num']], dict):
                ans[h['num']]['ESP' if h['occ'] else 'ING'] = letter
            elif h['num'] in lang_range(2010, 2) or h['num'] in lang_range(2010, 1):
                ans[h['num']] = {('ESP' if h['occ'] else 'ING'): letter}
            else:
                ans[h['num']] = letter
    return ans


def main():
    src, out = sys.argv[1], sys.argv[2]
    only = sys.argv[3:]  # anos opcionais
    os.makedirs(os.path.join(out, 'data'), exist_ok=True)
    questoes = []
    report = []
    mat = pymupdf.Matrix(ZOOM, ZOOM)
    for year in range(2010, 2026):
        if only and str(year) not in only:
            continue
        for day, cad in ((1, 'C1'), (2, 'C7')):
            prova = os.path.join(src, f'ENEM_{year}_D{day}_{cad}_AZUL_PROVA.pdf')
            gabp = os.path.join(src, f'ENEM_{year}_D{day}_{cad}_AZUL_GABARITO.pdf')
            if not os.path.exists(prova):
                print('faltando', prova)
                continue
            gab = parse_gabarito_2010(gabp) if year == 2010 else parse_gabarito(gabp, day)
            doc = pymupdf.open(prova)
            items = build_segments(doc)
            imgdir = os.path.join(out, 'img', str(year))
            os.makedirs(imgdir, exist_ok=True)
            occ = {}
            n_ok = 0
            for it in items:
                n = it['num']
                k = occ.get(n, 0)
                occ[n] = k + 1
                lang = None
                if n in lang_range(year, day):
                    lang = 'ESP' if k else 'ING'
                qid = f'{year}-{n:03d}' + (f'-{lang}' if lang else '')
                a = gab.get(n)
                if isinstance(a, dict):
                    a = a.get(lang) if lang else None
                    if a is None and lang == 'ESP':
                        a = gab.get(n, {}).get('ESP')
                if lang is None and isinstance(gab.get(n), dict):
                    a = None
                imgs, larguras = [], []
                for si, (pi, r) in enumerate(it['segs']):
                    fn = f'{qid}_{si}.webp'
                    pix = doc[pi].get_pixmap(matrix=mat, clip=pymupdf.Rect(r), alpha=False)
                    im = Image.frombytes('RGB', (pix.width, pix.height), pix.samples)
                    im.save(os.path.join(imgdir, fn), 'WEBP', quality=WEBP_QUALITY, method=4)
                    imgs.append(f'img/{year}/{fn}')
                    larguras.append(round(r[2] - r[0]))  # largura em pontos do PDF
                if not imgs:
                    report.append(f'{qid}: sem imagem')
                if not a:
                    report.append(f'{qid}: sem gabarito')
                else:
                    n_ok += 1
                questoes.append(dict(id=qid, ano=year, dia=day, num=n, area=area_of(year, n),
                                     lingua=lang, resp=a or '?', imgs=imgs, w=larguras,
                                     pag=it['segs'][0][0] + 1 if it['segs'] else None))
            print(f'{year} D{day}: {len(items)} questões, {n_ok} com gabarito')
    # links oficiais do INEP (kit de download), para o botão "ver prova original"
    provas = {}
    csvp = os.path.join(os.path.dirname(os.path.abspath(src)), 'links_enem_azul_2010_2025.csv')
    if os.path.exists(csvp):
        for linha in open(csvp, encoding='utf-8-sig').read().splitlines()[1:]:
            c = linha.split(';')
            if len(c) >= 4:
                provas[f'{c[0]}-{c[1]}'] = c[3]
    with open(os.path.join(out, 'data', 'questoes.js'), 'w', encoding='utf-8') as f:
        f.write('window.PROVAS = ')
        json.dump(provas, f, separators=(',', ':'))
        f.write(';\n')
        f.write('window.QUESTOES = ')
        json.dump(questoes, f, ensure_ascii=False, separators=(',', ':'))
        f.write(';\n')
    print('\n'.join(report) or 'tudo ok')
    print('total', len(questoes))


if __name__ == '__main__':
    main()
