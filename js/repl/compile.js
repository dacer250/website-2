// @flow

// Globals pre-loaded by Worker
declare var Babel: any;

import { getDebugInfoFromEnvResult } from "./replUtils";

import type { BabelPresetEnvResult, CompileConfig } from "./types";

type Return = {
  compiled: ?string,
  ast: ?any,
  compileErrorMessage: ?string,
  envPresetDebugInfo: ?string,
  sourceMap: ?string,
};

export default function compile(code: string, config: CompileConfig): Return {
  const { envConfig } = config;

  let compiled = null;
  let transformTime = null;
  let ast = null;
  let compileErrorMessage = null;
  let envPresetDebugInfo = null;
  let sourceMap = null;

  if (envConfig && envConfig.isEnvPresetEnabled) {
    const targets = {};
    if (envConfig.browsers) {
      targets.browsers = envConfig.browsers
        .split(",")
        .map(value => value.trim())
        .filter(value => value);
    }
    if (envConfig.isElectronEnabled) {
      targets.electron = envConfig.electron;
    }
    if (envConfig.isNodeEnabled) {
      targets.node = envConfig.node;
    }

    // onPresetBuild is invoked synchronously during compilation.
    // But the env preset info calculated from the callback should be part of our state update.
    let onPresetBuild = null;
    if (config.debugEnvPreset) {
      onPresetBuild = (result: BabelPresetEnvResult) => {
        envPresetDebugInfo = getDebugInfoFromEnvResult(result);
      };
    }

    const options = {
      onPresetBuild,
      targets,
      useBuiltIns: !config.evaluate && config.useBuiltIns,
    };

    config.presets.push(["env", options]);
  }

  try {
    const start = Date.now();
    const transformed = Babel.transform(code, {
      babelrc: false,
      filename: "repl",
      presets: config.presets,
      sourceMap: config.sourceMap,
    });

    transformTime = Date.now() - start;

    compiled = transformed.code;
    ast = JSON.stringify(transformed.ast, null, 2);

    if (config.sourceMap) {
      try {
        sourceMap = JSON.stringify(transformed.map);
      } catch (error) {
        console.error(`Source Map generation failed: ${error}`);
      }
    }
  } catch (error) {
    compiled = null;
    ast = null;
    transformTime = null;
    compileErrorMessage = error.message;
    envPresetDebugInfo = null;
    sourceMap = null;
  }

  return {
    compiled,
    transformTime,
    ast,
    compileErrorMessage,
    envPresetDebugInfo,
    sourceMap,
  };
}
