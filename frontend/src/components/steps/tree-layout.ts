import type { TreeNode } from "@/lib/api";

// Pure layout for the hypothesis board: a left-to-right tidy tree.
//
// The classic issue-tree arrangement — leaves stack down a single column, and
// every parent centres on the block of its children. No dependency: at our caps
// (depth 3, four siblings) this is ~70 lines and completely deterministic, which
// also makes it measurable in the browser rather than eyeballed.

export const COL_GAP = 120; // horizontal space between columns, where arrows run
export const ROW_GAP = 26; // vertical space between sibling subtrees
export const PAD = 56; // breathing room around the whole tree

export const NODE_W: Record<string, number> = {
  objective: 320,
  branch: 250,
  initiative: 268,
};

export const NODE_H: Record<string, number> = {
  objective: 116,
  branch: 88,
  initiative: 132,
};

export interface LaidNode {
  node: TreeNode;
  id: number;
  depth: number;
  /** Left edge. */
  x: number;
  /** Vertical CENTRE — parents centre on their children, so a centre is the
   *  natural anchor and it is what the edge endpoints use. */
  y: number;
  w: number;
  h: number;
  childIds: number[];
}

export interface Edge {
  from: number;
  to: number;
  d: string;
}

export interface Layout {
  nodes: LaidNode[];
  byId: Map<number, LaidNode>;
  edges: Edge[];
  /** id → [parent, grandparent, …, root]; drives the ancestor-path highlight. */
  ancestors: Map<number, number[]>;
  width: number;
  height: number;
}

/** The cubic bezier used by the other board-style views in the app, so every
 *  connector in the product has the same hand. */
export function edgePath(x1: number, y1: number, x2: number, y2: number): string {
  const mx = (x1 + x2) / 2;
  return `M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`;
}

export function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

const EMPTY: Layout = {
  nodes: [],
  byId: new Map(),
  edges: [],
  ancestors: new Map(),
  width: 0,
  height: 0,
};

export function layoutTree(nodes: TreeNode[]): Layout {
  if (!nodes.length) return EMPTY;

  const children = new Map<number | null, TreeNode[]>();
  for (const n of nodes) {
    const list = children.get(n.parent_id) ?? [];
    list.push(n);
    children.set(n.parent_id, list);
  }
  for (const list of children.values()) {
    list.sort((a, b) => a.sort_order - b.sort_order || a.id - b.id);
  }

  const roots = children.get(null) ?? [];
  if (!roots.length) return EMPTY;

  // Depth first, so column widths can account for mixed kinds at one depth —
  // an initiative hanging off a shallow branch sits in the same column as a
  // branch, and the column has to be wide enough for both.
  const depth = new Map<number, number>();
  const order: TreeNode[] = [];
  const walk = (n: TreeNode, d: number) => {
    depth.set(n.id, d);
    order.push(n);
    for (const c of children.get(n.id) ?? []) walk(c, d + 1);
  };
  for (const r of roots) walk(r, 0);

  const colWidth: number[] = [];
  for (const n of order) {
    const d = depth.get(n.id)!;
    colWidth[d] = Math.max(colWidth[d] ?? 0, NODE_W[n.kind] ?? 250);
  }
  const colX: number[] = [];
  for (let d = 0; d < colWidth.length; d++) {
    colX[d] = d === 0 ? PAD : colX[d - 1] + colWidth[d - 1] + COL_GAP;
  }

  const laid = new Map<number, LaidNode>();
  let cursorY = PAD;

  const shift = (id: number, dy: number) => {
    const item = laid.get(id);
    if (!item) return;
    item.y += dy;
    for (const c of item.childIds) shift(c, dy);
  };

  const place = (n: TreeNode): LaidNode => {
    const d = depth.get(n.id)!;
    const kids = children.get(n.id) ?? [];
    const h = NODE_H[n.kind] ?? 88;
    const w = NODE_W[n.kind] ?? 250;

    if (!kids.length) {
      const item: LaidNode = {
        node: n, id: n.id, depth: d, x: colX[d], y: cursorY + h / 2, w, h, childIds: [],
      };
      cursorY += h + ROW_GAP;
      laid.set(n.id, item);
      return item;
    }

    const placed = kids.map(place);
    const first = placed[0];
    const last = placed[placed.length - 1];
    const item: LaidNode = {
      node: n,
      id: n.id,
      depth: d,
      x: colX[d],
      y: (first.y + last.y) / 2,
      w,
      h,
      childIds: placed.map((p) => p.id),
    };

    // A tall parent between two short children would otherwise overflow its own
    // subtree band and collide with whatever sits above it. Push the children
    // down by half the deficit and re-centre — this is the one case a naive
    // "centre on children" layout gets wrong.
    const bandTop = first.y - first.h / 2;
    const bandBottom = last.y + last.h / 2;
    const deficit = h - (bandBottom - bandTop);
    if (deficit > 0) {
      for (const p of placed) shift(p.id, deficit / 2);
      item.y += deficit / 2;
      cursorY += deficit;
    }

    laid.set(n.id, item);
    return item;
  };

  for (const r of roots) place(r);

  const ancestors = new Map<number, number[]>();
  const parentOf = new Map<number, number | null>(nodes.map((n) => [n.id, n.parent_id]));
  for (const n of nodes) {
    const chain: number[] = [];
    let p = parentOf.get(n.id) ?? null;
    while (p !== null && laid.has(p)) {
      chain.push(p);
      p = parentOf.get(p) ?? null;
    }
    ancestors.set(n.id, chain);
  }

  const edges: Edge[] = [];
  for (const item of laid.values()) {
    for (const cid of item.childIds) {
      const child = laid.get(cid);
      if (!child) continue;
      edges.push({
        from: item.id,
        to: cid,
        d: edgePath(item.x + item.w, item.y, child.x, child.y),
      });
    }
  }

  const all = [...laid.values()];
  const width = Math.max(...all.map((n) => n.x + n.w)) + PAD;
  const height = Math.max(...all.map((n) => n.y + n.h / 2)) + PAD;

  return { nodes: all, byId: laid, edges, ancestors, width, height };
}
