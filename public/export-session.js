function cloneData(value) {
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

export function createExportSnapshot({ card, cardNo, variant, cardRoot, dossierRoot }) {
  if (!card || !cardRoot) throw new Error('缺少导出卡片快照');
  return Object.freeze({
    card: cloneData(card),
    cardNo,
    variant,
    cardRoot,
    dossierRoot: dossierRoot || null,
  });
}

export function exportIsCurrent(token, currentToken) {
  return token === currentToken;
}
