import {
  Component, OnInit,
  ChangeDetectionStrategy, ChangeDetectorRef,
  CUSTOM_ELEMENTS_SCHEMA,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterModule } from '@angular/router';

import {
  SimulatorService, computeNextW, getNodeActions, NodeActions,
} from '../../../core/services/simulator.service';
import { DefaultParamsService } from '../../../core/services/default-params.service';
import { SimTreeComponent } from '../../../shared/components/sim-tree/sim-tree.component';
import {
  SimTree, SimNode, AdviseResponse, Suggestion,
} from '../../../shared/models/simulator.models';
import { WealthParams, SweepVariable, TierConfig } from '../../../shared/models/wealth.models';

@Component({
  selector:        'app-simulator',
  standalone:      true,
  schemas:         [CUSTOM_ELEMENTS_SCHEMA],
  imports:         [CommonModule, FormsModule, RouterModule, SimTreeComponent],
  changeDetection: ChangeDetectionStrategy.Default,
  styleUrls:       ['./simulator.component.scss'],
  templateUrl:     './simulator.component.html',
})
export class SimulatorComponent implements OnInit {

  // ---------------------------------------------------------------------------
  // Route / tier
  // ---------------------------------------------------------------------------
  tier!:       number;
  tierConfig!: TierConfig;
  tierPath!:   string;

  // ---------------------------------------------------------------------------
  // Setup
  // ---------------------------------------------------------------------------
  setupDone   = false;
  W0Input     = 500_000;
  setupParams!: Record<SweepVariable, number>;   // display scale

  // ---------------------------------------------------------------------------
  // Tree
  // ---------------------------------------------------------------------------
  tree!: SimTree;

  // ---------------------------------------------------------------------------
  // Selected node
  // ---------------------------------------------------------------------------
  selectedNode:   SimNode | null    = null;
  actions:        NodeActions | null = null;

  // Panel mode: 'step' | 'fork' | 'recalc' | null
  panelMode: 'step' | 'fork' | 'recalc' | null = null;

  // Parameters shown in the action panel (display scale)
  panelParams!: Record<SweepVariable, number>;

  // ---------------------------------------------------------------------------
  // Bankruptcy advice
  // ---------------------------------------------------------------------------
  advice:        AdviseResponse | null = null;
  adviceLoading  = false;

  // ---------------------------------------------------------------------------
  // Comparison table
  // ---------------------------------------------------------------------------
  tableRows:    { year: number; cols: (number | null)[] }[] = [];
  tableBranches: string[] = [];

  // ---------------------------------------------------------------------------
  // Display helpers
  // ---------------------------------------------------------------------------
  private readonly rawVars = new Set<string>(['C0', 'S0']);

  constructor(
    private route:    ActivatedRoute,
    private simSvc:   SimulatorService,
    private defaults: DefaultParamsService,
    private cdr:      ChangeDetectorRef,
  ) {}

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  ngOnInit(): void {
    this.tier       = Number(this.route.snapshot.queryParamMap.get('tier') ?? 2);
    const w0Param   = this.route.snapshot.queryParamMap.get('w0');
    if (w0Param) this.W0Input = Math.round(Number(w0Param));

    this.tierConfig  = this.defaults.tierConfigs[this.tier];
    this.tierPath    = `/deterministic/tier-${this.tier}`;
    this.setupParams = this.toDisplay({ ...this.defaults.defaultParams });
    this.panelParams = { ...this.setupParams };
  }

  // ---------------------------------------------------------------------------
  // Setup
  // ---------------------------------------------------------------------------

  startSimulation(): void {
    this.tree      = this.simSvc.createTree(this.W0Input);
    this.setupDone = true;
    this.selectNode(this.tree.nodes[this.tree.rootId]);
    this.rebuildTable();
    this.cdr.detectChanges();
  }

  // ---------------------------------------------------------------------------
  // Node selection
  // ---------------------------------------------------------------------------

  onNodeSelected(node: SimNode): void {
    this.selectNode(node);
  }

  private selectNode(node: SimNode): void {
    this.selectedNode = node;
    this.actions      = getNodeActions(node);
    this.advice       = null;
    this.panelMode    = null;

    // Pre-populate panel from incoming edge if available
    const inEdge = Object.values(this.tree.edges).find(e => e.toId === node.id);
    this.panelParams = inEdge
      ? this.toDisplay(inEdge.params)
      : { ...this.setupParams };

    if (node.bankrupt) this.fetchAdvice(node);
    this.cdr.detectChanges();
  }

  // ---------------------------------------------------------------------------
  // Panel actions
  // ---------------------------------------------------------------------------

  openPanel(mode: 'step' | 'fork' | 'recalc'): void {
    this.panelMode = mode;
    // For recalc, pre-populate from incoming edge params
    if (mode === 'recalc') {
      const inEdge = Object.values(this.tree.edges)
        .find(e => e.toId === this.selectedNode!.id);
      if (inEdge) this.panelParams = this.toDisplay(inEdge.params);
    }
    this.cdr.detectChanges();
  }

  closePanel(): void {
    this.panelMode = null;
    this.cdr.detectChanges();
  }

  confirmAction(): void {
    if (!this.selectedNode || !this.panelMode) return;
    const params = this.toDecimal(this.panelParams);

    switch (this.panelMode) {
      case 'step':
        this.tree = this.simSvc.step(this.tree, this.selectedNode.id, params, this.tier);
        // Select new leaf
        const newLeaf = Object.values(this.tree.nodes)
          .find(n => n.parentId === this.selectedNode!.id);
        if (newLeaf) this.selectNode(newLeaf);
        break;

      case 'fork':
        this.tree = this.simSvc.fork(this.tree, this.selectedNode.id, params, this.tier);
        // Select new fork node
        const forked = Object.values(this.tree.nodes)
          .find(n => n.parentId === this.selectedNode!.id &&
            !Object.values(this.tree.nodes)
              .some(x => x !== n && x.parentId === this.selectedNode!.id &&
                x.branchName === n.branchName));
        if (forked) this.selectNode(forked);
        break;

      case 'recalc':
        this.tree = this.simSvc.recalculate(
          this.tree, this.selectedNode.id, params, this.tier,
        );
        // Re-select same node with updated W
        this.selectNode(this.tree.nodes[this.selectedNode.id]);
        break;
    }

    this.panelMode = null;
    this.rebuildTable();
    this.cdr.detectChanges();
  }

  deleteSelected(): void {
    if (!this.selectedNode || !this.actions?.canDelete) return;
    this.tree         = this.simSvc.deleteSubtree(this.tree, this.selectedNode.id);
    this.selectedNode = null;
    this.actions      = null;
    this.panelMode    = null;
    this.rebuildTable();
    this.cdr.detectChanges();
  }

  // ---------------------------------------------------------------------------
  // Bankruptcy advice
  // ---------------------------------------------------------------------------

  private fetchAdvice(node: SimNode): void {
    const inEdge = Object.values(this.tree.edges).find(e => e.toId === node.id);
    if (!inEdge) return;
    this.adviceLoading = true;
    this.simSvc.advise({
      W_current: node.W,
      year:      node.year,
      params:    inEdge.params,
      tier:      this.tier,
    }).subscribe({
      next: (res) => {
        this.advice        = res;
        this.adviceLoading = false;
        this.cdr.detectChanges();
      },
      error: () => {
        this.adviceLoading = false;
        this.cdr.detectChanges();
      },
    });
  }

  applySuggestion(s: Suggestion): void {
    if (!this.panelParams) return;
    const isRate = !this.rawVars.has(s.variable);
    (this.panelParams as any)[s.variable] = isRate ? s.target : s.target;
    // Auto-open recalc/step panel with suggestion applied
    if (this.panelMode === null) this.panelMode = 'step';
    this.cdr.detectChanges();
  }

  // ---------------------------------------------------------------------------
  // Comparison table
  // ---------------------------------------------------------------------------

  private rebuildTable(): void {
    const nodes    = Object.values(this.tree.nodes);
    const maxYear  = Math.max(...nodes.map(n => n.year), 0);
    this.tableBranches = [...new Set(nodes.map(n => n.branchName))].sort();

    // For each branch, walk the full ancestor chain to fill in years
    // that belong to a parent branch. This means a branch forked at year 3
    // will still show W₀, Y1, Y2 from its ancestors.
    const lookup = new Map<string, Map<number, number>>();
    for (const b of this.tableBranches) lookup.set(b, new Map());

    // First pass: populate each node's own year on its own branch
    for (const n of nodes) {
      lookup.get(n.branchName)?.set(n.year, n.W);
    }

    // Second pass: for each branch, walk every leaf node's ancestor chain
    // and fill in years where the branch has no entry (inherited from parent branch)
    for (const b of this.tableBranches) {
      const branchNodes = nodes.filter(n => n.branchName === b);
      if (!branchNodes.length) continue;

      // Find the earliest node on this branch (smallest year)
      const earliest = branchNodes.reduce((a, x) => x.year < a.year ? x : a);

      // Walk up the ancestor chain from the earliest node
      let current: SimNode | null = earliest.parentId
        ? this.tree.nodes[earliest.parentId]
        : null;

      while (current) {
        // Only fill if this year isn't already set for this branch
        if (!lookup.get(b)?.has(current.year)) {
          lookup.get(b)?.set(current.year, current.W);
        }
        current = current.parentId ? this.tree.nodes[current.parentId] : null;
      }
    }

    this.tableRows = Array.from({ length: maxYear + 1 }, (_, y) => ({
      year: y,
      cols: this.tableBranches.map(b => lookup.get(b)?.get(y) ?? null),
    }));
  }

  // ---------------------------------------------------------------------------
  // CSV
  // ---------------------------------------------------------------------------

  exportCsv(): void {
    this.simSvc.downloadCsv(this.tree, `simulator-tier${this.tier}.csv`);
  }

  // ---------------------------------------------------------------------------
  // Conversion helpers
  // ---------------------------------------------------------------------------

  toDisplay(p: WealthParams): Record<SweepVariable, number> {
    return Object.fromEntries(
      Object.entries(p).map(([k, v]) =>
        this.rawVars.has(k) ? [k, v] : [k, +(v * 100).toPrecision(10)]
      )
    ) as Record<SweepVariable, number>;
  }

  toDecimal(d: Record<SweepVariable, number>): WealthParams {
    return Object.fromEntries(
      Object.entries(d).map(([k, v]) =>
        this.rawVars.has(k) ? [k, v] : [k, +(v / 100).toPrecision(10)]
      )
    ) as unknown as WealthParams;
  }

  // ---------------------------------------------------------------------------
  // Template helpers
  // ---------------------------------------------------------------------------

  get formVariables(): SweepVariable[] {
    const vars: SweepVariable[] = ['i', 'T', 'pi', 'C0'];
    if (this.tier >= 3) vars.push('S0', 'g');
    return vars;
  }

  getMeta(v: SweepVariable) { return this.defaults.variableMeta[v]; }

  getDisplayMin(v: SweepVariable): number {
    const m = this.defaults.variableMeta[v];
    return this.rawVars.has(v) ? m.min : +(m.min * 100).toPrecision(10);
  }

  getDisplayMax(v: SweepVariable): number {
    const m = this.defaults.variableMeta[v];
    return this.rawVars.has(v) ? m.max : +(m.max * 100).toPrecision(10);
  }

  getDisplayStep(v: SweepVariable): number {
    const m = this.defaults.variableMeta[v];
    return this.rawVars.has(v) ? m.step : +(m.step * 100).toPrecision(10);
  }

  formatW(w: number | null): string {
    if (w === null) return '—';
    return `$${Math.round(w).toLocaleString()}`;
  }

  panelTitle(): string {
    switch (this.panelMode) {
      case 'step':   return `Step to Year ${(this.selectedNode!.year + 1)}`;
      case 'fork':   return `Fork from ${this.selectedNode!.label}`;
      case 'recalc': return `Edit Year ${this.selectedNode!.year} parameters`;
      default:       return '';
    }
  }

  panelDescription(): string {
    switch (this.panelMode) {
      case 'step':
        return 'Set the parameters for the next year on this branch.';
      case 'fork':
        return 'Set the parameters for the first year of the new branch. The original branch is preserved.';
      case 'recalc':
        return 'Edit the parameters used to reach this node. All downstream nodes on all branches will be recomputed.';
      default:
        return '';
    }
  }

  confirmLabel(): string {
    switch (this.panelMode) {
      case 'step':   return '→ Add year';
      case 'fork':   return '⑂ Create branch';
      case 'recalc': return '↻ Recalculate';
      default:       return 'Confirm';
    }
  }
}