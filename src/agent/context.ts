// What every harness tells the model about Studio, the open page and the account.
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { AgentPageRef } from './protocol.ts';

export const WORKSPACE = join(homedir(), 'geins-agent-workspace');

/** Tool results are summarized to this length for the panel's tool cards. */
export const SUMMARY_MAX = 240;

export const SYSTEM_PROMPT = `You are the Geins Studio agent, working alongside a merchant who has Geins Studio (a commerce admin) open in their browser. They watch Studio while you work, so show things in Studio rather than only describing them.
- Each message starts with a <studio_page> line: what the user has open. "This", "here" and "the current one" refer to it. Call ui.get_page_context for the form values, the list's rows or the field paths.
- Reading data: use the studio tools. When the answer is a set of records the user may want to look at, open the matching Studio list (ui.navigate, with ?q= / ?sort= when that narrows it down) and point at the relevant rows with ui.highlight. Links in your answers: use the \`url\` the tools return, as markdown links.
- Creating or editing: open the record's page (or its /new page), then ui.fill_form. You never save. Tell the user what you filled and ask them to review and click Save or Create. If fill_form reports validation errors or unknown paths, fix them or explain.
- Workflows (orchestrator): they are node graphs, not forms. Open the workflow (or /orchestrator/workflows/new), set details.name / details.description with ui.fill_form, look up nodes with studio.get_workflow_manifest (overview first, then the specs of the nodes you use), draft the graph, check it with studio.validate_workflow, then ui.set_workflow_graph. On /new the user clicks Create and the workflow opens with your graph; on an existing workflow they review the canvas and click Save.
- If ui.navigate comes back blocked, the user has unsaved changes and Studio is asking them; wait for them instead of retrying.
- Your working directory is the user's agent workspace; read and write local files there.
- Answer in short markdown. Never invent data. If a tool fails, say so.`;

export function describePage(page?: AgentPageRef): string {
  if (!page) return '<studio_page unknown="true" />';
  const attrs = Object.entries(page)
    .filter(([, value]) => value !== undefined && value !== '')
    .map(([key, value]) => `${key}=${JSON.stringify(String(value))}`)
    .join(' ');
  return `<studio_page ${attrs} />`;
}

export interface StudioCredentials {
  accessToken: string;
  accountKey: string;
  accountName?: string;
}

/** Session-specific prompt lines: which account Studio is on, and how Sonora maps to it. */
export function accountPrompt(
  credentials: StudioCredentials,
  sonoraProfile: string | undefined,
  full: boolean,
): string {
  const account = credentials.accountName
    ? `${credentials.accountName} (account key ${credentials.accountKey})`
    : `account key ${credentials.accountKey}`;
  const lines = [`The user is signed in to Studio on account ${account}. Act on this account unless they say otherwise.`];
  if (full) {
    lines.push(
      sonoraProfile
        ? `For the Sonora Management API (sonora:mgmtapi skill) the matching profile "${sonoraProfile}" is already selected for this session; don't ask which profile to use, and don't switch to another profile unless the user asks.`
        : 'No Sonora Management API profile matches this account. If a task needs the Sonora API, ask which profile to use and mention that none is named after the Studio account.',
    );
  }
  return lines.join('\n');
}
