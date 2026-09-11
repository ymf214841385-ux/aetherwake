import { lazy, Suspense, useEffect, useState } from "react";
import { unlockAudio, setMuted } from "./audio";
import { sim } from "./sim";
import { hasSaveFile } from "./store";
import { Overlay } from "./ui";

const GameClient = lazy(() => import("./GameClient"));

export function GameApp() {
  const [mounted, setMounted] = useState(false);
  const [save, setSave] = useState(false);
  const [mute, setMute] = useState(false);

  useEffect(() => {
    setMounted(true);
    setSave(hasSaveFile());
  }, []);

  const start = (cont: boolean) => {
    unlockAudio();
    if (cont) sim.continueSave();
    else sim.startNew();
    if (import.meta.env.DEV && typeof window !== "undefined" && new URLSearchParams(window.location.search).get("graybox") === "1") {
      sim.enterGraybox();
    }
  };

  return (
    <div className="game-root">
      {!mounted && (
        <div className="title-screen">
          <div className="title-copy">
            <p className="kicker">载入中</p>
            <h1>Aetherwake</h1>
            <p className="lead">正在唤醒原野…</p>
          </div>
        </div>
      )}
      {mounted && (
        <Suspense
          fallback={
            <div className="title-screen">
              <div className="title-copy">
                <p className="kicker">载入中</p>
                <p className="lead">正在载入场景与角色…</p>
              </div>
            </div>
          }
        >
          <GameClient />
        </Suspense>
      )}
      <Overlay
        onStart={() => start(false)}
        onContinue={() => start(true)}
        hasSave={save}
        muted={mute}
        onMute={() => {
          const n = !mute;
          setMute(n);
          setMuted(n);
        }}
      />
    </div>
  );
}
