import { TestBed } from '@angular/core/testing';
import { DefaultParamsService } from './default-params.service';

describe('DefaultParamsService', () => {
  let service: DefaultParamsService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(DefaultParamsService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('defaultParams should have all required fields', () => {
    const p = service.defaultParams;
    expect(p.C0).toBeGreaterThan(0);
    expect(p.i).toBeGreaterThan(0);
    expect(p.T).toBeGreaterThanOrEqual(0);
    expect(p.T).toBeLessThan(1);
    expect(p.pi).toBeGreaterThanOrEqual(0);
  });

  it('defaultParams should satisfy feasibility: i*(1-T) > pi*(2+pi)', () => {
    const { i, T, pi } = service.defaultParams;
    const minI = pi * (2 + pi) / (1 - T);
    expect(i).toBeGreaterThan(minI);
  });

  it('variableMeta should exist for all six sweep variables', () => {
    const vars = ['i', 'T', 'pi', 'C0', 'S0', 'g'] as const;
    vars.forEach((v) => {
      expect(service.variableMeta[v]).toBeDefined();
      expect(service.variableMeta[v].min).toBeLessThan(service.variableMeta[v].max);
    });
  });

  it('tierConfigs should exist for tiers 1 through 4', () => {
    [1, 2, 3, 4].forEach((t) => {
      expect(service.tierConfigs[t]).toBeDefined();
      expect(service.tierConfigs[t].variables.length).toBeGreaterThan(0);
    });
  });

  it('tiers 3 and 4 should include welfare variables S0 and g', () => {
    [3, 4].forEach((t) => {
      const vars = service.tierConfigs[t].variables;
      expect(vars).toContain('S0');
      expect(vars).toContain('g');
    });
  });

  it('sweepRangeDefaults should have valid min < max for all variables', () => {
    Object.values(service.sweepRangeDefaults).forEach((r) => {
      expect(r.min).toBeLessThan(r.max);
      expect(r.n_points).toBeGreaterThan(0);
    });
  });
});
