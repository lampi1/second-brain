// Opening an artifact (ADR 0319) in the app's viewer: the version asked for (the newest by default), as its file, or as
// the copy the app kept when that file changed or went (main/library/service.ts), with its chat as the viewer's context
// (relative links in it resolve in that chat's folder). Used by ArtifactsTab.tsx and ArtifactBar.tsx. The actions are
// loaded on the click: the viewer (FileViewer.tsx → ArtifactBar.tsx) stays free of the app's store at import, like its
// own lazy 'sb' import.
import type { Artifact } from '@shared/library';

export function openArtifact(a: Artifact, version = 0): void {
  const v = a.versions[version] ?? a.versions[0]!;
  void import('../../actions').then(m => m.openFileViewer(v.missing && v.copy ? v.copy : v.path, v.chatId ?? a.chatId));
}

/** The chat that produced an artifact on screen (a closed one comes back on the grid). */
export const openArtifactChat = (chatId: string): void => { void import('../../actions').then(m => m.openChatRef(chatId)); };

/** The gallery, the viewer closed. */
export const openGallery = (arg: string): void => { void import('../../actions').then(m => { m.closeViewer(); m.go({ page: 'memoria', arg }); }); };
