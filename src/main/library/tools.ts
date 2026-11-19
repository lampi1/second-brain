// artifact_save (ADR 0328), on every chat's own endpoint: the one way a file becomes an artifact of Memoria → Artifact.
// The agent that wrote a report, a document, a plan or an analysis the user asked for declares it here; the app indexes
// the file where it is (library/service.ts save), and the user opens it in the app. The description is what makes the
// agents «understand by themselves» (the owner 2026-11-19): a request for something to keep and read again is a file
// plus this call; a screenshot, a log or a scratch file never is. One short line of it rides on every role's frame too
// (agents/orchestrator-role.ts ARTIFACT_RULE). Used by index.ts (Services.addChatTools); listed in
// appctl/tool-catalog.ts; pinned by test/unit/library-tools.test.ts.
import { ARTIFACT_FORMATS } from '../../shared/library';
import type { McpTool } from '../mcp/server';
import { ToolRefusal } from '../mcp/refusal';
import type { LibraryService } from './service';

export function artifactSaveTool(library: Pick<LibraryService, 'save'>): McpTool {
  return {
    name: 'artifact_save',
    description: `The user asked for something to keep and read again (a report, an analysis, a document, a plan, a comparison, a summary of a research, a presentation): write it as ONE file, then call this with its path. It appears in the app under Memoria → Artifact, where the user opens it in the app's viewer; link the file in your answer too. Format: HTML for anything with structure, tables or pictures (self-contained: inline CSS, images embedded or beside it), Markdown for plain text; another format only when the user asks for it (${ARTIFACT_FORMATS}). Never for screenshots, evidence, logs, code, notes for yourself, intermediate files or anything the user did not ask to have. The same path again after you rewrote it = a new version of the same artifact.`,
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'The file you wrote: absolute, or relative to your folder.' },
        title: { type: 'string', description: 'Its title as the user will look for it, in the user’s language (default: the document’s own title).' },
        summary: { type: 'string', description: 'One or two sentences on what it holds, in the user’s language (default: its first lines).' },
      },
      required: ['path'], additionalProperties: false,
    },
    run: async (a, ctx) => {
      try {
        const r = await library.save(ctx.params.chatId, { path: String(a.path ?? ''), ...(typeof a.title === 'string' ? { title: a.title } : {}), ...(typeof a.summary === 'string' ? { summary: a.summary } : {}) });
        return JSON.stringify({ saved: true, id: r.artifact.id, title: r.artifact.title, path: r.artifact.path, versions: r.versions, note: r.created ? 'In Memoria → Artifact now.' : `Saved as «${r.artifact.title}» (${r.versions} version${r.versions === 1 ? '' : 's'}).` });
      } catch (e) {
        // a wrong path or format is the agent's to fix, not an app fault
        throw new ToolRefusal(e instanceof Error ? e.message : String(e));
      }
    },
  };
}
