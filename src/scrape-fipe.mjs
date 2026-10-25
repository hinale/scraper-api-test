import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const FIPE_URL = "https://veiculos.fipe.org.br/#carro";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const STEPS_PATH = path.join(ROOT, "output", "passos.jsonl");
const startedAt = Date.now();
let lastMark = startedAt;

mkdirSync(path.dirname(STEPS_PATH), { recursive: true });
writeFileSync(STEPS_PATH, "");

const args = parseArgs(process.argv.slice(2));
logStep("Argumentos lidos da linha de comando", args);

const envFile = await loadEnv(path.join(ROOT, ".env"));
logStep(envFile.loaded ? "Variáveis carregadas do .env" : "Arquivo .env ausente; usando o ambiente", {
  chavesDefinidasPeloArquivo: envFile.keys,
});

const marca = required(args.marca, "--marca");
const modelo = required(args.modelo, "--modelo");
const ano = Number(required(args.ano, "--ano"));
if (!Number.isInteger(ano)) {
  fail("--ano precisa ser um número inteiro, por exemplo 2011");
}
logStep("Parâmetros da consulta validados", { marca, modelo, ano });

const baseUrl = (process.env.SCRAPER_BASE_URL || "https://scraper.2captcha.com").replace(/\/$/, "");
const apiKey = process.env.SCRAPER_API_KEY;
logStep("Destino da Scraper API resolvido", {
  baseUrl,
  chaveDefinida: Boolean(apiKey),
});
if (!apiKey) {
  fail("Defina SCRAPER_API_KEY no ambiente ou em .env. Veja .env.example.");
}

const task = {
  task_type: "scrape",
  url: FIPE_URL,
  data_format: "raw",
  format: "json",
  timeout: 90,
};
logStep("Tarefa montada", task);

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

const contentType = response.headers.get("content-type") || "";
const rawBody = await response.text();
const parsedBody = parseJson(rawBody);
const debug = parseJson(response.headers.get("x-debug"));
const debugResponse = parseJson(response.headers.get("x-debug_response"));
logStep("Corpo e headers de depuração lidos", {
  corpoEhJson: parsedBody !== null,
  bytes: Buffer.byteLength(rawBody),
  status: parsedBody?.status ?? null,
  http_code: parsedBody?.http_code ?? null,
  warning: parsedBody?.warning ?? null,
  error: parsedBody?.error ?? debugResponse?.error ?? null,
  xDebug: debug,
  xDebugResponse: debugResponse,
});

const pageHtml = typeof parsedBody?.body === "string" ? parsedBody.body : "";
const prices = extractSeptemberPrices(pageHtml);
logStep("Preços de setembro procurados no HTML", {
  htmlRecebido: pageHtml.length > 0,
  caracteresHtml: pageHtml.length,
  sep2025: prices.sep2025,
  sep2026: prices.sep2026,
});

const result = {
  marca,
  modelo,
  ano,
  sep2025: prices.sep2025,
  sep2026: prices.sep2026,
  scrape: {
    httpStatus: response.status,
    contentType,
    status: parsedBody?.status ?? null,
    http_code: parsedBody?.http_code ?? null,
    warning: parsedBody?.warning ?? null,
    error: parsedBody?.error ?? debugResponse?.error ?? null,
    response_id: debug?.response_id ?? parsedBody?.response_id ?? null,
  },
};

const outputDir = path.join(ROOT, "output");
await mkdir(outputDir, { recursive: true });
const resultPath = path.join(outputDir, "result.json");
await writeFile(resultPath, `${JSON.stringify(result, null, 2)}\n`);
const pagePath = path.join(outputDir, "page.html");
if (pageHtml) {
  await writeFile(pagePath, pageHtml);
}
logStep("Arquivos de saída gravados", {
  result: resultPath,
  page: pageHtml ? pagePath : null,
});

console.log(JSON.stringify(result, null, 2));
logStep("Execução concluída", { exitCode: response.ok && response.status !== 408 ? 0 : 1 });

if (response.status === 408) {
  fail("A espera síncrona terminou e a tarefa continua. Consulte GET /tasks/result/:response_id com o response_id, sem criar outra tarefa.");
}
if (!response.ok) {
  process.exitCode = 1;
}

function parseArgs(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) {
      fail(`Informe o valor de --${key}`);
    }
    values[key] = value;
    index += 1;
  }
  return values;
}

function logStep(descricao, logs = {}) {
  const now = Date.now();
  const entry = {
    tempo: {
      instante: new Date(now).toISOString(),
      etapaMs: now - lastMark,
      totalMs: now - startedAt,
    },
    descricao,
    logs,
  };
  lastMark = now;
  appendFileSync(STEPS_PATH, `${JSON.stringify(entry)}\n`);
  console.error(JSON.stringify(entry, null, 2));
}

async function loadEnv(envPath) {
  const keys = [];
  let text;
  try {
    text = await readFile(envPath, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return { loaded: false, keys };
    throw error;
  }

  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator === -1) continue;
    const key = trimmed.slice(0, separator).trim();
    const value = trimmed.slice(separator + 1).trim().replace(/^["']|["']$/g, "");
    if (process.env[key] === undefined) {
      process.env[key] = value;
      keys.push(key);
    }
  }
  return { loaded: true, keys };
}

function extractSeptemberPrices(html) {
  return {
    sep2025: centsForMonth(html, "2025"),
    sep2026: centsForMonth(html, "2026"),
  };
}

function centsForMonth(html, year) {
  if (!html) return null;
  const match = html.match(new RegExp(`setembro(?:\\s+de)?\\s+${year}[\\s\\S]{0,120}?R\\$\\s*([\\d.]+,\\d{2})`, "i"));
  if (!match) return null;
  const digits = match[1].replace(/\./g, "").replace(",", "");
  const cents = Number(digits);
  return Number.isSafeInteger(cents) ? cents : null;
}

function parseJson(value) {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function required(value, flag) {
  if (value) return value;
  fail(`Uso: node src/scrape-fipe.mjs --marca Renault --modelo "Sandero authentique 1.0 16V" --ano 2011\nFaltou ${flag}`);
}

function fail(message) {
  logStep("Execução interrompida", { motivo: message });
  console.error(message);
  process.exit(1);
}
