# Next

Breaking-change notes for the next release, collected here as they land —
this page is not tied to a version number yet. Once this release is tagged,
any note here moves onto its own numbered page (see
[Migration](/reference/migration)) and this page resets to empty.

## A tab change made from code no longer takes keyboard focus

**What changed and why.** Selecting or closing a tab from code focused a tab
button, taking focus from whatever held it — a file tree being arrowed through
lost focus on every selection that opened or switched a `Dock` panel. A change
made from code now moves only the tab stop. A switch still moves focus onto
the new tab when the strip already holds focus, when nothing holds focus, or
when focus was inside the tab content being hidden. Closing the active tab
still moves focus onto its neighbour when the closed tab or its content held
focus. A close made on the strip (the ✕, `Delete`, the context menu's
*Close* and its bulk closes) now always ends with focus and the tab stop on
the active tab. Closing a background tab used to move focus to its neighbour
only when that tab held focus, which could leave focus on a tab that was not
selected. Other gestures on the strip are unchanged.

| Call | Before | Now |
| --- | --- | --- |
| `tab.setActiveTabIndex(i)`, focus in another control | focus moves to the tab button | focus stays |
| `tab.setActiveContent(c)`, focus in another control | focus moves to the tab button | focus stays |
| `dock.focusPanel(id)` (tiled panel), focus in another control | focus moves to the tab button | focus stays |
| `dock.addPanel(spec)`, focus in another control | focus moves to the tab button | focus stays |
| `tab.closeTab(c)` / `dock.removePanel(id)` of the active tab, focus in another control | focus moves to the neighbouring tab button | focus stays |
| `tab.closeTab(c)` / `dock.removePanel(id)` of the active tab, nothing focused | focus moves to the neighbouring tab button | nothing focused |
| `tabBar.setActiveEntry(id)`, focus in another control | focus moves to the entry's button | focus stays |
| `tabBar.removeBarEntry(id)` of the active entry, focus in another control | focus moves to the neighbouring entry's button | focus stays |
| ✕, `Delete` or the menu's *Close* on a background tab, focus in another control | focus stays | focus moves to the active tab's button |
| ✕, `Delete` or the menu's *Close* on a background tab that holds focus | focus moves to the neighbouring tab's button | focus moves to the active tab's button |
| the menu's *Close others* / *Close all to the left* / *Close all to the right* | focus ends where the single closes leave it, possibly on a tab that is not selected | focus moves to the active tab's button |

**Who needs to act.** Code that relied on a switch from code landing focus on
the tab strip, such as a keyboard shortcut that switches tabs and expects the
strip to be focused. Pass `{ focus: true }`:

```typescript
// Before
tab.setActiveTabIndex(2);                    // focus moved to the tab button

// After — keep that landing
tab.setActiveTabIndex(2, { focus: true });
```
