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
    subtitle: 'Probabilistic outcomes under uncertain returns',
    comingSoon: true,
    description: [
      'Stochastic models recognise that investment returns are not fixed — they fluctuate year to year according to some probability distribution. Rather than a single required wealth W₀, stochastic analysis produces a distribution of outcomes: a probability that your wealth lasts a given number of years, and a ruin probability — the chance your portfolio hits zero before you do.',
      'The underlying process is a stochastic differential equation (SDE) driven by a Wiener process. Monte Carlo simulation samples thousands of return paths and aggregates the results into trajectory distributions and confidence intervals.',
    ],
    assumptions: [
      'Annual returns follow a log-normal distribution with a given mean μ and volatility σ',
      'Return shocks are independently and identically distributed (i.i.d.)',
      'Inflation and tax are treated as deterministic constants',
      'Consumption follows the same inflation-adjusted growth as in Tier 2+',
    ],
    useCases: [
      'Quantifying the probability of outliving your wealth under realistic market conditions',
      'Comparing the ruin probability of different initial wealth levels',
      'Understanding how return volatility σ affects the safety margin above the deterministic W₀',
      'Stress-testing a retirement plan against historical return distributions',
    ],
    behaviors: [
      'Higher volatility σ increases ruin probability even when mean return μ exceeds the deterministic threshold',
      'The deterministic W₀ is the lower bound — stochastic W₀ for a given safety level is always higher',
      'Sequence-of-returns risk means early bad years are disproportionately damaging',
      'Monte Carlo trajectories fan out over time — confidence intervals widen with horizon',
    ],
    links: [],
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
