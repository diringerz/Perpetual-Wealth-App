import {
  Component,
  Input,
  OnInit,
  OnChanges,
  OnDestroy,
  SimpleChanges,
  ChangeDetectionStrategy,
  ChangeDetectorRef,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { BaseChartDirective } from 'ng2-charts';
import { Subscription } from 'rxjs';
import {
  Chart,
  ChartData,
  ChartOptions,
  ChartDataset,
  LinearScale,
  LineController,
  LineElement,
  PointElement,
  CategoryScale,
  Tooltip,
  Legend,
  Filler,
} from 'chart.js';
import { WealthApiService } from '../../../core/services/wealth-api.service';
import { DefaultParamsService } from '../../../core/services/default-params.service';
import {
  WealthParams,
  SweepVariable,
  SweepRange,
  SweepResponse,
  SweepPoint,
  GraphSnapshot,
  VariableMeta,
} from '../../models/wealth.models';

Chart.register(
  LinearScale,
  LineController,
  LineElement,
  PointElement,
  CategoryScale,
  Tooltip,
  Legend,
  Filler,
);

@Component({
  selector:        'app-sweep-graph',
  standalone:      true,
  imports:         [CommonModule, FormsModule, BaseChartDirective],
  styleUrls:       ['./sweep-graph.component.scss'],
  templateUrl:     './sweep-graph.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SweepGraphComponent implements OnInit, OnChanges, OnDestroy {

  @Input() sweepVar!:   SweepVariable;
  @Input() baseParams!: WealthParams;
  @Input() sweepRange!: SweepRange;
  @Input() tier!:           number;
  // Incremented by parent on "Update graphs" — triggers explicit re-fetch
  @Input() refreshTrigger: number = 0;

  meta!:       VariableMeta;
  snapshot:    GraphSnapshot | null = null;
  response:    SweepResponse | null = null;
  loading      = false;
  error:       string | null = null;
  localRange!: SweepRange;

  chartData: ChartData<'line'> = { labels: [], datasets: [] };

  chartOptions: ChartOptions<'line'> = {
    responsive:          true,
    maintainAspectRatio: false,
    animation:           false,
    scales: {
      x: {
        type:  'category',
        title: { display: true, text: '' },
        ticks: {
          maxTicksLimit: 10,
          callback: (_tickValue, index): string =>
            (this.chartData.labels?.[index] as string) ?? '',
        },
      },
      y: {
        type:  'linear',
        min:   0,
        title: { display: true, text: 'Initial Wealth W₀ ($)' },
        ticks: {
          callback: (val): string => `$${Number(val).toLocaleString()}`,
        },
      },
    },
    plugins: {
      legend: { display: false },
      tooltip: {
        callbacks: {
          title: (items) => {
            const label = items[0]?.label ?? '';
            return `${this.meta?.label ?? ''}: ${label}`;
          },
          label: (item) =>
            `W₀: $${Math.round(item.parsed.y ?? 0).toLocaleString()}`,
        },
      },
    },
  };

  asymptoteX: number | null = null;

  readonly asymptotePlugin = {
    id: 'asymptoteLine',
    afterDraw: (chart: Chart) => {
      if (this.asymptoteX === null) return;

      const xScale = chart.scales['x'];
      const yScale = chart.scales['y'];
      if (!xScale || !yScale) return;

      const points = (this.response?.points ?? []).filter(
        (pt: SweepPoint) => pt.W0 !== null
      );
      if (!points.length) return;

      let closestIdx  = 0;
      let closestDist = Infinity;
      points.forEach((pt: SweepPoint, i: number) => {
        const dist = Math.abs(pt.x - (this.asymptoteX as number));
        if (dist < closestDist) { closestDist = dist; closestIdx = i; }
      });

      const xPixel = (xScale as any).getPixelForValue(closestIdx);
      const ctx    = chart.ctx;
      ctx.save();
      ctx.beginPath();
      ctx.setLineDash([6, 4]);
      ctx.strokeStyle = '#f59e0b';
      ctx.lineWidth   = 2;
      ctx.moveTo(xPixel, yScale.top);
      ctx.lineTo(xPixel, yScale.bottom);
      ctx.stroke();
      ctx.restore();
    },
  };

  // Single subscription — cancelled and replaced on every fetch()
  private fetchSub?: Subscription;

  // Dollar-amount variables — no x100 display conversion
  private readonly rawVars = new Set<string>(['C0', 'S0']);

  get isRateVar(): boolean {
    return !this.rawVars.has(this.sweepVar);
  }

  // Convert internal decimal range value to display value
  toDisplayVal(val: number): number {
    return this.isRateVar ? +(val * 100).toPrecision(10) : val;
  }

  // Convert display value back to internal decimal
  toInternalVal(val: number): number {
    return this.isRateVar ? +(val / 100).toPrecision(10) : val;
  }

  constructor(
    private api:      WealthApiService,
    private defaults: DefaultParamsService,
    private cdr:      ChangeDetectorRef,
  ) {}

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  ngOnInit(): void {
    this.meta       = this.defaults.variableMeta[this.sweepVar];
    this.localRange = { ...this.sweepRange };
    this.updateAxisLabels();
    this.fetch();
  }

  ngOnChanges(changes: SimpleChanges): void {
    // refreshTrigger incremented by parent — re-fetch with current baseParams
    if (changes['refreshTrigger'] && !changes['refreshTrigger'].firstChange) {
      this.fetch();
      return;
    }
    // baseParams changes come from graphSnapshot updates in the tier component.
    // We do NOT auto-fetch here — the user must click Refresh explicitly.
    // Only propagate sweepRange changes from the parent.
    if (changes['sweepRange'] && !changes['sweepRange'].firstChange) {
      this.localRange = { ...this.sweepRange };
    }
  }

  ngOnDestroy(): void {
    this.fetchSub?.unsubscribe();
  }

  // ---------------------------------------------------------------------------
  // Public actions
  // ---------------------------------------------------------------------------

  refresh(): void {
    this.fetch();
  }

  onRangeMinChange(val: number): void {
    this.localRange = { ...this.localRange, min: this.toInternalVal(val) };
  }

  onRangeMaxChange(val: number): void {
    this.localRange = { ...this.localRange, max: this.toInternalVal(val) };
  }

  onNPointsChange(val: number): void {
    this.localRange = { ...this.localRange, n_points: val };
  }

  // ---------------------------------------------------------------------------
  // Formatting helpers
  // ---------------------------------------------------------------------------

  formatW0(val: number): string {
    return val == null ? '' : `$${Math.round(val).toLocaleString()}`;
  }

  formatX(val: number): string {
    return this.meta ? this.meta.formatFn(val) : String(val);
  }

  snapshotParamEntries(): { label: string; value: string }[] {
    if (!this.snapshot) return [];
    const p    = this.snapshot.params;
    const meta = this.defaults.variableMeta;
    return (Object.keys(p) as SweepVariable[])
      .filter((k) => k !== this.sweepVar)
      .map((k) => ({
        label: meta[k]?.label ?? k,
        value: meta[k]?.formatFn(p[k as keyof WealthParams] as number)
               ?? String(p[k as keyof WealthParams]),
      }));
  }

  // ---------------------------------------------------------------------------
  // Private
  // ---------------------------------------------------------------------------

  private updateAxisLabels(): void {
    if (!this.meta) return;
    (this.chartOptions.scales!['x'] as any).title.text =
      `${this.meta.label} (${this.meta.unit})`;
  }

  private fetch(): void {
    // Cancel any in-flight request before issuing a new one
    this.fetchSub?.unsubscribe();

    this.loading = true;
    this.error   = null;

    // Snapshot params at fetch time — held until next explicit refresh
    this.snapshot = {
      params:     { ...this.baseParams },
      sweepVar:   this.sweepVar,
      sweepRange: { ...this.localRange },
      fetchedAt:  new Date(),
    };

    this.fetchSub = this.api.sweep({
      base_params: this.snapshot.params,
      sweep_var:   this.sweepVar,
      sweep_range: this.localRange,
      tier:        this.tier,
    }).subscribe({
      next: (res) => {
        this.response  = res;
        this.chartData = this.buildChartData(res);

        // Set y-axis ceiling to 5% above the max valid W0
        const validPoints = res.points.filter((pt: SweepPoint) => pt.W0 !== null);
        if (validPoints.length) {
          const max = Math.max(...validPoints.map((pt: SweepPoint) => pt.W0 as number));
          (this.chartOptions.scales!['y'] as any).max = Math.ceil(max * 1.05);
        }

        // Asymptote — only set if within sweep range
        const rawAsymptote: number | undefined = res.asymptotes?.[0];
        this.asymptoteX = rawAsymptote !== undefined ? rawAsymptote : null;

        this.loading = false;
        this.cdr.markForCheck();
      },
      error: () => {
        this.error   = 'Failed to load sweep data. Please try again.';
        this.loading = false;
        this.cdr.markForCheck();
      },
    });
  }

  private buildChartData(res: SweepResponse): ChartData<'line'> {
    const validPoints = res.points.filter((pt: SweepPoint) => pt.W0 !== null);
    const labels      = validPoints.map((pt: SweepPoint) => this.formatX(pt.x));

    const dataset: ChartDataset<'line'> = {
      label:            `W₀ vs ${this.meta.label}`,
      data:             validPoints.map((pt: SweepPoint): number => pt.W0 as number),
      borderColor:      '#4f8ef7',
      backgroundColor:  'rgba(79, 142, 247, 0.08)',
      borderWidth:      2,
      pointRadius:      0,
      pointHoverRadius: 5,
      tension:          0,
      fill:             true,
    };

    return { labels, datasets: [dataset] };
  }
}