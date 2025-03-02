#!/bin/bash

echo "停止现有容器..."
docker-compose down

echo "清理Docker缓存..."
docker system prune -f

echo "重新构建容器..."
docker-compose build

echo "启动应用..."
docker-compose up -d

echo "显示正在运行的容器..."
docker-compose ps

echo "查看容器日志..."
docker-compose logs -f 