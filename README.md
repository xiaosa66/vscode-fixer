# VS Code AI Fixer

一个基于AI的VS Code扩展，可以自动修复ESLint和TypeScript错误。

## 功能

- 修复当前文件中的所有ESLint和TypeScript错误
- 修复工作区中所有文件的所有ESLint和TypeScript错误
- 使用OpenAI GPT-4来智能修复代码

## 安装

1. 克隆此仓库
2. 运行 `npm install` 安装依赖
3. 按F5启动调试

## 配置

在使用之前，你需要设置以下环境变量：

- `OPENAI_API_KEY`: 你的OpenAI API密钥
- `OPENAI_API_BASE`: (可选) 自定义OpenAI API基础URL

## 使用方法

1. 修复当前文件：
   - 使用命令面板 (Cmd/Ctrl + Shift + P)
   - 输入 "AI Fix: Fix Current File Errors"
   - 或使用快捷键 Cmd/Ctrl + Shift + F

2. 修复所有文件：
   - 使用命令面板 (Cmd/Ctrl + Shift + P)
   - 输入 "AI Fix: Fix All ESLint and TypeScript Errors"

## 注意事项

- 此扩展需要OpenAI API密钥才能工作
- 修复过程可能需要一些时间，特别是对于大文件
- 建议在修复之前备份你的代码

## 许可证

MIT
