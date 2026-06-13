import * as THREE from 'three';

const UP = new THREE.Vector3(0, 1, 0);
const X_AXIS = new THREE.Vector3(1, 0, 0);
const Y_AXIS = new THREE.Vector3(0, 1, 0);
const Z_AXIS = new THREE.Vector3(0, 0, 1);

const KIND_COLORS = {
  REST: 0x22c55e,
  GUIDE: 0x22c55e,
  LINESTOP: 0x16a34a,
  LIMIT: 0x84cc16,
  ANCHOR: 0xef4444,
  SPRING: 0xa855f7,
  HANGER: 0xa855f7,
  SHOE: 0x22c55e,
  UNKNOWN: 0x94a3b8,
};

function text(value) {
  return String(value ?? '').trim();
}

function upper(value) {
  return text(value).toUpperCase();
}

function number(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function attrsFrom(object, comp = {}) {
  return {
    ...(comp.raw || {}),
    ...(comp.attributes || {}),
    ...(object?.userData || {}),
  };
}

function supportKind(attrs = {}, comp = {}) {
  const kind = upper(comp.supportKind || attrs.supportKind || attrs.SUPPORT_KIND || attrs.CAESAR_SUPPORT_KIND || attrs.caesarSupportKind || attrs.CMPSUPTYPE || attrs.SKEY);
  if (kind === 'LINE_STOP') return 'LINESTOP';
  if (kind === 'HANGER') return 'HANGER';
  if (KIND_COLORS[kind]) return kind;
  return 'UNKNOWN';
}

function vectorFromObject(value) {
  if (!value || typeof value !== 'object') return null;
  const x = number(value.x ?? value.X);
  const y = number(value.y ?? value.Y);
  const z = number(value.z ?? value.Z);
  if ([x, y, z].some((v) => v == null)) return null;
  const axis = new THREE.Vector3(x, y, z);
  return axis.length() < 0.01 ? null : axis.normalize();
}

function storedSupportAxis(attrs = {}) {
  return vectorFromObject(attrs.supportAxis)
    || vectorFromObject(attrs.SUPPORT_AXIS)
    || vectorFromObject(attrs.caesarSupportAxis);
}

function cosineAxis(attrs = {}) {
  const x = number(attrs.caesarXCosine ?? attrs.XCOSINE ?? attrs.X_COSINE ?? attrs.XCOS ?? attrs.X);
  const y = number(attrs.caesarYCosine ?? attrs.YCOSINE ?? attrs.Y_COSINE ?? attrs.YCOS ?? attrs.Y);
  const z = number(attrs.caesarZCosine ?? attrs.ZCOSINE ?? attrs.Z_COSINE ?? attrs.ZCOS ?? attrs.Z);
  if ([x, y, z].some((value) => value == null)) return null;
  const axis = new THREE.Vector3(x, y, z);
  return axis.length() < 0.01 ? null : axis.normalize();
}

function textAxis(attrs = {}) {
  const src = upper([
    attrs.SUPPORT_DIRECTION,
    attrs['SUPPORT-DIRECTION'],
    attrs.SUPPORT_NAME,
    attrs.SUPPORT_TAG,
    attrs.labelText,
  ].join(' '));
  if (/\bX\b|\bEAST\b|\bWEST\b/.test(src)) return X_AXIS.clone();
  if (/\bY\b|\bUP\b|\bDOWN\b|\bVERTICAL\b/.test(src)) return Y_AXIS.clone();
  if (/\bZ\b|\bNORTH\b|\bSOUTH\b/.test(src)) return Z_AXIS.clone();
  return null;
}

function supportAxis(attrs = {}) {
  return storedSupportAxis(attrs) || cosineAxis(attrs) || textAxis(attrs) || Z_AXIS.clone();
}

function pipeRadiusFor(comp = {}, attrs = {}) {
  const bore = number(comp.bore ?? attrs.bore ?? attrs.BORE ?? attrs.DIAMETER) || 100;
  return Math.max(bore / 2, 5);
}

function supportScaleFor(comp = {}, attrs = {}, options = {}) {
  const bore = number(comp.bore ?? attrs.bore ?? attrs.BORE ?? attrs.DIAMETER) || 100;
  const multiplier = number(options.supportSymbolScale) || 0.9;
  return Math.max(24, Math.min(170, bore * multiplier));
}

function perpendicular(axis) {
  const basis = Math.abs(axis.dot(UP)) > 0.9 ? X_AXIS : UP;
  const side = new THREE.Vector3().crossVectors(axis, basis);
  return side.length() < 0.01 ? X_AXIS.clone() : side.normalize();
}

function secondPerpendicular(axis, side) {
  const normal = new THREE.Vector3().crossVectors(axis, side);
  return normal.length() < 0.01 ? UP.clone() : normal.normalize();
}

function orientFromY(object, direction) {
  object.quaternion.setFromUnitVectors(UP, direction.clone().normalize());
}

function supportMaterial(color) {
  return new THREE.MeshStandardMaterial({
    color,
    emissive: color,
    emissiveIntensity: 0.06,
    roughness: 0.36,
    metalness: 0.12,
  });
}

function addBox(group, name, size, position, color) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(size.x, size.y, size.z), supportMaterial(color));
  mesh.name = name;
  mesh.position.copy(position);
  group.add(mesh);
  return mesh;
}

function addCylinder(group, name, radius, length, axis, position, color) {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, length, 20), supportMaterial(color));
  mesh.name = name;
  mesh.position.copy(position);
  orientFromY(mesh, axis);
  group.add(mesh);
  return mesh;
}

function addCone(group, name, coneRadius, height, axis, position, color) {
  const cone = new THREE.Mesh(new THREE.ConeGeometry(coneRadius, height, 24), supportMaterial(color));
  cone.name = name;
  cone.position.copy(position);
  orientFromY(cone, axis);
  group.add(cone);
  return cone;
}

function addRing(group, name, radius, tubeRadius, position, color) {
  const ring = new THREE.Mesh(new THREE.TorusGeometry(radius, tubeRadius, 12, 36), supportMaterial(color));
  ring.name = name;
  ring.position.copy(position);
  ring.rotation.x = Math.PI / 2;
  group.add(ring);
  return ring;
}

function addArrowBetween(group, name, start, end, radius, color) {
  const dir = new THREE.Vector3().subVectors(end, start);
  const length = dir.length();
  if (length < 0.01) return null;
  const axis = dir.normalize();
  const headLength = Math.min(radius * 0.72, length * 0.42);
  const shaftStart = start.clone();
  const shaftEnd = end.clone().add(axis.clone().multiplyScalar(-headLength));
  const shaftCenter = new THREE.Vector3().addVectors(shaftStart, shaftEnd).multiplyScalar(0.5);
  addCylinder(group, `${name}-shaft`, Math.max(radius * 0.055, 0.65), Math.max(shaftStart.distanceTo(shaftEnd), 0.01), axis, shaftCenter, color);
  const headCenter = end.clone().add(axis.clone().multiplyScalar(-headLength / 2));
  return addCone(group, name, radius * 0.28, headLength, axis, headCenter, color);
}

function addBasePadAt(group, id, radius, color, y) {
  addBox(
    group,
    `${id}-reference-base-pad`,
    new THREE.Vector3(radius * 2.9, radius * 0.24, radius * 2.9),
    new THREE.Vector3(0, y, 0),
    color,
  );
}

function addPostBetween(group, id, radius, color, yStart, yEnd) {
  const start = new THREE.Vector3(0, yStart, 0);
  const end = new THREE.Vector3(0, yEnd, 0);
  const length = Math.max(start.distanceTo(end), 0.01);
  addCylinder(group, `${id}-reference-post`, Math.max(radius * 0.09, 0.85), length, UP, new THREE.Vector3(0, (yStart + yEnd) / 2, 0), color);
}

function addPlate(group, name, axis, radius, color, offsetScale = 1.1) {
  const a = axis.clone().normalize();
  const side = perpendicular(a);
  const vertical = secondPerpendicular(a, side);
  const plate = addBox(
    group,
    name,
    new THREE.Vector3(radius * 0.18, radius * 1.32, radius * 1.32),
    a.clone().multiplyScalar(radius * offsetScale),
    color,
  );
  plate.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(a, vertical, side));
  return plate;
}

function hideExistingProxyMeshes(object, markerGroupName) {
  const hidden = [];
  for (const child of object.children || []) {
    if (child.name === markerGroupName) continue;
    child.traverse?.((node) => {
      if (node.isMesh) {
        node.visible = false;
        hidden.push(node.name || node.uuid);
      }
    });
  }
  return hidden;
}

function addRestBase(group, id, axis, radius, color, pipeRadius) {
  const pipeBottomY = -pipeRadius;
  const baseY = pipeBottomY - radius * 1.65;
  addBasePadAt(group, id, radius, color, baseY);
  addBox(group, `${id}-rest-base`, new THREE.Vector3(radius * 1.7, radius * 0.22, radius * 1.7), new THREE.Vector3(0, baseY + radius * 0.22, 0), color);
  addPostBetween(group, id, radius, color, baseY + radius * 0.34, pipeBottomY - radius * 0.1);
  addArrowBetween(group, `${id}-rest-axis`,
    new THREE.Vector3(0, baseY + radius * 0.14, 0),
    new THREE.Vector3(0, pipeBottomY, 0),
    radius, color);
}

function addGuideBaseWithoutVerticalArrow(group, id, radius, color, pipeRadius) {
  const pipeBottomY = -pipeRadius;
  const baseY = pipeBottomY - radius * 1.65;
  addBasePadAt(group, id, radius, color, baseY);
  addBox(group, `${id}-guide-base`, new THREE.Vector3(radius * 1.7, radius * 0.22, radius * 1.7), new THREE.Vector3(0, baseY + radius * 0.22, 0), color);
  addPostBetween(group, `${id}-guide`, radius, color, baseY + radius * 0.34, pipeBottomY - radius * 0.1);
}

function addGuideBars(group, id, axis, radius, color, pipeRadius) {
  const a = axis.clone().normalize();
  addGuideBaseWithoutVerticalArrow(group, id, radius, color, pipeRadius);

  const side = perpendicular(a);
  const outerDist = pipeRadius + radius * 2.1;
  const innerDist = pipeRadius + radius * 0.28;
  addBox(group, `${id}-guide-bar-positive`, new THREE.Vector3(radius * 0.22, radius * 1.25, radius * 0.22), side.clone().multiplyScalar(innerDist), color);
  addBox(group, `${id}-guide-bar-negative`, new THREE.Vector3(radius * 0.22, radius * 1.25, radius * 0.22), side.clone().multiplyScalar(-innerDist), color);
  addArrowBetween(group, `${id}-guide-axis-positive`,
    side.clone().multiplyScalar(outerDist),
    side.clone().multiplyScalar(innerDist),
    radius * 0.60, color);
  addArrowBetween(group, `${id}-guide-axis-negative`,
    side.clone().multiplyScalar(-outerDist),
    side.clone().multiplyScalar(-innerDist),
    radius * 0.60, color);
}

function addLineStop(group, id, axis, radius, color, pipeRadius) {
  const a = axis.clone().normalize();
  const outerDist = pipeRadius + radius * 2.1;
  const innerDist = pipeRadius + radius * 0.2;
  addPlate(group, `${id}-linestop-plate-positive`, a, radius, color, innerDist / radius);
  addPlate(group, `${id}-linestop-plate-negative`, a.clone().negate(), radius, color, innerDist / radius);
  addArrowBetween(group, `${id}-linestop-axis-positive`,
    a.clone().multiplyScalar(outerDist),
    a.clone().multiplyScalar(innerDist),
    radius, color);
  addArrowBetween(group, `${id}-linestop-axis-negative`,
    a.clone().multiplyScalar(-outerDist),
    a.clone().multiplyScalar(-innerDist),
    radius, color);
}

function addLimit(group, id, axis, radius, color, pipeRadius) {
  const a = axis.clone().normalize();
  addRestBase(group, id, a, radius, color, pipeRadius);
  addPlate(group, `${id}-limit-stop-plate`, a, radius, color, 0.96);
  addArrowBetween(group, `${id}-limit-axis`, a.clone().multiplyScalar(radius * 2.45), a.clone().multiplyScalar(radius * 0.40), radius, color);
}

function addAnchor(group, id, radius, color, pipeRadius) {
  addRestBase(group, id, UP, radius, color, pipeRadius);
  addBox(group, `${id}-anchor-block`, new THREE.Vector3(radius * 1.0, radius * 1.0, radius * 1.0), new THREE.Vector3(), color);
  [
    X_AXIS, X_AXIS.clone().negate(),
    Y_AXIS, Y_AXIS.clone().negate(),
    Z_AXIS, Z_AXIS.clone().negate(),
  ].forEach((axis, index) => addArrowBetween(group, `${id}-anchor-axis-${index + 1}`, new THREE.Vector3(), axis.clone().multiplyScalar(radius * 2.15), radius * 0.75, color));
}

function addHanger(group, id, radius, color, pipeRadius) {
  const pipeTopY = pipeRadius;
  const topY = pipeTopY + radius * 3.2;

  addBox(group, `${id}-hanger-top-plate`,
    new THREE.Vector3(radius * 2.6, radius * 0.22, radius * 2.6),
    new THREE.Vector3(0, topY, 0), color);

  addRing(group, `${id}-hanger-ring`, radius * 0.42, Math.max(radius * 0.045, 0.5), new THREE.Vector3(0, topY - radius * 0.55, 0), color);

  addCylinder(group, `${id}-hanger-rod`,
    Math.max(radius * 0.065, 0.85),
    topY - pipeTopY,
    UP,
    new THREE.Vector3(0, (topY + pipeTopY) / 2, 0),
    color);

  addArrowBetween(group, `${id}-hanger-load-axis`,
    new THREE.Vector3(0, topY - radius * 0.18, 0),
    new THREE.Vector3(0, pipeTopY, 0),
    radius * 0.78, color);
}

function addShoe(group, id, radius, color, pipeRadius) {
  const topY = -pipeRadius;
  const baseY = topY - radius * 1.25;
  addBasePadAt(group, id, radius, color, baseY);
  addBox(group, `${id}-shoe-base`, new THREE.Vector3(radius * 2.4, radius * 0.3, radius * 1.55), new THREE.Vector3(0, baseY + radius * 0.20, 0), color);
  addPostBetween(group, `${id}-shoe`, radius, color, baseY + radius * 0.34, topY - radius * 0.10);
}

export function enhanceSupportDirectionProxy(object, comp = {}, options = {}) {
  if (!object || comp.type !== 'SUPPORT') return object;
  const attrs = attrsFrom(object, comp);
  const kind = supportKind(attrs, comp);
  const axis = supportAxis(attrs);
  const radius = supportScaleFor(comp, attrs, options);
  const pipeRadius = pipeRadiusFor(comp, attrs);
  const color = KIND_COLORS[kind] || KIND_COLORS.UNKNOWN;
  const id = text(comp.id || object.name || 'support');

  const markerGroup = new THREE.Group();
  markerGroup.name = `${id}-directional-symbols`;
  markerGroup.userData = {
    labelText: object.userData?.labelText || `${id} ${kind}`,
    labelAnchor: false,
    supportKind: kind,
    supportAxis: { x: axis.x, y: axis.y, z: axis.z },
    supportSymbolScale: radius,
    supportPipeRadius: pipeRadius,
    glbShape: `support-reference-v2-${kind.toLowerCase()}`,
  };

  const hiddenOriginalProxyMeshes = hideExistingProxyMeshes(object, markerGroup.name);

  if (kind === 'GUIDE') addGuideBars(markerGroup, id, axis, radius, color, pipeRadius);
  else if (kind === 'LINESTOP') addLineStop(markerGroup, id, axis, radius, color, pipeRadius);
  else if (kind === 'LIMIT') addLimit(markerGroup, id, axis, radius, color, pipeRadius);
  else if (kind === 'ANCHOR') addAnchor(markerGroup, id, radius, color, pipeRadius);
  else if (kind === 'SPRING' || kind === 'HANGER') addHanger(markerGroup, id, radius, color, pipeRadius);
  else if (kind === 'SHOE') addShoe(markerGroup, id, radius, color, pipeRadius);
  else addRestBase(markerGroup, id, UP, radius, color, pipeRadius);

  object.add(markerGroup);
  object.userData = {
    ...(object.userData || {}),
    supportKind: kind,
    supportAxis: { x: axis.x, y: axis.y, z: axis.z },
    supportSymbolScale: radius,
    supportPipeRadius: pipeRadius,
    directionalSupportEnhanced: true,
    directionalSupportSymbolCount: markerGroup.children.length,
    supportReferenceStyle: true,
    supportReferenceStyleV2: true,
    hiddenOriginalProxyMeshCount: hiddenOriginalProxyMeshes.length,
  };
  return object;
}
