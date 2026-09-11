import * as THREE from "three";

export type WandererMats = {
  skin: THREE.MeshStandardMaterial;
  skinWarm: THREE.MeshStandardMaterial;
  skinLip: THREE.MeshStandardMaterial;
  hair: THREE.MeshStandardMaterial;
  hairCard: THREE.MeshStandardMaterial;
  brow: THREE.MeshStandardMaterial;
  eyeWhite: THREE.MeshStandardMaterial;
  iris: THREE.MeshStandardMaterial;
  pupil: THREE.MeshStandardMaterial;
  highlight: THREE.MeshStandardMaterial;
  tunic: THREE.MeshStandardMaterial;
  tunicSolid: THREE.MeshStandardMaterial;
  tunicDark: THREE.MeshStandardMaterial;
  linen: THREE.MeshStandardMaterial;
  sleeve: THREE.MeshStandardMaterial;
  vest: THREE.MeshStandardMaterial;
  lining: THREE.MeshStandardMaterial;
  wrap: THREE.MeshStandardMaterial;
  pants: THREE.MeshStandardMaterial;
  boot: THREE.MeshStandardMaterial;
  sole: THREE.MeshStandardMaterial;
  leather: THREE.MeshStandardMaterial;
  strap: THREE.MeshStandardMaterial;
  steel: THREE.MeshStandardMaterial;
  steelDark: THREE.MeshStandardMaterial;
  slate: THREE.MeshStandardMaterial;
  fabric: THREE.MeshStandardMaterial;
  sailTrim: THREE.MeshStandardMaterial;
  wood: THREE.MeshStandardMaterial;
  cord: THREE.MeshStandardMaterial;
};

function canvasTex(
  size: number,
  draw: (ctx: CanvasRenderingContext2D, s: number) => void,
  asColor = true,
): THREE.CanvasTexture | undefined {
  if (typeof document === "undefined") return undefined;
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const ctx = c.getContext("2d");
  if (!ctx) return undefined;
  draw(ctx, size);
  const tex = new THREE.CanvasTexture(c);
  if (asColor) tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  return tex;
}

function noise(ctx: CanvasRenderingContext2D, s: number, alpha: number) {
  const img = ctx.getImageData(0, 0, s, s);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (Math.random() - 0.5) * alpha * 255;
    d[i] = Math.max(0, Math.min(255, d[i]! + n));
    d[i + 1] = Math.max(0, Math.min(255, d[i + 1]! + n));
    d[i + 2] = Math.max(0, Math.min(255, d[i + 2]! + n));
  }
  ctx.putImageData(img, 0, 0);
}

function skinMap() {
  return canvasTex(128, (ctx, s) => {
    ctx.fillStyle = "#d4ae90";
    ctx.fillRect(0, 0, s, s);
    for (let i = 0; i < 36; i++) {
      ctx.fillStyle = `rgba(186, 96, 86, ${0.018 + Math.random() * 0.03})`;
      ctx.beginPath();
      ctx.ellipse(
        Math.random() * s,
        Math.random() * s,
        10 + Math.random() * 22,
        7 + Math.random() * 16,
        Math.random() * Math.PI,
        0,
        Math.PI * 2,
      );
      ctx.fill();
    }
    for (let i = 0; i < 500; i++) {
      ctx.fillStyle = `rgba(90, 48, 36, ${0.03 + Math.random() * 0.05})`;
      ctx.fillRect(Math.random() * s, Math.random() * s, 1, 1);
    }
    noise(ctx, s, 0.045);
  });
}

function clothMap(hex: string) {
  return canvasTex(128, (ctx, s) => {
    ctx.fillStyle = hex;
    ctx.fillRect(0, 0, s, s);
    for (let i = 0; i < s; i += 3) {
      ctx.fillStyle = "rgba(255,255,255,0.035)";
      ctx.fillRect(0, i, s, 1);
      ctx.fillStyle = "rgba(30,24,16,0.04)";
      ctx.fillRect(i, 0, 1, s);
    }
    for (let i = 0; i < 28; i++) {
      ctx.fillStyle = `rgba(255,255,255,${0.025 + Math.random() * 0.04})`;
      ctx.fillRect(Math.random() * s, Math.random() * s, 4 + Math.random() * 10, 1);
    }
    noise(ctx, s, 0.06);
  });
}

function leatherMap() {
  return canvasTex(128, (ctx, s) => {
    ctx.fillStyle = "#6a4028";
    ctx.fillRect(0, 0, s, s);
    for (let i = 0; i < 36; i++) {
      ctx.strokeStyle = `rgba(28, 14, 8, ${0.08 + Math.random() * 0.14})`;
      ctx.beginPath();
      ctx.moveTo(Math.random() * s, Math.random() * s);
      ctx.quadraticCurveTo(Math.random() * s, Math.random() * s, Math.random() * s, Math.random() * s);
      ctx.stroke();
    }
    for (let i = 0; i < 14; i++) {
      ctx.fillStyle = `rgba(140, 84, 48, ${0.06 + Math.random() * 0.1})`;
      ctx.beginPath();
      ctx.ellipse(
        Math.random() * s,
        Math.random() * s,
        8 + Math.random() * 18,
        4 + Math.random() * 10,
        Math.random(),
        0,
        Math.PI * 2,
      );
      ctx.fill();
    }
    noise(ctx, s, 0.1);
  });
}

function hairAlpha() {
  return canvasTex(
    64,
    (ctx, s) => {
      ctx.clearRect(0, 0, s, s);
      for (let i = 0; i < 18; i++) {
        const x = (i + 0.4) * (s / 18);
        ctx.strokeStyle = `rgba(20, 12, 8, ${0.35 + (i % 3) * 0.2})`;
        ctx.lineWidth = 1.2 + (i % 4) * 0.4;
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.quadraticCurveTo(x + Math.sin(i) * 4, s * 0.5, x + Math.sin(i * 1.7) * 3, s);
        ctx.stroke();
      }
    },
    false,
  );
}

function hairMap() {
  return canvasTex(128, (ctx, s) => {
    const g = ctx.createLinearGradient(0, 0, s, s);
    g.addColorStop(0, "#4a372b");
    g.addColorStop(0.45, "#251914");
    g.addColorStop(1, "#120d0b");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, s, s);
    for (let i = 0; i < 42; i++) {
      const x = (i / 42) * s;
      ctx.strokeStyle = `rgba(184, 130, 88, ${0.025 + (i % 5) * 0.012})`;
      ctx.lineWidth = 0.55 + (i % 3) * 0.32;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.bezierCurveTo(x - 6, s * 0.32, x + 8, s * 0.67, x + Math.sin(i * 1.7) * 5, s);
      ctx.stroke();
    }
    noise(ctx, s, 0.035);
  });
}

function irisMap() {
  return canvasTex(64, (ctx, s) => {
    const cx = s / 2;
    const cy = s / 2;
    const g = ctx.createRadialGradient(cx, cy, 2, cx, cy, s * 0.48);
    g.addColorStop(0, "#050302");
    g.addColorStop(0.16, "#050302");
    g.addColorStop(0.2, "#4a2a16");
    g.addColorStop(0.48, "#8a5a32");
    g.addColorStop(0.78, "#3a2214");
    g.addColorStop(1, "#140c08");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, s, s);
    ctx.strokeStyle = "rgba(40,22,12,0.5)";
    ctx.lineWidth = 1;
    for (let a = 0; a < 28; a++) {
      const ang = (a / 28) * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + Math.cos(ang) * s * 0.48, cy + Math.sin(ang) * s * 0.48);
      ctx.stroke();
    }
  });
}

function metalMap() {
  return canvasTex(64, (ctx, s) => {
    const g = ctx.createLinearGradient(0, 0, s, s);
    g.addColorStop(0, "#d8dee4");
    g.addColorStop(0.5, "#9aa4ae");
    g.addColorStop(1, "#cfd6dc");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, s, s);
    ctx.strokeStyle = "rgba(255,255,255,0.18)";
    for (let i = 0; i < s; i += 3) {
      ctx.beginPath();
      ctx.moveTo(0, i);
      ctx.lineTo(s, i);
      ctx.stroke();
    }
  });
}

function std(
  color: string,
  opts: {
    roughness?: number;
    metalness?: number;
    map?: THREE.Texture;
    roughnessMap?: THREE.Texture;
    alphaMap?: THREE.Texture;
    emissive?: string;
    emissiveIntensity?: number;
    side?: THREE.Side;
    vertexColors?: boolean;
    transparent?: boolean;
    alphaTest?: number;
    envMapIntensity?: number;
  } = {},
) {
  const m = new THREE.MeshStandardMaterial({
    color,
    roughness: opts.roughness ?? 0.62,
    metalness: opts.metalness ?? 0,
    emissive: opts.emissive ?? "#000000",
    emissiveIntensity: opts.emissiveIntensity ?? 0,
    side: opts.side ?? THREE.FrontSide,
    vertexColors: opts.vertexColors ?? false,
    transparent: opts.transparent ?? false,
    alphaTest: opts.alphaTest ?? 0,
    envMapIntensity: opts.envMapIntensity ?? 0.55,
  });
  if (opts.map) m.map = opts.map;
  if (opts.roughnessMap) m.roughnessMap = opts.roughnessMap;
  if (opts.alphaMap) m.alphaMap = opts.alphaMap;
  return m;
}

export function createWandererMaterials(): WandererMats {
  const skinTex = skinMap();
  const cloth = clothMap("#59604a");
  const clothDark = clothMap("#5a3e2c");
  const wrapTex = clothMap("#3d5c6e");
  const pantsTex = clothMap("#3c3530");
  const linenTex = clothMap("#d8d2c4");
  const sleeveTex = clothMap("#627050");
  const leather = leatherMap();
  const hairA = hairAlpha();
  const hairTex = hairMap();
  const iris = irisMap();
  const metal = metalMap();
  const sail = clothMap("#e2d2ae");

  const vest = std("#6a4028", {
    roughness: 0.58,
    map: leather,
    envMapIntensity: 0.22,
    side: THREE.FrontSide,
  });
  vest.polygonOffset = true;
  vest.polygonOffsetFactor = -1.5;
  vest.polygonOffsetUnits = -1.5;

  return {
    skin: std("#c9a186", { roughness: 0.86, map: skinTex, envMapIntensity: 0.1 }),
    skinWarm: std("#be8d72", { roughness: 0.8, map: skinTex, envMapIntensity: 0.14 }),
    skinLip: std("#8a524c", { roughness: 0.45, envMapIntensity: 0.16 }),
    hair: std("#2b201a", { roughness: 0.82, map: hairTex, envMapIntensity: 0.06 }),
    hairCard: std("#1a120c", {
      roughness: 0.72,
      alphaMap: hairA,
      transparent: true,
      alphaTest: 0.26,
      side: THREE.DoubleSide,
      envMapIntensity: 0.14,
    }),
    brow: std("#1a120e", { roughness: 0.72 }),
    eyeWhite: std("#e8ddd2", { roughness: 0.38, envMapIntensity: 0.22 }),
    iris: std("#6b4428", { roughness: 0.28, map: iris, envMapIntensity: 0.42 }),
    pupil: std("#050505", { roughness: 0.18 }),
    highlight: std("#ffffff", { roughness: 0.12, emissive: "#ffffff", emissiveIntensity: 0.28 }),
    // A muted travelling coat lets leather, skin, and metal read as separate
    // materials instead of making the lower body a single bright fabric tube.
    tunic: std("#59604a", { roughness: 0.92, map: cloth, vertexColors: true, envMapIntensity: 0.1 }),
    tunicSolid: std("#59604a", { roughness: 0.92, map: cloth, envMapIntensity: 0.1 }),
    tunicDark: std("#4e3424", { roughness: 0.78, map: clothDark }),
    linen: std("#cfc6b4", { roughness: 0.94, map: linenTex, envMapIntensity: 0.08 }),
    sleeve: std("#627050", { roughness: 0.9, map: sleeveTex, envMapIntensity: 0.1 }),
    vest,
    lining: std("#3e2e28", { roughness: 0.86, side: THREE.DoubleSide }),
    wrap: std("#3a6578", { roughness: 0.78, map: wrapTex, side: THREE.DoubleSide }),
    pants: std("#322c28", { roughness: 0.88, map: pantsTex }),
    boot: std("#3a2418", { roughness: 0.52, map: leather, envMapIntensity: 0.24 }),
    sole: std("#1a100a", { roughness: 0.82 }),
    leather: std("#6a4028", { roughness: 0.56, map: leather, envMapIntensity: 0.24 }),
    strap: std("#4a3020", { roughness: 0.64, map: leather }),
    steel: std("#d0d6dc", { roughness: 0.22, metalness: 0.88, map: metal, envMapIntensity: 1.05 }),
    steelDark: std("#6e787e", { roughness: 0.36, metalness: 0.78, map: metal, envMapIntensity: 0.85 }),
    slate: std("#6aa8a0", { roughness: 0.44, metalness: 0.12, emissive: "#1a4a46", emissiveIntensity: 0.16 }),
    fabric: std("#e2d2ae", { roughness: 0.88, map: sail, side: THREE.DoubleSide }),
    sailTrim: std("#2a564c", { roughness: 0.7, side: THREE.DoubleSide }),
    wood: std("#5e3c22", { roughness: 0.76 }),
    cord: std("#c8b080", { roughness: 0.62 }),
  };
}
