import { Input } from '@fluentui/react-components';
import { Key24Regular, Sparkle24Regular } from '@fluentui/react-icons';
import { useEffect, useState } from 'react';
import type { Settings } from '../../../shared/settings';
import { useText } from '../text';
import type { Update } from '../useAppState';
import { SettingRow, SwitchRow } from './rows';

/**
 * The AI setting and its DeepSeek key. The key is saved on blur or Enter, and the main process cleans it up: anything
 * that isn't a key character is dropped there. The question itself is typed in the box All In opens.
 */
export function AiSection({ settings: s, update }: { settings: Settings; update: Update }) {
  const t = useText();
  const [draft, setDraft] = useState(s.deepseekKey);
  useEffect(() => setDraft(s.deepseekKey), [s.deepseekKey]);
  const save = (): void => {
    if (draft !== s.deepseekKey) void update({ deepseekKey: draft });
  };
  return (
    <>
      <SwitchRow icon={<Sparkle24Regular />} title={t.aiAsk} description={t.aiAskDesc}
        checked={s.aiAsk} onChange={(v) => void update({ aiAsk: v })} />
      <SettingRow icon={<Key24Regular />} title={t.aiKey} description={t.aiKeyDesc} dim={!s.aiAsk}>
        <Input type="password" value={draft} placeholder="sk-…" style={{ width: 240 }}
          onChange={(_, d) => setDraft(d.value)} onBlur={save} onKeyDown={(e) => e.key === 'Enter' && save()} />
      </SettingRow>
      <div className="card notes">
        <div className="lbl">
          <span className="desc">{t.aiPrivacy}</span>
        </div>
      </div>
    </>
  );
}
