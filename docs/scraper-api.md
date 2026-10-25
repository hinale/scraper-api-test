# Scraper API da 2Captcha

Documentação da prova de conceito pedida na [issue 293](https://github.com/BotPag/parcelatudo-front/issues/293). O código está em [hinale/scraper-api-test](https://github.com/hinale/scraper-api-test). O guia oficial da API é [Scraper API](https://2captcha.com/scraper/scraper-api/api).

A POC chama a API por HTTP, com o `fetch` do Node.js. Não há biblioteca cliente.

## O que a API faz

A Scraper API recebe uma tarefa, abre **uma URL** num browser e devolve o que essa página contém: HTML, Markdown ou um print. O endereço de produção é `https://scraper.2captcha.com`.

O método usado aqui é `scrape`. O outro método documentado, `google_search`, faz uma busca no Google e fica fora deste exemplo.

Há dois jeitos de executar a tarefa:

- `POST /tasks/sync` cria a tarefa e segura a conexão até ela terminar. O `timeout` vai de 1 a 120 segundos. O padrão é 60.
- `POST /tasks/request` devolve na hora um `response_id`. O resultado sai depois em `GET /tasks/result/:response_id`.

Esta POC usa o modo síncrono.

## O que é necessário

- Conta 2Captcha com saldo e uma API key.
- `Authorization: Bearer <API_KEY>` em todo `POST` que cria tarefa.
- `Content-Type: application/json`.
- Corpo JSON plano, no máximo 10.000 bytes, sem objeto `params` aninhado.
- Uma URL com `http://` ou `https://`.

No repositório, a chave fica no `.env`, que não é versionado:

```bash
SCRAPER_BASE_URL=https://scraper.2captcha.com
SCRAPER_API_KEY=
```

O modelo está em `.env.example`.

## Chamada feita na FIPE

A issue pede a página [https://veiculos.fipe.org.br/#carro](https://veiculos.fipe.org.br/#carro) e os parâmetros marca, modelo e ano. O exemplo da issue é Renault, Sandero authentique 1.0 16V, ano 2011.

O script `src/scrape-fipe.mjs` recebe esses três argumentos e monta o JSON de saída. A tarefa enviada à API leva só a URL:

```bash
node src/scrape-fipe.mjs \
  --marca Renault \
  --modelo "Sandero authentique 1.0 16V" \
  --ano 2011
```

```json
{
  "task_type": "scrape",
  "url": "https://veiculos.fipe.org.br/#carro",
  "data_format": "raw",
  "format": "json",
  "timeout": 90
}
```

`data_format: "raw"` pede o HTML. `format: "json"` envolve o resultado em JSON, com `status`, `http_code`, `headers` e `body`.

Os outros dois scripts usam a mesma URL:

| Script | Pedido | Arquivo esperado |
|---|---|---|
| `src/scrape-fipe-html.mjs` | `data_format: "raw"` | `output/fipe.html` |
| `src/scrape-fipe-screenshot.mjs` | `data_format: "screenshot"`, `fullPage: false` | `output/fipe-screenshot.base64` |

No print, o campo `body` vem em Base64, sem o prefixo `data:image/png;base64,`.

## Resposta obtida

### Consulta com marca, modelo e ano

A chamada de 25/10/2026 esperou 90,6 segundos e terminou com HTTP `408`. A tarefa foi criada e continuou em andamento. O corpo não trouxe HTML.

```json
{
  "marca": "Renault",
  "modelo": "Sandero authentique 1.0 16V",
  "ano": 2011,
  "sep2025": null,
  "sep2026": null,
  "scrape": {
    "httpStatus": 408,
    "contentType": "application/json; charset=utf-8",
    "status": "pending",
    "http_code": null,
    "warning": null,
    "error": "timeout",
    "response_id": "01a1735c-810e-7991-8aab-55606343883f"
  }
}
```

O header `x-debug` dessa resposta:

```json
{
  "response_id": "01a1735c-810e-7991-8aab-55606343883f",
  "add_datetime": null,
  "finish_datetime": null,
  "price": 0,
  "status_code": 408,
  "status_message": "Request Timeout"
}
```

`sep2025` e `sep2026` ficaram `null`. O arquivo `output/page.html` não foi gerado. O resultado completo está em `output/result.json`, que permanece na máquina por causa do `.gitignore`.

O `408` significa que a espera da conexão acabou. A tarefa segue na 2Captcha. O próximo passo previsto pela API é `GET /tasks/result/01a1735c-810e-7991-8aab-55606343883f`, sem criar outra tarefa igual.

Três status aparecem juntos e medem coisas diferentes:

| Campo | Nesta resposta | O que mede |
|---|---|---|
| HTTP da Scraper API | `408` | a espera síncrona terminou |
| `status` | `pending` | a tarefa ainda está rodando |
| `http_code` | ausente | o HTTP do site alvo; só existe quando a página volta |

### HTML e print

As chamadas seguintes, com a mesma chave e a mesma URL, voltaram em cerca de 6 segundos com HTTP `401`:

```json
{
  "error": "Unauthorized",
  "status": "error"
}
```

Não houve `response_id`, HTML nem Base64. Os resumos ficaram em `output/fipe-html-resposta.json` e `output/fipe-screenshot-resposta.json`. O `.env` não mudou entre a chamada aceita e essas duas. A API deixou de aceitar a chave depois do primeiro teste. `Unauthorized` é a mensagem de credencial recusada ou conta bloqueada. Saldo insuficiente usa outro texto: `Balance depleted — top up to continue`.

## Navegação e coleta

A coleta da Scraper API é a leitura de uma página já endereçável. A tarefa abre a `url`, espera o JavaScript daquela carga e devolve HTML, Markdown ou print. Dá para esperar até 30 segundos por um texto, um seletor CSS ou o fim do carregamento, com `waitFor`. Se esse prazo estoura, a API devolve a página como está e marca `status: "warn"`.

A navegação de um fluxo, como a consulta da FIPE, é outra coisa. O site pede marca, modelo, ano e combustível em etapas. A API não tem campo para clique, digitação, envio de formulário nem troca de tela. Marca, modelo e ano desta POC identificam a consulta no JSON local. Eles não vão no corpo da tarefa e o site não pesquisa por eles.

| Etapa da consulta FIPE | Quem faria | O que a Scraper API faz |
|---|---|---|
| Abrir `https://veiculos.fipe.org.br/#carro` | browser | abre essa URL e devolve o HTML ou o print |
| Escolher marca, modelo e ano | quem dirige o browser, tela a tela | não recebe esses dados |
| Ler a tabela de setembro de 2025 e de 2026 | leitura do DOM depois da pesquisa | lê o HTML da URL aberta, que neste caso é o formulário |
| Devolver o valor em centavos | o programa que interpreta a tabela | devolve `body` com o conteúdo da página carregada |

Uma resposta pronta da API, quando a página abre, tem esta forma:

```json
{
  "status": "success",
  "http_code": 200,
  "headers": {
    "content-type": "text/html; charset=utf-8"
  },
  "body": "<!doctype html>..."
}
```

HTTP `200` da API significa que a tarefa terminou. O código do site está em `http_code`. Um `404` do site pode voltar com HTTP `200` da API, `status: "success"` e `http_code: 404`.

Para um site em que o dado aparece ao abrir a URL, a Scraper API coleta esse conteúdo numa chamada. Para um site em que o dado só existe depois de preencher um formulário, a navegação precisa acontecer antes, num browser guiado passo a passo. A API entra na hora de gravar o HTML ou o print de uma URL que, aberta de novo, já mostre o resultado.
