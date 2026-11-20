import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  listManufacturingSpecificationVersions,
  type ManufacturingSpecificationSummary,
  type ManufacturingSpecificationVersion,
} from '../../lib/api/manufacturingReferenceApi';
import { openDocumentPrintWindow } from '../../lib/printing/documentPrint';

const esc = (v: unknown) =>
  String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);

function rowsOf(version: ManufacturingSpecificationVersion): Array<[string, string]> {
  const d = version.parsed_data;
  const rows: Array<[string, string]> = Object.entries(d.technicalFields ?? {}).map(([k, v]) => [k, String(v)]);
  if (d.warp?.yarnCount != null) rows.push(['Warp yarn count', String(d.warp.yarnCount)]);
  if (d.weft?.yarnCount != null) rows.push(['Weft yarn count', String(d.weft.yarnCount)]);
  return rows;
}

/** معاينة بطاقة المواصفات المعتمدة (بياناتها الفنية المستخرجة) مع طباعة — للقراءة فقط. */
export function SpecPreviewDialog({
  spec,
  versionId,
  onClose,
}: {
  spec: ManufacturingSpecificationSummary;
  versionId: string;
  onClose: () => void;
}) {
  const { t } = useTranslation('orderWorkflow');
  const [version, setVersion] = useState<ManufacturingSpecificationVersion | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    listManufacturingSpecificationVersions(spec.id)
      .then((all) => {
        const v = all.find((x) => x.id === versionId) ?? null;
        if (!alive) return;
        if (v) setVersion(v);
        else setError(t('specNotFound'));
      })
      .catch((e) => alive && setError(e instanceof Error ? e.message : t('specLoadFailed')));
    return () => {
      alive = false;
    };
  }, [spec.id, versionId, t]);

  const print = () => {
    if (!version) return;
    const body = rowsOf(version)
      .map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`)
      .join('');
    const html = `<!doctype html><html dir="rtl" lang="ar"><head><meta charset="utf-8"><title>${esc(spec.code)}</title>
<style>body{font-family:Tahoma,Arial,sans-serif;padding:18mm;color:#111}h1{font-size:18pt;margin:0 0 4mm}
p{margin:0 0 6mm;color:#444;font-size:10pt}table{width:100%;border-collapse:collapse;font-size:11pt}
th,td{border:1px solid #999;padding:6px 8px;text-align:right}th{background:#f1f1f1;width:38%}</style></head>
<body><h1>${esc(spec.code)} — ${esc(spec.name)}</h1>
<p>v${esc(version.version_no)} · ${esc(version.source_file_name)}</p>
<table><tbody>${body}</tbody></table></body></html>`;
    openDocumentPrintWindow(html, `${spec.code}-v${version.version_no}`);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true">
      <div className="max-h-[90vh] w-full max-w-xl overflow-auto rounded-xl bg-white p-4" dir="rtl">
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            <h4 className="font-bold">
              {spec.code} — {spec.name}
            </h4>
            {version && (
              <p className="text-xs text-slate-500">
                v{version.version_no} · {version.source_file_name}
              </p>
            )}
          </div>
          <button type="button" onClick={onClose} className="rounded border px-3 py-1 text-sm">
            {t('close')}
          </button>
        </div>
        {error && (
          <p role="alert" className="rounded bg-rose-50 p-3 text-sm text-rose-700">
            {error}
          </p>
        )}
        {!version && !error && <p className="text-sm">{t('loading')}</p>}
        {version && (
          <>
            <table className="w-full text-right text-sm">
              <tbody>
                {rowsOf(version).map(([k, v]) => (
                  <tr key={k} className="border-t">
                    <th className="w-2/5 bg-slate-50 p-2 font-medium">{k}</th>
                    <td className="p-2">{v}</td>
                  </tr>
                ))}
                {!rowsOf(version).length && (
                  <tr>
                    <td className="p-2 text-slate-500">{t('specEmpty')}</td>
                  </tr>
                )}
              </tbody>
            </table>
            <div className="mt-3 flex justify-end">
              <button type="button" onClick={print} className="rounded bg-indigo-600 px-4 py-2 text-sm text-white">
                {t('print')}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
