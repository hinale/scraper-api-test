import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRunLog, loadEnv, parseJson } from "./run-log.mjs";

const FIPE_URL = "https://veiculos.fipe.org.br/#carro";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUTPUT_DIR = path.join(ROOT, "output");
const HTML_PATH = path.join(OUTPUT_DIR, "fipe.html");
const RESPONSE_PATH = path.join(OUTPUT_DIR, "fipe-html-resposta.json");
const { logStep, fail } = createRunLog(path.join(OUTPUT_DIR, "passos-html.jsonl"));

logStep("Teste de HTML iniciado", { url: FIPE_URL });

const envFile = await loadEnv(path.join(ROOT, ".env"));
logStep(envFile.loaded ? "Variáveis carregadas do .env" : "Arquivo .env ausente; usando o ambiente", {
  chavesDefinidasPeloArquivo: envFile.keys,
});

const baseUrl = (process.env.SCRAPER_BASE_URL || "https://scraper.2captcha.com").replace(/\/$/, "");
const apiKey = process.env.SCRAPER_API_KEY;
logStep("Destino da Scraper API resolvido", { baseUrl, chaveDefinida: Boolean(apiKey) });
if (!apiKey) fail("Defina SCRAPER_API_KEY no ambiente ou em .env. Veja .env.example.");

const task = {
  task_type: "scrape",
  url: FIPE_URL,
  data_format: "raw",
  format: "json",
  timeout: 120,
};
logStep("Tarefa de HTML montada", task);

const requestStartedAt = Date.now();
logStep("Enviando POST /tasks/sync", { url: `${baseUrl}/tasks/sync` });
const response = await fetch(`${baseUrl}/tasks/sync`, {
  method: "POST",
  headers: {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify(task),
});
logStep("Resposta HTTP recebida", {
  httpStatus: response.status,
  contentType: response.headers.get("content-type") || "",
  esperaMs: Date.now() - requestStartedAt,
});

const rawBody = await response.text();
const parsedBody = parseJson(rawBody);
const debug = parseJson(response.headers.get("x-debug"));
const debugResponse = parseJson(response.headers.get("x-debug_response"));
const pageHtml = typeof parsedBody?.body === "string" ? parsedBody.body : "";
logStep("Corpo e headers de depuração lidos", {
  corpoEhJson: parsedBody !== null,
  bytes: Buffer.byteLength(rawBody),
  status: parsedBody?.status ?? null,
  http_code: parsedBody?.http_code ?? null,
  warning: parsedBody?.warning ?? null,
  error: parsedBody?.error ?? debugResponse?.error ?? null,
  caracteresHtml: pageHtml.length,
  xDebug: debug,
  xDebugResponse: debugResponse,
});

await mkdir(OUTPUT_DIR, { recursive: true });
const resposta = {
  httpStatus: response.status,
  contentType: response.headers.get("content-type") || "",
  status: parsedBody?.status ?? null,
  http_code: parsedBody?.http_code ?? null,
  headers: parsedBody?.headers ?? null,
  warning: parsedBody?.warning ?? null,
  error: parsedBody?.error ?? debugResponse?.error ?? null,
  response_id: debug?.response_id ?? parsedBody?.response_id ?? null,
  xDebug: debug,
  xDebugResponse: debugResponse,
  html: pageHtml ? HTML_PATH : null,
};
await writeFile(RESPONSE_PATH, `${JSON.stringify(resposta, null, 2)}\n`);
if (pageHtml) await writeFile(HTML_PATH, pageHtml);
logStep("Resposta gravada", {
  html: pageHtml ? HTML_PATH : null,
  resposta: RESPONSE_PATH,
});

if (response.status === 408) {
  fail("A espera síncrona terminou e a tarefa continua. O HTML da página não veio nesta resposta.");
}
if (!response.ok || parsedBody?.status === "error" || !pageHtml) {
  fail("A resposta não trouxe HTML da página.");
}

logStep("Execução concluída", { exitCode: 0, caracteresHtml: pageHtml.length });
