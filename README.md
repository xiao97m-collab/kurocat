# 🐈‍⬛ KuroCat · 经典小黑猫、多肉与奶油柯基

透明置顶桌宠，内置经典小黑猫、多肉（萨摩耶）和奶油柯基。本分支独立发布，基于 [qianyiai 的 KuroCat](https://github.com/qianyiai/kurocat)。

## 下载与更新

- **macOS 11+（Apple 芯片）**：[下载本仓库的最新正式版本](https://github.com/xiao97m-collab/kurocat/releases/latest)。打开 DMG，将 KuroCat 拖入「应用程序」。
- **从 1.0.0 升级**。退出旧版，用新版 DMG 中的 KuroCat 覆盖一次。1.1.0 起，右键桌宠或系统托盘里的「检查更新」可以识别本仓库的 Apple 芯片更新包。
- **首次打开**。安装包采用临时签名，尚未经过 Apple 公证。若系统拦截从本仓库下载的应用，可查阅 [Apple 的首次打开说明](https://support.apple.com/zh-cn/102445)。

## 桌宠动作

- 多肉会自然呼吸、微笑环顾和拍拍头，点击鼠标时前爪会轻压。奶油柯基平时趴着敲键，持续快打会撑起身子。
- 三只桌宠闲置约 28 秒后会打盹，键盘、点击、滚动或明显的鼠标移动会唤醒它们。
- 右键菜单可选海贼王航海、青轴流光和黑橙程序员键盘，支持 2D 和 3D 键鼠。小黑猫和柯基可切换 65 键与 108 键。
- 星期直播灯牌适用于三个角色。蓝色围脖适用于小黑猫和柯基。

## 🤖 MCP 接入指南

本分支的桌面外观可在经典小黑猫、多肉和奶油柯基之间切换。以下是 MCP 的连接方式和继承自上游的配置说明。

KuroCat `v4.0.0+` 单文件程序原生内置 **Stdio** 与 **本机 Streamable HTTP（`127.0.0.1:27420`）** 双模式 MCP Server，无需任何额外依赖！

### 最快接入方式
1. 运行 `KuroCat`，右键猫咪 → 确认勾选 **「开启 MCP 扩展」** → 点击 **「复制 MCP 配置」**。
2. 粘贴到你常用的 AI 客户端 MCP 配置文件（Claude Desktop / Cursor / Antigravity / Windsurf / Cline）：

**方式 A：Stdio 模式（通用推荐，所有 MCP 客户端均支持）**
```json
{
  "mcpServers": {
    "kurocat": {
      "command": "C:\\Users\\<你的用户名>\\AppData\\Local\\KuroCat\\KuroCat.exe",
      "args": ["--mcp"]
    }
  }
}
```

**方式 B：本机 HTTP 模式（桌宠运行时直接连接）**
```json
{
  "mcpServers": {
    "kurocat": {
      "url": "http://127.0.0.1:27420/mcp"
    }
  }
}
```

### 试试这样跟 AI 说
- *「帮我用 KuroCat MCP 新增一只大橘猫（虎斑纹 + 白手套 + 橘色高亮键盘），并马上切过去」*
- *「看这张我家三花猫的照片，用 KuroCat MCP 按它的花色和斑点给我捏一只专属桌宠！」*
- *「把桌宠放大到 125%，关闭悬浮按键气泡，切回小黑猫」*

### 内置 MCP 工具清单
| 工具名 | 功能说明 |
| --- | --- |
| `list_cats` | 查看所有内置与自定义猫咪外观及当前激活的猫 |
| `get_cat_schema` | 获取完整花色参数规范、6 种花纹（`solid`/`bicolor`/`tuxedo`/`tabby`/`calico`/`siamese`）、自定义斑点坐标与常见品种模板 |
| `upsert_cat` | 新增或修改任意自定义猫咪（毛色、花纹、耳朵、瞳色、尾巴、白手套、高亮色、自定义胎记斑块），实时热更新上屏 |
| `switch_cat` | 按 ID 秒切桌面当前显示的猫咪 |
| `delete_cat` | 删除指定自定义猫咪（或重置内置外观） |
| `get_settings` / `update_settings` | 读取或实时修改缩放比例、按键气泡、呼噜声、置顶、穿透锁定与开机自启 |

自定义猫咪配置保存在：
- **Windows**：`%APPDATA%\kuro-cat-pet\cats.json`
- **macOS**：`~/Library/Application Support/kuro-cat-pet/cats.json`

也可手动编辑，桌宠自动实时热重载。

## 🛠️ 本地源码构建

前置环境：Windows 10/11 或 macOS 11+、Node.js 18+、Rust 工具链（`cargo`）。

```bash
git clone https://github.com/xiao97m-collab/kurocat.git
cd kurocat
npm install
npm run tauri:dev      # 本地热更新调试
npm run tauri:build    # 编译 Release 可执行文件与安装包
```

## 📄 开源协议

本项目基于 [MIT License](LICENSE) 开源。
