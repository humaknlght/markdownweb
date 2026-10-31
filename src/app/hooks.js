/**
 * Late-bound cross-module call bag. Each domain module assigns its exports onto
 * `hooks` at load time so peer modules can call them without import cycles.
 * @type {Record<string, any>}
 */
export const hooks = {};
