/** Device → actions. Override via setKeys for the controls self-test. */

export type Actions = {
  moveX: number;
  moveY: number;
  jump: boolean;
  jumpHeld: boolean;
  sprint: boolean;
  attack: boolean;
  bow: boolean;
  interact: boolean;
  art: boolean;
  pause: boolean;
  map: boolean;
  bag: boolean;
  artSlot: number;
  lookX: number;
  lookY: number;
};

const hardware = new Set<string>();
let override: Set<string> | null = null;
let lookX = 0;
let lookY = 0;
let attackEdge = false;
let interactEdge = false;
let artEdge = false;
let pauseEdge = false;
let mapEdge = false;
let bagEdge = false;
let jumpEdge = false;
let artSlot = -1;
let prevJump = false;

const GAME_CODES = new Set([
  "KeyW",
  "KeyA",
  "KeyS",
  "KeyD",
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "Space",
  "ShiftLeft",
  "ShiftRight",
  "KeyE",
  "KeyF",
  "KeyQ",
  "KeyM",
  "Tab",
  "Escape",
  "Digit1",
  "Digit2",
  "Digit3",
  "Digit4",
  "KeyC",
]);

export const touch = {
  stickX: 0,
  stickY: 0,
  lookX: 0,
  lookY: 0,
  jump: false,
  attack: false,
  art: false,
  interact: false,
  sprint: false,
  bow: false,
};

export function setKeys(codes: string[]) {
  if (codes.length === 0) {
    override = null;
    return;
  }
  override = new Set(codes);
}

function activeSet() {
  return override ?? hardware;
}

function onKeyDown(e: KeyboardEvent) {
  if (e.repeat) {
    if (GAME_CODES.has(e.code)) e.preventDefault();
    return;
  }
  hardware.add(e.code);
  if (GAME_CODES.has(e.code)) e.preventDefault();
  if (e.code === "Space") jumpEdge = true;
  if (e.code === "KeyE") interactEdge = true;
  if (e.code === "KeyF") artEdge = true;
  if (e.code === "KeyM") mapEdge = true;
  if (e.code === "Tab") {
    e.preventDefault();
    bagEdge = true;
  }
  if (e.code === "Escape") pauseEdge = true;
  if (e.code === "Digit1") artSlot = 0;
  if (e.code === "Digit2") artSlot = 1;
  if (e.code === "Digit3") artSlot = 2;
  if (e.code === "Digit4") artSlot = 3;
}

function onKeyUp(e: KeyboardEvent) {
  hardware.delete(e.code);
}

function onBlur() {
  hardware.clear();
}

function onMouseMove(e: MouseEvent) {
  if (document.pointerLockElement) {
    lookX += e.movementX;
    lookY += e.movementY;
  }
}

function onMouseDown(e: MouseEvent) {
  if (e.button === 0) attackEdge = true;
  if (e.button === 2) hardware.add("MouseRight");
}

function onMouseUp(e: MouseEvent) {
  if (e.button === 2) hardware.delete("MouseRight");
}

export function bindInput(el: HTMLElement) {
  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);
  window.addEventListener("blur", onBlur);
  document.addEventListener("visibilitychange", onBlur);
  window.addEventListener("mousemove", onMouseMove);
  el.addEventListener("mousedown", onMouseDown);
  window.addEventListener("mouseup", onMouseUp);
  el.addEventListener("contextmenu", (e) => e.preventDefault());
  return () => {
    window.removeEventListener("keydown", onKeyDown);
    window.removeEventListener("keyup", onKeyUp);
    window.removeEventListener("blur", onBlur);
    document.removeEventListener("visibilitychange", onBlur);
    window.removeEventListener("mousemove", onMouseMove);
    el.removeEventListener("mousedown", onMouseDown);
    window.removeEventListener("mouseup", onMouseUp);
  };
}

export function sampleActions(): Actions {
  const keys = activeSet();
  let x = 0;
  let y = 0;
  if (keys.has("KeyA") || keys.has("ArrowLeft")) x -= 1;
  if (keys.has("KeyD") || keys.has("ArrowRight")) x += 1;
  if (keys.has("KeyW") || keys.has("ArrowUp")) y += 1;
  if (keys.has("KeyS") || keys.has("ArrowDown")) y -= 1;
  x += touch.stickX;
  y += touch.stickY;
  const m = Math.hypot(x, y);
  if (m > 1) {
    x /= m;
    y /= m;
  }

  const jumpHeld = keys.has("Space") || touch.jump;
  const jump = jumpEdge || (touch.jump && !prevJump);
  prevJump = touch.jump;
  jumpEdge = false;

  const attack = attackEdge || consumeTouch("attack");
  attackEdge = false;
  const interact = interactEdge || consumeTouch("interact");
  interactEdge = false;
  const art = artEdge || consumeTouch("art");
  artEdge = false;
  const pause = pauseEdge;
  pauseEdge = false;
  const map = mapEdge;
  mapEdge = false;
  const bag = bagEdge;
  bagEdge = false;
  const slot = artSlot;
  artSlot = -1;

  const lx = lookX + touch.lookX;
  const ly = lookY + touch.lookY;
  lookX = 0;
  lookY = 0;
  touch.lookX = 0;
  touch.lookY = 0;

  const bow = keys.has("MouseRight") || keys.has("KeyQ") || touch.bow;
  const sprint =
    keys.has("ShiftLeft") || keys.has("ShiftRight") || touch.sprint || m > 0.92;

  return {
    moveX: x,
    moveY: y,
    jump,
    jumpHeld,
    sprint,
    attack,
    bow,
    interact,
    art,
    pause,
    map,
    bag,
    artSlot: slot,
    lookX: lx,
    lookY: ly,
  };
}

function consumeTouch(k: "attack" | "interact" | "art") {
  if (!touch[k]) return false;
  touch[k] = false;
  return true;
}

export function hasOverride() {
  return override !== null;
}
