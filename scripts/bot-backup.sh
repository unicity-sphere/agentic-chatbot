#!/bin/sh
set -e

usage() {
  echo "Usage: $0 backup|restore <bot-name>"
  echo "  bot-name: kbbot, viktor, etc."
  echo ""
  echo "Examples:"
  echo "  $0 backup viktor          # creates viktor-backup.tar.gz"
  echo "  $0 restore viktor         # restores from viktor-backup.tar.gz"
  exit 1
}

[ $# -eq 2 ] || usage

ACTION="$1"
BOT="$2"
ARCHIVE="${BOT}-backup.tar.gz"
BOT_DIR="data/${BOT}"

case "$ACTION" in
  backup)
    [ -d "$BOT_DIR" ] || { echo "Error: $BOT_DIR not found"; exit 1; }
    echo "Backing up $BOT_DIR -> $ARCHIVE"
    tar czf "$ARCHIVE" -C "$BOT_DIR" data tokens
    echo "Done: $ARCHIVE"
    ;;
  restore)
    [ -f "$ARCHIVE" ] || { echo "Error: $ARCHIVE not found"; exit 1; }
    echo "Restoring $BOT from $ARCHIVE -> $BOT_DIR"
    mkdir -p "$BOT_DIR"
    rm -rf "${BOT_DIR:?}/data" "${BOT_DIR:?}/tokens"
    tar xzf "$ARCHIVE" -C "$BOT_DIR"
    echo "Done. Restart the bot: docker compose up -d $BOT"
    ;;
  *)
    usage
    ;;
esac
