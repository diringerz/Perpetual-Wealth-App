import {
  Component, OnInit,
  ChangeDetectionStrategy, ChangeDetectorRef, NgZone,
  CUSTOM_ELEMENTS_SCHEMA,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterModule } from '@angular/router';
import { BaseChartDirective } from 'ng2-charts';
import {
  Chart, ChartData, ChartOptions, ChartDataset,
  LinearScale, LineController, LineElement,
  PointElement, CategoryScale, Tooltip, Legend, Filler,
} from 'chart.js';

import { StochasticService } from '../../../core/services/stochastic.service';
import { DefaultParamsService } from '../../../core/services/default-params.service';
import {
  AnyDist, DistributionType, NormalDist, UniformDist, ExponentialDist, PoissonDist,
  VARIABLE_DISTS, DEFAULT_DISTS, DEFAULT_POISSON,
  StochasticResponse, FanChart,
} from '../../../shared/models/stochastic.models';
import { SweepVariable, TierConfig } from '../../../shared/models/wealth.models';

Chart.register(
  LinearScale, LineController, LineElement,
  PointElement, CategoryScale, Tooltip, Legend, Filler,
);

@Component({
  selector:        'app-stochastic-naive',
  standalone:      true,
  schemas:         [CUSTOM_ELEMENTS_SCHEMA],
  imports:         [CommonModule, FormsModule, RouterModule, BaseChartDirective],
  changeDetection: ChangeDetectionStrategy.Default,
  styleUrls:       ['./stochastic-naive.component.scss'],
  templateUrl:     './stochastic-naive.component.html',
})
export class StochasticNaiveComponent implements OnInit {

  // ---------------------------------------------------------------------------
  // Route / tier
  // ---------------------------------------------------------------------------
  tier!:       number;
  tierConfig!: TierConfig;
  tierPath!:        string;
  stochasticPath!:  string;

  // ---------------------------------------------------------------------------
  // Simulation config
  // ---------------------------------------------------------------------------
  W0:   number = 500_000;
  k:    number = 1_000;
  n:    number = 50;

  // Distribution config per variable — display scale for means
  dists: Record<string, AnyDist> = {};

  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------
  loading  = false;
  error:   string | null = null;
  result:  StochasticResponse | null = null;

  // ---------------------------------------------------------------------------
  // Chart
  // ---------------------------------------------------------------------------
  chartData:    ChartData<'line'>    = { labels: [], datasets: [] };
  chartOptions: ChartOptions<'line'> = {
    responsive:          true,
    maintainAspectRatio: false,
    animation:           false,
    interaction:         { mode: 'index', intersect: false },
    scales: {
      x: {
        type:  'category',
        title: { display: true, text: 'Year' },
        ticks: { maxTicksLimit: 20 },
      },
      y: {
        type:  'linear',
        title: { display: true, text: 'Wealth ($)' },
        ticks: { callback: (v) => `$${Number(v).toLocaleString()}` },
      },
    },
    plugins: {
      legend:  { display: true, position: 'top' },
      tooltip: {
        callbacks: {
          label: (item) =>
            `${item.dataset.label}: $${Math.round(item.parsed.y ?? 0).toLocaleString()}`,
        },
      },
    },
  };

  // ---------------------------------------------------------------------------
  // Exposed constants for template
  // ---------------------------------------------------------------------------
  readonly VARIABLE_DISTS = VARIABLE_DISTS;
  readonly distTypeLabels: Record<DistributionType, string> = {
    normal:      'Normal',
    uniform:     'Uniform',
    exponential: 'Exponential',
    poisson:     'Poisson',
  };

  private readonly rawVars = new Set<string>(['C0', 'S0']);

  constructor(
    private route:     ActivatedRoute,
    private svc:       StochasticService,
    private defaults:  DefaultParamsService,
    private cdr:       ChangeDetectorRef,
    private zone:      NgZone,
  ) {}

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  ngOnInit(): void {
    this.tier            = Number(this.route.snapshot.data['tier'] ?? 2);
    this.tierConfig      = this.defaults.tierConfigs[this.tier];
    this.tierPath        = `/deterministic/tier-${this.tier}`;
    this.stochasticPath  = '/stochastic';

    // Initialise distributions — display scale for rate means
    this.resetDists();
  }

  resetDists(): void {
    this.dists = {};
    for (const v of this.formVariables) {
      this.dists[v] = this.toDisplayDist(v, { ...DEFAULT_DISTS[v] } as AnyDist);
    }
  }

  // ---------------------------------------------------------------------------
  // Distribution type change
  // ---------------------------------------------------------------------------

  onDistTypeChange(v: string, type: DistributionType): void {
    switch (type) {
      case 'normal':
        this.dists[v] = { type: 'normal', params: { mean: this.defaultMean(v), std: this.defaultStd(v) } };
        break;
      case 'uniform':
        this.dists[v] = { type: 'uniform', params: { low: this.defaultLow(v), high: this.defaultHigh(v) } };
        break;
      case 'exponential':
        this.dists[v] = { type: 'exponential', params: { scale: this.defaultMean(v) } };
        break;
      case 'poisson':
        this.dists[v] = DEFAULT_POISSON[v] ?? { type: 'poisson', params: { lam: this.defaultMean(v) } };
        break;
    }
    this.cdr.detectChanges();
  }

  // ---------------------------------------------------------------------------
  // Run simulation
  // ---------------------------------------------------------------------------

  run(): void {
    this.loading = true;
    this.error   = null;
    this.result  = null;

    // Convert display-scale dists back to decimal for API
    const apiDists: Record<string, AnyDist> = {};
    for (const v of this.formVariables) {
      apiDists[v] = this.toDecimalDist(v, this.dists[v]);
    }
    // Fill missing tier vars with zero-impact defaults
    if (!apiDists['S0']) apiDists['S0'] = { type: 'uniform', params: { low: 0, high: 0 } };
    if (!apiDists['g'])  apiDists['g']  = { type: 'uniform', params: { low: 0, high: 0 } };

    this.svc.simulate({
      tier: this.tier,
      W0:   this.W0,
      k:    this.k,
      n:    this.n,
      distributions: apiDists,
    }).subscribe({
      next: (res) => {
        this.zone.run(() => {
          this.result  = res;
          this.loading = false;
          this.buildChart(res.fan_chart);
          this.cdr.detectChanges();
        });
      },
      error: () => {
        this.zone.run(() => {
          this.error   = 'Simulation failed. Please check your parameters.';
          this.loading = false;
          this.cdr.detectChanges();
        });
      },
    });
  }

  // ---------------------------------------------------------------------------
  // Fan chart
  // ---------------------------------------------------------------------------

  private buildChart(fan: FanChart): void {
    const labels = fan.years.map(String);

    const band = (
      label: string, data: (number | null)[],
      color: string, fill: string | boolean, dash?: number[]
    ): ChartDataset<'line'> => ({
      label,
      data:             data as number[],
      borderColor:      color,
      backgroundColor:  color + '22',
      borderWidth:      dash ? 1.5 : 2,
      borderDash:       dash,
      pointRadius:      0,
      pointHoverRadius: 4,
      tension:          0.3,
      fill,
      spanGaps:         true,
    });

    this.chartData = {
      labels,
      datasets: [
        band('95th percentile', fan.p95, '#4f8ef7', '+1',       [4, 3]),
        band('75th percentile', fan.p75, '#4f8ef7', '+1'),
        band('Median (50th)',   fan.p50, '#10b981', false),
        band('25th percentile', fan.p25, '#4f8ef7', '-1'),
        band('5th percentile',  fan.p05, '#4f8ef7', false,      [4, 3]),
      ],
    };
  }

  // ---------------------------------------------------------------------------
  // Template helpers
  // ---------------------------------------------------------------------------

  get formVariables(): SweepVariable[] {
    const base: SweepVariable[] = ['i', 'T', 'pi', 'C0'];
    if (this.tier >= 3) base.push('S0', 'g');
    return base;
  }

  getMeta(v: string) { return this.defaults.variableMeta[v as SweepVariable]; }

  distType(v: string): DistributionType {
    return this.dists[v]?.type ?? 'normal';
  }

  asNormal(v: string): NormalDist { return this.dists[v] as NormalDist; }
  asUniform(v: string): UniformDist { return this.dists[v] as UniformDist; }
  asExponential(v: string): ExponentialDist { return this.dists[v] as ExponentialDist; }
  asPoisson(v: string): PoissonDist { return this.dists[v] as PoissonDist; }

  formatW(w: number | null): string {
    if (w === null) return 'N/A';
    return `$${Math.round(w).toLocaleString()}`;
  }

  formatPct(p: number): string { return `${p.toFixed(1)}%`; }

  formatYears(y: number | null): string {
    if (y === null) return 'N/A';
    return `${y.toFixed(1)} yrs`;
  }

  // ---------------------------------------------------------------------------
  // Display ↔ decimal conversion for distribution params
  // ---------------------------------------------------------------------------

  private isRate(v: string): boolean { return !this.rawVars.has(v); }

  private toDisplayDist(v: string, d: AnyDist): AnyDist {
    if (!this.isRate(v)) return d;
    const scale = 100;
    if (d.type === 'normal')
      return { type: 'normal', params: { mean: d.params.mean * scale, std: d.params.std * scale } };
    if (d.type === 'uniform')
      return { type: 'uniform', params: { low: d.params.low * scale, high: d.params.high * scale } };
    return d;
  }

  private toDecimalDist(v: string, d: AnyDist): AnyDist {
    if (!this.isRate(v)) return d;  // C0, S0 — no conversion needed including poisson
    const scale = 100;
    if (d.type === 'normal')
      return { type: 'normal', params: { mean: d.params.mean / scale, std: d.params.std / scale } };
    if (d.type === 'uniform')
      return { type: 'uniform', params: { low: d.params.low / scale, high: d.params.high / scale } };
    return d;
  }

  // Default param values for when user switches distribution type
  private defaultMean(v: string): number {
    const d = DEFAULT_DISTS[v];
    if (d.type === 'normal') return this.isRate(v) ? d.params.mean * 100 : d.params.mean;
    return 0;
  }

  private defaultStd(v: string): number {
    const d = DEFAULT_DISTS[v];
    if (d.type === 'normal') return this.isRate(v) ? d.params.std * 100 : d.params.std;
    return 1;
  }

  private defaultLow(v: string): number {
    const d = DEFAULT_DISTS[v];
    if (d.type === 'uniform') return this.isRate(v) ? d.params.low * 100 : d.params.low;
    return 0;
  }

  private defaultHigh(v: string): number {
    const d = DEFAULT_DISTS[v];
    if (d.type === 'uniform') return this.isRate(v) ? d.params.high * 100 : d.params.high;
    return 0;
  }
}