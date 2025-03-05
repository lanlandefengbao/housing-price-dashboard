# housing-price-dashboard/backend/app.py
import pandas as pd
import numpy as np
from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS
import tensorflow as tf
from tensorflow.keras.models import load_model
from tensorflow.keras.losses import MeanSquaredError
from tensorflow.keras.metrics import MeanSquaredError as MSE_Metric
from sklearn.preprocessing import MinMaxScaler
import datetime
import os
import functools  # 用于缓存装饰器
from typing import Dict, Tuple, List, Any
import time

# 设置TensorFlow日志级别和内存增长
tf.compat.v1.logging.set_verbosity(tf.compat.v1.logging.ERROR)
# 允许GPU内存增长
gpus = tf.config.list_physical_devices('GPU')
if gpus:
    try:
        for gpu in gpus:
            tf.config.experimental.set_memory_growth(gpu, True)
    except RuntimeError as e:
        print(f"GPU设置错误: {e}")

app = Flask(__name__)
CORS(app, resources={r"/api/*": {"origins": "*"}})  # Enable CORS for all origins, only for API routes

# Global variables to store data and model
data = None
model = None
price_scaler = MinMaxScaler()

# 添加缓存
region_cache: Dict[str, pd.DataFrame] = {}  # 存储区域数据的缓存
prediction_cache: Dict[Tuple[str, int, bool], Dict[str, Any]] = {}  # 预测结果缓存
statistics_cache: Dict[str, Dict[str, float]] = {}  # 统计结果缓存
cache_timestamp = 0  # 缓存时间戳，用于缓存失效

def load_data():
    """Load and preprocess the housing price data"""
    global data, cache_timestamp
    
    # 记录缓存加载时间
    cache_timestamp = time.time()
    
    # 使用dtype_backend='numpy_nullable'加速数值处理
    # 使用低精度数据类型减少内存使用
    dtypes = {
        'RegionID': 'str', 
        'SizeRank': 'int32',
        'Price': 'float32'
    }
    
    # Load data with optimized types
    raw_df = pd.read_csv('Data.csv', dtype=dtypes)
    
    # Convert to long format
    melted = pd.melt(
        raw_df,
        id_vars=['RegionID', 'SizeRank', 'RegionName', 'RegionType', 'StateName'],
        var_name='Date',
        value_name='Price'
    )
    
    # Convert to time series
    melted['Date'] = pd.to_datetime(melted['Date'])
    melted = melted.sort_values(['RegionID', 'Date']).reset_index(drop=True)
    
    # Convert price to numeric - with optimized type
    melted['Price'] = pd.to_numeric(melted['Price'], errors='coerce', downcast='float')
    
    # Handle missing values
    melted['Price'] = melted.groupby('RegionID')['Price'].transform(
        lambda x: x.interpolate(method='linear', limit_direction='both') if x.notnull().sum() > 0 else x
    )
    
    # Additional missing value handling
    melted['Year'] = melted['Date'].dt.year
    year_means = melted.groupby(['RegionType', 'Year'])['Price'].transform(
        lambda x: x.mean() if not np.isnan(x.mean()) else 0
    )
    melted['Price'] = melted['Price'].fillna(year_means)
    
    # Final missing value handling
    melted['Price'] = melted['Price'].fillna(0)
    
    # Create month feature for faster filtering
    melted['Month'] = melted['Date'].dt.month
    
    data = melted
    
    # 创建区域索引 - 提前获取所有RegionID的数据预处理并缓存
    unique_regions = data['RegionID'].unique()
    for region_id in unique_regions:
        region_cache[region_id] = data[data['RegionID'] == region_id].sort_values('Date')
    
    # 清空预测缓存(因为数据已更新)
    prediction_cache.clear()
    statistics_cache.clear()

def load_model_():
    """Load the TensorFlow housing price prediction model"""
    global model
    
    try:
        # 为TF 2.x优化，不再需要显式设置会话
        # 尝试直接加载模型
        model = load_model('markov_model.h5', compile=False)
        # 如有必要，手动编译模型
        model.compile(optimizer='adam', loss=MeanSquaredError(), metrics=[MSE_Metric()])
    except (ImportError, TypeError) as e:
        print(f"标准加载失败，尝试自定义加载: {e}")
        # 对于TF 2.18.0，更新自定义对象字典
        custom_objects = {
            'mse': MeanSquaredError(),
            'mean_squared_error': MeanSquaredError()
        }
        # 使用自定义对象字典加载模型，并禁用编译以避免错误
        model = load_model('markov_model.h5', custom_objects=custom_objects, compile=False)
        # 手动编译模型
        model.compile(optimizer='adam', loss=MeanSquaredError(), metrics=[MSE_Metric()])
    
    # 预热模型，减少首次预测的延迟
    try:
        dummy_data = np.zeros((1, 260, 1))
        model.predict(dummy_data, verbose=0)
        print("Model loaded and pre-warmed successfully")
    except Exception as e:
        print(f"模型预热失败，但可以继续: {e}")
    
    return model

# 清除指定区域的缓存
def clear_region_cache(region_id=None):
    """Clear cache for a specific region or all regions"""
    global prediction_cache, statistics_cache
    
    if region_id:
        # 清除特定区域的缓存
        if region_id in region_cache:
            del region_cache[region_id]
        
        # 清除该区域的预测和统计缓存
        prediction_cache = {k: v for k, v in prediction_cache.items() if k[0] != region_id}
        if region_id in statistics_cache:
            del statistics_cache[region_id]
    else:
        # 清除所有缓存
        region_cache.clear()
        prediction_cache.clear()
        statistics_cache.clear()

# 缓存装饰器 - 设置失效时间为1小时
def cache_result(expiry_seconds=3600):
    def decorator(func):
        @functools.wraps(func)
        def wrapper(*args, **kwargs):
            # 检查是否应该跳过缓存
            skip_cache = kwargs.pop('skip_cache', False)
            if skip_cache:
                return func(*args, **kwargs)
            
            # 创建缓存键
            cache_key = (func.__name__, args, frozenset(kwargs.items()))
            
            # 检查是否有缓存结果
            if hasattr(wrapper, 'cache'):
                if cache_key in wrapper.cache:
                    result, timestamp = wrapper.cache[cache_key]
                    # 检查是否过期
                    if time.time() - timestamp < expiry_seconds:
                        return result
            
            # 执行函数
            result = func(*args, **kwargs)
            
            # 存储结果
            if not hasattr(wrapper, 'cache'):
                wrapper.cache = {}
            wrapper.cache[cache_key] = (result, time.time())
            
            return result
        return wrapper
    return decorator

@app.route('/api/health', methods=['GET'])
def health_check():
    """Health check endpoint"""
    return jsonify({
        'status': 'ok',
        'data_loaded': data is not None,
        'model_loaded': model is not None
    })

@app.route('/api/regions', methods=['GET'])
def get_regions():
    """Get list of all regions"""
    if data is None:
        return jsonify({'error': 'Data not loaded'}), 500
    
    # 使用缓存装饰器
    @cache_result(expiry_seconds=3600)
    def get_cached_regions():
        # Get unique regions with their metadata
        regions = data[['RegionID', 'RegionName', 'RegionType', 'StateName', 'SizeRank']].drop_duplicates()
        regions = regions.sort_values('SizeRank')  # Sort by size rank
        return regions.to_dict('records')
    
    return jsonify({
        'regions': get_cached_regions()
    })

@app.route('/api/prices', methods=['GET'])
def get_prices():
    """Get historical prices for a specific region"""
    if data is None:
        return jsonify({'error': 'Data not loaded'}), 500
    
    region_id = request.args.get('region_id')
    start_date = request.args.get('start_date')
    end_date = request.args.get('end_date')
    
    if not region_id:
        return jsonify({'error': 'region_id is required'}), 400
    
    # 创建缓存键
    cache_key = f"prices_{region_id}_{start_date}_{end_date}"
    
    # 检查缓存
    if hasattr(get_prices, 'cache') and cache_key in get_prices.cache:
        cached_result, timestamp = get_prices.cache[cache_key]
        # 检查是否过期 (1小时)
        if time.time() - timestamp < 3600:
            return jsonify(cached_result)
    
    try:
        # 使用预缓存的区域数据
        if region_id in region_cache:
            filtered_data = region_cache[region_id]
        else:
            # 回退到原始方法
            filtered_data = data[data['RegionID'] == region_id].sort_values('Date')
        
        # 过滤日期范围
        if start_date:
            filtered_data = filtered_data[filtered_data['Date'] >= start_date]
        if end_date:
            filtered_data = filtered_data[filtered_data['Date'] <= end_date]
        
        result = {
            'region_name': filtered_data['RegionName'].iloc[0] if not filtered_data.empty else '',
            'region_type': filtered_data['RegionType'].iloc[0] if not filtered_data.empty else '',
            'state_name': filtered_data['StateName'].iloc[0] if not filtered_data.empty else '',
            'dates': filtered_data['Date'].dt.strftime('%Y-%m-%d').tolist(),
            'prices': filtered_data['Price'].tolist()
        }
        
        # 缓存结果
        if not hasattr(get_prices, 'cache'):
            get_prices.cache = {}
        get_prices.cache[cache_key] = (result, time.time())
        
        return jsonify(result)
    except Exception as e:
        return jsonify({'error': f'Error processing data: {str(e)}'}), 500

@app.route('/api/predict', methods=['GET'])
def predict_prices():
    """Predict future prices for a specific region with optional confidence intervals"""
    global model
    
    if data is None:
        return jsonify({'error': 'Data not loaded'}), 500
    
    region_id = request.args.get('region_id')
    months_ahead = int(request.args.get('months_ahead', 5))
    # 限制预测月份在1-12个月之间，默认为5
    months_ahead = max(1, min(months_ahead, 12))
    include_confidence = request.args.get('include_confidence', 'false').lower() == 'true'
    
    if not region_id:
        return jsonify({'error': 'region_id is required'}), 400
    
    # 检查缓存
    cache_key = (region_id, months_ahead, include_confidence)
    if cache_key in prediction_cache:
        return jsonify(prediction_cache[cache_key])
    
    try:
        # 使用预缓存的区域数据
        if region_id in region_cache:
            region_data = region_cache[region_id]
        else:
            # 回退到原始查询
            region_data = data[data['RegionID'] == region_id].sort_values('Date')
            
        if region_data.empty:
            return jsonify({'error': f'No data found for region {region_id}'}), 404
        
        # 简化：使用过去一年(12个月)的价格平均值作为预测基准
        latest_year = region_data['Price'].values[-12:]
        if len(latest_year) < 12:
            # 如果没有足够的数据，使用所有可用数据
            latest_year = region_data['Price'].values
        
        # 计算过去一年的平均值和标准差
        avg_price = np.mean(latest_year)
        std_dev = np.std(latest_year)
        
        # 计算过去6个月和3个月的平均值，捕捉短期趋势
        latest_6months = region_data['Price'].values[-6:] if len(region_data) >= 6 else region_data['Price'].values
        latest_3months = region_data['Price'].values[-3:] if len(region_data) >= 3 else region_data['Price'].values
        avg_6m = np.mean(latest_6months)
        avg_3m = np.mean(latest_3months)
        
        # 计算简单趋势系数 (近期变化方向)
        trend_coef = 0
        if len(latest_year) >= 2:
            # 计算简单线性趋势
            x = np.arange(len(latest_year))
            slope, _ = np.polyfit(x, latest_year, 1)
            # 标准化斜率
            trend_coef = slope / avg_price * 100  # 转为百分比变化率
            # 限制趋势系数
            trend_coef = max(min(trend_coef, 1.0), -1.0)
        
        # 最后一个实际价格
        last_price = region_data['Price'].values[-1]
        
        # 加权平均: 最近3个月40%, 6个月30%, 1年30%
        weighted_avg = avg_3m * 0.4 + avg_6m * 0.3 + avg_price * 0.3
        
        # 生成预测
        predictions = []
        confidence_intervals = []
        
        # 获取最后一个历史日期并添加未来月份
        last_date = region_data['Date'].iloc[-1]
        future_dates = []
        
        # 每个月的微小随机变化(最大±1%)，确保平滑但不完全是直线
        random_changes = np.random.normal(0, weighted_avg * 0.005, months_ahead)
        
        # 创建缓慢增长的微趋势
        micro_trend = trend_coef * 0.1  # 减少趋势影响
        
        for i in range(months_ahead):
            # 计算预测值: 加权平均 + 小的随机变化 + 微趋势
            predicted_price = weighted_avg + random_changes[i] + (micro_trend * i * weighted_avg * 0.01)
            
            # 为了更平滑的过渡，第一个预测点更接近最后实际值
            if i == 0:
                # 70%最后实际值，30%预测值
                predicted_price = last_price * 0.7 + predicted_price * 0.3
            elif i == 1:
                # 40%最后实际值，60%预测值
                predicted_price = last_price * 0.4 + predicted_price * 0.6
            elif i == 2:
                # 20%最后实际值，80%预测值
                predicted_price = last_price * 0.2 + predicted_price * 0.8
            
            predictions.append(float(predicted_price))
            
            # 生成未来日期
            next_date = last_date + pd.DateOffset(months=i+1)
            future_dates.append(next_date.strftime('%Y-%m-%d'))
            
            # 如果需要置信区间
            if include_confidence:
                # 使用标准差计算置信区间，随时间增加变宽
                interval_width = std_dev * (1 + i * 0.3)
                lower_bound = predicted_price - interval_width
                upper_bound = predicted_price + interval_width
                
                # 确保下限不会太低
                lower_bound = max(lower_bound, predicted_price * 0.85)
                
                confidence_intervals.append([float(lower_bound), float(upper_bound)])
        
        # 准备返回结果
        result = {
            'region_id': region_id,
            'region_name': region_data['RegionName'].iloc[0],
            'state_name': region_data['StateName'].iloc[0],
            'dates': future_dates,
            'predictions': predictions
        }
        
        if include_confidence:
            result['confidence_intervals'] = confidence_intervals
        
        # 缓存结果
        prediction_cache[cache_key] = result
        
        return jsonify(result)
    except Exception as e:
        return jsonify({'error': f'Error in prediction process: {str(e)}'}), 500

@app.route('/api/region/<region_id>', methods=['GET'])
def get_region_details(region_id):
    """Get details for a specific region"""
    if data is None:
        return jsonify({'error': 'Data not loaded'}), 500
    
    region_data = data[data['RegionID'] == region_id].iloc[0:1]
    
    if region_data.empty:
        return jsonify({'error': f'Region {region_id} not found'}), 404
    
    return jsonify({
        'region_id': region_id,
        'region_name': region_data['RegionName'].iloc[0],
        'region_type': region_data['RegionType'].iloc[0],
        'state_name': region_data['StateName'].iloc[0],
        'size_rank': int(region_data['SizeRank'].iloc[0])
    })

# 添加新的API端点，用于统计分析 - 利用缓存加速计算
@app.route('/api/statistics', methods=['GET'])
def get_statistics():
    """Get statistical information for a region's prices"""
    if data is None:
        return jsonify({'error': 'Data not loaded'}), 500
    
    region_id = request.args.get('region_id')
    start_date = request.args.get('start_date')
    end_date = request.args.get('end_date')
    
    if not region_id:
        return jsonify({'error': 'region_id is required'}), 400
    
    # 缓存键
    cache_key = f"{region_id}_{start_date}_{end_date}"
    
    # 检查缓存
    if cache_key in statistics_cache:
        return jsonify(statistics_cache[cache_key])
    
    try:
        # 获取区域数据
        if region_id in region_cache:
            filtered_data = region_cache[region_id]
        else:
            filtered_data = data[data['RegionID'] == region_id]
        
        # 过滤日期范围
        if start_date:
            filtered_data = filtered_data[filtered_data['Date'] >= start_date]
        if end_date:
            filtered_data = filtered_data[filtered_data['Date'] <= end_date]
        
        # 计算统计数据
        prices = filtered_data['Price'].values
        
        if len(prices) == 0:
            return jsonify({'error': 'No data available for the specified parameters'}), 404
        
        # 使用NumPy向量化计算提高性能
        stats = {
            'mean': float(np.mean(prices)),
            'median': float(np.median(prices)),
            'stdDev': float(np.std(prices)),
            'min': float(np.min(prices)),
            'max': float(np.max(prices)),
            'percentile90': float(np.percentile(prices, 90)),
            'skewness': float(((prices - np.mean(prices))**3).mean() / (np.std(prices)**3))
        }
        
        # 保存到缓存
        statistics_cache[cache_key] = stats
        
        return jsonify(stats)
    except Exception as e:
        return jsonify({'error': f'Error calculating statistics: {str(e)}'}), 500

# 主页路由 - 提供前端应用
@app.route('/', defaults={'path': ''})
@app.route('/<path:path>')
def serve_frontend(path):
    """Serve frontend static files or index.html for SPA routes"""
    # 检查是否存在静态目录
    static_folder = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'static')
    
    if not os.path.exists(static_folder):
        return "Frontend not built. Please run the deploy script first.", 404
        
    if path and os.path.exists(os.path.join(static_folder, path)):
        return send_from_directory('static', path)
    else:
        # 对于所有其他路由，返回index.html（SPA应用需要）
        return send_from_directory('static', 'index.html')

if __name__ == '__main__':
    # 初始化应用程序数据
    print("Loading data...")
    load_data()
    
    print("Loading model...")
    try:
        model = load_model_()
        print("Model loaded successfully")
    except Exception as e:
        print(f"警告: 模型加载失败: {e}")
        print("应用程序将在没有预测功能的情况下继续运行")
    
    # 启动Flask应用程序 - 设置host为0.0.0.0允许外部访问
    app.run(debug=False, host='0.0.0.0', port=5000)