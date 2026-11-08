"""
Extrai o texto de cada questão (mesmos recortes do extrair.py), para classificar matéria e tema.

Uso:
    py -P -E tools/textos.py "C:/caminho/ENEM_AZUL_2010_2025_PDFs" saida.json

Gera um JSON {id: texto}. O texto não vai para o app (só serve para a classificação).
"""
import json
import os
import re
import sys

import pymupdf

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from extrair import build_segments, lang_range  # noqa: E402


def limpar(t):
    t = re.sub(r'[ \t\u00a0]+', ' ', t)
    t = re.sub(r'\s*\n\s*', '\n', t)
    return t.strip()


def main():
    src, saida = sys.argv[1], sys.argv[2]
    textos = {}
    for year in range(2010, 2026):
        for day, cad in ((1, 'C1'), (2, 'C7')):
            prova = os.path.join(src, f'ENEM_{year}_D{day}_{cad}_AZUL_PROVA.pdf')
            if not os.path.exists(prova):
                print('faltando', prova)
                continue
            doc = pymupdf.open(prova)
            occ = {}
            for it in build_segments(doc):
                n = it['num']
                k = occ.get(n, 0)
                occ[n] = k + 1
                lang = None
                if n in lang_range(year, day):
                    lang = 'ESP' if k else 'ING'
                qid = f'{year}-{n:03d}' + (f'-{lang}' if lang else '')
                partes = [doc[pi].get_text(clip=pymupdf.Rect(r)) for pi, r in it['segs']]
                textos[qid] = limpar('\n'.join(partes))
            print(year, day, 'ok')
    with open(saida, 'w', encoding='utf-8') as f:
        json.dump(textos, f, ensure_ascii=False, indent=0)
    vazios = [k for k, v in textos.items() if len(v) < 80]
    print('total', len(textos), 'quase vazios', len(vazios), vazios[:20])


if __name__ == '__main__':
    main()
