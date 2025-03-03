#!/bin/bash

echo "===== 开始部署房价预测仪表盘应用 ====="

echo "镜像加速配置..."
{
  "registry-mirrors": [
    "https://hub-mirror.c.163.com",
    "https://mirror.baidubce.com",
    "https://registry.aliyuncs.com"
  ]
}

# 2. 清理旧容器（如果存在）
echo "清理旧容器..."
docker-compose down || true
docker rm -f housing-price-backend housing-price-frontend || true

# 3. 构建新容器
echo "构建容器..."
cd "$(dirname "$0")"
docker-compose build --no-cache

# 4. 启动容器
echo "启动容器..."
docker-compose up -d

# 5. 检查容器状态
echo "检查容器状态..."
sleep 10
docker ps -a

# 6. 检查容器日志
echo "检查后端容器日志..."
docker logs housing-price-backend
echo "检查前端容器日志..."
docker logs housing-price-frontend

echo "===== 部署完成 ====="
echo "前端访问地址: http://服务器IP:8080"
echo "后端API访问地址: http://服务器IP:5000" 