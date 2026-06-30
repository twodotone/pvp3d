import * as THREE from "three";

/**
 * Centralised input: keyboard held-state, edge-triggered presses, and a
 * mouse->ground raycast so gameplay can ask "where on the arena floor is the
 * cursor pointing right now?".
 */
export class Input {
  private held = new Set<string>();
  private pressedThisFrame = new Set<string>();

  /** Normalised device coords of the pointer (-1..1). */
  private ndc = new THREE.Vector2(0, 0);

  /** Edge-triggered: true only on the frame the mouse button went down. */
  primaryDown = false;
  private primaryDownQueued = false;

  /** Held-state of the right mouse button (used to hold up a shield). */
  blockHeld = false;

  private raycaster = new THREE.Raycaster();
  private groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

  constructor(private dom: HTMLElement) {
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
    dom.addEventListener("pointermove", this.onPointerMove);
    dom.addEventListener("pointerdown", this.onPointerDown);
    dom.addEventListener("pointerup", this.onPointerUp);
    // Don't let right-click open the context menu mid-fight.
    dom.addEventListener("contextmenu", (e) => e.preventDefault());
    // Avoid buttons/keys sticking if focus is lost mid-press.
    window.addEventListener("blur", this.onBlur);
  }

  private onKeyDown = (e: KeyboardEvent) => {
    const k = e.code;
    if (!this.held.has(k)) this.pressedThisFrame.add(k);
    this.held.add(k);
  };
  private onKeyUp = (e: KeyboardEvent) => {
    this.held.delete(e.code);
  };
  private onPointerMove = (e: PointerEvent) => {
    const r = this.dom.getBoundingClientRect();
    this.ndc.x = ((e.clientX - r.left) / r.width) * 2 - 1;
    this.ndc.y = -((e.clientY - r.top) / r.height) * 2 + 1;
  };
  private onPointerDown = (e: PointerEvent) => {
    if (e.button === 0) this.primaryDownQueued = true;
    if (e.button === 2) this.blockHeld = true;
  };
  private onPointerUp = (e: PointerEvent) => {
    if (e.button === 2) this.blockHeld = false;
  };
  private onBlur = () => {
    this.held.clear();
    this.blockHeld = false;
  };

  /** Is this physical key currently held? Accepts a KeyboardEvent.code. */
  isDown(code: string): boolean {
    return this.held.has(code);
  }

  /** True only on the frame the key transitioned to down. */
  wasPressed(code: string): boolean {
    return this.pressedThisFrame.has(code);
  }

  /**
   * World point under the cursor on the ground plane (y=0). Returns false if
   * the ray is parallel to the floor (writes nothing to `out`).
   */
  cursorGroundPoint(camera: THREE.Camera, out: THREE.Vector3): boolean {
    this.raycaster.setFromCamera(this.ndc, camera);
    const hit = this.raycaster.ray.intersectPlane(this.groundPlane, out);
    return hit !== null;
  }

  /** Call once per frame AFTER gameplay has read the edge-triggered state. */
  endFrame(): void {
    this.pressedThisFrame.clear();
    this.primaryDown = false;
  }

  /** Call once per frame BEFORE gameplay reads input. */
  beginFrame(): void {
    this.primaryDown = this.primaryDownQueued;
    this.primaryDownQueued = false;
  }
}
