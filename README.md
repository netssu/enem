# ENEM Azul — todas as questões (2010–2025)

App de estudo com uma estratégia simples: **fazer todas as questões das provas azuis do ENEM e voltar nas que errar até dominar**, num cronograma leve.

**Site:** https://netssu.github.io/enem/

- ~2.900 questões recortadas das provas oficiais, com gabarito.
- Errou (ou chutou, ou clicou em "não sei") → caderno de erros, com revisões em 1, 3, 7 e 21 dias.
- Botão de resolução no YouTube e explicação curta com IA (opcional, com sua chave da API da Anthropic).
- Meta diária calculada a partir da data da prova; o progresso fica salvo no navegador (com backup em JSON).

A lógica completa está em [LOGICA.md](LOGICA.md).

## Como usar

1. Abra o site e vá em **Ajustes**: data do ENEM, dias em que você estuda e língua estrangeira.
2. Na tela **Hoje**, faça um bloco de questões (padrão: 10, ~30 min).
3. Errou ou não sabia? A questão volta sozinha no caderno de erros em 1, 3, 7 e 21 dias.
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
