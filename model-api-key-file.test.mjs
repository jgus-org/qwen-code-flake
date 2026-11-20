import assert from "node:assert/strict";
import {
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

const chunks = readdirSync(join(process.env.QWEN_CODE_LIB, "chunks")).map(
  (name) => {
    const path = join(process.env.QWEN_CODE_LIB, "chunks", name);
    return { path, source: readFileSync(path, "utf8") };
  },
);
async function loadBundle(marker) {
  const matches = chunks.filter(({ source }) => source.includes(marker));
  assert.equal(matches.length, 1);
  return import(pathToFileURL(matches[0].path));
}
const { ModelsConfig } = await loadBundle("applyResolvedModelDefaults(model){");
const { resolveModelConfig } = await loadBundle(
  "function resolveModelConfig(input){",
);

function keyFixture(context) {
  const directory = mkdtempSync(join(tmpdir(), "qwen-model-key-test-"));
  context.after(() => rmSync(directory, { recursive: true }));
  const path = join(directory, "api-key");
  writeFileSync(path, "  file-key\n");
  return path;
}

test("model key file precedes other credential sources without an env binding", (context) => {
  const apiKeyFile = keyFixture(context);
  const result = resolveModelConfig({
    authType: "openai",
    modelProvider: { id: "model-a", apiKeyFile, envKey: "MODEL_KEY" },
    cli: { apiKey: "cli-key" },
    settings: { apiKey: "settings-key" },
    env: { MODEL_KEY: "model-env-key", OPENAI_API_KEY: "global-env-key" },
  });
  assert.equal(result.config.apiKey, "file-key");
  assert.equal(result.config.apiKeyEnvKey, undefined);
  assert.equal(result.sources.apiKey.detail, "apiKeyFile");
  assert.equal(
    resolveModelConfig({
      authType: "openai",
      modelProvider: { id: "model-a", envKey: "MODEL_KEY" },
      env: { MODEL_KEY: "model-env-key" },
    }).config.apiKey,
    "model-env-key",
  );
  assert.equal(
    resolveModelConfig({
      authType: "qwen-oauth",
      modelProvider: { id: "coder-model", apiKeyFile: "relative" },
      env: {},
    }).config.apiKey,
    "QWEN_OAUTH_DYNAMIC_TOKEN",
  );
});

test("invalid key files fail instead of using fallback credentials", (context) => {
  const emptyFile = keyFixture(context);
  writeFileSync(emptyFile, " \n");
  for (const apiKeyFile of [
    null,
    "relative",
    `${emptyFile}.missing`,
    emptyFile,
  ]) {
    assert.throws(() =>
      resolveModelConfig({
        authType: "openai",
        modelProvider: { id: "model-a", apiKeyFile },
        settings: { apiKey: "settings-key" },
        env: { OPENAI_API_KEY: "global-env-key" },
      }),
    );
  }
});

test("registry switches reload keys and report failures without changing the active route", async (context) => {
  const apiKeyFile = keyFixture(context);
  const secondFile = `${apiKeyFile}-second`;
  writeFileSync(secondFile, "second-key");
  const models = new ModelsConfig({
    initialAuthType: "openai",
    modelProvidersConfig: {
      openai: [
        { id: "model-a", apiKeyFile, baseUrl: "https://first.example/v1" },
        {
          id: "model-b",
          apiKeyFile: secondFile,
          baseUrl: "https://first.example/v1",
        },
        {
          id: "model-c",
          apiKeyFile: `${apiKeyFile}.missing`,
          baseUrl: "https://second.example/v1",
        },
      ],
    },
    onModelChange: async (_authType, requiresRefresh) =>
      assert.equal(requiresRefresh, true),
  });
  await models.switchModel("openai", "model-a");
  assert.equal(models.getGenerationConfig().apiKey, "file-key");
  await models.switchModel("openai", "model-b");
  assert.equal(models.getGenerationConfig().apiKey, "second-key");
  writeFileSync(secondFile, "rotated-key");
  await models.switchModel("openai", "model-b");
  assert.equal(models.getGenerationConfig().apiKey, "rotated-key");
  await assert.rejects(models.switchModel("openai", "model-c"));
  assert.equal(models.getModel(), "model-b");
  assert.equal(models.getGenerationConfig().apiKey, "rotated-key");
  assert.equal(
    models.getGenerationConfig().baseUrl,
    "https://first.example/v1",
  );
  const serializedRegistry = JSON.stringify([
    models.getAvailableModels(),
    models.getResolvedModel("openai", "model-b"),
  ]);
  assert.equal(serializedRegistry.includes("rotated-key"), false);
  assert.equal(serializedRegistry.includes("second-key"), false);
});
