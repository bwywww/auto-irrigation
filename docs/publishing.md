# 上传到 GitHub

仓库根目录是包含 `README.md`、`firmware/`、`web/` 和 `tests/` 的本目录。

## 发布范围

本目录是仓库根目录，仅包含源码、测试、配置和技术文档。依赖、构建和测试产物由 `.gitignore` 排除。上传前检查实际暂存文件。

## 使用 Git 上传

先在 GitHub 创建一个空仓库。以下命令在本地仓库根目录执行。将最后的占位地址换成你创建的仓库地址。

```bash
git init -b main
```

```bash
git add .
```

检查待上传文件，确认其中没有 `node_modules`、`dist`、测试输出或私有文件。

```bash
git diff --cached --stat
```

```bash
git commit -m "Prepare smart irrigation repository"
```

```bash
git remote add origin https://github.com/YOUR_USERNAME/auto-irrigation.git
```

```bash
git push -u origin main
```

本次整理不代你提交或上传。首次推送后，在 GitHub 的 Actions 页面检查 `CI` 工作流。本机测试结果见 [测试说明](testing.md)，不代表 GitHub Actions 已执行。

## 发布许可

本项目采用 [MIT 许可证](../LICENSE)。第三方库由依赖管理器安装，其许可证继续适用。
