import { Component, OnInit, ChangeDetectionStrategy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule, ActivatedRoute } from '@angular/router';

interface ModeConfig {
  title:       string;
  subtitle:    string;
  description: string[];
  assumptions: string[];
  useCases:    string[];
  behaviors:   string[];
  links:       { label: string; route: string }[];
  comingSoon:  boolean;
}

const CONFIGS: Record<string, ModeConfig> = {
  deterministic: {
    title:    'Deterministic models',
    subtitle: 'Exact answers under fixed assumptions',
    comingSoon: false,
    description: [
      'Deterministic models treat all parameters — return rate, inflation, tax, and consumption — as known constants. Given these inputs, the governing differential equation has an exact closed-form solution. There is no randomness, no probability distribution: for a given set of parameters, there is precisely one value of initial wealth W₀ that produces perpetual solvency.',
      'The model is built in three tiers of increasing complexity, each adding one layer of economic reality. Every tier uses the exact real return rate r = (1 + i(1 − T)) / (1 + π) − 1, never the common approximation i(1 − T) − π.',
    ],
    assumptions: [
      'All parameters remain constant over time',
      'Returns are taxed at a fixed marginal rate T',
      'Inflation erodes purchasing power at a constant rate π',
      'Welfare income (Tier 3) is taxed at the same rate T',
      'The system is continuous — compounding is instantaneous',
    ],
    useCases: [
      'Calculating the precise savings target for early retirement',
      'Understanding sensitivity of required wealth to return rates or inflation',
      'Comparing the impact of welfare or pension income on required wealth',
      'Identifying conditions under which perpetual wealth is mathematically impossible',
    ],
    behaviors: [
      'W₀ diverges to infinity as the real return rate approaches inflation from above',
      'Below the asymptote (r < π), no finite initial wealth guarantees solvency',
      'Welfare income (after tax) linearly reduces required initial wealth in Tier 3',
      'The wealth trajectory W(t) is flat at W₀ when the equilibrium condition is exactly met',
    ],
    links: [
      { label: 'Tier 1 — Base model',         route: '/deterministic/tier-1' },
      { label: 'Tier 2 — Inflation-adjusted',  route: '/deterministic/tier-2' },
      { label: 'Tier 3 — Welfare subsidy',     route: '/deterministic/tier-3' },
      //{ label: 'Tier 4 — Welfare reinvested',  route: '/deterministic/tier-4' },
      { label: 'Satirical solutions',          route: '/deterministic/satirical' },
    ],
  },

  stochastic: {
    title:    'Stochastic models',
    subtitle: 'Probabilistic outcomes under uncertain parameters',
    comingSoon: false,
    description: [
      'Stochastic models recognise that real-world parameters — return rate, inflation, consumption, tax — are not fixed constants but fluctuate year to year. Rather than a single required wealth W₀, stochastic analysis produces a distribution of outcomes across thousands of simulated paths: what fraction end in net gain, what fraction survive but decline, and what fraction hit ruin.',
      'The naive mode assumes all variables are sampled independently each year from user-specified distributions using the inverse CDF method. This is the simplest stochastic formulation — no correlations between variables, no memory between years. It serves as a baseline for understanding how parameter uncertainty alone affects long-run wealth trajectories.',
    ],
    assumptions: [
      'Each variable is sampled independently each year — no cross-variable correlation',
      'Samples are drawn using the probability integral transform (inverse CDF)',
      'Consumption and welfare distribution means grow with sampled inflation each year',
      'Paths stop at first ruin — negative wealth is not allowed to compound',
      'All tier assumptions from the deterministic models carry forward',
    ],
    useCases: [
      'Quantifying ruin probability under realistic parameter uncertainty',
      'Understanding how return volatility affects the safety margin above W₀',
      'Comparing Normal vs Uniform vs Poisson assumptions for consumption',
      'Stress-testing a financial plan across thousands of possible futures',
    ],
    behaviors: [
      'Higher variance in return rate dramatically increases ruin probability',
      'Ruin paths stop early — mean years to ruin is always less than N',
      'Fan chart narrows when surviving paths converge; widens under high variance',
      'Poisson-distributed consumption models discrete spending shocks naturally',
    ],
    links: [
      { label: 'Naive — Tier 1', route: '/stochastic/naive/tier-1' },
      { label: 'Naive — Tier 2', route: '/stochastic/naive/tier-2' },
      { label: 'Naive — Tier 3', route: '/stochastic/naive/tier-3' },
    ],
  },
};

@Component({
  selector:    'app-mode-home',
  standalone:  true,
  imports:     [CommonModule, RouterModule],
  templateUrl: './mode-home.component.html',
  styleUrls:   ['./mode-home.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ModeHomeComponent implements OnInit {
  config!: ModeConfig;

  constructor(private route: ActivatedRoute) {}

  ngOnInit(): void {
    const mode = this.route.snapshot.data['mode'] as string;
    this.config = CONFIGS[mode] ?? CONFIGS['deterministic'];
  }
}