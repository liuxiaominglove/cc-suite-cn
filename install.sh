#!/usr/bin/env bash
set -euo pipefail

REPO_URL="https://github.com/liuxiaominglove/cc-suite-cn.git"
DEFAULT_DIR="$HOME/cc-suite-cn"

DRY_RUN=0
SKIP_KEYS=0
NO_CLONE=0
UNINSTALL=0
WRITE_KEY_ARG=""
REPO_DIR=""
RC_FILE=""

MANAGED_BEGIN="# cc-suite-cn:managed:begin"
MANAGED_END="# cc-suite-cn:managed:end"
PROVENANCE_FILE="${CC_PROVENANCE_FILE:-$HOME/.cc-suite-cn-provenance.txt}"

say()  { printf '%s\n' "$*"; }
ok()   { printf '\033[32m✓\033[0m %s\n' "$*"; }
warn() { printf '\033[33m⚠\033[0m %s\n' "$*"; }
err()  { printf '\033[31m✗\033[0m %s\n' "$*" >&2; }

usage() {
  say "用法: bash install.sh [选项]"
  say ""
  say "一键安装 cc-suite-cn（幂等，可重复运行）"
  say ""
  say "选项:"
  say "  --dry-run     只打印将执行的动作，不安装、不写任何文件"
  say "  --skip-keys   跳过 API key 交互询问"
  say "  --no-clone    不 clone 仓库（使用 $DEFAULT_DIR 或当前目录）"
  say "  --write-key NAME=VALUE  内部/测试用：直接写入单个 key（幂等）"
  say "  --uninstall  只删除 cc-suite-cn 写入的 key（哨兵块内），手动条目不动"
  say "  -h, --help    显示本帮助"
  say ""
  say "环境变量:"
  say "  CC_RC_FILE    自定义 rc 文件路径（默认按 shell 选 ~/.zshrc 或 ~/.bashrc）"
}

parse_args() {
  while [ "$#" -gt 0 ]; do
    case "$1" in
      --dry-run) DRY_RUN=1 ;;
      --skip-keys) SKIP_KEYS=1 ;;
      --no-clone) NO_CLONE=1 ;;
      --uninstall) UNINSTALL=1 ;;
      -h|--help) usage; exit 0 ;;
      --write-key)
        if [ "$#" -lt 2 ]; then
          err "--write-key 需要一个 NAME=VALUE 参数"
          exit 1
        fi
        WRITE_KEY_ARG="${2:-}"; shift ;;
      --write-key=*)
        WRITE_KEY_ARG="${1#*=}" ;;
      *)
        err "未知参数: $1"; usage; exit 1 ;;
    esac
    shift
  done
}

detect_rc() {
  if [ -n "${CC_RC_FILE:-}" ]; then
    RC_FILE="$CC_RC_FILE"
    return
  fi
  if [[ "${SHELL:-}" == *zsh* ]]; then
    RC_FILE="$HOME/.zshrc"
  else
    RC_FILE="$HOME/.bashrc"
  fi
}

write_key() {
  local name="$1" val="$2"
  if [[ ! "$name" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]]; then
    err "非法变量名「${name}」（只允许字母/数字/下划线，且不以数字开头），已拒绝写入"
    return 1
  fi
  if [[ ! "$val" =~ ^[A-Za-z0-9._/+=-]+$ ]]; then
    err "「${name}」含非法字符（只允许字母/数字/点/下划线/连字符/斜杠/加号/等号），已拒绝写入"
    return 1
  fi
  if grep -q "^export ${name}=" "$RC_FILE" 2>/dev/null; then
    ok "$name 已存在于 ${RC_FILE}，跳过"
    return 0
  fi
  if [ "$DRY_RUN" -eq 1 ]; then
    say "  [dry-run] 将写入 $name → $RC_FILE"
    return 0
  fi
  touch "$RC_FILE"
  {
    echo "$MANAGED_BEGIN"
    echo "export ${name}='${val}'"
    echo "$MANAGED_END"
  } >> "$RC_FILE"
  export "$name"="$val"
  record_managed_key "$name"
  ok "已写入 $name → $RC_FILE"
}

record_managed_key() {
  local name="$1"
  if [ -f "$PROVENANCE_FILE" ] && grep -qx "$name" "$PROVENANCE_FILE" 2>/dev/null; then
    return 0
  fi
  echo "$name" >> "$PROVENANCE_FILE"
}

uninstall_keys() {
  if [ ! -f "$RC_FILE" ]; then
    warn "未找到 ${RC_FILE}，无需卸载"
    rm -f "$PROVENANCE_FILE"
    return 0
  fi
  if [ "$DRY_RUN" -eq 1 ]; then
    say "  [dry-run] 将删除 ${RC_FILE} 中 cc-suite-cn 管理的 key"
    return 0
  fi
  local tmp="${RC_FILE}.cc-suite-cn.tmp"
  sed "/${MANAGED_BEGIN}/,/${MANAGED_END}/d" "$RC_FILE" > "$tmp"
  mv "$tmp" "$RC_FILE"
  if [ -f "$PROVENANCE_FILE" ]; then
    say "卸载的 key：$(tr '\n' ' ' < "$PROVENANCE_FILE")"
    rm -f "$PROVENANCE_FILE"
  fi
  ok "已卸载：只删除哨兵块内的 key，手动条目不动"
}

ensure_key_interactive() {
  local name="$1" hint="$2"
  if [[ -n "${!name:-}" ]]; then
    ok "$name 已在环境变量中，跳过"
    return 0
  fi
  if grep -q "^export ${name}=" "$RC_FILE" 2>/dev/null; then
    ok "$name 已存在于 ${RC_FILE}，跳过"
    return 0
  fi
  if [ "$DRY_RUN" -eq 1 ]; then
    say "  [dry-run] 将交互询问 $name"
    return 0
  fi
  if [ "$SKIP_KEYS" -eq 1 ]; then
    warn "跳过 ${name}（--skip-keys），请稍后手动补"
    return 0
  fi
  local val=""
  while [[ -z "$val" ]]; do
    printf '%s' "请输入 ${name}（${hint}）: "
    if ! read -r -s val < /dev/tty 2>/dev/null; then
      echo
      err "读取输入失败（无交互终端？）"
      return 1
    fi
    echo
  done
  write_key "$name" "$val"
}

check_prereqs() {
  local missing=0
  if ! command -v git >/dev/null 2>&1; then
    err "缺少 git"
    say "  安装：macOS → brew install git；Linux → sudo apt install git"
    missing=1
  fi
  if ! command -v node >/dev/null 2>&1; then
    err "缺少 Node.js（需 >= 18）"
    say "  下载 LTS：https://nodejs.org"
    missing=1
  elif ! node -e 'process.exit(process.versions.node.split(".")[0] >= 18 ? 0 : 1)' 2>/dev/null; then
    err "Node.js 版本过低（需 >= 18）"
    missing=1
  fi
  if ! command -v npm >/dev/null 2>&1; then
    err "缺少 npm"
    missing=1
  fi
  return "$missing"
}

install_opencode() {
  if command -v opencode >/dev/null 2>&1; then
    ok "opencode 已安装"
    return 0
  fi
  if [ "$DRY_RUN" -eq 1 ]; then
    say "  [dry-run] 将安装 opencode"
    return 0
  fi
  say "安装 opencode ..."
  curl -fsSL https://opencode.ai/install | bash
  ok "opencode 安装完成（请重开终端刷新 PATH）"
}

install_clis() {
  local c missing=""
  for c in codebuddy kimi qwen; do
    if ! command -v "$c" >/dev/null 2>&1; then
      missing="$missing $c"
    fi
  done
  if [ -z "$missing" ]; then
    ok "3 个 worker CLI 已就绪"
    return 0
  fi
  if [ "$DRY_RUN" -eq 1 ]; then
    say "  [dry-run] 将安装:$missing"
    return 0
  fi
  say "安装 worker CLI:$missing ..."
  for c in $missing; do
    case "$c" in
      codebuddy) npm install -g @tencent-ai/codebuddy-code ;;
      kimi) npm install -g @moonshot-ai/kimi-code ;;
      qwen) npm install -g @qwen-code/qwen-code ;;
    esac
  done
  ok "worker CLI 安装完成"
}

export_rc_keys() {
  if [ ! -f "$RC_FILE" ]; then
    return 0
  fi
  local name line v
  for name in DASHSCOPE_API_KEY MOONSHOT_API_KEY TOKENHUB_API_KEY; do
    [ -n "${!name:-}" ] && continue
    line="$(grep -E "^export ${name}=" "$RC_FILE" 2>/dev/null | head -1 || true)"
    [ -n "$line" ] || continue
    v="${line#*=}"
    v="${v#\"}"; v="${v%\"}"
    v="${v#\'}"; v="${v%\'}"
    [ -n "$v" ] && export "$name"="$v"
  done
}

setup_keys() {
  say "检查 API key ..."
  ensure_key_interactive DASHSCOPE_API_KEY "阿里百炼 dashscope.aliyun.com"
  ensure_key_interactive MOONSHOT_API_KEY "月之暗面 platform.moonshot.cn"
  ensure_key_interactive TOKENHUB_API_KEY "腾讯 TokenHub console.cloud.tencent.com/tokenhub/models"
  export_rc_keys
}

clone_repo() {
  local here="$PWD"
  if [ -f "$here/scripts/jobs.mjs" ] && [ -f "$here/package.json" ]; then
    ok "已在仓库内（${here}），跳过 clone"
    REPO_DIR="$here"
    return 0
  fi
  if [ "$NO_CLONE" -eq 1 ]; then
    if [ -f "$DEFAULT_DIR/scripts/jobs.mjs" ]; then
      REPO_DIR="$DEFAULT_DIR"
      ok "使用现有仓库 $DEFAULT_DIR"
      return 0
    fi
    err "--no-clone 但未找到仓库（${DEFAULT_DIR}）"
    return 1
  fi
  if [ "$DRY_RUN" -eq 1 ]; then
    say "  [dry-run] 将 clone 到 $DEFAULT_DIR"
    REPO_DIR="$DEFAULT_DIR"
    return 0
  fi
  if [ -d "$DEFAULT_DIR/.git" ]; then
    say "已存在 ${DEFAULT_DIR}，git pull 更新 ..."
    ( cd "$DEFAULT_DIR" && git pull ) || { err "git pull 失败"; return 1; }
  else
    say "clone 仓库到 ${DEFAULT_DIR} ..."
    git clone --depth 1 "$REPO_URL" "$DEFAULT_DIR" || { err "git clone 失败"; return 1; }
  fi
  REPO_DIR="$DEFAULT_DIR"
}

install_deps() {
  if [ "$DRY_RUN" -eq 1 ]; then
    say "  [dry-run] 将在 $REPO_DIR 跑 npm install"
    return 0
  fi
  say "安装依赖 ..."
  ( cd "$REPO_DIR" && npm install --prefer-offline --no-audit --no-fund )
  ok "依赖安装完成"
}

run_preflight() {
  if [ "$DRY_RUN" -eq 1 ]; then
    say "  [dry-run] 将在 $REPO_DIR 跑 npm run preflight"
    return 0
  fi
  say "自检（preflight）..."
  ( cd "$REPO_DIR" && npm run preflight )
}

main() {
  parse_args "$@"

  if [ -n "$WRITE_KEY_ARG" ]; then
    detect_rc
    if [[ "$WRITE_KEY_ARG" != *=* ]]; then
      err "--write-key 需要 NAME=VALUE 格式（例如 DASHSCOPE_API_KEY=你的key）"
      exit 1
    fi
    local name="${WRITE_KEY_ARG%%=*}" val="${WRITE_KEY_ARG#*=}"
    write_key "$name" "$val"
    exit $?
  fi

  if [ "$UNINSTALL" -eq 1 ]; then
    detect_rc
    uninstall_keys
    exit 0
  fi

  detect_rc

  say "=============================================="
  say " cc-suite-cn 一键安装"
  say " 建议先看再跑：git clone $REPO_URL 后读一遍本脚本"
  say "=============================================="
  say ""
  if [ "$DRY_RUN" -eq 1 ]; then
    warn "DRY-RUN 模式：只打印将执行的动作，不安装、不写文件"
  fi

  if check_prereqs; then
    :
  elif [ "$DRY_RUN" -eq 1 ]; then
    warn "（dry-run）前置依赖缺失，真实安装时会在这一步退出"
  else
    exit 1
  fi
  install_opencode
  install_clis
  setup_keys
  clone_repo || exit 1
  install_deps
  run_preflight

  say ""
  ok "安装完成。下一步："
  say "  cd $REPO_DIR && opencode"
  say "  进入后敲 /audit src/ 即可感受流程。"
}

main "$@"
