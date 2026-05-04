import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';
import { CorrelatedRequest, CorrelatedResponse } from '../../shared/models/stochastic-correlated.models';

@Injectable({ providedIn: 'root' })
export class StochasticCorrelatedService {

  private readonly base = `${environment.apiUrl}/api/v1/stochastic/correlated`;

  constructor(private http: HttpClient) {}

  simulate(req: CorrelatedRequest): Observable<CorrelatedResponse> {
    return this.http.post<CorrelatedResponse>(`${this.base}/simulate`, req);
  }
}