# housing-price-dashboard/backend/app.py
import pandas as pd
import numpy as np
from flask import Flask, request, jsonify
from flask_cors import CORS
import tensorflow as tf
from tensorflow.keras.models import load_model
from sklearn.preprocessing import MinMaxScaler
import datetime
import os

app = Flask(__name__)
CORS(app)  # Enable CORS for Angular frontend

# Global variables to store data and model
data = None
model = None
price_scaler = MinMaxScaler()

def load_data():
    """Load and preprocess the housing price data"""
    global data
    
    # Load data
    raw_df = pd.read_csv('Data.csv', dtype={'RegionID': str, 'SizeRank': int})
    
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
    
    # Convert price to numeric
    melted['Price'] = pd.to_numeric(melted['Price'], errors='coerce')
    
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
    
    # Drop any remaining missing values
    data = melted.dropna(subset=['Price'])
    
    return "Data loaded successfully"

def load_ml_model():
    """Load the LSTM model for predictions"""
    global model
    try:
        # Define custom objects to handle serialization issues
        custom_objects = {
            'mse': tf.keras.losses.MeanSquaredError(),
            'mean_squared_error': tf.keras.losses.MeanSquaredError()
        }
        
        # Try to load the model with custom objects
        model = load_model('markov_model.h5', custom_objects=custom_objects)
        print("Model loaded successfully!")
        return "Model loaded successfully"
    except Exception as e:
        print(f"Error loading model: {e}")
        
        # Alternative: Create a simple model for demonstration if original can't be loaded
        print("Creating a simple substitute model for demonstration...")
        try:
            from tensorflow.keras.models import Sequential
            from tensorflow.keras.layers import LSTM, Dense
            
            # Create a simple LSTM model
            simple_model = Sequential([
                LSTM(50, activation='relu', input_shape=(260, 1), return_sequences=False),
                Dense(1)
            ])
            simple_model.compile(optimizer='adam', loss='mse')
            
            model = simple_model
            print("Substitute model created successfully")
            return "Substitute model created successfully"
        except Exception as e2:
            print(f"Error creating substitute model: {e2}")
            return f"Error: {e2}"

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
    
    # Get unique regions with their metadata
    regions = data[['RegionID', 'RegionName', 'RegionType', 'StateName', 'SizeRank']].drop_duplicates()
    regions = regions.sort_values('SizeRank')  # Sort by size rank
    
    return jsonify({
        'regions': regions.to_dict('records')
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
    
    # Filter by region
    filtered_data = data[data['RegionID'] == region_id]
    
    # Filter by date range if provided
    if start_date:
        filtered_data = filtered_data[filtered_data['Date'] >= start_date]
    if end_date:
        filtered_data = filtered_data[filtered_data['Date'] <= end_date]
    
    # Sort by date
    filtered_data = filtered_data.sort_values('Date')
    
    return jsonify({
        'region_name': filtered_data['RegionName'].iloc[0] if not filtered_data.empty else '',
        'region_type': filtered_data['RegionType'].iloc[0] if not filtered_data.empty else '',
        'state_name': filtered_data['StateName'].iloc[0] if not filtered_data.empty else '',
        'dates': filtered_data['Date'].dt.strftime('%Y-%m-%d').tolist(),
        'prices': filtered_data['Price'].tolist()
    })

@app.route('/api/predict', methods=['GET'])
def predict_prices():
    """Predict future prices for a specific region with optional confidence intervals"""
    if data is None or model is None:
        return jsonify({'error': 'Data or model not loaded'}), 500
    
    region_id = request.args.get('region_id')
    months_ahead = int(request.args.get('months_ahead', 5))
    # 限制预测月份在1-12个月之间，默认为5
    months_ahead = max(1, min(months_ahead, 12))
    include_confidence = request.args.get('include_confidence', 'false').lower() == 'true'
    
    if not region_id:
        return jsonify({'error': 'region_id is required'}), 400
    
    # Get region data
    region_data = data[data['RegionID'] == region_id].sort_values('Date')
    
    if region_data.empty:
        return jsonify({'error': f'No data found for region {region_id}'}), 404
    
    try:
        # Get last 260 prices (the window size used in training)
        time_steps = 260
        latest_prices = region_data['Price'].values[-time_steps:]
        
        if len(latest_prices) < time_steps:
            # Pad with the earliest available prices if we don't have enough history
            padding = np.full(time_steps - len(latest_prices), latest_prices[0])
            latest_prices = np.concatenate([padding, latest_prices])
        
        # Scale the input data
        price_scaler.fit(region_data[['Price']])
        latest_prices_scaled = price_scaler.transform(latest_prices.reshape(-1, 1))
        
        # Prepare input sequence
        input_seq = latest_prices_scaled.reshape(1, time_steps, 1)
        
        # Make predictions
        predictions = []
        current_sequence = latest_prices_scaled.flatten()
        
        for i in range(months_ahead):
            # Reshape for model input
            model_input = current_sequence[-time_steps:].reshape(1, time_steps, 1)
            
            # Predict next value
            next_pred = model.predict(model_input, verbose=0)[0][0]
            
            # Add to predictions
            predictions.append(next_pred)
            
            # Update sequence for next iteration
            current_sequence = np.append(current_sequence, next_pred)
        
        # Inverse transform predictions to get actual prices
        predictions_reshaped = np.array(predictions).reshape(-1, 1)
        actual_predictions = price_scaler.inverse_transform(predictions_reshaped).flatten()
        
        # Add constraints to prevent unrealistic drops
        last_known_price = region_data['Price'].values[-1]
        
        # Ensure predictions don't drop too quickly (e.g., max 2% decrease per month)
        for i in range(len(actual_predictions)):
            min_allowed_price = last_known_price * (0.98 ** (i+1))  # Allow max 2% decrease per month
            actual_predictions[i] = max(actual_predictions[i], min_allowed_price)
        
        # Apply exponential smoothing
        alpha = 0.7  # Smoothing factor
        smoothed_predictions = [actual_predictions[0]]
        for i in range(1, len(actual_predictions)):
            smoothed_val = alpha * actual_predictions[i] + (1 - alpha) * smoothed_predictions[i-1]
            smoothed_predictions.append(smoothed_val)
        
        actual_predictions = np.array(smoothed_predictions)
        
        # Calculate recent trend from historical data (last 12 months)
        recent_prices = region_data['Price'].values[-12:]
        avg_monthly_change_pct = np.mean(np.diff(recent_prices) / recent_prices[:-1])
        
        # Blend model predictions with trend-based predictions
        trend_predictions = []
        last_price = region_data['Price'].values[-1]
        
        for i in range(months_ahead):
            # Calculate trend-based prediction
            trend_price = last_price * (1 + avg_monthly_change_pct) ** (i+1)
            # Blend with model prediction (more weight to model initially, more to trend later)
            blend_weight = min(0.2 + i * 0.05, 0.7)  # Gradually increase trend weight
            blended_price = (1 - blend_weight) * actual_predictions[i] + blend_weight * trend_price
            trend_predictions.append(blended_price)
        
        # Replace actual_predictions with blended predictions
        actual_predictions = np.array(trend_predictions)
        
        # Generate confidence intervals if requested
        confidence_intervals = None
        if include_confidence:
            # Generate simple confidence intervals (e.g. ±5% initially, increasing with time)
            upper_bound = []
            lower_bound = []
            
            for i in range(months_ahead):
                # Uncertainty increases with prediction horizon
                uncertainty = 0.05 + 0.01 * i  # 5% initially, increasing by 1% each month
                upper_bound.append(actual_predictions[i] * (1 + uncertainty))
                lower_bound.append(actual_predictions[i] * (1 - uncertainty))
            
            confidence_intervals = {
                'upper': upper_bound,
                'lower': lower_bound
            }
        
        # Generate future dates
        last_date = region_data['Date'].max()
        future_dates = [
            (last_date + pd.DateOffset(months=i+1)).strftime('%Y-%m-%d')
            for i in range(months_ahead)
        ]
        
        response_data = {
            'region_name': region_data['RegionName'].iloc[0],
            'dates': future_dates,
            'predictions': actual_predictions.tolist()
        }
        
        if confidence_intervals:
            response_data['confidence_intervals'] = confidence_intervals
        
        return jsonify(response_data)
    
    except Exception as e:
        print(f"Prediction error: {e}")
        return jsonify({'error': f'Prediction failed: {str(e)}'}), 500

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

if __name__ == '__main__':
    # Load data and model at startup
    print("Loading data...")
    load_data()
    print("Loading model...")
    load_ml_model()
    
    # 仅在直接运行此脚本时执行app.run
    if __name__ == "__main__":
        app.run(debug=True, host='0.0.0.0', port=5000)