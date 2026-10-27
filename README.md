# scraper-api-test

Exemplo de chamada da [Scraper API](https://2captcha.com/scraper/scraper-api/api) da 2Captcha, no formato da [issue 293](https://github.com/BotPag/parcelatudo-front/issues/293).

A [issue 298](https://github.com/BotPag/parcelatudo-front/issues/298) acrescenta a [Browser API](https://2captcha.com/scraper/browser-api/api): o script abre a FIPE num Chrome na nuvem, preenche marca, modelo e ano e devolve o preço de setembro de 2025 e de setembro de 2026, em centavos. O guia está em `docs/browser-api.html`.

Na execução de 27/10/2026 a conexão CDP funcionou, e a FIPE respondeu com bloqueio do Cloudflare no IPv6 gratuito (`proxyMode: "none"`). Sem um proxy em `BROWSER_PROXY_HOST`, o script encerra com esse motivo e não imprime o JSON de preços.

```bash
node src/browser-fipe.mjs \
  --marca Renault \
  --modelo "Sandero Authentique Hi-Flex 1.0 16V" \
  --ano 2011
```

A chamada abre uma única URL e devolve o HTML. Marca, modelo e ano entram na POC para identificar a consulta pedida. A API não recebe esses campos e não preenche o formulário da FIPE.

## Chamada

`POST https://scraper.2captcha.com/tasks/sync`

```json
{
  "task_type": "scrape",
  "url": "https://veiculos.fipe.org.br/#carro",
  "data_format": "raw",
  "format": "json",
  "timeout": 90
}
```

Autenticação: `Authorization: Bearer <SCRAPER_API_KEY>`.

O mesmo pedido com curl:

```bash
curl -X POST "$SCRAPER_BASE_URL/tasks/sync" \
  -H "Authorization: Bearer $SCRAPER_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "task_type": "scrape",
    "url": "https://veiculos.fipe.org.br/#carro",
    "data_format": "raw",
    "format": "json",
    "timeout": 90
  }'
```

## Como rodar

```bash
cp .env.example .env
```

Preencha `SCRAPER_API_KEY` no `.env`. Depois:

```bash
node src/scrape-fipe.mjs \
  --marca Renault \
  --modelo "Sandero authentique 1.0 16V" \
  --ano 2011
```

Cada etapa sai no stderr e em `output/passos.jsonl`, com três campos: `tempo` (instante, duração da etapa e total), `descricao` e `logs`. A chave da API não entra no log. O stdout continua sendo só o JSON do resultado.

A saída segue o JSON da issue, com os valores em centavos quando o HTML trouxer o preço de setembro daquele ano:

```json
{
  "marca": "Renault",
  "modelo": "Sandero authentique 1.0 16V",
  "ano": 2011,
  "sep2025": null,
  "sep2026": null,
  "scrape": {
    "httpStatus": 200,
    "contentType": "application/json; charset=utf-8",
    "status": "success",
    "http_code": 200,
    "warning": null,
    "error": null,
    "response_id": "..."
  }
}
```

`sep2025` e `sep2026` ficam `null` quando a página capturada é o formulário em `#carro`, sem a tabela do veículo. `output/result.json` guarda esse objeto e `output/page.html` guarda o HTML devolvido em `body`.

HTTP `200` da Scraper API significa que a tarefa terminou. O status do site está em `http_code`. `status: "error"` no JSON é falha ao abrir a página, mesmo com HTTP `200`. Em `408`, use o `response_id` em `GET /tasks/result/:response_id` em vez de criar outra tarefa.
