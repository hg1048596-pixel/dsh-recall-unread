# 上传到 GitHub 的细致教程

本文档面向 Windows + 中文用户，从零开始把本项目（`dsh-recall-unread`）发布到 GitHub。
两种方式任选其一：**方式 A（网页直传，无需装 Git）** 适合新手；**方式 B（Git 命令行，标准做法）** 适合长期维护。

---

## 0. 前置准备

### 0.1 注册 GitHub 账号
1. 打开 https://github.com/signup ，按提示注册（邮箱 + 密码 + 验证）。
2. 注册完成后先登录。

### 0.2 （方式 B 需要）安装 Git
1. 到 https://git-scm.com/download/win 下载 Windows 版 Git，双击安装，一路 **Next** 即可（默认选项即可）。
2. 安装完成后，按 `Win` 键，输入 `Git Bash` 并打开，或打开 PowerShell 输入：
   ```bash
   git --version
   ```
   能显示 `git version 2.x.x` 即安装成功。

### 0.3 配置你的身份（方式 B 需要）
Git 每次提交都会记录“作者”，需要你的名字和邮箱（邮箱建议与 GitHub 注册邮箱一致）：
```bash
git config --global user.name "你的GitHub用户名"
git config --global user.email "你的GitHub注册邮箱"
```

---

## 方式 A：GitHub 网页直接上传（最简单，无需 Git）

1. 登录 GitHub → 点击右上角 **+** → **New repository**。
2. 填写：
   - **Repository name**：`dsh-recall-unread`（仓库名，建议与项目文件夹同名）
   - **Description**（可选）：`DeepSeek Harness 插件：撤回已发送未读取的文字消息`
   - **Public** 公开 / **Private** 私有，按需选择
   - 其他保持默认，点击 **Create repository**。
3. 创建后页面会出现若干命令提示，**忽略它们**。直接点击页面上的 **uploading an existing file**（或仓库空白页里的 “Add file ▾ → Upload files”）。
4. 打开项目文件夹 `D:\deepseek harness plugin\dsh-recall-unread`，把 **里面的内容**（README.md、LICENSE、.gitignore、package.json、plugin.json、src 文件夹、docs 文件夹）**整体拖进**上传区域。（注意：不要拖文件夹本身，要拖文件夹内部的东西。）
5. 页面底部 **Commit changes** 区域可填写提交说明（如 `init: dsh-recall-unread`），默认即可。
6. 点击 **Commit changes**，稍等上传完成，你的仓库就建好了，GitHub 会自动渲染 README.md 作为仓库首页。

---

## 方式 B：Git 命令行推送（标准做法，推荐）

### B.1 在 GitHub 上创建空仓库
1. 登录 GitHub → 右上角 **+** → **New repository**。
2. 填好仓库名 `dsh-recall-unread` 与描述，选择 Public / Private。
3. **关键：不要勾选** “Add a README file”、“Add .gitignore”、“Choose a license” 这三项（仓库里已有这些文件，勾了会产生冲突）。直接 **Create repository**。
4. 创建成功后，记下页面顶部的仓库地址，形如：
   ```
   https://github.com/你的用户名/dsh-recall-unread.git
   ```

### B.2 初始化本地仓库并提交
打开 **PowerShell**（或 Git Bash），进入项目目录：
```bash
cd "D:\deepseek harness plugin\dsh-recall-unread"

# 1. 初始化 Git 仓库（若还没有）
git init -b main

# 2. 把项目所有文件加入暂存区
git add .

# 3. 查看即将提交的文件清单（确认没有 .npm-cache / .tooling 等缓存被加进来）
git status

# 4. 创建首次提交
git commit -m "init: dsh-recall-unread 撤回已发送未读取的消息"
```

> 若第 4 步报错 `Author identity unknown`，说明 0.3 的身份没配好，先执行：
> ```bash
> git config --global user.name "你的名字"
> git config --global user.email "你的邮箱"
> ```

### B.3 关联远程仓库并推送
```bash
# 5. 把本地仓库关联到 GitHub 远程仓库（地址换成你自己的）
git remote add origin https://github.com/你的用户名/dsh-recall-unread.git

# 6. 推送 main 分支到远程
git push -u origin main
```

第 6 步首次推送时，GitHub 会要求登录：
- 浏览器会弹出授权窗口，登录 GitHub 并点击 **Authorize** 即可；
- 若弹出的是用户名 + **Personal Access Token** 输入框，而你不知道 token 是什么，请跳到 **B.4** 用 HTTPS token 方式。

推送成功后终端会显示类似 `main -> main` 的输出，刷新 GitHub 仓库页面即可看到所有文件。

### B.4 （备用）使用 Personal Access Token 认证
1. GitHub 网页 → 右上角头像 → **Settings** → 左侧 **Developer settings** → **Personal access tokens** → **Tokens (classic)** → **Generate new token (classic)**。
2. 勾选 **repo** 权限，点击底部 **Generate token**。
3. **立即复制**生成的 token（只显示一次，形如 `ghp_xxxxxxxx`）。
4. 推送时若要求输入密码，粘贴这个 token 作为密码即可（用户名填你的 GitHub 用户名）。

---

## 后续更新（方式 B）

以后修改了代码，只需三步：
```bash
cd "D:\deepseek harness plugin\dsh-recall-unread"
git add .
git commit -m "描述本次改动"
git push
```

---

## 常见问题排查

| 现象 | 原因与解决 |
| --- | --- |
| `fatal: remote origin already exists` | 之前关联过。执行 `git remote set-url origin 新地址` 或 `git remote remove origin` 后重新 add。 |
| `fatal: repository '...' not found` | ① 仓库是私有的但未登录/未授权；② 仓库地址拼错；③ 仓库还没创建。检查 B.1。 |
| 推送要求输入用户名/密码 | 新版 GitHub 已不支持密码推送，用 B.4 的 token 代替密码。 |
| 上传后 README 不显示 | 确保文件名为 `README.md`（区分大小写）且位于仓库根目录。 |
| 中文文件名在 Git 中显示为 `\uXXXX` | 正常现象（core.quotepath 显示转义），不影响内容。可执行 `git config --global core.quotepath false` 便于查看。 |
| 误提交了大文件 / 缓存目录 | 先删掉再提交：确认 `.gitignore` 已忽略 `.npm-cache`、`.tooling`、`node_modules`；如已误提交，用 `git rm -r --cached .npm-cache` 后再提交。 |
| 想彻底删除远程仓库 | GitHub 仓库页面 → **Settings** → 最底部 **Danger Zone** → **Delete this repository**（谨慎操作）。 |

---

## 推荐：写一份更好的 README

GitHub 会自动把根目录的 `README.md` 渲染成仓库首页。目前仓库已带一份完整中文 README，你可以：
- 把实际效果截图放到 `docs/` 目录，并将 README 中的 `![screenshot](docs/screenshot.png)` 换成真实图片；
- 在 README 顶部补上使用说明动图（录制 GIF 上传到 `docs/`）；
- 补上 GitHub 徽章（stars / license 等），让仓库更专业。
