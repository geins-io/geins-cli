// Bun `with { type: 'text' }` imports used by the web shell to inline xterm.js
// (source + stylesheet) into the served HTML. At runtime these resolve to the
// file CONTENTS as a string, not the module's exports.
declare module '*.css' {
  const src: string;
  export default src;
}
declare module '@xterm/xterm/lib/xterm.js' {
  const src: string;
  export default src;
}
declare module '@xterm/addon-fit/lib/addon-fit.js' {
  const src: string;
  export default src;
}
