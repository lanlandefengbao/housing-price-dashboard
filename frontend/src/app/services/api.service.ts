import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, of, forkJoin, BehaviorSubject } from 'rxjs';
import { map, tap, shareReplay, catchError } from 'rxjs/operators';
import { environment } from '../../environments/environment';

// 缓存接口
interface CacheEntry<T> {
  data: T;
  timestamp: number;
  expiresAt: number;
}

@Injectable({
  providedIn: 'root'
})
export class ApiService {
  private apiUrl = environment.apiUrl;
  
  // 缓存存储
  private cache: {[key: string]: CacheEntry<any>} = {};
  private DEFAULT_CACHE_TIME = 5 * 60 * 1000; // 5分钟缓存
  
  // 存储加载状态
  private loadingSubject = new BehaviorSubject<boolean>(false);
  public loading$ = this.loadingSubject.asObservable();

  constructor(private http: HttpClient) { }

  // 设置加载状态
  private setLoading(isLoading: boolean): void {
    this.loadingSubject.next(isLoading);
  }

  // Health check endpoint
  getHealthCheck(): Observable<any> {
    return this.http.get(`${this.apiUrl}/health`);
  }

  // Get list of all regions
  getRegions(): Observable<any> {
    const cacheKey = 'all_regions';
    const cached = this.getFromCache(cacheKey);
    
    if (cached) {
      return of(cached);
    }
    
    this.setLoading(true);
    return this.http.get(`${this.apiUrl}/regions`).pipe(
      tap(response => {
        this.setLoading(false);
        this.addToCache(cacheKey, response, 30 * 60 * 1000); // 30分钟缓存
      }),
      catchError(error => {
        this.setLoading(false);
        console.error('Error fetching regions:', error);
        return of({ regions: [] });
      }),
      // 共享同一个Observable，避免多次订阅导致多次HTTP请求
      shareReplay(1)
    );
  }

  // Get prices for a specific region
  getPrices(regionId: string, startDate?: string, endDate?: string): Observable<any> {
    // 构建缓存键
    const cacheKey = `prices_${regionId}_${startDate || ''}_${endDate || ''}`;
    const cached = this.getFromCache(cacheKey);
    
    if (cached) {
      return of(cached);
    }
    
    // 构建URL和查询参数，使用HttpParams提高性能
    let params = new HttpParams().set('region_id', regionId);
    
    if (startDate) {
      params = params.set('start_date', startDate);
    }
    
    if (endDate) {
      params = params.set('end_date', endDate);
    }
    
    this.setLoading(true);
    return this.http.get(`${this.apiUrl}/prices`, { params }).pipe(
      tap(response => {
        this.setLoading(false);
        this.addToCache(cacheKey, response);
      }),
      catchError(error => {
        this.setLoading(false);
        console.error('Error fetching prices:', error);
        return of({
          dates: [],
          prices: [],
          region_name: '',
          region_type: '',
          state_name: ''
        });
      }),
      shareReplay(1)
    );
  }

  // Get price predictions for a region
  getPredictions(regionId: string, monthsAhead: number = 5, includeConfidenceIntervals: boolean = false): Observable<any> {
    const cacheKey = `predictions_${regionId}_${monthsAhead}_${includeConfidenceIntervals}`;
    const cached = this.getFromCache(cacheKey);
    
    if (cached) {
      return of(cached);
    }
    
    let params = new HttpParams()
      .set('region_id', regionId)
      .set('months_ahead', monthsAhead.toString())
      .set('include_confidence', includeConfidenceIntervals.toString());
    
    this.setLoading(true);
    return this.http.get(`${this.apiUrl}/predict`, { params }).pipe(
      tap(response => {
        this.setLoading(false);
        this.addToCache(cacheKey, response);
      }),
      catchError(error => {
        this.setLoading(false);
        console.error('Error fetching predictions:', error);
        return of({
          dates: [],
          predictions: []
        });
      }),
      shareReplay(1)
    );
  }

  // Get region details
  getRegionDetails(regionId: string): Observable<any> {
    const cacheKey = `region_details_${regionId}`;
    const cached = this.getFromCache(cacheKey);
    
    if (cached) {
      return of(cached);
    }
    
    this.setLoading(true);
    return this.http.get(`${this.apiUrl}/region/${regionId}`).pipe(
      tap(response => {
        this.setLoading(false);
        this.addToCache(cacheKey, response, 60 * 60 * 1000); // 1小时缓存
      }),
      catchError(error => {
        this.setLoading(false);
        console.error('Error fetching region details:', error);
        return of({});
      }),
      shareReplay(1)
    );
  }

  // Get statistics for a region
  getStatistics(regionId: string, startDate?: string, endDate?: string): Observable<any> {
    const cacheKey = `statistics_${regionId}_${startDate || ''}_${endDate || ''}`;
    const cached = this.getFromCache(cacheKey);
    
    if (cached) {
      return of(cached);
    }
    
    let params = new HttpParams().set('region_id', regionId);
    
    if (startDate) {
      params = params.set('start_date', startDate);
    }
    
    if (endDate) {
      params = params.set('end_date', endDate);
    }
    
    this.setLoading(true);
    return this.http.get(`${this.apiUrl}/statistics`, { params }).pipe(
      tap(response => {
        this.setLoading(false);
        this.addToCache(cacheKey, response);
      }),
      catchError(error => {
        this.setLoading(false);
        console.error('Error fetching statistics:', error);
        return of({
          mean: 0,
          median: 0,
          stdDev: 0,
          min: 0,
          max: 0,
          percentile90: 0,
          skewness: 0
        });
      }),
      shareReplay(1)
    );
  }

  // Batch get prices for multiple regions
  getBulkPrices(regionIds: string[], startDate?: string, endDate?: string): Observable<{[key: string]: any}> {
    if (!regionIds || regionIds.length === 0) {
      return of({});
    }
    
    // Create request dictionary
    const requests: {[key: string]: Observable<any>} = {};
    
    // Create request for each region
    regionIds.forEach(regionId => {
      requests[regionId] = this.getPrices(regionId, startDate, endDate);
    });
    
    // Execute all requests in parallel
    return forkJoin(requests);
  }

  // Batch get predictions for multiple regions
  getBulkPredictions(regionIds: string[], monthsAhead: number = 5, includeConfidenceIntervals: boolean = false): Observable<{[key: string]: any}> {
    if (!regionIds || regionIds.length === 0) {
      return of({});
    }
    
    const requests: {[key: string]: Observable<any>} = {};
    
    regionIds.forEach(regionId => {
      requests[regionId] = this.getPredictions(regionId, monthsAhead, includeConfidenceIntervals);
    });
    
    return forkJoin(requests);
  }

  // Cache management methods
  private addToCache(key: string, data: any, expiryTime: number = this.DEFAULT_CACHE_TIME): void {
    const expiresAt = Date.now() + expiryTime;
    this.cache[key] = {
      data,
      timestamp: Date.now(),
      expiresAt
    };
  }

  private getFromCache(key: string): any | null {
    if (this.cache[key] && Date.now() < this.cache[key].expiresAt) {
      return this.cache[key].data;
    }
    return null;
  }

  // Clear cache
  public clearCache(key?: string): void {
    if (key) {
      delete this.cache[key];
    } else {
      this.cache = {};
    }
  }
}
