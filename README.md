# Housing Price Dashboard

交互式房价数据可视化和预测仪表盘，使用Angular和Flask构建。

## 功能特点

- 📊 交互式折线图显示历史房价趋势
- 📈 基于机器学习的房价预测（5-12个月）
- 📑 按州和地区筛选数据
- 📅 可定制的日期范围选择
- 📉 显示预测置信区间
- 📋 统计数据摘要（均值、中位数、标准差等）
- 📱 响应式设计，适配各种设备
- 💾 一键下载数据为CSV格式

## 技术栈

- **前端**: Angular, Chart.js, Bootstrap
- **后端**: Python, Flask, pandas, scikit-learn
- **数据**: Zillow房价研究数据

## 快速开始

### 前端开发

```bash
# 进入前端目录
cd housing-price-dashboard/frontend

# 安装依赖
npm install

# 启动开发服务器
ng serve
```

### 后端开发

```bash
# 进入后端目录
cd housing-price-dashboard/backend

# 创建虚拟环境
python -m venv venv

# 激活虚拟环境
# Windows
venv\Scripts\activate
# Mac/Linux
source venv/bin/activate

# 安装依赖
pip install -r requirements.txt

# 启动Flask服务器
python app.py
```

## 部署到GitHub Pages

本项目已配置自动部署到GitHub Pages。只需将代码推送到主分支，GitHub Actions就会自动构建并部署前端应用。

### 手动部署

```bash
# 构建生产版本
ng build --configuration production --base-href=/housing-price-dashboard/

# 复制404页面（用于SPA路由支持）
cp src/assets/github-pages/404.html dist/housing-price-dashboard/
```

然后将`dist/housing-price-dashboard`目录中的内容上传到GitHub仓库的`gh-pages`分支。

## 项目结构

```
housing-price-dashboard/
├── frontend/            # Angular前端应用
│   ├── src/
│   │   ├── app/         # 组件、服务、模型等
│   │   ├── assets/      # 静态资源
│   │   └── ...
│   └── ...
├── backend/             # Flask后端应用
│   ├── app.py           # 主应用入口
│   ├── models/          # 机器学习模型
│   ├── data/            # 数据文件
│   └── ...
└── README.md            # 项目说明
```

## 贡献指南

1. Fork 这个仓库
2. 创建你的特性分支 (`git checkout -b feature/amazing-feature`)
3. 提交你的更改 (`git commit -m 'Add some amazing feature'`)
4. 推送到分支 (`git push origin feature/amazing-feature`)
5. 打开一个Pull Request

## 许可证

[MIT](LICENSE) 