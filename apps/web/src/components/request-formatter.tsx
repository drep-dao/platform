'use client';

import { useEffect, useState } from 'react';
import { requestsApi, REQUEST_KINDS, REQUEST_KIND_LABEL, type RequestFormConfig, type RequestFormElement, type RequestFormElementType } from '@/lib/api';
import { useT } from '@/lib/prefs-context';
import { card } from '@/lib/ui';
import { DynamicField, emptyValue, type LinkValue } from './requests-section';

/**
 * §R2 — Request formatter (board-only). The board shapes the submitter form per request kind:
 * add elements (label, type, size, options), reorder them, and preview the result. Title is always
 * present and is not configurable. A kind with no elements shows just the Title.
 */

const TYPE_LABEL: Record<RequestFormElementType, string> = {
  text: 'Short text (single line)',
  markdown: 'Edit box (markdown + preview)',
  select: 'Dropdown (defined options)',
  links: 'Links (URL + comment)',
  date: 'Date (expected response)',
};
const newId = () => `el_${Math.random().toString(36).slice(2, 9)}`;

export function RequestFormatter() {
  const t = useT();
  const [config, setConfig] = useState<RequestFormConfig | null>(null);
  const [kind, setKind] = useState<string>(REQUEST_KINDS[0]);
  const [elements, setElements] = useState<RequestFormElement[]>([]);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [preview, setPreview] = useState<Record<string, string | LinkValue[]>>({});

  useEffect(() => { requestsApi.formConfig().then(setConfig).catch(() => setConfig({})); }, []);
  // Load the working copy for the selected kind from the saved config.
  useEffect(() => {
    if (!config) return;
    setElements((config[kind] ?? []).map((e) => ({ ...e, options: e.options ? [...e.options] : undefined })));
    setDirty(false);
    setPreview({});
  }, [config, kind]);

  const switchKind = (k: string) => {
    if (k === kind) return;
    if (dirty && !window.confirm(t('Discard unsaved changes to this form?'))) return;
    setMsg(null); setErr(null);
    setKind(k);
  };

  const mutate = (fn: (els: RequestFormElement[]) => RequestFormElement[]) => {
    setElements((els) => fn(els));
    setDirty(true); setMsg(null);
  };
  const patch = (i: number, p: Partial<RequestFormElement>) => mutate((els) => els.map((e, idx) => (idx === i ? { ...e, ...p } : e)));
  const move = (i: number, dir: -1 | 1) => mutate((els) => {
    const j = i + dir;
    if (j < 0 || j >= els.length) return els;
    const copy = [...els];
    [copy[i], copy[j]] = [copy[j], copy[i]];
    return copy;
  });
  const remove = (i: number) => mutate((els) => els.filter((_, idx) => idx !== i));
  const add = () => mutate((els) => [...els, { id: newId(), label: t('New field'), type: 'text' as RequestFormElementType }]);

  const save = async () => {
    setBusy(true); setErr(null); setMsg(null);
    try {
      const saved = await requestsApi.saveFormConfig(kind, elements);
      setConfig(saved);
      setDirty(false);
      setMsg(t('Saved.'));
    } catch (e) { setErr((e as Error).message); }
    setBusy(false);
  };

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">{t('Request formatter')}</h2>
        <p className="text-sm text-neutral-500">
          {t('Shape the form submitters fill in for each request type. Title is always present; everything below it is configurable. Reorder with the arrows and preview on the right.')}
        </p>
      </div>

      {/* Kind tabs */}
      <div className="inline-flex flex-wrap overflow-hidden rounded-md border border-neutral-300 text-xs dark:border-neutral-700">
        {REQUEST_KINDS.map((k) => (
          <button
            key={k}
            onClick={() => switchKind(k)}
            className={`px-3 py-1.5 font-medium ${kind === k ? 'bg-emerald-600 text-white' : 'bg-white text-neutral-600 hover:bg-neutral-100 dark:bg-neutral-900 dark:text-neutral-300 dark:hover:bg-neutral-800'}`}
          >
            {t(REQUEST_KIND_LABEL[k])}
          </button>
        ))}
      </div>

      {config === null ? <p className="text-sm text-neutral-500">{t('Loading…')}</p> : (
        <div className="grid gap-4 lg:grid-cols-2">
          {/* Builder */}
          <section className={card}>
            <div className="flex items-center justify-between">
              <h3 className="font-medium">{t('Elements')}</h3>
              {dirty ? <span className="text-xs text-amber-600 dark:text-amber-400">{t('Unsaved changes')}</span> : null}
            </div>
            <div className="mt-3 space-y-3">
              {/* Title: always present, fixed */}
              <div className="rounded-md border border-neutral-200 bg-neutral-50/60 px-3 py-2 text-sm dark:border-neutral-800 dark:bg-neutral-900/40">
                <span className="font-medium">{t('Title')}</span>
                <span className="ml-2 text-xs text-neutral-500">{t('always present · required')}</span>
              </div>

              {elements.length === 0 ? <p className="text-xs text-neutral-500">{t('No extra fields — submitters see just the Title. Add a field below.')}</p> : null}

              {elements.map((el, i) => (
                <div key={el.id} className="space-y-2 rounded-md border border-neutral-200 p-3 dark:border-neutral-800">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold uppercase tracking-wide text-neutral-400">{t('Field')} {i + 1}</span>
                    <div className="flex items-center gap-1">
                      <button type="button" disabled={i === 0} onClick={() => move(i, -1)} title={t('Move up')} className="rounded border border-neutral-300 px-1.5 py-0.5 text-xs disabled:opacity-30 dark:border-neutral-700">↑</button>
                      <button type="button" disabled={i === elements.length - 1} onClick={() => move(i, 1)} title={t('Move down')} className="rounded border border-neutral-300 px-1.5 py-0.5 text-xs disabled:opacity-30 dark:border-neutral-700">↓</button>
                      <button type="button" onClick={() => remove(i)} title={t('Remove')} className="rounded border border-rose-300 px-1.5 py-0.5 text-xs text-rose-600 hover:bg-rose-50 dark:border-rose-900 dark:hover:bg-rose-950">✕</button>
                    </div>
                  </div>
                  <label className="block text-sm">
                    <span className="mb-1 block text-xs font-medium text-neutral-600 dark:text-neutral-400">{t('Label')}</span>
                    <input value={el.label} onChange={(e) => patch(i, { label: e.target.value })} className="w-full rounded-md border border-neutral-300 bg-white px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-900" />
                  </label>
                  <div className="flex flex-wrap gap-3">
                    <label className="block text-sm">
                      <span className="mb-1 block text-xs font-medium text-neutral-600 dark:text-neutral-400">{t('Type')}</span>
                      <select
                        value={el.type}
                        onChange={(e) => {
                          const type = e.target.value as RequestFormElementType;
                          patch(i, { type, options: type === 'select' ? (el.options ?? ['']) : undefined, size: type === 'markdown' ? (el.size ?? 'large') : undefined });
                        }}
                        className="rounded-md border border-neutral-300 bg-white px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-900"
                      >
                        {(Object.keys(TYPE_LABEL) as RequestFormElementType[]).map((ty) => <option key={ty} value={ty}>{t(TYPE_LABEL[ty])}</option>)}
                      </select>
                    </label>
                    {el.type === 'markdown' ? (
                      <label className="block text-sm">
                        <span className="mb-1 block text-xs font-medium text-neutral-600 dark:text-neutral-400">{t('Size')}</span>
                        <select value={el.size ?? 'large'} onChange={(e) => patch(i, { size: e.target.value as 'small' | 'large' })} className="rounded-md border border-neutral-300 bg-white px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-900">
                          <option value="small">{t('Small')}</option>
                          <option value="large">{t('Large')}</option>
                        </select>
                      </label>
                    ) : null}
                    <label className="flex items-center gap-2 self-end pb-1.5 text-sm">
                      <input type="checkbox" checked={!!el.required} onChange={(e) => patch(i, { required: e.target.checked })} className="h-4 w-4" />
                      <span className="text-xs font-medium text-neutral-600 dark:text-neutral-400">{t('Required')}</span>
                    </label>
                  </div>
                  {el.type === 'select' ? (
                    <label className="block text-sm">
                      <span className="mb-1 block text-xs font-medium text-neutral-600 dark:text-neutral-400">{t('Options (one per line)')}</span>
                      <textarea
                        value={(el.options ?? []).join('\n')}
                        onChange={(e) => patch(i, { options: e.target.value.split('\n').map((o) => o.replace(/\r$/, '')) })}
                        onBlur={(e) => patch(i, { options: e.target.value.split('\n').map((o) => o.trim()).filter(Boolean) })}
                        rows={3}
                        placeholder={t('Option A\nOption B')}
                        className="w-full rounded-md border border-neutral-300 bg-white px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-900"
                      />
                    </label>
                  ) : null}
                </div>
              ))}

              <div className="flex flex-wrap items-center gap-2 pt-1">
                <button type="button" onClick={add} className="rounded-md border border-neutral-300 px-2.5 py-1 text-sm font-medium hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800">{t('+ Add field')}</button>
                <button type="button" disabled={busy || !dirty} onClick={save} className="rounded-md bg-emerald-600 px-3 py-1 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50">{busy ? t('Saving…') : t('Save form')}</button>
                {msg ? <span className="text-xs text-emerald-600 dark:text-emerald-400">{msg}</span> : null}
                {err ? <span className="text-xs text-rose-600">{err}</span> : null}
              </div>
            </div>
          </section>

          {/* Live preview */}
          <section className={card}>
            <h3 className="font-medium">{t('Preview')}</h3>
            <p className="mt-1 text-xs text-neutral-500">{t('How the form looks to a submitter for a')} {t(REQUEST_KIND_LABEL[kind])}.</p>
            <div className="mt-3 space-y-3">
              <div>
                <span className="mb-1 block text-xs font-medium text-neutral-600 dark:text-neutral-400">{t('Title')}</span>
                <input disabled placeholder={t('Request title')} className="w-full rounded-md border border-neutral-300 bg-neutral-50 px-2 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-900/60" />
              </div>
              {elements.map((el) => (
                <DynamicField key={el.id} el={el} value={preview[el.id] ?? emptyValue(el)} onChange={(v) => setPreview((s) => ({ ...s, [el.id]: v }))} />
              ))}
              {elements.length === 0 ? <p className="text-xs text-neutral-400">{t('Only the Title — add fields on the left.')}</p> : null}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
