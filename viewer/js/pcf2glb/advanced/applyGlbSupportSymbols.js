/**
 * Runtime GLB support symbol builder.
 *
 * Mirrors the RVM viewer's RvmSupportSymbols approach: instead of relying on
 * geometry baked into the GLB (which suffers from export/import positioning
 * issues), this module rebuilds support symbols at load time using the support
 * kind and axis metadata stored in userData during GLB export.
 *
 * Symbols are added to a dedicated scene-root Group so they are always at the
 * correct world-space position regardless of the support object's local
 * transform hierarchy.
 */

import * as THREE from 'three';

const GLB_SUPPORT_SYMBOLS_GROUP = '__GLB_SUPPORT_SYMBOLS_V3__';

const SYMBOL_COLOR = {
  REST: 0x22c55e,
  GUIDE: 0x22c55e,
  LINESTOP: 0x16a34a,
  LIMIT: 0x16a34a,
  ANCHOR: 0xef4444,
  SPRING: 0xa855f7,
  HANGER: 0xa855f7,
  SHOE: 0x22c55e,
  UNKNOWN: 0x94a3b8,
};

const UP = new THREE.Vector3(0, 1, 0);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function supportMat(color) {
  return new THREE.MeshStandardMaterial({
    color,
    emissive: color,
    emissiveIntensity: 0.08,
    roughness: 0.38,
    metalness: 0.10,
  });
}

function orientAlongY(mesh, dir) {
  mesh.quaternion.setFromUnitVectors(UP, dir.clone().normalize());
}

/**
 * Arrow from world start → end with given shaft radius.
 * Returns a Group containing shaft cylinder + cone head.
 */
function makeArrow(start, end, color, r) {
  const group = new THREE.Group();
  const v = new THREE.Vector3().subVectors(end, start);
  const len = v.length();
  if (len < 0.5) return group;

  const dir = v.normalize();
  const headLen = Math.min(len * 0.30, r * 12);
  const shaftLen = Math.max(len - headLen, r * 0.5);
  const mat = supportMat(color);

  const shaft = new THREE.Mesh(
    new THREE.CylinderGeometry(r, r, shaftLen, 12),
    mat,
  );
  shaft.userData.glbSupportSymbolMesh = true;
  shaft.position.copy(start.clone().add(dir.clone().multiplyScalar(shaftLen * 0.5)));
  orientAlongY(shaft, dir);
  group.add(shaft);

  const head = new THREE.Mesh(
    new THREE.ConeGeometry(r * 3.0, headLen, 16),
    mat,
  );
  head.userData.glbSupportSymbolMesh = true;
  head.position.copy(start.clone().add(dir.clone().multiplyScalar(shaftLen + headLen * 0.5)));
  orientAlongY(head, dir);
  group.add(head);

  return group;
}

/**
 * Flat horizontal base plate, oriented so its long axis aligns with pipeAxis.
 * Uses a Gram-Schmidt orthonormalization so the basis is valid even when
 * pipeAxis is parallel or near-parallel to UP (vertical pipe).
 */
function makePlate(center, pipeAxis, lateral, scale, color) {
  const geo = new THREE.BoxGeometry(scale * 1.1, scale * 0.12, scale * 0.65);
  const mesh = new THREE.Mesh(geo, supportMat(color));
  mesh.userData.glbSupportSymbolMesh = true;
  mesh.position.copy(center);

  const a = pipeAxis.clone().normalize();
  // Ensure vertical axis is perpendicular to pipe axis (Gram-Schmidt)
  const v = UP.clone().sub(a.clone().multiplyScalar(a.dot(UP))).normalize();
  const l = new THREE.Vector3().crossVectors(a, v).normalize();
  // If degenerate (vertical pipe), fall back to sensible XZ-plane orientation
  if (v.lengthSq() < 0.5 || l.lengthSq() < 0.5) {
    mesh.quaternion.identity();
  } else {
    mesh.quaternion.setFromRotationMatrix(
      new THREE.Matrix4().makeBasis(a, v, l),
    );
  }
  return mesh;
}

/**
 * Resolve pipe axis from stored supportAxis object {x,y,z} in userData.
 *
 * Coordinate convention note:
 *   This viewer uses Y-up (Three.js default). PCF geometry is built with
 *   raw PCF coordinates (Y-up), so axes stored by the exporter's textAxis()
 *   are already in Three.js world space: X=(1,0,0), Y=(0,1,0)=UP, Z=(0,0,1).
 *
 *   CAESAR II directional cosines use Z-up (X=East, Y=North, Z=Up).
 *   When those raw cosines are stored in userData.supportAxis, a vertical
 *   pipe (CAESAR Z=1) would appear as (0,0,1) but the canvas vertical is
 *   (0,1,0).  We detect this case when stored Z is dominant and the object's
 *   world Y-position relative to siblings suggests it is truly vertical, but
 *   in practice the exporter already stores text-axis values in Three.js space.
 *   If userData.supportAxisSpace === 'caesar-zup' we apply the transform:
 *     Three.js X = Caesar X,  Three.js Y = Caesar Z,  Three.js Z = -Caesar Y
 */
function derivePipeAxis(userData) {
  const d = userData.supportAxis;
  if (d && typeof d === 'object') {
    let x = Number(d.x) || 0;
    let y = Number(d.y) || 0;
    let z = Number(d.z) || 0;

    // Remap CAESAR II Z-up cosines → Three.js Y-up world space
    if (userData.supportAxisSpace === 'caesar-zup') {
      const cx = x, cy = y, cz = z;
      x = cx;   // East  → Three.js X
      y = cz;   // Up    → Three.js Y
      z = -cy;  // North → Three.js -Z
    }

    const v = new THREE.Vector3(x, y, z);
    if (v.lengthSq() > 0.01) return v.normalize();
  }
  return new THREE.Vector3(1, 0, 0); // sensible default: pipe runs along X
}

/**
 * Horizontal axis perpendicular to both pipeAxis and UP.
 * Handles the degenerate case where pipeAxis is parallel to UP (vertical pipe).
 */
function lateralAxis(pipeAxis) {
  const cross = new THREE.Vector3().crossVectors(pipeAxis, UP);
  if (cross.lengthSq() > 1e-8) return cross.normalize();
  // Vertical pipe: pick any horizontal direction
  const crossX = new THREE.Vector3().crossVectors(pipeAxis, new THREE.Vector3(1, 0, 0));
  return crossX.lengthSq() > 1e-8 ? crossX.normalize() : new THREE.Vector3(0, 0, 1);
}

// ---------------------------------------------------------------------------
// Symbol builders — all coordinates are world-space
// ---------------------------------------------------------------------------

function buildRest(group, pos, pipeAxis, lateral, scale, color) {
  const r = scale * 0.028;
  const belowY = pos.y - scale * 0.72;
  const baseCenter = new THREE.Vector3(pos.x, belowY, pos.z);
  const pipeBase = new THREE.Vector3(pos.x, pos.y - scale * 0.07, pos.z);

  group.add(makePlate(baseCenter, pipeAxis, lateral, scale, color));
  group.add(makeArrow(
    baseCenter.clone().add(UP.clone().multiplyScalar(scale * 0.08)),
    pipeBase,
    color, r,
  ));
}

function buildGuide(group, pos, pipeAxis, lateral, scale, color) {
  // REST base below pipe
  buildRest(group, pos, pipeAxis, lateral, scale, color);

  // Two lateral (inward) arrows at pipe midline height
  const r = scale * 0.022;
  const outer = pos.clone().add(lateral.clone().multiplyScalar(scale * 0.82));
  const inner = pos.clone().add(lateral.clone().multiplyScalar(scale * 0.14));
  group.add(makeArrow(outer, inner, color, r));
  group.add(makeArrow(
    pos.clone().add(lateral.clone().multiplyScalar(-scale * 0.82)),
    pos.clone().add(lateral.clone().multiplyScalar(-scale * 0.14)),
    color, r,
  ));
}

function buildLineStop(group, pos, pipeAxis, lateral, scale, color) {
  // Base plate below pipe for visual grounding
  const belowY = pos.y - scale * 0.72;
  group.add(makePlate(new THREE.Vector3(pos.x, belowY, pos.z), pipeAxis, lateral, scale, color));

  // Two opposing arrows along pipe axis at pipe midline height
  const r = scale * 0.028;
  group.add(makeArrow(
    pos.clone().add(pipeAxis.clone().multiplyScalar(scale * 0.82)),
    pos.clone().add(pipeAxis.clone().multiplyScalar(scale * 0.14)),
    color, r,
  ));
  group.add(makeArrow(
    pos.clone().add(pipeAxis.clone().multiplyScalar(-scale * 0.82)),
    pos.clone().add(pipeAxis.clone().multiplyScalar(-scale * 0.14)),
    color, r,
  ));
}

function buildHanger(group, pos, pipeAxis, lateral, scale, color) {
  const r = scale * 0.020;
  const topY = pos.y + scale * 2.8;
  const topCenter = new THREE.Vector3(pos.x, topY, pos.z);
  const pipeTop = new THREE.Vector3(pos.x, pos.y + scale * 0.07, pos.z);

  // Top attachment plate
  const topPlate = new THREE.Mesh(
    new THREE.BoxGeometry(scale * 1.0, scale * 0.12, scale * 1.0),
    supportMat(color),
  );
  topPlate.userData.glbSupportSymbolMesh = true;
  topPlate.position.copy(topCenter);
  group.add(topPlate);

  // Vertical rod from plate down to pipe top
  const rodLen = topY - pipeTop.y;
  if (rodLen > 0.5) {
    const rod = new THREE.Mesh(
      new THREE.CylinderGeometry(Math.max(r * 0.55, 0.5), Math.max(r * 0.55, 0.5), rodLen, 12),
      supportMat(color),
    );
    rod.userData.glbSupportSymbolMesh = true;
    rod.position.set(pos.x, (topY + pipeTop.y) / 2, pos.z);
    group.add(rod);
  }

  // Downward load arrow
  group.add(makeArrow(
    topCenter.clone().add(UP.clone().multiplyScalar(-scale * 0.15)),
    pipeTop,
    color, r * 1.6,
  ));
}

function buildSpring(group, pos, pipeAxis, lateral, scale, color) {
  // Similar to REST with coil indicator
  buildRest(group, pos, pipeAxis, lateral, scale, color);
  const r = scale * 0.018;
  const coilCenter = new THREE.Vector3(pos.x, pos.y - scale * 0.40, pos.z);
  const coil = new THREE.Mesh(
    new THREE.TorusGeometry(scale * 0.22, Math.max(r * 0.7, 0.5), 8, 20),
    supportMat(color),
  );
  coil.userData.glbSupportSymbolMesh = true;
  coil.position.copy(coilCenter);
  group.add(coil);
}

function buildAnchor(group, pos, pipeAxis, lateral, scale, color) {
  buildRest(group, pos, pipeAxis, lateral, scale, color);
  const r = scale * 0.022;
  // 6-direction arrows
  [UP, UP.clone().negate(), pipeAxis, pipeAxis.clone().negate(), lateral, lateral.clone().negate()]
    .forEach((dir, i) => {
      group.add(makeArrow(
        pos.clone(),
        pos.clone().add(dir.clone().normalize().multiplyScalar(scale * 0.6)),
        color, r,
      ));
    });
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

function disposeGroup(root) {
  root.traverse((obj) => {
    obj.geometry?.dispose?.();
    const mats = Array.isArray(obj.material) ? obj.material : (obj.material ? [obj.material] : []);
    mats.forEach((m) => m?.dispose?.());
  });
}

/**
 * Hide baked support-reference-v2-* marker groups that were baked into the
 * GLB during export — they are replaced by fresh runtime symbols.
 */
function hideBakedSupportMarkers(root) {
  root.traverse((obj) => {
    const shape = String(obj.userData?.glbShape || '');
    if (shape.startsWith('support-reference-v2-')) {
      obj.visible = false;
    }
  });
}

/**
 * Main entry point.  Call after GLB is loaded and added to the scene.
 *
 * @param {THREE.Object3D} root   - The loaded GLB root (gltf.scene)
 * @param {THREE.Scene}    scene  - The Three.js scene
 * @param {object}         options
 * @param {number}         [options.scaleMultiplier=1.0] - User scale override
 * @returns {{ created: number, scanned: number, scale: number }}
 */
export function applyGlbSupportSymbols(root, scene, options = {}) {
  // Remove any previous runtime symbols
  const existing = scene.getObjectByName(GLB_SUPPORT_SYMBOLS_GROUP);
  if (existing) {
    scene.remove(existing);
    disposeGroup(existing);
  }

  // Compute scale from model diagonal (same approach as RVM viewer)
  const box = new THREE.Box3().setFromObject(root);
  const diagRaw = box.isEmpty() ? 1000 : box.getSize(new THREE.Vector3()).length();
  const symbolScaleFactor = 0.035;
  const scaleMultiplier = Number(options.scaleMultiplier) > 0 ? Number(options.scaleMultiplier) : 1.0;
  const scale = Math.max(18, Math.min(160, diagRaw * symbolScaleFactor)) * scaleMultiplier;

  // Hide old baked marker geometry
  hideBakedSupportMarkers(root);

  const symbolRoot = new THREE.Group();
  symbolRoot.name = GLB_SUPPORT_SYMBOLS_GROUP;
  symbolRoot.userData.glbSupportSymbolRoot = true;

  root.updateMatrixWorld(true);

  const worldPos = new THREE.Vector3();
  const seen = new Set();
  let scanned = 0;

  root.traverse((object) => {
    const data = object?.userData || {};
    const kind = String(data.supportKind || '').toUpperCase();
    if (!kind || kind === 'UNKNOWN') return;

    // Skip baked markerGroups — their parent is the real support object
    if (String(data.glbShape || '').startsWith('support-reference-v2-')) return;

    // Skip children of support objects that are not the root support node
    if (data.glbSupportSymbolMesh) return;

    scanned += 1;
    object.getWorldPosition(worldPos);

    // Deduplicate by kind + quantised position
    const key = `${kind}:${(worldPos.x / 10).toFixed(0)}:${(worldPos.y / 10).toFixed(0)}:${(worldPos.z / 10).toFixed(0)}`;
    if (seen.has(key)) return;
    seen.add(key);

    const pipeAxis = derivePipeAxis(data);
    const lat = lateralAxis(pipeAxis);
    const color = SYMBOL_COLOR[kind] || SYMBOL_COLOR.UNKNOWN;
    const wPos = worldPos.clone();

    const group = new THREE.Group();
    group.name = `glb-support-${kind.toLowerCase()}-${object.name || object.uuid}`;
    group.userData = { glbSupportSymbolKind: kind, glbSupportSymbol: true };

    if (kind === 'REST' || kind === 'SHOE') buildRest(group, wPos, pipeAxis, lat, scale, color);
    else if (kind === 'GUIDE') buildGuide(group, wPos, pipeAxis, lat, scale, color);
    else if (kind === 'LINESTOP' || kind === 'LIMIT') buildLineStop(group, wPos, pipeAxis, lat, scale, color);
    else if (kind === 'HANGER') buildHanger(group, wPos, pipeAxis, lat, scale, color);
    else if (kind === 'SPRING') buildSpring(group, wPos, pipeAxis, lat, scale, color);
    else if (kind === 'ANCHOR') buildAnchor(group, wPos, pipeAxis, lat, scale, color);
    else buildRest(group, wPos, pipeAxis, lat, scale, color);

    if (group.children.length > 0) symbolRoot.add(group);
  });

  const created = symbolRoot.children.length;
  if (created > 0) scene.add(symbolRoot);

  console.info('[glb-support-symbols]', { created, scanned, scale });
  return { created, scanned, scale };
}
