import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

@Injectable({
  providedIn: 'root'
})
export class ApiService {
  private apiUrl = environment.apiUrl;

  constructor(private http: HttpClient) { }

  // Health check endpoint
  getHealthCheck(): Observable<any> {
    return this.http.get(`${this.apiUrl}/health`);
  }

  // Get list of all regions
  getRegions(): Observable<any> {
    return this.http.get(`${this.apiUrl}/regions`);
  }

  // Get prices for a specific region
  getPrices(regionId: string, startDate?: string, endDate?: string): Observable<any> {
    let url = `${this.apiUrl}/prices?region_id=${regionId}`;
    
    if (startDate) {
      url += `&start_date=${startDate}`;
    }
    
    if (endDate) {
      url += `&end_date=${endDate}`;
    }
    
    return this.http.get(url);
  }

  // Get price predictions for a region
  getPredictions(regionId: string, monthsAhead: number = 5, includeConfidenceIntervals: boolean = false): Observable<any> {
    return this.http.get(
      `${this.apiUrl}/predict?region_id=${regionId}&months_ahead=${monthsAhead}&include_confidence=${includeConfidenceIntervals}`
    );
  }

  // Get region details
  getRegionDetails(regionId: string): Observable<any> {
    return this.http.get(`${this.apiUrl}/region/${regionId}`);
  }
}
