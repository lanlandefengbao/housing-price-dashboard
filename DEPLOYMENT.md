# 房价仪表盘应用部署指南

本文档提供了多种部署房价仪表盘应用的方法，包括GitHub Pages、Docker和传统服务器部署。

## 目录
1. [GitHub Pages部署 (仅前端)](#github-pages部署-仅前端)
2. [Docker部署 (全栈)](#docker部署-全栈)
3. [使用Render等云服务部署 (全栈)](#使用render等云服务部署-全栈)
4. [分离部署前后端](#分离部署前后端)
5. [验证部署](#验证部署)

## GitHub Pages部署 (仅前端)

> 注意：GitHub Pages只能托管静态内容，因此后端API需要单独部署。

### 1. 创建GitHub仓库

1. 在GitHub上创建一个新仓库
2. 将代码推送到新仓库：

```bash
cd housing-price-dashboard
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/您的用户名/housing-price-dashboard.git
git push -u origin main
```

### 2. 配置GitHub Pages

GitHub Actions配置文件已包含在 `.github/workflows/deploy.yml` 中，它会自动构建并部署前端到GitHub Pages。

1. 在GitHub仓库设置中启用GitHub Pages
   - 进入仓库 -> Settings -> Pages
   - Source选择 "GitHub Actions"

2. 等待GitHub Actions工作流完成后，你的应用将部署到：
   `https://您的用户名.github.io/housing-price-dashboard/`

### 3. 调整API端点

由于GitHub Pages是静态托管，你需要修改前端以指向单独部署的后端API：

1. 编辑`frontend/src/environments/environment.prod.ts`：
```typescript
export const environment = {
  production: true,
  apiUrl: 'https://您的后端API地址/api'
};
```

2. 重新构建并部署前端

## Docker部署 (全栈)

### 1. 使用Docker Compose

项目已包含Docker配置文件，使用Docker Compose可以一键部署：

```bash
cd housing-price-dashboard
docker-compose up -d
```

应用将在以下地址可用：
- 前端：http://localhost
- 后端API：http://localhost/api

### 2. 部署到云服务器

1. 在云服务器上安装Docker和Docker Compose
2. 将代码复制到服务器
3. 运行部署命令：

```bash
cd housing-price-dashboard
docker-compose up -d
```

## 使用Render等云服务部署 (全栈)

### Render部署

1. 在Render.com创建账号并连接GitHub仓库
2. 部署后端服务：
   - 创建一个新的Web Service
   - 选择仓库和backend目录
   - 设置构建命令：`pip install -r requirements.txt`
   - 设置启动命令：`gunicorn app:app`

3. 部署前端服务：
   - 创建一个新的Static Site
   - 选择仓库和frontend目录
   - 设置构建命令：`npm install && npm run build`
   - 发布目录：`dist/frontend/browser`

4. 配置环境变量，确保前端正确指向后端API

## 分离部署前后端

### 1. 后端部署选项

- **Heroku**：
  ```bash
  cd housing-price-dashboard/backend
  heroku create housing-price-api
  git init
  heroku git:remote -a housing-price-api
  git add .
  git commit -m "Initial backend deployment"
  git push heroku master
  ```

- **Railway**：
  通过GitHub集成或CLI部署

- **AWS Elastic Beanstalk**：使用AWS控制台或EB CLI部署

### 2. 前端部署选项

- **Netlify**：
  ```bash
  cd housing-price-dashboard/frontend
  npm install netlify-cli -g
  netlify deploy
  ```

- **Vercel**：
  ```bash
  cd housing-price-dashboard/frontend
  npm install -g vercel
  vercel
  ```

## 验证部署

无论使用哪种部署方法，部署完成后都应通过以下方式验证：

1. 访问前端URL，确保页面正确加载
2. 测试数据加载功能
3. 测试预测功能
4. 检查控制台是否有API连接错误

如果前端无法连接后端API：
1. 检查CORS配置
2. 验证API端点URL配置
3. 确保后端服务正常运行 