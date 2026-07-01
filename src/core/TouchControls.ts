import { Input } from "./Input.ts";
import { Player } from "../entities/Player.ts";
import { SKILL_KEYS, SKILL_KEY_LABELS } from "../game/skills.ts";
import { ROSTER } from "../game/characters.ts";

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

    // Single move stick (left). Aiming is auto-lock via facing (see Game), so
    // there's no aim stick — the right side is free for the action buttons.
    const leftZone = this.zone("tc-left");
    const leftStick = this.stick();
    root.append(leftZone, leftStick.base);
    this.bindStick(leftZone, leftStick);

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

    // Character switcher (mobile — desktop uses number keys).
    const charBtn = document.createElement("button");
    charBtn.className = "tc-char";
    const nameOf = (id: string) => ROSTER.find((c) => c.id === id)?.name ?? "?";
    charBtn.textContent = nameOf(player.characterId);
    charBtn.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const i = ROSTER.findIndex((c) => c.id === player.characterId);
      const next = ROSTER[(i + 1) % ROSTER.length];
      void player.setCharacter(next.id);
      charBtn.textContent = next.name;
    });
    document.body.appendChild(charBtn);
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
  ): void {
    let id: number | null = null;
    let ox = 0;
    let oy = 0;

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
      this.input.setMoveStick(0, 0);
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
      this.input.setMoveStick(dirx * mag, -diry * mag); // invert screen-y = forward
      e.preventDefault();
    });

    const end = (e: PointerEvent) => {
      if (e.pointerId !== id) return;
      id = null;
      stick.base.style.display = "none";
      this.input.setMoveStick(0, 0);
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
