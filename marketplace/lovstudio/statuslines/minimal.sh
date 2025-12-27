#!/bin/bash
# Description: Minimal statusline showing only essentials
# Author: Claude Code Manager
# Version: 1.0.0

# Read JSON input
input=$(cat)

# Extract values using jq
MODEL=$(echo "$input" | jq -r '.model.display_name // "Claude"')
CURRENT_DIR=$(echo "$input" | jq -r '.workspace.current_dir // "~"')
COST_USD=$(echo "$input" | jq -r '.cost.total_cost_usd // 0')

# Get directory name
DIR_NAME=$(basename "$CURRENT_DIR")

# Get git branch if in a git repo
GIT_BRANCH=""
if [ -d "$CURRENT_DIR/.git" ] || git -C "$CURRENT_DIR" rev-parse --git-dir > /dev/null 2>&1; then
    BRANCH=$(git -C "$CURRENT_DIR" branch --show-current 2>/dev/null)
    if [ -n "$BRANCH" ]; then
        GIT_BRANCH=" ($BRANCH)"
    fi
fi

# Format cost
COST_STR=$(printf "$%.3f" $COST_USD)

# Simple output
echo -e "[$MODEL] $DIR_NAME$GIT_BRANCH | $COST_STR"