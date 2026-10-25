// `geins studio …` (and `/studio` in the TUI / Synapse): settings and pairing
// for the Studio agent that `geins serve` hosts. Returns output lines so the
// CLI and the TUI can print them their own way.
import {
  helperPort,
  loadAgentSettings,
  normalizeOrigin,
  openInBrowser,
  pairingLink,
  pairingToken,
  updateAgentSettings,
} from '../agent/settings.ts';
import { isCodexAvailable } from '../agent/harness/codex.ts';
import { STUDIO_HELP } from './help-text.ts';

const NEXT_SESSION = 'Applies to the next agent session (New conversation, or reload Studio).';

export async function studioCommand(args: string[]): Promise<string[]> {
  const sub = args[0]?.toLowerCase() ?? 'status';
  const value = args[1];

  switch (sub) {
    case 'status': {
      const settings = await loadAgentSettings();
      return [
        `Agent mode:   ${settings.mode}${settings.mode === 'full' ? ' (your Claude Code setup, all tools)' : ' (Studio tools only)'}`,
        `Agent:        ${settings.provider === 'codex' ? 'OpenAI Codex' : 'Claude'}`,
        `Auto mode:    ${settings.permissionMode === 'auto' ? 'on' : 'off'}${settings.provider === 'codex' ? ' (Claude only)' : ''}`,
        `Studio sites: ${settings.studioOrigins.join(', ')}`,
        `Helper port:  ${helperPort()}`,
        'Pair a Studio tab with: studio connect [studio-url]',
      ];
    }

    case 'connect': {
      const settings = await loadAgentSettings();
      let origin: string;
      try {
        origin = normalizeOrigin(value ?? settings.lastOrigin);
      } catch {
        return [`Not a valid Studio URL: ${value}`];
      }
      const lines: string[] = [];
      if (!settings.studioOrigins.includes(origin)) {
        await updateAgentSettings({ studioOrigins: [...settings.studioOrigins, origin] });
        lines.push(`Added ${origin} to the allowed Studio sites.`);
      }
      await updateAgentSettings({ lastOrigin: origin });
      const link = pairingLink(origin, await pairingToken(), helperPort());
      openInBrowser(link);
      lines.push(
        `Opening Studio to pair it with this helper (port ${helperPort()}).`,
        `If the browser didn't open, visit: ${link}`,
        'Keep this link private: it lets a page drive your local agent.',
      );
      return lines;
    }

    case 'open': {
      const { lastOrigin } = await loadAgentSettings();
      openInBrowser(lastOrigin);
      return [`Opening ${lastOrigin}.`];
    }

    case 'mode': {
      if (value !== 'standard' && value !== 'full') return ['Usage: studio mode standard|full'];
      await updateAgentSettings({ mode: value });
      return [
        value === 'full'
          ? 'Agent mode: full. The Studio agent runs with your Claude Code settings, plugins, MCP servers and all tools, including Bash.'
          : 'Agent mode: standard. The Studio agent only gets the Studio tools and files in its workspace.',
        NEXT_SESSION,
      ];
    }

    case 'auto': {
      if (value !== 'on' && value !== 'off') return ['Usage: studio auto on|off'];
      await updateAgentSettings({ permissionMode: value === 'on' ? 'auto' : 'default' });
      return [`Auto mode ${value} for new agent sessions; the panel's Auto switch still changes a running one.`, NEXT_SESSION];
    }

    case 'provider': {
      if (value !== 'claude' && value !== 'codex') return ['Usage: studio provider claude|codex'];
      if (value === 'codex' && !(await isCodexAvailable())) {
        return ['OpenAI Codex is not installed. Install the Codex CLI and sign in, then try again.'];
      }
      await updateAgentSettings({ provider: value });
      return [`Agent: ${value === 'codex' ? 'OpenAI Codex' : 'Claude'}.`, NEXT_SESSION];
    }

    case 'origin':
    case 'origins': {
      const settings = await loadAgentSettings();
      const action = value?.toLowerCase();
      if ((action !== 'add' && action !== 'remove') || !args[2]) {
        return [`Studio sites: ${settings.studioOrigins.join(', ')}`, 'Change with: studio origin add|remove <url>'];
      }
      let origin: string;
      try {
        origin = normalizeOrigin(args[2]);
      } catch {
        return [`Not a valid Studio URL: ${args[2]}`];
      }
      const next =
        action === 'add'
          ? [...new Set([...settings.studioOrigins, origin])]
          : settings.studioOrigins.filter((existing) => existing !== origin);
      await updateAgentSettings({
        studioOrigins: next,
        ...(settings.lastOrigin === origin && action === 'remove' && { lastOrigin: undefined }),
      });
      return [`Studio sites: ${next.join(', ') || '(default) http://localhost:3000'}`];
    }

    case 'unpair':
      await pairingToken({ rotate: true });
      return ['New pairing secret. Paired Studio tabs are disconnected; run studio connect to pair again.'];

    default:
      return STUDIO_HELP.split('\n');
  }
}
