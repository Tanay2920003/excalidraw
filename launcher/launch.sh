#!/usr/bin/env bash
# =============================================================================
#  Excalidraw Secure Session Launcher — Linux / macOS
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
CYAN='\033[0;36m'; GRAY='\033[0;37m'; RESET='\033[0m'

clear
echo ""
echo -e "${CYAN}  ╔══════════════════════════════════════════════════════════╗${RESET}"
echo -e "${CYAN}  ║           EXCALIDRAW  ·  LAUNCHER GUI                    ║${RESET}"
echo -e "${CYAN}  ╚══════════════════════════════════════════════════════════╝${RESET}"
echo ""

echo -e "${YELLOW}  [1/2] Checking Docker...${RESET}"
if ! command -v docker &> /dev/null; then
    echo -e "${RED}  ✗ Docker not found.${RESET}"
    read -p "  Would you like to auto-install Docker now? (Y/n) " choice
    if [[ ! "$choice" =~ ^[nN] ]]; then
        echo -e "${YELLOW}  Installing Docker (requires sudo)...${RESET}"
        if command -v curl &> /dev/null; then
            curl -fsSL https://get.docker.com | sudo sh
        elif command -v wget &> /dev/null; then
            wget -qO- https://get.docker.com | sudo sh
        else
            echo -e "${RED}  ✗ Neither curl nor wget found. Cannot auto-install.${RESET}"
            exit 1
        fi
        echo -e "${GREEN}  ✓ Docker installed. You may need to log out and log back in to use docker without sudo.${RESET}"
        echo -e "${YELLOW}  Please restart the script once Docker is running.${RESET}"
        exit 0
    else
        echo -e "${YELLOW}  Please install Docker manually.${RESET}"
        exit 1
    fi
fi
echo -e "${GRAY}          $(docker --version)${RESET}"

echo -e "${YELLOW}  [2/2] Starting Control Panel...${RESET}"
if ! docker compose -f "$SCRIPT_DIR/docker-compose.yml" up gui -d; then
    echo -e "${RED}  ✗ Failed to start the GUI container.${RESET}"
    exit 1
fi

echo -e "${GREEN}  ✓ GUI is running.${RESET}"
echo ""

GUI_URL="http://localhost:7842"
echo -e "  Opening Excalidraw Launcher in your browser: ${GUI_URL}"

if command -v xdg-open &> /dev/null; then
    xdg-open "$GUI_URL" &> /dev/null &
elif command -v open &> /dev/null; then
    open "$GUI_URL" &> /dev/null &
fi

echo ""
echo -e "${GRAY}  Press [Ctrl+C] when you are completely finished to shut EVERYTHING down.${RESET}"

cleanup() {
    echo ""
    echo -e "${YELLOW}  Shutting down all Excalidraw containers...${RESET}"
    docker compose -f "$SCRIPT_DIR/docker-compose.yml" down >/dev/null 2>&1
    echo -e "${GREEN}  ✓ Done.${RESET}"
    exit 0
}

trap cleanup INT TERM

# Wait forever
while true; do sleep 1; done
