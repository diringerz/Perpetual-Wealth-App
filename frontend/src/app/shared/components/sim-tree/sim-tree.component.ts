import {
  Component, Input, Output, EventEmitter,
  OnChanges, SimpleChanges,
  ChangeDetectionStrategy, ChangeDetectorRef,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { SimTree, SimNode, SimEdge, LayoutNode, LayoutEdge } from '../../models/simulator.models';
import { DefaultParamsService } from '../../../core/services/default-params.service';

const NODE_R  = 38;
const H_GAP   = 180;
const V_GAP   = 96;
const PAD     = 64;
const AXIS_H  = 28;

// One colour per branch (cycling)
const BRANCH_COLORS = [
  '#4f8ef7', '#10b981', '#f59e0b', '#8b5cf6',
  '#ef4444', '#ec4899', '#06b6d4', '#84cc16',
];

@Component({
  selector:        'app-sim-tree',
  standalone:      true,
  imports:         [CommonModule],
  changeDetection: ChangeDetectionStrategy.Default,
  styleUrls:       ['./sim-tree.component.scss'],
  template: `
<div class="tree-scroll" #scrollEl>
  <svg [attr.width]="svgW" [attr.height]="svgH" class="tree-svg">

    <defs>
      <marker *ngFor="let c of usedColors; let i = index"
        [attr.id]="'arrow-' + i"
        markerWidth="8" markerHeight="8" refX="7" refY="3" orient="auto">
        <path d="M0,0 L0,6 L8,3 z" [attr.fill]="c" />
      </marker>
    </defs>

    <!-- Year axis -->
    <g class="axis">
      <text *ngFor="let y of yearLabels"
        [attr.x]="xOf(y)" [attr.y]="AXIS_H / 2"
        class="axis-label">t={{ y }}</text>
    </g>

    <!-- Edges -->
    <g *ngFor="let le of layoutEdges"
       class="edge-g"
       (mouseenter)="showTip($event, le)"
       (mouseleave)="hideTip()">
      <path [attr.d]="edgePath(le)"
            [attr.stroke]="le.color"
            [attr.marker-end]="'url(#arrow-' + le.colorIdx + ')'"
            class="edge-line" />
      <!-- wide invisible hit zone -->
      <path [attr.d]="edgePath(le)" class="edge-hit" />
    </g>

    <!-- Nodes -->
    <g *ngFor="let ln of layoutNodes"
       class="node-g"
       [class.node-g--selected]="selectedId === ln.node.id"
       [class.node-g--bankrupt]="ln.node.bankrupt"
       (click)="nodeClick(ln.node)">
      <circle [attr.cx]="ln.x" [attr.cy]="ln.y" [attr.r]="NODE_R"
              [attr.stroke]="branchColor(ln.node.branchName)"
              class="node-circle" />
      <text [attr.x]="ln.x" [attr.y]="ln.y - 8" class="node-w">
        {{ fmt(ln.node.W) }}
      </text>
      <text [attr.x]="ln.x" [attr.y]="ln.y + 10" class="node-lbl">
        {{ ln.node.label }}
      </text>
      <text *ngIf="ln.node.bankrupt"
            [attr.x]="ln.x" [attr.y]="ln.y + 26" class="node-warn">⚠</text>
    </g>

  </svg>

  <!-- Edge tooltip -->
  <div class="tip" *ngIf="tip"
       [style.left.px]="tip.x" [style.top.px]="tip.y">
    <div class="tip-row" *ngFor="let r of tip.rows">
      <span class="tip-k">{{ r.k }}</span>
      <span class="tip-v">{{ r.v }}</span>
    </div>
  </div>
</div>
  `,
})
export class SimTreeComponent implements OnChanges {

  @Input()  tree!:       SimTree;
  @Input()  selectedId:  string | null = null;
  @Output() nodeSelected = new EventEmitter<SimNode>();

  readonly NODE_R  = NODE_R;
  readonly AXIS_H  = AXIS_H;

  layoutNodes: LayoutNode[]  = [];
  layoutEdges: LayoutEdge[]  = [];
  svgW = 400;
  svgH = 200;
  yearLabels: number[]       = [];
  usedColors: string[]       = [];

  tip: { x: number; y: number; rows: { k: string; v: string }[] } | null = null;

  // branch → colour index
  private branchColorMap = new Map<string, number>();

  constructor(
    private defaults: DefaultParamsService,
    private cdr: ChangeDetectorRef,
  ) {}

  ngOnChanges(c: SimpleChanges): void {
    if (c['tree'] && this.tree) this.layout();
  }

  // ---------------------------------------------------------------------------
  // Layout
  // ---------------------------------------------------------------------------

  private layout(): void {
    const nodes   = Object.values(this.tree.nodes);
    const maxYear = Math.max(...nodes.map(n => n.year), 0);

    // ── Assign branch colours via BFS (Main = colour 0) ────────────────────
    this.branchColorMap.clear();
    let colorCounter = 0;
    const bfsVisited = new Set<string>();
    const bfsQ = [this.tree.rootId];
    while (bfsQ.length) {
      const id   = bfsQ.shift()!;
      const node = this.tree.nodes[id];
      if (bfsVisited.has(id)) continue;
      bfsVisited.add(id);
      if (!this.branchColorMap.has(node.branchName)) {
        this.branchColorMap.set(node.branchName, colorCounter++ % BRANCH_COLORS.length);
      }
      bfsQ.push(...node.childIds);
    }
    this.usedColors = [...this.branchColorMap.values()].map(i => BRANCH_COLORS[i]);

    // ── Reingold-Tilford layout ─────────────────────────────────────────────
    // Pass 1 (post-order): assign each leaf a unique contiguous y-slot.
    //   Internal nodes get the average y of their children.
    //   This ensures children are always contiguous and parents are centred —
    //   the defining property that eliminates crossings in tree layouts.

    const yPos   = new Map<string, number>();
    let   ySlot  = 0;

    const assignY = (nodeId: string): number => {
      const node = this.tree.nodes[nodeId];

      if (node.childIds.length === 0) {
        // Leaf — claim the next slot
        const slot = ySlot++;
        yPos.set(nodeId, slot);
        return slot;
      }

      // Internal node — recurse into children first, then centre
      const childSlots = node.childIds.map(cid => assignY(cid));
      const centre = (childSlots[0] + childSlots[childSlots.length - 1]) / 2;
      yPos.set(nodeId, centre);
      return centre;
    };

    assignY(this.tree.rootId);

    // Convert slots to pixel y-coordinates
    const pos = new Map<string, { x: number; y: number }>();
    for (const n of nodes) {
      const slot = yPos.get(n.id) ?? 0;
      pos.set(n.id, {
        x: PAD + n.year * H_GAP + NODE_R,
        y: AXIS_H + PAD + slot * V_GAP + NODE_R,
      });
    }

    this.layoutNodes = nodes.map(n => ({ node: n, ...pos.get(n.id)! }));

    this.layoutEdges = Object.values(this.tree.edges).map(edge => {
      const from     = pos.get(edge.fromId)!;
      const to       = pos.get(edge.toId)!;
      const toNode   = this.tree.nodes[edge.toId];
      const colorIdx = this.branchColorMap.get(toNode.branchName) ?? 0;
      return {
        edge,
        x1: from.x, y1: from.y,
        x2: to.x,   y2: to.y,
        label:    '',
        color:    BRANCH_COLORS[colorIdx],
        colorIdx,
      };
    });

    this.yearLabels = Array.from({ length: maxYear + 1 }, (_, i) => i);

    const maxX = Math.max(...this.layoutNodes.map(ln => ln.x), 0) + NODE_R + PAD;
    const maxY = Math.max(...this.layoutNodes.map(ln => ln.y), 0) + NODE_R + PAD;
    this.svgW  = Math.max(maxX, 360);
    this.svgH  = Math.max(maxY, 160);

    this.cdr.detectChanges();
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  xOf(year: number): number {
    return PAD + year * H_GAP + NODE_R;
  }

  edgePath(le: LayoutEdge): string {
    const dx = (le.x2 - le.x1) * 0.45;
    return `M${le.x1 + NODE_R} ${le.y1}`
         + ` C${le.x1 + NODE_R + dx} ${le.y1}`
         + ` ${le.x2 - NODE_R - dx} ${le.y2}`
         + ` ${le.x2 - NODE_R} ${le.y2}`;
  }

  branchColor(branchName: string): string {
    const idx = this.branchColorMap.get(branchName) ?? 0;
    return BRANCH_COLORS[idx];
  }

  fmt(w: number): string {
    if (Math.abs(w) >= 1_000_000) return `$${(w / 1_000_000).toFixed(1)}M`;
    if (Math.abs(w) >= 1_000)     return `$${(w / 1_000).toFixed(0)}k`;
    return `$${w.toFixed(0)}`;
  }

  nodeClick(node: SimNode): void {
    this.nodeSelected.emit(node);
  }

  showTip(event: MouseEvent, le: LayoutEdge): void {
    const rect = (event.currentTarget as Element)
      .closest('.tree-scroll')!.getBoundingClientRect();
    const p    = le.edge.params;
    const meta = this.defaults.variableMeta;
    const rows = [
      { k: meta['i'].label,  v: meta['i'].formatFn(p.i) },
      { k: meta['T'].label,  v: meta['T'].formatFn(p.T) },
      { k: meta['pi'].label, v: meta['pi'].formatFn(p.pi) },
      { k: meta['C0'].label, v: meta['C0'].formatFn(p.C0) },
      ...(le.edge.tier >= 3 ? [
        { k: meta['S0'].label, v: meta['S0'].formatFn(p.S0) },
        { k: meta['g'].label,  v: meta['g'].formatFn(p.g) },
      ] : []),
    ];
    this.tip = { x: event.clientX - rect.left + 12, y: event.clientY - rect.top - 8, rows };
  }

  hideTip(): void { this.tip = null; }
}