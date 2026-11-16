# Command palette

![The command palette](images/palette.png#gh-light-mode-only)
![The command palette](images/palette-dark.png#gh-dark-mode-only)

Press **Ctrl+K** (**⌘K** on a Mac) anywhere, or click **Search…** in the header. Type, and press **Enter** to go there.

## What it searches

| Group | Contents |
| --- | --- |
| **Recent** | The last things you opened. Shown only while the box is empty. |
| **Go to** | Targets, Fixtures, Activity, the target's Overview and each service, and **All operations**. |
| **Resources** | Inside a target: its buckets, tables, queues, functions, topics and secrets, plus your targets and fixtures. |
| **Operations** | Every operation of every service, as `service.Operation` (for example `ssm.PutParameter`), once you have typed two characters. |
| **Actions** | Use light, dark or system theme. |

Matching is fuzzy: you can type just some of the letters of a name, and the characters that matched are highlighted. Better matches come first inside each group.

Resources are loaded only while the palette is open, and cached briefly, so opening it again is instant. A service the emulator lacks simply contributes nothing.

## Keys

| Key | Does |
| --- | --- |
| **↑ / ↓** | Move the highlight (it stops at the ends) |
| **Enter** | Open the highlighted result, or run the action |
| **Esc** | Close |
| **Ctrl/⌘ K** | Open, from anywhere |

Opening a result also remembers it under **Recent**. Choosing an action (such as a theme) is never remembered.
