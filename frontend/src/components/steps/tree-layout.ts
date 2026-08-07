import type { TreeNode } from "@/lib/api";

// Pure layout for the hypothesis board: a top-down tidy tree.
//
// The objective sits at the top, each decomposition adds a row beneath it, and
// initiatives line up along the bottom — the way an issue tree is drawn on a
// wall. Leaves pack left to right and every parent centres over the block of
// its children. No dependency: at our caps this is ~80 lines and completely
// deterministic, which also makes it measurable in the browser.

export const SIBLING_GAP = 28; // horizontal space between neighbouring boxes
export const LEVEL_GAP = 88; // vertical space between rows, where the arrows run
export const PAD = 56; // breathing room around the whole tree

// Boxes are narrower than they would be in a left-to-right tree: top-down puts
// every leaf side by side, so width is the scarce dimension — ten initiatives
// across is what sets the zoom the whole board opens at.
export const NODE_W: Record<string, number> = {
  objective: 300,
  branch: 196,
  initiative: 208,
};

// Heights are measured from what the box's own content actually needs at these
// font sizes and clamps — 28px padding, 6px gaps, and the line boxes:
//   objective   15 eyebrow + 62 (3 lines @ 15px serif)              = 111
//   branch      15 eyebrow + 37 (2 lines @ 13.5px) + 17 fact count  = 109
//   initiative  54 (3 lines @ 13px) + 43 (badge row, may wrap)      = 131
// Undershooting these does not clip cleanly: the children are flex items, so
// the browser CRUSHES the text to fit and the clamp slices glyphs mid-line.
// The box markup pairs this with shrink-0 so text can never be squashed again.
export const NODE_H: Record<string, number> = {
  objective: 116,
  branch: 114,
  initiative: 136,
};

export interface LaidNode {
  node: TreeNode;
  id: number;
  depth: number;
  /** Horizontal CENTRE — parents centre over their children, so a centre is the
   *  natural anchor and it is what the edge endpoints use. */
  x: number;
  /** Top edge. */
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

/** The vertical cubic bezier connecting one row to the next: it leaves the
 *  parent straight down and arrives straight down into the child, so a fan of
 *  siblings reads as one splitting flow rather than a bundle of diagonals. */
export function edgePath(x1: number, y1: number, x2: number, y2: number): string {
  const my = (y1 + y2) / 2;
  return `M${x1},${y1} C${x1},${my} ${x2},${my} ${x2},${y2}`;
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

  // Depth first, so row heights can account for mixed kinds on one row — an
  // initiative hanging off a shallow branch shares a row with branches, and the
  // row has to be tall enough for both.
  const depth = new Map<number, number>();
  const order: TreeNode[] = [];
  const walk = (n: TreeNode, d: number) => {
    depth.set(n.id, d);
    order.push(n);
    for (const c of children.get(n.id) ?? []) walk(c, d + 1);
  };
  for (const r of roots) walk(r, 0);

  const rowHeight: number[] = [];
  for (const n of order) {
    const d = depth.get(n.id)!;
    rowHeight[d] = Math.max(rowHeight[d] ?? 0, NODE_H[n.kind] ?? 84);
  }
  const rowY: number[] = [];
  for (let d = 0; d < rowHeight.length; d++) {
    rowY[d] = d === 0 ? PAD : rowY[d - 1] + rowHeight[d - 1] + LEVEL_GAP;
  }

  const laid = new Map<number, LaidNode>();
  let cursorX = PAD;

  const shift = (id: number, dx: number) => {
    const item = laid.get(id);
    if (!item) return;
    item.x += dx;
    for (const c of item.childIds) shift(c, dx);
  };

  const place = (n: TreeNode): LaidNode => {
    const d = depth.get(n.id)!;
    const kids = children.get(n.id) ?? [];
    const w = NODE_W[n.kind] ?? 236;
    const h = NODE_H[n.kind] ?? 84;

    if (!kids.length) {
      const item: LaidNode = {
        node: n, id: n.id, depth: d, x: cursorX + w / 2, y: rowY[d], w, h, childIds: [],
      };
      cursorX += w + SIBLING_GAP;
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
      x: (first.x + last.x) / 2,
      y: rowY[d],
      w,
      h,
      childIds: placed.map((p) => p.id),
    };

    // A wide parent over two narrow children would otherwise overflow its own
    // subtree band and collide with whatever sits beside it. Push the children
    // right by half the deficit and re-centre — the one case a naive
    // "centre over children" layout gets wrong.
    const bandLeft = first.x - first.w / 2;
    const bandRight = last.x + last.w / 2;
    const deficit = w - (bandRight - bandLeft);
    if (deficit > 0) {
      for (const p of placed) shift(p.id, deficit / 2);
      item.x += deficit / 2;
      cursorX += deficit;
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
        d: edgePath(item.x, item.y + item.h, child.x, child.y),
      });
    }
  }

  const all = [...laid.values()];
  const width = Math.max(...all.map((n) => n.x + n.w / 2)) + PAD;
  const height = Math.max(...all.map((n) => n.y + n.h)) + PAD;

  return { nodes: all, byId: laid, edges, ancestors, width, height };
}
