import {
  PSNM_parsePsPosition,
  PSNM_parsePsRows,
} from './psnm-match-engine.js';
import {
  PSNM_makeMasterPsRow,
  PSNM_MASTER_STATUS,
  PSNM_isAuditStatus,
  PSNM_normalizePsName,
} from './psnm-master-types.js';
import { PSNM_logPsTableLogic } from './psnm-table-logic-log.js';

function PSNM_number(value) {
  const text = String(value ?? '').trim();
  if (!text || text === '-') return NaN;
  const match = text.replace(/,/g, '').match(/-?\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : NaN;
}

function PSNM_splitCells(line) {
  const raw = String(line || '').trim();
  if (!raw) return [];
  if (raw.includes('\t')) return raw.split('\t').map((cell) => cell.trim());
  return raw.split(/ {2,}/).map((cell) => cell.trim()).filter(Boolean);
}

function PSNM_normHeader(value) {
  return String(value ?? '').toLowerCase().replace(/[_.-]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function PSNM_isTrue(value) {
  return /^(yes|y|true|1|m|mandatory|required|req|must)$/i.test(String(value ?? '').trim());
}

function PSNM_positionFromAnyText(value) {
  const text = String(value || '').replace(/,/g, ' ');
  const parts = [];
  const e = text.match(/\b([EW])\s*(-?\d+(?:\.\d+)?)\s*(?:mm)?\b/i);
  const s = text.match(/\b([SN])\s*(-?\d+(?:\.\d+)?)\s*(?:mm)?\b/i);
  const u = text.match(/\b([UD])\s*(-?\d+(?:\.\d+)?)\s*(?:mm)?\b/i);
  if (e) parts.push(`${e[1].toUpperCase()} ${e[2]}mm`);
  if (s) parts.push(`${s[1].toUpperCase()} ${s[2]}mm`);
  if (u) parts.push(`${u[1].toUpperCase()} ${u[2]}mm`);
  return parts.length === 3 ? parts.join(' ') : '';
}

function PSNM_findPsName(cells, byHeader = {}) {
  const direct = byHeader['ps name'] || byHeader.psname || byHeader['ps no'] || byHeader['ps number'] || byHeader.ps || byHeader.name || byHeader['support name'] || byHeader['support point'];
  if (direct) return PSNM_normalizePsName(direct);
  const joined = cells.join(' ');
  const psMatch = joined.match(/\bPS[-_/A-Z0-9.]+(?:\/DATUM)?\b/i);
  if (psMatch) return PSNM_normalizePsName(psMatch[0]);
  return PSNM_normalizePsName(cells[0] || '');
}

function PSNM_positionFromRow(cells, byHeader = {}) {
  const direct = byHeader.position || byHeader['ps position'] || byHeader['position raw'] || byHeader['coordinates'] || byHeader.coord || byHeader.coordinate;
  const fromDirect = PSNM_positionFromAnyText(direct);
  if (fromDirect) return fromDirect;

  const e = byHeader.e || byHeader['ps e'] || byHeader.east || byHeader.easting;
  const nOrS = byHeader.s || byHeader['ps s'] || byHeader.south || byHeader.southing || byHeader.n || byHeader['ps n'] || byHeader.north || byHeader.northing;
  const u = byHeader.u || byHeader['ps u'] || byHeader.up || byHeader.elevation || byHeader.el || byHeader.z;
  if (e !== undefined && nOrS !== undefined && u !== undefined) {
    const eVal = PSNM_number(e);
    const nOrSVal = PSNM_number(nOrS);
    const uVal = PSNM_number(u);
    if (Number.isFinite(eVal) && Number.isFinite(nOrSVal) && Number.isFinite(uVal)) return `E ${eVal}mm S ${nOrSVal}mm U ${uVal}mm`;
  }

  return PSNM_positionFromAnyText(cells.join(' '));
}

function PSNM_boreFromRow(cells, byHeader = {}) {
  const direct = byHeader.p1bore || byHeader['p1 bore'] || byHeader.bore || byHeader.nb || byHeader.dn || byHeader['bore mm'] || byHeader['bore(mm)'];
  const n = PSNM_number(direct);
  if (Number.isFinite(n)) return n;

  if (!Object.keys(byHeader || {}).length && cells.length >= 3) {
    const last = PSNM_number(cells[cells.length - 1]);
    const beforeLast = PSNM_number(cells[cells.length - 2]);
    if (Number.isFinite(last) && !/\b[ESUWND]\b/i.test(cells[cells.length - 1])) return last;
    if (Number.isFinite(beforeLast) && !/\b[ESUWND]\b/i.test(cells[cells.length - 2])) return beforeLast;
  }

  return NaN;
}

function PSNM_parseTable1Fallback(text, logger = null) {
  const lines = String(text || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !/^-{3,}$/.test(line));
  if (!lines.length) return [];

  const firstCells = PSNM_splitCells(lines[0]);
  const firstHeaders = firstCells.map(PSNM_normHeader);
  const hasHeader = firstHeaders.some((h) => ['ps name', 'ps no', 'ps number', 'ps', 'position', 'ps position', 'e', 'n', 's', 'u', 'bore'].includes(h));
  const headers = hasHeader ? firstHeaders : null;
  const dataLines = hasHeader ? lines.slice(1) : lines;
  const rows = [];

  for (const [index, line] of dataLines.entries()) {
    const cells = PSNM_splitCells(line);
    if (!cells.length) continue;
    const byHeader = {};
    if (headers) headers.forEach((header, cellIndex) => { byHeader[header] = cells[cellIndex] ?? ''; });
    const psName = PSNM_findPsName(cells, byHeader);
    const position = PSNM_positionFromRow(cells, byHeader);
    if (!psName || !position) {
      logger?.user?.('WARNING', 'PS Row Skipped', 'Table 1', line, 'Fallback parser could not find both PS name and E/N/S/U position.', 'Check Table 1 columns or include a Position column with E ... S/N ... U ... format.', { rowIndex: index + 1 });
      continue;
    }
    rows.push({
      psName,
      position,
      p1bore: PSNM_boreFromRow(cells, byHeader),
      isMandatoryPs: PSNM_isTrue(byHeader.mandatory || byHeader.required || byHeader.req || byHeader.m || ''),
      mandatorySource: '',
      rowIndex: index + 1,
    });
  }

  if (rows.length) logger?.user?.('INFO', 'Table 1 Fallback Parser', 'Table 1', `${rows.length} PS rows`, 'Strict PS parser returned no rows; fallback parser recovered PS rows including E/N/U benchmark columns.', 'Verify Master PS No preview before matching.', {});
  return rows;
}

export function PSNM_parseTable4A(text, logger = null) {
  const rows = [];
  const lines = String(text || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !/^-{3,}$/.test(line));

  let headers = null;
  for (const [index, line] of lines.entries()) {
    const cells = PSNM_splitCells(line);
    const lowered = cells.map(PSNM_normHeader);
    const looksLikeHeader = lowered.some((cell) => cell.includes('ps name') || cell === 'psname' || cell === 'mandatory ps name');
    if (index === 0 && looksLikeHeader) {
      headers = lowered;
      continue;
    }

    const byHeader = {};
    if (headers) headers.forEach((header, cellIndex) => { byHeader[header] = cells[cellIndex] ?? ''; });

    const psName = PSNM_normalizePsName(
      byHeader['ps name'] || byHeader.psname || byHeader['mandatory ps name'] || cells[0] || line
    );
    if (!psName || /^mandatory ps name$/i.test(psName)) continue;

    const mandatoryRaw = byHeader.mandatory || byHeader.required || cells[1] || 'YES';
    const p1boreOverride = PSNM_number(byHeader.p1bore || byHeader.bore || byHeader.dn || byHeader.nb || cells[2]);
    const positionOverride = byHeader.position || byHeader['position override'] || cells[3] || '';
    const remarks = byHeader.remarks || byHeader.remark || byHeader.note || cells[4] || '';

    rows.push({
      psName,
      isMandatoryPs: PSNM_isTrue(mandatoryRaw) || !headers,
      mandatorySource: 'TABLE4A',
      p1boreOverride: Number.isFinite(p1boreOverride) ? p1boreOverride : null,
      positionOverride,
      remarks,
      sourceRow: index + 1,
    });
  }

  if (!rows.length && String(text || '').trim()) {
    logger?.user?.('WARNING', 'Table 4A Empty', 'Table 4A', 'PS override', 'No PS mandatory/override rows were parsed.', 'Check Table 4A format. Use either Mandatory PS Name list or PS NAME / Mandatory / p1bore override.', {});
  }
  return rows;
}

function PSNM_parseMasterPsPosition(row, logger = null) {
  try {
    const parsed = PSNM_parsePsPosition(row.positionRaw);
    row.psE = parsed.e;
    row.psU = parsed.u;
    row.psS = parsed.s;
    if (row.status === PSNM_MASTER_STATUS.INVALID_POSITION) row.status = PSNM_MASTER_STATUS.OK;
  } catch (error) {
    row.psE = null;
    row.psU = null;
    row.psS = null;
    row.status = row.positionRaw ? PSNM_MASTER_STATUS.INVALID_POSITION : row.status;
    if (row.positionRaw) {
      logger?.user?.('ERROR', 'Invalid PS Position', row.sourceTable || 'Master PS', row.psName, error.message || String(error), 'Correct PS position format: E ...mm S/N ...mm U ...mm.', { rowId: row.rowId });
    }
  }
  return row;
}

export function PSNM_recomputeMasterPsRow(row, logger = null) {
  row.psKey = PSNM_normalizePsName(row.psName);
  if (row.enabled === false) row.status = PSNM_MASTER_STATUS.DISABLED;
  else if (PSNM_isAuditStatus(row.auditStatus || row.status)) {
    row.status = row.auditStatus || row.status;
    return row;
  }
  if (row.status !== PSNM_MASTER_STATUS.MISSING_FROM_TABLE1 && row.enabled !== false) {
    row.status = PSNM_MASTER_STATUS.OK;
    PSNM_parseMasterPsPosition(row, logger);
  }
  return row;
}

export function PSNM_resolveMasterPsTable({ table1Text, table4AText, logger = null }) {
  let table1Rows = PSNM_parsePsRows(table1Text, logger);
  if (!table1Rows.length && String(table1Text || '').trim()) table1Rows = PSNM_parseTable1Fallback(table1Text, logger);
  const table4ARows = PSNM_parseTable4A(table4AText, logger);
  PSNM_logPsTableLogic({ logger, table1Text, table1Rows, table4AText, table4ARows });
  const byPs = new Map();
  const duplicateKeys = new Set();

  for (const row of table1Rows) {
    const auditStatus = row.auditStatus || '';
    const visiblePsName = row.psName || (auditStatus ? `(missing PS name row ${row.rowIndex})` : '');
    const psKey = PSNM_normalizePsName(visiblePsName);
    if (!psKey) continue;

    if (byPs.has(psKey)) {
      duplicateKeys.add(psKey);
      logger?.user?.('WARNING', 'Duplicate PS', 'Table 1', row.psName, 'Duplicate PS name found. First row kept in Master PS No.', 'Review duplicate PS in Table 1 before matching.', { psName: row.psName, rowIndex: row.rowIndex });
      continue;
    }

    const master = PSNM_makeMasterPsRow({
      psKey,
      psName: visiblePsName,
      positionRaw: row.position,
      p1bore: Number.isFinite(row.p1bore) ? row.p1bore : null,
      isMandatoryPs: row.isMandatoryPs === true,
      mandatorySource: row.isMandatoryPs ? 'TABLE1' : '',
      sourceTable: 'TABLE1',
      sourceRow: row.rowIndex,
      status: auditStatus || PSNM_MASTER_STATUS.OK,
      auditStatus,
      auditSeverity: row.auditSeverity || '',
      auditAction: row.auditAction || '',
      remarks: row.auditAction || '',
    });
    PSNM_parseMasterPsPosition(master, logger);
    byPs.set(psKey, master);
  }

  for (const override of table4ARows) {
    const psKey = PSNM_normalizePsName(override.psName);
    if (!psKey) continue;
    const existing = byPs.get(psKey);
    if (!existing) {
      const missing = PSNM_makeMasterPsRow({
        psKey,
        psName: override.psName,
        p1bore: override.p1boreOverride,
        positionRaw: override.positionOverride,
        isMandatoryPs: override.isMandatoryPs,
        mandatorySource: 'TABLE4A',
        sourceTable: 'TABLE4A',
        sourceRow: override.sourceRow,
        status: PSNM_MASTER_STATUS.MISSING_FROM_TABLE1,
        remarks: override.remarks || 'Listed in Table 4A but absent from Table 1.',
      });
      if (missing.positionRaw) PSNM_parseMasterPsPosition(missing, logger);
      byPs.set(psKey, missing);
      logger?.user?.('WARNING', 'Mandatory PS Missing', 'Table 4A', override.psName, 'PS is mandatory/overridden in Table 4A but absent from Table 1.', 'Add this PS to Table 1 or remove it from Table 4A.', { psName: override.psName });
      continue;
    }
    existing.isMandatoryPs = existing.isMandatoryPs || override.isMandatoryPs;
    existing.mandatorySource = [existing.mandatorySource, override.mandatorySource].filter(Boolean).join(';');
    if (override.p1boreOverride != null) existing.p1bore = override.p1boreOverride;
    if (override.positionOverride) {
      existing.positionRaw = override.positionOverride;
      PSNM_parseMasterPsPosition(existing, logger);
    }
    if (override.remarks) existing.remarks = [existing.remarks, override.remarks].filter(Boolean).join(' | ');
  }

  const rows = Array.from(byPs.values()).map((row) => PSNM_recomputeMasterPsRow(row, logger));
  return {
    rows,
    table1Rows,
    table4ARows,
    issues: rows.filter((row) => row.status !== PSNM_MASTER_STATUS.OK),
    duplicateKeys: Array.from(duplicateKeys),
  };
}
