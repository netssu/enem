# ENEM Azul — todas as questões (2010–2025)

App de estudo com uma estratégia simples: **fazer todas as questões das provas azuis do ENEM e voltar nas que errar até dominar**, num cronograma leve.

**Site:** https://netssu.github.io/enem/

- ~2.900 questões recortadas das provas oficiais, com gabarito.
- Errou (ou chutou, ou clicou em "não sei") → caderno de erros, com revisões espaçadas (14, 21, 30 e 45 dias em Linguagens/Humanas; 7, 14, 30 e 45 em Natureza/Matemática) e, enquanto isso, reforço com questões novas do mesmo tema.
- Botão de resolução no YouTube e explicação curta com IA (opcional, com a sua chave de API do Claude, do Gemini ou do ChatGPT).
- Aba **Redação**: escreve numa folha de 30 linhas (com correção em tempo real opcional) ou manda a foto da folha e a IA corrige no padrão do ENEM — trechos grifados do verde ao vermelho com explicação e reescrita, nota estimada (cenário pessimista e otimista), aulas para buscar no YouTube e dicas de português. O critério está em `app/data/redacao.js` (matriz do INEP + lições das redações nota 1000). O **Desafio dos anos** pede 900+ no tema de cada ENEM desde 2011, com redações reais nota 980–1000 de referência, e o cronograma marca as redações necessárias para fechar tudo em 1 ano; a tela Hoje traz um desafio de estudo por dia.
- **Cronograma** (tela inicial): a agenda do dia com tempo e botão para cada tarefa (revisões, novas, redação, simulado, desafio), quanto falta para um bom desempenho por área, a semana e as fases até a prova, com simulados curtos semanais focados nas matérias mais difíceis. A aba **Questões** é para responder livremente, sem plano.
- Meta diária calculada a partir da data da prova; o progresso fica salvo no navegador (com backup em JSON).

A lógica completa está em [LOGICA.md](LOGICA.md).

## Como usar

1. Abra o site e vá em **Ajustes**: data do ENEM, dias em que você estuda e língua estrangeira.
2. Na tela **Hoje**, faça um bloco de questões (padrão: 10, ~30 min).
3. Errou ou não sabia? A questão volta sozinha no caderno de erros depois de 1–2 semanas (e o reforço traz questões novas do mesmo tema enquanto isso).
4. Use **Exportar / Importar progresso** para levar seu progresso entre o celular e o computador.

## Rodar localmente

Dê dois cliques em `INICIAR.bat` (precisa de Python) ou rode `py -m http.server 8765 -d app`.

## Regerar as questões a partir dos PDFs

```bash
py -m pip install pymupdf pillow
py tools/extrair.py "<pasta com os PDFs>" app
py tools/conferir.py "<pasta com os PDFs>"
```

As provas e gabaritos são do INEP (https://www.gov.br/inep/pt-br/areas-de-atuacao/avaliacao-e-exames-educacionais/enem/provas-e-gabaritos).
