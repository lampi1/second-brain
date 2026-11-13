// Types for seek-bzip (pure-JS bzip2, no types of its own): only the call main/voice/download.ts makes.
declare module 'seek-bzip' {
  const Bunzip: { decode(input: Uint8Array): Buffer };
  export default Bunzip;
}
