import { renderLegacyModelConvertersTab } from './model-converters/legacy-adapter.js';
import { installInputXmlDxfBranchPicker } from './model-converters/inputxml-dxf-branch-picker.js';
import { installInputXmlDxfLegacyBridge } from './model-converters/inputxml-dxf-legacy-bridge.js';
import { installInputXmlDxfProjectionOption } from './model-converters/inputxml-dxf-projection-option.js';
import { installInputXmlDxfSymbolOption } from './model-converters/inputxml-dxf-symbol-option.js';
import { installInputXmlGlbLegacyBridge } from './model-converters/inputxml-glb-legacy-bridge.js';
import { installXmlCiiPreviewLineKeyRemap } from './model-converters/xml-cii-preview-linekey-remap.js';
import { installXmlCiiWorkflowUiFixes } from './model-converters/xml-cii-workflow-ui-fixes.js';
import { installXmlCiiDefaultMasterAutoload, installXmlCiiRecoveryPatch } from './xml-cii-master-autoload-patch.js';

export function renderModelConvertersTab(container, ctx) {
  const result = renderLegacyModelConvertersTab(container, ctx);
  installXmlCiiDefaultMasterAutoload();
  installXmlCiiRecoveryPatch();
  installXmlCiiPreviewLineKeyRemap();
  installXmlCiiWorkflowUiFixes();
  installInputXmlDxfLegacyBridge(container);
  installInputXmlDxfBranchPicker(container);
  installInputXmlDxfSymbolOption(container);
  installInputXmlDxfProjectionOption(container);
  installInputXmlGlbLegacyBridge(container);
  return result;
}
