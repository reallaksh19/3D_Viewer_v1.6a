import { installPsMappingUtilityTile as installBasePsMappingUtilityTile } from './ps-mapping-utility-tab-support-ui.js?v=20260611-psmap-support-gap-rules-1';

const GAP_NUMBER = '(-?\\d+(?:\\.\\d+)?)';
const MM_UNIT = '(?:m\\s*m|millimet(?:er|re)s?)';
const GAP_WORD = '(?:guide\\s*)?gap';
const GAP_SEP = '(?:=|:|-|\\bis\\b)?';
const GAP_BEFORE_VALUE = new RegExp(`\\b${GAP_WORD}\\b\\s*${GAP_SEP}\\s*${GAP_NUMBER}\\s*(?:${MM_UNIT})?\\b`, 'i');
const VALUE_BEFORE_GAP = new RegExp(`\\b${GAP_NUMBER}\\s*(?:${MM_UNIT})?\\s*${GAP_WORD}\\b`, 'i');
const FIELD_FALLBACK_VALUE = new RegExp(`\\b${GAP_NUMBER}\\s*(?:${MM_UNIT})?\\b`, 'i');

function normalizeGapSource(value) {
  return String(value ?? '')
    .replace(/[\u2010-\u2015]/g, '-')
    .replace(/[\[\](){}]/g, ' ')
    .replace(/,/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function numeric(value) {
  const parsed = Number(String(value ?? '').replace(/,/g, '').trim());
  return Number.isFinite(parsed) ? parsed : null;
}

function extractGapMm(value, { fieldFallback = false } = {}) {
  const source = normalizeGapSource(value);
  if (!source) return null;
  const before = source.match(GAP_BEFORE_VALUE);
  if (before) return numeric(before[1]);
  const after = source.match(VALUE_BEFORE_GAP);
  if (after) return numeric(after[1]);
  if (fieldFallback) {
    const fallback = source.match(FIELD_FALLBACK_VALUE);
    if (fallback) return numeric(fallback[1]);
  }
  return null;
}

function getTableInfo(panelName) {
  const table = document.querySelector(`[data-psmap-panel="${panelName}"] table.psmap-table`);
  if (!table) return null;
  const labels = Array.from(table.querySelectorAll('thead tr.psmap-labels th')).map((th) => th.textContent.trim());
  const tbody = table.querySelector('tbody');
  if (!labels.length || !tbody) return null;
  return { table, labels, tbody };
}

function readCell(row, labels, label) {
  const index = labels.indexOf(label);
  return index >= 0 ? row.children[index]?.textContent?.trim() || '' : '';
}

function setCell(row, labels, label, value) {
  const index = labels.indexOf(label);
  if (index < 0) return;
  row.children[index].textContent = value == null ? '' : String(value);
}

function parseRawColumns(value) {
  try { return JSON.parse(String(value || '{}')); } catch { return {}; }
}

function readSupportGapRawFromRawColumns(raw) {
  const cols = raw || {};
  for (const [key, value] of Object.entries(cols)) {
    const normalized = String(key).toLowerCase().replace(/[\s_-]+/g, ' ').trim();
    if (normalized === 'support gap' || normalized === 'guide gap' || normalized === 'gap') return value;
  }
  return '';
}

function readCt2ModelMap() {
  const info = getTableInfo('ct2');
  const map = new Map();
  if (!info) return map;
  for (const row of info.tbody.querySelectorAll('tr')) {
    const psno = readCell(row, info.labels, 'PSNO_Model');
    const dtxr = readCell(row, info.labels, 'DTXR');
    const supportGapVisible = readCell(row, info.labels, 'Support Gap');
    const raw = parseRawColumns(readCell(row, info.labels, 'Raw Columns'));
    const supportGapRaw = supportGapVisible || readSupportGapRawFromRawColumns(raw);
    if (psno) map.set(psno, { dtxr, supportGapRaw, supportGapMm: extractGapMm(supportGapRaw, { fieldFallback: true }) });
  }
  return map;
}

function readCoverageIsonote(node) {
  const coverage = getTableInfo('coverage');
  if (!coverage) return '';
  for (const row of coverage.tbody.querySelectorAll('tr')) {
    if (readCell(row, coverage.labels, 'Node') === node) return readCell(row, coverage.labels, 'ISONOTE');
  }
  return '';
}

function computeGapMatch(supportGapRaw, isonote, dtxr = '', tolerance = 0) {
  const t2Gap = extractGapMm(supportGapRaw, { fieldFallback: true });
  const t1Gap = extractGapMm(isonote, { fieldFallback: false });
  const guide = /\bGUIDE\b/i.test(String(dtxr || '')) || t2Gap != null || t1Gap != null;
  if (!guide && t2Gap == null) return '';
  if (t2Gap != null && t1Gap != null) return Math.abs(t2Gap - t1Gap) <= Number(tolerance || 0) ? 'GAP_EXACT' : 'GAP_CONFLICT';
  if (guide && t2Gap == null && t1Gap != null) return 'GAP_MISSING_TABLE2';
  if (t2Gap != null && t1Gap == null) return 'GAP_MISSING_TABLE1';
  return '';
}

function currentGapTolerance() {
  const input = document.querySelector('[data-psmap-setup="supportGapToleranceMm"]');
  return Number(input?.value || 0);
}

function patchCt2SupportGapValues(modelMap) {
  const info = getTableInfo('ct2');
  if (!info || !info.labels.includes('Support Gap')) return;
  for (const row of info.tbody.querySelectorAll('tr')) {
    const psno = readCell(row, info.labels, 'PSNO_Model');
    const model = modelMap.get(psno);
    if (model?.supportGapRaw) setCell(row, info.labels, 'Support Gap', model.supportGapRaw);
  }
}

function patchValidatorGapValues(modelMap) {
  const info = getTableInfo('validator');
  if (!info || !info.labels.includes('Gap Match')) return;
  const tolerance = currentGapTolerance();
  for (const row of info.tbody.querySelectorAll('tr')) {
    const psno = readCell(row, info.labels, 'PSNO_Model');
    const model = modelMap.get(psno) || {};
    const node = readCell(row, info.labels, 'Node');
    const isonote = readCoverageIsonote(node);
    if (info.labels.includes('T2 Support Gap')) setCell(row, info.labels, 'T2 Support Gap', model.supportGapRaw || '');
    setCell(row, info.labels, 'Gap Match', computeGapMatch(model.supportGapRaw, isonote, model.dtxr, tolerance));
  }
}

function patchCandidateGapValues(modelMap) {
  const info = getTableInfo('candidates');
  if (!info || !info.labels.includes('Gap Match')) return;
  const tolerance = currentGapTolerance();
  for (const row of info.tbody.querySelectorAll('tr')) {
    const psno = readCell(row, info.labels, 'PSNO_Model');
    const model = modelMap.get(psno) || {};
    const isonote = readCell(row, info.labels, 'ISONOTE');
    if (info.labels.includes('T2 Support Gap')) setCell(row, info.labels, 'T2 Support Gap', model.supportGapRaw || '');
    if (info.labels.includes('T2 DTXR')) setCell(row, info.labels, 'T2 DTXR', model.dtxr || readCell(row, info.labels, 'T2 DTXR'));
    setCell(row, info.labels, 'Gap Match', computeGapMatch(model.supportGapRaw, isonote, model.dtxr || readCell(row, info.labels, 'T2 DTXR'), tolerance));
  }
}

function schedulePatch(patch) {
  let queued = false;
  return () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => { queued = false; patch(); });
  };
}

function installRobustGapUiPatch() {
  const patch = () => {
    const modelMap = readCt2ModelMap();
    patchCt2SupportGapValues(modelMap);
    patchValidatorGapValues(modelMap);
    patchCandidateGapValues(modelMap);
  };
  const runPatch = schedulePatch(patch);
  const observer = new MutationObserver(runPatch);
  observer.observe(document.body, { childList: true, subtree: true, characterData: true });
  document.addEventListener('input', runPatch, true);
  document.addEventListener('change', runPatch, true);
  runPatch();
  return () => {
    observer.disconnect();
    document.removeEventListener('input', runPatch, true);
    document.removeEventListener('change', runPatch, true);
  };
}

export function installPsMappingUtilityTile(container, ctx = {}) {
  const destroyBase = installBasePsMappingUtilityTile(container, ctx);
  const destroyRobustGap = installRobustGapUiPatch();
  return () => {
    try { destroyRobustGap?.(); } catch {}
    try { destroyBase?.(); } catch {}
  };
}
