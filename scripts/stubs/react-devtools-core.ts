// No-op stub for `react-devtools-core`. Ink imports this in its devtools path
// (only exercised when DEV=true). It pulls in a large optional dependency that
// can't resolve inside a `bun build --compile` single-file binary, so we alias
// it to this stub at bundle time (see scripts/build-cli.ts).
const devtools = {
  connectToDevTools() {
    /* no-op in compiled builds */
  },
};

export default devtools;
