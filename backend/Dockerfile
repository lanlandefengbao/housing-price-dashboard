FROM python:3.9-slim

WORKDIR /app

# 复制依赖文件
COPY requirements.txt .

# 使用国内镜像源安装依赖，分步安装大型依赖
RUN pip install --upgrade pip && \
    pip config set global.index-url https://mirrors.aliyun.com/pypi/simple/ && \
    pip config set global.trusted-host mirrors.aliyun.com && \
    # 先安装numpy和tensorflow（大型依赖）
    pip install --no-cache-dir --timeout=600 numpy==1.19.5 && \
    pip install --no-cache-dir --timeout=600 tensorflow==2.6.0 && \
    # 安装其余依赖
    pip install --no-cache-dir --timeout=600 flask==2.0.1 flask-cors==3.0.10 pandas==1.3.3 scikit-learn==0.24.2 matplotlib==3.4.3 gunicorn==20.1.0

# 复制应用文件
COPY . .

# 暴露端口
EXPOSE 5000

# 启动应用
CMD ["gunicorn", "--bind", "0.0.0.0:5000", "app:app"] 