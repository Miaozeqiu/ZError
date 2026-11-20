# Runtime and module boundaries

The application composition root is `src/main.ts`. It installs the workspace command buffer and starts `services/agent/runtime.ts` before mounting Vue. Background watch processing belongs to this runtime. Visiting or leaving a workspace only controls its UI subscriptions. Disposal is idempotent and an obsolete disposer cannot remove a later runtime.

## Browser and website behavior

`services/browser/siteCapabilities.ts` defines the application-owned adapter contract. Generic navigation, page and course tools use this contract. Adapters declare navigation policies, catalog and watch capabilities, and dispatch repository-defined tools. Registration belongs to `services/platform/index.ts`, rather than an import side effect in the browser abstraction layer.

Remote repositories continue to use the existing compiled bundle manifest and QuickJS workflow protocol. Source origin, hashes, resource limits, command validation, tool allowlists, permission checks and isolated credentials remain host responsibilities. Installing an adapter does not grant a repository additional operations.

**Migration status:** local compatibility orchestration and DOM parsers still exist under `services/platform`, `services/chaoxing` and the website tool modules. The adapter boundary separates their dependencies from generic tools; it does not mean all website implementation has moved to Open. Further migration must transfer behavior to the repository protocol and remove the corresponding compatibility implementation, with contract tests for each operation.

## Agent lifecycle

`agent/core/waitEvents.ts` connects wait registration and watch notifications without importing the wait implementation at runtime. Watch callbacks carry a binding generation so deferred notifications and background recovery cannot continue into a replacement runtime.

Static service imports must be acyclic. `scripts/architecture-graph.mjs` analyzes value imports and reexports, ignoring type-only edges. The architecture tests also inspect dynamic imports at generic tool boundaries. Domain-specific implementation is kept out of these generic entry points.

## Workspaces and chat rendering

Each independent workspace loads on its first visit and stays mounted afterward. The command buffer retains the latest unhandled command per workspace and event type, then delivers it once when that workspace subscribes. Commands shared by Agent and Study have separate delivery slots. Credentials are not part of this buffer.

`views/agentChat/useThreadView.ts` owns selection, scrolling and DOM observer cleanup. `utils/ui/threadCodeHighlight.ts` observes changed code blocks and coalesces work per animation frame. Earlier messages are not scanned on every streamed token. Mermaid, D2 and Infographic remain on their own rendering paths.

## Model and skill services

Model configuration keeps its public facade and persistence behavior. Remote catalog reconciliation, selected-model replacement and shared-key policy live in separate modules. The effort matrix painter has its own view composable.

Skill types, configuration storage and GitHub installation are separate modules. The installer receives catalog/configuration callbacks; it does not import the manager singleton. Existing storage names, paths and overwrite rules are preserved.

## Native modules

The existing IPC entry points and public module paths remain facades. CEF browser implementation is split into layout, sessions, tabs, cookies, network, evaluation, interaction and snapshot modules. The browser bridge separates protocol and evaluation. HTTP service separates routing, queries, answers and model execution. The secret vault separates cryptography, credentials and legacy migration. Document, image and font commands have dedicated modules.

Platform cfg guards and browser identity checks remain in force. Storage encryption formats, keychain identity, application identifier and updater identity are unchanged. Local Rust checks cover the current macOS target; Windows and Linux require their respective CI/toolchains.

## Local validation

- `npm test`
- `npm run build`
- `npx vue-tsc --noEmit --noUnusedLocals --noUnusedParameters`
- `npm run rust:check`
- `npm run rust:test`

A native macOS bundle build and production-page smoke checks complement the unit tests. Builds and tests do not publish a release.
