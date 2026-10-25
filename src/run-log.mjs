import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";

export function createRunLog(stepsPath) {
  const startedAt = Date.now();
  let lastMark = startedAt;

  mkdirSync(path.dirname(stepsPath), { recursive: true });
  writeFileSync(stepsPath, "");

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
    appendFileSync(stepsPath, `${JSON.stringify(entry)}\n`);
    console.error(JSON.stringify(entry, null, 2));
  }

  function fail(message) {
    logStep("Execução interrompida", { motivo: message });
    console.error(message);
    process.exit(1);
  }

  return { logStep, fail };
}

export async function loadEnv(envPath) {
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

export function parseJson(value) {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}
