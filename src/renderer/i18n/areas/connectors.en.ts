// English counterpart of the app-only connector surface.
import type { connectorsIt } from './connectors.it';
export const connectorsEn: typeof connectorsIt = {
 'connector.group':'Tools and projects',
 'connector.title':'Connect your tools','connector.intro':'Choose GitHub or Jira and the projects you use. You can return here from Settings.',
 'connector.scope':'This connection belongs to this app. Individual agents keep separate access.',
 'connector.githubHint':'Use your GitHub CLI sign-in.','connector.jiraHint':'Connect your Jira Cloud site.',
 'connector.githubDetails':'Requires GitHub CLI (gh), available from its official website.','connector.jiraDetails':'Enter the classic API token on a dedicated local page. It is encrypted on this computer.',
 'connector.pending':'Sign-in pending','connector.verified':'Connected and verified','connector.failed':'Verification failed',
 'connector.failureHint':'Check sign-in, token expiry, network and permissions, then retry.',
 'connector.checked':({at}:{at:string})=>`Last verified: ${at}`,
 'connector.login':({name}:{name:string})=>`Sign in to ${name}`,'connector.probe':({name}:{name:string})=>`Verify ${name} access`,
 'connector.disconnect':({name}:{name:string})=>`Disconnect ${name} from this app`,
 'connector.projects':'Which projects would you like to keep? (up to 100)','connector.empty':'No projects are visible with this account.',
 'connector.details':'Connection details','connector.revoke':'Disconnecting removes local selections. Revoke access on the official provider website.',
 'connector.revokeJira':'Disconnecting removes local selections and the encrypted token. Revoke access on the official provider website.',
 'connector.loadError':'Cannot read connections. Reopen this panel to retry.',
 'connector.error':'The operation did not finish. Check sign-in, GitHub CLI or the system keychain, then retry.',
 'connector.notice':'Finish signing in in the dedicated window, then return here and select Verify access.',
 'connector.loading':'Loading connections…','connector.cancel':'Cancel sign-in','connector.cancelError':'Cancellation did not finish',
 'connector.continue':'Continue','connector.later':'Later',
};
