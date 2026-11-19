# SignPath Windows test signing

Organization: ZError [OSS] (e801fc0a-464b-43f1-a450-178cfef99316).
Project slug: ZError. Signing policy: test-signing.
Artifact configuration: windows-exe, matching [windows-exe.xml](windows-exe.xml).
The GitHub.com trusted build system is already linked to this project.

The test certificate has SHA-1 thumbprint
518CDF31F6EE09F3B4994F7A4B03CA2E81153F6F and expires on 2029-11-18.
Its key stays in SignPath. The CI credential belongs in the GitHub environment
signpath-test as SIGNPATH_API_TOKEN, never in repository files.

The workflow signpath-test.yml builds zerror.exe without bundling, uploads it to
GitHub Actions for origin verification, signs it, verifies its certificate and
signature, and then bundles that signed binary with NSIS. A second signing request
signs the outer installer. Both signing requests use the same windows-exe artifact
configuration: a ZIP containing exactly one PE file whose product name is ZError.
Third-party DLLs and the generated NSIS uninstaller are not signed by this workflow.

The verification script briefly trusts only the pinned self-signed certificate in
the ephemeral Windows runner's CurrentUser root store, verifies Authenticode, then
removes the temporary trust. This does not make the downloaded artifacts trusted
on users' computers.

Run it manually from GitHub Actions, or push signing configuration changes to
codex/signpath-setup during initial setup. The workflow only uploads artifacts
marked TEST-SIGNED, retains them for seven days, and does not publish releases,
update feeds, or Tauri updater signatures. The existing desktop release workflow
is unchanged.

After a successful run, provide the two signing request URLs and the workflow run
URL to SignPath for their technical review. The release-signing policy remains
unavailable until SignPath imports the production certificate. Production signing
must replace the test certificate pin and be integrated before updater signatures
are generated.

References:

- https://docs.signpath.io/trusted-build-systems/github
- https://docs.signpath.io/artifact-configuration/syntax
