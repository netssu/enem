"""
Gera app/data/temas.js (matéria e tema de cada questão) a partir de:
    tools/temas.json           lista de áreas › matérias › temas (código -> nome)
    tools/classificacao.tsv    id<TAB>código, uma linha por questão

Uso:
    py -P -E tools/temas.py [pasta_com_tsvs]

Com uma pasta, junta todos os .tsv dela em tools/classificacao.tsv antes de gerar.
"""
import glob
import json
import os
import re
import sys

raiz = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
tax = json.load(open(os.path.join(raiz, 'tools', 'temas.json'), encoding='utf-8'))
nomes = {c: [a, m, t] for a, ms in tax.items() for m, ts in ms.items() for c, t in ts.items()}
tsv = os.path.join(raiz, 'tools', 'classificacao.tsv')

if len(sys.argv) > 1:
    linhas = {}
    for f in sorted(glob.glob(os.path.join(sys.argv[1], '*.tsv'))):
        for ln in open(f, encoding='utf-8'):
            p = ln.strip().split('\t')
            if len(p) == 2:
                linhas[p[0].strip()] = p[1].strip()
    if os.path.exists(tsv):  # correções manuais já gravadas ganham
        for ln in open(tsv, encoding='utf-8'):
            p = ln.strip().split('\t')
            if len(p) == 3 and p[2] == 'manual':
                linhas[p[0]] = p[1]
    with open(tsv, 'w', encoding='utf-8', newline='\n') as f:
        for k in sorted(linhas):
            f.write(f'{k}\t{linhas[k]}\n')

src = open(os.path.join(raiz, 'app', 'data', 'questoes.js'), encoding='utf-8').read()
qs = json.loads(re.search(r'window\.QUESTOES = (.*);\s*$', src, re.S).group(1))
area = {q['id']: q['area'] for q in qs}
cls = {}
for ln in open(tsv, encoding='utf-8'):
    p = ln.strip().split('\t')
    if len(p) >= 2:
        cls[p[0]] = p[1]
erros = []
for i, c in cls.items():
    if i not in area:
        erros.append(f'{i}: id desconhecido')
    elif c not in nomes:
        erros.append(f'{i}: código inválido {c}')
    elif nomes[c][0] != area[i]:
        erros.append(f'{i}: {c} não é da área {area[i]}')
faltam = [i for i in area if i not in cls]
out = {i: c for i, c in cls.items() if i in area and c in nomes and nomes[c][0] == area[i]}
with open(os.path.join(raiz, 'app', 'data', 'temas.js'), 'w', encoding='utf-8') as f:
    f.write('window.TEMAS = ')
    json.dump({'nomes': nomes, 'q': out}, f, ensure_ascii=False, separators=(',', ':'))
    f.write(';\n')
print(len(out), 'classificadas;', len(faltam), 'sem tema', faltam[:10])
print('\n'.join(erros[:30]) or 'sem erros')
