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
  };

  return (
    <div className="game-root">
      {mounted && (
        <Suspense fallback={null}>
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
