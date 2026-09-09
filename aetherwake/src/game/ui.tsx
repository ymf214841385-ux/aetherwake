import type { ReactNode } from "react";
import { Compass, Map, Pause, Volume2, VolumeX } from "lucide-react";
import { useHud } from "./store";
import { sim } from "./sim";

const ARTS = ["爆鸣", "霜息", "牵引", "凝时"];

export function Overlay({
  onStart,
  onContinue,
  hasSave,
  muted,
  onMute,
}: {
  onStart: () => void;
  onContinue: () => void;
  hasSave: boolean;
  muted: boolean;
  onMute: () => void;
}) {
  const hud = useHud();

  return (
    <div className="overlay">
      {hud.mode === "title" && (
        <div className="title-screen">
          <div className="title-copy">
            <p className="kicker">灾厄之后 · 开放原野</p>
            <h1>Aetherwake</h1>
            <p className="sub">风 醒</p>
            <p className="lead">
              你在高原醒来。攀上高塔，滑翔过森林与湖面，解开灵祠，直到残堡的封印打开。
            </p>
            <div className="title-actions">
              <button type="button" className="btn-primary" onClick={onStart}>
                开始探索
              </button>
              {hasSave && (
                <button type="button" className="btn-ghost" onClick={onContinue}>
                  继续旅途
                </button>
              )}
            </div>
            <ul className="controls-legend">
              <li>
                <span>WASD</span> 移动
              </li>
              <li>
                <span>鼠标</span> 视角
              </li>
              <li>
                <span>空格</span> 跳 / 攀 / 滑翔
              </li>
              <li>
                <span>Shift</span> 冲刺
              </li>
              <li>
                <span>左键</span> 攻击
              </li>
              <li>
                <span>右键</span> 弓
              </li>
              <li>
                <span>F</span> 石板
              </li>
              <li>
                <span>E</span> 互动
              </li>
              <li>
                <span>1-4</span> 切换能力
              </li>
              <li>
                <span>M</span> 地图
              </li>
            </ul>
          </div>
        </div>
      )}

      {hud.mode !== "title" && (
        <>
          <div className="hud-tl">
            <Hearts hp={hud.hp} max={hud.heartsMax} />
            <div className="meta-row">
              <span>琥珀 {hud.amber}</span>
              <span>灵核 {hud.orbs}/4</span>
              {hud.cold && <span className="warn">严寒</span>}
              {hud.gliding && <span>滑翔</span>}
              {hud.climbing && <span>攀爬</span>}
            </div>
          </div>
          <div className="hud-tr">
            <p className="objective">{hud.objective}</p>
            <div className="hud-tools">
              <button type="button" className="icon-btn" onClick={() => (sim.mode = "map")} aria-label="地图">
                <Map size={18} />
              </button>
              <button type="button" className="icon-btn" onClick={() => (sim.mode = "paused")} aria-label="暂停">
                <Pause size={18} />
              </button>
              <button type="button" className="icon-btn" onClick={onMute} aria-label="静音">
                {muted ? <VolumeX size={18} /> : <Volume2 size={18} />}
              </button>
            </div>
          </div>
          {(hud.climbing || hud.gliding || hud.stamina < hud.staminaMax - 1) && (
            <div className="stamina-wrap">
              <div
                className="stamina"
                style={{
                  background: `conic-gradient(var(--color-stamina) ${(hud.stamina / hud.staminaMax) * 360}deg, transparent 0)`,
                }}
              />
            </div>
          )}
          {hud.toast && <p className="toast">{hud.toast}</p>}
          {hud.prompt && <p className="prompt">{hud.prompt}</p>}
          {hud.shrineHint && <p className="hint">{hud.shrineHint}</p>}
          <div className="hud-bl">
            <div className="weapon-chip">
              <span className="chip-label">武器</span>
              <strong>{hud.weapon?.name ?? "徒手"}</strong>
              {hud.weapon && (
                <em>
                  {hud.weapon.dur}/{hud.weapon.max}
                </em>
              )}
            </div>
            <div className="arts">
              {ARTS.map((n, i) => (
                <button
                  key={n}
                  type="button"
                  className={i === hud.art ? "art on" : "art"}
                  onClick={() => (sim.art = i)}
                >
                  {i + 1} {n}
                </button>
              ))}
            </div>
            <div className="weapon-chip">
              <span className="chip-label">箭矢</span>
              <strong>{hud.arrows}</strong>
            </div>
          </div>
          <Minimap />
        </>
      )}

      {hud.mode === "paused" && (
        <Modal title="暂停" onClose={() => sim.closeOverlay()}>
          <button type="button" className="btn-primary" onClick={() => sim.closeOverlay()}>
            继续
          </button>
          <button type="button" className="btn-ghost" onClick={() => (sim.mode = "title")}>
            返回标题
          </button>
        </Modal>
      )}
      {hud.mode === "inventory" && (
        <Modal title="行囊" onClose={() => sim.closeOverlay()}>
          <h3>武器</h3>
          <ul className="inv-list">
            {hud.weapons.map((w, i) => (
              <li key={w.id}>
                <button
                  type="button"
                  onClick={() => {
                    if (w.kind === "bow") sim.bowIdx = i;
                    else sim.equipped = i;
                    sim.closeOverlay();
                  }}
                >
                  {w.name}
                  <span>
                    {w.dur}/{w.max}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          <h3>料理</h3>
          <ul className="inv-list">
            {hud.meals.length === 0 && <li className="muted">空</li>}
            {hud.meals.map((m) => (
              <li key={m.id}>
                <button type="button" onClick={() => sim.eat(m.id)}>
                  {m.name}
                  <span>+{m.hearts} 心</span>
                </button>
              </li>
            ))}
          </ul>
          <h3>材料</h3>
          <p className="muted">{hud.materials.map((m) => `${m.name} ×${m.n}`).join("  ·  ") || "无"}</p>
        </Modal>
      )}
      {hud.mode === "map" && (
        <Modal title="原野" onClose={() => sim.closeOverlay()}>
          <BigMap />
        </Modal>
      )}
      {hud.mode === "cooking" && (
        <Modal title="篝火" onClose={() => sim.closeOverlay()}>
          <p className="muted">投入一份材料，烤成料理。休息已恢复生命。</p>
          <ul className="inv-list">
            {hud.materials.map((m) => (
              <li key={m.id}>
                <button type="button" onClick={() => sim.cook(m.id)}>
                  烹饪 {m.name}
                  <span>×{m.n}</span>
                </button>
              </li>
            ))}
          </ul>
        </Modal>
      )}
      {hud.mode === "dialogue" && (
        <Modal title="守塔人" onClose={() => sim.closeOverlay()}>
          <p className="lead">{hud.dialogue}</p>
          <button type="button" className="btn-primary" onClick={() => sim.closeOverlay()}>
            明白了
          </button>
        </Modal>
      )}
      {hud.mode === "dead" && (
        <Modal title="倒下了">
          <button type="button" className="btn-primary" onClick={() => sim.respawn()}>
            在篝火旁醒来
          </button>
        </Modal>
      )}
      {hud.mode === "ending" && (
        <div className="title-screen ending">
          <div className="title-copy">
            <p className="kicker">空王已沉</p>
            <h1>风仍在</h1>
            <p className="lead">灾厄暂时平息。高原、湖面与雪冠都还在——原野是你的了。</p>
            <button type="button" className="btn-primary" onClick={() => (sim.mode = "playing")}>
              继续漫游
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function Hearts({ hp, max }: { hp: number; max: number }) {
  const units = [];
  for (let i = 0; i < max; i++) {
    const fill = Math.min(1, Math.max(0, hp - i));
    units.push(
      <span key={i} className="heart">
        <span className="heart-fill" style={{ width: `${fill * 100}%` }} />
      </span>,
    );
  }
  return <div className="hearts">{units}</div>;
}

function Minimap() {
  const hud = useHud();
  const scale = 128 / 384;
  const px = 64 + hud.px * scale;
  const pz = 64 + hud.pz * scale;
  return (
    <div className="minimap">
      <div className="minimap-disk">
        {hud.markers.map((m) => (
          <span
            key={m.id}
            className={`pin pin-${m.kind} ${m.done ? "done" : ""}`}
            style={{ left: 64 + m.x * scale, top: 64 + m.z * scale }}
          />
        ))}
        <span
          className="you"
          style={{
            left: px,
            top: pz,
            transform: `translate(-50%,-50%) rotate(${(-hud.yaw * 180) / Math.PI}deg)`,
          }}
        />
      </div>
      <Compass size={12} className="mini-compass" />
    </div>
  );
}

function BigMap() {
  const hud = useHud();
  const scale = 280 / 384;
  return (
    <div className="bigmap">
      {hud.markers.map((m) => (
        <span
          key={m.id}
          className={`pin pin-${m.kind} ${m.done ? "done" : ""}`}
          style={{ left: 140 + m.x * scale, top: 140 + m.z * scale }}
          title={m.name}
        />
      ))}
      <span className="you" style={{ left: 140 + hud.px * scale, top: 140 + hud.pz * scale }} />
      <ul className="map-legend">
        {hud.markers.map((m) => (
          <li key={m.id}>
            {m.name}
            {m.done ? " · 已完成" : ""}
          </li>
        ))}
      </ul>
    </div>
  );
}

function Modal({
  title,
  children,
  onClose,
}: {
  title: string;
  children: ReactNode;
  onClose?: () => void;
}) {
  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-label={title}>
        <h2>{title}</h2>
        {children}
        {onClose && (
          <button type="button" className="btn-ghost" onClick={onClose}>
            关闭
          </button>
        )}
      </div>
    </div>
  );
}
