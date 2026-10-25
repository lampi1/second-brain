// Fail-closed App Service release validation, shared by target registration and the host deployment adapter.
// Only Microsoft's pinned web-app deployment task can run; a service connection is verified against live ARM identity.
import type { AppServiceTestDeployTarget } from '../../shared/flow-automation';
import { object } from './schema';

/** Microsoft azure-pipelines-tasks/Tasks/AzureRmWebAppDeploymentV4/task.json. */
export const APP_SERVICE_TASK_IDS = ['497d490f-eea7-4f2b-ab94-48d9c1acdcb1'];
const empty = (v: unknown) => v === undefined || v === null || (typeof v === 'object' && Object.keys(v).length === 0);
const disabled = (v: unknown) => v === undefined || v === '' || v === false || v === 'false';
export const appServiceResourceId = (t: AppServiceTestDeployTarget) => `/subscriptions/${t.subscriptionId}/resourceGroups/${t.resourceGroup}/providers/Microsoft.Web/sites/${t.webAppName}`;
/** Resolve only whole process-parameter references; never expand variables, expressions or recursive defaults.
 * Definition/environment scopes must identify one unambiguous literal default, including the valid empty startup. */
function parameterInput(value: unknown, field: string, scopes: unknown[]): unknown {
  if (typeof value !== 'string' || !value.includes('$')) return value;
  const match = /^\$\(Parameters\.([A-Za-z_][A-Za-z0-9_]*)\)$/.exec(value);
  if (!match) throw new Error(`Unsupported macro in App Service ${field}; use a whole Parameters reference`);
  const name = match[1]!.toLowerCase();
  const matches = scopes.flatMap(scope => {
    if (scope === undefined || scope === null) return [];
    const inputs = object(scope, 'process parameters').inputs;
    if (inputs === undefined || inputs === null) return [];
    if (!Array.isArray(inputs)) throw new Error('Invalid process parameter inputs');
    return inputs.map(input => object(input, 'process parameter')).filter(input => typeof input.name === 'string' && input.name.toLowerCase() === name);
  });
  if (matches.length !== 1 || typeof matches[0]!.defaultValue !== 'string' || matches[0]!.isSecret === true) throw new Error(`App Service ${field} needs one explicit process-parameter default`);
  const result = matches[0]!.defaultValue;
  if (result.includes('$')) throw new Error(`Nested or expression default in App Service ${field}`);
  return result;
}
export function validateAppServicePhases(value: unknown, t: AppServiceTestDeployTarget, ...processParameters: unknown[]): Record<string, unknown>[] {
  if (!Array.isArray(value) || value.length !== 1) throw new Error('App Service requires exactly one agent-based phase');
  const phase = object(value[0], 'phase'), input = object(phase.deploymentInput, 'deployment input');
  if (phase.phaseType !== 'agentBasedDeployment' || input.queueId !== t.queueId || !empty(input.demands) || !empty(phase.overrideInputs)) throw new Error('App Service queue, phase type or demands differ from the approved target');
  if (input.enableAccessToken === true || !empty(input.additionalOptions)) throw new Error('Additional deployment authority is unsupported');
  if (!Array.isArray(phase.workflowTasks) || !phase.workflowTasks.length || phase.workflowTasks.length > 5) throw new Error('App Service release needs its approved deploy tasks');
  const resolved: Record<string, unknown>[] = [];
  for (const value of phase.workflowTasks) {
    const task = object(value, 'deploy task'), id = String(task.taskId).toLowerCase(), i = { ...object(task.inputs, 'task inputs') };
    for (const field of ['ConnectedServiceName', 'WebAppName', 'WebAppKind', 'StartupCommand']) i[field] = parameterInput(i[field], field, processParameters);
    if (!APP_SERVICE_TASK_IDS.includes(id) || !t.allowedTaskIds.includes(id) || (task.definitionType !== 'task' && task.definitionType !== null) || task.enabled !== true || task.alwaysRun === true || task.continueOnError === true || !/^4(?:\.|$)/.test(String(task.version))) throw new Error('Unapproved App Service deploy task or execution options');
    if (i.ConnectionType !== 'AzureRM' || String(i.ConnectedServiceName).toLowerCase() !== t.serviceConnectionId || i.WebAppName !== t.webAppName) throw new Error('App Service task must name the exact approved web app and service connection');
    if (!['webApp', 'webAppLinux', 'apiApp', 'mobileApp'].includes(String(i.WebAppKind))) throw new Error('Only application package deployments are supported');
    if (!disabled(i.DeployToSlotOrASEFlag) || (i.ResourceGroupName && i.ResourceGroupName !== t.resourceGroup)) throw new Error('Slots, ASE or a different resource group are not approved');
    if (i.ScriptType || i.ScriptPath || i.StartupCommand || i.AppSettings || i.ConfigurationSettings || i.SetParametersFile) throw new Error('Custom deployment scripts, settings or extra deployment arguments are unsupported');
    if (i.AdditionalArguments && !/^\s*-retryAttempts:[0-9]{1,2}\s+-retryInterval:[0-9]{1,6}\s*$/.test(String(i.AdditionalArguments))) throw new Error('Only bounded MSDeploy retry arguments are supported');
    if (!empty(task.environment) || !empty(task.overrideInputs)) throw new Error('Task environment overrides are unsupported');
    // Only the host-selected artifact may supply the package; never an absolute path, another artifact or arbitrary macro.
    const prefix = '$(System.DefaultWorkingDirectory)/';
    const pkg = typeof i.Package === 'string' ? i.Package.replace(/\\/g, '/') : '';
    if (!pkg.startsWith(prefix) || pkg.slice('$(System.DefaultWorkingDirectory)'.length).includes('$') || pkg.split('/').includes('..') || /[\r\n]/.test(pkg)) throw new Error('Package must be under the approved artifact alias');
    resolved.push(i);
  }
  return resolved;
}
export function validateAppServiceDefinition(d: Record<string, unknown>, t: AppServiceTestDeployTarget): void {
  if (!Array.isArray(d.environments) || d.environments.length !== 1) throw new Error('Only a single-environment test release is supported');
  const e = object(d.environments[0], 'environment');
  if (!empty(d.variableGroups) || !empty(d.variables) || !empty(e.variableGroups) || !empty(e.variables)) throw new Error('App Service test release cannot use variables or variable groups');
  for (const gates of [e.preDeploymentGates, e.postDeploymentGates]) if (gates && !empty(object(gates, 'gates').gates)) throw new Error('Gated releases are not supported');
  for (const approval of [e.preDeployApprovals, e.postDeployApprovals]) {
    if (!approval) continue;
    const a = object(approval, 'approvals');
    if (!Array.isArray(a.approvals) || a.approvals.some(v => object(v, 'approval').isAutomated !== true)) throw new Error('Only automatic test release approvals are supported');
  }
  validateAppServicePhases(e.deployPhases, t, d.processParameters, e.processParameters);
}
export async function verifyAppService(t: AppServiceTestDeployTarget, call: (method: string, url: string) => Promise<Record<string, unknown>>, arm: (resourceId: string) => Promise<Record<string, unknown>>): Promise<void> {
  const base = `https://dev.azure.com/${encodeURIComponent(t.organization)}/${t.projectId}`;
  const endpoint = await call('GET', `${base}/_apis/serviceendpoint/endpoints/${t.serviceConnectionId}?api-version=7.1`);
  const data = object(endpoint.data, 'service connection data');
  if (String(endpoint.id).toLowerCase() !== t.serviceConnectionId || endpoint.type !== 'azurerm' || String(data.subscriptionId).toLowerCase() !== t.subscriptionId || (data.environment && data.environment !== 'AzureCloud')) throw new Error('Service connection subscription or Azure cloud changed');
  const app = await arm(appServiceResourceId(t));
  if (String(app.id).toLowerCase() !== appServiceResourceId(t).toLowerCase() || app.name !== t.webAppName || String(app.type).toLowerCase() !== 'microsoft.web/sites') throw new Error('Live Azure resource does not match the exact approved test web app');
  const queue = await call('GET', `${base}/_apis/distributedtask/queues/${t.queueId}?api-version=7.1`);
  if (queue.id !== t.queueId || object(queue.pool, 'queue pool').isHosted !== true) throw new Error('App Service requires the approved hosted queue');
}
