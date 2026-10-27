import assert from "node:assert/strict";
import test from "node:test";
import { matchOption, priceFromResult, reaisToCents } from "./fipe-match.mjs";

test("converte real brasileiro para centavos", () => {
  assert.equal(reaisToCents("R$ 25.136,00"), 2513600);
  assert.equal(reaisToCents("25.535,00"), 2553500);
  assert.equal(reaisToCents("513,00"), 51300);
  assert.equal(reaisToCents("sem preço"), null);
});

test("escolhe a opção da FIPE quando cada palavra da consulta aparece nela", () => {
  const labels = [
    "SANDERO Authentique Hi-Flex 1.0 16V 5p",
    "SANDERO Authentique Hi-Power 1.0 16V 5p",
    "SANDERO Expression Flex 1.0 12V 5p",
  ];

  assert.deepEqual(matchOption(labels, "Sandero Authentique Hi-Flex 1.0 16V"), [
    "SANDERO Authentique Hi-Flex 1.0 16V 5p",
  ]);
  assert.deepEqual(matchOption(labels, "Sandero authentique 1.0 16V"), [
    "SANDERO Authentique Hi-Flex 1.0 16V 5p",
    "SANDERO Authentique Hi-Power 1.0 16V 5p",
  ]);
  assert.deepEqual(matchOption(labels, "Fiat Uno"), []);
});

test("lê mês e preço médio do texto do resultado", () => {
  const text = "Mês de referência:\n\nsetembro de 2026\n\nPreço Médio\n\nR$ 25.136,00";
  assert.deepEqual(priceFromResult(text), {
    cents: 2513600,
    month: "setembro de 2026",
  });
});
