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
