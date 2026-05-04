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

import { StochasticCorrelatedService } from '../../../core/services/stochastic-correlated.service';
import { DefaultParamsService } from '../../../core/services/default-params.service';
import {
  VARParams, RegimeParams, CorrelatedResponse, FanBand, RegimeComparison,
  DEFAULT_VAR, DEFAULT_REGIME,
} from '../../../shared/models/stochastic-correlated.models';
import { TierConfig } from '../../../shared/models/wealth.models';

Chart.register(
  LinearScale, LineController, LineElement,
  PointElement, CategoryScale, Tooltip, Legend, Filler,
);

@Component({
  selector:        'app-stochastic-correlated',
  standalone:      true,
  schemas:         [CUSTOM_ELEMENTS_SCHEMA],
  imports:         [CommonModule, FormsModule, RouterModule, BaseChartDirective],
  changeDetection: ChangeDetectionStrategy.Default,
  styleUrls:       ['./stochastic-correlated.component.scss'],
  templateUrl:     './stochastic-correlated.component.html',
})
export class StochasticCorrelatedComponent implements OnInit {

  // ---------------------------------------------------------------------------
  // Route
  // ---------------------------------------------------------------------------
  tier!:       number;
  tierConfig!: TierConfig;

  // ---------------------------------------------------------------------------
  // Config
  // ---------------------------------------------------------------------------
  W0  = 500_000;
  k   = 1_000;
  n   = 50;

  varParams:    VARParams    = { ...DEFAULT_VAR };
  regimeParams: RegimeParams = { ...DEFAULT_REGIME };

  advancedOpen = false;

  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------
  loading = false;
  error:  string | null = null;
  result: CorrelatedResponse | null = null;

  // ---------------------------------------------------------------------------
  // Charts
  // ---------------------------------------------------------------------------
  fanChartData:    ChartData<'line'>    = { labels: [], datasets: [] };
  fanChartOptions: ChartOptions<'line'> = {
    responsive: true, maintainAspectRatio: false, animation: false,
    interaction: { mode: 'index', intersect: false },
    scales: {
      x: { type: 'category', title: { display: true, text: 'Year' } },
      y: {
        type: 'linear',
        title: { display: true, text: 'Wealth ($)' },
        ticks: { callback: (v) => `$${Number(v).toLocaleString()}` },
      },
    },
    plugins: {
      legend: { display: true, position: 'top' },
      tooltip: {
        callbacks: {
          label: (item) =>
            `${item.dataset.label}: $${Math.round(item.parsed.y ?? 0).toLocaleString()}`,
        },
      },
    },
  };

  constructor(
    private route:   ActivatedRoute,
    private svc:     StochasticCorrelatedService,
    private defaults: DefaultParamsService,
    private cdr:     ChangeDetectorRef,
    private zone:    NgZone,
  ) {}

  ngOnInit(): void {
    this.tier       = Number(this.route.snapshot.data['tier'] ?? 2);
    this.tierConfig = this.defaults.tierConfigs[this.tier];
    // mu_C0 and sigma_C0 already correctly set in DEFAULT_VAR
  }

  // ---------------------------------------------------------------------------
  // Run
  // ---------------------------------------------------------------------------

  run(): void {
    this.loading = true;
    this.error   = null;
    this.result  = null;

    // Convert display % back to decimals for rate params
    const vp = this.toDecimalVAR(this.varParams);
    const rp = this.toDecimalRegime(this.regimeParams);

    this.svc.simulate({
      tier: this.tier, W0: this.W0, k: this.k, n: this.n,
      var: vp, regime: rp,
    }).subscribe({
      next: (res) => {
        this.zone.run(() => {
          this.result  = res;
          this.loading = false;
          this.buildFanChart(res);
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

  resetDefaults(): void {
    this.varParams    = { ...DEFAULT_VAR };
    this.regimeParams = { ...DEFAULT_REGIME };
  }

  // ---------------------------------------------------------------------------
  // Chart builders
  // ---------------------------------------------------------------------------

  private buildFanChart(res: CorrelatedResponse): void {
    const labels = res.fan_overall.years.map(String);

    const band = (
      label: string, data: (number | null)[],
      color: string, fill: string | boolean, dash?: number[]
    ): ChartDataset<'line'> => ({
      label, data: data as number[],
      borderColor: color, backgroundColor: color + '18',
      borderWidth: dash ? 1.5 : 2, borderDash: dash,
      pointRadius: 0, pointHoverRadius: 4,
      tension: 0.3, fill, spanGaps: true,
    });

    this.fanChartData = {
      labels,
      datasets: [
        // Overall median
        band('Overall median',      res.fan_overall.p50,      '#6b7280', false),
        // Liberal fan
        band('Liberal 95th',        res.fan_liberal.p95,       '#4f8ef7', false,      [4,3]),
        band('Liberal median',      res.fan_liberal.p50,       '#4f8ef7', false),
        band('Liberal 5th',         res.fan_liberal.p05,       '#4f8ef7', false,      [4,3]),
        // Conservative fan
        band('Conservative 95th',   res.fan_conservative.p95,  '#10b981', false,      [4,3]),
        band('Conservative median', res.fan_conservative.p50,  '#10b981', false),
        band('Conservative 5th',    res.fan_conservative.p05,  '#10b981', false,      [4,3]),
      ],
    };
  }

  // ---------------------------------------------------------------------------
  // Decimal conversion
  // ---------------------------------------------------------------------------

  private toDecimalVAR(v: VARParams): VARParams {
    // Only convert rate variables (%) to decimals — C0 and sigma_C0 are dollar amounts
    return {
      ...v,
      mu_pi:    v.mu_pi    / 100,
      mu_i:     v.mu_i     / 100,
      sigma_pi: v.sigma_pi / 100,
      sigma_i:  v.sigma_i  / 100,
      // mu_C0 and sigma_C0 stay as-is — already in dollars
    };
  }

  private toDecimalRegime(r: RegimeParams): RegimeParams {
    return {
      ...r,
      T_mean_liberal:      r.T_mean_liberal      / 100,
      T_std_liberal:       r.T_std_liberal        / 100,
      T_mean_conservative: r.T_mean_conservative  / 100,
      T_std_conservative:  r.T_std_conservative   / 100,
      p_stay_liberal:      r.p_stay_liberal       / 100,
      p_stay_conservative: r.p_stay_conservative  / 100,
    };
  }

  // ---------------------------------------------------------------------------
  // Template helpers
  // ---------------------------------------------------------------------------

  get formVariables() {
    const base = ['i', 'T', 'pi', 'C0'];
    if (this.tier >= 3) base.push('S0', 'g');
    return base;
  }

  formatW(w: number | null): string {
    if (w === null) return 'N/A';
    return `$${Math.round(w).toLocaleString()}`;
  }

  formatPct(p: number): string { return `${p.toFixed(1)}%`; }
  formatYears(y: number | null): string {
    return y === null ? 'N/A' : `${y.toFixed(1)} yrs`;
  }

  pathLabel(n: number): string { return n.toLocaleString(); }
}