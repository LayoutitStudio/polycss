import { useCallback, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  PolyCamera,
  PolyScene,
  PolyMesh,
  PolyOrbitControls,
  boxPolygons,
  conePolygons,
  cylinderPolygons,
  octahedronPolygons,
} from "@layoutit/polycss-react";
import type { Polygon, Vec3 } from "@layoutit/polycss-react";
import "./styles.css";

type Point = { x: number; y: number };
type Direction = "north" | "east" | "south" | "west";
type GameStatus = "playing" | "won" | "lost";

type Patrol = {
  id: string;
  path: Point[];
  color: string;
};

type Level = {
  name: string;
  rows: string[];
  player: Point;
  exit: Point;
  cores: Point[];
  patrols: Patrol[];
};

type Snapshot = {
  player: Point;
  collected: string[];
  moves: number;
  facing: Direction;
  status: GameStatus;
};

const LEVELS: Level[] = [
  {
    name: "Foundry",
    rows: [
      "#########",
      "#.......#",
      "#.###.#.#",
      "#...#...#",
      "#.#...#.#",
      "#.#.###.#",
      "#.......#",
      "#########",
    ],
    player: { x: 1, y: 6 },
    exit: { x: 7, y: 1 },
    cores: [
      { x: 3, y: 1 },
      { x: 5, y: 4 },
      { x: 2, y: 6 },
    ],
    patrols: [
      {
        id: "ember",
        color: "#ef476f",
        path: [
          { x: 5, y: 1 },
          { x: 6, y: 1 },
          { x: 7, y: 1 },
          { x: 7, y: 2 },
          { x: 7, y: 3 },
          { x: 6, y: 3 },
          { x: 5, y: 3 },
          { x: 5, y: 2 },
        ],
      },
    ],
  },
  {
    name: "Relay",
    rows: [
      "##########",
      "#........#",
      "#.####.#.#",
      "#....#.#.#",
      "####.#...#",
      "#....###.#",
      "#.#......#",
      "#...####.#",
      "#........#",
      "##########",
    ],
    player: { x: 1, y: 8 },
    exit: { x: 8, y: 1 },
    cores: [
      { x: 2, y: 1 },
      { x: 6, y: 3 },
      { x: 1, y: 5 },
      { x: 7, y: 8 },
    ],
    patrols: [
      {
        id: "spark",
        color: "#f9844a",
        path: [
          { x: 6, y: 1 },
          { x: 7, y: 1 },
          { x: 8, y: 1 },
          { x: 8, y: 2 },
          { x: 8, y: 3 },
          { x: 8, y: 4 },
        ],
      },
      {
        id: "pulse",
        color: "#9b5de5",
        path: [
          { x: 1, y: 1 },
          { x: 1, y: 2 },
          { x: 1, y: 3 },
          { x: 2, y: 3 },
          { x: 3, y: 3 },
        ],
      },
    ],
  },
];

const TILE_DARK = "#26353a";
const TILE_LIGHT = "#304145";
const TILE_EDGE = "#18262b";
const WALL_SIDE = "#4a5663";
const WALL_TOP = "#72808c";
const WALL_BACK = "#39434d";
const LAVA = "#f05d5e";
const EXIT_LOCKED = "#53605f";
const EXIT_OPEN = "#46b37b";
const PLAYER = "#28c2a0";
const PLAYER_FACE = "#f8f4dc";
const CORE = "#ffd166";

const DIRECTIONS: Record<Direction, Point> = {
  north: { x: 0, y: -1 },
  east: { x: 1, y: 0 },
  south: { x: 0, y: 1 },
  west: { x: -1, y: 0 },
};

const DIR_KEYS: Record<string, Direction> = {
  ArrowUp: "north",
  w: "north",
  W: "north",
  ArrowRight: "east",
  d: "east",
  D: "east",
  ArrowDown: "south",
  s: "south",
  S: "south",
  ArrowLeft: "west",
  a: "west",
  A: "west",
};

function pointKey(p: Point): string {
  return `${p.x},${p.y}`;
}

function samePoint(a: Point, b: Point): boolean {
  return a.x === b.x && a.y === b.y;
}

function makeInitialSnapshot(level: Level): Snapshot {
  return {
    player: level.player,
    collected: [],
    moves: 0,
    facing: "east",
    status: "playing",
  };
}

function patrolPosition(patrol: Patrol, turn: number): Point {
  if (patrol.path.length === 1) return patrol.path[0];
  const period = patrol.path.length * 2 - 2;
  const step = turn % period;
  return step < patrol.path.length
    ? patrol.path[step]
    : patrol.path[period - step];
}

function isWall(level: Level, p: Point): boolean {
  if (p.y < 0 || p.y >= level.rows.length) return true;
  if (p.x < 0 || p.x >= level.rows[p.y].length) return true;
  return level.rows[p.y][p.x] === "#";
}

function isHazard(level: Level, p: Point): boolean {
  return level.rows[p.y]?.[p.x] === "~";
}

function canStep(level: Level, p: Point, allCoresCollected: boolean): boolean {
  if (isWall(level, p)) return false;
  if (!allCoresCollected && samePoint(p, level.exit)) return false;
  return true;
}

function translatePolygons(polygons: Polygon[], dx: number, dy: number, dz = 0): Polygon[] {
  return polygons.map((polygon) => ({
    ...polygon,
    vertices: polygon.vertices.map((v): Vec3 => [v[0] + dx, v[1] + dy, v[2] + dz]),
  }));
}

function box(min: Vec3, max: Vec3, color: string, faces?: Parameters<typeof boxPolygons>[0]["faces"]): Polygon[] {
  return boxPolygons({ min, max, color, faces });
}

function tilePolygons(x: number, y: number, color: string): Polygon[] {
  return box(
    [x + 0.04, y + 0.04, -0.1],
    [x + 0.96, y + 0.96, 0],
    TILE_EDGE,
    {
      top: { color },
      bottom: false,
    },
  );
}

function wallPolygons(x: number, y: number): Polygon[] {
  return box(
    [x + 0.02, y + 0.02, 0],
    [x + 0.98, y + 0.98, 0.82],
    WALL_SIDE,
    {
      top: { color: WALL_TOP },
      back: { color: WALL_BACK },
      left: { color: WALL_BACK },
      bottom: false,
    },
  );
}

function exitPolygons(exit: Point, open: boolean): Polygon[] {
  const color = open ? EXIT_OPEN : EXIT_LOCKED;
  return [
    ...box(
      [exit.x + 0.18, exit.y + 0.18, 0.01],
      [exit.x + 0.82, exit.y + 0.82, 0.09],
      color,
      {
        top: { color: open ? "#72d89f" : "#6c7775" },
        bottom: false,
      },
    ),
    ...box(
      [exit.x + 0.34, exit.y + 0.34, 0.1],
      [exit.x + 0.66, exit.y + 0.66, 0.24],
      open ? "#d5ffe4" : "#394644",
      {
        bottom: false,
      },
    ),
  ];
}

function corePolygons(core: Point, index: number): Polygon[] {
  const zLift = index % 2 === 0 ? 0 : 0.05;
  return octahedronPolygons({
    center: [core.x + 0.5, core.y + 0.5, 0.46 + zLift],
    size: 0.23,
    color: CORE,
  });
}

function playerPolygons(player: Point, facing: Direction): Polygon[] {
  const cx = player.x + 0.5;
  const cy = player.y + 0.5;
  const nose = DIRECTIONS[facing];
  return [
    ...box(
      [cx - 0.27, cy - 0.27, 0.02],
      [cx + 0.27, cy + 0.27, 0.48],
      PLAYER,
      {
        top: { color: "#5ee1c5" },
        bottom: false,
      },
    ),
    ...box(
      [cx - 0.18, cy - 0.18, 0.5],
      [cx + 0.18, cy + 0.18, 0.76],
      "#5b7080",
      {
        front: { color: PLAYER_FACE },
        bottom: false,
      },
    ),
    ...box(
      [
        cx + nose.x * 0.24 - 0.08,
        cy + nose.y * 0.24 - 0.08,
        0.36,
      ],
      [
        cx + nose.x * 0.24 + 0.08,
        cy + nose.y * 0.24 + 0.08,
        0.55,
      ],
      PLAYER_FACE,
      { bottom: false },
    ),
  ];
}

function patrolPolygons(point: Point, color: string): Polygon[] {
  const base = cylinderPolygons({
    radius: 0.24,
    height: 0.34,
    radialSegments: 6,
    color,
  });
  const eye = conePolygons({
    radius: 0.18,
    height: 0.38,
    radialSegments: 6,
    color: "#f8f4dc",
  });
  return [
    ...translatePolygons(base, point.x + 0.5, point.y + 0.5, 0.22),
    ...translatePolygons(eye, point.x + 0.5, point.y + 0.5, 0.62),
  ];
}

function makeStaticPolygons(level: Level): Polygon[] {
  const polygons: Polygon[] = [];
  for (let y = 0; y < level.rows.length; y++) {
    const row = level.rows[y];
    for (let x = 0; x < row.length; x++) {
      const cell = row[x];
      if (cell === "#") {
        polygons.push(...wallPolygons(x, y));
      } else {
        const checker = (x + y) % 2 === 0 ? TILE_LIGHT : TILE_DARK;
        polygons.push(...tilePolygons(x, y, cell === "~" ? LAVA : checker));
      }
    }
  }
  return polygons;
}

function levelBounds(level: Level): { width: number; height: number; center: Vec3 } {
  const width = Math.max(...level.rows.map((row) => row.length));
  const height = level.rows.length;
  return {
    width,
    height,
    center: [width / 2, height / 2, 0],
  };
}

function readBest(levelName: string): number | null {
  try {
    const value = window.localStorage.getItem(`polycss-core-runner:${levelName}`);
    if (!value) return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function writeBest(levelName: string, moves: number): void {
  try {
    window.localStorage.setItem(`polycss-core-runner:${levelName}`, String(moves));
  } catch {
    /* ignore storage failures */
  }
}

function useViewportWidth(): number {
  const [width, setWidth] = useState(() => window.innerWidth);

  useEffect(() => {
    const onResize = () => setWidth(window.innerWidth);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  return width;
}

function App() {
  const [levelIndex, setLevelIndex] = useState(0);
  const level = LEVELS[levelIndex];
  const [snapshot, setSnapshot] = useState(() => makeInitialSnapshot(level));
  const [history, setHistory] = useState<Snapshot[]>([]);
  const [best, setBest] = useState<number | null>(() => readBest(level.name));
  const viewportWidth = useViewportWidth();

  const allCoresCollected = snapshot.collected.length === level.cores.length;
  const bounds = useMemo(() => levelBounds(level), [level]);
  const staticPolygons = useMemo(() => makeStaticPolygons(level), [level]);
  const cameraZoom = useMemo(() => {
    if (viewportWidth <= 520) return bounds.width > 9 ? 0.52 : 0.58;
    if (viewportWidth <= 820) return bounds.width > 9 ? 0.62 : 0.72;
    return bounds.width > 9 ? 0.82 : 0.95;
  }, [bounds.width, viewportWidth]);

  const patrols = useMemo(
    () => level.patrols.map((patrol) => ({
      ...patrol,
      point: patrolPosition(patrol, snapshot.moves),
    })),
    [level, snapshot.moves],
  );

  const collectedSet = useMemo(() => new Set(snapshot.collected), [snapshot.collected]);
  const activeCores = useMemo(
    () => level.cores.filter((core) => !collectedSet.has(pointKey(core))),
    [level.cores, collectedSet],
  );

  const resetLevel = useCallback((nextLevel = levelIndex) => {
    const next = LEVELS[nextLevel];
    setLevelIndex(nextLevel);
    setSnapshot(makeInitialSnapshot(next));
    setHistory([]);
    setBest(readBest(next.name));
  }, [levelIndex]);

  const move = useCallback((direction: Direction) => {
    if (snapshot.status !== "playing") return;

    const delta = DIRECTIONS[direction];
    const nextPlayer = {
      x: snapshot.player.x + delta.x,
      y: snapshot.player.y + delta.y,
    };
    const coresCollected = snapshot.collected.length === level.cores.length;
    if (!canStep(level, nextPlayer, coresCollected)) {
      setSnapshot({ ...snapshot, facing: direction });
      return;
    }

    const nextCollected = snapshot.collected.includes(pointKey(nextPlayer))
      ? snapshot.collected
      : level.cores.some((core) => samePoint(core, nextPlayer))
        ? [...snapshot.collected, pointKey(nextPlayer)]
        : snapshot.collected;
    const nextMoves = snapshot.moves + 1;
    const exitOpen = nextCollected.length === level.cores.length;
    const nextPatrols = level.patrols.map((patrol) => patrolPosition(patrol, nextMoves));
    const hitPatrol = nextPatrols.some((point) => samePoint(point, nextPlayer));
    const hitHazard = isHazard(level, nextPlayer);
    const status: GameStatus = hitPatrol || hitHazard
      ? "lost"
      : exitOpen && samePoint(nextPlayer, level.exit)
        ? "won"
        : "playing";

    const next: Snapshot = {
      player: nextPlayer,
      collected: nextCollected,
      moves: nextMoves,
      facing: direction,
      status,
    };
    setHistory((items) => [...items, snapshot]);
    setSnapshot(next);
    if (status === "won") {
      setBest((prev) => {
        if (prev !== null && prev <= nextMoves) return prev;
        writeBest(level.name, nextMoves);
        return nextMoves;
      });
    }
  }, [level, snapshot]);

  const undo = useCallback(() => {
    setHistory((items) => {
      if (items.length === 0) return items;
      const previous = items[items.length - 1];
      setSnapshot(previous);
      return items.slice(0, -1);
    });
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const direction = DIR_KEYS[event.key];
      if (direction) {
        event.preventDefault();
        move(direction);
      } else if (event.key === "r" || event.key === "R") {
        resetLevel();
      } else if (event.key === "z" || event.key === "Z") {
        undo();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [move, resetLevel, undo]);

  const statusText = snapshot.status === "won"
    ? "Clear"
    : snapshot.status === "lost"
      ? "Caught"
      : allCoresCollected
        ? "Exit open"
        : "Running";

  return (
    <main className="game-shell">
      <section className="viewport" aria-label="Core Runner playfield">
        <PolyCamera
          rotX={62}
          rotY={45}
          zoom={cameraZoom}
          target={bounds.center}
          className="polycss-game-camera"
        >
          <PolyOrbitControls drag wheel minZoom={0.58} maxZoom={1.55} />
          <PolyScene
            polygons={staticPolygons}
            directionalLight={{ direction: [0.45, -0.55, 0.75], color: "#ffffff", intensity: 0.9 }}
            ambientLight={{ color: "#e8f7ff", intensity: 0.35 }}
            textureLighting="dynamic"
            shadow={{ opacity: 0.18, lift: 0.02, maxExtend: 420 }}
          >
            <PolyMesh polygons={exitPolygons(level.exit, allCoresCollected)} castShadow={false} />
            {activeCores.map((core, index) => (
              <PolyMesh key={pointKey(core)} polygons={corePolygons(core, index)} castShadow />
            ))}
            {patrols.map((patrol) => (
              <PolyMesh key={patrol.id} polygons={patrolPolygons(patrol.point, patrol.color)} castShadow />
            ))}
            <PolyMesh polygons={playerPolygons(snapshot.player, snapshot.facing)} castShadow />
          </PolyScene>
        </PolyCamera>
      </section>

      <aside className="hud" aria-label="Game status">
        <div className="hud-heading">
          <div>
            <p className="eyebrow">Core Runner</p>
            <h1>{level.name}</h1>
          </div>
          <span className={`status status-${snapshot.status}`}>{statusText}</span>
        </div>

        <div className="metrics">
          <div>
            <span>Cores</span>
            <strong>{snapshot.collected.length}/{level.cores.length}</strong>
          </div>
          <div>
            <span>Moves</span>
            <strong>{snapshot.moves}</strong>
          </div>
          <div>
            <span>Best</span>
            <strong>{best ?? "-"}</strong>
          </div>
        </div>

        <div className="level-tabs" role="tablist" aria-label="Level">
          {LEVELS.map((item, index) => (
            <button
              key={item.name}
              type="button"
              className={index === levelIndex ? "active" : ""}
              onClick={() => resetLevel(index)}
            >
              {item.name}
            </button>
          ))}
        </div>

        <div className="control-pad" aria-label="Move">
          <button type="button" className="north" onClick={() => move("north")} aria-label="Move north" title="Move north">N</button>
          <button type="button" className="west" onClick={() => move("west")} aria-label="Move west" title="Move west">W</button>
          <button type="button" className="east" onClick={() => move("east")} aria-label="Move east" title="Move east">E</button>
          <button type="button" className="south" onClick={() => move("south")} aria-label="Move south" title="Move south">S</button>
        </div>

        <div className="actions">
          <button type="button" onClick={() => resetLevel()} title="Reset">Reset</button>
          <button type="button" onClick={undo} disabled={history.length === 0} title="Undo">Undo</button>
        </div>
      </aside>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
