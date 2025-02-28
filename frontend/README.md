# 房价预测仪表盘 - 前端应用

这是房价预测仪表盘的Angular前端应用。该应用程序提供交互式图表，用于可视化历史房价数据和预测未来房价趋势。

## 特性

- 多区域历史房价数据可视化
- 按州和地区过滤数据
- 选择自定义日期范围
- 展示房价预测和置信区间
- 选定日期的统计数据摘要
- 交互式图表 - 点击图表元素查看详细信息
- 响应式布局，适用于各种设备

## 开发设置

```bash
# 安装依赖
npm install

# 启动开发服务器
ng serve

# 为生产环境构建
ng build --configuration production
```

## 部署到GitHub Pages

GitHub Pages是托管静态网站的简单方法，非常适合Angular单页应用。本项目已配置GitHub Actions自动部署流程。

### 使用GitHub Actions自动部署

1. 确保您的仓库有一个`.github/workflows/deploy.yml`文件，内容如下所示：

```yaml
name: 部署到GitHub Pages

on:
  push:
    branches: [ main ]
  workflow_dispatch:

jobs:
  build-and-deploy:
    runs-on: ubuntu-latest
    steps:
      - name: 检出代码
        uses: actions/checkout@v3

      - name: 设置Node.js
        uses: actions/setup-node@v3
        with:
          node-version: 18

      - name: 安装依赖
        run: npm ci
        working-directory: ./housing-price-dashboard/frontend

      - name: 构建
        run: npm run build -- --configuration production --base-href=/housing-price-dashboard/
        working-directory: ./housing-price-dashboard/frontend

      - name: 复制404页面
        run: cp src/assets/github-pages/404.html dist/housing-price-dashboard/
        working-directory: ./housing-price-dashboard/frontend

      - name: 部署到GitHub Pages
        uses: JamesIves/github-pages-deploy-action@v4
        with:
          folder: housing-price-dashboard/frontend/dist/housing-price-dashboard
          branch: gh-pages
```

2. 将您的更改推送到`main`分支，GitHub Actions将自动构建并部署应用。

### 手动部署

如果您需要手动部署：

1. 构建生产版本：

```bash
ng build --configuration production --base-href=/housing-price-dashboard/
```

2. 复制404页面（用于SPA路由支持）：

```bash
cp src/assets/github-pages/404.html dist/housing-price-dashboard/
```

3. 使用您喜欢的方式将`dist/housing-price-dashboard`目录发布到`gh-pages`分支：

```bash
# 使用npm包
npm install -g angular-cli-ghpages
angular-cli-ghpages --dir=dist/housing-price-dashboard
```

## SPA路由注意事项

GitHub Pages不原生支持Angular路由重写。为了解决这个问题，我们使用了两个关键文件：

1. `404.html` - 捕获所有找不到的页面并重定向到主应用
2. `index.html` - 包含重定向脚本，从SessionStorage中恢复原始路径

确保这两个文件正确设置，以便在GitHub Pages上正常工作。

## 连接后端

前端应用默认连接到本地后端服务器：

```typescript
// API相关配置位于environments文件夹中
baseUrl: 'http://localhost:5000/api'
```

对于生产部署，您可能需要更新此配置以指向托管的API端点。

## 文件结构

```
src/
├── app/
│   ├── components/          # 共享组件
│   ├── dashboard/           # 主仪表盘组件
│   ├── services/            # API服务和工具
│   └── models/              # 接口和类型定义
├── assets/
│   ├── github-pages/        # GitHub Pages特定文件
│   └── images/              # 应用图像资源
└── environments/            # 环境配置
```

## 故障排除

**GitHub Pages上应用不加载**

检查这些常见问题：
- 确保`base-href`正确（应该是`/项目名称/`）
- 验证404.html重定向脚本是否正确
- 检查控制台错误是否指向错误的资源路径
