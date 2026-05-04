import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';
import { StochasticRequest, StochasticResponse } from '../../shared/models/stochastic.models';

@Injectable({ providedIn: 'root' })
export class StochasticService {

  private readonly base = `${environment.apiUrl}/api/v1/stochastic/naive`;

  constructor(private http: HttpClient) {}

  simulate(req: StochasticRequest): Observable<StochasticResponse> {
    return this.http.post<StochasticResponse>(`${this.base}/simulate`, req);
  }
}