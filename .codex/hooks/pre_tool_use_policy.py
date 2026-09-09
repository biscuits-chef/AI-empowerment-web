#!/usr/bin/env python3
"""阻止明显超出仓库范围且难以恢复的命令。"""

import json
import re
import sys


def main() -> None:
    try:
        payload = json.load(sys.stdin)
    except (json.JSONDecodeError, TypeError):
        payload = {}
    command = str(payload.get("tool_input", {}).get("command", ""))
    blocked = [
        r"\brm\s+-rf\s+(?:/|~|\$HOME)(?:\s|$)",
        r"\bgit\s+reset\s+--hard\b",
        r"\bgit\s+clean\s+-[a-zA-Z]*f",
        r"\bgit\s+push\s+[^\n]*--force\b",
    ]
    if any(re.search(pattern, command) for pattern in blocked):
        print(json.dumps({"decision": "block", "reason": "命令具有不可恢复的破坏风险"}))
        return
    print(json.dumps({"decision": "allow"}))


if __name__ == "__main__":
    main()
