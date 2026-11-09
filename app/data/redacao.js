// Guia de correção da redação do ENEM usado pela aba "Redação".
// Escrito a partir da matriz de competências do INEP e da leitura das redações nota 1000 (2016–2024)
// comentadas em https://www.todamateria.com.br/redacao-nota-1000-enem-exemplos/ — aqui só ficam as lições
// (por que aqueles textos funcionaram), não os textos.
window.REDACAO = {
  competencias: [
    {
      n: 1, nome: 'Norma culta',
      o_que: 'Domínio da modalidade escrita formal: ortografia, acentuação, concordância, regência, crase, pontuação, colocação pronominal e estrutura das frases.',
      niveis: {
        200: 'Excelente domínio. Desvios só como exceção, sem se repetir (na prática, até uns 2 deslizes leves no texto inteiro).',
        160: 'Bom domínio, com poucos desvios.',
        120: 'Domínio mediano, com alguns desvios.',
        80: 'Domínio insuficiente, com muitos desvios.',
        40: 'Domínio precário: desvios frequentes e de vários tipos.',
        0: 'Desconhecimento da modalidade escrita formal.',
      },
    },
    {
      n: 2, nome: 'Tema e tipo de texto',
      o_que: 'Entender a proposta, desenvolver o tema inteiro (todas as palavras-chave) no formato dissertativo-argumentativo e usar repertório sociocultural legitimado, pertinente e produtivo.',
      niveis: {
        200: 'Tema completo, argumentação consistente, repertório legitimado, pertinente e usado de forma produtiva; excelente domínio do texto dissertativo-argumentativo.',
        160: 'Argumentação consistente e bom domínio da estrutura (introdução com tese, desenvolvimento, conclusão).',
        120: 'Argumentação previsível; repertório só ilustrativo ou baseado nos textos motivadores.',
        80: 'Cópia dos textos motivadores ou domínio insuficiente da estrutura.',
        40: 'Tangencia o tema (fala do assunto geral, não do recorte pedido) ou mistura outros tipos de texto.',
        0: 'Fuga total ao tema ou outro tipo de texto: a redação inteira fica com nota zero.',
      },
    },
    {
      n: 3, nome: 'Argumentação',
      o_que: 'Selecionar, relacionar, organizar e interpretar informações e opiniões em defesa de um ponto de vista — com projeto de texto e autoria.',
      niveis: {
        200: 'Informações relacionadas ao tema de forma consistente e organizada, com autoria (o texto tem um projeto claro).',
        160: 'Informações organizadas, com indícios de autoria.',
        120: 'Informações limitadas aos textos motivadores e pouco organizadas.',
        80: 'Informações desorganizadas ou contraditórias.',
        40: 'Informações pouco relacionadas ao tema.',
        0: 'Informações sem relação com o tema.',
      },
    },
    {
      n: 4, nome: 'Coesão',
      o_que: 'Mecanismos linguísticos que ligam as partes: conectivos entre parágrafos e entre frases, retomadas por pronomes e sinônimos, sem repetição e sem conectivo usado no sentido errado.',
      niveis: {
        200: 'Articula bem as partes, com repertório diversificado de recursos coesivos.',
        160: 'Articula as partes com poucas inadequações e repertório diversificado.',
        120: 'Articulação mediana, com inadequações e repertório pouco diversificado.',
        80: 'Articulação insuficiente, com muitas inadequações.',
        40: 'Articulação precária.',
        0: 'Não articula as informações.',
      },
    },
    {
      n: 5, nome: 'Proposta de intervenção',
      o_que: 'Proposta para o problema discutido, que respeite os direitos humanos e tenha os 5 elementos: agente, ação, meio/modo, finalidade/efeito e detalhamento.',
      niveis: {
        200: 'Proposta muito bem elaborada, ligada ao tema e à discussão, com os 5 elementos.',
        160: 'Proposta bem elaborada (4 elementos).',
        120: 'Proposta mediana (3 elementos).',
        80: 'Proposta insuficiente (2 elementos) ou pouco ligada à discussão.',
        40: 'Proposta vaga ou precária (1 elemento).',
        0: 'Sem proposta, proposta sem relação com o tema ou que desrespeita os direitos humanos.',
      },
    },
  ],

  // Tamanho das 6 redações nota 1000 publicadas em texto no site (2019–2024; as de 2016–2018 só têm foto).
  // caracteresPorLinha: medido renderizando essas redações (com recuo de parágrafo) numa largura fixa e ajustando a
  // fonte até a média ocupar 30 linhas — é quanto texto médio cabe numa linha da folha.
  media: { ensaios: 6, palavras: 466, caracteres: 3090, letras: 2550, paragrafos: 4, caracteresPorLinha: 112 },

  // temas para treinar (no estilo do ENEM) — sugeridos nos dias de redação
  temasTreino: [
    'Desafios para a inclusão digital de idosos no Brasil',
    'Caminhos para combater a insegurança alimentar no Brasil',
    'O impacto da desinformação na saúde pública brasileira',
    'Desafios para a mobilidade urbana nas grandes cidades brasileiras',
    'A evasão escolar no ensino médio brasileiro',
    'Caminhos para reduzir o desperdício de alimentos no Brasil',
    'Os desafios da saúde mental de jovens na era das redes sociais',
    'A valorização dos professores da educação básica no Brasil',
    'Desafios para a preservação da Amazônia no século XXI',
    'O combate ao trabalho análogo à escravidão no Brasil',
    'Caminhos para ampliar o acesso ao saneamento básico no Brasil',
    'Os desafios da acessibilidade para pessoas com deficiência nas cidades brasileiras',
    'A persistência do racismo estrutural na sociedade brasileira',
    'Desafios para o combate à violência contra a pessoa idosa no Brasil',
    'O uso da inteligência artificial na educação brasileira',
    'Caminhos para combater o bullying nas escolas brasileiras',
    'A gravidez na adolescência como desafio social no Brasil',
    'Os desafios do descarte do lixo eletrônico no Brasil',
    'A importância do incentivo à leitura entre os jovens brasileiros',
    'Desafios para garantir o direito à moradia no Brasil',
  ],

  // situações que zeram a redação inteira
  zeram: [
    'Fuga total ao tema.',
    'Não ser dissertativo-argumentativo (narração, poema, carta…).',
    'Até 7 linhas escritas (texto insuficiente).',
    'Parte do texto deliberadamente desconectada do tema (receita, hino, recado…).',
    'Cópia integral dos textos motivadores, impropérios, desenhos ou identificação do candidato.',
  ],

  // o que as redações nota 1000 de 2016 a 2024 têm em comum (lições, com exemplos curtos)
  licoes: [
    {
      titulo: 'Quatro parágrafos com funções claras',
      texto: 'Todas seguem o mesmo esqueleto: introdução (contexto + tese + os dois caminhos que serão discutidos), dois parágrafos de desenvolvimento (um para cada caminho) e conclusão com a proposta. Quem lê sabe desde o 1º parágrafo o que vem depois — é isso que a banca chama de projeto de texto (C3).',
    },
    {
      titulo: 'A tese anuncia as duas causas',
      texto: 'Na de 2020 (estigma das doenças mentais) a introdução já diz que o problema vem da negligência do governo e da discriminação da população; na de 2019 (cinema), da elitização e da falta de infraestrutura. Cada causa vira um parágrafo e depois uma parte da proposta.',
    },
    {
      titulo: 'Desenvolvimento em 4 movimentos',
      texto: 'Cada parágrafo de desenvolvimento faz: (1) frase-tópico com a ideia do parágrafo; (2) repertório (autor, obra, lei ou dado); (3) explicação ligando o repertório ao Brasil e ao tema — a parte que mais pesa; (4) frase de fechamento com consequência ou encaminhamento da solução.',
    },
    {
      titulo: 'Repertório produtivo, não decorativo',
      texto: 'Aparecem Krenak, Marilena Chauí, Djamila Ribeiro, Bauman, Marx, Bobbio, Sartre, Kant, Hume, “Vidas Secas”, o filme “Coringa”, o art. 215 da Constituição, dados do IBGE e da OMS. O que dá nota não é o nome famoso: é o texto explicar como a ideia do autor ajuda a entender o problema brasileiro. O “Instituições Zumbis” de Bauman aparece em dois anos diferentes — um repertório coringa funciona quando é amarrado ao tema.',
    },
    {
      titulo: 'Tema completo, com o recorte exato',
      texto: 'Os textos repetem (ou parafraseiam) as palavras-chave do tema: “no Brasil”, “registro civil”, “invisibilidade”, “trabalho de cuidado realizado pela mulher”. Falar só do assunto amplo (ex.: “cultura” em vez de “herança africana”) é tangenciar e derruba C2, C3 e C5 juntas.',
    },
    {
      titulo: 'Conectivos variados em todo lugar',
      texto: 'Abertura de parágrafo (Em primeiro lugar / Sob outra ótica / Ademais / Portanto), ligação entre frases (Contudo, Por conseguinte, Dessa forma, uma vez que, visto que) e retomadas por sinônimos (“o pensador”, “o estudioso polonês”, “o longa norte-americano”) em vez de repetir a mesma palavra. Isso é C4.',
    },
    {
      titulo: 'Proposta com os 5 elementos (e às vezes duas propostas)',
      texto: 'Agente específico (Ministério da Saúde, Ministério da Cidadania, “o Estado em parceria com…”), ação, meio (“por meio de…”), finalidade (“a fim de…”, “com o intuito de…”) e detalhamento (explicar o agente, dar exemplos, nomear o projeto — como o mutirão com nome próprio na de 2021). Várias trazem uma proposta para cada causa discutida.',
    },
    {
      titulo: 'Fechamento circular',
      texto: 'Muitas terminam retomando o repertório da introdução (o filme, o autor, a frase de abertura), mostrando que o problema apresentado no início foi resolvido. Não é obrigatório, mas reforça a coerência.',
    },
    {
      titulo: 'Nota 1000 não é texto perfeito',
      texto: 'Os textos têm deslizes que a banca tolerou por serem raros: próclise depois de vírgula (“…, se manifestando” → “manifestando-se”), “o permite” no lugar de “lhe permite”, “curta-metragens” no lugar de “curtas-metragens”, “com” no lugar de “como”, “oferecê-los um tratamento” (→ “oferecer-lhes”), letra minúscula em “Ministério público”, um “índica” por “índice” e até uma frase com sentido trocado. Na C1, dois desvios leves não impedem os 200 pontos; reincidência sim.',
    },
    {
      titulo: 'Vocabulário formal, mas a clareza vem antes',
      texto: 'Palavras como “imperioso”, “mitigar”, “hodierna”, “outrossim” aparecem, mas sempre em frases claras. Trocar palavras simples por difíceis sem necessidade não dá ponto e aumenta o risco de erro.',
    },
  ],

  // texto que vai para a IA como critério
  criterio() {
    const c = this.competencias.map(x => `C${x.n} — ${x.nome}: ${x.o_que}\n` + Object.entries(x.niveis).sort((a, b) => b[0] - a[0]).map(([k, v]) => `  ${k}: ${v}`).join('\n')).join('\n\n');
    return `MATRIZ DE CORREÇÃO (INEP), cada competência vale 0, 40, 80, 120, 160 ou 200:\n\n${c}\n\nZERAM A REDAÇÃO INTEIRA:\n${this.zeram.map(z => '- ' + z).join('\n')}\n\nO QUE AS REDAÇÕES NOTA 1000 (2016–2024) TÊM EM COMUM — use como referência do que é "excelente":\n${this.licoes.map(l => `- ${l.titulo}: ${l.texto}`).join('\n')}`;
  },
};
