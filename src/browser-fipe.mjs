import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";
import { matchOption, priceFromResult } from "./fipe-match.mjs";
import { createRunLog, loadEnv } from "./run-log.mjs";

const FIPE_URL = "https://veiculos.fipe.org.br/#carro";
const MONTHS = [
  { key: "sep2025", label: "setembro/2025", result: "setembro de 2025" },
  { key: "sep2026", label: "setembro/2026", result: "setembro de 2026" },
];
const ACCOUNT_NAME = "scraper-api-test";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { logStep, fail } = createRunLog(path.join(ROOT, "output", "passos-browser.jsonl"));

const args = parseArgs(process.argv.slice(2));
logStep("Argumentos lidos da linha de comando", args);

const envFile = await loadEnv(path.join(ROOT, ".env"));
logStep(envFile.loaded ? "Variáveis carregadas do .env" : "Arquivo .env ausente; usando o ambiente", {
  chavesDefinidasPeloArquivo: envFile.keys,
});

const marca = required(args.marca, "--marca");
const modelo = required(args.modelo, "--modelo");
const ano = required(args.ano, "--ano");
logStep("Parâmetros da consulta validados", { marca, modelo, ano });

const baseUrl = (process.env.BROWSER_API_BASE_URL || "https://api.2captcha.com").replace(/\/$/, "");
const apiKey = process.env.BROWSER_API_KEY || process.env.SCRAPER_API_KEY;
logStep("Destino da Browser API resolvido", {
  baseUrl,
  chaveDefinida: Boolean(apiKey),
  origemDaChave: process.env.BROWSER_API_KEY ? "BROWSER_API_KEY" : "SCRAPER_API_KEY",
});
if (!apiKey) {
  fail("Defina BROWSER_API_KEY ou SCRAPER_API_KEY no ambiente ou em .env. Veja .env.example.");
}

let browser;
try {
  const account = await resolveAccount(baseUrl, apiKey);
  logStep("Conta de browser escolhida", {
    id: account.id,
    name: account.name,
    proxyMode: account.proxyMode,
    profileId: account.profile?.profileId ?? null,
  });

  const customProxy = customProxyFromEnv();
  const connection = await api(baseUrl, "/browser/connection", {
    method: "POST",
    body: {
      key: apiKey,
      accountId: account.id,
      ...(process.env.BROWSER_PROFILE_ID ? { profileId: process.env.BROWSER_PROFILE_ID } : {}),
      ...(customProxy ? { customProxy } : {}),
    },
  });
  logStep("Proxy da conexão", {
    origem: customProxy ? "BROWSER_PROXY_HOST" : "configuração salva na conta",
    tipo: customProxy?.type ?? account.proxyMode,
  });
  if (!connection.connectionUri) {
    fail("A Browser API não devolveu connectionUri.");
  }
  logStep("URL de conexão recebida", { host: "cb.2captcha.com" });

  browser = await puppeteer.connect({
    browserWSEndpoint: connection.connectionUri,
    protocolTimeout: 180_000,
  });
  const page = await browser.newPage();
  page.setDefaultTimeout(60_000);
  await enableCaptcha(page);

  logStep("Abrindo a página da FIPE", { url: FIPE_URL });
  await page.goto(FIPE_URL, { waitUntil: "domcontentloaded", timeout: 90_000 });
  await waitForForm(page);
  logStep("Formulário de carros disponível");

  const result = {};
  for (const month of MONTHS) {
    result[month.key] = await consult(page, month);
  }

  const outputDir = path.join(ROOT, "output");
  await mkdir(outputDir, { recursive: true });
  const resultPath = path.join(outputDir, "browser-result.json");
  await writeFile(resultPath, `${JSON.stringify(result, null, 2)}\n`);
  logStep("Arquivo de saída gravado", { result: resultPath });
  console.log(JSON.stringify(result, null, 2));
  logStep("Execução concluída", { exitCode: 0 });
} catch (error) {
  logStep("Execução interrompida", { motivo: publicError(error) });
  console.error(publicError(error));
  process.exitCode = 1;
} finally {
  if (browser) {
    await browser.close().catch((error) => {
      logStep("Falha ao encerrar o browser", { motivo: publicError(error) });
    });
  }
}

async function consult(page, month) {
  logStep("Iniciando consulta", { mes: month.label, marca, modelo, ano });
  await page.evaluate(() => {
    const box = document.querySelector("#resultadoConsultacarroFiltros");
    if (box) box.textContent = "";
  });

  await choose(page, "#selectTabelaReferenciacarro", month.label);
  await choose(page, "#selectMarcacarro", marca);
  await choose(page, "#selectAnoModelocarro", modelo);
  await choose(page, "#selectAnocarro", ano);

  await page.click("#buttonPesquisarcarro");
  await page.waitForFunction((expectedMonth) => {
    const text = document.querySelector("#resultadoConsultacarroFiltros")?.innerText || "";
    return text.toLowerCase().includes(expectedMonth) && /R\$\s*\d/.test(text);
  }, {}, month.result.toLowerCase());

  const text = await page.$eval("#resultadoConsultacarroFiltros", (box) => box.innerText);
  const price = priceFromResult(text);
  logStep("Resultado lido", { mes: price.month, centavos: price.cents });
  if (price.cents === null || price.month !== month.result) {
    throw new Error(`A tabela de ${month.label} não trouxe o preço esperado. Mês lido: ${price.month ?? "ausente"}.`);
  }
  return price.cents;
}

async function choose(page, selector, query) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 20_000) {
    const labels = await page.$$eval(`${selector} option`, (options) => {
      return options.map((option) => option.textContent.trim()).filter(Boolean);
    });
    const matches = matchOption(labels, query);
    if (matches.length === 1) {
      const selected = await page.evaluate((selectSelector, label) => {
        const select = document.querySelector(selectSelector);
        const option = [...select.options].find((item) => item.textContent.trim() === label);
        window.jQuery(select).val(option.value).trigger("change");
        return option.textContent.trim();
      }, selector, matches[0]);
      logStep("Opção selecionada", { campo: selector, valor: selected });
      return selected;
    }
    if (matches.length > 1) {
      throw new Error(`A consulta "${query}" combina com mais de uma opção em ${selector}: ${matches.join(" | ")}`);
    }
    if (labels.length > 1) {
      throw new Error(`Nenhuma opção em ${selector} combina com "${query}".`);
    }
    await delay(300);
  }
  throw new Error(`As opções de ${selector} não carregaram a tempo para "${query}".`);
}

async function waitForForm(page) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 90_000) {
    const state = await page.evaluate(() => ({
      title: document.title,
      hasForm: Boolean(window.jQuery && document.querySelector("#selectTabelaReferenciacarro")),
      blocked: /cloudflare/i.test(document.title) || /you have been blocked/i.test(document.body?.innerText || ""),
    }));
    if (state.hasForm) return;
    if (state.blocked) {
      throw new Error("A FIPE bloqueou o IP de saída do browser (Cloudflare). Com proxyMode none a sessão usa o IPv6 gratuito da 2Captcha. Informe um proxy em BROWSER_PROXY_HOST ou conecte um proxy 2Captcha na conta.");
    }
    await delay(1000);
  }

  const screenshotPath = path.join(ROOT, "output", "browser-fipe.png");
  await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => {});
  throw new Error(`O formulário de carros não apareceu. Print em ${screenshotPath}.`);
}

async function enableCaptcha(page) {
  const session = await page.createCDPSession();
  for (const eventName of ["Captcha.detected", "Captcha.waitForSolve", "Captcha.solveFinished", "Captcha.solveFailed"]) {
    session.on(eventName, () => {
      logStep("Evento de CAPTCHA", { evento: eventName });
    });
  }
  try {
    await session.send("Captcha.setAutoSolve", {
      autoSolve: true,
      options: [{ type: "*" }],
    });
    logStep("Resolução automática de CAPTCHA ligada");
  } catch (error) {
    logStep("Resolução automática de CAPTCHA indisponível nesta sessão", {
      motivo: publicError(error),
    });
  }
}

async function resolveAccount(baseUrl, key) {
  const listed = await api(baseUrl, `/browser/accounts?key=${encodeURIComponent(key)}`);
  const accounts = extractAccounts(listed);
  const requestedId = process.env.BROWSER_ACCOUNT_ID;
  if (requestedId) {
    const account = accounts.find((item) => String(item.id) === requestedId);
    if (!account) fail(`Conta de browser ${requestedId} não encontrada.`);
    return account;
  }

  const named = accounts
    .filter((item) => item.name === ACCOUNT_NAME)
    .sort((left, right) => right.id - left.id);
  if (named.length > 0) return named[0];

  logStep("Nenhuma conta de browser encontrada; criando uma conta sem proxy salvo");
  const created = await api(baseUrl, "/browser/accounts", {
    method: "POST",
    body: {
      key,
      name: ACCOUNT_NAME,
      proxyMode: "none",
    },
  });
  if (!created.account?.id) fail("A Browser API não devolveu a conta criada.");
  return created.account;
}

function extractAccounts(payload) {
  const source = payload.data ?? payload.accounts ?? null;
  const values = Array.isArray(source) ? source : source && typeof source === "object" ? Object.values(source) : [];
  const accounts = values.filter((item) => item && typeof item === "object" && item.id && item.login);
  if (accounts.length > 0) return accounts;
  if (payload.account) return [payload.account];
  if (payload.id && payload.login) return [payload];
  return [];
}

function customProxyFromEnv() {
  const host = process.env.BROWSER_PROXY_HOST;
  if (!host) return null;
  const port = Number(process.env.BROWSER_PROXY_PORT);
  if (!Number.isInteger(port) || port <= 0) {
    fail("BROWSER_PROXY_PORT precisa ser a porta do proxy.");
  }
  return {
    type: process.env.BROWSER_PROXY_TYPE || "http",
    host,
    port,
    ...(process.env.BROWSER_PROXY_LOGIN ? { login: process.env.BROWSER_PROXY_LOGIN } : {}),
    ...(process.env.BROWSER_PROXY_PASSWORD ? { password: process.env.BROWSER_PROXY_PASSWORD } : {}),
  };
}

async function api(baseUrl, pathname, { method = "GET", body } = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`A Browser API respondeu ${response.status} sem JSON em ${method} ${pathname.split("?")[0]}.`);
  }
  if (data.status && data.status !== "OK") {
    throw new Error(`${data.errorCode || response.status}: ${data.error || "erro na Browser API"}`);
  }
  if (!response.ok) {
    throw new Error(`${response.status}: ${data.error || data.errorCode || "erro na Browser API"}`);
  }
  return data;
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

function required(value, flag) {
  if (value) return value;
  fail(`Uso: node src/browser-fipe.mjs --marca Renault --modelo "Sandero Authentique Hi-Flex 1.0 16V" --ano 2011\nFaltou ${flag}`);
}

function publicError(error) {
  return String(error?.message || error).replace(/wss?:\/\/\S+/gi, "ws://<connectionUri>");
}

function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
