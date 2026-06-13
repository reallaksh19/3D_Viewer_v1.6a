import {
  DEFAULT_OPTIONS,
  DEFAULT_SUPPORT_KEYWORD_RULES_TEXT,
  normalizePsMappingOptions as normalizeV3Options,
  runPsMappingResolver as runV3PsMappingResolver,
  rowsToCsv,
} from './ps-mapping-engine-diagnostics-v3.js?v=20260611-support-gap-rules-1';

export { DEFAULT_OPTIONS, DEFAULT_SUPPORT_KEYWORD_RULES_TEXT, rowsToCsv };

const GAP_NUMBER = '(-?\\d+(?:\\.\\d+)?)';
const MM_UNIT = '(?:m\\s*m|millimet(?:er|re)s?)';
const GAP_WORD = '(?:guide\\s*)?gap';
const GAP_SEP = '(?:=|:|-|\\bis\\b)?';
const GAP_BEFORE_VALUE = new RegExp(`\\b${GAP_WORD}\\b\\s*${GAP_SEP}\\s*${GAP_NUMBER}\\s*(?:${MM_UNIT})?\\b`, 'i');
const VALUE_BEFORE_GAP = new RegExp(`\\b${GAP_NUMBER}\\s*(?:${MM_UNIT})?\\s*${GAP_WORD}\\b`, 'i');
const FIELD_FALLBACK_VALUE = new RegExp(`\\b${GAP_NUMBER}\\s*(?:${MM_UNIT})?\\b`, 'i');

export function normalizePsMappingOptions(options = {}) {
  return normalizeV3Options(options);
}

function numeric(value) {
  const parsed = Number(String(value ?? '').replace(/,/g, '').trim());
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeGapSource(value) {
  return String(value ?? '')
    .replace(/[\u2010-\u2015]/g, '-')
    .replace(/[\[\](){}]/g, ' ')
    .replace(/,/g, '')
    .replace(/\s+/g, ' ')
    .trim();
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

function rawColumnValue(rawColumns, aliases = []) {
  const cols = rawColumns || {};
  const wanted = aliases.map((item) => String(item).toLowerCase().replace(/[\s_-]+/g, ' ').trim());
  for (const [key, value] of Object.entries(cols)) {
    const normalized = String(key).toLowerCase().replace(/[\s_-]+/g, ' ').trim();
    if (wanted.includes(normalized)) return value;
  }
  return '';
}

function supportGapRawFromModel(model = {}) {
  return model.supportGapRaw
    || model.supportGap
    || rawColumnValue(model.rawColumns, ['support gap', 'guide gap', 'gap'])
    || '';
}

function table1GapMmFromRow(row = {}) {
  return extractGapMm(row.nodeIsonote || row.nodeIsonoteRaw || row.isonote || '', { fieldFallback: false });
}

function modelGapMmFromModel(model = {}) {
  return extractGapMm(supportGapRawFromModel(model), { fieldFallback: true });
}

function buildModelMap(models = []) {
  const map = new Map();
  for (const model of models || []) {
    if (!model?.psnoModel) continue;
    const supportGapRaw = supportGapRawFromModel(model);
    map.set(model.psnoModel, {
      ...model,
      supportGapRaw,
      supportGapMm: modelGapMmFromModel(model) ?? '',
    });
  }
  return map;
}

function appendWarning(existing, warning) {
  const parts = String(existing || '').split(';').map((part) => part.trim()).filter(Boolean);
  if (warning && !parts.includes(warning)) parts.push(warning);
  return parts.join('; ');
}

function removeGapWarnings(existing) {
  return String(existing || '')
    .split(';')
    .map((part) => part.trim())
    .filter((part) => part && !/^GAP_/i.test(part))
    .join('; ');
}

function isGuideRow(row = {}, model = {}) {
  const source = [
    row.supportTypesRequested,
    row.modelDtxrKeywords,
    row.supportMatch,
    row.dtxr,
    model.dtxr,
  ].join(' ');
  return /\bGUIDE\b/i.test(source);
}

function hasCleanResolvedContext(row) {
  return ['BORE_DN_FROM_NPS', 'BORE_DN_FROM_OD', 'BORE_NPS_RAW', 'BORE_OD', 'BORE_IGNORED'].includes(row.boreBasis)
    && ['LINE_EXACT', 'LINE_FAMILY'].includes(row.lineBasis)
    && ['SUPPORT_EXACT', 'SUPPORT_PARTIAL', 'SUPPORT_IGNORED'].includes(row.supportBasis);
}

function markGapExact(row, modelGapMm, table1GapMm) {
  row.gapMatch = 'GAP_EXACT';
  row.gapMatchDetail = `Table-2 Support Gap ${modelGapMm} mm matches Table-1C GUIDE GAP ${table1GapMm} mm.`;
  row.supportGapBasis = 'GAP_EXACT';
  row.warnings = removeGapWarnings(row.warnings);
  if (row.finalStatus === 'USER_REVIEW_REQUIRED' && hasCleanResolvedContext(row) && !row.warnings) {
    row.finalStatus = 'MATCHED';
    row.reviewRequired = false;
    row.autoSelectable = true;
    row.confidence = 'HIGH';
    row.confidenceScore = Math.max(Number(row.confidenceScore || 0), 90);
    row.reason = row.selected ? 'Selected best auto-approved consolidated Table-1 candidate.' : 'Gap comparison matched.';
    row.reviewAction = '';
    row.nodeCoverageNote = '';
  }
}

function markGapReview(row, status, detail) {
  row.gapMatch = status;
  row.gapMatchDetail = detail;
  row.supportGapBasis = status;
  row.autoSelectable = false;
  row.reviewRequired = true;
  row.selected = false;
  row.finalStatus = 'USER_REVIEW_REQUIRED';
  row.confidence = row.confidence === 'HIGH' ? 'REVIEW' : (row.confidence || 'REVIEW');
  row.confidenceScore = Math.min(Number(row.confidenceScore || 60) || 60, 60);
  row.warnings = appendWarning(removeGapWarnings(row.warnings), status);
  row.reason = detail;
  row.reviewAction = detail;
  row.nodeCoverageNote = detail;
}

function applyRobustGapComparison(row, options, modelByPs) {
  if (!row || options.enableSupportGapComparison === false) return row;
  const model = modelByPs.get(row.psnoModel) || {};
  const supportGapRaw = supportGapRawFromModel(model) || row.supportGapRaw || '';
  const modelGapMm = modelGapMmFromModel({ ...model, supportGapRaw });
  const table1GapMm = table1GapMmFromRow(row);
  const guide = isGuideRow(row, model) || modelGapMm != null || table1GapMm != null;
  row.supportGapRaw = supportGapRaw || row.supportGapRaw || '';
  row.supportGapMm = modelGapMm ?? '';
  row.nodeGuideGapMm = table1GapMm ?? '';
  if (!guide && modelGapMm == null) { row.gapMatch = row.gapMatch || ''; return row; }
  if (modelGapMm != null && table1GapMm != null) {
    const tolerance = Number(options.supportGapToleranceMm ?? 0);
    if (Math.abs(modelGapMm - table1GapMm) <= tolerance) markGapExact(row, modelGapMm, table1GapMm);
    else markGapReview(row, 'GAP_CONFLICT', `Support gap conflict: Table-2 Support Gap ${modelGapMm} mm differs from Table-1C GUIDE GAP ${table1GapMm} mm.`);
    return row;
  }
  if (guide && modelGapMm == null && table1GapMm != null) {
    markGapReview(row, 'GAP_MISSING_TABLE2', `Support gap missing in Table-2 for GUIDE; Table-1C GUIDE GAP is ${table1GapMm} mm.`);
    return row;
  }
  if (modelGapMm != null && table1GapMm == null) {
    markGapReview(row, 'GAP_MISSING_TABLE1', `Support gap ${modelGapMm} mm exists in Table-2, but Table-1C GUIDE GAP is missing.`);
    return row;
  }
  row.gapMatch = row.gapMatch || '';
  return row;
}

function normalizeRows(rows, options, modelByPs) {
  if (!Array.isArray(rows)) return rows;
  return rows.map((row) => applyRobustGapComparison({ ...row }, options, modelByPs));
}

function normalizeConsolidatedTable2Rows(rows = []) {
  return (rows || []).map((row) => {
    const supportGapRaw = supportGapRawFromModel(row);
    return {
      ...row,
      supportGapRaw,
      supportGapMm: modelGapMmFromModel({ ...row, supportGapRaw }) ?? '',
    };
  });
}

function annotateRobustGapResult(result, options) {
  const consolidatedTable2Rows = normalizeConsolidatedTable2Rows(result?.consolidatedTable2Rows || []);
  const modelByPs = buildModelMap(consolidatedTable2Rows);
  const rows = normalizeRows(result?.rows, options, modelByPs);
  const outputRows = normalizeRows(result?.outputRows, options, modelByPs);
  const candidateRows = normalizeRows(result?.candidateRows || result?.candidates, options, modelByPs);
  const candidates = normalizeRows(result?.candidates || candidateRows, options, modelByPs);
  const validatorRows = normalizeRows(result?.validatorRows || rows, options, modelByPs);
  const gapConflicts = (candidates || []).filter((row) => row.gapMatch === 'GAP_CONFLICT').length;
  return {
    ...result,
    consolidatedTable2Rows,
    rows,
    outputRows,
    candidateRows,
    candidates,
    validatorRows,
    summary: {
      ...(result?.summary || {}),
      gapConflicts,
    },
    approxConfig: {
      ...(result?.approxConfig || {}),
      supportGapLogic: 'Robust parser accepts 5mm gap, 5 mm gap, gap=5mm, Gap = 5 mm, GUIDE GAP: 5 mm, and bracketed [GUIDE GAP=5mm] forms.',
    },
  };
}

export function runPsMappingResolver(input = {}) {
  const options = normalizePsMappingOptions(input.options || {});
  const result = runV3PsMappingResolver({ ...input, options });
  return annotateRobustGapResult(result, options);
}
