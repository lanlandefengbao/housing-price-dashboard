import { Component, OnInit, ViewChild, ElementRef, AfterViewInit } from '@angular/core';
import { FormGroup, FormControl, ReactiveFormsModule } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { Chart, registerables, ChartTypeRegistry, ScriptableContext, TooltipItem } from 'chart.js';
import { ApiService } from '../services/api.service';
import { FormsModule } from '@angular/forms';

// Register Chart.js components
Chart.register(...registerables);

// 统计数据接口
interface Statistics {
  mean: number;
  median: number;
  stdDev: number;
  skewness: number;
  percentile90: number;
}

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, FormsModule],
  templateUrl: './dashboard.component.html',
  styleUrls: ['./dashboard.component.css']
})
export class DashboardComponent implements OnInit, AfterViewInit {
  @ViewChild('priceChart') priceChartCanvas!: ElementRef;
  @ViewChild('priceBarChart') priceBarChartCanvas!: ElementRef;
  
  regions: any[] = [];
  filteredRegions: any[] = []; // 基于选择的州过滤的区域
  availableStates: string[] = []; // 可选的州列表
  selectedRegion: any;
  priceChart!: Chart;
  barChart!: Chart;
  isLoading = false;
  error: string | null = null;
  showingPrediction = false;
  
  // 统计摘要数据
  statistics: Statistics | null = null;
  
  // 预测控制
  showForecast: boolean = false;
  showConfidenceIntervals: boolean = false;
  predictionMonths: number = 5; // 固定为5个月
  
  // 图表数据状态
  hasChartData: boolean = false;
  
  // 所选月份用于柱状图显示
  selectedMonth: string | null = null;
  
  // 存储当前数据用于下载
  currentChartData: {
    dates: string[];
    datasets: any[];
  } = { dates: [], datasets: [] };
  
  // Form group for input controls
  formGroup = new FormGroup({
    regionIds: new FormControl<string[]>([]),
    selectedStates: new FormControl<string[]>([]),
    startDate: new FormControl(''),
    endDate: new FormControl(''),
    showConfidenceZone: new FormControl(false)
  });

  constructor(private apiService: ApiService) { }

  ngOnInit(): void {
    // Set default date range (last 3 years to today)
    const today = new Date();
    const threeYearsAgo = new Date();
    threeYearsAgo.setFullYear(today.getFullYear() - 3);
    
    this.formGroup.patchValue({
      startDate: this.formatDate(threeYearsAgo),
      endDate: this.formatDate(today)
    });
    
    // Load regions
    this.loadRegions();
  }
  
  ngAfterViewInit(): void {
    // 图表初始化后的操作
  }

  // Load available regions from API
  loadRegions(): void {
    this.isLoading = true;
    this.error = null;
    
    this.apiService.getRegions().subscribe({
      next: (response) => {
        this.regions = response.regions;
        
        // 提取唯一的州
        this.availableStates = [...new Set(this.regions.map(region => region.StateName))].sort();
        
        if (this.regions.length > 0) {
          // 默认选择第一个州
          const firstState = this.availableStates[0];
          this.formGroup.patchValue({ selectedStates: [firstState] });
          
          // 根据选择的州过滤区域
          this.onStateSelectionChange();
          
          // 加载价格数据
          this.loadPriceData();
        }
        this.isLoading = false;
      },
      error: (error) => {
        this.error = 'Failed to load regions. Please try again later.';
        console.error('Error loading regions:', error);
        this.isLoading = false;
      }
    });
  }
  
  // 当州选择变化时更新区域列表
  onStateSelectionChange(): void {
    const selectedStates = this.formGroup.value.selectedStates || [];
    
    if (selectedStates.length === 0) {
      this.filteredRegions = [];
      this.formGroup.patchValue({ regionIds: [] });
      return;
    }
    
    // 根据选择的州过滤区域
    this.filteredRegions = this.regions.filter(region => 
      selectedStates.includes(region.StateName)
    );
    
    // 如果当前选择的区域不在过滤后的列表中，更新选择
    const currentRegionIds = this.formGroup.value.regionIds || [];
    const validRegionIds = currentRegionIds.filter(id => 
      this.filteredRegions.some(region => region.RegionID === id)
    );
    
    // 如果没有有效的区域选择，默认选择第一个
    if (validRegionIds.length === 0 && this.filteredRegions.length > 0) {
      validRegionIds.push(this.filteredRegions[0].RegionID);
    }
    
    this.formGroup.patchValue({ regionIds: validRegionIds });
  }

  // Load price data for selected region
  loadPriceData(): void {
    const { regionIds, startDate, endDate } = this.formGroup.value;
    
    if (!regionIds || regionIds.length === 0) {
      this.hasChartData = false;
      return;
    }
    
    this.isLoading = true;
    this.error = null;
    this.showingPrediction = false;
    this.selectedMonth = null; // 重置选中的月份
    
    // Clear existing charts
    if (this.priceChart) {
      this.priceChart.destroy();
    }
    if (this.barChart) {
      this.barChart.destroy();
    }
    
    // Create arrays for storing multi-region data
    const datasets: any[] = [];
    let allDates: string[] = [];
    let allPrices: number[] = []; // 用于计算统计数据
    
    // Track loaded regions to know when all data is received
    let loadedCount = 0;
    
    // Array of colors for different regions
    const colors = [
      { border: 'rgba(54, 162, 235, 1)', background: 'rgba(54, 162, 235, 0.2)' },
      { border: 'rgba(75, 192, 192, 1)', background: 'rgba(75, 192, 192, 0.2)' },
      { border: 'rgba(153, 102, 255, 1)', background: 'rgba(153, 102, 255, 0.2)' },
      { border: 'rgba(255, 159, 64, 1)', background: 'rgba(255, 159, 64, 0.2)' },
      { border: 'rgba(255, 99, 132, 1)', background: 'rgba(255, 99, 132, 0.2)' },
      // Add more colors as needed
    ];
    
    // Load data for each selected region
    regionIds.forEach((regionId, index) => {
    this.apiService.getPrices(regionId, startDate || undefined, endDate || undefined).subscribe({
      next: (response) => {
          // Find region name
          const region = this.regions.find(r => r.RegionID === regionId);
          const regionName = region ? `${region.RegionName}, ${region.StateName}` : `Region ${regionId}`;
          
          // Add to datasets
          datasets.push({
            label: regionName,
            data: response.prices,
            borderColor: colors[index % colors.length].border,
            backgroundColor: colors[index % colors.length].background,
            borderWidth: 1,
            tension: 0.1,
            regionId: regionId
          });
          
          // 收集所有价格数据用于统计
          allPrices = [...allPrices, ...response.prices];
          
          // Update dates if needed
          if (response.dates.length > allDates.length) {
            allDates = response.dates;
          }
          
          // Check if all data is loaded
          loadedCount++;
          if (loadedCount === regionIds.length) {
            // 保存数据用于下载
            this.saveCurrentData(allDates, datasets);
            
            this.createOrUpdateChart(allDates, datasets);
            this.createOrUpdateBarChart(allDates, datasets);
            this.calculateStatistics(allPrices);
            this.hasChartData = datasets.length > 0 && allDates.length > 0;
        this.isLoading = false;
            
            // 如果预测选项已启用，自动加载预测数据
            if (this.showForecast) {
              this.loadPredictions();
            }
          }
      },
      error: (error) => {
        this.error = 'Failed to load price data. Please try again later.';
        console.error('Error loading price data:', error);
        this.isLoading = false;
          this.hasChartData = false;
        }
      });
    });
  }
  
  // 保存当前数据用于下载
  saveCurrentData(dates: string[], datasets: any[]): void {
    this.currentChartData = {
      dates: [...dates],
      datasets: datasets.map(ds => ({
        label: ds.label,
        data: [...ds.data],
        regionId: ds.regionId
      }))
    };
  }
  
  // 计算统计摘要数据
  calculateStatistics(prices: number[]): void {
    if (!prices || prices.length === 0) {
      this.statistics = null;
      return;
    }
    
    // 计算均值
    const mean = prices.reduce((sum, price) => sum + price, 0) / prices.length;
    
    // 排序用于中位数和百分位数
    const sortedPrices = [...prices].sort((a, b) => a - b);
    
    // 计算中位数
    const midIndex = Math.floor(sortedPrices.length / 2);
    const median = sortedPrices.length % 2 === 0
      ? (sortedPrices[midIndex - 1] + sortedPrices[midIndex]) / 2
      : sortedPrices[midIndex];
    
    // 计算标准差
    const squaredDiffs = prices.map(price => Math.pow(price - mean, 2));
    const variance = squaredDiffs.reduce((sum, sqDiff) => sum + sqDiff, 0) / prices.length;
    const stdDev = Math.sqrt(variance);
    
    // 计算偏度
    const cubedDiffs = prices.map(price => Math.pow((price - mean) / stdDev, 3));
    const skewness = cubedDiffs.reduce((sum, cubedDiff) => sum + cubedDiff, 0) / prices.length;
    
    // 计算90百分位
    const p90Index = Math.floor(sortedPrices.length * 0.9);
    const percentile90 = sortedPrices[p90Index];
    
    this.statistics = {
      mean,
      median,
      stdDev,
      skewness,
      percentile90
    };
  }

  // 处理图表点击事件 - 增强版，支持点击轴和数据点
  handleChartClick(event: MouseEvent): void {
    if (!this.priceChart) return;
    
    const points = this.priceChart.getElementsAtEventForMode(
      event,
      'nearest',
      { intersect: true },
      false
    );
    
    // 检查是否点击了数据点
    if (points.length > 0) {
      const firstPoint = points[0];
      const datasetIndex = firstPoint.datasetIndex;
      const index = firstPoint.index;
      const dataset = this.priceChart.data.datasets[datasetIndex] as any;
      
      if (dataset && !dataset['isPrediction'] && !dataset['isConfidenceBound']) {
        const clickedTime = this.priceChart.data.labels?.[index];
        if (clickedTime) {
          this.updateBarChartForDate(clickedTime.toString());
        }
      }
      return;
    }
    
    // 检查是否点击了X轴的日期标签
    const chartArea = this.priceChart.chartArea;
    const scales = this.priceChart.scales['x'];
    
    // 确保点击在X轴标签区域
    if (
      event.y > chartArea['bottom'] && 
      event.y < chartArea['bottom'] + 30 && 
      event.x >= scales.left && 
      event.x <= scales.right
    ) {
      // 找到最接近点击位置的标签
      const xPositions = scales.ticks.map((tick: any) => tick.x);
      let closestIndex = 0;
      let minDistance = Math.abs(event.x - xPositions[0]);
      
      for (let i = 1; i < xPositions.length; i++) {
        const distance = Math.abs(event.x - xPositions[i]);
        if (distance < minDistance) {
          minDistance = distance;
          closestIndex = i;
        }
      }
      
      const clickedLabel = this.priceChart.data.labels?.[closestIndex];
      if (clickedLabel) {
        this.updateBarChartForDate(clickedLabel.toString());
      }
    }
  }
  
  // 根据选中的月份更新柱状图
  updateBarChartForMonth(monthDate: string): void {
    if (!this.barChart || !this.currentChartData.dates.length) return;
    
    const monthIndex = this.currentChartData.dates.indexOf(monthDate);
    
    if (monthIndex === -1) return;
    
    // 提取该月的数据
    const monthlyData = this.currentChartData.datasets.map(dataset => {
      const dataPointValue = monthIndex < dataset.data.length ? dataset.data[monthIndex] : null;
      
      return {
        label: dataset.label,
        data: [dataPointValue],
        backgroundColor: this.getDatasetColor(dataset.label),
        borderColor: 'rgba(0, 0, 0, 0.1)',
        borderWidth: 1
      };
    }).filter(ds => ds.data[0] !== null); // 过滤掉没有数据的项目
    
    // 更新柱状图
    this.barChart.data.labels = [this.formatMonthYear(monthDate)];
    this.barChart.data.datasets = monthlyData;
    this.barChart.update();
  }
  
  // 获取数据集颜色
  getDatasetColor(label: string): string {
    if (!this.priceChart) return 'rgba(54, 162, 235, 1)';
    
    const dataset = this.priceChart.data.datasets.find(ds => ds.label === label);
    return dataset?.borderColor as string || 'rgba(54, 162, 235, 1)';
  }
  
  // 格式化日期为月份和年份
  formatMonthYear(dateString: string): string {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  }

  // 预测控制
  toggleForecast(): void {
    this.showForecast = !this.showForecast;
    
    if (this.showForecast) {
      this.loadPredictions();
    } else {
      this.showingPrediction = false;
      this.loadPriceData(); // 重新加载不带预测的数据
    }
  }
  
  toggleConfidenceIntervals(): void {
    this.showConfidenceIntervals = !this.showConfidenceIntervals;
    this.formGroup.patchValue({ showConfidenceZone: this.showConfidenceIntervals });
    
    if (this.showForecast) {
      // 重置图表，确保置信区间状态正确
      this.loadPriceData();
    }
  }

  // Load and show predictions
  loadPredictions(): void {
    this.clearPredictionDatasets();
    
    if (!this.showForecast || !this.priceChart || !this.formGroup.value.regionIds || this.formGroup.value.regionIds.length === 0) {
      return;
    }
    
    const regionIds = this.formGroup.value.regionIds;
    const showConfidenceZone = this.showConfidenceIntervals;
    const months = 5; // 固定为5个月
    
    this.isLoading = true;
    this.error = null;
    
    // 用于存储所有区域的最大未来日期
    let allFutureDates: string[] = [];
    // 用于存储所有区域的数据集信息，避免相互覆盖
    const allRegionsData: {[key: string]: any} = {};
    
    // For each region
    let loadedCount = 0;
    regionIds.forEach(regionId => {
      this.apiService.getPredictions(regionId, months, showConfidenceZone).subscribe({
      next: (response) => {
          // Find dataset index for this region
          const datasetIndex = this.priceChart.data.datasets.findIndex(
            ds => {
              const customDs = ds as any;
              return customDs.regionId === regionId && !customDs.isPrediction && !customDs.isConfidenceBound;
            }
          );
          
          if (datasetIndex !== -1) {
            // Get historical data
            const historicalDates = [...this.currentChartData.dates]; // 确保使用当前数据
            const historicalPrices = [...this.priceChart.data.datasets[datasetIndex].data] as number[];
            
            // 获取最后一个历史数据点
            const lastHistoricalDate = historicalDates[historicalDates.length - 1];
            const lastHistoricalPrice = historicalPrices[historicalPrices.length - 1];
            
            // 获取该区域最后一个历史数据点的日期作为起始日期
            const lastDate = new Date(lastHistoricalDate);
            
            // 获取原始数据集的颜色
            const originalColor = this.priceChart.data.datasets[datasetIndex].borderColor;
            const originalBgColor = this.priceChart.data.datasets[datasetIndex].backgroundColor;
            
            // 生成未来月份，从最后一个历史月份开始
            const futureDates = [];
            
            // 添加预测月份，从最后历史月份开始
            for (let i = 1; i <= months; i++) {
              const futureDate = new Date(lastDate);
              futureDate.setMonth(lastDate.getMonth() + i); // 从下一个月开始
              futureDates.push(this.formatDate(futureDate));
            }
            
            // 合并到全局未来日期数组
            allFutureDates = this.mergeAndSortDates(allFutureDates, futureDates);
            
            // 存储该区域的数据，稍后统一处理
            allRegionsData[regionId] = {
              datasetIndex,
              historicalDates,
              historicalPrices,
              lastHistoricalPrice,
              lastHistoricalDate,
              futureDates,
              predictions: response.predictions,
              originalColor,
              originalBgColor,
              confidenceIntervals: response.confidence_intervals,
              regionName: this.priceChart.data.datasets[datasetIndex].label
            };
          }
          
          // 检查是否所有预测都已加载
          loadedCount++;
          if (loadedCount === regionIds.length) {
            // 所有区域数据已加载，现在统一处理图表
            this.updateChartWithAllPredictions(allRegionsData, this.currentChartData.dates, allFutureDates, showConfidenceZone);
          this.showingPrediction = true;
            this.isLoading = false;
        }
      },
      error: (error) => {
        this.error = 'Failed to load prediction data. Please try again later.';
        console.error('Error loading predictions:', error);
        this.isLoading = false;
      }
    });
    });
  }
  
  // 合并并排序日期数组，确保没有重复
  mergeAndSortDates(dates1: string[], dates2: string[]): string[] {
    // 合并并去重
    const uniqueDates = Array.from(new Set([...dates1, ...dates2]));
    // 排序
    return uniqueDates.sort((a, b) => new Date(a).getTime() - new Date(b).getTime());
  }
  
  // 统一处理所有区域的预测数据
  updateChartWithAllPredictions(allRegionsData: {[key: string]: any}, historicalDates: string[], allFutureDates: string[], showConfidenceZone: boolean): void {
    if (!this.priceChart) return;
    
    // 移除所有现有的预测数据集
    this.priceChart.data.datasets = this.priceChart.data.datasets.filter(ds => {
      const customDs = ds as any;
      return !(customDs.isPrediction || customDs.isConfidenceBound);
    });
    
    // 创建包含所有历史日期和所有未来日期的完整日期数组
    const allDates = [...historicalDates]; // 首先确保历史日期不变
    
    // 仅将还不在历史日期中的未来日期添加进来
    allFutureDates.forEach(date => {
      if (!allDates.includes(date)) {
        allDates.push(date);
      }
    });
    
    // 确保日期是按时间顺序排序的
    allDates.sort((a, b) => new Date(a).getTime() - new Date(b).getTime());
    
    // 更新图表的X轴标签
    this.priceChart.data.labels = allDates;
    
    // 为每个区域更新数据集
    Object.keys(allRegionsData).forEach(regionId => {
      const regionData = allRegionsData[regionId];
      const datasetIndex = regionData.datasetIndex;
      
      // 为历史数据集创建扩展版本，填充未来日期部分为null
      const extendedHistData = [];
      
      // 为每个日期寻找对应的历史数据点
      for (const date of allDates) {
        const historicalIndex = regionData.historicalDates.indexOf(date);
        if (historicalIndex !== -1 && historicalIndex < regionData.historicalPrices.length) {
          extendedHistData.push(regionData.historicalPrices[historicalIndex]);
        } else {
          extendedHistData.push(null);
        }
      }
      
      // 更新历史数据集
      this.priceChart.data.datasets[datasetIndex].data = extendedHistData;
      
      // 创建预测数据集
      const predictionData = [];
      
      // 为每个日期寻找对应的预测数据点
      for (const date of allDates) {
        if (date === regionData.lastHistoricalDate) {
          // 确保最后一个历史数据点是预测的起点
          predictionData.push(regionData.lastHistoricalPrice);
        } else {
          // 获取日期在未来日期数组中的索引
          const futureIndex = regionData.futureDates.indexOf(date);
          
          if (futureIndex === -1) {
            // 如果不是未来日期，则为null
            predictionData.push(null);
          } else if (futureIndex >= 0 && futureIndex < regionData.predictions.length) {
            // 如果是有效的预测日期
            predictionData.push(regionData.predictions[futureIndex]);
          } else {
            predictionData.push(null);
          }
        }
      }
      
      // 添加预测数据集
      const predictionDataset: any = {
        label: `${regionData.regionName} (Prediction)`,
        data: predictionData,
        borderColor: regionData.originalColor,
        backgroundColor: 'transparent',
        borderDash: [5, 5],
        borderWidth: 2,
        tension: 0.1,
        regionId: regionId,
        isPrediction: true
      };
      
      this.priceChart.data.datasets.push(predictionDataset);
      
      // 添加置信区间（如果启用）
      if (showConfidenceZone && regionData.confidenceIntervals) {
        // 使用浅绿色作为置信区间填充色
        const confidenceColor = 'rgba(144, 238, 144, 0.3)'; // 浅绿色
        
        // 准备置信区间数据
        const upperData = [];
        const lowerData = [];
        
        // 为每个日期寻找对应的置信区间数据点
        for (const date of allDates) {
          if (date === regionData.lastHistoricalDate) {
            // 确保最后一个历史数据点是置信区间的起点
            upperData.push(regionData.lastHistoricalPrice);
            lowerData.push(regionData.lastHistoricalPrice);
          } else {
            // 获取日期在未来日期数组中的索引
            const futureIndex = regionData.futureDates.indexOf(date);
            
            if (futureIndex === -1) {
              // 如果不是未来日期，则为null
              upperData.push(null);
              lowerData.push(null);
            } else if (futureIndex >= 0 && futureIndex < regionData.confidenceIntervals.upper.length) {
              // 如果是有效的预测日期
              upperData.push(regionData.confidenceIntervals.upper[futureIndex]);
              lowerData.push(regionData.confidenceIntervals.lower[futureIndex]);
            } else {
              upperData.push(null);
              lowerData.push(null);
            }
          }
        }
        
        // 重要：先添加下界，再添加上界，这样填充才正确
        // 下界
        const lowerBoundDataset: any = {
          label: 'Lower Bound',
          data: lowerData,
          borderColor: 'transparent',
          backgroundColor: 'transparent',
          tension: 0.1,
          pointRadius: 0,
          regionId: regionId,
          isConfidenceBound: true
        };
        
        // 上界
        const upperBoundDataset: any = {
          label: 'Upper Bound',
          data: upperData,
          borderColor: 'transparent',
          backgroundColor: confidenceColor,
          fill: '-1', // 填充到前一个数据集（即下界）
          tension: 0.1,
          pointRadius: 0,
          regionId: regionId,
          isConfidenceBound: true
        };
        
        // 添加置信区间数据集 - 顺序很重要
        this.priceChart.data.datasets.push(lowerBoundDataset);
        this.priceChart.data.datasets.push(upperBoundDataset);
      }
      
      // 更新当前数据中预测部分，用于下载
      const predictionDatasetForDownload = {
        label: predictionDataset.label,
        data: predictionData,
        regionId: regionId,
        borderColor: regionData.originalColor,
        backgroundColor: regionData.originalBgColor
      };
      
      // 更新当前数据中预测部分
      const existingDatasetIndex = this.currentChartData.datasets.findIndex(
        ds => ds.regionId === regionId && ds.label?.includes('(Prediction)')
      );
      
      if (existingDatasetIndex !== -1) {
        this.currentChartData.datasets[existingDatasetIndex] = predictionDatasetForDownload;
      } else {
        this.currentChartData.datasets.push(predictionDatasetForDownload);
      }
    });
    
    // 更新当前数据中的日期
    this.currentChartData.dates = allDates;
    
    // 更新图表
      this.priceChart.update();
    
    // 更新柱状图显示预测数据
    Object.keys(allRegionsData).forEach(regionId => {
      this.updateBarChartWithPredictions(regionId, allRegionsData[regionId].predictions);
    });
  }

  // Create or update the chart
  createOrUpdateChart(labels: string[], datasets: any[]): void {
    const ctx = this.priceChartCanvas.nativeElement.getContext('2d');
    
    // 确保图表显示数据
    if (ctx) {
      this.priceChart = new Chart(ctx, {
        type: 'line',
        data: {
          labels: labels,
          datasets: datasets
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          scales: {
            y: {
              title: {
                display: true,
                text: 'Price ($)'
              },
              beginAtZero: false
            },
            x: {
              title: {
                display: true,
                text: 'Date'
              },
              ticks: {
                // 修复标签重叠问题
                maxRotation: 45,
                minRotation: 45,
                autoSkip: true,
                maxTicksLimit: 12
              }
            }
          },
          plugins: {
            legend: {
              position: 'top',
              align: 'end',
              // 改进图例显示以避免重叠
              labels: {
                boxWidth: 15,
                padding: 10,
                usePointStyle: true,
                // 过滤掉置信区间的图例
                filter: (legendItem: any) => {
                  return !legendItem.text.includes('Upper Bound') && !legendItem.text.includes('Lower Bound');
                }
              }
            },
            tooltip: {
              // 过滤掉置信区间的tooltip
              filter: (tooltipItem: any) => {
                const datasetLabel = tooltipItem.dataset.label || '';
                return !datasetLabel.includes('Upper Bound') && !datasetLabel.includes('Lower Bound');
              },
              callbacks: {
                label: function(context: TooltipItem<"line">) {
                  let label = context.dataset.label || '';
                  if (label) {
                    label += ': ';
                  }
                  if (context.parsed.y !== null) {
                    label += new Intl.NumberFormat('en-US', {
                      style: 'currency',
                      currency: 'USD'
                    }).format(context.parsed.y);
                  }
                  return label;
                }
              }
            }
          }
        }
      });
      
      // 添加点击事件监听器
      this.priceChartCanvas.nativeElement.onclick = (event: MouseEvent) => {
        this.handleChartClick(event);
      };
    } else {
      console.error('Failed to get canvas context');
    }
  }

  // Helper method to format dates
  formatDate(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  // Helper method to convert hex color to rgba
  hexToRgba(hex: string, alpha: number): string {
    // Check if it's a valid hex color
    if (!hex || typeof hex !== 'string' || !hex.startsWith('#') || hex.length < 7) {
      return `rgba(54, 162, 235, ${alpha})`; // Default color if invalid
    }
    
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }

  // Create or update bar chart
  createOrUpdateBarChart(labels: string[], datasets: any[]): void {
    // 如果已选择特定月份，则不使用年度平均
    if (this.selectedMonth) {
      this.updateBarChartForMonth(this.selectedMonth);
      return;
    }
    
    // Extract data for bar chart (e.g., yearly averages)
    const yearlyData = this.aggregateDataByYear(labels, datasets);
    
    if (this.barChart) {
      this.barChart.data.labels = yearlyData.years;
      this.barChart.data.datasets = yearlyData.datasets;
      this.barChart.update();
    } else {
      const ctx = this.priceBarChartCanvas.nativeElement.getContext('2d');
      if (ctx) {
        this.barChart = new Chart(ctx, {
          type: 'bar',
          data: {
            labels: yearlyData.years,
            datasets: yearlyData.datasets
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
              y: {
                title: {
                  display: true,
                  text: 'Avg. Price ($)'
                },
                beginAtZero: false
              },
              x: {
                title: {
                  display: true,
                  text: 'Year'
                }
              }
            },
            plugins: {
              legend: {
                position: 'top',
                align: 'end',
                // 改进图例显示
                labels: {
                  boxWidth: 15,
                  padding: 10,
                  usePointStyle: true,
                  filter: (legendItem: any) => {
                    return !legendItem.text.includes('Upper Bound') && !legendItem.text.includes('Lower Bound');
                  }
                }
              },
              tooltip: {
                callbacks: {
                  label: function(context: TooltipItem<"bar">) {
                    let label = context.dataset.label || '';
                    if (label) {
                      label += ': ';
                    }
                    if (context.parsed.y !== null) {
                      label += new Intl.NumberFormat('en-US', {
                        style: 'currency',
                        currency: 'USD'
                      }).format(context.parsed.y);
                    }
                    return label;
                  }
                }
              }
            }
          }
        });
      } else {
        console.error('Failed to get bar chart canvas context');
      }
    }
  }

  // Helper method to aggregate data by year for bar chart
  aggregateDataByYear(dates: string[], datasets: any[]): { years: string[], datasets: any[] } {
    const yearlyData: any = {};
    
    // Initialize data structure
    datasets.forEach(dataset => {
      const regionName = dataset.label;
      const data = dataset.data;
      
      if (!data || data.length === 0) return;
      
      for (let i = 0; i < dates.length && i < data.length; i++) {
        const price = data[i];
        if (price !== null && !isNaN(price)) {
          const date = new Date(dates[i]);
          const year = date.getFullYear().toString();
          
          if (!yearlyData[year]) {
            yearlyData[year] = {};
          }
          
          if (!yearlyData[year][regionName]) {
            yearlyData[year][regionName] = {
              sum: 0,
              count: 0
            };
          }
          
          yearlyData[year][regionName].sum += price;
          yearlyData[year][regionName].count += 1;
        }
      }
    });
    
    // Calculate averages and prepare chart data
    const years = Object.keys(yearlyData).sort();
    const barDatasets = datasets.map(dataset => {
      const regionName = dataset.label;
      const yearlyAverages = years.map(year => {
        if (yearlyData[year] && yearlyData[year][regionName]) {
          return yearlyData[year][regionName].sum / yearlyData[year][regionName].count;
        }
        return null;
      });
      
      // 使用原始数据集的颜色属性，确保预测数据也有正确的颜色
      const backgroundColor = dataset.borderColor || dataset.backgroundColor || 'rgba(54, 162, 235, 1)';
      
      return {
        label: regionName,
        data: yearlyAverages,
        backgroundColor: backgroundColor,
        borderColor: 'rgba(0, 0, 0, 0.1)',
        borderWidth: 1,
        regionId: dataset.regionId
      };
    }).filter(ds => ds.data.some((val: any) => val !== null)); // 过滤掉没有有效数据的数据集
    
    return { years, datasets: barDatasets };
  }

  // Update bar chart with prediction data
  updateBarChartWithPredictions(regionId: string, predictions: number[]) {
    // 如果当前显示的是特定月份数据，不更新年度平均
    if (this.selectedMonth) return;
    
    // 重新创建柱状图以确保数据完整性
    if (this.barChart && this.currentChartData.dates.length > 0) {
      this.createOrUpdateBarChart(this.currentChartData.dates, this.currentChartData.datasets);
    }
  }
  
  // 下载当前图表数据
  downloadChartData(): void {
    if (!this.hasChartData) return;
    
    // 创建CSV内容
    let csvContent = 'Date';
    
    // 添加标题行
    this.currentChartData.datasets.forEach(dataset => {
      csvContent += `,${dataset.label}`;
    });
    csvContent += '\n';
    
    // 添加数据行
    this.currentChartData.dates.forEach((date, index) => {
      csvContent += date;
      
      this.currentChartData.datasets.forEach(dataset => {
        const value = index < dataset.data.length ? dataset.data[index] : '';
        csvContent += `,${value}`;
      });
      
      csvContent += '\n';
    });
    
    // 创建下载链接
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', 'housing_price_data.csv');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  // 清除预测数据集
  clearPredictionDatasets(): void {
    if (!this.priceChart) return;
    
    this.priceChart.data.datasets = this.priceChart.data.datasets.filter(ds => {
      // 添加空值检查，防止ds.label为undefined
      const label = ds?.label ?? '';
      return !label.includes('(Prediction)');
    });
    this.priceChart.update();
  }

  // 更新柱状图以显示特定日期的数据
  updateBarChartForDate(date: string): void {
    if (!this.barChart || !this.currentChartData.dates.length) return;
    
    const monthIndex = this.currentChartData.dates.indexOf(date);
    
    if (monthIndex === -1) return;
    
    // 提取该日的数据
    const dailyData = this.currentChartData.datasets.map(dataset => {
      const dataPointValue = monthIndex < dataset.data.length ? dataset.data[monthIndex] : null;
      const dsLabel = dataset.label || '未命名区域';
      
      return {
        label: dsLabel,
        data: [dataPointValue],
        backgroundColor: this.getDatasetColor(dsLabel),
        borderColor: 'rgba(0, 0, 0, 0.1)',
        borderWidth: 1
      };
    }).filter(ds => ds.data && ds.data[0] !== null); // 添加额外检查确保ds.data存在
    
    // 更新柱状图
    this.barChart.data.labels = [this.formatMonthYear(date)];
    this.barChart.data.datasets = dailyData;
    this.barChart.update();
  }

  // 格式化日期为API格式
  formatDateForApi(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
}
