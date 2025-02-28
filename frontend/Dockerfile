# 构建阶段
FROM node:18 as build

WORKDIR /app

# 复制package.json和package-lock.json
COPY package*.json ./

# 安装依赖
RUN npm install

# 复制所有文件
COPY . .

# 构建应用
RUN npm run build

# 部署阶段
FROM nginx:alpine

# 复制构建产物到nginx服务目录
COPY --from=build /app/dist/frontend/browser /usr/share/nginx/html

# 复制自定义nginx配置
COPY ./nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"] 