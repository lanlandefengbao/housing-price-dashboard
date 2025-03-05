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

  // 优化：使用API服务的批量加载功能加载价格数据
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
    
    // 使用批量加载所有选中区域的价格数据
    this.apiService.getBulkPrices(regionIds, startDate || undefined, endDate || undefined)
      .subscribe({
        next: (responses) => {
          // 创建要显示的数据集
          const datasets: any[] = [];
          let allDates: string[] = [];
          let allPrices: number[] = []; // 用于计算统计数据
          
          // 颜色数组用于不同区域
          const colors = [
            { border: 'rgba(54, 162, 235, 1)', background: 'rgba(54, 162, 235, 0.2)' },
            { border: 'rgba(75, 192, 192, 1)', background: 'rgba(75, 192, 192, 0.2)' },
            { border: 'rgba(153, 102, 255, 1)', background: 'rgba(153, 102, 255, 0.2)' },
            { border: 'rgba(255, 159, 64, 1)', background: 'rgba(255, 159, 64, 0.2)' },
            { border: 'rgba(255, 99, 132, 1)', background: 'rgba(255, 99, 132, 0.2)' },
            // Add more colors as needed
          ];
          
          // 处理每个区域的响应
          Object.keys(responses).forEach((regionId, index) => {
            const response = responses[regionId];
            
            // 找出区域名称
            const region = this.regions.find(r => r.RegionID === regionId);
            const regionName = region ? `${region.RegionName}, ${region.StateName}` : `Region ${regionId}`;
            
            // 添加到数据集
            datasets.push({
              label: regionName,
              data: response.prices,
              borderColor: colors[index % colors.length].border,
              backgroundColor: colors[index % colors.length].background,
              borderWidth: 1,
              tension: 0.1,
              regionId: regionId
            });
            
            // 收集所有价格用于统计
            allPrices = [...allPrices, ...response.prices];
            
            // 更新日期数组，选择最长的
            if (response.dates.length > allDates.length) {
              allDates = response.dates;
            }
          });
          
          // 保存当前数据用于下载
          if (this.currentChartData) {
            this.currentChartData.dates = [...allDates];
            this.currentChartData.datasets = datasets.map(ds => ({
              label: ds.label,
              data: [...ds.data],
              regionId: ds.regionId
            }));
          } else {
            this.currentChartData = {
              dates: [...allDates],
              datasets: datasets.map(ds => ({
                label: ds.label,
                data: [...ds.data],
                regionId: ds.regionId
              }))
            };
          }
          
          // 创建或更新图表
          this.createOrUpdateChart(allDates, datasets);
          this.createOrUpdateBarChart(allDates, datasets);
          
          // 使用优化后的统计API获取统计数据 - 如果选择了单个区域
          if (regionIds.length === 1) {
            // 获取统计数据
            this.apiService.getStatistics(regionIds[0], startDate || undefined, endDate || undefined).subscribe({
              next: (stats) => {
                this.statistics = {
                  mean: stats.mean,
                  median: stats.median,
                  stdDev: stats.stdDev,
                  skewness: stats.skewness,
                  percentile90: stats.percentile90
                };
              },
              error: () => {
                // 如果API调用失败，回退到前端计算
                if (allPrices && allPrices.length > 0) {
                  // 使用现有的calculateStatistics方法
                  this.doCalculateStatistics(allPrices);
                } else {
                  this.statistics = null;
                }
              }
            });
          } else if (allPrices && allPrices.length > 0) {
            // 对于多个区域，使用合并的价格计算
            this.doCalculateStatistics(allPrices);
          } else {
            this.statistics = null;
          }
          
          this.hasChartData = datasets.length > 0 && allDates.length > 0;
          this.isLoading = false;
          
          // 如果预测选项已启用，自动加载预测数据
          if (this.showForecast && this.hasChartData) {
            // 延迟一点时间以确保图表已完全渲染
            setTimeout(() => {
              this.doLoadPredictions();
            }, 100);
          }
        },
        error: (error) => {
          this.error = 'Failed to load price data. Please try again later.';
          console.error('Error loading price data:', error);
          this.isLoading = false;
          this.hasChartData = false;
        }
      });
  }
  
  // 计算统计数据 - 重命名以避免冲突
  doCalculateStatistics(prices: number[]): void {
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

  // Toggle forecast display
  toggleForecast(): void {
    this.showForecast = !this.showForecast;
    
    if (this.showForecast && this.hasChartData) {
      // 加载预测数据
      this.doLoadPredictions();
    } else if (!this.showForecast && this.priceChart) {
      // 移除预测数据集
      this.priceChart.data.datasets = this.priceChart.data.datasets.filter(dataset => {
        const customDataset = dataset as any;
        return !customDataset.isPrediction && !customDataset.isConfidenceBound;
      });
      
      // 恢复原始日期
      if (this.currentChartData && this.currentChartData.dates) {
        this.priceChart.data.labels = [...this.currentChartData.dates];
        this.priceChart.update();
      }
    }
  }
  
  // Toggle confidence intervals display
  toggleConfidenceIntervals(): void {
    this.showConfidenceIntervals = !this.showConfidenceIntervals;
    
    if (this.showForecast) {
      // 重新加载预测以更新置信区间显示
      this.doLoadPredictions();
    }
  }
  
  // 优化：加载预测使用批量加载优化 - 重命名以避免冲突
  doLoadPredictions(): void {
    if (!this.showForecast || !this.priceChart || !this.formGroup.value.regionIds || this.formGroup.value.regionIds.length === 0) {
      return;
    }
    
    // 清除预测数据集
    this.priceChart.data.datasets = this.priceChart.data.datasets.filter(dataset => {
      const customDataset = dataset as any;
      return !customDataset.isPrediction && !customDataset.isConfidenceBound;
    });
    
    // 恢复原始日期
    if (this.currentChartData && this.currentChartData.dates) {
      this.priceChart.data.labels = [...this.currentChartData.dates];
      this.priceChart.update();
    }
    
    const regionIds = this.formGroup.value.regionIds;
    const showConfidenceZone = this.showConfidenceIntervals;
    const months = 5; // 固定为5个月
    
    this.isLoading = true;
    this.error = null;
    
    // 使用批量加载预测数据
    this.apiService.getBulkPredictions(regionIds, months, showConfidenceZone)
      .subscribe({
        next: (responses) => {
          // 用于存储所有区域的最大未来日期
          let allFutureDates: string[] = [];
          // 用于存储所有区域的数据集信息
          const allRegionsData: {[key: string]: any} = {};
          
          // 处理每个区域的预测响应
          Object.keys(responses).forEach(regionId => {
            const response = responses[regionId];
            
            // 找到该区域在图表中的索引
            const datasetIndex = this.priceChart.data.datasets.findIndex(
              ds => {
                const customDs = ds as any;
                return customDs.regionId === regionId && !customDs.isPrediction && !customDs.isConfidenceBound;
              }
            );
            
            if (datasetIndex !== -1) {
              // 获取历史数据
              const historicalDates = [...this.currentChartData.dates];
              const historicalPrices = [...this.priceChart.data.datasets[datasetIndex].data] as number[];
              
              // 获取最后一个历史数据点
              const lastHistoricalDate = historicalDates[historicalDates.length - 1];
              const lastHistoricalPrice = historicalPrices[historicalPrices.length - 1];
              
              // 获取颜色
              const originalColor = this.priceChart.data.datasets[datasetIndex].borderColor;
              const originalBgColor = this.priceChart.data.datasets[datasetIndex].backgroundColor;
              
              // 合并到全局未来日期数组 - 使用正确的字段名(dates)
              allFutureDates = this.mergeAndSortDates(allFutureDates, response.dates);
              
              // 存储该区域的数据
              allRegionsData[regionId] = {
                datasetIndex,
                historicalDates,
                historicalPrices,
                lastHistoricalPrice,
                lastHistoricalDate,
                futureDates: response.dates,
                predictions: response.predictions,
                originalColor,
                originalBgColor,
                confidenceIntervals: response.confidence_intervals,
                regionName: this.priceChart.data.datasets[datasetIndex].label
              };
            }
          });
          
          // 添加预测数据到图表
          this.updateChartWithAllPredictions(allRegionsData, this.currentChartData.dates, allFutureDates, showConfidenceZone);
          
          this.showingPrediction = true;
          this.isLoading = false;
        },
        error: (error) => {
          this.error = 'Failed to load predictions. Please try again later.';
          console.error('Error loading predictions:', error);
          this.isLoading = false;
        }
      });
  }
  
  // 将预测数据添加到图表
  updateChartWithAllPredictions(
    allRegionsData: {[key: string]: any}, 
    historicalDates: string[], 
    futureDates: string[], 
    showConfidenceIntervals: boolean
  ): void {
    if (!this.priceChart) return;
    
    // 预测线的颜色
    const predictionDatasets: any[] = [];
    const confidenceBoundsDatasets: any[] = [];
    
    // 处理每个区域的预测
    Object.keys(allRegionsData).forEach(regionId => {
      const regionData = allRegionsData[regionId];
      
      // 创建预测数据集 - 使用更平滑的曲线
      const predictionDataset = {
        label: `${regionData.regionName} (Predicted)`,
        data: Array(historicalDates.length).fill(null),
        borderColor: regionData.originalColor,
        backgroundColor: 'transparent',
        borderDash: [5, 5],
        pointStyle: 'circle',
        pointRadius: 3,
        pointHoverRadius: 5,
        fill: false,
        tension: 0.4, // 增加张力使曲线更平滑
        regionId: regionId,
        isPrediction: true
      };
      
      // 添加最后一个历史点作为连接点
      const lastDateIndex = historicalDates.indexOf(regionData.lastHistoricalDate);
      if (lastDateIndex !== -1) {
        predictionDataset.data[lastDateIndex] = regionData.lastHistoricalPrice;
      }
      
      // 添加预测数据点
      regionData.futureDates.forEach((date: string, i: number) => {
        // 确认未来日期不在历史日期中
        if (historicalDates.indexOf(date) === -1) {
          predictionDataset.data.push(regionData.predictions[i]);
        }
      });
      
      predictionDatasets.push(predictionDataset);
      
      // 如果需要创建置信区间
      if (showConfidenceIntervals && regionData.confidenceIntervals) {
        // 创建独立的上下限数据集
        const lowerBoundDataset = {
          label: `${regionData.regionName} (Lower Bound)`,
          data: Array(historicalDates.length).fill(null),
          borderColor: this.convertToTransparentColor(regionData.originalColor, 0.3),
          borderDash: [3, 3],
          backgroundColor: 'transparent',
          pointStyle: 'circle',
          pointRadius: 0,
          tension: 0.4, // 匹配预测线的张力
          regionId: regionId,
          isConfidenceBound: true,
          isLowerBound: true // 标记为下限
        };
        
        const upperBoundDataset = {
          label: `${regionData.regionName} (Upper Bound)`,
          data: Array(historicalDates.length).fill(null),
          borderColor: this.convertToTransparentColor(regionData.originalColor, 0.3),
          borderDash: [3, 3],
          backgroundColor: this.convertToTransparentColor(regionData.originalColor, 0.2),
          pointStyle: 'circle',
          pointRadius: 0,
          tension: 0.4, // 匹配预测线的张力
          fill: false, // 独立绘制
          regionId: regionId,
          isConfidenceBound: true,
          isUpperBound: true // 标记为上限
        };
        
        // 添加最后一个历史点作为连接点
        if (lastDateIndex !== -1) {
          // 使用最后一个历史价格作为起点，但在下方加一小部分以确保区域正确
          const lastPrice = regionData.lastHistoricalPrice;
          lowerBoundDataset.data[lastDateIndex] = lastPrice;
          upperBoundDataset.data[lastDateIndex] = lastPrice;
        }
        
        // 添加预测数据的置信区间数据点
        regionData.futureDates.forEach((date: string, i: number) => {
          if (historicalDates.indexOf(date) === -1 && 
              regionData.confidenceIntervals && 
              regionData.confidenceIntervals[i]) {
            
            lowerBoundDataset.data.push(regionData.confidenceIntervals[i][0]); // 下限
            upperBoundDataset.data.push(regionData.confidenceIntervals[i][1]); // 上限
          }
        });
        
        // 创建填充区域数据集 - 这将在上下限之间创建填充
        const confidenceAreaDataset = {
          label: `${regionData.regionName} (Confidence Area)`,
          data: Array(historicalDates.length).fill(null),
          borderColor: 'transparent',
          backgroundColor: this.convertToTransparentColor(regionData.originalColor, 0.2),
          pointStyle: 'circle',
          pointRadius: 0,
          tension: 0.4,
          fill: false,
          regionId: regionId,
          isConfidenceBound: true,
          isArea: true
        };
        
        // 复制上限数据
        if (lastDateIndex !== -1) {
          confidenceAreaDataset.data[lastDateIndex] = regionData.lastHistoricalPrice;
        }
        
        regionData.futureDates.forEach((date: string, i: number) => {
          if (historicalDates.indexOf(date) === -1 && 
              regionData.confidenceIntervals && 
              regionData.confidenceIntervals[i]) {
            confidenceAreaDataset.data.push(regionData.confidenceIntervals[i][1]); // 上限
          }
        });
        
        // 先添加下限，然后是填充区域，最后是上限
        confidenceBoundsDatasets.push(lowerBoundDataset, confidenceAreaDataset, upperBoundDataset);
      }
    });
    
    // 更新图表数据
    this.priceChart.data.labels = [...historicalDates, ...futureDates];
    
    // 先添加信任区间，再添加预测线，这样预测线会显示在最上层
    this.priceChart.data.datasets = [
      ...this.priceChart.data.datasets.filter(ds => {
        const customDs = ds as any;
        return !customDs.isPrediction && !customDs.isConfidenceBound;
      })
    ];
    
    // 如果有置信区间，先添加它们
    if (confidenceBoundsDatasets.length > 0) {
      // 将置信区间添加到数据集
      this.priceChart.data.datasets = [
        ...this.priceChart.data.datasets,
        ...confidenceBoundsDatasets
      ];
    }
    
    // 然后添加预测线到最上层
    this.priceChart.data.datasets = [
      ...this.priceChart.data.datasets,
      ...predictionDatasets
    ];
    
    // 确保图表配置正确处理填充区域
    const chartOptions = this.priceChart.options;
    if (chartOptions && chartOptions.plugins && chartOptions.plugins.tooltip) {
      // 更新tooltip过滤器，隐藏置信区间的tooltip
      chartOptions.plugins.tooltip.filter = (tooltipItem: any) => {
        const datasetLabel = tooltipItem.dataset.label || '';
        return !datasetLabel.includes('Bound') && !datasetLabel.includes('Confidence Area');
      };
    }
    
    // 配置数据集之间的填充关系
    this.priceChart.data.datasets.forEach((dataset: any, index: number) => {
      if (dataset.isArea) {
        // 查找相应的下限数据集索引
        const lowerBoundIndex = this.priceChart.data.datasets.findIndex(
          (ds: any) => ds.regionId === dataset.regionId && ds.isLowerBound
        );
        
        if (lowerBoundIndex !== -1) {
          // 设置填充目标为下限数据集
          dataset.fill = {
            target: lowerBoundIndex,
            above: this.convertToTransparentColor(dataset.borderColor || '#36a2eb', 0.2)
          };
        }
      }
    });
    
    // 更新图表
    this.priceChart.update();
  }
  
  // 辅助方法：转换颜色为透明色
  convertToTransparentColor(color: string, opacity: number): string {
    if (color.startsWith('rgba')) {
      // 已经是rgba格式，替换透明度
      return color.replace(/rgba\((\d+),\s*(\d+),\s*(\d+),\s*[\d\.]+\)/, `rgba($1, $2, $3, ${opacity})`);
    } else if (color.startsWith('rgb')) {
      // rgb格式转为rgba
      return color.replace(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/, `rgba($1, $2, $3, ${opacity})`);
    } else {
      // 假设是十六进制颜色
      return color;
    }
  }

  // Create or update the chart
  createOrUpdateChart(labels: string[], datasets: any[]): void {
    const ctx = this.priceChartCanvas.nativeElement.getContext('2d');
    
    // 确保图表显示数据
    if (ctx) {
      // 增加所有数据集的平滑度
      datasets.forEach(dataset => {
        if (!dataset.hasOwnProperty('tension')) {
          dataset.tension = 0.3; // 为所有数据集设置平滑度
        }
      });
      
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
          elements: {
            line: {
              tension: 0.3 // 全局增加曲线平滑度
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
                  return !legendItem.text.includes('Upper Bound') && 
                         !legendItem.text.includes('Lower Bound') && 
                         !legendItem.text.includes('Confidence Area');
                }
              }
            },
            tooltip: {
              // 过滤掉置信区间的tooltip
              filter: (tooltipItem: any) => {
                const datasetLabel = tooltipItem.dataset.label || '';
                return !datasetLabel.includes('Upper Bound') && 
                       !datasetLabel.includes('Lower Bound') && 
                       !datasetLabel.includes('Confidence Area');
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

  // 合并并排序日期数组，确保没有重复
  mergeAndSortDates(dates1: string[], dates2: string[]): string[] {
    // 合并并去重
    const uniqueDates = Array.from(new Set([...dates1, ...dates2]));
    // 排序
    return uniqueDates.sort((a, b) => new Date(a).getTime() - new Date(b).getTime());
  }
  
  // 处理图表点击
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
  
  // 根据选中的日期更新柱状图
  updateBarChartForDate(selectedDate: string): void {
    if (!this.barChart || !this.currentChartData.dates.length) return;
    this.selectedMonth = this.formatMonthYear(selectedDate);
    this.updateBarChartForMonth(selectedDate);
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
}
