import { readFileSync } from "node:fs";
import { isAbsolute } from "node:path";

export function readModelApiKeyFile(path) {
  if (typeof path !== "string" || !isAbsolute(path)) {
    throw new Error("Model API key file path is not absolute");
  }
  const apiKey = readFileSync(path, "utf8").trim();
  if (apiKey.length === 0) {
    throw new Error("Model API key file is empty");
  }
  return apiKey;
}
