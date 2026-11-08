"""
Confere os recortes das questões sem renderizar nada:

  CORTADA  -> uma linha de texto / imagem cruza a borda de um recorte (ficou pela metade)
  FORA     -> conteúdo da página que não caiu em nenhum recorte (pedaço de questão perdido)
  SEM_E    -> o recorte não contém a alternativa E (só nos anos em que dá para detectar pelo texto)

Uso: py -P -E tools/conferir.py <pasta_dos_pdfs> [anos...]
"""
import os
import re
import sys

import pymupdf

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import extrair  # noqa: E402

TOL = 1.5


def dentro(r, seg):
    return r.x0 >= seg.x0 - TOL and r.x1 <= seg.x1 + TOL and r.y0 >= seg.y0 - TOL and r.y1 <= seg.y1 + TOL


def ignorar(t):
    return extrair.ignorar_linha(t) or (t not in ('IMG', 'DRAW') and extrair.CHROME.search(t))


def conferir(doc, ano, dia):
    items = extrair.build_segments(doc)
    heads = extrair.collect_headers(doc)
    first_page = heads[0]['page']
    stop = {i for i, p in enumerate(doc) if extrair.STOP_PAGE.search(p.get_text()[:3000])}
    por_pag = {}
    for it in items:
        for p, r in it['segs']:
            por_pag.setdefault(p, []).append((it['num'], pymupdf.Rect(r)))
    problemas = []
    for p in range(first_page, len(doc)):
        if p in stop:
            continue
        page = doc[p]
        lines, top, bottom = extrair.page_layout(page)
        segs = por_pag.get(p, [])
        heads_p = [h for h in heads if h['page'] == p]
        for t, r in lines:
            if t == 'DRAW' or ignorar(t):
                continue
            if r.y1 < top or r.y0 > bottom or r.is_empty or r.width < 1:
                continue
            if t != 'IMG' and r.height > 40:  # caixas infladas de fórmulas matemáticas
                continue
            if t == 'IMG' and r.width * r.height < 60:
                continue
            contem = [n for n, s in segs if dentro(r, s)]
            if contem:
                continue
            if t == 'IMG' and r.width < 20 and r.height > 300:  # faixa decorativa na lateral
                continue
            # tolera sobreposição pequena (espaçamento entre linhas encostando no próximo cabeçalho)
            folga = [n for n, s in segs if (r & s).get_area() > 0.7 * r.get_area()]
            if folga:
                continue
            toca = [n for n, s in segs if (r & s).get_area() > 0.15 * r.get_area()]
            if toca:
                problemas.append(('CORTADA', ano, dia, toca[0], p + 1, t[:50]))
            else:
                # conteúdo antes do primeiro cabeçalho da página que não é continuação é normal na capa
                if not heads_p and not segs:
                    tipo = 'PAGINA_SEM_QUESTAO'
                else:
                    tipo = 'FORA'
                problemas.append((tipo, ano, dia, None, p + 1, t[:50]))
    return problemas


def main():
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    src = sys.argv[1]
    anos = [int(a) for a in sys.argv[2:]] or range(2010, 2026)
    total = {}
    for ano in anos:
        for dia, cad in ((1, 'C1'), (2, 'C7')):
            doc = pymupdf.open(os.path.join(src, f'ENEM_{ano}_D{dia}_{cad}_AZUL_PROVA.pdf'))
            for pr in conferir(doc, ano, dia):
                total[pr[0]] = total.get(pr[0], 0) + 1
                print(*pr)
    print('RESUMO', total)


if __name__ == '__main__':
    main()
