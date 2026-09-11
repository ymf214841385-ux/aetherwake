import { Canvas } from "@react-three/fiber";
import { useEffect, useRef } from "react";
import type { PointerEvent as PE } from "react";
import * as THREE from "three";
import { resumeAudio } from "./audio";
import { bindInput, enqueueCommand, resetInput, touch } from "./input";
import { CAM_FOV } from "./params";
import { GameWorld } from "./Scene";
import { sim } from "./sim";
import { useHud } from "./store";

export default function GameClient() {
  const wrap = useRef<HTMLDivElement>(null);
  const quality = useHud((s) => s.quality);

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const unbind = bindInput(el);
    const vis = () => resumeAudio();
    document.addEventListener("visibilitychange", vis);
    const orient = () => {
      sim.portrait = window.innerHeight > window.innerWidth + 40;
      sim.syncHud();
    };
    orient();
    window.addEventListener("resize", orient);
    return () => {
      unbind();
      document.removeEventListener("visibilitychange", vis);
      window.removeEventListener("resize", orient);
    };
  }, []);

  const onCanvasClick = () => {
    if (sim.mode === "playing" && !sim.portrait) wrap.current?.requestPointerLock?.();
  };

  const dpr: [number, number] = quality === "low" ? [0.75, 1] : quality === "high" ? [1, 2] : [1, 1.5];
  const shadows = quality === "low" ? false : { type: THREE.PCFShadowMap };

  return (
    <>
      <div ref={wrap} className="canvas-wrap" onContextMenu={(e) => e.preventDefault()}>
        <Canvas
          shadows={shadows}
          dpr={dpr}
          camera={{ fov: CAM_FOV, near: 0.12, far: 520, position: [16, 34, 118] }}
          gl={{ antialias: quality !== "low", powerPreference: "high-performance", alpha: false }}
          onPointerDown={onCanvasClick}
          onCreated={({ gl }) => {
            gl.setClearColor("#9ec6d8");
            gl.outputColorSpace = THREE.SRGBColorSpace;
            gl.domElement.addEventListener(
              "webglcontextlost",
              (ev) => {
                ev.preventDefault();
                sim.glLost = true;
                sim.pushToast("画面设备丢失，正在尝试恢复。进度仍在。");
                sim.tryAutosave();
                sim.syncHud();
              },
              false,
            );
            gl.domElement.addEventListener("webglcontextrestored", () => {
              sim.glLost = false;
              sim.glRestoredAt = sim.t || 1;
              sim.pushToast("画面已恢复。");
              gl.setSize(gl.domElement.clientWidth, gl.domElement.clientHeight);
              sim.syncHud();
            });
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
    const down = (kind: "stick" | "look") => (e: PointerEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest("[data-touch-btn]")) return;
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
      try {
        (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
      } catch {
        /* already released */
      }
    };
    const lost = () => resetInput();
    st.addEventListener("pointerdown", down("stick"));
    lk.addEventListener("pointerdown", down("look"));
    for (const el of [st, lk]) {
      el.addEventListener("pointermove", move);
      el.addEventListener("pointerup", up);
      el.addEventListener("pointercancel", up);
      el.addEventListener("lostpointercapture", lost);
    }
    return () => {
      for (const el of [st, lk]) {
        el.removeEventListener("pointermove", move);
        el.removeEventListener("pointerup", up);
        el.removeEventListener("pointercancel", up);
        el.removeEventListener("lostpointercapture", lost);
      }
    };
  }, []);

  const press = (fn: () => void) => (e: PE) => {
    e.stopPropagation();
    fn();
  };

  return (
    <>
      <div ref={stick} className="touch-zone touch-left" data-touch-kind="stick" aria-hidden />
      <div ref={look} className="touch-zone touch-right" data-touch-kind="look" aria-hidden />
      <div className="touch-btns">
        <button type="button" data-touch-btn className="tbtn" onPointerDown={press(() => enqueueCommand("interact"))}>
          互动
        </button>
        <button type="button" data-touch-btn className="tbtn" onPointerDown={press(() => enqueueCommand("art"))}>
          能力
        </button>
        <button type="button" data-touch-btn className="tbtn" onPointerDown={press(() => enqueueCommand("climb"))}>
          攀爬
        </button>
        <button
          type="button"
          data-touch-btn
          className="tbtn tbtn-main"
          onPointerDown={press(() => {
            touch.jump = true;
            enqueueCommand("jump");
          })}
          onPointerUp={press(() => (touch.jump = false))}
          onPointerCancel={press(() => (touch.jump = false))}
        >
          跳 / 翔
        </button>
        <button type="button" data-touch-btn className="tbtn tbtn-atk" onPointerDown={press(() => enqueueCommand("attack"))}>
          攻击
        </button>
        <button
          type="button"
          data-touch-btn
          className="tbtn"
          onPointerDown={press(() => (touch.bow = true))}
          onPointerUp={press(() => (touch.bow = false))}
        >
          弓
        </button>
        <button type="button" data-touch-btn className="tbtn" onPointerDown={press(() => enqueueCommand("dodge"))}>
          闪避
        </button>
        <button type="button" data-touch-btn className="tbtn" onPointerDown={press(() => enqueueCommand("pause"))}>
          暂停
        </button>
      </div>
    </>
  );
}
