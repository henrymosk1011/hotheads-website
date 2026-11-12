/**
 * Rose-gold shears, built from extruded shapes so there are no model files
 * to load. Two crossing halves rotate around a shared pivot screw.
 */
import * as THREE from 'three';

function halfShape(mirror) {
  const m = mirror ? -1 : 1;
  const s = new THREE.Shape();
  s.moveTo(2.05, 0);
  s.quadraticCurveTo(1.05, 0.21 * m, 0.18, 0.2 * m);
  s.lineTo(-0.14, 0.13 * m);
  s.lineTo(-0.9, -0.34 * m);
  s.lineTo(-0.82, -0.47 * m);
  s.lineTo(0.04, -0.07 * m);
  s.lineTo(0.32, 0);
  s.lineTo(2.05, 0);
  return s;
}

function buildHalf(mirror, material) {
  const group = new THREE.Group();
  const geo = new THREE.ExtrudeGeometry(halfShape(mirror), {
    depth: 0.034,
    bevelEnabled: true,
    bevelThickness: 0.012,
    bevelSize: 0.014,
    bevelSegments: 3,
    curveSegments: 28,
  });
  geo.translate(0, 0, -0.017);
  geo.computeVertexNormals();
  group.add(new THREE.Mesh(geo, material));

  const m = mirror ? -1 : 1;
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.27, 0.056, 20, 64), material);
  ring.position.set(-1.14, -0.6 * m, 0);
  ring.scale.set(1.12, 0.92, 1);
  group.add(ring);

  // little finger rest on one side, like real shears
  if (!mirror) {
    const tang = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.035, 12, 32, Math.PI * 0.9), material);
    tang.position.set(-1.42, -0.92, 0);
    tang.rotation.z = Math.PI * 0.75;
    group.add(tang);
  }
  return group;
}

export function createScissors() {
  const metal = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color('#f3c2ae'),
    metalness: 1,
    roughness: 0.1,
    clearcoat: 0.8,
    clearcoatRoughness: 0.05,
    envMapIntensity: 2.2,
  });
  const screwMat = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color('#d39a7d'),
    metalness: 1,
    roughness: 0.28,
    envMapIntensity: 1.4,
  });

  const root = new THREE.Group();
  const pivot = new THREE.Group();
  root.add(pivot);

  const a = buildHalf(false, metal);
  const b = buildHalf(true, metal);
  a.position.z = 0.03;
  b.position.z = -0.03;
  pivot.add(a, b);

  const screw = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.16, 32), screwMat);
  screw.rotation.x = Math.PI / 2;
  const cap = new THREE.Mesh(new THREE.SphereGeometry(0.085, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), screwMat);
  cap.rotation.x = Math.PI / 2;
  cap.position.z = 0.075;
  pivot.add(screw, cap);

  root.visible = false;

  return {
    group: root,
    setOpen(angle) {
      a.rotation.z = angle / 2;
      b.rotation.z = -angle / 2;
    },
  };
}
