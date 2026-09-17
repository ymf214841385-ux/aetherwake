import { Canvas, useThree } from "@react-three/fiber";
import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { resumeAudio } from "./audio";
import { bindInput, enqueueCommand, setWorldClickHandler, touch } from "./input";
import { bindTouchInput, bindTouchOrientation } from "./touch-input";
import { CAM_FOV } from "./params";
import { GameWorld } from "./Scene";
import { sim } from "./sim";
import { useHud } from "./store";
import { decideWorldClick } from "./world-click-policy";
import { pickInteractableAtClient, pickInteractableFromCenter } from "./world-picking";
import { getPickContext, setPickCamera, setPickCanvas } from "./pick-registry";

function PickBridge() {
  const { camera, gl } = useThree();
  useEffect(() => {
    setPickCamera(camera);
    setPickCanvas(gl.domElement as HTMLCanvasElement);
    return () => {
      setPickCamera(null);
      setPickCanvas(null);
    };
  }, [camera, gl]);
  return null;
}

export default function GameClient() {
  const wrap = useRef<HTMLDivElement>(null);
  const quality = useHud((s) => s.quality);
  const mode = useHud((s) => s.mode);
  const prompt = useHud((s) => s.prompt);

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const unbind = bindInput(el);
    const vis = () => resumeAudio();
    document.addEventListener("visibilitychange", vis);
    const unbindOrientation = bindTouchOrientation(window, sim);

    setWorldClickHandler((info) => {
      if (sim.mode !== "playing") return;
      const ctx = getPickContext();
      const player = sim.player;
      let pickedTargetId: string | null = null;

      if (ctx) {
        const pickCtx = {
          camera: ctx.camera,
          canvas: ctx.canvas,
          player: { x: player.x, y: player.y, z: player.z },
          pickables: ctx.pickables.filter((p) => p.worldId === sim.currentWorldId()),
          occluders: ctx.occluders,
        };
        const hit =
          info.source === "touch-tap" || !info.pointerLocked
            ? pickInteractableAtClient(info.clientX, info.clientY, pickCtx)
            : pickInteractableFromCenter(pickCtx);
        if (hit && hit.worldId === sim.currentWorldId()) pickedTargetId = hit.targetId;
      }

      const preview = sim.previewInteraction(pickedTargetId);
      const decision = decideWorldClick({
        source: info.source,
        pointerLocked: info.pointerLocked,
        mode: sim.mode,
        pickedTargetId,
        preview: preview
          ? { targetId: preview.targetId, worldId: preview.worldId, enabled: preview.enabled }
          : null,
        allowProximity: false,
      });

      if (decision.kind === "interact") {
        enqueueCommand("interact", {
          targetId: decision.targetId,
          worldId: decision.worldId,
          activationId: decision.activationId,
        });
        return;
      }
      if (decision.kind === "attack") {
        enqueueCommand("attack");
        return;
      }
      if (decision.kind === "pointer-lock") {
        const target = wrap.current;
        if (target?.requestPointerLock) {
          try {
            const r = target.requestPointerLock() as unknown as Promise<void> | undefined;
            if (r && typeof r.catch === "function") {
              r.catch(() => {
                // Pointer lock rejected (user gesture, permissions). Stay unlocked; do not attack.
              });
            }
          } catch {
            // Older API sync throw — ignore.
          }
        }
      }
      // ignore: empty touch tap / out-of-range pick / not playing
    });

    return () => {
      setWorldClickHandler(null);
      unbind();
      document.removeEventListener("visibilitychange", vis);
      unbindOrientation();
    };
  }, []);

  const dpr: [number, number] = quality === "low" ? [0.75, 1] : quality === "high" ? [1, 2] : [1, 1.5];
  const shadows = quality === "low" ? false : { type: THREE.PCFShadowMap };
  const controlsLive = mode === "playing";

  return (
    <>
      <div ref={wrap} className="canvas-wrap" onContextMenu={(e) => e.preventDefault()}>
        <Canvas
          shadows={shadows}
          dpr={dpr}
          camera={{ fov: CAM_FOV, near: 0.12, far: 520, position: [16, 34, 118] }}
          gl={{ antialias: quality !== "low", powerPreference: "high-performance", alpha: false }}
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
          <PickBridge />
          <GameWorld />
        </Canvas>
      </div>
      <TouchPad live={controlsLive} prompt={prompt} />
    </>
  );
}

function TouchPad({ live, prompt }: { live: boolean; prompt: string }) {
  const stick = useRef<HTMLDivElement>(null);
  const look = useRef<HTMLDivElement>(null);
  const buttons = useRef<HTMLDivElement>(null);
  const knob = useRef<HTMLDivElement>(null);
  const [stickOn, setStickOn] = useState(false);

  useEffect(() => {
    const st = stick.current;
    const lk = look.current;
    const btns = buttons.current;
    if (!st || !lk || !btns) return;
    return bindTouchInput({
      stick: st,
      look: lk,
      buttons: btns.querySelectorAll<HTMLElement>("[data-touch-action]"),
    });
  }, []);

  useEffect(() => {
    let raf = 0;
    const paint = () => {
      raf = requestAnimationFrame(paint);
      const k = knob.current;
      if (!k) return;
      const x = touch.stickX;
      const y = touch.stickY;
      const mag = Math.hypot(x, y);
      setStickOn(mag > 0.05);
      const travel = 34;
      k.style.transform = `translate(${x * travel}px, ${-y * travel}px)`;
      k.dataset.active = mag > 0.05 ? "1" : "0";
    };
    raf = requestAnimationFrame(paint);
    return () => cancelAnimationFrame(raf);
  }, []);

  const interactLabel = prompt || "互动";

  return (
    <div className={`touch-pad${live ? " is-live" : ""}`} data-ui>
      <div ref={stick} className="touch-stick" data-touch-kind="stick" aria-hidden>
        <div className="stick-base" data-active={stickOn ? "1" : "0"}>
          <div ref={knob} className="stick-knob" data-active={stickOn ? "1" : "0"} />
        </div>
        <div className="stick-hint">移动</div>
      </div>
      <div ref={look} className="touch-look" data-touch-kind="look" aria-hidden>
        <div className="look-hint">拖动视角 · 短点互动</div>
      </div>
      <div ref={buttons} className="touch-btns" data-ui>
        <div className="touch-btn-row">
          <button type="button" data-touch-btn data-touch-action="interact" className="tbtn tbtn-interact">
            {interactLabel.length > 6 ? "互动" : interactLabel}
          </button>
          <button type="button" data-touch-btn data-touch-action="art" className="tbtn">
            能力
          </button>
        </div>
        <div className="touch-btn-row">
          <button type="button" data-touch-btn data-touch-action="climb" className="tbtn">
            攀爬
          </button>
          <button type="button" data-touch-btn data-touch-action="jump" className="tbtn tbtn-main">
            跳 / 翔
          </button>
        </div>
        <div className="touch-btn-row">
          <button type="button" data-touch-btn data-touch-action="dodge" className="tbtn">
            闪避
          </button>
          <button type="button" data-touch-btn data-touch-action="attack" className="tbtn tbtn-atk">
            攻击
          </button>
        </div>
        <div className="touch-btn-row touch-btn-row-aux">
          <button type="button" data-touch-btn data-touch-action="bow" className="tbtn tbtn-sm">
            弓
          </button>
          <button type="button" data-touch-btn data-touch-action="pause" className="tbtn tbtn-sm">
            暂停
          </button>
          <button type="button" data-touch-btn data-touch-action="map" className="tbtn tbtn-sm">
            地图
          </button>
          <button type="button" data-touch-btn data-touch-action="bag" className="tbtn tbtn-sm">
            行囊
          </button>
        </div>
      </div>
    </div>
  );
}
