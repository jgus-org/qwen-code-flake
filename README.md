# qwen-code

A Nix flake that packages [Qwen Code](https://github.com/QwenLM/qwen-code), a terminal coding agent, from upstream's published release bundles.

## Outputs

`packages.qwen-code`, also `packages.default`, on `x86_64-linux`, `aarch64-linux`, and `aarch64-darwin`. The attribute is named `qwen-code`. The program it provides is `bin/qwen`.

```sh
nix run .#qwen-code
```

## Notes

- The package is upstream's prebuilt bundle: `meta.sourceProvenance` is `binaryNativeCode`, and there is no source build to inspect. `x86_64-darwin` is not published.
- The bundle carries its own Node runtime and `ripgrep`, so the package needs nothing from the host.
- Model provider entries accept `apiKeyFile` as an alternative to `envKey`: an absolute path whose contents are used as that model's API key, in place of the named environment variable.

See [LICENSE.md](LICENSE.md) for licensing and copyright, and [NOTICE.md](NOTICE.md) for the terms of upstream and distributed artifacts.
