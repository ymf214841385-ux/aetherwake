import { Canvas } from "@react-three/fiber";
import { useEffect, useRef } from "react";
import * as THREE from "three";
import { resumeAudio } from "./audio";
import { bindInput, touch } from "./input";
import { GameWorld } from "./Scene";
import { sim } from "./sim";

export default function GameClient() {
  const wrap = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const unbind = bindInput(el);
    const vis = () => resumeAudio();
    document.addEventListener("visibilitychange", vis);
    return () => {
      unbind();
      document.removeEventListener("visibilitychange", vis);
    };
  }, []);

  const onCanvasClick = () => {
    if (sim.mode === "playing") wrap.current?.requestPointerLock?.();
  };

  return (
    <>
      <div ref={wrap} className="canvas-wrap" onContextMenu={(e) => e.preventDefault()}>
        <Canvas
          shadows={{ type: THREE.PCFShadowMap }}
          dpr={[1, 1.5]}
          camera={{ fov: 52, near: 0.12, far: 520, position: [16, 34, 118] }}
          gl={{ antialias: true, powerPreference: "high-performance", alpha: false }}
          onPointerDown={onCanvasClick}
          onCreated={({ gl }) => {
            gl.setClearColor("#87a0b4");
          }}
        >
          <GameWorld />
        </Canvas>
      </div>
      <TouchPad />
    </>
  );
}

function TouchPad() {
  const stick = useRef<HTMLDivElement>(null);
  const look = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const fine = window.matchMedia("(pointer: fine)").matches && window.innerWidth > 800;
    if (fine) return;
    const st = stick.current;
    const lk = look.current;
    if (!st || !lk) return;

    const pointers = new Map<number, { kind: "stick" | "look"; x: number; y: number }>();
    const down = (e: PointerEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest("[data-touch-btn]")) return;
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      const kind: "stick" | "look" = e.clientX < rect.left + rect.width * 0.45 ? "stick" : "look";
      pointers.set(e.pointerId, { kind, x: e.clientX, y: e.clientY });
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    };
    const move = (e: PointerEvent) => {
      const p = pointers.get(e.pointerId);
      if (!p) return;
      const dx = e.clientX - p.x;
      const dy = e.clientY - p.y;
      if (p.kind === "stick") {
        const r = 54;
        let x = dx / r;
        let y = -dy / r;
        const m = Math.hypot(x, y);
        if (m > 1) {
          x /= m;
          y /= m;
        }
        touch.stickX = x;
        touch.stickY = y;
      } else {
        touch.lookX += dx * 0.9;
        touch.lookY += dy * 0.9;
        p.x = e.clientX;
        p.y = e.clientY;
      }
    };
    const up = (e: PointerEvent) => {
      const p = pointers.get(e.pointerId);
      pointers.delete(e.pointerId);
      if (p?.kind === "stick") {
        touch.stickX = 0;
        touch.stickY = 0;
      }
    };
    for (const el of [st, lk]) {
      el.addEventListener("pointerdown", down);
      el.addEventListener("pointermove", move);
      el.addEventListener("pointerup", up);
      el.addEventListener("pointercancel", up);
    }
    return () => {
      for (const el of [st, lk]) {
        el.removeEventListener("pointerdown", down);
        el.removeEventListener("pointermove", move);
        el.removeEventListener("pointerup", up);
        el.removeEventListener("pointercancel", up);
      }
    };
  }, []);

  return (
    <>
      <div ref={stick} className="touch-zone touch-left" aria-hidden />
      <div ref={look} className="touch-zone touch-right" aria-hidden />
      <div className="touch-btns">
        <button type="button" data-touch-btn className="tbtn" onPointerDown={() => (touch.interact = true)}>
          互动
        </button>
        <button type="button" data-touch-btn className="tbtn" onPointerDown={() => (touch.art = true)}>
          石板
        </button>
        <button
          type="button"
          data-touch-btn
          className="tbtn tbtn-main"
          onPointerDown={() => (touch.jump = true)}
          onPointerUp={() => (touch.jump = false)}
          onPointerCancel={() => (touch.jump = false)}
        >
          跳 / 翔
        </button>
        <button type="button" data-touch-btn className="tbtn tbtn-atk" onPointerDown={() => (touch.attack = true)}>
          攻击
        </button>
      </div>
    </>
  );
}
