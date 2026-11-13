# Browser JavaScript boundary

The browser `javascript` tool runs caller code only on the top page of local development stacks, using only the exact `localhost` name or literal loopback addresses `127.0.0.1` and `::1`. Project `.test` aliases and localhost subdomains are not admitted for caller code: a host alias alone does not attest a loopback endpoint. Broader host classification for standard browser tools is unchanged. It requires HTTP(S), a matching page origin and a current CDP default execution context. Opaque origins and unverified contexts fail closed.

Remote sites retain browser tabs, login handoff, navigation and the validated standard interaction tools. Inspect remote pages and iframes with `read_page`, `get_page_text`, `find` and `screenshot`. Caller-supplied JavaScript in iframes is unavailable. A tool description calling arbitrary code “inspection only” cannot enforce isolation.

Before sending caller code, main rechecks the current URL, frame identity, origin, context and user handoff. It supplies a system-unique context identifier, never a numeric/default-context fallback. If navigation invalidates that context, the operation fails instead of running in the next document. Local scripts are a development capability; this is not a JavaScript sandbox.

Implementation references: [CDP Runtime execution contexts/evaluate](https://chromedevtools.github.io/devtools-protocol/tot/Runtime/) documents system-unique context identifiers across processes; [Electron WebFrameMain](https://www.electronjs.org/docs/latest/api/web-frame-main) documents frame URL, origin, process and lifetime. Installed Electron API types were checked; packaged Electron behavior still requires runtime verification.

No account, browser partition, cookies or login session is reset by this change. No hooks, global permissions or external services are configured.
