## $(date +%Y-%m-%d) - Prevent Unnecessary Array References with Signals

**Learning:** In Angular components using OnPush change detection, using getters that return new array references (like `.filter()`) within templates causes unnecessary change detection cycles.
**Action:** Always convert synchronous getters bound to templates into `computed()` signals when they compute a new array or object.
