/**
 * L.I.F.E. Reports & Export
 * CSV exports (sessions, trainees, admin test data) and the Certificate of Practice Completion.
 *
 * Certificates are server-rendered HTML with every value escaped. As a second layer, the
 * preview runs in a fully sandboxed iframe (no scripts, opaque origin), and the printed and
 * downloaded copies carry a Content-Security-Policy that blocks all scripts.
 */

import { useEffect, useRef, useState } from 'react';
import { api, downloadBlob } from '../api/client';
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
  const [busy, setBusy] = useState<ExportType | 'certificate' | null>(null);
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

  const handleExport = async (type: ExportType) => {
    setBusy(type);
    setError('');
    setSuccess('');
    try {
      let blob: Blob;
      if (type === 'sessions') {
        blob = await api.exportSessions({
          trainee_id: exportFilters.trainee_id ? Number(exportFilters.trainee_id) : undefined,
          start_date: localDayStartIso(exportFilters.start_date),
          end_date: localDayEndIso(exportFilters.end_date),
        });
      } else if (type === 'trainees') {
        blob = await api.exportTrainees();
      } else {
        blob = await api.exportTestData(exportFilters.session_id ? Number(exportFilters.session_id) : undefined);
      }
      const filename = `life_${type.replace('-', '_')}_${todayLocal()}.csv`;
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
    `certificate_${safeFilePart(session.trainee_name)}_${session.session_id}.html`;

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
    const blob = new Blob([withScriptBlockingCsp(certificate.html)], { type: 'text/html;charset=utf-8' });
    await downloadBlob(blob, certificateFilename(certificate.session));
  };

  const exportButton = (type: ExportType, label: string, variant = 'btn-primary', disabled = false) => (
    <button type="button" className={`btn ${variant}`} onClick={() => void handleExport(type)} disabled={busy !== null || disabled}>
      {busy === type ? <><Spinner /> Exporting...</> : <><DownloadIcon /> {label}</>}
    </button>
  );

  return (
    <div>
      <Banner kind="error" onDismiss={() => setError('')}>{error}</Banner>
      <Banner kind="success" onDismiss={() => setSuccess('')}>{success}</Banner>

      <PageHeader title="Reports & Export" subtitle="Export data and generate certificates" />

      <div className="card">
        <div className="card-header">
          <h2 className="card-title">CSV exports</h2>
        </div>
        <div className="card-body">
          <div className="export-section">
            <h3>Sessions</h3>
            <p className="export-desc">Session summaries, optionally filtered by trainee and date. Dates use this computer's time zone.</p>
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
            {exportButton('sessions', 'Export sessions CSV', 'btn-primary', dateRangeInvalid)}
          </div>

          <div className="export-divider" />

          <div className="export-section">
            <h3>Trainees</h3>
            <p className="export-desc">All trainee profiles, including consent status.</p>
            {exportButton('trainees', 'Export trainees CSV')}
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
                {exportButton('test-data', 'Export test data CSV', 'btn-secondary')}
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
              <button type="button" className="btn btn-secondary" onClick={() => void handleDownloadCertificate()}>
                <DownloadIcon /> Download HTML
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
