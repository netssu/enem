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
2. **💡 Por que é X?** — resumo curto (≤130 palavras): por que a certa está certa, por que a sua estava errada e o **conceito-chave** para revisar. Gerado pelo Claude a partir da imagem da questão; fica salvo, então cada questão só é paga uma vez.
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
