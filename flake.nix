{
  description = "Qwen Code standalone CLI";

  inputs = {
    flake-lib.url = "github:jgus-org/flake-lib/v1";
    nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";
  };

  outputs =
    {
      self,
      flake-lib,
      nixpkgs,
      ...
    }:
    with builtins;
    let
      assets = {
        aarch64-darwin = "qwen-code-darwin-arm64.tar.gz";
        aarch64-linux = "qwen-code-linux-arm64.tar.gz";
        x86_64-linux = "qwen-code-linux-x64.tar.gz";
      };
      source = {
        owner = "QwenLM";
        repo = "qwen-code";
        type = "github";
      };
    in
    flake-lib.lib.eachDefaultSystem (
      system:
      let
        pin = import ./pin.nix;
        pkgs = import nixpkgs { inherit system; };
        orgFormatting = flake-lib.lib.mkFormatting {
          inherit self system;
        };
      in
      {
        checks.formatting = orgFormatting.check;
        formatter = orgFormatting.formatter;
        packages = rec {
          default = qwen-code;
          qwen-code = pkgs.stdenv.mkDerivation {
            inherit (pin) version;
            buildInputs = pkgs.lib.optional pkgs.stdenv.hostPlatform.isLinux pkgs.stdenv.cc.cc.lib;
            doInstallCheck = true;
            dontBuild = true;
            installPhase = ''
              runHook preInstall
              mkdir -p "''${out}/bin"
              cp -r lib node manifest.json "''${out}/"
              makeWrapper "''${out}/node/bin/node" "''${out}/bin/qwen" \
                --set QWEN_CODE_LAUNCHER_PATH "''${out}/bin/qwen" \
                --add-flags "''${out}/lib/cli-entry.js" \
                --prefix PATH : ${pkgs.lib.makeBinPath [ pkgs.ripgrep ]}
              runHook postInstall
            '';
            meta = {
              description = "Terminal coding agent with local model and ACP support";
              homepage = "https://github.com/QwenLM/qwen-code";
              license = pkgs.lib.licenses.asl20;
              mainProgram = "qwen";
              platforms = attrNames assets;
              sourceProvenance = [ pkgs.lib.sourceTypes.binaryNativeCode ];
            };
            nativeBuildInputs = [
              pkgs.makeWrapper
              pkgs.nodejs
            ]
            ++ pkgs.lib.optional pkgs.stdenv.hostPlatform.isLinux pkgs.autoPatchelfHook;
            nativeInstallCheckInputs = [
              pkgs.versionCheckHook
              pkgs.writableTmpDirAsHomeHook
            ];
            # patchelf's program-header sorting rewrites this vendored node ELF into overlapping PT_LOAD entries, so the process SIGSEGVs before main(): NixOS/patchelf#668, #674.
            patchelfFlags = [ "--no-sort" ];
            pname = "qwen-code";
            postInstallCheck = ''
              "''${out}/bin/qwen" --help >/dev/null
              QWEN_CODE_LIB="''${out}/lib" "''${out}/node/bin/node" --test ${./model-api-key-file.test.mjs}
            '';
            postPatch = ''
              node ${./patch-model-api-key-file.mjs}
              cp ${./model-api-key-file.mjs} lib/model-api-key-file.mjs
            '';
            src = pkgs.fetchurl {
              hash = pin.hashes.${system};
              url = "https://github.com/QwenLM/qwen-code/releases/download/v${pin.version}/${assets.${system}}";
            };
            versionCheckProgram = "${placeholder "out"}/bin/qwen";
            versionCheckProgramArg = "--version";
          };
          update-branches = flake-lib.lib.mkUpdateBranches {
            inherit pkgs source;
            minimumTrackingVersion = "0.24.0";
            pinSchema = "version-only";
            trackStableOnly = true;
          };
          update-version = pkgs.writeShellApplication {
            name = "update-version";
            runtimeInputs = [
              pkgs.coreutils
              pkgs.diffutils
              pkgs.gh
              pkgs.jq
              pkgs.nix
            ];
            text = ''
              if (( ''${#} > 2 )); then
                echo "error: update-version takes at most a version and the upstream version it resolves to" >&2
                exit 1
              fi
              RELEASE_ASSETS=${pkgs.lib.escapeShellArg (toJSON assets)}
              FLAKE_ROOT="''${FLAKE_ROOT:-''${PWD}}"
              VERSION="''${1:-}"
              if [[ -z "''${VERSION}" ]]; then
                VERSION="$(gh api --paginate --slurp /repos/QwenLM/qwen-code/releases | jq -er --argjson ASSETS "''${RELEASE_ASSETS}" '[.[][] | select((.draft or .prerelease) | not) | select(any(.assets[]; .name as $NAME | $ASSETS | any(. == $NAME)))][0].tag_name')"
              fi
              VERSION="''${VERSION#[vV]}"
              WORK_DIR="$(mktemp -d)"
              PIN_WRITTEN=0
              cleanup() {
                STATUS="''${?}"
                if (( STATUS != 0 && PIN_WRITTEN == 1 )); then
                  mv -- "''${WORK_DIR}/previous-pin.nix" "''${FLAKE_ROOT}/pin.nix"
                fi
                rm -r -- "''${WORK_DIR}"
                exit "''${STATUS}"
              }
              trap cleanup EXIT
              HASHES='{}'
              while IFS=$'\t' read -r SYSTEM ASSET; do
                HASH="$(nix store prefetch-file --json --hash-type sha256 "https://github.com/QwenLM/qwen-code/releases/download/v''${VERSION}/''${ASSET}" | jq -er '.hash')"
                HASHES="$(jq --arg SYSTEM "''${SYSTEM}" --arg HASH "''${HASH}" '. + {($SYSTEM): $HASH}' <<<"''${HASHES}")"
              done < <(jq -r 'to_entries[] | [.key, .value] | @tsv' <<<"''${RELEASE_ASSETS}")
              {
                echo "# Auto-managed by \`nix run .#update-version\`. Manual edits will be overwritten by the next bump."
                jq -r --arg VERSION "''${VERSION}" '
                  "{\n  hashes = {\n"
                  + (to_entries | map("    \(.key) = \(.value | tojson);") | join("\n"))
                  + "\n  };\n  version = \($VERSION | tojson);\n}"
                ' <<<"''${HASHES}"
              } >"''${WORK_DIR}/pin.nix"
              if ! cmp -s "''${WORK_DIR}/pin.nix" "''${FLAKE_ROOT}/pin.nix"; then
                cp -- "''${FLAKE_ROOT}/pin.nix" "''${WORK_DIR}/previous-pin.nix"
                mv -- "''${WORK_DIR}/pin.nix" "''${FLAKE_ROOT}/pin.nix"
                PIN_WRITTEN=1
              fi
              HOST_SYSTEM="$(nix config show system)"
              nix eval --raw "''${FLAKE_ROOT}#packages.''${HOST_SYSTEM}.qwen-code.drvPath" >/dev/null
            '';
          };
        };
      }
    );
}
