// A manager row's menu, its Move up and Move down, opened by a right click, a long press, Shift+F10 or the Menu key.

// Pure: whether a key on a focused row opens its menu.
export const opensMenu = (event: { key: string; shiftKey: boolean }): boolean =>
  event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")

// What a manager row's description adds, so a screen reader hears the keyboard path.
export const MENU_HINT = "Shift+F10 opens its menu"
