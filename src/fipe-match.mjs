export function normalizeText(value) {
  return String(value)
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

export function matchOption(labels, query) {
  const needles = normalizeText(query).split(" ").filter(Boolean);
  if (needles.length === 0) return [];

  return labels.filter((label) => {
    const haystack = normalizeText(label);
    return needles.every((needle) => haystack.includes(needle));
  });
}

export function reaisToCents(amount) {
  const match = String(amount).match(/(\d{1,3}(?:\.\d{3})*,\d{2})/);
  if (!match) return null;
  const cents = Number(match[1].replaceAll(".", "").replace(",", ""));
  return Number.isSafeInteger(cents) ? cents : null;
}

export function priceFromResult(text) {
  const price = String(text).match(/Preço Médio[\s\S]{0,80}?R\$\s*(\d{1,3}(?:\.\d{3})*,\d{2})/i);
  const month = String(text).match(/Mês de referência:[\s\S]{0,80}?([a-zçãõáéíóú]+ de \d{4})/i);
  return {
    cents: price ? reaisToCents(price[1]) : null,
    month: month ? normalizeText(month[1]) : null,
  };
}
