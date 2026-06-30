import { Input } from "./Input.ts";
import { Player } from "../entities/Player.ts";
import { SKILL_KEYS, SKILL_KEY_LABELS } from "../game/skills.ts";

const STICK_RADIUS = 60; // px the knob travels for full deflection

/**
 * Landscape twin-stick touch UI (phones/tablets). Left floating stick = move,
 * right floating stick = aim (drives the soft-lock), plus a button cluster for
 * attack / block / roll / skills. Everything writes into `Input`'s intent layer,
 * so gameplay is identical to keyboard+mouse. Only built on touch devices.
 */
export class TouchControls {
  readonly enabled: boolean;
  private skillButtons: { cd: HTMLElement; el: HTMLElement }[] = [];

  constructor(
    private input: Input,
    private player: Player,
  ) {
    this.enabled = input.touch;
    if (!this.enabled) return;

    document.body.classList.add("touch");
    const root = document.createElement("div");
    root.id = "touch";

    const leftZone = this.zone("tc-left");
    const rightZone = this.zone("tc-right");
    const leftStick = this.stick();
    const rightStick = this.stick();
    root.append(leftZone, rightZone, leftStick.base, rightStick.base);

    this.bindStick(leftZone, leftStick, false);
    this.bindStick(rightZone, rightStick, true);

    // Buttons.
    const buttons = document.createElement("div");
    buttons.className = "tc-buttons";
    buttons.append(
      this.actionBtn("attack", "⚔", () => this.input.queuePrimary()),
      this.holdBtn("block", "🛡"),
      this.actionBtn("roll", "↻", () => this.input.tapKey("Space")),
    );
    const skills = document.createElement("div");
    skills.className = "tc-skills";
    for (let i = 0; i < 4; i++) skills.append(this.skillBtn(i));
    root.append(buttons, skills);

    document.body.appendChild(root);
  }

  /** Refresh skill-button cooldown visuals each frame. */
  update(): void {
    if (!this.enabled) return;
    const bar = this.player.skillBar;
    for (let i = 0; i < this.skillButtons.length; i++) {
      const s = bar[i];
      const b = this.skillButtons[i];
      b.el.style.borderColor = s.color;
      const frac = s.cdMax > 0 ? s.cd / s.cdMax : 0;
      b.cd.style.height = `${Math.max(0, Math.min(1, frac)) * 100}%`;
      b.el.style.opacity = s.cd > 0 ? "0.5" : "1";
    }
  }

  // --- DOM helpers ------------------------------------------------------

  private zone(cls: string): HTMLDivElement {
    const z = document.createElement("div");
    z.className = `tc-zone ${cls}`;
    return z;
  }

  private stick(): { base: HTMLDivElement; knob: HTMLDivElement } {
    const base = document.createElement("div");
    base.className = "tc-stick";
    const knob = document.createElement("div");
    knob.className = "tc-knob";
    base.appendChild(knob);
    return { base, knob };
  }

  private bindStick(
    zone: HTMLElement,
    stick: { base: HTMLDivElement; knob: HTMLDivElement },
    isAim: boolean,
  ): void {
    let id: number | null = null;
    let ox = 0;
    let oy = 0;

    const set = (x: number, y: number, active: boolean) =>
      isAim ? this.input.setAimStick(x, y, active) : this.input.setMoveStick(x, y);

    zone.addEventListener("pointerdown", (e) => {
      if (id !== null) return;
      id = e.pointerId;
      ox = e.clientX;
      oy = e.clientY;
      zone.setPointerCapture(id);
      stick.base.style.left = `${ox}px`;
      stick.base.style.top = `${oy}px`;
      stick.base.style.display = "block";
      stick.knob.style.transform = "translate(-50%,-50%)";
      set(0, 0, true);
      e.preventDefault();
    });

    zone.addEventListener("pointermove", (e) => {
      if (e.pointerId !== id) return;
      const dx = e.clientX - ox;
      const dy = e.clientY - oy;
      const len = Math.hypot(dx, dy) || 1;
      const dirx = dx / len;
      const diry = dy / len;
      const knobLen = Math.min(len, STICK_RADIUS);
      stick.knob.style.transform = `translate(calc(-50% + ${dirx * knobLen}px), calc(-50% + ${diry * knobLen}px))`;
      const mag = Math.min(1, len / STICK_RADIUS);
      set(dirx * mag, -diry * mag, true); // invert screen-y so up = forward
      e.preventDefault();
    });

    const end = (e: PointerEvent) => {
      if (e.pointerId !== id) return;
      id = null;
      stick.base.style.display = "none";
      set(0, 0, false);
    };
    zone.addEventListener("pointerup", end);
    zone.addEventListener("pointercancel", end);
  }

  private actionBtn(act: string, label: string, onPress: () => void): HTMLButtonElement {
    const b = document.createElement("button");
    b.className = `tc-btn tc-${act}`;
    b.textContent = label;
    b.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      e.stopPropagation();
      onPress();
    });
    return b;
  }

  private holdBtn(act: string, label: string): HTMLButtonElement {
    const b = document.createElement("button");
    b.className = `tc-btn tc-${act}`;
    b.textContent = label;
    b.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      e.stopPropagation();
      b.setPointerCapture(e.pointerId);
      this.input.blockHeld = true;
    });
    const release = () => (this.input.blockHeld = false);
    b.addEventListener("pointerup", release);
    b.addEventListener("pointercancel", release);
    return b;
  }

  private skillBtn(slot: number): HTMLButtonElement {
    const b = document.createElement("button");
    b.className = "tc-btn tc-skill";
    const cd = document.createElement("div");
    cd.className = "tc-skill-cd";
    const lbl = document.createElement("span");
    lbl.textContent = SKILL_KEY_LABELS[slot];
    b.append(cd, lbl);
    b.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.input.tapKey(SKILL_KEYS[slot]);
    });
    this.skillButtons.push({ cd, el: b });
    return b;
  }
}
