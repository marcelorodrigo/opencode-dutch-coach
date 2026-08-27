# opencode-dutch-coach

An OpenCode 1.x plugin that provides a Dutch A1/A2 correction and practice
skill. It explains common mistakes in simple English and adds a `/dutch`
command for direct access.

## Local Testing

The package is currently intended to be tested locally before publication.
Install Node.js 22 or newer and pnpm 11.24.0 before running the commands below.

```sh
pnpm pack
```

Install the generated tarball in an OpenCode project:

```sh
pnpm add --save-dev /absolute/path/to/opencode-dutch-coach-0.1.0.tgz
```

Add the plugin to that project's `opencode.json`:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["opencode-dutch-coach"]
}
```

For an isolated test fixture, the plugin entry can instead point directly to
the installed artifact with a `file://` URL. This avoids relying on package
resolution outside the fixture:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": [
    "file:///absolute/path/to/project/node_modules/opencode-dutch-coach/dist/plugin.js"
  ]
}
```

Quit and restart OpenCode after changing the plugin or its configuration.

## Usage

Use `/dutch` with text to request a correction:

```text
/dutch Ik heb gisteren naar school gegaan.
```

Use `/dutch` without text to start an interactive coaching session. The skill
is also available when you explicitly ask OpenCode to correct, review, or help
you practise Dutch at A1/A2 level.

The plugin adds its skill path without removing existing skill paths or URLs.
It also does not replace an existing `dutch` command. If another configuration
already defines `/dutch`, that command remains active.

## Development

```sh
pnpm test
pnpm run test:integration
```

The automated tests validate the source package, the packed package artifact, and
OpenCode's model-free skill and command discovery. Model-backed response
quality is covered by manual smoke testing because it depends on the selected
provider.
