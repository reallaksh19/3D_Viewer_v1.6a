import { installPsMappingUtilityTile as installBasePsMappingUtilityTile } from './ps-mapping-utility-tab-header-map-ui.js?v=20260611-psmap-header-map-1';

const STYLE_ID = 'psmap-rules-preview-style';

function h(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function installStyle() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `.psmap-rules-note{border:1px solid rgba(34,197,94,.32);background:rgba(20,83,45,.18);border-radius:12px;padding:9px 11px;margin:8px 0;color:#d1fae5;font-size:12px}.psmap-rules-note b{color:#bbf7d0}.psmap-legacy-control{opacity:.62}.psmap-legacy-badge{display:inline-block;margin-left:6px;padding:1px 6px;border-radius:999px;background:rgba(148,163,184,.16);color:#cbd5e1;font-size:10px;font-weight:800}.psmap-near-preview{border:1px solid rgba(96,165,250,.28);background:rgba(15,23,42,.5);border-radius:12px;padding:10px;margin-top:10px}.psmap-near-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}.psmap-near-preview input{box-sizing:border-box;width:100%;border:1px solid rgba(143,197,255,.22);border-radius:8px;background:#020617;color:#e5edf7;padding:6px 8px;font:12px ui-monospace,Consolas,monospace}.psmap-near-result{margin-top:8px;border-radius:10px;padding:8px;background:rgba(2,6,23,.5);font:12px ui-monospace,Consolas,monospace;white-space:pre-wrap}.psmap-near-ok{color:#bbf7d0}.psmap-near-review{color:#fde68a}.psmap-near-bad{color:#fecaca}`;
  document.head.appendChild(style);
}

function extractLineFamily(value) {
  const text = String(value || '').toUpperCase().replace(/[\u2010-\u2015]/g, '-').replace(/\s+/g, ' ');
  const matches = [...text.matchAll(/\b([A-Z])[-\s]*(\d{4,})\b/g)];
  if (!matches.length) return '';
  const last = matches[matches.length - 1];
  return `${last[1]}${last[2]}`;
}

function editDistance(a, b) {
  const x = String(a || '');
  const y = String(b || '');
  const dp = Array.from({ length: x.length + 1 }, () => Array(y.length + 1).fill(0));
  for (let i = 0; i <= x.length; i += 1) dp[i][0] = i;
  for (let j = 0; j <= y.length; j += 1) dp[0][j] = j;
  for (let i = 1; i <= x.length; i += 1) {
    for (let j = 1; j <= y.length; j += 1) {
      const cost = x[i - 1] === y[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
    }
  }
  return dp[x.length][y.length];
}

function numericSetup(name, fallback) {
  const input = document.querySelector(`[data-psmap-setup="${name}"]`);
  const value = Number(input?.value);
  return Number.isFinite(value) ? value : fallback;
}

function renderNearResult(host) {
  const modelRaw = host.querySelector('[data-psmap-near-model]')?.value || '';
  const nodeRaw = host.querySelector('[data-psmap-near-node]')?.value || '';
  const maxDistance = numericSetup('nearLineMaxEditDistance', 1);
  const minStem = numericSetup('nearLineMinStemLength', 6);
  const model = extractLineFamily(modelRaw);
  const node = extractLineFamily(nodeRaw);
  const distance = model && node ? editDistance(model, node) : null;
  const minLen = Math.min(model.length || 0, node.length || 0);
  let status = 'LINE_MISSING';
  let css = 'psmap-near-bad';
  let action = 'Extract both line families first.';
  if (model && node && model === node) {
    status = 'LINE_FAMILY';
    css = 'psmap-near-ok';
    action = 'Exact canonical line-family match. Not approximate.';
  } else if (model && node && minLen >= minStem && distance <= maxDistance) {
    status = 'LINE_FAMILY_NEAR_MISMATCH';
    css = 'psmap-near-review';
    action = 'Review-only near diagnostic. Do not auto-correct.';
  } else if (model && node) {
    status = 'LINE_CONFLICT';
    css = 'psmap-near-bad';
    action = 'Too different for near-line diagnostic.';
  }
  const result = host.querySelector('[data-psmap-near-result]');
  if (result) {
    result.className = `psmap-near-result ${css}`;
    result.textContent = `Table-2 family: ${model || '-'}\nTable-1 family: ${node || '-'}\nEdit distance: ${distance == null ? '-' : distance}\nNear max edit distance: ${maxDistance}\nNear min stem length: ${minStem}\nActual min length: ${minLen || '-'}\nResult: ${status}\nAction: ${action}`;
  }
}

function patchLegacyControls(panel) {
  const oldToggle = panel.querySelector('[data-psmap-setup="useBuiltInSupportKeywordLogic"]');
  if (oldToggle) {
    oldToggle.checked = true;
    oldToggle.disabled = true;
    const label = oldToggle.closest('label');
    if (label && !label.querySelector('[data-psmap-legacy-badge]')) {
      label.classList.add('psmap-legacy-control');
      label.insertAdjacentHTML('beforeend', '<span class="psmap-legacy-badge" data-psmap-legacy-badge>legacy - rules table always active</span>');
    }
  }
  const anchorToggle = panel.querySelector('[data-psmap-setup="treatAnchorAsLineStop"]');
  if (anchorToggle) {
    anchorToggle.checked = true;
    anchorToggle.disabled = true;
  }
}

function ensureRulesNotice(panel) {
  const supportCard = panel.querySelector('[data-psmap-support-config]');
  if (!supportCard || supportCard.querySelector('[data-psmap-rules-source-note]')) return;
  const note = document.createElement('div');
  note.className = 'psmap-rules-note';
  note.setAttribute('data-psmap-rules-source-note', '1');
  note.innerHTML = '<b>Active support logic:</b> Support Keyword Rules: Pattern -&gt; Canonical is the source of truth for Table-1C ISONOTE and Table-2 DTXR. Table-1D Master Keyword Searcher is legacy/optional and should only be used as a manual reference.';
  supportCard.querySelector('.psmap-card-body')?.prepend(note);
}

function ensureNearPreview(panel) {
  if (panel.querySelector('[data-psmap-near-preview]')) return;
  const host = document.createElement('div');
  host.className = 'psmap-near-preview';
  host.setAttribute('data-psmap-near-preview', '1');
  host.innerHTML = `<div style="font-weight:800;margin-bottom:6px;color:#dbeafe">Near Line No. sandbox</div>
    <div class="psmap-near-grid">
      <label>Table-2 pipe / line<input data-psmap-near-model value="P88102014"></label>
      <label>Table-1 line<input data-psmap-near-node value="P8810204"></label>
    </div>
    <div data-psmap-near-result class="psmap-near-result"></div>`;
  const configBody = panel.querySelector('.psmap-card-body') || panel;
  configBody.appendChild(host);
  const update = () => renderNearResult(host);
  host.addEventListener('input', update);
  panel.addEventListener('input', (event) => {
    if (event.target?.matches?.('[data-psmap-setup="nearLineMaxEditDistance"], [data-psmap-setup="nearLineMinStemLength"]')) update();
  });
  update();
}

function patchConfig() {
  const panel = document.querySelector('[data-psmap-panel="config"]');
  if (!panel) return;
  installStyle();
  patchLegacyControls(panel);
  ensureRulesNotice(panel);
  ensureNearPreview(panel);
}

function installRulesPreview() {
  installStyle();
  const observer = new MutationObserver(patchConfig);
  observer.observe(document.body, { childList: true, subtree: true });
  document.addEventListener('input', patchConfig, true);
  document.addEventListener('change', patchConfig, true);
  patchConfig();
  return () => {
    observer.disconnect();
    document.removeEventListener('input', patchConfig, true);
    document.removeEventListener('change', patchConfig, true);
  };
}

export function installPsMappingUtilityTile(container, ctx = {}) {
  const destroyBase = installBasePsMappingUtilityTile(container, ctx);
  const destroyPreview = installRulesPreview();
  return () => {
    try { destroyPreview?.(); } catch {}
    try { destroyBase?.(); } catch {}
  };
}
