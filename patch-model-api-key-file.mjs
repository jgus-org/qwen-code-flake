import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const chunks = new Map(
  readdirSync("lib/chunks")
    .filter((name) => name.endsWith(".js"))
    .map((name) => {
      const path = join("lib/chunks", name);
      return [path, readFileSync(path, "utf8")];
    }),
);
const patches = [
  [
    "const apiKeyLayers=[];if(authType&&modelProvider?.envKey){",
    'const apiKeyLayers=[];if(authType&&modelProvider?.apiKeyFile!==void 0){apiKeyLayers.push(layer(readModelApiKeyFile(modelProvider.apiKeyFile),modelProvidersSource(authType,modelProvider.id,"apiKeyFile")))}else if(authType&&modelProvider?.envKey){',
  ],
  [
    "let apiKeyEnvKey;if(authType&&modelProvider?.envKey){",
    "let apiKeyEnvKey;if(authType&&modelProvider?.apiKeyFile===void 0&&modelProvider?.envKey){",
  ],
  [
    "if(model.envKey!==void 0){const apiKey=process2.env[model.envKey];",
    'if(this.currentAuthType!=="qwen-oauth"&&model.apiKeyFile!==void 0){this._generationConfig.apiKey=readModelApiKeyFile(model.apiKeyFile);this.generationConfigSources["apiKey"]={kind:"modelProviders",authType:model.authType,modelId:model.id,detail:"apiKeyFile"};delete this.generationConfigSources["apiKeyEnvKey"]}else if(model.envKey!==void 0){const apiKey=process2.env[model.envKey];',
  ],
  [
    "const criticalFieldsChanged=previousModel.envKey!==currentModel.envKey||previousModel.baseUrl!==currentModel.baseUrl;",
    "const criticalFieldsChanged=previousModel.apiKeyFile!==void 0||currentModel.apiKeyFile!==void 0||previousModel.envKey!==currentModel.envKey||previousModel.baseUrl!==currentModel.baseUrl;",
  ],
];
const changed = new Set();
for (const [original, replacement] of patches) {
  const matches = [...chunks].filter(([, source]) => source.includes(original));
  if (matches.length !== 1 || matches[0][1].split(original).length !== 2) {
    throw new Error("Qwen model credential patch anchor is not unique");
  }
  const [path, source] = matches[0];
  chunks.set(path, source.replace(original, replacement));
  changed.add(path);
}
for (const path of changed) {
  writeFileSync(
    path,
    'import { readModelApiKeyFile } from "../model-api-key-file.mjs";\n' +
      chunks.get(path),
  );
}
