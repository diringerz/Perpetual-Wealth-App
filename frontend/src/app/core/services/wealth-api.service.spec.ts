import { TestBed } from '@angular/core/testing';
import {
  HttpClientTestingModule,
  HttpTestingController,
} from '@angular/common/http/testing';
import { WealthApiService } from './wealth-api.service';
import { SolveRequest, SweepRequest } from '../../shared/models/wealth.models';
import { environment } from '../../../environments/environment';

describe('WealthApiService', () => {
  let service: WealthApiService;
  let http: HttpTestingController;

  const base = `${environment.apiUrl}/api/v1/deterministic`;

  const mockParams = {
    C0: 80000, i: 0.10, T: 0.25, pi: 0.03, S0: 0, g: 0,
  };

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [WealthApiService],
    });
    service = TestBed.inject(WealthApiService);
    http    = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('solve() should POST to /solve with the correct body', () => {
    const req: SolveRequest = { params: mockParams, t_horizon: 50 };
    service.solve(req).subscribe();
    const r = http.expectOne(`${base}/solve`);
    expect(r.request.method).toBe('POST');
    expect(r.request.body).toEqual(req);
    r.flush({ W0: 1_000_000, tier: 2, r_real: 0.0437 });
  });

  it('sweep() should POST to /sweep with the correct body', () => {
    const req: SweepRequest = {
      base_params: mockParams,
      sweep_var: 'i',
      sweep_range: { min: 0.01, max: 0.30, n_points: 200 },
    };
    service.sweep(req).subscribe();
    const r = http.expectOne(`${base}/sweep`);
    expect(r.request.method).toBe('POST');
    expect(r.request.body).toEqual(req);
    r.flush({ sweep_var: 'i', points: [], asymptotes: [], infeasible_regions: [] });
  });

  it('solve() should propagate HTTP errors', () => {
    const req: SolveRequest = { params: mockParams, t_horizon: 50 };
    let error: any;
    service.solve(req).subscribe({ error: (e) => (error = e) });
    http.expectOne(`${base}/solve`).flush('Server error', {
      status: 500, statusText: 'Internal Server Error',
    });
    expect(error).toBeTruthy();
  });
});
