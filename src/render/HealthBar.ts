import * as THREE from "three";

/**
 * A small world-space health bar that floats above a combatant. Drawn on top
 * (depthTest off) and yawed to face the camera each frame. The fill shrinks
 * from the right and shifts green -> red as health drops.
 */
export class HealthBar {
  readonly group = new THREE.Group();
  private fill: THREE.Mesh;
  private fillMat: THREE.MeshBasicMaterial;

  constructor(yOffset: number, width = 1.3, height = 0.16) {
    this.group.position.y = yOffset;

    const bgMat = new THREE.MeshBasicMaterial({
      color: 0x101216,
      transparent: true,
      opacity: 0.85,
      depthTest: false,
      toneMapped: false,
    });
    const bg = new THREE.Mesh(new THREE.PlaneGeometry(width, height), bgMat);
    bg.renderOrder = 998;

    this.fillMat = new THREE.MeshBasicMaterial({
      color: 0x57d06a,
      depthTest: false,
      toneMapped: false,
    });
    // Anchor the fill's left edge at local x=0 so scaling shrinks from the right.
    const fillGeo = new THREE.PlaneGeometry(width, height * 0.7);
    fillGeo.translate(width / 2, 0, 0.001);
    this.fill = new THREE.Mesh(fillGeo, this.fillMat);
    this.fill.position.x = -width / 2;
    this.fill.renderOrder = 999;

    this.group.add(bg, this.fill);
  }

  setFraction(f: number): void {
    const c = THREE.MathUtils.clamp(f, 0, 1);
    this.fill.scale.x = Math.max(0.0001, c);
    // Green when healthy, through yellow, to red when low.
    this.fillMat.color.setHSL(0.33 * c, 0.7, 0.5);
  }

  setVisible(v: boolean): void {
    this.group.visible = v;
  }

  faceCamera(camera: THREE.Camera): void {
    const p = _p;
    this.group.getWorldPosition(p);
    this.group.rotation.y = Math.atan2(
      camera.position.x - p.x,
      camera.position.z - p.z,
    );
  }
}

const _p = new THREE.Vector3();
