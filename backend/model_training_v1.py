import pandas as pd
import numpy as np
from sklearn.preprocessing import MinMaxScaler, LabelEncoder
from sklearn.model_selection import TimeSeriesSplit
from tensorflow.keras.models import Model, Sequential
from tensorflow.keras.layers import LSTM, Dense, Dropout, Embedding, Reshape, Concatenate, Input
from tensorflow.keras.callbacks import EarlyStopping, ModelCheckpoint
import matplotlib.pyplot as plt

# 1. 数据预处理增强版
def preprocess_data(filepath):
    # 加载原始宽表数据
    raw_df = pd.read_csv(filepath, dtype={'RegionID': str, 'SizeRank': int})
    
    # 转换为长格式
    melted = pd.melt(
        raw_df,
        id_vars=['RegionID', 'SizeRank', 'RegionName', 'RegionType', 'StateName'],
        var_name='Date',
        value_name='Price'
    )
    
    # 转换为时间序列
    melted['Date'] = pd.to_datetime(melted['Date'])
    melted = melted.sort_values(['RegionID', 'Date']).reset_index(drop=True)
    
    # 在转换为长格式后增加类型转换
    melted['Price'] = pd.to_numeric(melted['Price'], errors='coerce')
    
    # 阶段1：区域时间序列插值（增加空值检查）
    melted['Price'] = melted.groupby('RegionID')['Price'].transform(
        lambda x: x.interpolate(method='linear', limit_direction='both') if x.notnull().sum() > 0 else x
    )
    
    # 阶段2：区域类型年均值填充（增加空值保护）
    melted['Year'] = melted['Date'].dt.year
    year_means = melted.groupby(['RegionType', 'Year'])['Price'].transform(
        lambda x: x.mean() if not np.isnan(x.mean()) else 0
    )
    melted['Price'] = melted['Price'].fillna(year_means)
    
    # 阶段3：清理残余缺失
    melted = melted.dropna(subset=['Price'])
    
    return melted

# 2. 特征工程（增强缺失处理）
def create_features(df):
    # 仅保留价格相关特征
    for lag in [1, 3, 6, 12]:  # 增加更多历史时间步
        df[f'lag_{lag}'] = df.groupby('RegionID')['Price'].shift(lag)
    
    # 清理缺失值
    df = df.dropna()
    
    # 区域编码保持不变
    le = LabelEncoder()
    df['region_code'] = le.fit_transform(df['RegionID'])
    
    return df

# 3. 数据标准化
def scale_data(df):
    price_scaler = MinMaxScaler()
    # 仅对价格序列进行标准化
    df['Price_scaled'] = price_scaler.fit_transform(df[['Price']])
    return df, price_scaler

# 4. 序列生成（带数据验证）
def create_sequences(data, time_steps=12):
    X, y = [], []
    regions = data['region_code'].unique()
    
    for region in regions:
        region_data = data[data['region_code'] == region]
        prices = region_data['Price_scaled'].values
        
        # 生成纯价格序列
        for i in range(len(prices) - time_steps):
            X.append(prices[i:i+time_steps])
            y.append(prices[i+time_steps])
    
    return np.array(X), np.array(y)

# 5. 模型构建（修正输入结构）
def build_markov_model(time_steps, lstm_units, dropout_rate):
    model = Sequential()
    # Reduce complexity, add regularization
    model.add(LSTM(lstm_units // 2, input_shape=(time_steps, 1), 
                  dropout=dropout_rate, recurrent_dropout=0.1,
                  return_sequences=False))
    model.add(Dense(16, activation='relu'))
    model.add(Dense(1))
    model.compile(loss='mse', optimizer='adam')
    return model

# 主流程
if __name__ == "__main__":
    # 加载数据时指定数值列
    raw_df = pd.read_csv('Data.csv', dtype={'RegionID': str, 'SizeRank': int})
    
    # 预处理前检查原始数据
    print("原始数据统计：")
    print(raw_df.iloc[:, 5:].apply(pd.to_numeric, errors='coerce').dtypes.value_counts())
    
    # 数据管道
    processed_df = preprocess_data('Data.csv')
    feature_df = create_features(processed_df)
    scaled_df, price_scaler = scale_data(feature_df)
    
    # 生成序列（仅价格）
    time_steps = 24  # 可调整历史窗口大小
    X, y = create_sequences(scaled_df, time_steps)
    
    # 调整输入维度
    X = X.reshape((X.shape[0], X.shape[1], 1))
    
    # 划分数据集
    split = int(0.8 * len(X))
    X_train, X_test = X[:split], X[split:]
    y_train, y_test = y[:split], y[split:]
    
    # 训练模型
    model = build_markov_model(time_steps, lstm_units=64, dropout_rate=0.2)
    history = model.fit(
        X_train, y_train,
        validation_data=(X_test, y_test),
        epochs=5,
        batch_size=64,
        callbacks=[
            EarlyStopping(patience=20),
            ModelCheckpoint('markov_model.h5', save_best_only=True)
        ]
    )
    
    # 评估模型
    test_pred = model.predict(X_test)
    test_pred = price_scaler.inverse_transform(test_pred)
    y_test_actual = price_scaler.inverse_transform(y_test.reshape(-1, 1))
    
    # 计算WMAPE
    wmape = np.mean(np.abs(y_test_actual - test_pred)) / np.mean(y_test_actual)
    print(f"WMAPE: {wmape:.2%}")
    
    # 可视化结果
    plt.figure(figsize=(12, 6))
    plt.plot(y_test_actual[:200], label='Actual')
    plt.plot(test_pred[:200], label='Predicted')
    plt.title('Price Prediction Comparison')
    plt.legend()
    plt.show()