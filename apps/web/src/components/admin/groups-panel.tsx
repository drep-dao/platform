'use client';

import { useCallback, useEffect, useState } from 'react';
import { adminApi, type AdminGroup, type AdminGroupConfig, type AdminGroupMember } from '@/lib/admin-api';

// §29 — the sysadmin GROUPS tab: create configurable groups (e.g. OG), set what they collect and
// submit, who admits members, and who may comment — then activate (or hide/pause) them.
const PROFILE_FIELDS: [string, string][] = [['memberSince', 'Member since'], ['displayName', 'Display name'], ['photo', 'Photo'], ['bio', 'Bio']];
const PROPOSAL_TYPES: [string, string][] = [['INFORMATIVE', 'Informative'], ['POLL', 'Poll']];
const ADMISSION: [string, string][] = [['FREE', 'Free admission'], ['BOARD', 'Board approval'], ['DREPS', 'DReps approval'], ['SINGLE_DREP', 'Single DRep approval'], ['ADMIN', 'Admin approval']];
const COMMENTERS: [string, string][] = [['members', 'Group members'], ['dreps', 'DReps'], ['experts', 'Experts'], ['submitters', 'Submitters'], ['viewers', 'Viewers']];

const inputCls = 'rounded border border-slate-700 bg-slate-950 px-2 py-1 text-sm text-slate-100';
const btnCls = 'rounded bg-emerald-600 px-3 py-1 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-40';
const ghostBtn = 'rounded border border-slate-700 px-3 py-1 text-sm text-slate-200 hover:bg-slate-800';

function Check({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="flex items-center gap-1.5 text-sm text-slate-200">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} /> {label}
    </label>
  );
}

export function GroupsPanel() {
  const [groups, setGroups] = useState<AdminGroup[] | null>(null);
  const [dreps, setDreps] = useState<{ userId: string; name: string }[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [newName, setNewName] = useState('');
  const [newKey, setNewKey] = useState('');
  const [editId, setEditId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try { setGroups(await adminApi.groups.list()); setDreps(await adminApi.groups.dreps()); }
    catch (e) { setError(e instanceof Error ? e.message : 'could not load groups'); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true); setError(null);
    try { await fn(); await load(); } catch (e) { setError(e instanceof Error ? e.message : 'action failed'); } finally { setBusy(false); }
  };

  const create = () => run(async () => { await adminApi.groups.create(newName.trim(), newKey.trim()); setNewName(''); setNewKey(''); });

  return (
    <section className="rounded-lg border border-slate-800 bg-slate-900/50 p-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-200">Groups</h2>
        <span className="text-xs text-slate-400">configurable roles that submit + vote on their own proposals</span>
      </div>
      <p className="mt-2 text-xs text-slate-300">
        Create a group, configure it, then <strong>Activate</strong> to turn it on (it starts hidden). Hiding pauses a group without deleting it.
        Voting is fixed for every group: <em>members only · 1 member = 1 vote · 67% threshold</em>.
      </p>

      {error ? <p className="mt-2 rounded bg-red-500/15 px-2 py-1 text-xs text-red-300">{error}</p> : null}

      {/* create */}
      <div className="mt-3 flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1 text-xs text-slate-400">Name
          <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="OG" className={inputCls} />
        </label>
        <label className="flex flex-col gap-1 text-xs text-slate-400">Key (slug)
          <input value={newKey} onChange={(e) => setNewKey(e.target.value)} placeholder="og" className={inputCls} />
        </label>
        <button disabled={busy || newName.trim().length < 2 || newKey.trim().length < 2} onClick={create} className={btnCls}>Add group</button>
      </div>

      {/* list */}
      <div className="mt-4 space-y-3">
        {groups == null ? <p className="text-xs text-slate-400">loading…</p> : null}
        {groups?.length === 0 ? <p className="text-xs text-slate-400">No groups yet.</p> : null}
        {groups?.map((g) => (
          <div key={g.id} className="rounded-lg border border-slate-800 bg-slate-950/40 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="font-medium text-slate-100">{g.name}</span>
                <span className="text-xs text-slate-500">/{g.key}</span>
                <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${g.status === 'ACTIVE' ? 'bg-emerald-500/15 text-emerald-300' : 'bg-slate-600/30 text-slate-300'}`}>{g.status === 'ACTIVE' ? 'ACTIVE' : 'HIDDEN'}</span>
                <span className="text-xs text-slate-400">{g.members} member{g.members === 1 ? '' : 's'}{g.pending ? ` · ${g.pending} pending` : ''}</span>
              </div>
              <div className="flex items-center gap-2">
                <button disabled={busy} onClick={() => run(() => adminApi.groups.update(g.id, { status: g.status === 'ACTIVE' ? 'HIDDEN' : 'ACTIVE' }))} className={ghostBtn}>
                  {g.status === 'ACTIVE' ? 'Hide' : 'Activate'}
                </button>
                <button onClick={() => setEditId(editId === g.id ? null : g.id)} className={ghostBtn}>{editId === g.id ? 'Close' : 'Configure'}</button>
              </div>
            </div>
            {editId === g.id ? <GroupEditor group={g} dreps={dreps} busy={busy} onSave={(dto) => run(() => adminApi.groups.update(g.id, dto))} onReload={load} /> : null}
          </div>
        ))}
      </div>
    </section>
  );
}

function GroupEditor({ group, dreps, busy, onSave, onReload }: {
  group: AdminGroup;
  dreps: { userId: string; name: string }[];
  busy: boolean;
  onSave: (dto: Partial<AdminGroupConfig>) => Promise<void>;
  onReload: () => Promise<void>;
}) {
  const [name, setName] = useState(group.name);
  const [profileFields, setProfileFields] = useState<string[]>(group.profileFields);
  const [proposalTypes, setProposalTypes] = useState<string[]>(group.proposalTypes);
  const [admissionType, setAdmissionType] = useState(group.admissionType);
  const [approverUserId, setApproverUserId] = useState<string>(group.approverUserId ?? '');
  const [commenters, setCommenters] = useState<string[]>(group.commenters);
  const [members, setMembers] = useState<AdminGroupMember[] | null>(null);
  const [justSaved, setJustSaved] = useState(false);
  const arrEq = (a: string[], b: string[]) => a.length === b.length && [...a].sort().join('|') === [...b].sort().join('|');
  const dirty =
    name.trim() !== group.name ||
    !arrEq(profileFields, group.profileFields) ||
    !arrEq(proposalTypes, group.proposalTypes) ||
    admissionType !== group.admissionType ||
    (approverUserId || null) !== (group.approverUserId ?? null) ||
    !arrEq(commenters, group.commenters);

  const toggle = (list: string[], set: (v: string[]) => void, key: string) => (on: boolean) => set(on ? [...new Set([...list, key])] : list.filter((x) => x !== key));

  const loadMembers = useCallback(async () => { setMembers(await adminApi.groups.members(group.id).catch(() => [])); }, [group.id]);
  useEffect(() => { void loadMembers(); }, [loadMembers]);

  const save = async () => { await onSave({ name: name.trim(), profileFields, proposalTypes, admissionType, approverUserId: approverUserId || null, commenters }); setJustSaved(true); };

  return (
    <div className="mt-3 space-y-3 border-t border-slate-800 pt-3 text-sm">
      <label className="flex flex-col gap-1 text-xs text-slate-400">Group name
        <input value={name} onChange={(e) => setName(e.target.value)} className={`${inputCls} max-w-xs`} />
      </label>

      <div>
        <div className="text-xs font-medium uppercase tracking-wide text-slate-400">Profile fields</div>
        <div className="mt-1 flex flex-wrap gap-4">
          {PROFILE_FIELDS.map(([k, l]) => <Check key={k} checked={profileFields.includes(k)} onChange={toggle(profileFields, setProfileFields, k)} label={l} />)}
        </div>
      </div>

      <div>
        <div className="text-xs font-medium uppercase tracking-wide text-slate-400">Proposal types members can submit</div>
        <div className="mt-1 flex flex-wrap gap-4">
          {PROPOSAL_TYPES.map(([k, l]) => <Check key={k} checked={proposalTypes.includes(k)} onChange={toggle(proposalTypes, setProposalTypes, k)} label={l} />)}
        </div>
        <p className="mt-1 text-xs text-slate-500">Fixed for all proposals: title, content (edit/preview), voting-ends date · voters = members only · 1 member = 1 vote · 67% threshold.</p>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-xs text-slate-400">Admission
          <select value={admissionType} onChange={(e) => setAdmissionType(e.target.value)} className={inputCls}>
            {ADMISSION.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </label>
        {admissionType === 'SINGLE_DREP' ? (
          <label className="flex flex-col gap-1 text-xs text-slate-400">Approver DRep
            <select value={approverUserId} onChange={(e) => setApproverUserId(e.target.value)} className={inputCls}>
              <option value="">— none (registrations stay pending) —</option>
              {dreps.map((d) => <option key={d.userId} value={d.userId}>{d.name}</option>)}
            </select>
          </label>
        ) : null}
      </div>

      <div>
        <div className="text-xs font-medium uppercase tracking-wide text-slate-400">Who can comment on proposals</div>
        <div className="mt-1 flex flex-wrap gap-4">
          {COMMENTERS.map(([k, l]) => <Check key={k} checked={commenters.includes(k)} onChange={toggle(commenters, setCommenters, k)} label={l} />)}
        </div>
        {commenters.length === 0 ? <p className="mt-1 text-xs text-slate-500">No one can comment.</p> : null}
      </div>

      <div className="flex items-center gap-3"><button disabled={busy || !dirty} onClick={save} className={btnCls}>Save configuration</button>{justSaved && !dirty ? <span className="text-sm font-medium text-emerald-400">Saved ✓</span> : null}</div>

      {/* member oversight */}
      <div className="mt-2 border-t border-slate-800 pt-2">
        <div className="text-xs font-medium uppercase tracking-wide text-slate-400">Members</div>
        {members == null ? <p className="text-xs text-slate-500">loading…</p> : members.length === 0 ? <p className="text-xs text-slate-500">No members yet.</p> : (
          <ul className="mt-1 space-y-1">
            {members.map((m) => (
              <li key={m.id} className="flex items-center justify-between gap-2 text-sm text-slate-200">
                <span>{m.name} {m.status === 'PENDING' ? <span className="rounded bg-amber-500/15 px-1.5 text-xs text-amber-300">pending</span> : <span className="text-xs text-slate-500">member{m.since ? ` · since ${new Date(m.since).toLocaleDateString()}` : ''}</span>}</span>
                <span className="flex gap-2">
                  {m.status === 'PENDING' ? <button disabled={busy} onClick={async () => { await adminApi.groups.approveMember(group.id, m.id); await loadMembers(); await onReload(); }} className={ghostBtn}>Approve</button> : null}
                  <button disabled={busy} onClick={async () => { await adminApi.groups.kickMember(group.id, m.id); await loadMembers(); await onReload(); }} className="rounded border border-rose-800 px-3 py-1 text-sm text-rose-300 hover:bg-rose-950/40">Remove</button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
