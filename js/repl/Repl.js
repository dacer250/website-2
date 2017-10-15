// @flow

import "regenerator-runtime/runtime";

import { css } from "emotion";
import debounce from "lodash.debounce";
import React from "react";
import { Tabs, Tab, TabPanel, TabList } from "react-tabs";
import ErrorBoundary from "./ErrorBoundary";
import CodeMirrorPanel from "./CodeMirrorPanel";
import ReplOptions from "./ReplOptions";
import StorageService from "./StorageService";
import UriUtils from "./UriUtils";
import loadBabel from "./loadBabel";
import loadPlugin from "./loadPlugin";
import PresetLoadingAnimation from "./PresetLoadingAnimation";
import {
  envPresetConfig,
  pluginConfigs,
  presetPluginConfigs,
  runtimePolyfillConfig,
} from "./PluginConfig";
import {
  envConfigToTargetsString,
  loadPersistedState,
  configArrayToStateMap,
  configToState,
  persistedStateToBabelState,
  persistedStateToEnvConfig,
} from "./replUtils";
import WorkerApi from "./WorkerApi";
import scopedEval from "./scopedEval";
import { colors, media } from "./styles";

import type {
  BabelPresets,
  BabelState,
  EnvConfig,
  PluginState,
  PluginStateMap,
} from "./types";

type Props = {};
type State = {
  babel: BabelState,
  builtIns: boolean,
  code: string,
  compiled: ?string,
  ast: ?any,
  transformTime: ?number,
  compileErrorMessage: ?string,
  debugEnvPreset: boolean,
  envConfig: EnvConfig,
  envPresetDebugInfo: ?string,
  envPresetState: PluginState,
  evalErrorMessage: ?string,
  isEnvPresetTabExpanded: boolean,
  isPresetsTabExpanded: boolean,
  isSettingsTabExpanded: boolean,
  isSidebarExpanded: boolean,
  lineWrap: boolean,
  plugins: PluginStateMap,
  presets: PluginStateMap,
  runtimePolyfillState: PluginState,
  sourceMap: ?string,
};

const DEBOUNCE_DELAY = 500;

class Repl extends React.Component {
  props: Props;
  state: State;

  _numLoadingPlugins = 0;
  _workerApi = new WorkerApi();

  constructor(props: Props, context: any) {
    super(props, context);

    const persistedState = loadPersistedState();

    const defaultPlugins = {
      "babili-standalone": persistedState.babili,
    };

    const presets =
      typeof persistedState.presets === "string"
        ? persistedState.presets.split(",")
        : ["es2015", "react", "stage-2"];

    const defaultPresets = presets.reduce((reduced, key) => {
      if (key) reduced[`babel-preset-${key}`] = true;
      return reduced;
    }, {});

    const envConfig = persistedStateToEnvConfig(persistedState);

    // A partial State is defined first b'c this._compile needs it.
    // The compile helper will then populate the missing State values.
    this.state = {
      babel: persistedStateToBabelState(persistedState),
      builtIns: persistedState.builtIns,
      code: persistedState.code,
      compiled: null,
      ast: null,
      transformTime: null,
      compileErrorMessage: null,
      debugEnvPreset: persistedState.debug,
      envConfig,
      envPresetDebugInfo: null,
      envPresetState: configToState(
        envPresetConfig,
        envConfig.isEnvPresetEnabled
      ),
      evalErrorMessage: null,
      isEnvPresetTabExpanded: persistedState.isEnvPresetTabExpanded,
      isPresetsTabExpanded: persistedState.isPresetsTabExpanded,
      isSettingsTabExpanded: persistedState.isSettingsTabExpanded,
      isSidebarExpanded: persistedState.showSidebar,
      lineWrap: persistedState.lineWrap,
      plugins: configArrayToStateMap(pluginConfigs, defaultPlugins),
      presets: configArrayToStateMap(presetPluginConfigs, defaultPresets),
      runtimePolyfillState: configToState(
        runtimePolyfillConfig,
        persistedState.evaluate
      ),
      sourceMap: null,
    };

    this._setupBabel();
  }

  render() {
    const state = this.state;

    if (!state.babel.isLoaded) {
      let message = "Loading Babel...";

      if (state.babel.didError) {
        message =
          state.babel.errorMessage ||
          "An error occurred while loading Babel :(";
      }

      return (
        <div className={styles.loader}>
          <div className={styles.loaderContent}>
            {message}
            {state.babel.isLoading && (
              <PresetLoadingAnimation className={styles.loadingAnimation} />
            )}
          </div>
        </div>
      );
    }

    const options = {
      lineWrapping: state.lineWrap,
    };

    return (
      <div className={styles.repl}>
        <ReplOptions
          babelVersion={state.babel.version}
          builtIns={state.builtIns}
          className={styles.optionsColumn}
          debugEnvPreset={state.debugEnvPreset}
          envConfig={state.envConfig}
          envPresetState={state.envPresetState}
          isEnvPresetTabExpanded={state.isEnvPresetTabExpanded}
          isExpanded={state.isSidebarExpanded}
          isPresetsTabExpanded={state.isPresetsTabExpanded}
          isSettingsTabExpanded={state.isSettingsTabExpanded}
          lineWrap={state.lineWrap}
          onEnvPresetSettingChange={this._onEnvPresetSettingChange}
          onIsExpandedChange={this._onIsSidebarExpandedChange}
          onSettingChange={this._onSettingChange}
          onTabExpandedChange={this._onTabExpandedChange}
          pluginState={state.plugins}
          presetState={state.presets}
          runtimePolyfillConfig={runtimePolyfillConfig}
          runtimePolyfillState={state.runtimePolyfillState}
        />

        <div className={styles.panels}>
          <div className={styles.leftPanel}>
            <div className={styles.leftToolbar} />
            <CodeMirrorPanel
              className={styles.codeMirrorPanelLeft}
              code={state.code}
              errorMessage={state.compileErrorMessage}
              onChange={this._updateCode}
              autoFocus
              options={options}
              placeholder="Write code here"
            />
          </div>

          <Tabs
            className={styles.tabs}
            selectedTabClassName={styles.tabSelected}
            selectedTabPanelClassName={styles.tabPanelActive}
          >
            <TabList className={styles.tabList}>
              <Tab className={styles.tab}>Output</Tab>
              <Tab className={styles.tab}>AST</Tab>
              <div className={styles.transformTime}>
                {state.transformTime}
                ms
              </div>
            </TabList>
            <TabPanel className={styles.tabPanel}>
              <CodeMirrorPanel
                className={styles.codeMirrorPanelRight}
                code={state.compiled}
                errorMessage={state.evalErrorMessage}
                info={state.debugEnvPreset ? state.envPresetDebugInfo : null}
                options={options}
                placeholder="Compiled output will be shown here"
              />
            </TabPanel>
            <TabPanel className={styles.tabPanel}>
              <CodeMirrorPanel
                className={styles.codeMirrorPanelRight}
                errorMessage={""}
                code={state.ast}
                options={{
                  ...options,
                  lineWrapping: false,
                  mode: { name: "javascript", json: true },
                  foldGutter: true,
                  gutters: ["CodeMirror-linenumbers", "CodeMirror-foldgutter"],
                }}
                placeholder="AST will be shown here"
              />
            </TabPanel>
          </Tabs>
        </div>
      </div>
    );
  }

  async _setupBabel() {
    const babelState = await loadBabel(this.state.babel, this._workerApi);
    this.setState(babelState);

    if (babelState.isLoaded) {
      this._compile(this.state.code, this._checkForUnloadedPlugins);
    }
  }

  _checkForUnloadedPlugins() {
    const {
      envConfig,
      envPresetState,
      plugins,
      runtimePolyfillState,
    } = this.state;

    // Assume all default presets are baked into babel-standalone.
    // We really only need to worry about plugins.
    for (const key in plugins) {
      const plugin = plugins[key];

      if (plugin.isEnabled && !plugin.isLoaded && !plugin.isLoading) {
        this._numLoadingPlugins++;

        this._workerApi.loadPlugin(plugin).then(success => {
          this._numLoadingPlugins--;

          // If a plugin has failed to load, re-render to show a loading error.
          if (!success) {
            this.setState({ plugins });
          }

          // Once all plugins have been loaded, re-compile code.
          if (this._numLoadingPlugins === 0) {
            this._updateCode(this.state.code);
          }
        });
      }
    }

    // Babel (runtime) polyfill is large;
    // It's only needed if we're actually executing the compiled code.
    // Defer loading it unless "evaluate" is enabled.
    if (runtimePolyfillState.isEnabled && !runtimePolyfillState.isLoaded) {
      // Compilation is done in a web worker for performance reasons,
      // But eval requires the UI thread so code can access globals like window.
      // Because of this, the runtime polyfill must be loaded on the UI thread.
      // We also eval in an iframe so the polyfills need to be accessible there.
      // We could copy them from window to frame.contentWindow,
      // But it's less error-prone to just load the polyfills into the iframe.
      loadPlugin(
        runtimePolyfillState,
        () => {
          let evalErrorMessage: ?string = null;

          if (!this.state.compiled) {
            return;
          }

          // No need to recompile at this point;
          // Just evaluate the most recently compiled code.
          try {
            // eslint-disable-next-line
            scopedEval.execute(this.state.compiled, this.state.sourceMap);
          } catch (error) {
            evalErrorMessage = error.message;
          }

          // Re-render (even if no error) to update the label loading-state.
          this.setState({ evalErrorMessage });
        },
        scopedEval.getIframe()
      );
    }

    // Babel 'env' preset is large;
    // Only load it if it's been requested.
    if (envConfig.isEnvPresetEnabled && !envPresetState.isLoaded) {
      this._workerApi.loadPlugin(envPresetState).then(() => {
        // This preset is not built into Babel standalone due to its size.
        // Before we can use it we need to explicitly register it.
        // Because it's loaded in a worker, we need to configure it there as well.
        this._workerApi
          .registerEnvPreset()
          .then(success => this._updateCode(this.state.code));
      });
    }
  }

  _compile = (code: string, setStateCallback: () => mixed) => {
    const { state } = this;
    const { runtimePolyfillState } = state;

    if (!code) {
      this.setState(
        {
          compiled: null,
          ast: null,
          transformTime: null,
          compileErrorMessage: null,
          envPresetDebugInfo: null,
          evalErrorMessage: null,
          sourceMap: null,
        },
        setStateCallback
      );
      return;
    }

    const presetsArray = this._presetsToArray(state);

    const babili = state.plugins["babili-standalone"];
    if (babili.isEnabled && babili.isLoaded) {
      presetsArray.push("babili");
    }

    this._workerApi
      .compile(code, {
        debugEnvPreset: state.debugEnvPreset,
        envConfig: state.envPresetState.isLoaded ? state.envConfig : null,
        evaluate:
          runtimePolyfillState.isEnabled && runtimePolyfillState.isLoaded,
        presets: presetsArray,
        sourceMap: runtimePolyfillState.isEnabled,
        useBuiltIns: state.builtIns,
      })
      .then(result => this.setState(result, setStateCallback));
  };

  // Debounce compilation since it's expensive.
  // This also avoids prematurely warning the user about invalid syntax,
  // eg when in the middle of typing a variable name.
  _compileToState = debounce(
    (code: string) => this._compile(code, this._persistState),
    DEBOUNCE_DELAY
  );

  _onEnvPresetSettingChange = (name: string, value: any) => {
    this.setState(
      state => ({
        envConfig: {
          ...state.envConfig,
          [name]: value,
        },
      }),
      this._presetsUpdatedSetStateCallback
    );
  };

  _onIsSidebarExpandedChange = (isExpanded: boolean) => {
    this.setState(
      {
        isSidebarExpanded: isExpanded,
      },
      this._persistState
    );
  };

  _onSettingChange = (name: string, isEnabled: boolean) => {
    this.setState(state => {
      const { plugins, presets, runtimePolyfillState } = state;

      if (name === "babel-polyfill") {
        runtimePolyfillState.isEnabled = isEnabled;

        return {
          runtimePolyfillState,
        };
      } else if (state.hasOwnProperty(name)) {
        return {
          [name]: isEnabled,
        };
      } else if (plugins.hasOwnProperty(name)) {
        plugins[name].isEnabled = isEnabled;

        return {
          plugins,
        };
      } else if (presets.hasOwnProperty(name)) {
        presets[name].isEnabled = isEnabled;

        return {
          presets,
        };
      }
    }, this._presetsUpdatedSetStateCallback);
  };

  _onTabExpandedChange = (name: string, isExpanded: boolean) => {
    this.setState(
      {
        [name]: isExpanded,
      },
      this._presetsUpdatedSetStateCallback
    );
  };

  _persistState = () => {
    const { state } = this;
    const { envConfig, plugins } = state;

    const presetsArray = this._presetsToArray();

    const babili = state.plugins["babili-standalone"];
    if (babili.isEnabled) {
      presetsArray.push("babili");
    }

    if (envConfig.isEnvPresetEnabled) {
      presetsArray.push("env");
    }

    const payload = {
      babili: plugins["babili-standalone"].isEnabled,
      browsers: envConfig.browsers,
      build: state.babel.build,
      builtIns: state.builtIns,
      circleciRepo: state.babel.circleciRepo,
      code: state.code,
      debug: state.debugEnvPreset,
      evaluate: state.runtimePolyfillState.isEnabled,
      isEnvPresetTabExpanded: state.isEnvPresetTabExpanded,
      isPresetsTabExpanded: state.isPresetsTabExpanded,
      isSettingsTabExpanded: state.isSettingsTabExpanded,
      lineWrap: state.lineWrap,
      presets: presetsArray.join(","),
      showSidebar: state.isSidebarExpanded,
      targets: envConfigToTargetsString(envConfig),
      version: state.babel.version,
    };

    StorageService.set("replState", payload);
    UriUtils.updateQuery(payload);
  };

  _presetsUpdatedSetStateCallback = () => {
    this._checkForUnloadedPlugins();
    this._updateCode(this.state.code);
  };

  _presetsToArray(state: State = this.state): BabelPresets {
    const { presets } = state;

    return Object.keys(presets)
      .filter(key => presets[key].isEnabled && presets[key].isLoaded)
      .map(key => presets[key].config.label);
  }

  _updateCode = (code: string) => {
    this.setState({ code });

    // Update state with compiled code, errors, etc after a small delay.
    // This prevents frequent updates while a user is typing.
    this._compileToState(code);
  };
}

export default function ReplWithErrorBoundary() {
  return (
    <ErrorBoundary>
      <Repl />
    </ErrorBoundary>
  );
}

const styles = {
  loader: css({
    alignItems: "center",
    background: colors.inverseBackgroundDark,
    color: colors.inverseForegroundLight,
    display: "flex",
    height: "100vh",
    justifyContent: "center",
  }),
  loadingAnimation: css({
    justifyContent: "center",
    margin: "2rem 0 0 0",
  }),
  loaderContent: css({
    margin: "auto",
    textAlign: "center",
  }),
  codeMirrorPanelLeft: css({
    flex: "1",
    height: "auto",
  }),
  codeMirrorPanelRight: css({
    flex: "1",
    height: "100%",
  }),
  optionsColumn: css({
    flex: "0 0 auto",
  }),
  repl: css({
    height: "100%",
    width: "100%",
    display: "flex",
    flexDirection: "row",
    justifyContent: "stretch",
    overflow: "auto",

    [media.mediumAndDown]: {
      flexDirection: "column",
    },
  }),
  tabs: css({
    flex: "0 0 50%",
    height: "100%",
    display: "flex",
    flexDirection: "column",
    justifyContent: "stretch",
  }),
  tabList: css({
    margin: "0",
    padding: "0",
    paddingLeft: "29px",
    backgroundColor: colors.inverseBackgroundDark,
    height: "31px",
  }),
  tab: css({
    color: "#9da5b4",
    display: "inline-block",
    position: "relative",
    listStyle: "none",
    padding: "6px 12px",
    cursor: "pointer",
    transition: "background-color 250ms ease-in-out, color 250ms ease-in-out",
    "&:hover": {
      backgroundColor: colors.inverseBackground,
      color: colors.inverseForeground,
    },
  }),
  tabSelected: css({
    backgroundColor: colors.inverseBackgroundLight,
    "&:hover": {
      backgroundColor: colors.inverseBackgroundLight,
    },
  }),
  tabPanel: css({
    display: "none",
    flex: "1",
  }),
  tabPanelActive: css({
    display: "flex",
  }),
  panels: css({
    backgroundColor: colors.inverseBackgroundDark,
    flex: "1",
    width: "100%",
    display: "flex",
    flexDirection: "row",
    justifyContent: "stretch",
    overflow: "auto",
  }),
  leftPanel: css({
    flex: "0 0 50%",
    display: "flex",
    flexDirection: "column",
    justifyContent: "stretch",
    height: "100%",
    width: "100%",
  }),
  leftToolbar: css({
    flex: "0 0 auto",
    height: "31px",
    width: "100%",
  }),
  transformTime: css({
    float: "right",
    color: colors.inverseForegroundDark,
    padding: "6px 12px",
  }),
};
