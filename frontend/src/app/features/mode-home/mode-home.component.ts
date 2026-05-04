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
    subtitle: 'Probabilistic outcomes under uncertain, correlated parameters',
    comingSoon: false,
    description: [
      'Stochastic models recognise that real-world parameters are not fixed — they fluctuate year to year according to economic dynamics, government policy cycles, and market conditions. Rather than a single required wealth W₀, stochastic analysis produces a distribution of outcomes across thousands of simulated paths, categorised into net gain, loss but solvent, and ruin.',
      'Two simulation modes are available. The naive mode treats all variables as independently sampled each year — a clean baseline for understanding how parameter uncertainty alone affects wealth trajectories. The correlated mode uses a VAR(1) macro model with Student-t fat tails and Markov regime switching to capture the economic reality that inflation, interest rates, and consumption move together through business cycles, while tax and welfare jump with government changes.',
    ],
    assumptions: [
      'Naive: all variables sampled independently each year via inverse CDF',
      'Correlated: π, i, C₀ follow a VAR(1) with Student-t shocks (fat tails)',
      'Correlated: T and S₀ switch between Liberal and Conservative regimes via a Markov chain',
      'Correlated: starting regime sampled from the Markov stationary distribution — no bias',
      'Both modes: paths stop at first ruin — negative wealth does not compound',
      'Both modes: consumption and welfare means grow with sampled inflation each year',
    ],
    useCases: [
      'Quantifying ruin probability under realistic parameter uncertainty',
      'Comparing outcomes under Liberal vs Conservative majority government regimes',
      'Understanding how business cycle correlations between inflation, rates, and spending affect long-run wealth',
      'Stress-testing a financial independence plan against fat-tailed market events',
      'Benchmarking the naive baseline against the correlated model to isolate the impact of economic coupling',
    ],
    behaviors: [
      'Higher return rate variance is the dominant driver of ruin probability in naive mode',
      'In correlated mode, Taylor Rule dynamics mean inflation shocks propagate to interest rates automatically',
      'Conservative-majority paths typically show lower ruin rates but also lower median final wealth',
      'Student-t shocks with ν=5 produce 2008-style tail events at realistic frequencies',
      'Fan charts narrow over time when surviving paths converge; ruin exclusion makes bands optimistic',
    ],
    links: [
      { label: 'Naive — Tier 1',        route: '/stochastic/naive/tier-1' },
      { label: 'Naive — Tier 2',        route: '/stochastic/naive/tier-2' },
      { label: 'Naive — Tier 3',        route: '/stochastic/naive/tier-3' },
      { label: 'Correlated — Tier 1',   route: '/stochastic/correlated/tier-1' },
      { label: 'Correlated — Tier 2',   route: '/stochastic/correlated/tier-2' },
      { label: 'Correlated — Tier 3',   route: '/stochastic/correlated/tier-3' },
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