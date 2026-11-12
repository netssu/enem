# Videoaulas do app (app/data/aulas.js): para trocar um vídeo, edite a lista abaixo e rode  py -X utf8 tools/aulas.py
# Cada tema: [(id do YouTube, título curto)]. O script confere cada vídeo no oEmbed do YouTube e pega canal e duração.

import json, re, sys, urllib.parse, urllib.request, concurrent.futures as cf

BASE = [
  ('B.ope', 'Números inteiros e expressões', [('FeEE5sJaUdM', 'Operações com números inteiros (negativos)'), ('BhDm2qGy780', 'Expressões numéricas: ordem das operações')]),
  ('B.mmc', 'MMC, MDC e divisibilidade', [('PmlNQeBfp7I', 'MMC — mínimo múltiplo comum'), ('MK4cSSdNTHo', 'MDC — máximo divisor comum')]),
  ('B.fra', 'Frações', [('BWFnqKYxgMo', 'Frações em 11 minutos'), ('ZU-DAqtVkmI', 'Soma e subtração de frações'), ('Gn7tM4F3Wck', 'As 4 operações com frações')]),
  ('B.dec', 'Decimais e dízimas', [('lA1lVOBTSlQ', 'Números decimais'), ('7O7KQxJGpx4', 'Dízima periódica e fração geratriz')]),
  ('B.pot', 'Potências e raízes', [('FzkAWvOAEUI', 'Potenciação'), ('WNG0UkUSoWY', 'Propriedades das potências'), ('oJx5IbJYYfQ', 'Radiciação')]),
  ('B.not', 'Notação científica', [('2C4T0qfs_o8', 'Notação científica'), ('DDUhzvzXCHA', 'Contas em notação científica')]),
  ('B.r3', 'Regra de três', [('q846Qdi-od8', 'Regra de três simples'), ('vKU-85u6yJw', 'Regra de três composta')]),
  ('B.equ', 'Equação do 1º grau', [('bWJrg5DyuMY', 'Equação do 1º grau'), ('eUQMLU8EBpY', 'Equação com frações')]),
  ('B.alg', 'Produtos notáveis e fatoração', [('UECy1XbL6w8', 'Produtos notáveis'), ('BoJaNfpV4Tk', 'Fatoração algébrica')]),
]
TEMAS = {
  'POR.int': [('XsN0e_xPyNI', 'Compreensão e interpretação de texto (revisão ENEM)'), ('OxTNN-IKcEQ', 'Guia de interpretação de textos')],
  'POR.gen': [('Ucjv4LT8CSg', 'Gêneros textuais'), ('ibwf_X3498c', 'Tipos textuais')],
  'POR.var': [('d0fZoLzsDlM', 'Variação linguística'), ('dffRZNrhQ7w', 'Variação linguística: exercícios')],
  'POR.fun': [('_KEEG860nIc', 'Funções da linguagem'), ('J-ZV7mbXnp0', 'Funções da linguagem: aula completa')],
  'POR.gra': [('IIU6i3UXyi0', 'Coesão e coerência'), ('5Z8ziZYcSdg', 'Coesão textual: tipos')],
  'POR.fig': [('n0e75nRstcU', 'Figuras de linguagem passo a passo'), ('iJ3yzYMwpPg', 'Figuras de linguagem mais cobradas')],
  'POR.arg': [('uiwfCGLKI20', 'Texto argumentativo'), ('ITTNZeK_nWc', 'Anúncio publicitário'), ('GELbJmnmHEM', 'Textos publicitários no ENEM')],
  'POR.tec': [('KY1mfdDaXUU', 'Gêneros digitais'), ('IjwebZ71KtU', 'Gêneros digitais no ENEM'), ('KT9L83OtYLs', 'Internet e redes sociais')],
  'LIT.esc': [('WGZFBePibF0', 'Linha do tempo das escolas literárias'), ('nzNytK7yVD4', 'As 5 escolas literárias que mais caem')],
  'LIT.poe': [('SUIr4ZQtYGk', 'Escansão (métrica do verso)'), ('M7okFxuX8fM', 'Romantismo: poesia'), ('PyojY1qM9pU', 'Modernismo 2ª geração: poesia')],
  'LIT.pro': [('FEx0rIcWhGY', 'Modernismo no Brasil'), ('UBxq1C4jVLE', 'Pré-Modernismo'), ('YlqUollEjyo', 'Modernismo 2ª geração: prosa')],
  'ART.vis': [('oqn1IfHRdNg', 'Introdução à história da arte'), ('WSoTmWM-wTk', 'Arte moderna no Brasil'), ('EH0x6Yw410g', 'Arte contemporânea')],
  'ART.mus': [('09oBIzEu0TI', 'Canção popular no ENEM'), ('W_DxNzFc_jg', 'Respondendo questões de Artes do ENEM')],
  'ART.cen': [('6wrUhc9iMWU', 'História do teatro e gêneros dramáticos'), ('jVmCiusH83o', 'Dança moderna e contemporânea'), ('8jRs5CZwbQM', 'Aulão de Arte: temas que mais caem')],
  'ART.pat': [('RJX-wTMONWM', 'Patrimônio histórico'), ('VenVTXlGR94', 'Cultura material e imaterial'), ('XuBktCcpi84', 'Cultura popular e cultura de massa')],
  'EDF.cor': [('FpWId03667E', 'Respondendo questões de Educação Física do ENEM')],
  'LE.ing': [('C-Mc6SlvrfM', 'Técnicas de leitura em inglês'), ('WOR5hbFIoSI', 'Inglês no ENEM: leitura e interpretação'), ('v6aSkZNgMKY', 'Respondendo questões de inglês do ENEM')],
  'LE.esp': [('sxzZphiJkug', '5 dicas de interpretação em espanhol'), ('d34itHg3TMA', 'Respondendo questões de espanhol do ENEM')],
  'HIS.ant': [('bpArabQHqA4', 'Grécia Antiga'), ('CEMMtJ0xMfs', 'Egito Antigo'), ('CTIs_RSPr84', 'Idade Média')],
  'HIS.mod': [('fxqxH5A3Ok8', 'Renascimento'), ('TBI-iFSBn58', 'Expansão marítima'), ('SIfoqzQtGEo', 'Absolutismo')],
  'HIS.con': [('I8q0S_XGwdg', 'Revolução Francesa'), ('t6nJNv-pNr8', 'Revolução Industrial'), ('EEOYAN2CWwM', 'Primeira Guerra Mundial'), ('eQ08AS5ZHQQ', 'Guerra Fria')],
  'HIS.col': [('6xFgUphkggw', 'Brasil Colônia'), ('I8sRO8QlN4c', 'Capitanias hereditárias')],
  'HIS.imp': [('eERlMeLvQlI', 'Brasil Império'), ('TzwFrYCd-6M', 'Primeiro Reinado')],
  'HIS.rep': [('Vw4HGHDWMjs', 'República Velha'), ('ZcTDWBqUju8', 'Era Vargas'), ('HGrq8Eit31E', 'Ditadura militar')],
  'HIS.afr': [('5gtxfsHuf5c', 'Escravidão no Brasil'), ('-VKjEOvGhgs', 'Escravidão africana')],
  'GEO.car': [('tR_rXa4BdpE', 'Cartografia'), ('zHxRW7xdgbs', 'Cartografia no ENEM')],
  'GEO.cli': [('D3YQ6zl3-2M', 'Clima: elementos e fatores'), ('zd8R5BLWjyM', 'Climas do Brasil')],
  'GEO.nat': [('BccU6aDEuC0', 'Classificação do relevo'), ('YjULv1hxxZQ', 'Solos: intemperismo e erosão')],
  'GEO.urb': [('4ayDPXtQR5w', 'Urbanização'), ('JhURjqj2te0', 'Conurbação, metrópoles e megacidades')],
  'GEO.agr': [('DQayIlyi5LU', 'Espaço rural brasileiro'), ('5BDDygVfc98', 'Agricultura no Brasil')],
  'GEO.eco': [('PAf4nl2CcLs', 'Industrialização brasileira'), ('fEijZivtS80', 'Fontes de energia')],
  'GEO.glo': [('5STtrQ7M4Xc', 'Globalização'), ('Uhgh6cAOhCg', 'Geopolítica mundial')],
  'FIL.ant': [('TIIzrsbx74E', 'Pré-socráticos'), ('4VzqshtvrcE', 'Filosofia antiga'), ('rNQbsOsWKWs', 'Filosofia medieval')],
  'FIL.mod': [('dq9NU31PqwU', 'Filosofia moderna'), ('0a1Y54rEkdE', 'Descartes'), ('5jrGMeGYc3w', 'Iluminismo')],
  'FIL.con': [('r1YjaQn3Wao', 'Filosofia contemporânea'), ('OZM86dtBFr8', 'Nietzsche'), ('2cRmI_bYEyc', 'Escola de Frankfurt')],
  'FIL.eti': [('FHF1HBpjLXw', 'Ética em Aristóteles'), ('PUUNVm5gkGE', 'Filosofia política'), ('rrMeyTQW_Qk', 'Maquiavel')],
  'SOC.cid': [('c3mjvCfwRxc', 'Cidadania'), ('nu505BvywsU', 'Movimentos sociais')],
  'SOC.cul': [('GgmlGTFrD3g', 'O que é cultura'), ('EeyTnQRMmWE', 'Identidade cultural'), ('rBHf-A6-VgY', 'Indústria cultural')],
  'SOC.tra': [('igRSkgPZwrI', 'Sociologia do trabalho'), ('UG6PTnPpYrM', 'Trabalho em Durkheim, Marx e Weber')],
  'SOC.teo': [('s9rk_2TbWAY', 'Durkheim, Weber e Marx'), ('L-A8u46YUss', 'Durkheim e o fato social'), ('FJ7FwQsDWvk', 'Karl Marx'), ('rIDG6g1spSE', 'Max Weber')],
  'BIO.cel': [('rjH2xzCwNx0', 'Citologia: a célula e as organelas'), ('N33jWXzV8RU', 'Introdução à citologia')],
  'BIO.gen': [('YjwYJHqxwFY', 'Genética: principais conceitos'), ('2rqEmRrtkYc', 'Introdução à genética'), ('UGj4x0uAuio', '1ª Lei de Mendel')],
  'BIO.evo': [('4WO-A_GaA1o', 'Evolução'), ('Uodc0C4jFQs', 'Seleção natural no ENEM')],
  'BIO.fis': [('gz9BSAnNjKE', 'Sistemas do corpo humano'), ('zrf6_UJlK-0', 'Introdução à fisiologia')],
  'BIO.sau': [('nc2Z5e85x7o', 'Doenças que mais caem no ENEM'), ('rMIRzIHxdXY', 'Viroses')],
  'BIO.ser': [('wHN_qohious', 'Botânica: os grupos de plantas'), ('wX2T2CaVmaA', 'Introdução à zoologia')],
  'BIO.eco': [('TsclSi3nNsI', 'Ecologia: conceitos e fluxo de energia'), ('KKELP-3_Dlk', 'Como ecologia é cobrada no ENEM')],
  'BIO.tec': [('VYC9v9E9-xQ', 'Células-tronco, clonagem e transgênicos'), ('gEpO_ultTBo', 'Biotecnologia no ENEM')],
  'QUI.ger': [('5-fa4IKp5bU', 'Modelos atômicos'), ('Vsnq2hJ2UZc', 'Tabela periódica'), ('FDnxddw0P1g', 'Ligações químicas')],
  'QUI.est': [('50ogm-FXbo8', 'O que é mol'), ('9PH2whlpg4o', 'Estequiometria'), ('0FiaUwO5MDg', 'Soluções: concentração')],
  'QUI.fqu': [('esqhgvFljIY', 'Termoquímica'), ('bqIFA-x6FpE', 'Cinética química'), ('Wz2QLkV9Q98', 'Equilíbrio químico')],
  'QUI.ele': [('-RU1ywag0Dg', 'Eletroquímica'), ('NnA2x4YAylQ', 'Pilhas'), ('36-X8zqlb8w', 'Eletrólise')],
  'QUI.org': [('fY8E1dhNGNc', 'Química orgânica: comece aqui'), ('4zyWZlx7vVE', 'Funções orgânicas')],
  'QUI.amb': [('B9vpbIbsg9A', 'Química ambiental'), ('A8J07TaDiDA', 'Química ambiental: aula')],
  'FIS.mec': [('a7RxDGo8Zks', 'Cinemática: conceitos iniciais'), ('kbaN17Z41ZM', 'Resumão de cinemática'), ('W9fnE9NdFzo', 'As 3 leis de Newton')],
  'FIS.ene': [('9vriJYiTmbg', 'Energia mecânica'), ('GbywMXWHS7E', 'Trabalho e energia no ENEM')],
  'FIS.hid': [('fHXIyKetL1k', 'Hidrostática: densidade e pressão'), ('M58YeFoINmk', 'Teorema de Stevin')],
  'FIS.ter': [('2p1-Tz6Un10', 'Introdução à termologia'), ('5ewPE5DsdGo', 'Calorimetria'), ('GYxXCr6HXcw', 'Termodinâmica')],
  'FIS.opt': [('QKPj0f3mN5c', 'Óptica geométrica: conceitos'), ('DYVyeOByJkQ', 'Lentes'), ('YW1M2c6__0k', 'Óptica no ENEM')],
  'FIS.ond': [('Rmgqv8ETn6o', 'Ondulatória: características das ondas'), ('_8NrtppsCW4', 'Fenômenos ondulatórios')],
  'FIS.ele': [('EaUKawWYLA4', 'Corrente elétrica'), ('yfGAhEtqkbk', 'Resumão de eletrodinâmica'), ('DOHUL_ddpNM', 'Magnetismo')],
  'FIS.mod': [('USGENeYkBd4', 'Efeito fotoelétrico'), ('wphktISJEIM', 'Radioatividade'), ('5gnfopxcKjk', 'Física moderna em 30 minutos')],
  'ARI.ope': [('wLlQdu-q6dc', 'Principais fórmulas de matemática do ENEM'), ('XFs9AmEvu5w', '5 questões de matemática básica que não dá para errar')],
  'ARI.raz': [('GjxEHeAKWAU', 'Proporção em 8 minutos'), ('Kf_YzZ0CnIs', 'Razão e proporção'), ('ffi2FcdxKiA', 'Razão e proporção no ENEM: questões')],
  'ARI.por': [('azedx0uou64', 'Porcentagem em 8 minutos'), ('3EefFSEF8Ds', 'Aumento e desconto'), ('Uth75BB0ASU', 'Juros simples e compostos'), ('ZMsieXqXwMg', 'Juros compostos')],
  'ARI.med': [('AEq9ykJkR2U', 'Medidas de comprimento'), ('105pfqwyduw', 'Medidas de volume'), ('bAci_Mkqd1w', 'Escala e unidades no ENEM')],
  'ALG.equ': [('Tu08PYjt-2Q', 'Equação do 1º grau: interpretação'), ('tBU853Fh4e8', 'Sistemas de equações')],
  'ALG.fun': [('nysu0K-VXR8', 'Função do 1º grau'), ('ZpW9Xb5iyt4', 'Função do 2º grau')],
  'ALG.exp': [('gMGz-dB9few', 'Função exponencial'), ('k2XkYEUH9nA', 'Logaritmo')],
  'ALG.seq': [('BWwQa8c22Pw', 'Progressão aritmética (PA)'), ('JxOhaVTkQR4', 'Progressão geométrica (PG)')],
  'GEM.pla': [('th5k6bzSDTA', 'Área das figuras planas'), ('EzGf1UEnnsY', 'Geometria plana: revisão ENEM')],
  'GEM.esp': [('Y_gD7S6OkC4', 'Geometria espacial: revisão completa'), ('Bz1lw74k4XI', 'Prismas: área e volume')],
  'GEM.tri': [('C7NrVLmEYcs', 'Trigonometria no triângulo retângulo'), ('D-E_A04ReTE', 'Seno, cosseno e tangente'), ('OPsqOAgxR4g', 'Círculo trigonométrico'), ('Vp3gI7r1pUQ', 'Lei dos senos'), ('i2wstycAhbo', 'Lei dos cossenos')],
  'GEM.ana': [('lHqTFWNBtmQ', 'Geometria analítica'), ('j0dU93bKML8', 'Equação geral da reta')],
  'GEM.vis': [('qDQG_AqBxww', 'Projeção ortogonal no ENEM'), ('fem35PVZjeA', 'Projeção ortogonal'), ('OWMPVzuAv28', 'Reflexão, translação e rotação')],
  'EST.est': [('IgoKxQK5hGQ', 'Média, moda e mediana'), ('10P9PFTeciA', 'Média, moda e mediana no ENEM: questões')],
  'EST.gra': [('GDEkkbwvhNg', 'Gráficos estatísticos'), ('XzZGAwfKs_k', 'Gráficos e tabelas no ENEM')],
  'EST.pro': [('iNCkGogNtKI', 'Probabilidade em 13 minutos'), ('AZH67sWDW5w', 'Probabilidade'), ('f7WKY_m7cBE', 'Probabilidade no ENEM: questões')],
  'EST.com': [('f0OjyQhITv0', 'Arranjo, permutação e combinação'), ('_8mZOSXCRp8', 'Análise combinatória')],
}


def get(url):
    return urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0', 'Accept-Language': 'pt-BR'}), timeout=30).read().decode('utf-8', 'replace')


def info(i):
    """confere o vídeo no oEmbed (existe e é público) e pega o canal; a duração vem da página do vídeo"""
    oe = json.loads(get('https://www.youtube.com/oembed?format=json&url=' + urllib.parse.quote('https://www.youtube.com/watch?v=' + i)))
    m = re.search(r'"lengthSeconds":"(\d+)"', get('https://www.youtube.com/watch?v=' + i))
    canal = re.sub(r'\s*\|\s*ENEM.*$', '', oe['author_name']).strip()
    return canal, round(int(m.group(1)) / 60) if m else 20


def main():
    ids = [v for _, _, l in BASE for v, _ in l] + [v for l in TEMAS.values() for v, _ in l]
    with cf.ThreadPoolExecutor(8) as ex:
        res = dict(zip(ids, ex.map(info, ids)))
    tupla = lambda i, t: [i, t, *res[i]]
    out = {'base': [{'c': c, 'nome': n, 'v': [tupla(i, t) for i, t in l]} for c, n, l in BASE],
           'temas': {c: [tupla(i, t) for i, t in l] for c, l in TEMAS.items()}}
    import datetime
    js = ('// Videoaulas por tema (YouTube, links diretos) — gerado por tools/aulas.py; cada vídeo: [id, título, canal, minutos].\n'
          '// base = matemática básica (vem antes dos temas de Matemática). Conferidos no oEmbed do YouTube em ' + datetime.date.today().isoformat() + '.\n'
          'window.AULAS = ' + json.dumps(out, ensure_ascii=False, separators=(',', ':')) + ';\n')
    open('app/data/aulas.js', 'w', encoding='utf-8').write(js)
    print(len(ids), 'vídeos conferidos')


if __name__ == '__main__':
    main()
