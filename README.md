# Ambit
Built this because I wanted a replacement for my sticky note task management system. Command-based input. 

## Commands
#### Categories
- `+ [name]` - Create category
- `@ [name]` - Focus category
- `- [name]` - Delete category
- `pin [name]` - Toggle pin
- `rn [old] -> [new]` - Rename category
- `order [name] ![up|down|top|bottom]` - Reorder categories/tasks

#### Tasks (in focused category)
- `[task text]` - Add task
- `done [text]` - Mark task complete
- `undo [text]` - Mark task incomplete
- `del [text]` - Delete task
- `ed [old] -> [new]` - Edit task text
- `mv [text] -> [cat]` - Move task
- `dup [text]` - Duplicate task

#### Date & Time
- Append `by [phrase]` to add a due date.
- Quick shortcuts: `!today`, `!fri`, `!saturday`
- Recurring: `every mon [task]`, `every 2w [task]`
- Snooze: `snooze [text] -> [+3d]`
- Examples: `in 2 biz days`, `next friday at 5pm`, `eom`, `+3d`

#### Shortcuts
- `Tab` - Autocomplete commands
- `Up/Down Arrow` - Command history
