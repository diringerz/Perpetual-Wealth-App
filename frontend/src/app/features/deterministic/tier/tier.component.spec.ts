import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { ActivatedRoute } from '@angular/router';
import { RouterTestingModule } from '@angular/router/testing';
import { TierComponent } from './tier.component';
import { WealthApiService } from '../../../core/services/wealth-api.service';
import { DefaultParamsService } from '../../../core/services/default-params.service';
import { SolveResponse } from '../../../shared/models/wealth.models';

const mockSolveResponse: SolveResponse = {
  tier:           2,
  W0:             1_200_000,
  r_real:         0.0437,
  r_real_formula: '(1 + i*(1-T)) / (1+pi) - 1',
  W0_formula:     'C0 / (r_real - pi)',
  edge_case:      null,
  trajectory:     [],
  sensitivity:    [
    { variable: 'i', dW0_dx: -5_000_000, elasticity: -3.14, d2W0_dx2: 0 },
  ],
};

describe('TierComponent', () => {
  let fixture:   ComponentFixture<TierComponent>;
  let component: TierComponent;
  let apiSpy:    jasmine.SpyObj<WealthApiService>;

  function createFixture(tier: number): ComponentFixture<TierComponent> {
    apiSpy = jasmine.createSpyObj('WealthApiService', ['solve', 'sweep']);
    apiSpy.solve.and.returnValue(of(mockSolveResponse));
    apiSpy.sweep.and.returnValue(of({
      sweep_var: 'i', points: [], asymptotes: [],
      infeasible_regions: [], base_point: { x: 0.1, W0: null, edge_case: null },
      sensitivity_at_base: { variable: 'i', dW0_dx: 0, elasticity: 0, d2W0_dx2: 0 },
    }));

    TestBed.configureTestingModule({
      imports: [TierComponent, RouterTestingModule],
      providers: [
        { provide: WealthApiService,  useValue: apiSpy },
        DefaultParamsService,
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { data: { tier } } },
        },
      ],
    }).compileComponents();

    const f = TestBed.createComponent(TierComponent);
    f.detectChanges();
    return f;
  }

  beforeEach(() => {
    fixture   = createFixture(2);
    component = fixture.componentInstance;
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should load tier config on init', () => {
    expect(component.tierConfig).toBeDefined();
    expect(component.tierConfig.tier).toBe(2);
  });

  it('should call solve API on init', () => {
    expect(apiSpy.solve).toHaveBeenCalledTimes(1);
  });

  it('should set result after successful solve', () => {
    expect(component.result).toEqual(mockSolveResponse);
  });

  it('should set error on API failure', () => {
    apiSpy.solve.and.returnValue(throwError(() => new Error('fail')));
    component.solve();
    expect(component.error).not.toBeNull();
  });

  it('tier 1 and 2 should not include S0 or g', () => {
    [1, 2].forEach((t) => {
      fixture   = createFixture(t);
      component = fixture.componentInstance;
      expect(component.tierVariables).not.toContain('S0');
      expect(component.tierVariables).not.toContain('g');
    });
  });

  it('tier 3 and 4 should include S0 and g', () => {
    [3, 4].forEach((t) => {
      fixture   = createFixture(t);
      component = fixture.componentInstance;
      expect(component.tierVariables).toContain('S0');
      expect(component.tierVariables).toContain('g');
    });
  });

  it('isInfeasible should return true for infeasible edge case', () => {
    component.result = { ...mockSolveResponse, edge_case: 'infeasible' };
    expect(component.isInfeasible()).toBeTrue();
  });

  it('isInfeasible should return false for null edge case', () => {
    component.result = { ...mockSolveResponse, edge_case: null };
    expect(component.isInfeasible()).toBeFalse();
  });

  it('formatW0 should return N/A for null', () => {
    expect(component.formatW0(null)).toBe('N/A');
  });

  it('formatW0 should format numbers with dollar sign and commas', () => {
    expect(component.formatW0(1_200_000)).toBe('$1,200,000');
  });
});
