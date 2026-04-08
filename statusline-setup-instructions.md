# Status Line Setup Instructions

## What was created

Two status line scripts are available in this project directory:

1. `statusline.sh` - Bash version (recommended for Git Bash / WSL)
2. `statusline.ps1` - PowerShell version (for native Windows PowerShell)

Both scripts display: **Model Name [Progress Bar] XX%**

The progress bar is color-coded:
- Green (< 50% context used)
- Yellow (50-80% context used)  
- Red (> 80% context used)

## Installation

### Step 1: Copy the script to ~/.qwen/

**For Bash (Git Bash):**
```bash
mkdir -p ~/.qwen
cp statusline.sh ~/.qwen/statusline.sh
chmod +x ~/.qwen/statusline.sh
```

**For PowerShell:**
```powershell
New-Item -ItemType Directory -Force -Path "$env:USERPROFILE\.qwen"
Copy-Item statusline.ps1 "$env:USERPROFILE\.qwen\statusline.ps1"
```

### Step 2: Edit ~/.qwen/settings.json

Add the `ui.statusLine` configuration. If the file does not exist, create it with:

**For Bash:**
```json
{
  "ui": {
    "statusLine": {
      "type": "command",
      "command": "~/.qwen/statusline.sh",
      "padding": 2
    }
  }
}
```

**For PowerShell:**
```json
{
  "ui": {
    "statusLine": {
      "type": "command",
      "command": "powershell -NoProfile -File \"$env:USERPROFILE\\.qwen\\statusline.ps1\"",
      "padding": 2
    }
  }
}
```

If the file already exists, merge the `ui.statusLine` object into the existing `ui` section.

### Step 3: Restart Qwen Code

Restart the CLI for the status line to take effect.

## Expected output

```
glm-5.1 [##########----------] 50%
```

When context usage is below 50%, the bar is green.
Between 50-80%, it turns yellow.
Above 80%, it turns red.
