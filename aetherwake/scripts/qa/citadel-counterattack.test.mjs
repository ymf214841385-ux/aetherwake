import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Sim} from '../../src/game/sim.ts';
import {memoryStorage} from '../../src/game/persistence.ts';
import {FIXED_DT} from '../../src/game/params.ts';
import {resetInput, pressKeyForTest, releaseKeyForTest, enqueueCommand, takeSimActions} from '../../src/game/input.ts';
import {keysToward, createRouteNavigation} from './route-navigation.mjs';
import {createFightOrchestrator} from './combat-progress-monitor.mjs';
import {prepareCitadelCombatDecision,runCitadelLosReposition} from './citadel-handoff.mjs';
import {executeCitadelDefense} from './citadel-defense.mjs';
import {REAL_INPUT_CODES} from './climb-policy.mjs';

const recorded=JSON.parse(readFileSync(new URL('./fixtures/e29-pre-dodge.json',import.meta.url),'utf8'));
const saved=JSON.parse(JSON.parse(readFileSync(new URL('./fixtures/crown-save.json',import.meta.url),'utf8')).v2);

// Controlled initialization from actual E29 pre-dodge observations, not browser
// replay. Missing vx/vz, coyote and jump buffer are initialized to zero; idle
// attack and camera yaw are recorded. Unrecorded distant enemies retain their
// original save defaults. Keep full terrain, enemies, collision and inventory.
// After initialization, only real fixed steps and production input queue run.
function fixture(recordIndex=0, initialPose={}) {
  resetInput();
  const s=recorded[recordIndex];
  assert.ok(s, `actual E29 pre-dodge ${recordIndex} exists`);
  const sim=new Sim(memoryStorage());
  sim.freshRuntime(false);
  sim.applySave(structuredClone(saved));
  sim.mode='playing';
  for(const k of ['x','y','z','yaw','hp','stamina','staminaMax','state','grounded','climbing','vy','spicy','cold','coldAcc','dodgeCd','dodgeT','invuln']) {
    if(k in s) sim.player[k]=s[k];
  }
  Object.assign(sim.player,{vx:0,vz:0,gliding:false,swimming:false,jumpBuf:0,coyote:0});
  sim.cam.yaw=s.camYaw;
  for(const e of s.nearbyEnemies) {
    const target=sim.enemies.find(q=>q.id===e.id);
    if(target) Object.assign(target,structuredClone(e));
  }
  const boss=sim.enemies.find(e=>e.kind==='boss');
  // Negative/reach tests choose their single initial pose before any step.
  if(initialPose.range!==undefined) {
    sim.player.x=boss.x;
    sim.player.z=boss.z+initialPose.range;
    sim.player.y=sim.surfaceY(sim.player.x,sim.player.z,s.y+1)+(initialPose.heightOffset??0);
    sim.cam.yaw=initialPose.yaw??0;
    if(initialPose.heightOffset) Object.assign(sim.player,{state:'airborne',grounded:false});
  }
  if(initialPose.gateWing) {
    // Outside the actual east gate wing, within 3.45m of recorded Boss.
    sim.player.x=9.3; sim.player.z=-2.2;
    sim.player.y=sim.surfaceY(sim.player.x,sim.player.z,s.y+1);
    sim.cam.yaw=Math.atan2(sim.player.x-boss.x,sim.player.z-boss.z);
  }
  const snap=()=>({...sim.player,mode:sim.mode,camYaw:sim.cam.yaw,
    sealOpen:sim.sealIsOpen(),bossDead:sim.bossDead,attackPhase:sim.attack.phase,
    canDodge:sim.canAcceptDodge(sim.player),bossMeleeBlocked:sim.targetVisibility(boss.x,boss.z).blocked,
    blockerId:sim.targetVisibility(boss.x,boss.z).blockerId,
    boss:{...structuredClone(boss),phase:boss.brain.phase,t:boss.brain.t}});
  const frames=[],hits=[],strikes=[];
  const frame=()=> {
    const beforeHp=boss.hp;
    const phase=boss.brain.phase;
    sim.step(FIXED_DT,takeSimActions({consumeCommands:true,consumeLook:true}));
    const point={t:sim.t,hp:sim.player.hp,bossHp:boss.hp,phase:boss.brain.phase,
      stamina:sim.player.stamina,dist:Math.hypot(sim.player.x-boss.x,sim.player.z-boss.z),
      x:sim.player.x,y:sim.player.y,z:sim.player.z,state:sim.player.state,
      bossX:boss.x,bossY:boss.y,bossZ:boss.z,invuln:sim.player.invuln,dodgeCd:sim.player.dodgeCd};
    frames.push(point);
    if(boss.hp<beforeHp) hits.push(point);
    if(phase==='strike') strikes.push(point);
  };
  return {sim,boss,snap,frame,frames,hits,strikes,record:s};
}

// Use real route hold/check/release and prepare/defense functions. Adapt only
// browser keyboard/click transport and elapsed time; browser/render/read latency
// and focus/canvas UI are absent, so this never counts as headed acceptance.
function driver(recordIndex) {
  const f=fixture(recordIndex),held=new Set(),actions=[],notes=[];
  let ms=0,simulatedMs=0;
  const down=async k=> {
    held.add(k); pressKeyForTest(k);
    // Production nonrepeat C key-down enqueues dodge; test helper omits C.
    if(k==='KeyC') enqueueCommand('dodge');
  };
  const up=async k=> {held.delete(k); releaseKeyForTest(k);};
  const releaseAll=async()=> {for(const k of [...held]) await up(k);};
  const wait=async n=> {
    ms+=n;
    while(simulatedMs+FIXED_DT*1000<=ms+1e-6 && f.sim.mode==='playing') {
      f.frame(); simulatedMs+=FIXED_DT*1000;
    }
  };
  const press=async k=> {await down(k);await up(k);};
  const nav=createRouteNavigation({page:{keyboard:{down,up,press}},read:async()=>f.snap(),wait,
    now:()=>ms,ensureOpen(){},focusPlaySurface:async()=>{},
    MOVE_CODES:[...REAL_INPUT_CODES],
    releaseAll,note:m=>notes.push(m),state:{}});
  const orch=createFightOrchestrator({...nav,releaseAll,wait,now:()=>ms});
  const read=()=>nav.checkedRead(orch.scope);
  const run=async()=> {
    let turns=0,repositionUsed=0,pendingSnapshot=null;
    try {
      while(ms<45000 && f.sim.mode==='playing') {
        const handoff=pendingSnapshot;
        pendingSnapshot=null;
        const s=handoff??await read();
        assert.ok(Math.hypot(s.x-s.boss.x,s.z-s.boss.z)<=8,'fixture stays in the short live combat branch');
        const prepared=await prepareCitadelCombatDecision({snapshot:s,preserveSnapshot:turns++===0||handoff!==null,
          scope:orch.scope,lookToward:nav.lookToward,fightRead:read});
        assert.ok(prepared);
        const {snapshot,dist,faceDot,step}=prepared;
        actions.push({t:f.sim.t,act:step.act,dist,bossPhase:snapshot.boss.phase,faceDot});
        if(step.act==='reposition') {
          assert.ok(repositionUsed<1,'same main dispatcher limit: at most one LOS reposition');
          repositionUsed++;
          const result=await runCitadelLosReposition({scope:orch.scope,goTo:orch.goTo,read,note:m=>notes.push(m),start:snapshot});
          assert.equal(result.ok,true,`actual shared LOS reposition failed: ${JSON.stringify(result.rec)}`);
          pendingSnapshot=result.combatReady?result.s:null;
          continue;
        }
        const defense=await executeCitadelDefense({snapshot,step,scope:orch.scope,
          fightHold:orch.hold,fightRead:read,releaseAll,note:m=>notes.push(m)});
        if(defense.handled) continue;
        if(step.act==='approach') {
          await orch.hold(keysToward(snapshot,snapshot.boss.x,snapshot.boss.z,dist>6),160);
          continue;
        }
        if(step.act==='hold-attack') {await wait(90); continue;}
        if(step.act==='wait-facing') {await nav.lookToward(snapshot.boss.x,snapshot.boss.z,orch.scope); continue;}
        assert.equal(step.act,'swing','only actual prepared swing may click');
        assert.equal(step.swing,true);
        enqueueCommand('attack'); // production left mouse-down command edge
        await wait(180);
        await read();
      }
    } finally {await releaseAll();}
  };
  return {...f,run,held,actions,notes,scope:orch.scope};
}

for(const recordIndex of [0,3,7]) test(`actual controller: E29 pre-dodge ${recordIndex+1} survives multiple real counterattacks and reaches ending`,async t=> {
  const f=driver(recordIndex);
  try {await f.run();}
  catch(error) {
    t.diagnostic(JSON.stringify({sourcePreDodge:recordIndex+1,stop:String(error.message),elapsed:f.sim.t,
      hp:f.sim.player.hp,bossHp:f.boss.hp,hits:f.hits.length,strikes:f.strikes.length,firstThreeHits:f.hits.slice(0,3),
      lastActions:f.actions.slice(-8),lastFrames:f.frames.slice(-12),lastNav:f.scope.lastSnapshot?.nav,
      repositionNotes:f.notes.filter(n=>n.startsWith('citadel reposition')).slice(-2)}));
    throw error;
  }
  const dodges=f.actions.filter(a=>a.act==='dodge').length;
  t.diagnostic(JSON.stringify({sourcePreDodge:recordIndex+1,initialHp:f.record.hp,initialStamina:f.record.stamina,
    elapsed:f.sim.t,mode:f.sim.mode,hp:f.sim.player.hp,bossHp:f.boss.hp,dodges,swings:f.actions.filter(a=>a.act==='swing').length,
    strikes:f.strikes.length,hits:f.hits.length,firstThreeHits:f.hits.slice(0,3)}));
  assert.ok(f.hits.length>=3,`expected at least 3 actual melee hits, got ${f.hits.length}; the old 2.55 QA band stalls at Boss HP20`);
  assert.ok(dodges>=3,'multiple C inputs were actually selected by the real policy');
  assert.ok(f.strikes.length>=3,'multiple natural Boss attack chains executed');
  assert.ok(f.frames.every(s=>s.hp===1),'HP is never replenished or lost after the one-time fixture initialization');
  assert.equal(f.sim.mode,'ending');
  assert.equal(f.boss.alive,false);
  assert.equal(f.sim.bossDead,true);
  assert.equal(f.held.size,0);
});

for(const {name,pose,hit} of [
  {name:'3.2m aligned Boss sword hit',pose:{range:3.2},hit:true},
  {name:'beyond actual 3.45m Boss range',pose:{range:3.5},hit:false},
  {name:'3.2m facing away',pose:{range:3.2,yaw:Math.PI},hit:false},
  {name:'3.2m but outside vertical melee reach',pose:{range:3.2,heightOffset:2.5},hit:false},
]) test(`production input melee boundary: ${name}`,()=> {
  const f=fixture(0,pose);
  assert.equal(f.sim.targetVisibility(f.boss.x,f.boss.z).blocked,false,'range/facing/height cases isolate a clear-LOS pose');
  enqueueCommand('attack');
  for(let i=0;i<12;i++) f.frame();
  assert.equal(f.hits.length,hit?1:0);
  assert.equal(f.boss.hp,hit?18.2:20);
  assert.equal(f.sim.player.hp,1);
});

test('production input melee boundary: actual east gate wing blocks an in-range aligned swing',()=> {
  const f=fixture(0,{gateWing:true});
  const s=f.snap();
  assert.ok(Math.hypot(s.x-s.boss.x,s.z-s.boss.z)<3.45);
  assert.ok(Math.abs(s.y-s.boss.y)<1.35);
  assert.equal(f.sim.targetVisibility(f.boss.x,f.boss.z).blocked,true);
  enqueueCommand('attack');
  for(let i=0;i<12;i++) f.frame();
  assert.equal(f.hits.length,0);
  assert.equal(f.boss.hp,20);
  assert.equal(f.sim.player.hp,1);
});
