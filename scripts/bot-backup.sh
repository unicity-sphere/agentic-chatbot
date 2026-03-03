#!/bin/sh
set -e

PROJECT="agentic-chatbot"

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
DATA_VOL="${PROJECT}_${BOT}-data"
TOKENS_VOL="${PROJECT}_${BOT}-tokens"

case "$ACTION" in
  backup)
    echo "Backing up $BOT volumes -> $ARCHIVE"
    docker run --rm \
      -v "${DATA_VOL}:/src/data-volume:ro" \
      -v "${TOKENS_VOL}:/src/tokens-volume:ro" \
      -v "$(pwd):/out" \
      alpine tar czf "/out/${ARCHIVE}" -C /src data-volume tokens-volume
    echo "Done: $ARCHIVE"
    ;;
  restore)
    [ -f "$ARCHIVE" ] || { echo "Error: $ARCHIVE not found"; exit 1; }
    echo "Restoring $BOT volumes from $ARCHIVE"
    docker run --rm \
      -v "${DATA_VOL}:/dst/data-volume" \
      -v "${TOKENS_VOL}:/dst/tokens-volume" \
      -v "$(pwd):/in:ro" \
      alpine sh -c "rm -rf /dst/data-volume/* /dst/tokens-volume/* && tar xzf /in/${ARCHIVE} -C /dst --strip-components=0"
    echo "Done. Restart the bot: docker compose up -d $BOT"
    ;;
  *)
    usage
    ;;
esac
