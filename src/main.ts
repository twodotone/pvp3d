import { Game } from "./core/Game.ts";

const container = document.getElementById("app");
if (!container) throw new Error("#app container not found");

const game = new Game(container);
game.start().catch((err) => {
  console.error("Failed to start game:", err);
  const hud = document.getElementById("hud");
  if (hud) hud.textContent = "ERROR: " + (err as Error).message;
});
