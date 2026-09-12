import { Canvas } from "@react-three/fiber";
import { useEffect, useRef } from "react";
import * as THREE from "three";
import { resumeAudio } from "./audio";
import { bindInput } from "./input";
import { bindTouchInput, bindTouchOrientation } from "./touch-input";
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
    const unbindOrientation = bindTouchOrientation(window, sim);
    return () => {
      unbind();
      document.removeEventListener("visibilitychange", vis);
      unbindOrientation();
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
  const buttons = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const st = stick.current;
    const lk = look.current;
    const btns = buttons.current;
    if (!st || !lk || !btns) return;
    return bindTouchInput({ stick: st, look: lk, buttons: btns.querySelectorAll<HTMLElement>("[data-touch-action]") });
  }, []);

  return (
    <>
      <div ref={stick} className="touch-zone touch-left" data-touch-kind="stick" aria-hidden />
      <div ref={look} className="touch-zone touch-right" data-touch-kind="look" aria-hidden />
      <div ref={buttons} className="touch-btns">
        <button type="button" data-touch-btn data-touch-action="interact" className="tbtn">互动</button>
        <button type="button" data-touch-btn data-touch-action="art" className="tbtn">能力</button>
        <button type="button" data-touch-btn data-touch-action="climb" className="tbtn">攀爬</button>
        <button type="button" data-touch-btn data-touch-action="jump" className="tbtn tbtn-main">跳 / 翔</button>
        <button type="button" data-touch-btn data-touch-action="attack" className="tbtn tbtn-atk">攻击</button>
        <button type="button" data-touch-btn data-touch-action="bow" className="tbtn">弓</button>
        <button type="button" data-touch-btn data-touch-action="dodge" className="tbtn">闪避</button>
        <button type="button" data-touch-btn data-touch-action="pause" className="tbtn">暂停</button>
      </div>
    </>
  );
}
