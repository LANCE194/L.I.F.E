/**
 * L.I.F.E. Reports & Export
 * PDF reports (sessions, trainees, admin test data) with CSV as an option, and the Certificate of
 * Practice Completion as a PDF.
 *
 * Certificates are server-rendered HTML with every value escaped. As a second layer, the
 * preview runs in a fully sandboxed iframe (no scripts, opaque origin), and the printed and
 * downloaded copies carry a Content-Security-Policy that blocks all scripts.
 */

import { useEffect, useRef, useState } from 'react';
import { api, downloadBlob, type ExportFormat } from '../api/client';
import { useAuth } from '../hooks/useAuth';
import { Banner, Modal, PageHeader, Spinner } from '../components/ui';
import { DownloadIcon, PrintIcon, WarningIcon } from '../components/icons';
import { errorMessage, formatDate, formatNumber, localDayEndIso, localDayStartIso, todayLocal } from '../utils/format';
import './ReportsPage.css';

type ExportType = 'sessions' | 'trainees' | 'test-data';

const EXPORT_LABELS: Record<ExportType, string> = {
  sessions: 'Sessions',
  trainees: 'Trainees',
  'test-data': 'Test data',
};

interface TraineeOption {
  trainee_id: number;
  full_name: string;
  is_active: boolean;
}

interface SessionOption {
  session_id: number;
  trainee_id: number;
  date_time: string;
  trainee_name: string;
  accuracy_pct: number;
  result: string;
}

const SCRIPT_BLOCKING_CSP =
  "<meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:\">";

/** Insert a script-blocking CSP as the first element of <head> (or of the document). */
function withScriptBlockingCsp(html: string): string {
  const headMatch = /<head[^>]*>/i.exec(html);
  if (headMatch) {
    const insertAt = headMatch.index + headMatch[0].length;
    return `${html.slice(0, insertAt)}${SCRIPT_BLOCKING_CSP}${html.slice(insertAt)}`;
  }
  return `${SCRIPT_BLOCKING_CSP}${html}`;
}

function safeFilePart(value: string): string {
  return value.replace(/[^A-Za-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 60) || 'trainee';
}

export function ReportsPage() {
  const { isAdmin } = useAuth();
  const [busy, setBusy] = useState<`${ExportType}-${ExportFormat}` | 'certificate' | 'certificate-pdf' | null>(null);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [exportFilters, setExportFilters] = useState({ trainee_id: '', start_date: '', end_date: '', session_id: '' });
  const [trainees, setTrainees] = useState<TraineeOption[]>([]);
  const [sessions, setSessions] = useState<SessionOption[]>([]);
  const [certificateTrainee, setCertificateTrainee] = useState('');
  const [certificateSessionId, setCertificateSessionId] = useState('');
  const [certificate, setCertificate] = useState<{ html: string; session: SessionOption } | null>(null);
  const printFrameRef = useRef<HTMLIFrameElement | null>(null);

  useEffect(() => {
    Promise.all([api.getTrainees(), api.getSessions({ limit: 500 })])
      .then(([traineesRes, sessionsRes]) => {
        setTrainees(traineesRes.trainees.map(t => ({ trainee_id: t.trainee_id, full_name: t.full_name, is_active: t.is_active })));
        setSessions(sessionsRes.sessions.map(s => ({
          session_id: s.session_id,
          trainee_id: s.trainee_id,
          date_time: s.date_time,
          trainee_name: s.trainee_name || 'Unknown trainee',
          accuracy_pct: s.accuracy_pct,
          result: s.result,
        })));
      })
      .catch(err => setError(errorMessage(err, 'Failed to load trainees and sessions')));

    return () => printFrameRef.current?.remove();
  }, []);

  const dateRangeInvalid = Boolean(
    exportFilters.start_date && exportFilters.end_date && exportFilters.start_date > exportFilters.end_date
  );

  const handleExport = async (type: ExportType, format: ExportFormat) => {
    setBusy(`${type}-${format}`);
    setError('');
    setSuccess('');
    try {
      let blob: Blob;
      if (type === 'sessions') {
        blob = await api.exportSessions({
          trainee_id: exportFilters.trainee_id ? Number(exportFilters.trainee_id) : undefined,
          start_date: localDayStartIso(exportFilters.start_date),
          end_date: localDayEndIso(exportFilters.end_date),
        }, format);
      } else if (type === 'trainees') {
        blob = await api.exportTrainees(format);
      } else {
        blob = await api.exportTestData(exportFilters.session_id ? Number(exportFilters.session_id) : undefined, format);
      }
      const filename = `life_${type.replace('-', '_')}_${todayLocal()}.${format}`;
      await downloadBlob(blob, filename);
      setSuccess(`${EXPORT_LABELS[type]} exported as ${filename}.`);
    } catch (err) {
      setError(errorMessage(err, 'Export failed'));
    } finally {
      setBusy(null);
    }
  };

  const certificateSessions = certificateTrainee
    ? sessions.filter(s => s.trainee_id === Number(certificateTrainee))
    : sessions;

  const handleGenerateCertificate = async () => {
    const session = sessions.find(s => s.session_id === Number(certificateSessionId));
    if (!session) {
      setError('Choose a session first.');
      return;
    }
    setBusy('certificate');
    setError('');
    try {
      const html = await api.getCertificate(session.session_id);
      setCertificate({ html, session });
    } catch (err) {
      setError(errorMessage(err, 'Failed to generate certificate'));
    } finally {
      setBusy(null);
    }
  };

  const certificateFilename = (session: SessionOption) =>
    `certificate_${safeFilePart(session.trainee_name)}_${session.session_id}.pdf`;

  const handlePrintCertificate = () => {
    if (!certificate) return;
    // A hidden same-origin frame is needed to call print(); the injected CSP keeps scripts off.
    printFrameRef.current?.remove();
    const frame = document.createElement('iframe');
    frame.setAttribute('aria-hidden', 'true');
    frame.tabIndex = -1;
    frame.style.cssText = 'position:fixed;width:0;height:0;border:0;right:0;bottom:0;visibility:hidden;';
    frame.onload = () => {
      frame.contentWindow?.focus();
      frame.contentWindow?.print();
    };
    frame.srcdoc = withScriptBlockingCsp(certificate.html);
    document.body.appendChild(frame);
    printFrameRef.current = frame;
  };

  const handleDownloadCertificate = async () => {
    if (!certificate) return;
    setBusy('certificate-pdf');
    setError('');
    try {
      const blob = await api.getCertificatePdf(certificate.session.session_id);
      await downloadBlob(blob, certificateFilename(certificate.session));
    } catch (err) {
      setError(errorMessage(err, 'Failed to download the certificate'));
    } finally {
      setBusy(null);
    }
  };

  // PDF is the main download; CSV stays available for spreadsheets and the evaluation script.
  const exportButtons = (type: ExportType, label: string, disabled = false) => (
    <div className="export-buttons">
      <button type="button" className="btn btn-primary" onClick={() => void handleExport(type, 'pdf')} disabled={busy !== null || disabled}>
        {busy === `${type}-pdf` ? <><Spinner /> Preparing PDF...</> : <><DownloadIcon /> Download {label} (PDF)</>}
      </button>
      <button type="button" className="btn btn-secondary btn-sm" onClick={() => void handleExport(type, 'csv')} disabled={busy !== null || disabled} title="Spreadsheet format (Excel, Google Sheets)">
        {busy === `${type}-csv` ? <><Spinner /> Exporting...</> : 'CSV'}
      </button>
    </div>
  );

  return (
    <div>
      <Banner kind="error" onDismiss={() => setError('')}>{error}</Banner>
      <Banner kind="success" onDismiss={() => setSuccess('')}>{success}</Banner>

      <PageHeader title="Reports & Export" subtitle="Export data and generate certificates" />

      <div className="card">
        <div className="card-header">
          <h2 className="card-title">Report downloads</h2>
        </div>
        <div className="card-body">
          <div className="export-section">
            <h3>Sessions</h3>
            <p className="export-desc">Session summaries with procedure adherence (each step followed or missed) and frame rate, optionally filtered by trainee and date. Use the CSV with the evaluation script (scripts/evaluate.mjs --procedure) for Chapter 4. Dates use this computer's time zone.</p>
            <div className="export-filters">
              <div className="filter-group">
                <label className="form-label" htmlFor="export-trainee">Trainee</label>
                <select
                  id="export-trainee"
                  className="form-select"
                  value={exportFilters.trainee_id}
                  onChange={event => setExportFilters(previous => ({ ...previous, trainee_id: event.target.value }))}
                >
                  <option value="">All trainees</option>
                  {trainees.map(t => (
                    <option key={t.trainee_id} value={t.trainee_id}>{t.full_name}{t.is_active ? '' : ' (inactive)'}</option>
                  ))}
                </select>
              </div>
              <div className="filter-group">
                <label className="form-label" htmlFor="export-start">From</label>
                <input
                  type="date"
                  id="export-start"
                  className="form-input"
                  value={exportFilters.start_date}
                  max={exportFilters.end_date || undefined}
                  onChange={event => setExportFilters(previous => ({ ...previous, start_date: event.target.value }))}
                />
              </div>
              <div className="filter-group">
                <label className="form-label" htmlFor="export-end">To</label>
                <input
                  type="date"
                  id="export-end"
                  className="form-input"
                  value={exportFilters.end_date}
                  min={exportFilters.start_date || undefined}
                  onChange={event => setExportFilters(previous => ({ ...previous, end_date: event.target.value }))}
                />
              </div>
            </div>
            {dateRangeInvalid && <Banner kind="warning">The "From" date is after the "To" date.</Banner>}
            {exportButtons('sessions', 'sessions', dateRangeInvalid)}
          </div>

          <div className="export-divider" />

          <div className="export-section">
            <h3>Trainees</h3>
            <p className="export-desc">All trainee profiles, including consent status.</p>
            {exportButtons('trainees', 'trainee list')}
          </div>

          {isAdmin && (
            <>
              <div className="export-divider" />
              <div className="export-section">
                <h3>Test data (admin only)</h3>
                <p className="export-desc">Per-compression data (time, BPM, elbow angle, lock) for accuracy analysis in Chapter 4.</p>
                <div className="export-filters">
                  <div className="filter-group" style={{ flex: 1, minWidth: 260 }}>
                    <label className="form-label" htmlFor="test-session">Session</label>
                    <select
                      id="test-session"
                      className="form-select"
                      value={exportFilters.session_id}
                      onChange={event => setExportFilters(previous => ({ ...previous, session_id: event.target.value }))}
                    >
                      <option value="">All sessions</option>
                      {sessions.map(s => (
                        <option key={s.session_id} value={s.session_id}>
                          #{s.session_id} · {s.trainee_name} · {formatDate(s.date_time)}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                {exportButtons('test-data', 'test data')}
                <p className="export-desc" style={{ marginTop: 6 }}>Use <strong>CSV</strong> with the evaluation script (scripts/evaluate.mjs) for Chapter 4.</p>
              </div>
            </>
          )}
        </div>
      </div>

      <div className="card mt-4">
        <div className="card-header">
          <h2 className="card-title">Certificate of Practice Completion</h2>
        </div>
        <div className="card-body">
          <p className="export-desc">Generate a printable certificate confirming that a practice session was completed.</p>
          <div className="export-filters">
            <div className="filter-group">
              <label className="form-label" htmlFor="cert-trainee">Trainee</label>
              <select
                id="cert-trainee"
                className="form-select"
                value={certificateTrainee}
                onChange={event => {
                  setCertificateTrainee(event.target.value);
                  setCertificateSessionId('');
                }}
              >
                <option value="">All trainees</option>
                {trainees.map(t => (
                  <option key={t.trainee_id} value={t.trainee_id}>{t.full_name}{t.is_active ? '' : ' (inactive)'}</option>
                ))}
              </select>
            </div>
            <div className="filter-group" style={{ flex: 1, minWidth: 280 }}>
              <label className="form-label" htmlFor="cert-session">Session</label>
              <select
                id="cert-session"
                className="form-select"
                value={certificateSessionId}
                onChange={event => setCertificateSessionId(event.target.value)}
              >
                <option value="">{certificateSessions.length ? 'Choose a session...' : 'No sessions for this trainee'}</option>
                {certificateSessions.map(s => (
                  <option key={s.session_id} value={s.session_id}>
                    {s.trainee_name} · {formatDate(s.date_time)} · {formatNumber(s.accuracy_pct)}% ({s.result})
                  </option>
                ))}
              </select>
            </div>
          </div>
          <button
            type="button"
            className="btn btn-success"
            onClick={() => void handleGenerateCertificate()}
            disabled={busy !== null || !certificateSessionId}
          >
            {busy === 'certificate' ? <><Spinner /> Generating...</> : 'Generate certificate'}
          </button>
        </div>
      </div>

      <div className="card mt-4">
        <div className="card-body">
          <div className="disclaimer">
            <WarningIcon size={20} />
            <div>
              <strong>Training aid only. Not a medical device.</strong>
              <p>
                Certificates of Practice Completion confirm session completion only and do not constitute CPR certification.
                This system evaluates adult CPR practice for elbow lock and cadence only. A single 2D webcam does not measure
                compression depth, recoil, hand placement, or rescue breaths.
              </p>
            </div>
          </div>
        </div>
      </div>

      {certificate && (
        <Modal
          title="Certificate Preview"
          subtitle="Review before printing or downloading"
          onClose={() => setCertificate(null)}
          size="lg"
          actions={
            <>
              <button type="button" className="btn btn-secondary" onClick={() => void handleDownloadCertificate()} disabled={busy === 'certificate-pdf'}>
                {busy === 'certificate-pdf' ? <><Spinner /> Preparing PDF...</> : <><DownloadIcon /> Download PDF</>}
              </button>
              <button type="button" className="btn btn-primary" onClick={handlePrintCertificate}>
                <PrintIcon /> Print / Save as PDF
              </button>
            </>
          }
        >
          {/* Empty sandbox: no scripts, forms, popups or same-origin access. */}
          <iframe
            sandbox=""
            srcDoc={certificate.html}
            title={`Certificate preview for ${certificate.session.trainee_name}`}
            className="certificate-frame"
          />
        </Modal>
      )}
    </div>
  );
}

export default ReportsPage;
