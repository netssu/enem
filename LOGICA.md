# ENEM Azul — a lógica do app

Estratégia: **fazer todas as questões do ENEM (provas azuis 2010–2025) uma vez, e voltar nas que errar até dominar** — num ritmo leve, em blocos curtos, nos tempos livres.

## 1. O banco de questões

- 32 provas (1º e 2º dia de 2010 a 2025) → 2.960 questões recortadas como imagem, cada uma com o gabarito oficial.
- Textos compartilhados ("Texto para as questões 6 a 10") aparecem junto de cada questão que os usa.
- Cada questão tem um link para a prova original do INEP, na página certa.
- Língua estrangeira: só aparecem as 5 da língua escolhida (inglês **ou** espanhol).
- Questões anuladas ficam de fora.
- Sobram ~2.800 questões “válidas”.

## 2. Estados de uma questão

```
            acertou (sem chute)
  NOVA ─────────────────────────────► DOMINADA (sai da fila)
    │
    │ errou, ou acertou no chute
    ▼
  REVISÃO caixa 1 ──acertou──► caixa 2 ──► caixa 3 ──► caixa 4 ──acertou──► RECUPERADA
      ▲  (volta em 1 dia)     (3 dias)    (7 dias)    (21 dias)
      └────────────── errou em qualquer caixa ─────────────┘
```

- **Por que não refazer na hora?** Logo depois de ver a resposta você acerta por memória. Esperar um dia testa se aprendeu de verdade.
- **Chute conta como erro**: depois de acertar, dá pra marcar “foi chute” e a questão vai para a revisão.
- **"Não sei — ver resolução"**: antes de responder, dá para pedir a resolução direto (resposta, explicação e vídeo). Conta como erro: a questão vai para a caixa 1 e volta amanhã para você tentar sozinho.
- Se uma questão “dominada” for refeita e errada, ela volta para a caixa 1.

## Explicações com IA: andamento e erros

- Enquanto a IA trabalha aparece a etapa (preparando a imagem → enviando → pensando → escrevendo), os segundos e um botão **Cancelar**. O texto aparece enquanto a IA escreve (Claude, Gemini e ChatGPT).
- Limite de **150 s**: se a IA não terminar, o pedido é cancelado com um aviso.
- **Gemini**: o app pede pensamento curto (`thinkingLevel: low` nos 3.x, `thinkingBudget: 1024` nos 2.5) e que o raciocínio venha junto, para a conexão não ficar muda. Se um modelo não mandar nada em **40 s**, ou estiver fora do ar ou sem cota, o app tenta sozinho `gemini-flash-latest` e `gemini-2.5-flash` (no máximo 3 modelos), avisa qual usou e deixa esse como padrão. O modelo padrão de uma chave nova é o `gemini-flash-latest`.
- Se der errado, a caixa mostra o motivo em português (chave recusada, limite de uso, modelo inexistente, servidor fora, sem conexão) e os **detalhes**: IA, modelo, onde parou, código HTTP, mensagem da API e navegador — nunca a chave. **Copiar detalhes** copia esse texto; **Tentar de novo** repete.
- Em **Ajustes › Testar a IA** dá para conferir a chave com um pedido curto, sem gastar uma explicação.

## Bloco de questões × correção de erros

- São dois andamentos separados: o **bloco de questões** (começado no Início: novas + revisões do dia) e a **correção** (começada em Erros, em "Só revisões" ou em "Treinar" um tema). Começar um guarda o outro onde parou.
- No Início, **Continuar bloco** volta sempre para o bloco de questões; se houver correção no meio, aparece também **↺ Continuar correção**. Na aba Erros, **Continuar correção** aparece no topo.
- "Sair" leva de volta para onde o bloco começou (Início ou Erros). No fim de um, o app oferece continuar o outro.

## Voltar para a questão anterior

- Nos blocos, o botão **←** (ou a tecla ←) volta para a questão anterior só para rever: a alternativa marcada, a certa, a explicação e os rabiscos. A resposta fica travada (🔒 Respondida) e não conta de novo. **→** ou "Próxima" seguem em frente.

## 3. O que acontece quando você erra

1. A alternativa certa aparece na hora (verde) e a sua fica riscada (vermelho).
2. **💡 Por que é X?** — resumo curto (≤130 palavras): por que a certa está certa, por que a sua estava errada e o **conceito-chave** para revisar. Gerado a partir da imagem da questão pela IA escolhida em Ajustes (Claude, Gemini ou ChatGPT, com a sua chave de API); fica salvo, então cada questão só é gerada uma vez.
3. **▶ Resolução no YouTube** — abre a busca “ENEM {ano} questão {n} resolução”. Se achar um vídeo bom, cole o link e o botão passa a abrir direto nele.
4. **Por que errei?** — Não sabia o conteúdo / Interpretação / Desatenção / Conta / Chutei / Faltou tempo + uma anotação livre. O caderno de erros mostra quais motivos mais aparecem.

## 4. O cronograma leve

Entradas: **data da prova**, **dias da semana em que você estuda**, **folga final** (padrão: 30 dias).

```
data-limite das novas = data da prova − folga final
dias de estudo        = dias marcados entre hoje e a data-limite
meta de hoje          = ⌈ questões que faltam ÷ dias de estudo ⌉
```

- **Não existe atraso.** Faltou um dia → a meta dos próximos sobe um pouco. Adiantou → cai.
- **Previsão**: média de questões novas dos últimos 14 dias → em que data você termina nesse ritmo.
- **Reta final** (últimos 30 dias): sem questões novas, só caderno de erros.

Exemplo: ~2.800 questões, 6 dias por semana, prova em novembro do ano que vem → **~10 questões novas por dia (~30 min)**.

## 5. Como é um dia de estudo

O estudo é em **blocos** (padrão 10 questões, ~30 min; dá pra escolher 5 a 30). Um bloco:

1. Até **metade das vagas** vai para revisões vencidas (as mais atrasadas primeiro).
2. O resto são questões **novas**, intercaladas com as revisões.
3. Pode sair no meio — o bloco fica salvo e aparece “Continuar bloco”.

Ordem das questões novas (Ajustes):
- **Intercalado** (padrão): uma de cada área por vez (Linguagens → Humanas → Natureza → Matemática), das provas mais recentes para as mais antigas.
- **Prova por prova**: termina 2025 inteira, depois 2024, etc.

Atalhos: **⚡ 5 rapidinhas** (fila de ônibus) e **↺ Só revisões**.

## 6. Onde ficam os dados

Tudo no navegador (`localStorage`). Em Ajustes → **Exportar progresso** gera um `.json` de backup, que também serve para levar o progresso para outro aparelho.

## 7. Arquivos

| Caminho | O que é |
|---|---|
| `INICIAR.bat` | Abre o app em http://localhost:8765 |
| `app/` | O app (HTML/CSS/JS puro, sem build) |
| `app/img/<ano>/` | Recorte de cada questão |
| `app/data/questoes.js` | Lista de questões + gabarito |
| `tools/extrair.py` | Gera `img/` e `questoes.js` a partir dos PDFs |
| `tools/conferir.py` | Confere se os recortes têm a questão inteira |

## Pontos fracos

- Cada questão tem **matéria e tema** (ex.: Natureza › Química › Estequiometria), em `app/data/temas.js`. A lista de temas está em `tools/temas.json` e a classificação de cada questão em `tools/classificacao.tsv` (feita lendo o texto de cada questão; as de 2021, cujo PDF tem a fonte embaralhada, pela imagem). Para regerar: `py -P -E tools/temas.py`.
- A conta usa o **acerto de primeira** (1ª tentativa, sem chute e sem ter pedido ajuda), por tema e por matéria.
- Para não exagerar com poucas questões, a taxa é puxada para a sua média geral: `(acertos + 4 × média) ÷ (feitas + 4)`. Errar 1 de 1 não vira “0%”.
- Um tema entra na lista de fracos com pelo menos 3 questões feitas e nota abaixo da média. Uma matéria inteira entra quando está abaixo da média mas nenhum tema dela tem questões suficientes para aparecer sozinho.
- A análise começa com 15 questões feitas. Fica na aba **Erros** (os 3 piores temas, com “Treinar”) e na análise completa.

### O que muda por causa disso

- **Reforço nos blocos** (ligado por padrão, desliga em Ajustes): cerca de 1 em cada 3 questões novas de um bloco vem dos 3 temas mais fracos. Aparecem com a etiqueta “🎯 Reforço”; o tema só é mostrado depois de responder.
- **Treinar**: cada tema ou matéria fraca tem um botão que monta um bloco só dele (revisões vencidas do tema primeiro, depois as novas).

## Simulado

- Aba **Simulado**: escolha quantas questões (5 a 180), o tempo (ritmo ENEM de 3 min/questão, um tempo seu ou sem limite), as áreas, uma matéria e de onde vêm as questões (novas, qualquer uma ou só do caderno de erros).
- Durante a prova não há correção. Dá para pular, voltar e mudar a resposta; a grade de números mostra o que já foi respondido. O relógio continua correndo mesmo fora do app e, quando zera, a prova é entregue sozinha.
- No fim: nota, tempo por questão, acerto por matéria e gabarito. As respostas entram no histórico como em um bloco normal: errou → caderno de erros. As em branco continuam como novas. Uma revisão que ainda não venceu não sobe de caixa por aparecer no simulado; se você errar, ela volta para a caixa 1.

## Caneta azul

- **No computador**, é só clicar e arrastar na folha para escrever em azul — não precisa ligar nada. Embaixo da questão há sempre uma área de **rascunho**. **Ctrl+Z** desfaz.
- **No celular/tablet**, o dedo rola a página; para escrever com o dedo, toque em **✏️ Escrever**. Caneta (stylus) escreve direto.
- **Correção da linha**: cada ponto novo é puxado para perto do anterior (estabilizador), tremidas menores que 2 px são ignoradas e o traço é desenhado com curvas suaves. A linha é grossa (≈ 0,65% da largura da questão, mínimo 4 px).
- Dá para rabiscar também na margem em volta da questão. **↶** desfaz o último traço e **🗑** apaga tudo. Os rabiscos acompanham o A−/A+.
- Ficam salvos por questão (as 80 mais recentes) e aparecem de novo em “Rever”. Numa tentativa nova, em outro dia, a folha começa limpa — o rascunho antigo entregaria a resposta.

## Metas por dia da semana

- Em **Ajustes**, cada dia da semana tem um ritmo: Folga (0), Leve (½), Normal (1), Puxado (1½×) ou Forte (2×). A meta de cada dia é proporcional: `meta do dia = questões que faltam ÷ soma dos pesos dos dias até a data-limite × peso do dia`.
- A tela inicial mostra a semana: em cada dia, a meta, o que foi feito, se bateu (✓) ou passou da meta (★ +N) e o acerto. Feito em dia de folga conta como extra.
- Bateu a meta? A barra passa dos 100% (a parte além da meta fica em outra cor). O app mostra quanto mais um bloco adianta o cronograma e quanto falta para bater o seu recorde de questões num dia.
- Em **Progresso › Por dia da semana**: nas últimas 8 semanas, quantos de cada dia você estudou, a média de questões, o acerto e as metas batidas.

## Seu caminho

- Na tela inicial: quanto das questões já foi feito e uma frase só sobre quando você termina as questões novas, em mês e ano. Se o seu ritmo dos últimos 14 dias termina antes do planejado, a frase usa o seu ritmo; senão, mostra a data em que você termina seguindo as metas do dia.
- De propósito, sem contas de revisões nem datas distantes: a meta do dia já se ajusta sozinha.

## Redação

Aba **Redação**: folha de 30 linhas (padrão), foto da folha ou caixa de texto livre (escondida, para quem só passa a limpo). A IA corrige com a matriz do INEP e as lições das redações nota 1000 (`app/data/redacao.js`) e devolve trechos grifados do verde ao vermelho, a nota num cenário pessimista e num otimista, o que estudar e dicas de português.

- **Tamanho da folha:** as 6 redações nota 1000 publicadas em texto no Toda Matéria têm em média 466 palavras e 3.090 caracteres. Renderizadas com recuo de parágrafo, elas ocupam 30 linhas em média quando cada linha comporta ~112 caracteres; a fonte da folha é calculada para isso. No celular a fonte não encolhe abaixo do legível e a contagem vira "linhas equivalentes na folha de papel".
- **Tempo real (opcional):** enquanto você escreve, a IA lê o texto (depois de 5 s parado, no máximo a cada 40 s, só quando uma frase termina ou o texto muda bastante) e grifa trechos numa camada atrás da folha. Clicar num trecho abre uma janelinha em cima dele com o comentário e permite aplicar a sugestão. Cada leitura é um pedido à IA.

### Desafio dos anos

Objetivo: tirar **900+** no tema de cada ENEM desde 2011 (15 temas). Conta a média dos dois cenários da correção (como a média de dois corretores, em degraus de 20). Cada ano mostra redações **reais** com nota 980–1000 daquele tema (`app/data/referencias.js`), pesquisadas em páginas públicas — sobretudo as Cartilhas/Guias do Participante do INEP, além de Estratégia Vestibulares, Blog do Vestibular, Blog do Enem, Revista Quero, Redação Online, Descomplica e Imaginie. O app guarda só autor, nota, o link para ler o texto na fonte e uma análise curta (introdução, argumentos, proposta, por que funciona); o texto das redações não é copiado. A IA recebe essas análises como régua ao corrigir uma redação do mesmo tema.

- 2011–2025: de 5 a 9 redações por ano (91 no total).
- 2010 ficou fora do desafio: o INEP só passou a divulgar redações nota 1000 em 2012 (com textos de 2011), e não há redações reais de 2010 com nota 980+ publicadas.
- 2013: uma das cinco tem nota 980 e outra aparece numa lista de textos nota 1000 sem nota individual (marcada assim no app).

### Redação no cronograma

O volume vem do Desafio dos anos: **temas que faltam × 1,5 tentativas por tema ÷ meses até o prazo** (1 ano a partir de hoje ou 1 semana antes da prova, o que vier primeiro), arredondado — hoje dá **2 por mês**. Se você ficar para trás ou não passar de 900, o mês seguinte recalcula com os temas que faltam. A situação nas questões ajusta:

| Situação | Ajuste |
|---|---|
| Adiantado (termina 2+ semanas antes) | +1 redação por mês |
| Em dia / sem histórico | — |
| Atrasado | o dia de redação vira **híbrido**: redação + metade da meta de questões |
| Reta final (só revisão) | pelo menos 4 por mês (1 por semana) |

As redações do mês se espalham igualmente pelo mês (no mês atual, pelos dias que restam), sempre em dia de estudo e com pelo menos 3 dias entre elas. O dia de redação pesa 0 (ou ½, no híbrido) na conta das metas, então as questões daquele dia vão para os outros. O tema sugerido é o próximo ano do desafio: primeiro os nunca tentados (do mais recente ao mais antigo), depois os que ainda não passaram de 900. Redação que passou da data vai para o próximo dia de estudo; "Adiar" pula o dia; "Já fiz no papel" conta como feita. Dá para desligar em Ajustes. Com os 15 anos conquistados, fica 1 por mês para manter a mão.

Na tela Hoje, o card "✍️ Redação de hoje" só aparece no dia em que o cronograma marca redação.

## Desafio do dia

Um desafio de estudo por dia, separado da redação, escolhido no primeiro acesso do dia (em rodízio) entre os que fazem sentido naquele dia: passar 5 da meta, 70% de acerto em 10+ questões, 5 questões de uma área, 5 do tema mais fraco, zerar as revisões do dia, 10 questões com média de até 3 min, 10 questões sem chute nem "não sei", ou um mini simulado. O progresso sai das questões respondidas no dia; cumprido, fica marcado e conta na sequência 🔥 de desafios.

A janelinha da correção em tempo real abre logo acima do trecho clicado (ou abaixo, se não couber na tela); Esc ou clicar fora fecha.

## Cronograma (tela inicial) e aba Questões

A tela inicial virou o **Cronograma**: tudo o que o plano pede para hoje, com tempo estimado e um botão para cada tarefa. A aba **Questões** é para responder livremente (bloco do tamanho que quiser, 5 rapidinhas, só revisões, por área, pontos fracos), sem metas — e tudo o que for feito lá conta no cronograma do mesmo jeito.

### Fases até a prova

| Fase | Quando | O que entra |
|---|---|---|
| Base | até 90 dias antes do fim das questões novas | questões novas + revisões; simulado de 15 (ou desafio de 10 numa matéria difícil) por semana |
| Ritmo de prova | os últimos 90 dias de questões novas | simulados de 20 (ou desafio de 15) no tempo de prova |
| Reta final | depois das questões novas até a prova | só revisão; simulados de 30 (ou desafio de 20) e 1 redação por semana |

### Simulados no cronograma

Um por semana, no dia de estudo mais forte (empate: o mais perto do fim de semana), nunca no mesmo dia da redação. Semanas alternadas: **misto** (todas as áreas) e **desafio** numa das 3 matérias/temas em que você mais erra (rodízio). Bem menores que o ENEM, no ritmo de 3 min por questão. Antes da reta final usam questões novas e **ocupam o lugar das questões novas do dia** (contam como novas); na reta final usam qualquer questão. Se o dia passar, o simulado vai para o próximo dia de estudo da semana; "Adiar" pula o dia. Dá para desligar em Ajustes.

### Agenda de hoje

Na ordem: simulado (se for o dia), redação (se for o dia), revisões vencidas, questões novas da meta e o desafio do dia (opcional). Cada item mostra o tempo que falta (3 min por questão, 1h15 por redação) e um botão. "Dia completo" quando todos os obrigatórios estão feitos.

### Quanto falta para um bom desempenho

Por área, o acerto de primeira (sem chute e sem "ver como fazer") dos últimos 90 dias — ou de tudo, se houver menos de 30 questões nesse período — comparado com o alvo (70% por padrão, muda em Ajustes). Só aparece com pelo menos 15 questões na área. Redação: a média das últimas 3 correções (média dos dois cenários), com alvo 900.
