// engine-env: every engine gets MSBuild node reuse and the MSBuild server off, so an agent's dotnet build leaves no
// worker nodes behind; a value the user set in the app's environment wins.
import { describe, expect, it } from 'vitest';
import { engineEnv } from '../../../src/main/chats/engine-env';

describe('engineEnv', () => {
  it('turns MSBuild node reuse and the build server off', () => {
    expect(engineEnv({})).toEqual({ MSBUILDDISABLENODEREUSE: '1', DOTNET_CLI_USE_MSBUILD_SERVER: '0' });
  });

  it('keeps what the user set', () => {
    expect(engineEnv({ MSBUILDDISABLENODEREUSE: '0' })).toEqual({ DOTNET_CLI_USE_MSBUILD_SERVER: '0' });
  });
});
