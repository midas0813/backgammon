import {
  ACESFilmicToneMapping,
  AdditiveBlending,
  AmbientLight,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  CircleGeometry,
  Color,
  CylinderGeometry,
  DirectionalLight,
  DoubleSide,
  ExtrudeGeometry,
  Group,
  LatheGeometry,
  Mesh,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  type Material,
  type Object3D,
  PerspectiveCamera,
  PlaneGeometry,
  PMREMGenerator,
  PointLight,
  Points,
  PointsMaterial,
  Scene,
  Shape,
  SphereGeometry,
  SRGBColorSpace,
  TorusGeometry,
  Vector2,
  WebGLRenderer,
} from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";

/**
 * The landing page's 3D arena: a lit platform with pieces from every game standing on it (chess,
 * backgammon checkers, draughts, a cribbage board, poker chips), a pair of six-sided dice tumbling
 * above it, floating cards and rising sparks. Built from code (no model files), so it costs only the
 * three.js download. The camera follows the pointer and the scroll; it pauses when off screen and
 * draws a single still frame under reduced motion.
 */

const IVORY = 0xf3ead8;
const EBONY = 0x1b1e26;
const MINT = 0x65e2bc;
const GOLD = 0xf4cf87;

type Tex = CanvasTexture;

function canvasTexture(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void): Tex {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  draw(c.getContext("2d")!);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** A die face: ivory with black pips in the standard layout. */
function dieFace(n: number) {
  return canvasTexture(256, 256, (g) => {
    g.fillStyle = "#f6f1e6";
    g.fillRect(0, 0, 256, 256);
    g.fillStyle = "#141a26";
    const at: Record<number, [number, number][]> = {
      1: [[0.5, 0.5]],
      2: [
        [0.27, 0.27],
        [0.73, 0.73],
      ],
      3: [
        [0.25, 0.25],
        [0.5, 0.5],
        [0.75, 0.75],
      ],
      4: [
        [0.27, 0.27],
        [0.73, 0.27],
        [0.27, 0.73],
        [0.73, 0.73],
      ],
      5: [
        [0.26, 0.26],
        [0.74, 0.26],
        [0.5, 0.5],
        [0.26, 0.74],
        [0.74, 0.74],
      ],
      6: [
        [0.27, 0.24],
        [0.73, 0.24],
        [0.27, 0.5],
        [0.73, 0.5],
        [0.27, 0.76],
        [0.73, 0.76],
      ],
    };
    for (const [x, y] of at[n]) {
      g.beginPath();
      g.arc(x * 256, y * 256, n === 1 ? 30 : 22, 0, Math.PI * 2);
      g.fill();
    }
  });
}

/** The platform's top: rings, a checkerboard band and 24 backgammon points around the edge. */
function arenaTop() {
  return canvasTexture(1024, 1024, (g) => {
    const c = 512;
    const bg = g.createRadialGradient(c, c, 40, c, c, 512);
    bg.addColorStop(0, "#1c3346");
    bg.addColorStop(0.7, "#0f1d2e");
    bg.addColorStop(1, "#0a1422");
    g.fillStyle = bg;
    g.fillRect(0, 0, 1024, 1024);
    // 24 points around the rim, alternating gold and mint.
    for (let i = 0; i < 24; i++) {
      const a0 = (i / 24) * Math.PI * 2;
      const a1 = ((i + 1) / 24) * Math.PI * 2;
      const am = (a0 + a1) / 2;
      g.beginPath();
      g.moveTo(c + Math.cos(a0) * 500, c + Math.sin(a0) * 500);
      g.lineTo(c + Math.cos(a1) * 500, c + Math.sin(a1) * 500);
      g.lineTo(c + Math.cos(am) * 380, c + Math.sin(am) * 380);
      g.closePath();
      g.fillStyle = i % 2 ? "rgba(101,226,188,0.22)" : "rgba(244,207,135,0.26)";
      g.fill();
    }
    // A checkerboard band.
    for (let i = 0; i < 32; i++) {
      const a0 = (i / 32) * Math.PI * 2;
      const a1 = ((i + 1) / 32) * Math.PI * 2;
      g.beginPath();
      g.arc(c, c, 330, a0, a1);
      g.arc(c, c, 290, a1, a0, true);
      g.closePath();
      g.fillStyle = i % 2 ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.18)";
      g.fill();
    }
    g.lineWidth = 3;
    for (const [r, col] of [
      [505, "rgba(101,226,188,0.7)"],
      [372, "rgba(244,207,135,0.45)"],
      [336, "rgba(101,226,188,0.35)"],
      [284, "rgba(101,226,188,0.35)"],
      [150, "rgba(244,207,135,0.35)"],
    ] as const) {
      g.strokeStyle = col;
      g.beginPath();
      g.arc(c, c, r, 0, Math.PI * 2);
      g.stroke();
    }
  });
}

function chipSide(color: string) {
  return canvasTexture(512, 32, (g) => {
    g.fillStyle = color;
    g.fillRect(0, 0, 512, 32);
    g.fillStyle = "#f7f1e6";
    for (let i = 0; i < 8; i++) g.fillRect(i * 64 + 18, 0, 26, 32);
  });
}

function chipTop(color: string) {
  return canvasTexture(256, 256, (g) => {
    g.fillStyle = color;
    g.fillRect(0, 0, 256, 256);
    g.strokeStyle = "#f7f1e6";
    g.lineWidth = 14;
    g.setLineDash([22, 18]);
    g.beginPath();
    g.arc(128, 128, 112, 0, Math.PI * 2);
    g.stroke();
    g.setLineDash([]);
    g.lineWidth = 4;
    g.beginPath();
    g.arc(128, 128, 70, 0, Math.PI * 2);
    g.stroke();
  });
}

function cardFace() {
  return canvasTexture(256, 360, (g) => {
    g.fillStyle = "#fbf8f1";
    g.fillRect(0, 0, 256, 360);
    g.fillStyle = "#141a26";
    g.font = "bold 44px Georgia, serif";
    g.fillText("A", 18, 52);
    g.save();
    g.translate(238, 308);
    g.rotate(Math.PI);
    g.fillText("A", 0, 0);
    g.restore();
    // A spade.
    const spade = (x: number, y: number, s: number) => {
      g.beginPath();
      g.moveTo(x, y - s);
      g.bezierCurveTo(x + s * 1.2, y - s * 0.1, x + s, y + s * 0.8, x, y + s * 0.35);
      g.bezierCurveTo(x - s, y + s * 0.8, x - s * 1.2, y - s * 0.1, x, y - s);
      g.fill();
      g.beginPath();
      g.moveTo(x, y + s * 0.2);
      g.lineTo(x + s * 0.35, y + s * 1.05);
      g.lineTo(x - s * 0.35, y + s * 1.05);
      g.fill();
    };
    spade(128, 170, 62);
    spade(34, 80, 14);
  });
}

function cardBack() {
  return canvasTexture(256, 360, (g) => {
    g.fillStyle = "#0f2a2a";
    g.fillRect(0, 0, 256, 360);
    g.strokeStyle = "rgba(244,207,135,0.8)";
    g.lineWidth = 6;
    g.strokeRect(14, 14, 228, 332);
    g.strokeStyle = "rgba(101,226,188,0.5)";
    g.lineWidth = 2;
    for (let i = -360; i < 360; i += 18) {
      g.beginPath();
      g.moveTo(i, 0);
      g.lineTo(i + 360, 360);
      g.moveTo(i + 360, 0);
      g.lineTo(i, 360);
      g.stroke();
    }
  });
}

function cribbageTop() {
  return canvasTexture(512, 160, (g) => {
    g.fillStyle = "#7a4c26";
    g.fillRect(0, 0, 512, 160);
    for (let i = 0; i < 40; i++) {
      g.fillStyle = `rgba(0,0,0,${0.04 + (i % 3) * 0.02})`;
      g.fillRect(0, i * 4, 512, 2);
    }
    g.fillStyle = "#24160b";
    for (const y of [45, 80, 115])
      for (let i = 0; i < 30; i++) {
        g.beginPath();
        g.arc(36 + i * 15 + Math.floor(i / 5) * 4, y, 4, 0, Math.PI * 2);
        g.fill();
      }
  });
}

function glowTexture() {
  return canvasTexture(256, 256, (g) => {
    const r = g.createRadialGradient(128, 128, 0, 128, 128, 128);
    r.addColorStop(0, "rgba(255,255,255,1)");
    r.addColorStop(0.25, "rgba(255,255,255,0.45)");
    r.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = r;
    g.fillRect(0, 0, 256, 256);
  });
}

function beamTexture() {
  return canvasTexture(4, 256, (g) => {
    const r = g.createLinearGradient(0, 0, 0, 256);
    r.addColorStop(0, "rgba(255,255,255,0)");
    r.addColorStop(1, "rgba(255,255,255,0.9)");
    g.fillStyle = r;
    g.fillRect(0, 0, 4, 256);
  });
}

const lathe = (pts: [number, number][]) =>
  new LatheGeometry(
    pts.map(([x, y]) => new Vector2(x, y)),
    48,
  );

const PROFILES: Record<string, [number, number][]> = {
  pawn: [
    [0, 0],
    [0.42, 0],
    [0.42, 0.08],
    [0.34, 0.14],
    [0.3, 0.2],
    [0.17, 0.32],
    [0.13, 0.55],
    [0.23, 0.6],
    [0.23, 0.64],
    [0.12, 0.68],
    [0, 0.68],
  ],
  king: [
    [0, 0],
    [0.5, 0],
    [0.5, 0.1],
    [0.42, 0.16],
    [0.36, 0.24],
    [0.22, 0.42],
    [0.17, 0.95],
    [0.3, 1.0],
    [0.3, 1.06],
    [0.2, 1.1],
    [0.27, 1.34],
    [0.3, 1.44],
    [0.17, 1.52],
    [0, 1.53],
  ],
  queen: [
    [0, 0],
    [0.48, 0],
    [0.48, 0.1],
    [0.4, 0.16],
    [0.34, 0.24],
    [0.2, 0.42],
    [0.15, 0.9],
    [0.28, 0.95],
    [0.28, 1.0],
    [0.18, 1.04],
    [0.32, 1.32],
    [0.22, 1.36],
    [0, 1.36],
  ],
  rook: [
    [0, 0],
    [0.46, 0],
    [0.46, 0.1],
    [0.38, 0.18],
    [0.3, 0.3],
    [0.26, 0.78],
    [0.36, 0.86],
    [0.36, 1.1],
    [0, 1.1],
  ],
  knightBase: [
    [0, 0],
    [0.46, 0],
    [0.46, 0.1],
    [0.38, 0.18],
    [0.32, 0.3],
    [0, 0.31],
  ],
  checker: [
    [0, 0],
    [0.5, 0],
    [0.54, 0.03],
    [0.55, 0.08],
    [0.54, 0.13],
    [0.5, 0.16],
    [0.38, 0.16],
    [0.35, 0.13],
    [0.31, 0.16],
    [0, 0.16],
  ],
  draught: [
    [0, 0],
    [0.5, 0],
    [0.53, 0.04],
    [0.53, 0.15],
    [0.49, 0.19],
    [0.41, 0.19],
    [0.39, 0.15],
    [0.31, 0.19],
    [0.23, 0.15],
    [0, 0.17],
  ],
};

function knightHead() {
  const s = new Shape();
  s.moveTo(-0.28, 0);
  s.lineTo(0.3, 0);
  s.lineTo(0.32, 0.35);
  s.quadraticCurveTo(0.34, 0.78, 0.1, 1.0);
  s.lineTo(0.05, 1.14);
  s.lineTo(-0.04, 1.0);
  s.quadraticCurveTo(-0.22, 0.97, -0.34, 0.8);
  s.lineTo(-0.44, 0.6);
  s.quadraticCurveTo(-0.46, 0.5, -0.36, 0.5);
  s.lineTo(-0.12, 0.56);
  s.quadraticCurveTo(-0.1, 0.38, -0.28, 0.22);
  s.closePath();
  const g = new ExtrudeGeometry(s, { depth: 0.26, bevelEnabled: true, bevelThickness: 0.06, bevelSize: 0.05, bevelSegments: 3, curveSegments: 16 });
  g.translate(0, 0, -0.13);
  return g;
}

export function mountArena(host: HTMLElement, opts: { still: boolean }): () => void {
  const small = host.clientWidth < 720;
  const renderer = new WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, small ? 1.5 : 1.75));
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.setClearColor(0x000000, 0);
  host.appendChild(renderer.domElement);

  const scene = new Scene();
  const pmrem = new PMREMGenerator(renderer);
  const env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environment = env;
  scene.environmentIntensity = 0.55;

  const camera = new PerspectiveCamera(38, 1, 0.1, 100);

  scene.add(new AmbientLight(0x8fb4d8, 0.35));
  const key = new DirectionalLight(0xffe2b0, 2.4);
  key.position.set(5, 9, 6);
  scene.add(key);
  const mint = new PointLight(MINT, 40, 22, 1.6);
  mint.position.set(-6, 3.5, -1);
  scene.add(mint);
  const violet = new PointLight(0x9db7ff, 28, 22, 1.6);
  violet.position.set(6, 2.5, -4);
  scene.add(violet);
  const under = new PointLight(MINT, 12, 9, 1.4);
  under.position.set(0, 3.2, 0);
  scene.add(under);

  // ---- Materials --------------------------------------------------------------------------------
  const ivory = new MeshPhysicalMaterial({ color: IVORY, roughness: 0.32, clearcoat: 0.6, clearcoatRoughness: 0.25 });
  const ebony = new MeshPhysicalMaterial({ color: EBONY, roughness: 0.22, metalness: 0.1, clearcoat: 1, clearcoatRoughness: 0.15 });
  const mahogany = new MeshPhysicalMaterial({ color: 0x8a2d20, roughness: 0.3, clearcoat: 0.8 });
  const red = new MeshPhysicalMaterial({ color: 0xc23b2e, roughness: 0.35, clearcoat: 0.7 });
  const wood = new MeshStandardMaterial({ color: 0x6b4423, roughness: 0.6 });
  const goldMetal = new MeshStandardMaterial({ color: GOLD, metalness: 0.9, roughness: 0.25 });

  // ---- The platform -------------------------------------------------------------------------------
  const platform = new Group();
  scene.add(platform);
  const base = new Mesh(new CylinderGeometry(6.4, 6.8, 0.4, 96), new MeshStandardMaterial({ color: 0x0d1828, metalness: 0.4, roughness: 0.55 }));
  base.position.y = -0.2;
  platform.add(base);
  const topTex = arenaTop();
  const top = new Mesh(
    new CircleGeometry(6.4, 96),
    new MeshStandardMaterial({ map: topTex, emissiveMap: topTex, emissive: 0xffffff, emissiveIntensity: 0.35, roughness: 0.5, metalness: 0.2 }),
  );
  top.rotation.x = -Math.PI / 2;
  top.position.y = 0.001;
  platform.add(top);
  const rim = new Mesh(new TorusGeometry(6.45, 0.045, 12, 220), new MeshBasicMaterial({ color: MINT }));
  rim.rotation.x = Math.PI / 2;
  platform.add(rim);
  const rim2 = new Mesh(new TorusGeometry(6.78, 0.025, 8, 220), new MeshBasicMaterial({ color: GOLD, transparent: true, opacity: 0.7 }));
  rim2.rotation.x = Math.PI / 2;
  rim2.position.y = -0.4;
  platform.add(rim2);

  const glowTex = glowTexture();
  const halo = new Mesh(
    new PlaneGeometry(22, 22),
    new MeshBasicMaterial({ map: glowTex, color: MINT, transparent: true, opacity: 0.32, blending: AdditiveBlending, depthWrite: false }),
  );
  halo.rotation.x = -Math.PI / 2;
  halo.position.y = -0.45;
  scene.add(halo);
  const beam = new Mesh(
    new CylinderGeometry(1.1, 1.6, 7, 48, 1, true),
    new MeshBasicMaterial({
      map: beamTexture(),
      color: MINT,
      transparent: true,
      opacity: 0.22,
      blending: AdditiveBlending,
      depthWrite: false,
      side: DoubleSide,
    }),
  );
  beam.position.y = 3.5;
  scene.add(beam);

  // ---- Pieces standing on the platform ----------------------------------------------------------
  const standing: { obj: Object3D; delay: number }[] = [];
  const place = (obj: Object3D, r: number, deg: number, delay: number) => {
    const a = (deg * Math.PI) / 180;
    obj.position.set(Math.cos(a) * r, 0, Math.sin(a) * r);
    platform.add(obj);
    standing.push({ obj, delay });
  };
  const piece = (profile: string, mat: Material, scale = 1) => {
    const m = new Mesh(lathe(PROFILES[profile]), mat);
    m.scale.setScalar(scale);
    return m;
  };

  const king = new Group();
  king.add(piece("king", ivory));
  const crossV = new Mesh(new BoxGeometry(0.09, 0.36, 0.09), ivory);
  crossV.position.y = 1.7;
  const crossH = new Mesh(new BoxGeometry(0.28, 0.09, 0.09), ivory);
  crossH.position.y = 1.74;
  king.add(crossV, crossH);
  king.scale.setScalar(1.35);
  place(king, 3.0, 205, 0.1);

  const queen = new Group();
  queen.add(piece("queen", ebony));
  const orb = new Mesh(new SphereGeometry(0.11, 20, 16), ebony);
  orb.position.y = 1.46;
  queen.add(orb);
  for (let i = 0; i < 8; i++) {
    const b = new Mesh(new SphereGeometry(0.055, 12, 10), ebony);
    const a = (i / 8) * Math.PI * 2;
    b.position.set(Math.cos(a) * 0.28, 1.35, Math.sin(a) * 0.28);
    queen.add(b);
  }
  queen.scale.setScalar(1.3);
  place(queen, 3.9, 222, 0.2);

  const knight = new Group();
  knight.add(piece("knightBase", ivory));
  const head = new Mesh(knightHead(), ivory);
  head.position.y = 0.28;
  knight.add(head);
  knight.scale.setScalar(1.25);
  knight.rotation.y = 0.9;
  place(knight, 2.4, 245, 0.3);

  const rook = new Group();
  rook.add(piece("rook", ebony));
  for (let i = 0; i < 6; i++) {
    const m = new Mesh(new BoxGeometry(0.15, 0.16, 0.12), ebony);
    const a = (i / 6) * Math.PI * 2;
    m.position.set(Math.cos(a) * 0.29, 1.18, Math.sin(a) * 0.29);
    m.rotation.y = -a;
    rook.add(m);
  }
  rook.scale.setScalar(1.2);
  place(rook, 4.6, 196, 0.25);
  for (const [r, d, mat] of [
    [4.9, 232, ebony],
    [3.4, 258, ivory],
  ] as const) {
    const pawn = new Group();
    pawn.add(piece("pawn", mat));
    const h = new Mesh(new SphereGeometry(0.2, 24, 18), mat);
    h.position.y = 0.84;
    pawn.add(h);
    pawn.scale.setScalar(1.1);
    place(pawn, r, d, 0.35);
  }

  // Backgammon checkers: an ivory stack, a mahogany stack and a lone blot.
  const stack = (mat: Material, n: number) => {
    const g = new Group();
    for (let i = 0; i < n; i++) {
      const c = piece("checker", mat, 1.05);
      c.position.y = i * 0.17;
      c.rotation.y = i;
      g.add(c);
    }
    return g;
  };
  place(stack(ivory, 5), 3.3, 318, 0.4);
  place(stack(mahogany, 3), 4.3, 334, 0.45);
  place(stack(mahogany, 1), 2.6, 296, 0.5);

  // Draughts: a crowned red king and a black man.
  const crowned = new Group();
  for (let i = 0; i < 2; i++) {
    const c = piece("draught", red, 1.05);
    c.position.y = i * 0.2;
    crowned.add(c);
  }
  place(crowned, 3.8, 52, 0.55);
  place(piece("draught", ebony, 1.05), 4.6, 72, 0.6);

  // Cribbage: a board with pegs.
  const crib = new Group();
  const cribTex = cribbageTop();
  const plain = wood;
  const board = new Mesh(new RoundedBoxGeometry(2.6, 0.2, 0.8, 3, 0.06), [
    plain,
    plain,
    new MeshStandardMaterial({ map: cribTex, roughness: 0.6 }),
    plain,
    plain,
    plain,
  ]);
  board.position.y = 0.1;
  crib.add(board);
  for (const [x, z, color] of [
    [-0.6, -0.12, 0xc23b2e],
    [0.3, 0, 0x4f7bd9],
    [0.9, 0.12, MINT],
  ] as const) {
    const pegMat = new MeshPhysicalMaterial({ color, roughness: 0.3, clearcoat: 0.6 });
    const stem = new Mesh(new CylinderGeometry(0.04, 0.04, 0.32, 12), pegMat);
    stem.position.set(x, 0.36, z);
    const knob = new Mesh(new SphereGeometry(0.075, 16, 12), pegMat);
    knob.position.set(x, 0.53, z);
    crib.add(stem, knob);
  }
  crib.rotation.y = -1.1;
  place(crib, 3.6, 118, 0.65);

  // Poker chips.
  const chipMats = (color: string) => {
    const side = new MeshStandardMaterial({ map: chipSide(color), roughness: 0.45 });
    const face = new MeshStandardMaterial({ map: chipTop(color), roughness: 0.45 });
    return [side, face, face];
  };
  const chipGeo = new CylinderGeometry(0.48, 0.48, 0.1, 48);
  const chipsRed = chipMats("#b8322a");
  const chipsBlue = chipMats("#2e5fb8");
  const chipsMint = chipMats("#1f9e7c");
  const chipStack = (mats: Material[], n: number) => {
    const g = new Group();
    for (let i = 0; i < n; i++) {
      const c = new Mesh(chipGeo, mats);
      c.position.set((Math.random() - 0.5) * 0.04, 0.05 + i * 0.105, (Math.random() - 0.5) * 0.04);
      c.rotation.y = Math.random() * 6;
      g.add(c);
    }
    return g;
  };
  place(chipStack(chipsRed, 7), 4.4, 152, 0.7);
  place(chipStack(chipsBlue, 4), 3.4, 166, 0.75);
  place(chipStack(chipsMint, 5), 5.0, 170, 0.8);

  // A gold trophy at the back.
  const trophy = new Group();
  const cup = new Mesh(
    lathe([
      [0, 0],
      [0.36, 0],
      [0.36, 0.08],
      [0.12, 0.16],
      [0.08, 0.5],
      [0.14, 0.58],
      [0.42, 0.8],
      [0.5, 1.2],
      [0.46, 1.22],
      [0.38, 0.86],
      [0, 0.7],
    ]),
    goldMetal,
  );
  trophy.add(cup);
  for (const s of [-1, 1]) {
    const handle = new Mesh(new TorusGeometry(0.2, 0.04, 10, 24, Math.PI), goldMetal);
    handle.position.set(s * 0.5, 0.98, 0);
    handle.rotation.z = (s * -Math.PI) / 2;
    trophy.add(handle);
  }
  trophy.scale.setScalar(1.5);
  place(trophy, 4.6, 270, 0.15);

  // ---- Floating: dice, cards and chips ---------------------------------------------------------
  const floating: { obj: Object3D; base: [number, number, number]; bob: number; spin: [number, number]; delay: number }[] = [];
  const float = (obj: Object3D, base: [number, number, number], spin: [number, number], delay: number) => {
    obj.position.set(...base);
    scene.add(obj);
    floating.push({ obj, base, bob: Math.random() * Math.PI * 2, spin, delay });
  };
  // Opposite faces add up to seven: +x 3 / -x 4, +y 1 / -y 6, +z 2 / -z 5.
  const dieMats = [3, 4, 1, 6, 2, 5].map((n) => new MeshPhysicalMaterial({ map: dieFace(n), roughness: 0.28, clearcoat: 0.8, clearcoatRoughness: 0.2 }));
  const dieGeo = new RoundedBoxGeometry(1, 1, 1, 5, 0.14);
  const dieA = new Mesh(dieGeo, dieMats);
  const dieB = new Mesh(dieGeo, dieMats);
  dieA.scale.setScalar(1.05);
  dieB.scale.setScalar(0.95);
  float(dieA, [-0.7, 2.9, 1.2], [0.7, 0.5], 0.2);
  float(dieB, [0.8, 2.3, 1.9], [-0.55, 0.65], 0.3);

  const face = new MeshStandardMaterial({ map: cardFace(), roughness: 0.5 });
  const back = new MeshStandardMaterial({ map: cardBack(), roughness: 0.5 });
  const edge = new MeshStandardMaterial({ color: 0xf1ece0 });
  const cardGeo = new BoxGeometry(1.0, 1.4, 0.015);
  const cardA = new Mesh(cardGeo, [edge, edge, edge, edge, face, back]);
  const cardB = new Mesh(cardGeo, [edge, edge, edge, edge, face, back]);
  cardA.rotation.z = 0.25;
  cardB.rotation.z = -0.3;
  float(cardA, [-3.2, 3.6, -0.6], [0, 0.6], 0.5);
  float(cardB, [3.4, 3.9, -1.2], [0, -0.45], 0.6);
  const loose = new Mesh(chipGeo, chipsRed);
  loose.rotation.x = 1.1;
  float(loose, [2.4, 2.8, 1.0], [0.4, 0.9], 0.7);
  const loose2 = new Mesh(chipGeo, chipsMint);
  loose2.rotation.x = 0.7;
  float(loose2, [-2.3, 2.2, 1.6], [-0.5, 0.8], 0.8);

  // ---- Sparks ------------------------------------------------------------------------------------
  const count = small ? 160 : 360;
  const sparkPos = new Float32Array(count * 3);
  const sparkCol = new Float32Array(count * 3);
  const c1 = new Color(MINT);
  const c2 = new Color(GOLD);
  for (let i = 0; i < count; i++) {
    const r = 1 + Math.random() * 7.5;
    const a = Math.random() * Math.PI * 2;
    sparkPos.set([Math.cos(a) * r, Math.random() * 8, Math.sin(a) * r], i * 3);
    const c = Math.random() < 0.6 ? c1 : c2;
    sparkCol.set([c.r, c.g, c.b], i * 3);
  }
  const sparkGeo = new BufferGeometry();
  sparkGeo.setAttribute("position", new BufferAttribute(sparkPos, 3));
  sparkGeo.setAttribute("color", new BufferAttribute(sparkCol, 3));
  const sparks = new Points(
    sparkGeo,
    new PointsMaterial({ size: 0.09, map: glowTex, vertexColors: true, transparent: true, opacity: 0.85, blending: AdditiveBlending, depthWrite: false }),
  );
  scene.add(sparks);

  // ---- Layout, input and the loop ----------------------------------------------------------------
  let w = 1;
  let h = 1;
  let narrow = false;
  const resize = () => {
    w = Math.max(1, host.clientWidth);
    h = Math.max(1, host.clientHeight);
    narrow = w / h < 0.9;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    // Wide screens: the arena sits to the right of the headline. Phones: it rises above the text.
    if (narrow) camera.setViewOffset(w, h, 0, h * 0.23, w, h);
    else camera.setViewOffset(w, h, -w * (w / h > 1.3 ? 0.3 : 0.18), h * 0.04, w, h);
    camera.updateProjectionMatrix();
  };
  resize();

  const pointer = { x: 0, y: 0, tx: 0, ty: 0 };
  const onPointer = (e: PointerEvent) => {
    pointer.tx = (e.clientX / window.innerWidth) * 2 - 1;
    pointer.ty = (e.clientY / window.innerHeight) * 2 - 1;
  };
  window.addEventListener("pointermove", onPointer, { passive: true });

  let last = performance.now();
  const delta = () => {
    const now = performance.now();
    const d = (now - last) / 1000;
    last = now;
    return d;
  };
  let elapsed = opts.still ? 10 : 0;
  const easeOutBack = (x: number) => 1 + 2.2 * Math.pow(x - 1, 3) + 1.2 * Math.pow(x - 1, 2);

  const frame = (dt: number) => {
    elapsed += dt;
    const intro = (delay: number) => Math.min(1, Math.max(0, (elapsed - delay) / 1.1));
    const scroll = Math.min(1, window.scrollY / Math.max(1, h));
    pointer.x += (pointer.tx - pointer.x) * Math.min(1, dt * 3);
    pointer.y += (pointer.ty - pointer.y) * Math.min(1, dt * 3);

    const dolly = 1 - Math.min(1, elapsed / 2.4);
    const dist = (narrow ? 22 : 16) + dolly * dolly * 5 + scroll * 3;
    camera.position.set(pointer.x * 1.4, (narrow ? 7 : 5.4) - pointer.y * 0.6 + scroll * 2.5, dist);
    camera.lookAt(0, 1.3, 0);

    platform.rotation.y = elapsed * 0.06 + scroll * 1.2;
    for (const s of standing) {
      const k = intro(s.delay);
      s.obj.scale.setScalar(Math.max(0.0001, easeOutBack(k)) * (s.obj.userData.scale ?? 1));
    }
    for (const f of floating) {
      const k = intro(f.delay);
      f.obj.position.y = f.base[1] + Math.sin(elapsed * 1.2 + f.bob) * 0.18 + (1 - k) * 4;
      f.obj.rotation.x += f.spin[0] * dt;
      f.obj.rotation.y += f.spin[1] * dt;
    }
    const pos = sparkGeo.attributes.position as BufferAttribute;
    for (let i = 0; i < count; i++) {
      let y = pos.getY(i) + dt * (0.25 + (i % 7) * 0.05);
      if (y > 8) y = 0;
      pos.setY(i, y);
    }
    pos.needsUpdate = true;
    sparks.rotation.y = elapsed * 0.02;
    rim.material.color.setHSL(0.45, 0.68, 0.6 + Math.sin(elapsed * 2) * 0.08);
    (beam.material as MeshBasicMaterial).opacity = 0.18 + Math.sin(elapsed * 1.3) * 0.05;
    renderer.render(scene, camera);
  };
  // Each standing piece keeps its own scale for the intro to grow into.
  for (const s of standing) s.obj.userData.scale = s.obj.scale.x;

  let raf = 0;
  let visible = true;
  const loop = () => {
    raf = 0;
    if (!visible || document.hidden) return;
    frame(Math.min(0.05, delta()));
    raf = requestAnimationFrame(loop);
  };
  const play = () => {
    if (opts.still || raf) return;
    delta();
    raf = requestAnimationFrame(loop);
  };

  const ro = new ResizeObserver(() => {
    resize();
    if (opts.still) frame(0);
  });
  ro.observe(host);
  const io = new IntersectionObserver(([e]) => {
    visible = e.isIntersecting;
    if (visible) play();
  });
  io.observe(host);
  const onVisibility = () => !document.hidden && play();
  document.addEventListener("visibilitychange", onVisibility);

  if (opts.still) frame(0);
  else play();

  return () => {
    cancelAnimationFrame(raf);
    ro.disconnect();
    io.disconnect();
    window.removeEventListener("pointermove", onPointer);
    document.removeEventListener("visibilitychange", onVisibility);
    const textures = new Set<{ dispose(): void }>();
    scene.traverse((o) => {
      const m = o as Mesh;
      if (m.geometry) m.geometry.dispose();
      const mats = Array.isArray(m.material) ? m.material : m.material ? [m.material] : [];
      for (const mat of mats) {
        for (const v of Object.values(mat)) if (v && typeof v === "object" && "isTexture" in v) textures.add(v as { dispose(): void });
        mat.dispose();
      }
    });
    for (const t of textures) t.dispose();
    env.dispose();
    pmrem.dispose();
    renderer.dispose();
    renderer.domElement.remove();
  };
}
