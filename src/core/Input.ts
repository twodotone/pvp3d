import * as THREE from "three";
import { screenToWorldDir } from "./mathx.ts";

/**
 * Centralised input. Exposes intent (move axis, aim direction, action presses)
 * that BOTH keyboard+mouse and the touch sticks/buttons feed, so gameplay reads
 * one source regardless of device.
 */
export class Input {
  private held = new Set<string>();
  private pressedThisFrame = new Set<string>();

  /** Normalised device coords of the pointer (-1..1). */
  private ndc = new THREE.Vector2(0, 0);

  /** Edge-triggered: true only on the frame the mouse button went down. */
  primaryDown = false;
  private primaryDownQueued = false;

  /** Held-state of the right mouse button / touch block button. */
  blockHeld = false;

  /** True on touch-primary devices (phones/tablets) — gates the touch UI. */
  readonly touch = window.matchMedia("(pointer: coarse)").matches;

  // Virtual sticks (screen axis, -1..1) written by TouchControls.
  private leftStick = new THREE.Vector2();
  private rightStick = new THREE.Vector2();
  private aiming = false;
  private queuedKeys = new Set<string>();
  private aimScratch = new THREE.Vector3();

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
    this.leftStick.set(0, 0);
    this.rightStick.set(0, 0);
    this.aiming = false;
  };

  // --- Touch intent (written by TouchControls) -------------------------
  setMoveStick(x: number, y: number): void {
    this.leftStick.set(x, y);
  }
  setAimStick(x: number, y: number, active: boolean): void {
    this.rightStick.set(x, y);
    this.aiming = active;
  }
  /** Register an edge-triggered virtual key press (read next frame). */
  tapKey(code: string): void {
    this.queuedKeys.add(code);
  }
  queuePrimary(): void {
    this.primaryDownQueued = true;
  }

  /** Unified movement axis (screen space): touch left-stick or WASD. */
  getMoveAxis(out: THREE.Vector2): THREE.Vector2 {
    if (this.touch) return out.copy(this.leftStick);
    return out.set(
      (this.isDown("KeyD") ? 1 : 0) - (this.isDown("KeyA") ? 1 : 0),
      (this.isDown("KeyW") ? 1 : 0) - (this.isDown("KeyS") ? 1 : 0),
    );
  }

  /**
   * World-space aim direction (XZ). Mouse aims toward the cursor (always on);
   * touch aims with the right stick while engaged. False when not aiming.
   */
  getAimDir(camera: THREE.Camera, playerPos: THREE.Vector3, out: THREE.Vector3): boolean {
    if (this.touch) {
      if (!this.aiming) return false;
      screenToWorldDir(camera, this.rightStick.x, this.rightStick.y, out);
      return out.lengthSq() > 1e-6;
    }
    if (!this.cursorGroundPoint(camera, this.aimScratch)) return false;
    out.copy(this.aimScratch).sub(playerPos);
    out.y = 0;
    return out.lengthSq() > 1e-4;
  }

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
    for (const k of this.queuedKeys) this.pressedThisFrame.add(k);
    this.queuedKeys.clear();
  }
}
