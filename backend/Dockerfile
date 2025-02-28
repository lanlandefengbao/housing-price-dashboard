FROM python:3.9-slim

WORKDIR /app

# 复制依赖文件
COPY requirements.txt .

# 安装依赖
RUN pip install --no-cache-dir -r requirements.txt

# 复制应用文件
COPY . .

# 暴露端口
EXPOSE 5000

# 启动应用
CMD ["gunicorn", "--bind", "0.0.0.0:5000", "app:app"] 