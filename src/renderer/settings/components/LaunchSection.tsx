import {
  Button, Checkbox, Dialog, DialogActions, DialogBody, DialogContent, DialogSurface, DialogTitle, Dropdown, Field,
  Input, Option, Switch, Textarea,
} from '@fluentui/react-components';
import { Add24Regular, ArrowDown24Regular, ArrowUp24Regular, Delete24Regular, Edit24Regular } from '@fluentui/react-icons';
import { useEffect, useState } from 'react';
import type { Strings } from '../../../shared/i18n';
import {
  DEFAULT_VSCODE_COMMAND, LAUNCH_CONFIG_VERSION, LAUNCH_OPEN_MODES, LAUNCH_TYPES, activePlan, launchProblemText,
  suggestName, type LaunchConfig, type LaunchDraft, type LaunchItem, type LaunchOpenMode, type LaunchPlan,
  type LaunchProblem, type LaunchType,
} from '../../../shared/launchItems';
import { api } from '../api';
import { useText } from '../text';

/** The form's own copy of an item: the arguments are typed as lines, one per line. */
interface Draft {
  id: string;
  name: string;
  type: LaunchType;
  target: string;
  openMode: LaunchOpenMode;
  program: string;
  cwd: string;
  command: string;
  argsText: string;
  enabled: boolean;
  checked: boolean;
}

const emptyDraft = (): Draft => ({
  id: '', name: '', type: 'app', target: '', openMode: 'default', program: '', cwd: '', command: DEFAULT_VSCODE_COMMAND,
  argsText: '', enabled: true, checked: true,
});

const toDraft = (item: LaunchItem): Draft => ({ ...item, argsText: item.args.join('\n') });

function toItem(draft: Draft, order: number): LaunchItem {
  const vsCode = draft.type === 'vscode';
  const program = vsCode ? draft.program.trim() : draft.openMode === 'program' ? draft.program.trim() : '';
  const usesProgram = !vsCode && program !== '';
  return {
    id: draft.id !== '' ? draft.id : `item-${Date.now().toString(36)}`,
    name: draft.name.trim() !== '' ? draft.name.trim() : suggestName(draft.target, draft.type),
    type: draft.type,
    target: draft.target.trim(),
    openMode: usesProgram ? 'program' : 'default',
    program,
    cwd: usesProgram ? draft.cwd.trim() : '',
    args: usesProgram
      ? draft.argsText.split(/\r?\n/).map((arg) => arg.trim()).filter((arg) => arg !== '')
      : [],
    command: vsCode ? draft.command.trim() : '',
    enabled: draft.enabled,
    checked: draft.checked,
    order,
  };
}

const typeLabel = (t: Strings, type: LaunchType): string => {
  switch (type) {
    case 'url': return t.launchTypeUrl;
    case 'app': return t.launchTypeApp;
    case 'file': return t.launchTypeFile;
    case 'vscode': return t.launchTypeVscode;
    default: return t.launchTypeFolder;
  }
};

const modeLabel = (t: Strings, mode: LaunchOpenMode): string =>
  (mode === 'program' ? t.launchModeProgram : t.launchModeDefault);

const canChooseProgram = (type: LaunchType): boolean => type === 'file' || type === 'folder';

/**
 * Settings → Request gather: named plans of things the Assist Me ping opens. One plan is active at a time, and that is
 * the one the ping opens. Every change is saved at once, so closing the window never loses an edit.
 */
export function LaunchSection() {
  const t = useText();
  const [config, setConfig] = useState<LaunchConfig | null>(null);
  const [editing, setEditing] = useState<{ index: number; draft: Draft } | null>(null);
  const [problems, setProblems] = useState<LaunchProblem[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  /** The name being typed in the rename dialog, or null while it is closed. */
  const [renameDraft, setRenameDraft] = useState<string | null>(null);

  useEffect(() => {
    void api.getLaunch().then(setConfig);
  }, []);

  if (!config) return null;

  const plan = activePlan(config);
  const planIndex = config.plans.findIndex((p) => p.id === plan.id);
  const planLabel = (candidate: LaunchPlan, index: number): string =>
    (candidate.name !== '' ? candidate.name : t.launchPlanUntitled(index + 1));

  const save = async (next: LaunchConfig): Promise<void> => {
    const saved = await api.setLaunch(next);
    setConfig(saved);
    setNotice(t.launchSaved);
  };

  /** Replaces the active plan with `change`, keeping the rest of the config as it is. */
  const savePlan = (change: Partial<LaunchPlan>): void => {
    void save({ ...config, plans: config.plans.map((p) => (p.id === plan.id ? { ...plan, ...change } : p)) });
  };

  const saveItems = (items: LaunchItem[]): void => savePlan({ items });

  const patch = (index: number, change: Partial<LaunchItem>): void => {
    saveItems(plan.items.map((item, i) => (i === index ? { ...item, ...change } : item)));
  };

  const move = (from: number, to: number): void => {
    if (to < 0 || to >= plan.items.length || from === to) return;
    const items = [...plan.items];
    const [moved] = items.splice(from, 1);
    items.splice(to, 0, moved);
    saveItems(items.map((item, i) => ({ ...item, order: i })));
  };

  const remove = (index: number): void => saveItems(plan.items.filter((_, i) => i !== index));

  const markAll = (checked: boolean): void => saveItems(plan.items.map((item) => ({ ...item, checked })));

  const newPlan = (): void => {
    const id = `plan-${Date.now().toString(36)}`;
    void save({ ...config, activePlanId: id, plans: [...config.plans, { id, name: '', items: [] }] });
  };

  const deletePlan = (): void => {
    if (config.plans.length <= 1) {
      setNotice(t.launchPlanLastOne);
      return;
    }
    const plans = config.plans.filter((p) => p.id !== plan.id);
    void save({ ...config, activePlanId: plans[0].id, plans });
  };

  const renamePlan = (): void => {
    const name = (renameDraft ?? '').trim();
    setRenameDraft(null);
    void savePlan({ name });
  };

  const setDraft = (change: Partial<Draft>): void => {
    setEditing((current) => (current ? { ...current, draft: { ...current.draft, ...change } } : current));
  };

  const submit = async (): Promise<void> => {
    if (!editing) return;
    const item = toItem(editing.draft, editing.index < 0 ? plan.items.length : editing.index);
    const draft: LaunchDraft = {
      type: item.type, target: item.target, openMode: item.openMode, program: item.program, cwd: item.cwd,
      command: item.command,
    };
    const found = await api.checkLaunch(draft);
    if (found.length > 0) {
      setProblems(found);
      return;
    }
    saveItems(editing.index < 0 ? [...plan.items, item] : plan.items.map((existing, i) => (i === editing.index ? item : existing)));
    setEditing(null);
  };

  const problemOf = (field: LaunchProblem['field']): string | null => {
    const found = problems.find((problem) => problem.field === field);
    return found ? launchProblemText(t, found) : null;
  };

  return (
    <>
      <div className="card notes">
        <div className="lbl">
          <span className="desc">{t.launchDesc}</span>
        </div>
      </div>

      <div className="launch-bar">
        <Dropdown
          aria-label={t.launchPlan}
          style={{ minWidth: 180 }}
          value={planLabel(plan, planIndex)}
          selectedOptions={[plan.id]}
          onOptionSelect={(_, d) => {
            const id = d.optionValue;
            if (id !== undefined && id !== plan.id) void save({ ...config, activePlanId: id });
          }}
        >
          {config.plans.map((candidate, index) => (
            <Option key={candidate.id} value={candidate.id} text={planLabel(candidate, index)}>
              {planLabel(candidate, index)}
            </Option>
          ))}
        </Dropdown>
        <Button onClick={newPlan}>{t.launchPlanNew}</Button>
        <Button onClick={() => setRenameDraft(plan.name)}>{t.launchPlanRename}</Button>
        <Button onClick={deletePlan} disabled={config.plans.length <= 1}>{t.launchPlanDelete}</Button>
      </div>

      <div className="launch-bar">
        <Button icon={<Add24Regular />} appearance="primary" onClick={() => { setProblems([]); setEditing({ index: -1, draft: emptyDraft() }); }}>
          {t.launchAdd}
        </Button>
        <Button onClick={() => markAll(true)}>{t.launchSelectAll}</Button>
        <Button onClick={() => markAll(false)}>{t.launchSelectNone}</Button>
        <Button onClick={() => void save(config)}>{t.launchSave}</Button>
        {notice !== null ? <span className="desc">{notice}</span> : null}
      </div>

      {plan.items.length === 0 ? (
        <div className="card notes"><div className="lbl"><span className="desc">{t.launchEmpty}</span></div></div>
      ) : null}

      {plan.items.map((item, index) => (
        <div
          key={item.id}
          className={`card launch-row${dragFrom === index ? ' dragging' : ''}`}
          draggable
          onDragStart={() => setDragFrom(index)}
          onDragEnd={() => setDragFrom(null)}
          onDragOver={(event) => event.preventDefault()}
          onDrop={() => {
            if (dragFrom !== null) move(dragFrom, index);
            setDragFrom(null);
          }}
        >
          <Checkbox checked={item.checked} onChange={(_, d) => patch(index, { checked: d.checked === true })} />
          <div className="lbl">
            <b>{item.name}</b>
            <span className="desc">
              {typeLabel(t, item.type)} · {item.target}{item.type === 'vscode' ? ` · ${item.command}` : ''}
            </span>
          </div>
          <div className="ctl">
            <Switch checked={item.enabled} label={item.enabled ? t.on : t.off} labelPosition="before"
              onChange={(_, d) => patch(index, { enabled: d.checked })} />
            <Button icon={<ArrowUp24Regular />} appearance="subtle" disabled={index === 0}
              onClick={() => move(index, index - 1)} aria-label="up" />
            <Button icon={<ArrowDown24Regular />} appearance="subtle" disabled={index === plan.items.length - 1}
              onClick={() => move(index, index + 1)} aria-label="down" />
            <Button icon={<Edit24Regular />} appearance="subtle" title={t.launchEdit}
              onClick={() => { setProblems([]); setEditing({ index, draft: toDraft(item) }); }} />
            <Button icon={<Delete24Regular />} appearance="subtle" title={t.launchDelete} onClick={() => remove(index)} />
          </div>
        </div>
      ))}

      <Dialog open={renameDraft !== null} onOpenChange={(_, d) => { if (!d.open) setRenameDraft(null); }}>
        <DialogSurface>
          <DialogBody>
            <DialogTitle>{t.launchPlanRename}</DialogTitle>
            <DialogContent>
              <Field label={t.launchPlanName}>
                <Input
                  value={renameDraft ?? ''}
                  placeholder={t.launchPlanUntitled(planIndex + 1)}
                  onChange={(_, d) => setRenameDraft(d.value)}
                  onKeyDown={(event) => { if (event.key === 'Enter') renamePlan(); }}
                />
              </Field>
            </DialogContent>
            <DialogActions>
              <Button appearance="secondary" onClick={() => setRenameDraft(null)}>{t.launchCancel}</Button>
              <Button appearance="primary" onClick={renamePlan}>{t.launchFormSave}</Button>
            </DialogActions>
          </DialogBody>
        </DialogSurface>
      </Dialog>

      <Dialog open={editing !== null} onOpenChange={(_, d) => { if (!d.open) setEditing(null); }}>
        <DialogSurface>
          <DialogBody>
            <DialogTitle>{editing !== null && editing.index >= 0 ? t.launchEdit : t.launchAdd}</DialogTitle>
            <DialogContent>
              {editing !== null ? (
                <div className="launch-form">
                  <Field label={t.launchName} hint={t.launchNameHint}>
                    <Input value={editing.draft.name} onChange={(_, d) => setDraft({ name: d.value })} />
                  </Field>
                  <Field label={t.launchType}>
                    <Dropdown
                      value={typeLabel(t, editing.draft.type)}
                      selectedOptions={[editing.draft.type]}
                      onOptionSelect={(_, d) => {
                        const type = (LAUNCH_TYPES as readonly string[]).includes(d.optionValue ?? '')
                          ? (d.optionValue as LaunchType) : 'app';
                        setDraft({ type, openMode: canChooseProgram(type) ? editing.draft.openMode : 'default' });
                      }}
                    >
                      {LAUNCH_TYPES.map((type) => <Option key={type} value={type} text={typeLabel(t, type)}>{typeLabel(t, type)}</Option>)}
                    </Dropdown>
                  </Field>
                  <Field
                    label={t.launchTarget}
                    validationState={problemOf('target') !== null ? 'error' : 'none'}
                    validationMessage={problemOf('target') ?? undefined}
                  >
                    <div className="launch-target">
                      <Input value={editing.draft.target} placeholder={editing.draft.type === 'url' ? 'https://…' : 'C:\\…'}
                        onChange={(_, d) => setDraft({ target: d.value })} />
                      {editing.draft.type !== 'url' ? (
                        <Button onClick={async () => {
                          const kind = editing.draft.type === 'folder' || editing.draft.type === 'vscode'
                            ? 'folder' : editing.draft.type === 'app' ? 'program' : 'file';
                          const picked = await api.pickLaunchPath(kind);
                          if (picked !== null) setDraft({ target: picked });
                        }}>{t.launchBrowse}</Button>
                      ) : null}
                    </div>
                  </Field>
                  {editing.draft.type === 'vscode' ? (
                    <>
                      <Field
                        label={t.launchCommand}
                        hint={t.launchCommandHint}
                        validationState={problemOf('command') !== null ? 'error' : 'none'}
                        validationMessage={problemOf('command') ?? undefined}
                      >
                        <Input value={editing.draft.command} placeholder={DEFAULT_VSCODE_COMMAND}
                          onChange={(_, d) => setDraft({ command: d.value })} />
                      </Field>
                      <Field
                        label={t.launchVsCode}
                        hint={t.launchVsCodeHint}
                        validationState={problemOf('program') !== null ? 'error' : 'none'}
                        validationMessage={problemOf('program') ?? undefined}
                      >
                        <div className="launch-target">
                          <Input value={editing.draft.program} placeholder="C:\\…\\Code.exe"
                            onChange={(_, d) => setDraft({ program: d.value })} />
                          <Button onClick={async () => {
                            const picked = await api.pickLaunchPath('program');
                            if (picked !== null) setDraft({ program: picked });
                          }}>{t.launchBrowse}</Button>
                        </div>
                      </Field>
                    </>
                  ) : null}
                  {canChooseProgram(editing.draft.type) ? (
                    <Field label={t.launchOpenMode}>
                      <Dropdown
                        value={modeLabel(t, editing.draft.openMode)}
                        selectedOptions={[editing.draft.openMode]}
                        onOptionSelect={(_, d) => {
                          const mode: LaunchOpenMode = d.optionValue === 'program' ? 'program' : 'default';
                          setDraft({ openMode: mode });
                        }}
                      >
                        {LAUNCH_OPEN_MODES.map((mode) => <Option key={mode} value={mode} text={modeLabel(t, mode)}>{modeLabel(t, mode)}</Option>)}
                      </Dropdown>
                    </Field>
                  ) : null}
                  {canChooseProgram(editing.draft.type) && editing.draft.openMode === 'program' ? (
                    <>
                      <Field
                        label={t.launchProgram}
                        validationState={problemOf('program') !== null ? 'error' : 'none'}
                        validationMessage={problemOf('program') ?? undefined}
                      >
                        <div className="launch-target">
                          <Input value={editing.draft.program} placeholder="C:\\…\\Code.exe"
                            onChange={(_, d) => setDraft({ program: d.value })} />
                          <Button onClick={async () => {
                            const picked = await api.pickLaunchPath('program');
                            if (picked !== null) setDraft({ program: picked });
                          }}>{t.launchBrowse}</Button>
                        </div>
                      </Field>
                      <Field label={t.launchArgs} hint={t.launchArgsHint}>
                        <Textarea value={editing.draft.argsText} textarea={{ rows: 3 }} resize="vertical"
                          onChange={(_, d) => setDraft({ argsText: d.value })} />
                      </Field>
                      <Field
                        label={t.launchCwd}
                        hint={t.launchCwdHint}
                        validationState={problemOf('cwd') !== null ? 'error' : 'none'}
                        validationMessage={problemOf('cwd') ?? undefined}
                      >
                        <div className="launch-target">
                          <Input value={editing.draft.cwd} placeholder={editing.draft.type === 'folder' ? editing.draft.target : 'C:\\…'}
                            onChange={(_, d) => setDraft({ cwd: d.value })} />
                          <Button onClick={async () => {
                            const picked = await api.pickLaunchPath('folder');
                            if (picked !== null) setDraft({ cwd: picked });
                          }}>{t.launchBrowse}</Button>
                        </div>
                      </Field>
                    </>
                  ) : null}
                </div>
              ) : null}
            </DialogContent>
            <DialogActions>
              <Button appearance="secondary" onClick={() => setEditing(null)}>{t.launchCancel}</Button>
              <Button appearance="primary" onClick={() => void submit()}>{t.launchFormSave}</Button>
            </DialogActions>
          </DialogBody>
        </DialogSurface>
      </Dialog>
    </>
  );
}
