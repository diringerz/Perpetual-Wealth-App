import {
  Component, OnInit, OnDestroy,
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  PLATFORM_ID,
  Inject,
  CUSTOM_ELEMENTS_SCHEMA,
} from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { Subscription } from 'rxjs';
import { WealthApiService } from '../../../core/services/wealth-api.service';
import { DefaultParamsService } from '../../../core/services/default-params.service';
import { SweepGraphComponent } from '../../../shared/components/sweep-graph/sweep-graph.component';
import {
  WealthParams, SolveResponse, TierConfig,
  SweepVariable, SweepRange, VariableMeta,
} from '../../../shared/models/wealth.models';

export interface RankedFactor {
  variable:       SweepVariable;
  label:          string;
  elasticity:     number;
  absElasticity:  number;
  normalizedRate: number;   // |dW0/dx| in per-percentage-point or per-dollar
  signedRate:     number;   // signed — for raw value sort
  direction:      'increases' | 'decreases';
  plain:          string;
}

@Component({
  selector:        'app-tier',
  standalone:      true,
  imports:         [CommonModule, FormsModule, SweepGraphComponent],
  changeDetection: ChangeDetectionStrategy.Default,
  styleUrls:       ['./tier.component.scss'],
  templateUrl:     './tier.component.html',
  schemas:         [CUSTOM_ELEMENTS_SCHEMA],
})
export class TierComponent implements OnInit, OnDestroy {

  tierConfig!: TierConfig;

  // Internal params in decimal form — what the API receives (e.g. 0.25)
  params!: WealthParams;

  // Display params scaled x100 for rate inputs (e.g. 25%).
  displayParams!: Record<SweepVariable, number>;

  // Frozen snapshot passed to child graphs.
  // Only set when the user explicitly clicks "Load graphs" or "Update graphs".
  graphSnapshot: WealthParams | null = null;

  // Controls whether the graphs section is rendered at all.
  graphsVisible = false;

  // Per-variable refresh triggers for subsequent updates after initial load.
  refreshTriggers: Record<string, number> = {};

  result:        SolveResponse | null = null;
  rankedFactors: RankedFactor[]       = [];
  loading        = false;
  error:         string | null        = null;

  welfareIndexed  = false;
  sortByMagnitude = true;   // true = largest absolute impact first, false = signed value

  sweepRanges!: Record<SweepVariable, SweepRange>;

  private solveSub?: Subscription;

  constructor(
    private route:    ActivatedRoute,
    private api:      WealthApiService,
    private defaults: DefaultParamsService,
    private cdr:      ChangeDetectorRef,
    @Inject(PLATFORM_ID) private platformId: object,
  ) {}

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  ngOnInit(): void {
    const tier      = this.route.snapshot.data['tier'] as number;
    this.tierConfig = this.defaults.tierConfigs[tier];

    if (!this.tierConfig) {
      this.error = `Tier ${tier} is not available.`;
      return;
    }

    this.params        = { ...this.defaults.defaultParams };
    this.sweepRanges   = { ...this.defaults.sweepRangeDefaults };
    this.displayParams = this.toDisplay(this.params);
    this.sweepVariables.forEach(v => this.refreshTriggers[v] = 0);

    if (isPlatformBrowser(this.platformId)) {
      this.solve();
    }
  }

  ngOnDestroy(): void {
    this.solveSub?.unsubscribe();
  }

  // ---------------------------------------------------------------------------
  // Effective params
  // ---------------------------------------------------------------------------

  get effectiveParams(): WealthParams {
    const base = this.toDecimal(this.displayParams);
    if (this.isTier3) {
      return { ...base, g: this.welfareIndexed ? base.pi : 0 };
    }
    return base;
  }

  // ---------------------------------------------------------------------------
  // Solve
  // ---------------------------------------------------------------------------

  solve(): void {
    this.solveSub?.unsubscribe();
    this.loading = true;
    this.error   = null;
    this.params  = this.effectiveParams;

    this.solveSub = this.api.solve({
      params:    this.params,
      t_horizon: this.defaults.defaultHorizon,
      tier:      this.tierConfig.tier,
    }).subscribe({
      next: (res) => {
        this.result        = res;
        this.rankedFactors = this.buildRankedFactors(res);
        this.loading       = false;
        this.cdr.detectChanges();
      },
      error: () => {
        this.error   = 'Failed to compute. Please check your parameters and try again.';
        this.loading = false;
        this.cdr.detectChanges();
      },
    });
  }

  loadGraphs(): void {
    this.graphSnapshot = { ...this.params };
    this.graphsVisible = true;
    this.sweepVariables.forEach(v => this.refreshTriggers[v] = 0);
  }

  updateGraphs(): void {
    if (!this.graphsVisible) {
      this.loadGraphs();
      return;
    }
    this.graphSnapshot = { ...this.params };
    this.sweepVariables.forEach((v, index) => {
      requestAnimationFrame(() => {
        setTimeout(() => {
          this.refreshTriggers = {
            ...this.refreshTriggers,
            [v]: (this.refreshTriggers[v] ?? 0) + 1,
          };
        }, index * 400);
      });
    });
  }

  onToggleWelfareIndexed(): void {
    this.welfareIndexed = !this.welfareIndexed;
    this.solve();
  }

  toggleSort(): void {
    this.sortByMagnitude = !this.sortByMagnitude;
    this.rankedFactors   = this.sortFactors([...this.rankedFactors]);
  }

  // ---------------------------------------------------------------------------
  // Ranked factors
  // ---------------------------------------------------------------------------

  private readonly isRate = (v: string) => !['C0', 'S0'].includes(v);

  private sortFactors(factors: RankedFactor[]): RankedFactor[] {
    return factors.sort((a, b) =>
      this.sortByMagnitude
        ? b.normalizedRate - a.normalizedRate   // largest absolute impact first
        : b.signedRate - a.signedRate           // most positive first
    );
  }

  private buildRankedFactors(res: SolveResponse): RankedFactor[] {
    if (!res.sensitivity?.length || !res.W0) return [];

    const factors = res.sensitivity
      .filter(s => isFinite(s.elasticity) && !isNaN(s.elasticity)
                   && Math.abs(s.elasticity) > 0.0001)
      .map(s => {
        const meta     = this.defaults.variableMeta[s.variable];
        const sens     = res.sensitivity.find(r => r.variable === s.variable)!;
        const currentX = this.params[s.variable as keyof WealthParams] as number;

        // Normalize to comparable units:
        // rate variables  → $ per percentage point (dW0/dx * 0.01)
        // dollar variables → $ per dollar (dW0/dx as-is)
        const signedRate     = this.isRate(s.variable) ? sens.dW0_dx * 0.01 : sens.dW0_dx;
        const normalizedRate = Math.abs(signedRate);
        const direction: 'increases' | 'decreases' = signedRate > 0 ? 'increases' : 'decreases';

        let rateOfChange: string;
        let unit: string;
        let atValue: string;

        if (this.isRate(s.variable)) {
          const sign   = signedRate >= 0 ? '+' : '-';
          rateOfChange = `${sign}$${Math.abs(Math.round(signedRate)).toLocaleString()}`;
          unit         = '1%';
          atValue      = `${(currentX * 100).toFixed(2)}%`;
        } else {
          const sign   = signedRate >= 0 ? '+' : '-';
          rateOfChange = `${sign}$${Math.abs(signedRate).toFixed(2)}`;
          unit         = '$1';
          atValue      = `$${Math.round(currentX).toLocaleString()}`;
        }

        const plain = `Rate of change is ${rateOfChange} / ${unit} `
                    + `when ${meta.label.toLowerCase()} = ${atValue} when all else is held constant.`;

        return {
          variable:       s.variable,
          label:          meta.label,
          elasticity:     s.elasticity,
          absElasticity:  Math.abs(s.elasticity),
          normalizedRate,
          signedRate,
          direction,
          plain,
        } as RankedFactor;
      });

    return this.sortFactors(factors);
  }

  // ---------------------------------------------------------------------------
  // Conversion helpers
  // ---------------------------------------------------------------------------

  private readonly rawVars = new Set<string>(['C0', 'S0']);

  private toDisplay(p: WealthParams): Record<SweepVariable, number> {
    return Object.fromEntries(
      Object.entries(p).map(([k, v]) =>
        this.rawVars.has(k)
          ? [k, v]
          : [k, +(v * 100).toPrecision(10)]
      )
    ) as Record<SweepVariable, number>;
  }

  private toDecimal(d: Record<SweepVariable, number>): WealthParams {
    return Object.fromEntries(
      Object.entries(d).map(([k, v]) =>
        this.rawVars.has(k)
          ? [k, v]
          : [k, +(v / 100).toPrecision(10)]
      )
    ) as unknown as WealthParams;
  }

  // ---------------------------------------------------------------------------
  // Getters
  // ---------------------------------------------------------------------------

  get isTier3(): boolean {
    return this.tierConfig?.tier === 3;
  }

  get formVariables(): SweepVariable[] {
    return this.isTier3
      ? this.tierConfig.variables.filter(v => v !== 'g')
      : this.tierConfig.variables;
  }

  get sweepVariables(): SweepVariable[] {
    return this.formVariables;
  }

  get effectiveGLabel(): string {
    if (this.welfareIndexed) {
      const pi = this.toDecimal(this.displayParams).pi;
      return `g = pi = ${(pi * 100).toFixed(2)}%`;
    }
    return 'g = 0 (fixed nominal welfare)';
  }

  get nearAsymptote(): boolean {
    if (!this.result || this.isInfeasible()) return false;
    return (this.result.r_real - this.params.pi) < 0.005
        && this.result.r_real > this.params.pi;
  }

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

  getMeta(v: SweepVariable): VariableMeta {
    return this.defaults.variableMeta[v];
  }

  getSweepRange(v: SweepVariable): SweepRange {
    return this.sweepRanges[v];
  }

  formatW0(val: number | null): string {
    if (val === null) return 'N/A';
    return `$${Math.round(val).toLocaleString()}`;
  }

  formatPercent(val: number): string {
    return `${(val * 100).toFixed(4)}%`;
  }

  isInfeasible(): boolean {
    return this.result?.edge_case === 'infeasible'
      || this.result?.edge_case === 'r_equals_pi'
      || this.result?.edge_case === 'full_taxation';
  }

  edgeCaseMessage(): string | null {
    switch (this.result?.edge_case) {
      case 'infeasible':
        return 'Your real return rate is below inflation. No finite initial wealth can sustain perpetual solvency.';
      case 'r_equals_pi':
        return 'Your real return rate exactly equals inflation. Required wealth diverges to infinity.';
      case 'full_taxation':
        return 'A tax rate of 100% eliminates all investment income. Perpetual wealth is impossible.';
      case 'welfare_covers_all':
        return 'Your after-tax welfare income fully covers consumption. No initial wealth is required.';
      case 'r_equals_g':
        return 'Welfare growth rate equals the real return rate — the system is at a singularity boundary.';
      default:
        return null;
    }
  }

  trackByVar(_index: number, v: SweepVariable): string {
    return v;
  }
}