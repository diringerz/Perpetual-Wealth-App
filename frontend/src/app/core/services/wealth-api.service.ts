import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import {
  SolveRequest, SolveResponse,
  SweepRequest, SweepResponse,
} from '../../shared/models/wealth.models';
import { environment } from '../../../environments/environment';

@Injectable({ providedIn: 'root' })
export class WealthApiService {

  private readonly base = `${environment.apiUrl}/api/v1/deterministic`;

  constructor(private http: HttpClient) {}

  solve(req: SolveRequest): Observable<SolveResponse> {
    return this.http.post<SolveResponse>(`${this.base}/solve`, req);
  }

  sweep(req: SweepRequest): Observable<SweepResponse> {
    return this.http.post<SweepResponse>(`${this.base}/sweep`, req);
  }
}
