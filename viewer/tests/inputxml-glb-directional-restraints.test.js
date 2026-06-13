import assert from 'node:assert/strict';

import { buildExportScene } from '../js/pcf2glb/glb/buildExportScene.js';

function support(id, kind, axis = { x: 1, y: 0, z: 0 }, extra = {}) {
  const { component = {}, attributes = {} } = extra;
  return {
    id,
    type: 'SUPPORT',
    bore: component.bore ?? 20,
    coOrds: { x: 0, y: 0, z: 0 },
    ep1: { x: 0, y: 0, z: 0 },
    refNo: id,
    supportKind: kind,
    attributes: {
      COMPONENT_IDENTIFIER: id,
      SUPPORT_TAG: id,
      SUPPORT_KIND: kind,
      CAESAR_SUPPORT_KIND: kind,
      caesarXCosine: String(axis.x),
      caesarYCosine: String(axis.y),
      caesarZCosine: String(axis.z),
      ...attributes,
    },
    raw: {
      caesarSupportKind: kind,
      caesarXCosine: String(axis.x),
      caesarYCosine: String(axis.y),
      caesarZCosine: String(axis.z),
    },
    ...component,
  };
}

function supportObject(component) {
  const scene = buildExportScene({ components: [component] });
  const object = scene.getObjectByName(component.id);
  assert.ok(object, `${component.id} should be present in GLB scene`);
  assert.equal(object.userData.directionalSupportEnhanced, true);
  assert.equal(object.userData.supportReferenceStyle, true);
  assert.ok(object.userData.directionalSupportSymbolCount > 0);
  assert.ok(object.userData.supportSymbolScale >= 22, `${component.id} should use visible engineering scale`);
  return object;
}

function child(object, name) {
  const found = object.getObjectByName(name);
  assert.ok(found, `${object.name} should contain ${name}`);
  return found;
}

function noChild(object, name) {
  const found = object.getObjectByName(name);
  assert.equal(found, undefined, `${object.name} should not contain ${name}`);
}

function referenceBase(object, id) {
  child(object, `${id}-directional-symbols`);
  child(object, `${id}-reference-base-pad`);
}

const guide = supportObject(support('GUIDE-X', 'GUIDE', { x: 1, y: 0, z: 0 }));
referenceBase(guide, 'GUIDE-X');
child(guide, 'GUIDE-X-guide-base');
child(guide, 'GUIDE-X-guide-reference-post');
child(guide, 'GUIDE-X-guide-bar-positive');
child(guide, 'GUIDE-X-guide-bar-negative');
child(guide, 'GUIDE-X-guide-axis-positive');
child(guide, 'GUIDE-X-guide-axis-positive-shaft');
child(guide, 'GUIDE-X-guide-axis-negative');
noChild(guide, 'GUIDE-X-rest-axis');
noChild(guide, 'GUIDE-X-guide-rest-axis');
assert.equal(guide.userData.supportKind, 'GUIDE');
assert.deepEqual(guide.userData.supportAxis, { x: 1, y: 0, z: 0 });

const lineStop = supportObject(support('LS-Z', 'LINESTOP', { x: 0, y: 0, z: 1 }));
child(lineStop, 'LS-Z-linestop-plate-positive');
child(lineStop, 'LS-Z-linestop-plate-negative');
child(lineStop, 'LS-Z-linestop-axis-positive');
child(lineStop, 'LS-Z-linestop-axis-negative');
assert.equal(lineStop.userData.supportKind, 'LINESTOP');

const limit = supportObject(support('LIMIT-X', 'LIMIT', { x: -1, y: 0, z: 0 }));
referenceBase(limit, 'LIMIT-X');
child(limit, 'LIMIT-X-reference-post');
child(limit, 'LIMIT-X-limit-stop-plate');
child(limit, 'LIMIT-X-limit-axis');
assert.equal(limit.userData.supportKind, 'LIMIT');
assert.deepEqual(limit.userData.supportAxis, { x: -1, y: 0, z: 0 });

const anchor = supportObject(support('ANCHOR', 'ANCHOR'));
referenceBase(anchor, 'ANCHOR');
child(anchor, 'ANCHOR-anchor-block');
for (let index = 1; index <= 6; index += 1) child(anchor, `ANCHOR-anchor-axis-${index}`);
assert.equal(anchor.userData.supportKind, 'ANCHOR');

const hanger = supportObject(support('HANGER', 'HANGER', { x: 0, y: 1, z: 0 }));
child(hanger, 'HANGER-hanger-rod');
child(hanger, 'HANGER-hanger-ring');
child(hanger, 'HANGER-hanger-load-axis');
assert.equal(hanger.userData.supportKind, 'HANGER');

const spring = supportObject(support('SPRING', 'SPRING', { x: 0, y: 1, z: 0 }));
child(spring, 'SPRING-hanger-rod');
child(spring, 'SPRING-hanger-ring');
assert.equal(spring.userData.supportKind, 'SPRING');

const rest = supportObject(support('REST-Y', 'REST', { x: 0, y: 1, z: 0 }));
referenceBase(rest, 'REST-Y');
child(rest, 'REST-Y-reference-post');
child(rest, 'REST-Y-rest-base');
child(rest, 'REST-Y-rest-axis');
assert.equal(rest.userData.supportKind, 'REST');

const largeGuide = supportObject(support('GUIDE-LARGE', 'GUIDE', { x: 1, y: 0, z: 0 }, { component: { bore: 300 } }));
assert.ok(largeGuide.userData.supportSymbolScale > guide.userData.supportSymbolScale);
child(largeGuide, 'GUIDE-LARGE-reference-base-pad');
noChild(largeGuide, 'GUIDE-LARGE-rest-axis');

console.log('inputxml-glb-directional-restraints.test.js passed');
